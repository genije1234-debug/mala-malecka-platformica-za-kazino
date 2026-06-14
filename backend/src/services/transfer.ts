import { get, run, tx, nowIso } from "../db.ts";
import { uid, money } from "../util.ts";
import { config } from "../config.ts";
import { ensureWallet, getBalance } from "./wallet.ts";
import { operatorWithdrawAll, operatorDeposit, operatorBalance } from "./operator.ts";

/**
 * Transfer most kazino <-> kladionica.
 *
 * Kladionica je izvor istine za novac. Lokalni mock_wallet_balances je samo
 * "radna kopija" novca koji je trenutno u kazinu. Spinovi rade nad lokalnim
 * balansom (brzo, ne opterecuje kladionicu). Novac ulazi/izlazi samo ovde.
 *
 * Oba smera koriste "drain/credit + kompenzacija": ako mrezni poziv ka kladionici
 * padne, lokalno stanje se vrati nazad da ne bi novac "nestao" ni sa jedne strane.
 */

interface TransferResult {
  status: "SUCCESS" | "NO_OPERATOR_LINK" | "DISABLED";
  amount: number;
  balance: number;
  currency: string;
  context?: string;
}

function operatorUserIdFor(playerId: string): string | null {
  const row = get<{ operator_user_id: string | null }>(
    `SELECT operator_user_id FROM players WHERE player_id = ?`,
    [playerId],
  );
  return row?.operator_user_id ?? null;
}

function creditLocal(playerId: string, amount: number, reference: string, kind = "TRANSFER_IN"): number {
  return tx<number>(() => {
    ensureWallet(playerId);
    const wallet = get<{ balance: number }>(`SELECT balance FROM mock_wallet_balances WHERE player_id = ?`, [playerId])!;
    const newBalance = money(wallet.balance + amount);
    run(`UPDATE mock_wallet_balances SET balance=?, updated_at=? WHERE player_id=?`, [newBalance, nowIso(), playerId]);
    run(
      `INSERT INTO mock_wallet_ledger (ledger_id, player_id, amount, tx_type, reference, created_at) VALUES (?,?,?,?,?,?)`,
      [uid("led"), playerId, amount, kind, reference, nowIso()],
    );
    return newBalance;
  });
}

/** Atomicno isprazni lokalni balans i vrati iznos koji je drenovan. */
function drainLocal(playerId: string, reference: string): number {
  return tx<number>(() => {
    ensureWallet(playerId);
    const wallet = get<{ balance: number }>(`SELECT balance FROM mock_wallet_balances WHERE player_id = ?`, [playerId])!;
    const amount = money(wallet.balance);
    if (amount <= 0) return 0;
    run(`UPDATE mock_wallet_balances SET balance=0, updated_at=? WHERE player_id=?`, [nowIso(), playerId]);
    run(
      `INSERT INTO mock_wallet_ledger (ledger_id, player_id, amount, tx_type, reference, created_at) VALUES (?,?,?,?,?,?)`,
      [uid("led"), playerId, -amount, "TRANSFER_OUT", reference, nowIso()],
    );
    return amount;
  });
}

/** Ulaz u kazino: povuci ceo balans iz kladionice u lokalni wallet. */
export async function transferIn(playerId: string): Promise<TransferResult> {
  if (!config.operatorWalletEnabled) {
    return { status: "DISABLED", amount: 0, balance: getBalance(playerId), currency: config.currency };
  }
  const operatorUserId = operatorUserIdFor(playerId);
  if (!operatorUserId) {
    return { status: "NO_OPERATOR_LINK", amount: 0, balance: getBalance(playerId), currency: config.currency };
  }

  const key = `in:${playerId}:${Date.now()}:${uid("k")}`;
  const resp = await operatorWithdrawAll(operatorUserId, key);
  const amount = money(Number(resp.amount ?? 0));

  if (amount > 0) {
    try {
      creditLocal(playerId, amount, key);
    } catch (e) {
      // Lokalni upis pao posle skidanja na kladionici -> vrati novac nazad.
      await operatorDeposit(operatorUserId, amount, `${key}:compensate`, false).catch(() => {});
      throw e;
    }
  }

  return {
    status: "SUCCESS",
    amount,
    balance: getBalance(playerId),
    currency: config.currency,
    context: String(resp.context ?? "kazino"),
  };
}

