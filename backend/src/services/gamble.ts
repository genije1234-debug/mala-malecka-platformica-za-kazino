import { get, run, nowIso } from "../db.ts";
import { uid, money, secureRandom } from "../util.ts";
import { walletOp, getBalance } from "./wallet.ts";

/**
 * Gamble (dupliranje dobitka) — fer 50/50, crveno ili crno, 2x ili nista.
 * - Vezuje se za POSLEDNJU zatvorenu dobitnu rundu igraca (jedna sesija po rundi).
 * - Dobitak je vec u walletu (playRound ga kredituje), pa svaki pokusaj:
 *   debit trenutnog iznosa (GAMBLE_STAKE) -> 50/50 -> credit 2x (GAMBLE_PAYOUT) ili nista.
 * - Idempotentno preko wallet idempotency kljuceva po pokusaju.
 * - EV-neutralno: NE ulazi u mozak/house governor (ne pomera RTP krivu),
 *   ali sav novac ide kroz wallet ledger (revizija cista).
 */

export class GambleError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const SUITS_RED = ["HEART", "DIAMOND"] as const;
const SUITS_BLACK = ["SPADE", "CLUB"] as const;

export interface GambleState {
  round_id: string;
  amount: number;
  to_win: number;
  attempts_left: number;
  history: string[]; // otkrivene karte (npr. "HEART")
  status: "OPEN" | "LOST" | "CLOSED";
}

export interface GambleResult extends GambleState {
  result: "WIN" | "LOSE";
  card: string;
  balance: number;
}

function rowToState(r: any): GambleState {
  return {
    round_id: r.round_id,
    amount: money(r.current_amount),
    to_win: money(r.current_amount * 2),
    attempts_left: r.max_attempts - r.attempts_used,
    history: JSON.parse(r.history_json || "[]"),
    status: r.status,
  };
}

/** Stanje (ili kreiranje) gamble sesije za datu rundu. */
export function gambleState(playerId: string, roundId: string): GambleState {
  const existing = get<any>(`SELECT * FROM gamble_sessions WHERE round_id=?`, [roundId]);
  if (existing) {
    if (existing.player_id !== playerId) throw new GambleError("NOT_YOUR_ROUND");
    return rowToState(existing);
  }

  const round = get<any>(`SELECT * FROM casino_rounds WHERE round_id=?`, [roundId]);
  if (!round || round.player_id !== playerId) throw new GambleError("ROUND_NOT_FOUND");
  if (round.status !== "CLOSED" && round.status !== "JACKPOT_CREDITED") throw new GambleError("ROUND_NOT_CLOSED");
  if (!round.final_win_amount || round.final_win_amount <= 0) throw new GambleError("NOTHING_TO_GAMBLE");
  if (round.mode !== "REAL") throw new GambleError("REAL_ONLY");

  // Gamble dozvoljen samo na POSLEDNJU rundu igraca (kao na aparatu).
  const newer = get<any>(
    `SELECT round_id FROM casino_rounds WHERE player_id=? AND created_at > ? LIMIT 1`,
    [playerId, round.created_at],
  );
  if (newer) throw new GambleError("ROUND_TOO_OLD");

  const now = nowIso();
  run(
    `INSERT INTO gamble_sessions (session_id, round_id, player_id, current_amount, attempts_used, max_attempts, history_json, status, created_at, updated_at)
     VALUES (?,?,?,?,0,5,'[]','OPEN',?,?)`,
    [uid("gmb"), roundId, playerId, money(round.final_win_amount), now, now],
  );
  return gambleState(playerId, roundId);
}

/** Jedan pokusaj dupliranja: pick = "RED" | "BLACK". */
export function gamblePlay(playerId: string, roundId: string, pick: "RED" | "BLACK"): GambleResult {
  const state = gambleState(playerId, roundId); // kreira ako ne postoji + validacije
  if (state.status !== "OPEN") throw new GambleError("GAMBLE_CLOSED");
  if (state.attempts_left <= 0) throw new GambleError("NO_ATTEMPTS_LEFT");

  const row = get<any>(`SELECT * FROM gamble_sessions WHERE round_id=?`, [roundId]);
  const attempt = row.attempts_used + 1;
  const amount = money(row.current_amount);

  // 1) Skini ulog (idempotentno po pokusaju).
  const debit = walletOp({
    idempotencyKey: `${roundId}:GAMBLE${attempt}:STAKE`,
    playerId,
    roundId,
    txType: "GAMBLE_STAKE",
    amount,
  });
  if (debit.status !== "SUCCESS") throw new GambleError("STAKE_FAILED");

  // 2) Fer 50/50 izvlacenje.
  const red = secureRandom() < 0.5;
  const suit = red
    ? SUITS_RED[secureRandom() < 0.5 ? 0 : 1]
    : SUITS_BLACK[secureRandom() < 0.5 ? 0 : 1];
  const won = (pick === "RED") === red;

  const history: string[] = JSON.parse(row.history_json || "[]");
  history.push(suit);
  const now = nowIso();

  if (won) {
    const payout = money(amount * 2);
    const credit = walletOp({
      idempotencyKey: `${roundId}:GAMBLE${attempt}:PAYOUT`,
      playerId,
      roundId,
      txType: "GAMBLE_PAYOUT",
      amount: payout,
    });
    if (credit.status !== "SUCCESS") throw new GambleError("PAYOUT_FAILED");
    const closed = attempt >= row.max_attempts;
    run(
      `UPDATE gamble_sessions SET current_amount=?, attempts_used=?, history_json=?, status=?, updated_at=? WHERE round_id=?`,
      [payout, attempt, JSON.stringify(history), closed ? "CLOSED" : "OPEN", now, roundId],
    );
    return { ...gambleState(playerId, roundId), result: "WIN", card: suit, balance: getBalance(playerId) };
  }

  run(
    `UPDATE gamble_sessions SET current_amount=0, attempts_used=?, history_json=?, status='LOST', updated_at=? WHERE round_id=?`,
    [attempt, JSON.stringify(history), now, roundId],
  );
  return { ...gambleState(playerId, roundId), result: "LOSE", card: suit, balance: getBalance(playerId) };
}

/** Naplata: novac je vec u walletu — samo zatvori sesiju. */
export function gambleCollect(playerId: string, roundId: string): GambleState {
  const row = get<any>(`SELECT * FROM gamble_sessions WHERE round_id=? AND player_id=?`, [roundId, playerId]);
  if (!row) throw new GambleError("SESSION_NOT_FOUND");
  if (row.status === "OPEN") {
    run(`UPDATE gamble_sessions SET status='CLOSED', updated_at=? WHERE round_id=?`, [nowIso(), roundId]);
  }
  return gambleState(playerId, roundId);
}
