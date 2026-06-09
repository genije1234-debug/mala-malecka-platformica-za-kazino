import { get, run, all, nowIso } from "../db.ts";
import { uid, clamp, secureRandom, money } from "../util.ts";
import { config } from "../config.ts";

/**
 * MOZAK.
 * Jedno stanje po igracu za sve igre. Na pocetku sesije pravi se "kriva" koja
 * vodi igraca: oblik (win na startu -> blagi pad -> povratak) + meta RTP.
 * Engine ne forsira spin-po-spin nego gura ishode ka krivi kroz koridor.
 */

export function ensureBrain(playerId: string): any {
  let b = get<any>(`SELECT * FROM player_brain_state WHERE player_id = ?`, [playerId]);
  if (!b) {
    run(
      `INSERT INTO player_brain_state (player_id, target_rtp, manual_rtp, total_wagered, total_returned, lifetime_rounds, updated_at)
       VALUES (?,?,?,0,0,0,?)`,
      [playerId, config.defaultTargetRtp, null, nowIso()],
    );
    b = get<any>(`SELECT * FROM player_brain_state WHERE player_id = ?`, [playerId]);
  }
  return b;
}

/** Admin rucno zadaje RTP po igracu (smernica, ne tvrda meta, ali se postuje). */
export function setManualRtp(playerId: string, rtp: number | null): void {
  ensureBrain(playerId);
  const target = rtp ?? config.defaultTargetRtp;
  run(`UPDATE player_brain_state SET manual_rtp=?, target_rtp=?, updated_at=? WHERE player_id=?`, [
    rtp,
    target,
    nowIso(),
    playerId,
  ]);
  // Aktivnu krivu odmah uskladi sa novom metom.
  run(`UPDATE player_rtp_curve SET target_rtp=? WHERE player_id=? AND active=1`, [target, playerId]);
}

export function getBrain(playerId: string): any {
  return ensureBrain(playerId);
}

export function effectiveRtp(playerId: string): number {
  const b = ensureBrain(playerId);
  if (b.total_wagered <= 0) return b.target_rtp;
  return b.total_returned / b.total_wagered;
}

interface CurveParams {
  startBoost: number; // pozitivan skok na pocetku (igrac "dobija")
  amplitude: number; // amplituda putanje
  freq: number; // koliko talasa kroz sesiju
  phase: number;
  decay: number; // koliko brzo se putanja smiruje ka meti
}

/** Vrednost ciljne RTP putanje na datom napretku x (0..~1.5). */
function curveTarget(target: number, p: CurveParams, x: number): number {
  const journey =
    p.startBoost * Math.exp(-3 * x) + p.amplitude * Math.sin(2 * Math.PI * p.freq * x + p.phase) * Math.exp(-p.decay * x);
  return target + journey;
}

/**
 * Pravi novu krivu za sesiju na osnovu igranja u poslednjih N dana.
 * Stara krva se deaktivira.
 */
export function startSessionCurve(playerId: string, sessionId: string | null): any {
  const brain = ensureBrain(playerId);

  // Igranje u poslednjih N dana -> procena ocekivanog obima i volatilnosti putanje.
  const sinceIso = new Date(Date.now() - config.brainHistoryDays * 86400 * 1000).toISOString();
  const hist = get<{ rounds: number; wagered: number; avg_bet: number }>(
    `SELECT COUNT(*) AS rounds, COALESCE(SUM(bet_amount),0) AS wagered, COALESCE(AVG(bet_amount),0) AS avg_bet
     FROM casino_rounds WHERE player_id = ? AND created_at >= ? AND mode='REAL'`,
    [playerId, sinceIso],
  )!;

  const behavior = get<any>(`SELECT * FROM player_behavior_metrics WHERE player_id = ?`, [playerId]);
  const avgBet = hist.avg_bet > 0 ? hist.avg_bet : behavior?.avg_bet > 0 ? behavior.avg_bet : 1;
  // Ocekivani obim sesije: prosek poslednjih sesija ili default ~40 betova.
  const expectedRounds = hist.rounds > 0 ? clamp(hist.rounds / Math.max(1, behavior?.total_sessions ?? 1), 20, 200) : 40;
  const expectedVolume = money(avgBet * expectedRounds);

  // Oblik krive: nov igrac dobija prijatniju (veci startBoost); lojalan blazu.
  const isNew = hist.rounds < 10;
  const params: CurveParams = {
    startBoost: isNew ? 0.12 + secureRandom() * 0.05 : 0.05 + secureRandom() * 0.04,
    amplitude: 0.05 + secureRandom() * 0.05,
    freq: 1 + secureRandom() * 1.5,
    phase: secureRandom() * Math.PI * 2,
    decay: 1.5 + secureRandom() * 1.5,
  };

  run(`UPDATE player_rtp_curve SET active=0 WHERE player_id=? AND active=1`, [playerId]);
  const curveId = uid("crv");
  run(
    `INSERT INTO player_rtp_curve
      (curve_id, player_id, session_id, target_rtp, curve_json, session_wagered, session_returned, expected_session_volume, active, created_at)
     VALUES (?,?,?,?,?,0,0,?,1,?)`,
    [curveId, playerId, sessionId, brain.target_rtp, JSON.stringify(params), expectedVolume, nowIso()],
  );
  return get<any>(`SELECT * FROM player_rtp_curve WHERE curve_id = ?`, [curveId]);
}