/**
 * Pokupi isplatu koja je stigla na kladionicki balans DOK je igrac u kazinu.
 * Kad se stari tiket zavrsi kao dobitan, kladionica kreditira balans (a gard ne da da se
 * kladi jer je kontekst 'kazino'); ovaj sweep prebaci taj iznos u kazino balans i ostavi
 * notifikaciju za pop-up. Bezbedno da se zove periodicno: ako nema nista, vrati swept=0.
 */
export async function sweepPayouts(playerId: string): Promise<TransferResult & { swept: number }> {
  if (!config.operatorWalletEnabled) {
    return { status: "DISABLED", amount: 0, swept: 0, balance: getBalance(playerId), currency: config.currency };
  }
  const operatorUserId = operatorUserIdFor(playerId);
  if (!operatorUserId) {
    return { status: "NO_OPERATOR_LINK", amount: 0, swept: 0, balance: getBalance(playerId), currency: config.currency };
  }

  // Cheap read first (no row lock): the routine poll only does a balance GET. The expensive
  // draining withdraw-all runs ONLY when a payout actually landed -> minimal load on the
  // sportsbook even with many active casino players polling.
  const peek = await operatorBalance(operatorUserId);
  if (Number(peek.balance ?? 0) <= 0) {
    return { status: "SUCCESS", amount: 0, swept: 0, balance: getBalance(playerId), currency: config.currency, context: String(peek.context ?? "kazino") };
  }

  const key = `sweep:${playerId}:${Date.now()}:${uid("k")}`;
  const resp = await operatorWithdrawAll(operatorUserId, key);
  const amount = money(Number(resp.amount ?? 0));

  if (amount > 0) {
    try {
      creditLocal(playerId, amount, key, "PAYOUT_SWEEP");
    } catch (e) {
      await operatorDeposit(operatorUserId, amount, `${key}:compensate`, false).catch(() => {});
      throw e;
    }
    // Pop-up notifikacija: stigla sredstva sa kladionice dok je igrac u kazinu.
    run(
      `INSERT INTO notifications (notification_id, player_id, type, title, body, read, created_at) VALUES (?,?,?,?,?,0,?)`,
      [
        uid("ntf"),
        playerId,
        "OPERATOR_PAYOUT",
        "Isplata sa kladionice",
        `Stigla je isplata tiketa: +${amount} ${config.currency}. Sredstva su dodata na kazino balans.`,
        nowIso(),
      ],
    );
  }

  return {
    status: "SUCCESS",
    amount,
    swept: amount,
    balance: getBalance(playerId),
    currency: config.currency,
    context: String(resp.context ?? "kazino"),
  };
}

/** Izlaz iz kazina: vrati ceo lokalni balans na kladionicki nalog. */
export async function transferOut(playerId: string): Promise<TransferResult> {
  if (!config.operatorWalletEnabled) {
    return { status: "DISABLED", amount: 0, balance: getBalance(playerId), currency: config.currency };
  }
  const operatorUserId = operatorUserIdFor(playerId);
  if (!operatorUserId) {
    return { status: "NO_OPERATOR_LINK", amount: 0, balance: getBalance(playerId), currency: config.currency };
  }

  const key = `out:${playerId}:${Date.now()}:${uid("k")}`;
  const amount = drainLocal(playerId, key);

  try {
    const resp = await operatorDeposit(operatorUserId, amount, key, true);
    return {
      status: "SUCCESS",
      amount,
      balance: getBalance(playerId),
      currency: config.currency,
      context: String(resp.context ?? "kladionica"),
    };
  } catch (e) {
    // Kladionica nije primila novac -> vrati ga u lokalni wallet (kompenzacija).
    if (amount > 0) creditLocal(playerId, amount, `${key}:rollback`);
    throw e;
  }
}
