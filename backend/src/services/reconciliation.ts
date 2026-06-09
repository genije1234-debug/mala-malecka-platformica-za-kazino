import { all, get, run, nowIso } from "../db.ts";
import { uid, money } from "../util.ts";
import { emitEvent } from "./audit.ts";

/**
 * Dnevna reconciliation: poredi casino transakcije sa wallet ledgerom.
 * Svaki casino tx mora imati odgovarajuci wallet zapis (po idempotency_key).
 */
export function runReconciliation(): {
  checked: number;
  mismatches: number;
  casino_total: number;
  wallet_total: number;
} {
  const casinoTx = all<any>(`SELECT * FROM casino_transactions WHERE status='SUCCESS'`);
  let mismatches = 0;

  for (const tx of casinoTx) {
    const ledger = get<any>(`SELECT * FROM mock_wallet_ledger WHERE reference=?`, [tx.idempotency_key]);
    if (!ledger) {
      mismatches++;
      const exists = get<any>(`SELECT issue_id FROM reconciliation_issues WHERE transaction_id=?`, [tx.transaction_id]);
      if (!exists) {
        run(
          `INSERT INTO reconciliation_issues (issue_id, round_id, transaction_id, type, detail, status, created_at)
           VALUES (?,?,?, 'MISSING_IN_WALLET', ?, 'OPEN', ?)`,
          [uid("rci"), tx.round_id, tx.transaction_id, `No wallet ledger for ${tx.idempotency_key}`, nowIso()],
        );
        emitEvent({ type: "RECONCILIATION_MISMATCH", entityId: tx.transaction_id, priority: 100 });
      }
    }
  }

  const casinoTotal = casinoTx.reduce((s, t) => s + t.amount, 0);
  const walletTotal =
    get<{ t: number }>(`SELECT COALESCE(SUM(amount),0) AS t FROM mock_wallet_ledger`)?.t ?? 0;

  return {
    checked: casinoTx.length,
    mismatches,
    casino_total: money(casinoTotal),
    wallet_total: money(walletTotal),
  };
}
