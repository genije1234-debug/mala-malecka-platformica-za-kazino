import { get, run, tx, nowIso } from "../db.ts";
import { uid, money } from "../util.ts";
import type { WalletTxType } from "@casino/shared";
import { config } from "../config.ts";

export interface WalletResult {
  status: "SUCCESS" | "INSUFFICIENT_FUNDS" | "FAILED";
  walletReference?: string;
  balance: number;
  cached: boolean;
}

/** Predznak promene balansa po tipu transakcije. */
function delta(txType: WalletTxType, amount: number): number {
  switch (txType) {
    case "BET_DEBIT":
    case "GAMBLE_STAKE":
      return -amount;
    case "WIN_CREDIT":
    case "JACKPOT_CREDIT":
    case "REFUND":
    case "ROLLBACK":
    case "DEPOSIT":
    case "OPERATOR_FUNDED_SEED":
    case "GAMBLE_PAYOUT":
      return amount;
    case "CORRECTION":
      return amount; // amount moze biti negativan
    default:
      return 0;
  }
}

export function ensureWallet(playerId: string, starting = config.startingWalletBalance): void {
  const existing = get(`SELECT player_id FROM mock_wallet_balances WHERE player_id = ?`, [playerId]);
  if (!existing) {
    run(`INSERT INTO mock_wallet_balances (player_id, balance, currency, updated_at) VALUES (?,?,?,?)`, [
      playerId,
      starting,
      config.currency,
      nowIso(),
    ]);
  }
}

export function getBalance(playerId: string): number {
  const row = get<{ balance: number }>(`SELECT balance FROM mock_wallet_balances WHERE player_id = ?`, [playerId]);
  return row ? money(row.balance) : 0;
}

/**
 * Jedina tacka kroz koju casino menja balans. Idempotentno preko
 * wallet_connector_idempotency_log (UNIQUE(idempotency_key)).
 */
export function walletOp(params: {
  idempotencyKey: string;
  playerId: string;
  roundId?: string;
  txType: WalletTxType;
  amount: number;
}): WalletResult {
  const { idempotencyKey, playerId, roundId, txType } = params;
  const amount = money(params.amount);

  return tx<WalletResult>(() => {
    // 1) Idempotentno ubaci PENDING zapis; ako vec postoji -> duplikat.
    const ins = run(
      `INSERT OR IGNORE INTO wallet_connector_idempotency_log
        (idempotency_key, player_id, round_id, tx_type, amount, status, created_at, updated_at)
       VALUES (?,?,?,?,?, 'PENDING', ?, ?)`,
      [idempotencyKey, playerId, roundId ?? null, txType, amount, nowIso(), nowIso()],
    );

    if (ins.changes === 0) {
      // Vec postoji -> vrati kesirani rezultat (isti idempotency_key = ista operacija).
      const existing = get<any>(`SELECT * FROM wallet_connector_idempotency_log WHERE idempotency_key = ?`, [
        idempotencyKey,
      ]);
      if (existing?.status === "SUCCESS") {
        const resp = existing.response_json ? JSON.parse(existing.response_json) : {};
        return { status: "SUCCESS", walletReference: existing.wallet_reference, balance: resp.balance ?? getBalance(playerId), cached: true };
      }
      // PENDING/FAILED leftover (u praksi se ne desava jer je sve u jednoj tx) -> nastavi i pokusaj.
    }

    // 2) Primeni promenu balansa.
    ensureWallet(playerId);
    const wallet = get<{ balance: number }>(`SELECT balance FROM mock_wallet_balances WHERE player_id = ?`, [playerId])!;
    const d = delta(txType, amount);
    const newBalance = money(wallet.balance + d);

    if (newBalance < 0) {
      run(`UPDATE wallet_connector_idempotency_log SET status='FAILED', updated_at=? WHERE idempotency_key=?`, [
        nowIso(),
        idempotencyKey,
      ]);
      return { status: "INSUFFICIENT_FUNDS", balance: money(wallet.balance), cached: false };
    }

    run(`UPDATE mock_wallet_balances SET balance=?, updated_at=? WHERE player_id=?`, [newBalance, nowIso(), playerId]);
    run(`INSERT INTO mock_wallet_ledger (ledger_id, player_id, amount, tx_type, reference, created_at) VALUES (?,?,?,?,?,?)`, [
      uid("led"),
      playerId,
      d,
      txType,
      idempotencyKey,
      nowIso(),
    ]);

    const walletReference = uid("wref");
    const response = { balance: newBalance };
    run(
      `UPDATE wallet_connector_idempotency_log
       SET status='SUCCESS', wallet_reference=?, response_json=?, updated_at=? WHERE idempotency_key=?`,
      [walletReference, JSON.stringify(response), nowIso(), idempotencyKey],
    );

    // Casino-side ledger (za reconciliation).
    run(
      `INSERT INTO casino_transactions (transaction_id, idempotency_key, round_id, player_id, tx_type, amount, currency, status, created_at)
       VALUES (?,?,?,?,?,?,?, 'SUCCESS', ?)`,
      [uid("ctx"), idempotencyKey, roundId ?? null, playerId, txType, d, config.currency, nowIso()],
    );

    return { status: "SUCCESS", walletReference, balance: newBalance, cached: false };
  });
}

/** Operator-funded seed: ubacuje novac u jackpot seed (evidentirano). */
export function fundOperatorSeed(jackpotId: string, amount: number): void {
  run(
    `INSERT INTO jackpot_seed_funding (seed_funding_id, jackpot_id, amount, funding_source, created_by, created_at)
     VALUES (?,?,?, 'OPERATOR_FUNDED', 'system', ?)`,
    [uid("seed"), jackpotId, money(amount), nowIso()],
  );
}
