import { get, run, nowIso } from "../db.ts";
import { config } from "../config.ts";
import { money, clamp } from "../util.ts";

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

export function houseStats(): { staked: number; returned: number; rtp: number; budget: number; gasActive: boolean } {
  ensure();
  const r = get<{ s: number; t: number }>(`SELECT total_staked AS s, total_returned AS t FROM house_ledger WHERE id = 1`)!;
  const rtp = r.s > 0 ? r.t / r.s : 0;
  // Osvezi histerezu i kad nema poteza (npr. za prikaz u back office-u).
  const gas = r.s > 0 ? updateGas(rtp) : gasActive;
  return { staked: r.s, returned: r.t, rtp, budget: houseBudget(), gasActive: gas };
}

/**
 * "GAS": dvosmerni regulator na UKUPNOM RTP-u.
 * Histereza (u memoriji procesa): pali se kad ukupni RTP padne ispod
 * gasTriggerRtp (91%), gasi se tek kad dostigne gasRecoverRtp (94.5%).
 * Dok je upaljen, vraca dodatak na requestedRtp SAMO za igrace koji su ispod
 * svoje mete (playerNeed > 0), srazmerno potrebi i koliko je kuca ispod mete.
 * Para tako curi postepeno kroz mnogo poteza; tvrdi plafon (95%) i dalje vazi.
 */
let gasActive = false;

/** Histereza: pali na trigger (91%), gasi na recover (94.5%). Vraca novo stanje. */
function updateGas(rtp: number): boolean {
  if (!gasActive && rtp < config.gasTriggerRtp) gasActive = true;
  else if (gasActive && rtp >= config.gasRecoverRtp) gasActive = false;
  return gasActive;
}

export function gasBoost(playerNeed: number): number {
  if (!(playerNeed > 0)) return 0; // gas ide samo igracima u minusu
  ensure();
  const r = get<{ s: number; t: number }>(`SELECT total_staked AS s, total_returned AS t FROM house_ledger WHERE id = 1`)!;
  if (!r || r.s <= 0) return 0;
  const rtp = r.t / r.s;

  if (!updateGas(rtp)) return 0;

  const gap = config.gasRecoverRtp - rtp; // koliko je kuca ispod mete oporavka
  if (gap <= 0) return 0;
  const needScale = clamp(playerNeed / config.gasFullNeed, 0, 1);
  return clamp(gap * config.gasGain * needScale, 0, config.gasMaxBoost);
}

/** Reset budzeta (poziva se iz resetState). */
export function resetLedger(): void {
  ensure();
  run(`UPDATE house_ledger SET total_staked = 0, total_returned = 0, updated_at = ? WHERE id = 1`, [nowIso()]);
  gasActive = false;
}
