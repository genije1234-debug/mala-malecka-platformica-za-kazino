import { get, run, nowIso } from "../db.ts";
import { roundId as makeRoundId, money } from "../util.ts";
import { config } from "../config.ts";
import type { PlayResult } from "@casino/shared";

import { checkEligibility } from "./session.ts";
import { acquireLock, attachRoundToLock, releaseLock } from "./lock.ts";
import { createRound, setStatus, transition, setExpectedNext, getRound } from "./round.ts";
import { walletOp, getBalance } from "./wallet.ts";
import { computeSteering, recordOutcome, effectiveRtp } from "./brain.ts";
import { playGame, type GameConfig, type PlayOptions } from "../games/engines.ts";
import { generateAndLog } from "./rng.ts";
import { applyMaxWinGuard } from "./maxWinGuard.ts";
import { recordStake, recordReturn, capWin } from "./houseGovernor.ts";
import { recordRoundStat } from "./gameStats.ts";
import { contribute, checkAndTrigger } from "./jackpot.ts";
import { accrue, getFreebet, consumeGranted } from "./freebet.ts";
import { trackEvent, updateBehaviorOnBet } from "./behavior.ts";
import { emitEvent } from "./audit.ts";

export class PlayError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function playRound(params: {
  playerId: string;
  sessionId?: string;
  gameId: string;
  betAmount: number;
  mode: "REAL" | "FREEBET";
  options?: PlayOptions;
}): PlayResult {
  const { playerId, sessionId, gameId } = params;
  const mode = params.mode;
  const bet = money(params.betAmount);

  // 0) Validacija uloga (anti-exploit: NaN/Infinity/negativno/0 ne sme proci).
  if (!Number.isFinite(bet) || bet <= 0) throw new PlayError("INVALID_BET");

  // 1) Eligibility (responsible gambling + jurisdiction).
  const elig = checkEligibility(playerId);
  if (!elig.ok) throw new PlayError(elig.reason ?? "NOT_ELIGIBLE");

  // 2) Igra + limiti.
  const game = get<any>(`SELECT * FROM casino_games WHERE game_id = ?`, [gameId]);
  if (!game) throw new PlayError("GAME_NOT_FOUND");
  if (game.status !== "ACTIVE") throw new PlayError("GAME_NOT_ACTIVE");
  if (bet < game.min_bet || bet > game.max_bet) throw new PlayError("BET_OUT_OF_LIMITS");

  // 3) Active round lock.
  const lock = acquireLock(playerId, gameId);
  if (!lock) throw new PlayError("ACTIVE_ROUND_EXISTS");

  const rid = makeRoundId();
  try {
    // 4) Kreiraj rundu.
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

    // 5) Skidanje uloga.
    setExpectedNext(rid, "BET_DEBITED", config.maxRoundDurationSec);
    setStatus(rid, "BET_DEBIT_PENDING");
    if (mode === "REAL") {
      const debit = walletOp({
        idempotencyKey: `${rid}:BET_DEBIT`,
        playerId,
        roundId: rid,
        txType: "BET_DEBIT",
        amount: bet,
      });
      if (debit.status === "INSUFFICIENT_FUNDS") {
        setStatus(rid, "FAILED", "insufficient funds");
        releaseLock(playerId);
        throw new PlayError("INSUFFICIENT_FUNDS");
      }
      if (debit.status !== "SUCCESS") {
        setStatus(rid, "DEBIT_UNKNOWN", "wallet debit unknown");
        emitEvent({ type: "BET_DEBIT_UNKNOWN", roundId: rid, priority: 100 });
        throw new PlayError("DEBIT_UNKNOWN");
      }
    } else {
      // FREEBET: stake iz dodeljene kasice (ne dira realni wallet).
      if (!consumeGranted(playerId, bet)) {
        setStatus(rid, "FAILED", "no freebet balance");
        releaseLock(playerId);
        throw new PlayError("NO_FREEBET_BALANCE");
      }
    }
    setStatus(rid, "BET_DEBITED");

    // Posle potvrdjenog debita: free-bet accrual (1%) + jackpot contribution (2%) za REAL.
    let jackpotContribution = 0;
    if (mode === "REAL") {
      recordStake(bet); // realan ulog ulazi u house budzet
      accrue(playerId, bet);
      if (game.jackpot_eligible) jackpotContribution = contribute(playerId, gameId, rid, bet);
    }

    // 6) Mozak -> requested RTP (vodjenje krive), pa generisanje rezultata.
    const { requestedRtp, effRtp } = computeSteering(playerId, bet, !!game.jackpot_eligible);
    const cfg: GameConfig = {
      game_id: game.game_id,
      game_type: game.game_type,
      rtp_target: game.rtp_target,
      max_win_multiplier: game.max_win_multiplier,
      config_json: safeJson(game.config_json),
    };
    const result = playGame(cfg, requestedRtp, params.options ?? {});
    setStatus(rid, "RESULT_GENERATED");

    // 7) RNG audit + hash chain.
    generateAndLog({
      roundId: rid,
      gameId,
      playerId,
      rawOutput: result.rawRng,
      mappedResult: result.outcome,
      algorithmVersion: game.math_config_version,
    });

    // 8) Raw win -> Max Win Guard -> House Governor (plafon 95%) -> final win.
    const rawWin = money(bet * result.multiplier);
    const guard = applyMaxWinGuard(rawWin, bet, game.max_win_multiplier);
    const houseCap = capWin(guard.finalWin);
    const finalWin = houseCap.paid;
    const capped = guard.capped || houseCap.capped;
    setExpectedNext(rid, "WIN_CREDITED", config.maxRoundDurationSec);
    setStatus(rid, capped ? "MAX_WIN_APPLIED" : "WIN_CALCULATED");
    if (capped) emitEvent({ type: "MAX_WIN_APPLIED", roundId: rid, priority: 100, payload: { rawWin, finalWin } });

    run(
      `UPDATE casino_rounds SET raw_win_amount=?, final_win_amount=?, max_win_applied=?, outcome_json=?, favorability=?, effective_rtp_at_play=? WHERE round_id=?`,
      [rawWin, finalWin, capped ? 1 : 0, JSON.stringify(result.outcome), requestedRtp, effRtp, rid],
    );

    // 9) Credit win (i REAL i FREEBET dobitak ide ceo u realni wallet).
    if (finalWin > 0) {
      setStatus(rid, "WIN_CREDIT_PENDING");
      const credit = walletOp({
        idempotencyKey: `${rid}:WIN_CREDIT`,
        playerId,
        roundId: rid,
        txType: "WIN_CREDIT",
        amount: finalWin,
      });
      if (credit.status !== "SUCCESS") {
        setStatus(rid, "MANUAL_REVIEW", "win credit failed");
        emitEvent({ type: "WIN_CREDIT_PENDING", roundId: rid, priority: 100 });
        throw new PlayError("WIN_CREDIT_FAILED");
      }
      recordReturn(finalWin); // isplata smanjuje house budzet
      setStatus(rid, "WIN_CREDITED");
    }

    // 10) Jackpot trigger (samo REAL i jackpot-eligible igre).
    let jackpotWin = null;
    if (mode === "REAL" && game.jackpot_eligible) {
      jackpotWin = checkAndTrigger(playerId, rid);
      if (jackpotWin) {
        setStatus(rid, "JACKPOT_CREDITED");
        run(`UPDATE casino_rounds SET jackpot_amount=? WHERE round_id=?`, [jackpotWin.amount, rid]);
      }
    }

    // 11) Zatvori rundu + oslobodi lock.
    setStatus(rid, "CLOSED");
    run(`UPDATE casino_rounds SET closed_at=? WHERE round_id=?`, [nowIso(), rid]);
    releaseLock(playerId);

    // 12) Mozak update (samo REAL ulog ulazi u RTP).
    const totalReturn = finalWin + (jackpotWin?.amount ?? 0);
    if (mode === "REAL") {
      recordOutcome(playerId, bet, finalWin); // jackpot se odvojeno preracunava
      recordRoundStat(gameId, bet, finalWin); // brojaci u hodu po igri (KPI bez skeniranja)
    }

    // 13) Behavior + eventi.
    const won = finalWin > 0;
    trackEvent({ playerId, sessionId, type: "BET", gameId, amount: bet });
    trackEvent({ playerId, sessionId, type: won ? "WIN" : "LOSS", gameId, amount: finalWin });
    if (jackpotWin) trackEvent({ playerId, sessionId, type: "JACKPOT_WIN", gameId, amount: jackpotWin.amount });
    updateBehaviorOnBet(playerId, gameId, bet, won);
    emitEvent({ type: "ROUND_CLOSED", roundId: rid, priority: 10, payload: { finalWin, jackpot: jackpotWin?.amount ?? 0 } });

    const fb = getFreebet(playerId);
    return {
      round_id: rid,
      game_id: gameId,
      bet_amount: bet,
      currency: config.currency,
      mode,
      outcome: result.outcome,
      raw_win: rawWin,
      final_win: finalWin,
      max_win_applied: capped,
      jackpot_win: jackpotWin,
      balance: getBalance(playerId),
      freebet_balance: fb.balance + fb.granted_balance,
      effective_rtp: effectiveRtp(playerId),
      status: "CLOSED",
    };
  } catch (err) {
    // Lock se oslobadja kod poznatih gresaka; recovery worker hvata ostalo.
    const r = getRound(rid);
    if (r && ["CREATED", "LOCK_ACQUIRED", "BET_DEBIT_PENDING"].includes(r.status)) {
      releaseLock(playerId);
    }
    throw err;
  }
}

function safeJson(s: string): any {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}
