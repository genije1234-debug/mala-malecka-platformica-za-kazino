import { get, run, nowIso } from "../db.ts";
import { roundId as makeRoundId, money, clamp, secureRandom } from "../util.ts";
import { config } from "../config.ts";

import { checkEligibility } from "./session.ts";
import { acquireLock, attachRoundToLock, releaseLock } from "./lock.ts";
import { createRound, setStatus, getRound } from "./round.ts";
import { walletOp, getBalance } from "./wallet.ts";
import { computeSteering, recordOutcome, effectiveRtp } from "./brain.ts";
import { applyMaxWinGuard } from "./maxWinGuard.ts";
import { recordStake, recordReturn, capWin } from "./houseGovernor.ts";
import { recordRoundStat } from "./gameStats.ts";
import { contribute, checkAndTrigger } from "./jackpot.ts";
import { accrue, consumeGranted } from "./freebet.ts";
import { trackEvent, updateBehaviorOnBet } from "./behavior.ts";
import { emitEvent } from "./audit.ts";
import { generateAndLog } from "./rng.ts";

/**
 * STATEFUL / interaktivne igre (Mines, Crash) koje traju vise koraka.
 * Ulog se skida na startu, stanje se cuva u casino_rounds.outcome_json,
 * a runda ostaje otvorena (RESULT_GENERATED) do cashout/bust/abandon.
 */

export class InteractiveError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type Mode = "REAL" | "FREEBET";

interface StartCtx {
  rid: string;
  game: any;
  requestedRtp: number;
  mode: Mode;
  bet: number;
}

