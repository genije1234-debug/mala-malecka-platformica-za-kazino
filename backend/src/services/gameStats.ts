import { get, run, all, nowIso } from "../db.ts";
import { money } from "../util.ts";

/**
 * BROJACI U HODU po igri.
 * Umesto da back office svake 4s skenira celu `casino_rounds` (desetine hiljada
 * redova), drzimo male agregate (1 red po igri) koji se uvecavaju posle svake
 * zatvorene REAL runde. KPI tada citaju ~30 redova, nezavisno od velicine baze.
 */

/** Posle zatvorene REAL runde: uvecaj brojace za tu igru. */
export function recordRoundStat(gameId: string, bet: number, win: number): void {
  run(
    `INSERT INTO game_stats (game_id, rounds, total_bet, total_win, max_win, updated_at)
     VALUES (?, 1, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET
       rounds = rounds + 1,
       total_bet = total_bet + excluded.total_bet,
       total_win = total_win + excluded.total_win,
       max_win = MAX(max_win, excluded.max_win),
       updated_at = excluded.updated_at`,
    [gameId, bet, win, win, nowIso()],
  );
}

/** Ukupni agregati (saberi ~30 redova game_stats). */
export function totalStats(): { rounds: number; bet: number; win: number } {
  const r = get<{ rounds: number; bet: number; win: number }>(
    `SELECT COALESCE(SUM(rounds),0) AS rounds, COALESCE(SUM(total_bet),0) AS bet, COALESCE(SUM(total_win),0) AS win FROM game_stats`,
  )!;
  return { rounds: r.rounds || 0, bet: r.bet || 0, win: r.win || 0 };
}

/** Po igri (spoj sa katalogom igara). */
export function perGameStats(): any[] {
  return all<any>(
    `SELECT g.game_id, g.name, g.game_type,
            COALESCE(s.rounds,0) AS rounds,
            COALESCE(s.total_bet,0) AS total_bet,
            COALESCE(s.total_win,0) AS total_win,
            COALESCE(s.max_win,0) AS max_win
     FROM casino_games g LEFT JOIN game_stats s ON s.game_id = g.game_id
     ORDER BY rounds DESC`,
  );
}

/** Reset (poziva se iz resetState). */
export function resetGameStats(): void {
  run(`DELETE FROM game_stats`);
}

/**
 * Rebuild brojaca iz `casino_rounds` (izvor istine). Poziva se na startu:
 * tacno i samolecivo (ne zavisi od toga da li je tabela prazna). Jednokratni
 * skn na butu je jeftin; runtime onda cita samo agregat.
 */
export function rebuildFromHistory(): void {
  const rows = all<any>(
    `SELECT game_id,
            COUNT(*) AS rounds,
            COALESCE(SUM(bet_amount),0) AS total_bet,
            COALESCE(SUM(final_win_amount),0) AS total_win,
            COALESCE(MAX(final_win_amount),0) AS max_win
     FROM casino_rounds WHERE mode='REAL' GROUP BY game_id`,
  );
  const now = nowIso();
  run(`DELETE FROM game_stats`);
  for (const r of rows) {
    run(
      `INSERT INTO game_stats (game_id, rounds, total_bet, total_win, max_win, updated_at)
       VALUES (?,?,?,?,?,?)`,
      [r.game_id, r.rounds, money(r.total_bet), money(r.total_win), money(r.max_win), now],
    );
  }
}
