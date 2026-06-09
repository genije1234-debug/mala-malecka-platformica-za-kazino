import { get, run, nowIso } from "../db.ts";
import { config } from "../config.ts";
import { money } from "../util.ts";

/**
 * HOUSE GOVERNOR.
 * Tvrda garancija da ukupna isplata igracima NIKAD ne predje ciljani RTP
 * (config.defaultTargetRtp, npr. 95%) u odnosu na ukupan REALAN ulog.
 *
 * Steering (mozak) i dalje vodi svakog igraca po njegovoj krivi, ali ovo je
 * krajnji "plafon" na nivou kuce: zbir svih dobitaka (bazni + freebet) je
 * ogranicen na budzet = target * total_staked - total_returned. Jackpot
 * isplate se NE seku (pool-fundirane su), ali se racunaju u isplate, pa se
 * bazni dobici automatski zategnu da total ostane <= target.
 */

function ensure(): void {
  const r = get<{ id: number }>(`SELECT id FROM house_ledger WHERE id = 1`);
  if (!r) run(`INSERT INTO house_ledger (id, total_staked, total_returned, updated_at) VALUES (1, 0, 0, ?)`, [nowIso()]);
}

/** Realan ulog ulazi u budzet (samo REAL novac, ne freebet stake). */
export function recordStake(amount: number): void {
  if (!(amount > 0)) return;
  ensure();
  run(`UPDATE house_ledger SET total_staked = total_staked + ?, updated_at = ? WHERE id = 1`, [amount, nowIso()]);
}

/** Svaka isplata igracu (bazni dobitak, freebet dobitak, jackpot) smanjuje budzet. */
export function recordReturn(amount: number): void {
  if (!(amount > 0)) return;
  ensure();
  run(`UPDATE house_ledger SET total_returned = total_returned + ?, updated_at = ? WHERE id = 1`, [amount, nowIso()]);
}

/** Koliko jos kuca SME da isplati a da ne predje ciljani RTP. */
export function houseBudget(): number {
  ensure();
  const r = get<{ s: number; t: number }>(`SELECT total_staked AS s, total_returned AS t FROM house_ledger WHERE id = 1`)!;
  return money(config.defaultTargetRtp * r.s - r.t);
}

/**
 * Odseca predlozeni dobitak na raspolozivi budzet kuce.
 * Vraca koliko sme da se isplati (>= 0) i da li je odsecanje primenjeno.
 */
export function capWin(intended: number): { paid: number; capped: boolean } {
  if (!(intended > 0)) return { paid: 0, capped: false };
  const budget = Math.max(0, houseBudget());
  if (intended > budget) return { paid: money(budget), capped: true };
  return { paid: money(intended), capped: false };
}

export function houseStats(): { staked: number; returned: number; rtp: number; budget: number } {
  ensure();
  const r = get<{ s: number; t: number }>(`SELECT total_staked AS s, total_returned AS t FROM house_ledger WHERE id = 1`)!;
  return { staked: r.s, returned: r.t, rtp: r.s > 0 ? r.t / r.s : 0, budget: houseBudget() };
}

/** Reset budzeta (poziva se iz resetState). */
export function resetLedger(): void {
  ensure();
  run(`UPDATE house_ledger SET total_staked = 0, total_returned = 0, updated_at = ? WHERE id = 1`, [nowIso()]);
}