function safeJson(s: string): any {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

/** Zajednicki start: eligibility + lock + debit + accrual + contribution + steering. */
function startRound(
  playerId: string,
  sessionId: string | undefined,
  gameId: string,
  betAmount: number,
  mode: Mode,
): StartCtx {
  const elig = checkEligibility(playerId);
  if (!elig.ok) throw new InteractiveError(elig.reason ?? "NOT_ELIGIBLE");

  const bet = money(betAmount);
  const game = get<any>(`SELECT * FROM casino_games WHERE game_id=?`, [gameId]);
  if (!game) throw new InteractiveError("GAME_NOT_FOUND");
  if (game.status !== "ACTIVE") throw new InteractiveError("GAME_NOT_ACTIVE");
  if (bet < game.min_bet || bet > game.max_bet) throw new InteractiveError("BET_OUT_OF_LIMITS");

  const lock = acquireLock(playerId, gameId);
  if (!lock) throw new InteractiveError("ACTIVE_ROUND_EXISTS");

  const rid = makeRoundId();
  try {
    createRound({
      roundId: rid,
      playerId,
      gameId,
      sessionId,
      mode,
      betAmount: bet,
      currency: config.currency,
      gameVersion: game.game_version,
      mathConfigVersion: game.math_config_version,
      payoutTableVersion: game.payout_table_version,
    });
    attachRoundToLock(playerId, rid);
    setStatus(rid, "LOCK_ACQUIRED");
    setStatus(rid, "BET_DEBIT_PENDING");

    if (mode === "REAL") {
      const debit = walletOp({ idempotencyKey: `${rid}:BET_DEBIT`, playerId, roundId: rid, txType: "BET_DEBIT", amount: bet });
      if (debit.status === "INSUFFICIENT_FUNDS") {
        setStatus(rid, "FAILED", "insufficient funds");
        releaseLock(playerId);
        throw new InteractiveError("INSUFFICIENT_FUNDS");
      }
      if (debit.status !== "SUCCESS") {
        setStatus(rid, "DEBIT_UNKNOWN", "wallet debit unknown");
        emitEvent({ type: "BET_DEBIT_UNKNOWN", roundId: rid, priority: 100 });
        throw new InteractiveError("DEBIT_UNKNOWN");
      }
    } else {
      if (!consumeGranted(playerId, bet)) {
        setStatus(rid, "FAILED", "no freebet balance");
        releaseLock(playerId);
        throw new InteractiveError("NO_FREEBET_BALANCE");
      }
    }
    setStatus(rid, "BET_DEBITED");

    if (mode === "REAL") {
      recordStake(bet); // realan ulog ulazi u house budzet
      accrue(playerId, bet);
      if (game.jackpot_eligible) contribute(playerId, gameId, rid, bet);
    }

    const { requestedRtp } = computeSteering(playerId, bet, !!game.jackpot_eligible);
    setStatus(rid, "RESULT_GENERATED");
    trackEvent({ playerId, sessionId, type: "BET", gameId, amount: bet });

    return { rid, game, requestedRtp, mode, bet };
  } catch (err) {
    const r = getRound(rid);
    if (r && ["CREATED", "LOCK_ACQUIRED", "BET_DEBIT_PENDING"].includes(r.status)) releaseLock(playerId);
    throw err;
  }
}

/** Zajednicki settle: raw win -> max win guard -> credit -> jackpot -> close + brain/behavior. */
function settle(
  playerId: string,
  sessionId: string | undefined,
  rid: string,
  finalMultiplier: number,
  outcome: any,
): { finalWin: number; jackpotWin: any; balance: number } {
  const round = getRound(rid);
  const bet = round.bet_amount;
  const mode = round.mode as Mode;
  const game = get<any>(`SELECT * FROM casino_games WHERE game_id=?`, [round.game_id]);

  const rawWin = money(bet * finalMultiplier);
  const guard = applyMaxWinGuard(rawWin, bet, game.max_win_multiplier);
  const houseCap = capWin(guard.finalWin);
  const finalWin = houseCap.paid;
  const capped = guard.capped || houseCap.capped;

  generateAndLog({
    roundId: rid,
    gameId: round.game_id,
    playerId,
    rawOutput: secureRandom(),
    mappedResult: outcome,
    algorithmVersion: game.math_config_version,
  });

  run(
    `UPDATE casino_rounds SET raw_win_amount=?, final_win_amount=?, max_win_applied=?, outcome_json=?, effective_rtp_at_play=? WHERE round_id=?`,
    [rawWin, finalWin, capped ? 1 : 0, JSON.stringify(outcome), effectiveRtp(playerId), rid],
  );
  setStatus(rid, capped ? "MAX_WIN_APPLIED" : "WIN_CALCULATED");
  if (capped) emitEvent({ type: "MAX_WIN_APPLIED", roundId: rid, priority: 100, payload: { rawWin, finalWin } });

  if (finalWin > 0) {
    setStatus(rid, "WIN_CREDIT_PENDING");
    const credit = walletOp({ idempotencyKey: `${rid}:WIN_CREDIT`, playerId, roundId: rid, txType: "WIN_CREDIT", amount: finalWin });
    if (credit.status !== "SUCCESS") {
      setStatus(rid, "MANUAL_REVIEW", "win credit failed");
      emitEvent({ type: "WIN_CREDIT_PENDING", roundId: rid, priority: 100 });
      throw new InteractiveError("WIN_CREDIT_FAILED");
    }
    recordReturn(finalWin); // isplata smanjuje house budzet
    setStatus(rid, "WIN_CREDITED");
  }

  let jackpotWin = null;
  if (mode === "REAL" && game.jackpot_eligible) {
    jackpotWin = checkAndTrigger(playerId, rid);
    if (jackpotWin) {
      setStatus(rid, "JACKPOT_CREDITED");
      run(`UPDATE casino_rounds SET jackpot_amount=? WHERE round_id=?`, [jackpotWin.amount, rid]);
    }
  }

  setStatus(rid, "CLOSED");
  run(`UPDATE casino_rounds SET closed_at=? WHERE round_id=?`, [nowIso(), rid]);
  releaseLock(playerId);

  if (mode === "REAL") {
    recordOutcome(playerId, bet, finalWin);
    recordRoundStat(round.game_id, bet, finalWin); // brojaci u hodu po igri
  }
  const won = finalWin > 0;
  trackEvent({ playerId, sessionId, type: won ? "WIN" : "LOSS", gameId: round.game_id, amount: finalWin });
  if (jackpotWin) trackEvent({ playerId, sessionId, type: "JACKPOT_WIN", gameId: round.game_id, amount: jackpotWin.amount });
  updateBehaviorOnBet(playerId, round.game_id, bet, won);
  emitEvent({ type: "ROUND_CLOSED", roundId: rid, priority: 10, payload: { finalWin, jackpot: jackpotWin?.amount ?? 0 } });

  return { finalWin, jackpotWin, balance: getBalance(playerId) };
}

function ownedOpenRound(playerId: string, rid: string): any {
  const r = getRound(rid);
  if (!r || r.player_id !== playerId) throw new InteractiveError("ROUND_NOT_FOUND");
  if (r.status !== "RESULT_GENERATED") throw new InteractiveError("ROUND_OVER");
  return r;
}

// ============================ MINES ============================

const MINES_TILES = 25;

/** Fer multiplikator posle `picks` bezbednih polja, skaliran ka rtp_target. */
function minesMultiplier(mines: number, picks: number, rtpTarget: number): number {
  let m = 1;
  for (let i = 0; i < picks; i++) m *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  return money(m * rtpTarget);
}

export function minesStart(
  playerId: string,
  sessionId: string | undefined,
  gameId: string,
  betAmount: number,
  mines: number,
  mode: Mode = "REAL",
) {
  const m = Math.floor(mines);
  if (!(m >= 1 && m <= 24)) throw new InteractiveError("INVALID_MINES");
  const ctx = startRound(playerId, sessionId, gameId, betAmount, mode);
  const rtpTarget = ctx.game.rtp_target;
  const state = {
    kind: "mines",
    mines: m,
    tiles: MINES_TILES,
    revealed: [] as number[],
    bombs: [] as number[],
    multiplier: 1,
    busted: false,
    cashed: false,
    requestedRtp: ctx.requestedRtp,
    rtpTarget,
  };
  run(`UPDATE casino_rounds SET outcome_json=?, favorability=? WHERE round_id=?`, [JSON.stringify(state), ctx.requestedRtp, ctx.rid]);
  return {
    round_id: ctx.rid,
    mines: m,
    tiles: MINES_TILES,
    mode: ctx.mode,
    bet: ctx.bet,
    multiplier: 1,
    next_multiplier: minesMultiplier(m, 1, rtpTarget),
    balance: getBalance(playerId),
  };
}

export function minesReveal(playerId: string, sessionId: string | undefined, rid: string, cell: number) {
  const round = ownedOpenRound(playerId, rid);
  const state = safeJson(round.outcome_json);
  if (state.kind !== "mines") throw new InteractiveError("WRONG_GAME");
  if (cell < 0 || cell >= state.tiles) throw new InteractiveError("INVALID_CELL");
  if (state.revealed.includes(cell)) throw new InteractiveError("ALREADY_REVEALED");

  const remaining = state.tiles - state.revealed.length;
  const pBase = state.mines / remaining;
  const steer = clamp(state.requestedRtp, 0.5, 1.5); // >1 = igracu ide na ruku (manje mina)
  const pBomb = clamp(pBase / steer, 0.02, 0.97);
  const bomb = secureRandom() < pBomb;

  if (bomb) {
    const unrevealed: number[] = [];
    for (let i = 0; i < state.tiles; i++) if (!state.revealed.includes(i)) unrevealed.push(i);
    const others = unrevealed.filter((i) => i !== cell).sort(() => secureRandom() - 0.5).slice(0, state.mines - 1);
    state.bombs = [cell, ...others];
    state.busted = true;
    state.hit = cell;
    const res = settle(playerId, sessionId, rid, 0, state);
    return {
      kind: "mines",
      ended: true,
      busted: true,
      hit: cell,
      bombs: state.bombs,
      revealed: state.revealed,
      multiplier: 0,
      win: 0,
      balance: res.balance,
    };
  }

  state.revealed.push(cell);
  state.multiplier = minesMultiplier(state.mines, state.revealed.length, state.rtpTarget);
  const safeLeft = state.tiles - state.mines - state.revealed.length;
  run(`UPDATE casino_rounds SET outcome_json=? WHERE round_id=?`, [JSON.stringify(state), rid]);

  if (safeLeft <= 0) return minesCashout(playerId, sessionId, rid); // sve bezbedno otvoreno -> auto cashout

  return {
    kind: "mines",
    ended: false,
    safe: true,
    cell,
    revealed: state.revealed,
    multiplier: state.multiplier,
    next_multiplier: minesMultiplier(state.mines, state.revealed.length + 1, state.rtpTarget),
  };
}

export function minesCashout(playerId: string, sessionId: string | undefined, rid: string) {
  const round = ownedOpenRound(playerId, rid);
  const state = safeJson(round.outcome_json);
  if (state.kind !== "mines") throw new InteractiveError("WRONG_GAME");
  if (state.revealed.length === 0) throw new InteractiveError("NOTHING_REVEALED");

  const unrevealed: number[] = [];
  for (let i = 0; i < state.tiles; i++) if (!state.revealed.includes(i)) unrevealed.push(i);
  state.bombs = unrevealed.sort(() => secureRandom() - 0.5).slice(0, state.mines);
  state.cashed = true;

  const res = settle(playerId, sessionId, rid, state.multiplier, state);
  return {
    kind: "mines",
    ended: true,
    cashed: true,
    revealed: state.revealed,
    bombs: state.bombs,
    multiplier: state.multiplier,
    win: res.finalWin,
    jackpot_win: res.jackpotWin,
    balance: res.balance,
  };
}

// ============================ CRASH ============================

/** Mnozilac kao funkcija proteklog vremena (identicno na frontu). */
export function crashGrowth(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs) / 1000;
  return money(Math.exp(0.10 * t));
}

