import { get, all, run, tx, nowIso } from "../db.ts";
import { uid, money, clamp, secureRandom } from "../util.ts";
import { config } from "../config.ts";
import { walletOp } from "./wallet.ts";
import { audit, emitEvent } from "./audit.ts";
import { rtpNeed, recalcCurveAfterJackpot } from "./brain.ts";
import { recordReturn } from "./houseGovernor.ts";
import type { JackpotState, JackpotWinInfo } from "@casino/shared";

export function listJackpots(): JackpotState[] {
  const rows = all<any>(`SELECT * FROM jackpots ORDER BY sort_order ASC`);
  return rows.map(toState);
}

function toState(j: any): JackpotState {
  const span = Math.max(j.upper_bound - j.lower_bound, 0.0001);
  const intensity = clamp((j.current_amount - j.lower_bound) / span, 0, 1);
  const active = j.current_amount >= j.lower_bound && j.status === "ACTIVE";
  return {
    jackpot_id: j.jackpot_id,
    name: j.name,
    tier: j.tier,
    effect: j.effect,
    color: j.color,
    currency: j.currency,
    current_amount: money(j.current_amount),
    seed_amount: j.seed_amount,
    lower_bound: j.lower_bound,
    upper_bound: j.upper_bound,
    active,
    intensity: active ? intensity : 0,
    last_win_at: j.last_win_at,
  };
}

/**
 * AI balanser: deli 2% uplate na 10 jackpotova. Krece podjednako, ali onaj koji
 * se blizi gornjoj granici puni se sporije, a manji (slabije napunjen) brze.
 */
function balancerWeights(jackpots: any[]): number[] {
  return jackpots.map((j) => {
    const span = Math.max(j.upper_bound - j.lower_bound, 0.0001);
    const fill = clamp((j.current_amount - j.lower_bound) / span, 0, 1);
    // sto blizi vrhu (fill->1) to manja tezina; manji (fill nisko/negativno) veca.
    return j.base_weight * (1.1 - 0.9 * Math.max(fill, 0));
  });
}

/**
 * Dodaje doprinos tek POSLE potvrdjenog BET_DEBIT-a.
 * Jackpot pool-ovi se i dalje pune po jackpotu (UPDATE jackpots), ali se u
 * jackpot_contributions pise SAMO 1 zbirni red po spinu (jackpot_id='POOL',
 * tacna raspodela u split_json) umesto 6-7 redova — to je bilo najvece
 * punjenje baze. Refund ostaje tacan jer cita split_json.
 */
export function contribute(playerId: string, gameId: string, roundId: string, betAmount: number): number {
  const total = money(betAmount * config.jackpotContributionTotalPct);
  if (total <= 0) return 0;

  tx(() => {
    const jackpots = all<any>(`SELECT * FROM jackpots WHERE status='ACTIVE' ORDER BY sort_order ASC`);
    if (jackpots.length === 0) return;
    const weights = balancerWeights(jackpots);
    const sum = weights.reduce((s, w) => s + w, 0) || 1;
    const split: Record<string, number> = {};
    jackpots.forEach((j, i) => {
      const part = money(total * (weights[i] / sum));
      if (part <= 0) return;
      split[j.jackpot_id] = part;
      run(`UPDATE jackpots SET current_amount = current_amount + ?, total_contributions = total_contributions + ?, updated_at=? WHERE jackpot_id=?`, [
        part,
        part,
        nowIso(),
        j.jackpot_id,
      ]);
    });
    run(
      `INSERT INTO jackpot_contributions (contribution_id, round_id, player_id, game_id, jackpot_id, amount, status, split_json, created_at)
       VALUES (?,?,?,?, 'POOL', ?, 'APPLIED', ?, ?)`,
      [uid("jc"), roundId, playerId, gameId, total, JSON.stringify(split), nowIso()],
    );
  });
  return total;
}

