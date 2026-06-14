import { db, run, all, nowIso } from "./db.ts";
import { rebuildFromHistory as rebuildGameStats } from "./services/gameStats.ts";

/**
 * Lagane migracije za POSTOJECE baze (schema.sql pokriva nove).
 * - Dodaje brojace u hodu na `jackpots` (total_contributions/total_payouts) i
 *   jednokratno ih puni iz istorije.
 * - Puni `game_stats` iz istorije ako je prazan.
 */
function hasColumn(table: string, column: string): boolean {
  const cols = all<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

export function migrate(): void {
  const now = nowIso();

  // players.operator_user_id (veza ka kladionici za transfer most).
  if (!hasColumn("players", "operator_user_id")) {
    db.exec(`ALTER TABLE players ADD COLUMN operator_user_id TEXT`);
  }

  // jackpots.total_contributions
  if (!hasColumn("jackpots", "total_contributions")) {
    db.exec(`ALTER TABLE jackpots ADD COLUMN total_contributions REAL NOT NULL DEFAULT 0`);
    const rows = all<{ jackpot_id: string; total: number }>(
      `SELECT jackpot_id, COALESCE(SUM(amount),0) AS total FROM jackpot_contributions WHERE status='APPLIED' GROUP BY jackpot_id`,
    );
    for (const r of rows) run(`UPDATE jackpots SET total_contributions=?, updated_at=? WHERE jackpot_id=?`, [r.total, now, r.jackpot_id]);
  }

  // jackpots.total_payouts
  if (!hasColumn("jackpots", "total_payouts")) {
    db.exec(`ALTER TABLE jackpots ADD COLUMN total_payouts REAL NOT NULL DEFAULT 0`);
    const rows = all<{ jackpot_id: string; total: number }>(
      `SELECT jackpot_id, COALESCE(SUM(amount),0) AS total FROM jackpot_wins WHERE status='CREDITED' GROUP BY jackpot_id`,
    );
    for (const r of rows) run(`UPDATE jackpots SET total_payouts=?, updated_at=? WHERE jackpot_id=?`, [r.total, now, r.jackpot_id]);
  }

  // jackpot_contributions.split_json (1 zbirni red po spinu, raspodela u JSON-u).
  if (!hasColumn("jackpot_contributions", "split_json")) {
    db.exec(`ALTER TABLE jackpot_contributions ADD COLUMN split_json TEXT`);
  }

  // blazing40 -> hot40 engine (puna obrada igre); postojeca baza ima stari config.
  const b40 = all<{ config_json: string }>(`SELECT config_json FROM casino_games WHERE game_id='blazing40'`)[0];
  if (b40) {
    let cfg: any = {};
    try { cfg = JSON.parse(b40.config_json || "{}"); } catch { /* korumpiran config -> prepisi */ }
    if (cfg.engine !== "hot40") {
      cfg.engine = "hot40";
      cfg.slot = { reels: 5, rows: 4, lines: 40 };
      cfg.bets = [0.4, 0.52, 0.6, 0.72, 0.8, 0.92, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000];
      run(`UPDATE casino_games SET config_json=?, min_bet=0.4, max_bet=1000 WHERE game_id='blazing40'`, [JSON.stringify(cfg)]);
    }
    // Ujednaceno ime igre (lobi + in-game logo).
    run(`UPDATE casino_games SET name='40 Blazing Hot' WHERE game_id='blazing40' AND name<>'40 Blazing Hot'`);
  }

  // game_stats: rebuild iz istorije (izvor istine) na svakom startu.
  rebuildGameStats();
}