/** Crash tacka sa house edge-om; steering pomera distribuciju (veci RTP = kasniji crash). */
function genCrashPoint(requestedRtp: number, maxWin: number): number {
  const scaler = clamp(requestedRtp, 0.6, 1.3);
  const r = secureRandom();
  const cp = scaler / Math.max(1 - r, 1e-6);
  return clamp(money(cp), 1, maxWin);
}

export function crashStart(
  playerId: string,
  sessionId: string | undefined,
  gameId: string,
  betAmount: number,
  mode: Mode = "REAL",
) {
  const ctx = startRound(playerId, sessionId, gameId, betAmount, mode);
  const crashPoint = genCrashPoint(ctx.requestedRtp, ctx.game.max_win_multiplier);
  const startedAt = Date.now();
  const state = {
    kind: "crash",
    crashPoint,
    startedAt,
    cashed: false,
    busted: false,
    requestedRtp: ctx.requestedRtp,
    sub: safeJson(ctx.game.config_json)?.sub,
  };
  run(`UPDATE casino_rounds SET outcome_json=?, favorability=? WHERE round_id=?`, [JSON.stringify(state), ctx.requestedRtp, ctx.rid]);
  return { round_id: ctx.rid, started_at: startedAt, server_now: Date.now(), mode: ctx.mode, bet: ctx.bet, balance: getBalance(playerId) };
}

