import { get, run, nowIso } from "../db.ts";
import { uid, money } from "../util.ts";
import { config } from "../config.ts";
import { audit } from "./audit.ts";
import { trackEvent } from "./behavior.ts";

function ensureWallet(playerId: string): any {
  let w = get<any>(`SELECT * FROM player_freebet_wallet WHERE player_id=?`, [playerId]);
  if (!w) {
    run(`INSERT INTO player_freebet_wallet (player_id, balance, granted_balance, updated_at) VALUES (?,0,0,?)`, [
      playerId,
      nowIso(),
    ]);
    w = get<any>(`SELECT * FROM player_freebet_wallet WHERE player_id=?`, [playerId]);
  }
  return w;
}

/** 1% svakog beta ide u licnu kasicu. */
export function accrue(playerId: string, betAmount: number): void {
  ensureWallet(playerId);
  const add = money(betAmount * config.freebetAccrualPct);
  if (add <= 0) return;
  run(`UPDATE player_freebet_wallet SET balance = balance + ?, updated_at=? WHERE player_id=?`, [add, nowIso(), playerId]);
}

export function getFreebet(playerId: string): { balance: number; granted_balance: number } {
  const w = ensureWallet(playerId);
  return { balance: money(w.balance), granted_balance: money(w.granted_balance) };
}

/**
 * Pretvara akumuliranu kasicu u dodeljen free bet (spreman za igru) i pravi
 * notifikaciju "dobio si free betove". Poziva ga re-engagement worker (AI timing).
 */
export function grantFreebet(playerId: string, reason = "re-engagement"): boolean {
  const w = ensureWallet(playerId);
  const amount = money(w.balance);
  if (amount < config.freebetMinGrant) return false;

  run(`UPDATE player_freebet_wallet SET balance=0, granted_balance = granted_balance + ?, updated_at=? WHERE player_id=?`, [
    amount,
    nowIso(),
    playerId,
  ]);
  run(`INSERT INTO freebet_grants (grant_id, player_id, amount, reason, status, created_at) VALUES (?,?,?,?, 'GRANTED', ?)`, [
    uid("fbg"),
    playerId,
    amount,
    reason,
    nowIso(),
  ]);
  run(
    `INSERT INTO notifications (notification_id, player_id, type, title, body, created_at)
     VALUES (?,?, 'FREEBET', ?, ?, ?)`,
    [
      uid("ntf"),
      playerId,
      "Dobili ste free betove!",
      `Ceka vas ${amount.toFixed(2)} ${config.currency} u free betovima. Vratite se i zaigrajte!`,
      nowIso(),
    ],
  );
  trackEvent({ playerId, type: "FREEBET_GRANT", amount });
  audit({ action: "FREEBET_GRANTED", entityType: "player", entityId: playerId, newValue: { amount, reason } });
  return true;
}

/** Trosi iz dodeljenog free bet-a (stake). Vraca true ako ima dovoljno. */
export function consumeGranted(playerId: string, amount: number): boolean {
  const w = ensureWallet(playerId);
  if (w.granted_balance + 1e-9 < amount) return false;
  run(`UPDATE player_freebet_wallet SET granted_balance = granted_balance - ?, updated_at=? WHERE player_id=?`, [
    money(amount),
    nowIso(),
    playerId,
  ]);
  return true;
}
