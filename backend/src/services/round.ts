import { get, run, nowIso } from "../db.ts";
import { uid } from "../util.ts";
import type { RoundStatus } from "@casino/shared";

/**
 * Zaseban event-red se pise SAMO za problematicne tranzicije (audit/istraga).
 * Normalan tok zivi u casino_rounds.status — 8 event-redova po rundi je bilo
 * glavno punjenje baze (write amplification), a niko ih nije citao.
 */
const LOGGED_STATUSES = new Set<string>([
  "FAILED",
  "DEBIT_UNKNOWN",
  "MANUAL_REVIEW",
  "WIN_CALCULATED_EXPIRED",
  "ROLLED_BACK",
  "MAX_WIN_APPLIED",
  "JACKPOT_CREDITED",
]);

export function createRound(params: {
  roundId: string;
  playerId: string;
  gameId: string;
  sessionId?: string | null;
  mode: string;
  betAmount: number;
  currency: string;
  gameVersion?: string;
  mathConfigVersion?: string;
  payoutTableVersion?: string;
}): void {
  run(
    `INSERT INTO casino_rounds
      (round_id, player_id, game_id, session_id, mode, currency, bet_amount, status,
       game_version, math_config_version, payout_table_version, created_at, last_heartbeat_at)
     VALUES (?,?,?,?,?,?,?, 'CREATED', ?,?,?,?,?)`,
    [
      params.roundId,
      params.playerId,
      params.gameId,
      params.sessionId ?? null,
      params.mode,
      params.currency,
      params.betAmount,
      params.gameVersion ?? null,
      params.mathConfigVersion ?? null,
      params.payoutTableVersion ?? null,
      nowIso(),
      nowIso(),
    ],
  );
}

export function addEvent(roundId: string, oldStatus: string | null, newStatus: string, detail?: string): void {
  if (!LOGGED_STATUSES.has(newStatus)) return;
  run(
    `INSERT INTO casino_round_events (event_id, round_id, old_status, new_status, detail, created_at) VALUES (?,?,?,?,?,?)`,
    [uid("rev"), roundId, oldStatus, newStatus, detail ?? null, nowIso()],
  );
}

/**
 * Status tranzicija uvek sa WHERE old_status = expected (zastita od race-a
 * izmedju normalnog flow-a i recovery workera). Vraca true ako je promenila red.
 */
export function transition(
  roundId: string,
  expected: RoundStatus,
  next: RoundStatus,
  detail?: string,
): boolean {
  const res = run(
    `UPDATE casino_rounds SET status = ?, last_heartbeat_at = ? WHERE round_id = ? AND status = ?`,
    [next, nowIso(), roundId, expected],
  );
  if (res.changes === 1) {
    addEvent(roundId, expected, next, detail);
    return true;
  }
  return false;
}

/** Bezuslovna promena (kad smo sigurni da smo vlasnici runde). */
export function setStatus(roundId: string, next: RoundStatus, detail?: string): void {
  // Stari status citamo samo ako ce event uopste biti zapisan.
  const cur = LOGGED_STATUSES.has(next)
    ? get<{ status: string }>(`SELECT status FROM casino_rounds WHERE round_id = ?`, [roundId])
    : undefined;
  run(`UPDATE casino_rounds SET status = ?, last_heartbeat_at = ? WHERE round_id = ?`, [next, nowIso(), roundId]);
  addEvent(roundId, cur?.status ?? null, next, detail);
}

export function setExpectedNext(roundId: string, expectedNext: RoundStatus, deadlineSec: number): void {
  run(`UPDATE casino_rounds SET expected_next_status = ?, expected_next_status_deadline = ? WHERE round_id = ?`, [
    expectedNext,
    new Date(Date.now() + deadlineSec * 1000).toISOString(),
    roundId,
  ]);
}

export function getRound(roundId: string): any {
  return get<any>(`SELECT * FROM casino_rounds WHERE round_id = ?`, [roundId]);
}
