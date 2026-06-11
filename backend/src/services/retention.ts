import { run } from "../db.ts";
import { config } from "../config.ts";

/**
 * RETENTION (cistacica baze).
 * Logovi/papirologija rastu sa svakim spinom i niko ih posle ne cita — brisemo
 * sve starije od config.retentionDays. Zavrsene runde (istorija igranja) cuvamo
 * duze (roundsRetentionDays). KPI brojke ostaju tacne zauvek jer zive u
 * brojacima (game_stats, house_ledger, jackpots.total_*), ne u ovim tabelama.
 *
 * Brisanje ide u manjim paketima da ne drzi pisacu bravu predugo (botovi igraju
 * paralelno). Stari redovi su na pocetku tabele (rowid raste sa upisom), pa je
 * pronalazenje paketa jeftino i bez dodatnih indeksa.
 */

// Manji paketi: svaki DELETE drzi pisacu bravu krace, pa spinovi igraca ne
// cekaju (veliki paketi su pravili "prekid veze" tokom ciscenja).
const BATCH = 800;
const MAX_BATCHES_PER_TICK = 4; // po tabeli po otkucaju — ostatak stize sledeci put

const LOG_TABLES = [
  "casino_round_events",
  "jackpot_contributions",
  "contribution_refund_log",
  "casino_rng_logs",
  "player_events",
  "event_outbox",
  "casino_transactions",
  "mock_wallet_ledger",
  "wallet_connector_idempotency_log",
  "recovery_attempts",
  "notifications",
];

function purgeBatched(table: string, where: string, params: unknown[]): number {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
    const res = run(
      `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${BATCH})`,
      params,
    );
    total += res.changes;
    if (res.changes < BATCH) break;
  }
  return total;
}

/** Jedan otkucaj cistacice; vraca koliko je redova obrisano (za log). */
export function retentionTick(): number {
  const logCutoff = new Date(Date.now() - config.retentionDays * 86400_000).toISOString();
  const roundsCutoff = new Date(Date.now() - config.roundsRetentionDays * 86400_000).toISOString();

  let deleted = 0;
  for (const t of LOG_TABLES) {
    deleted += purgeBatched(t, `created_at < ?`, [logCutoff]);
  }
  // Runde: samo zavrsene (terminalni statusi) — otvorene/sporne ne diramo.
  deleted += purgeBatched(
    "casino_rounds",
    `created_at < ? AND status IN ('CLOSED','FAILED','ROLLED_BACK')`,
    [roundsCutoff],
  );
  return deleted;
}