/** Reverse svih doprinosa runde (kod refund/rollback). */
export function reverseContributions(roundId: string, reason: string): void {
  const contribs = all<any>(`SELECT * FROM jackpot_contributions WHERE round_id=? AND status='APPLIED'`, [roundId]);
  tx(() => {
    for (const c of contribs) {
      // Novi format: 1 zbirni red sa split_json; stari format: red po jackpotu.
      const parts: Array<{ jackpotId: string; amount: number }> =
        c.jackpot_id === "POOL" && c.split_json
          ? Object.entries(JSON.parse(c.split_json) as Record<string, number>).map(([jackpotId, amount]) => ({ jackpotId, amount }))
          : [{ jackpotId: c.jackpot_id, amount: c.amount }];
      for (const p of parts) {
        run(`UPDATE jackpots SET current_amount = current_amount - ?, total_contributions = total_contributions - ?, updated_at=? WHERE jackpot_id=?`, [
          p.amount,
          p.amount,
          nowIso(),
          p.jackpotId,
        ]);
        run(
          `INSERT INTO contribution_refund_log (refund_id, contribution_id, round_id, jackpot_id, amount, reason, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          [uid("crl"), c.contribution_id, roundId, p.jackpotId, p.amount, reason, nowIso()],
        );
      }
      run(`UPDATE jackpot_contributions SET status='REVERSED' WHERE contribution_id=?`, [c.contribution_id]);
    }
  });
}

/** Bira dobitnika: igrac kome najvise treba da se digne RTP (medju skoro aktivnima). */
function pickWinner(triggerPlayerId: string): string {
  const sinceIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const candidates = all<{ player_id: string }>(
    `SELECT DISTINCT player_id FROM casino_sessions WHERE created_at >= ? OR ended_at IS NULL`,
    [sinceIso],
  );
  const ids = new Set(candidates.map((c) => c.player_id));
  ids.add(triggerPlayerId);
  let best = triggerPlayerId;
  let bestNeed = -Infinity;
  for (const id of ids) {
    const need = rtpNeed(id);
    if (need > bestNeed) {
      bestNeed = need;
      best = id;
    }
  }
  return best;
}

/**
 * Posle doprinosa proverava da li neki jackpot pada (must-drop na vrhu ili random
 * pre vrha). Ako padne, dodeljuje dobitniku po RTP potrebi, atomic claim + isplata.
 * Vraca info ako je dobio bas trigger igrac (za prikaz u rezultatu runde).
 */
export function checkAndTrigger(triggerPlayerId: string, roundId: string): JackpotWinInfo | null {
  const jackpots = all<any>(`SELECT * FROM jackpots WHERE status='ACTIVE' ORDER BY upper_bound DESC`);
  for (const j of jackpots) {
    if (j.current_amount < j.lower_bound) continue; // nije ni aktivan
    const span = Math.max(j.upper_bound - j.lower_bound, 0.0001);
    const fill = clamp((j.current_amount - j.lower_bound) / span, 0, 1);
    const mustDrop = j.current_amount >= j.upper_bound;
    const randomDrop = secureRandom() < 0.0008 * fill * fill; // moze pasti i pre vrha
    if (!mustDrop && !randomDrop) continue;

    const winnerId = pickWinner(triggerPlayerId);
    const amount = money(j.current_amount);
    const info = payJackpot(j, winnerId, roundId, amount);
    // Samo jedan jackpot po rundi.
    if (winnerId === triggerPlayerId && info) return { jackpot_id: j.jackpot_id, name: j.name, amount };
    return null;
  }
  return null;
}

/** Atomic claim + wallet credit + reset poola. */
function payJackpot(j: any, winnerId: string, roundId: string, amount: number): boolean {
  const winId = uid("jw");
  // Kreiraj win zapis.
  run(
    `INSERT INTO jackpot_wins (jackpot_win_id, jackpot_id, round_id, player_id, amount, status, created_at)
     VALUES (?,?,?,?,?, 'PENDING', ?)`,
    [winId, j.jackpot_id, roundId, winnerId, amount, nowIso()],
  );

  // Atomic claim: PENDING -> CREDIT_PENDING (zastita od duple isplate).
  const claim = run(`UPDATE jackpot_wins SET status='CREDIT_PENDING' WHERE jackpot_win_id=? AND status='PENDING'`, [
    winId,
  ]);
  if (claim.changes !== 1) return false;

  const idemKey = `JACKPOT:${winId}`;
  const res = walletOp({
    idempotencyKey: idemKey,
    playerId: winnerId,
    roundId,
    txType: "JACKPOT_CREDIT",
    amount,
  });

  if (res.status !== "SUCCESS") {
    run(`UPDATE jackpot_wins SET status='MANUAL_REVIEW' WHERE jackpot_win_id=?`, [winId]);
    run(
      `INSERT INTO manual_review_queue (review_id, round_id, player_id, current_status, reason, severity, created_at)
       VALUES (?,?,?, 'JACKPOT_CREDIT_FAILED', ?, 'HIGH', ?)`,
      [uid("mrq"), roundId, winnerId, "jackpot credit failed", nowIso()],
    );
    emitEvent({ type: "JACKPOT_CREDIT_FAILED", entityId: winId, roundId, priority: 100 });
    return false;
  }

  run(`UPDATE jackpot_wins SET status='CREDITED', transaction_id=?, idempotency_key=?, credited_at=? WHERE jackpot_win_id=?`, [
    res.walletReference ?? null,
    idemKey,
    nowIso(),
    winId,
  ]);
  recordReturn(amount); // jackpot isplata ulazi u house budzet (svaki dobitnik)

  // Reset poola na seed + brojac isplata u hodu.
  run(`UPDATE jackpots SET current_amount=seed_amount, last_win_at=?, total_payouts = total_payouts + ?, updated_at=? WHERE jackpot_id=?`, [
    nowIso(),
    amount,
    nowIso(),
    j.jackpot_id,
  ]);

  audit({ action: "JACKPOT_WON", entityType: "jackpot", entityId: j.jackpot_id, newValue: { winnerId, amount } });
  emitEvent({ type: "JACKPOT_TRIGGERED", entityId: j.jackpot_id, roundId, priority: 100, payload: { winnerId, amount } });

  // Nove okolnosti -> preracun krive dobitniku.
  recalcCurveAfterJackpot(winnerId);
  return true;
}
