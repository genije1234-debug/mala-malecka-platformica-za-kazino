import { get, run, all, nowIso } from "../db.ts";
import { uid, clamp, money } from "../util.ts";

export function trackEvent(params: {
  playerId: string;
  sessionId?: string;
  type: string;
  gameId?: string;
  amount?: number;
  meta?: unknown;
}): void {
  run(
    `INSERT INTO player_events (event_id, player_id, session_id, event_type, game_id, amount, meta_json, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      uid("pev"),
      params.playerId,
      params.sessionId ?? null,
      params.type,
      params.gameId ?? null,
      params.amount ?? null,
      params.meta != null ? JSON.stringify(params.meta) : null,
      nowIso(),
    ],
  );
}

function ensureMetrics(playerId: string): any {
  let m = get<any>(`SELECT * FROM player_behavior_metrics WHERE player_id = ?`, [playerId]);
  if (!m) {
    run(`INSERT INTO player_behavior_metrics (player_id, updated_at) VALUES (?, ?)`, [playerId, nowIso()]);
    m = get<any>(`SELECT * FROM player_behavior_metrics WHERE player_id = ?`, [playerId]);
  }
  return m;
}

/** Inkrementalno azurira metrike posle beta (tilt, trend, omiljena igra...). */
export function updateBehaviorOnBet(playerId: string, gameId: string, bet: number, won: boolean): void {
  const m = ensureMetrics(playerId);
  const totalRounds = m.total_rounds + 1;
  const avgBet = (m.avg_bet * m.total_rounds + bet) / totalRounds;

  let trend = "FLAT";
  if (bet > m.last_bet * 1.15) trend = "UP";
  else if (bet < m.last_bet * 0.85) trend = "DOWN";

  // Tilt: dizanje uloga posle gubitka je signal.
  let tilt = m.tilt_score;
  const lastEvents = all<any>(
    `SELECT event_type FROM player_events WHERE player_id = ? AND event_type IN ('WIN','LOSS') ORDER BY created_at DESC LIMIT 1`,
    [playerId],
  );
  const lastWasLoss = lastEvents[0]?.event_type === "LOSS";
  if (lastWasLoss && trend === "UP") tilt = clamp(tilt + 0.15, 0, 1);
  else tilt = clamp(tilt - 0.03, 0, 1);

  // Omiljena igra = najcesca u poslednjih 200 betova (OGRANICENO na 200 — bez
  // limita je ovo skeniralo CELU istoriju igraca na svakom spinu).
  const favRow = get<{ game_id: string }>(
    `SELECT game_id FROM (
       SELECT game_id FROM player_events
       WHERE player_id = ? AND event_type='BET' AND game_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 200
     ) GROUP BY game_id ORDER BY COUNT(*) DESC LIMIT 1`,
    [playerId],
  );

  run(
    `UPDATE player_behavior_metrics
     SET total_rounds=?, avg_bet=?, last_bet=?, bet_trend=?, favorite_game=?, tilt_score=?, updated_at=?
     WHERE player_id=?`,
    [totalRounds, money(avgBet), bet, trend, favRow?.game_id ?? m.favorite_game, tilt, nowIso(), playerId],
  );
}

/** Racuna medijanu razmaka izmedju sesija (za AI free-bet timing) i churn rizik. */
export function recomputeSessionMetrics(playerId: string): void {
  const sessions = all<{ created_at: string }>(
    `SELECT created_at FROM casino_sessions WHERE player_id = ? ORDER BY created_at ASC`,
    [playerId],
  );
  ensureMetrics(playerId);
  if (sessions.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sessions.length; i++) {
      gaps.push((new Date(sessions[i].created_at).getTime() - new Date(sessions[i - 1].created_at).getTime()) / 1000);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    run(`UPDATE player_behavior_metrics SET median_session_gap_sec=?, total_sessions=?, updated_at=? WHERE player_id=?`, [
      median,
      sessions.length,
      nowIso(),
      playerId,
    ]);
  } else {
    run(`UPDATE player_behavior_metrics SET total_sessions=?, updated_at=? WHERE player_id=?`, [
      sessions.length,
      nowIso(),
      playerId,
    ]);
  }
  const last = get<{ c: string }>(`SELECT MAX(created_at) AS c FROM player_events WHERE player_id = ?`, [playerId]);
  if (last?.c) run(`UPDATE player_behavior_metrics SET last_session_at=? WHERE player_id=?`, [last.c, playerId]);
}

export function getBehavior(playerId: string): any {
  return ensureMetrics(playerId);
}