export function crashState(playerId: string, sessionId: string | undefined, rid: string) {
  const round = ownedOpenRound(playerId, rid);
  const state = safeJson(round.outcome_json);
  if (state.kind !== "crash") throw new InteractiveError("WRONG_GAME");

  const m = crashGrowth(Date.now() - state.startedAt);
  if (m >= state.crashPoint) {
    state.busted = true;
    const res = settle(playerId, sessionId, rid, 0, state);
    return { ended: true, busted: true, crashPoint: state.crashPoint, multiplier: state.crashPoint, balance: res.balance };
  }
  return { ended: false, multiplier: m, server_now: Date.now() };
}

export function crashCashout(playerId: string, sessionId: string | undefined, rid: string) {
  const round = ownedOpenRound(playerId, rid);
  const state = safeJson(round.outcome_json);
  if (state.kind !== "crash") throw new InteractiveError("WRONG_GAME");

  const m = crashGrowth(Date.now() - state.startedAt);
  if (m >= state.crashPoint) {
    state.busted = true;
    const res = settle(playerId, sessionId, rid, 0, state);
    return { ended: true, busted: true, crashPoint: state.crashPoint, multiplier: state.crashPoint, balance: res.balance };
  }
  state.cashed = true;
  state.cashoutMultiplier = m;
  const res = settle(playerId, sessionId, rid, m, state);
  return {
    ended: true,
    cashed: true,
    multiplier: m,
    crashPoint: state.crashPoint,
    win: res.finalWin,
    jackpot_win: res.jackpotWin,
    balance: res.balance,
  };
}

/** Recovery: napustena interaktivna runda (lock istekao) -> zatvori kao gubitak. */
export function expireInteractiveRound(rid: string): void {
  const r = getRound(rid);
  if (!r || r.status !== "RESULT_GENERATED") return;
  const state = safeJson(r.outcome_json);
  state.busted = true;
  state.abandoned = true;
  try {
    settle(r.player_id, undefined, rid, 0, state);
  } catch {
    /* recovery best-effort */
  }
}
