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

  // game_stats: rebuild iz istorije (izvor istine) na svakom startu.
  rebuildGameStats();
}