export function getActiveCurve(playerId: string): any {
  return get<any>(`SELECT * FROM player_rtp_curve WHERE player_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1`, [
    playerId,
  ]);
}

/**
 * Srce sistema: koliki EV (requestedRtp) engine treba da cilja za ovaj spin
 * da bi vodio igraca po krivi. Unutar koridora = cist target (random feel);
 * van koridora = korekcija nazad ka krivi.
 */
export function computeSteering(
  playerId: string,
  betAmount: number,
  jackpotEligible = true,
): { requestedRtp: number; effRtp: number; targetAt: number } {
  const brain = ensureBrain(playerId);
  let curve = getActiveCurve(playerId);
  if (!curve) curve = startSessionCurve(playerId, null);

  const params: CurveParams = JSON.parse(curve.curve_json);
  const expectedVolume = curve.expected_session_volume || Math.max(betAmount * 40, 40);

  // OPCIJA A: target_rtp je UKUPAN RTP. Jackpot (2%) i free-bet (1%) su deo tih
  // procenata, pa engine za BAZNE dobitke cilja: ukupno - doprinosi.
  // (free-bet ide na svaki REAL ulog; jackpot samo za jackpot-eligible igre.)
  const contribReturn = config.freebetAccrualPct + (jackpotEligible ? config.jackpotContributionTotalPct : 0);
  const baseTarget = curve.target_rtp - contribReturn;

  // Napredak kroz sesiju.
  const progress = clamp((curve.session_wagered + betAmount) / expectedVolume, 0, 1.6);
  const targetAt = curveTarget(baseTarget, params, progress);

  // Efektivni RTP sesije sa priorom (krece od bazne mete pa se pomera sa rezultatima).
  const priorVolume = Math.max(betAmount * 5, baseTarget * 5);
  const effRtp =
    (curve.session_returned + baseTarget * priorVolume) / (curve.session_wagered + priorVolume);

  // Koridor: siri na pocetku (vise slobode), uzi kasnije.
  const band = config.rtpCorridorHalfWidth * (1 + 1.8 * Math.exp(-curve.session_wagered / expectedVolume));
  const deviation = effRtp - targetAt;

  let requestedRtp = targetAt;
  if (Math.abs(deviation) > band) {
    const excess = deviation - Math.sign(deviation) * band;
    requestedRtp = targetAt - excess * config.rtpCorrectionGain;
  }

  // Tvrda zastita na ivicama (kriva je vaznija, ali ovo su sigurnosne granice).
  const lifeRtp = effectiveRtp(playerId);
  if (lifeRtp < config.rtpHardFloor) requestedRtp = Math.max(requestedRtp, 1.4);
  if (lifeRtp > config.rtpHardCeil) requestedRtp = Math.min(requestedRtp, 0.6);

  requestedRtp = clamp(requestedRtp, 0.4, 2.0);
  return { requestedRtp, effRtp, targetAt };
}

/** Posle runde: azurira ukupno stanje + sesijsku krivu. */
export function recordOutcome(playerId: string, bet: number, totalReturn: number): void {
  run(
    `UPDATE player_brain_state SET total_wagered = total_wagered + ?, total_returned = total_returned + ?,
       lifetime_rounds = lifetime_rounds + 1, updated_at = ? WHERE player_id = ?`,
    [bet, totalReturn, nowIso(), playerId],
  );
  run(
    `UPDATE player_rtp_curve SET session_wagered = session_wagered + ?, session_returned = session_returned + ?
     WHERE player_id = ? AND active = 1`,
    [bet, totalReturn, playerId],
  );
}

/** Kad igrac dobije jackpot -> nove okolnosti -> kriva se odmah preracunava. */
export function recalcCurveAfterJackpot(playerId: string): void {
  const curve = getActiveCurve(playerId);
  startSessionCurve(playerId, curve?.session_id ?? null);
}

/** Koliko igracu "treba" RTP (za izbor jackpot dobitnika): pozitivno = ispod mete. */
export function rtpNeed(playerId: string): number {
  const b = ensureBrain(playerId);
  return b.target_rtp - effectiveRtp(playerId);
}
