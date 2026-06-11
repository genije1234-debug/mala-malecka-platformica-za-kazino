import { all, get, run, nowIso } from "./db.ts";
import { uid } from "./util.ts";
import { config } from "./config.ts";
import { broadcastJackpots } from "./ws.ts";
import { grantFreebet, getFreebet } from "./services/freebet.ts";
import { getBehavior } from "./services/behavior.ts";
import { expireInteractiveRound } from "./services/interactive.ts";
import { audit } from "./services/audit.ts";
import { retentionTick } from "./services/retention.ts";

const timers: NodeJS.Timeout[] = [];

export function startWorkers(): void {
  // 1) Zivi jackpot meter -> WebSocket.
  timers.push(setInterval(() => broadcastJackpots(), 1000));

  // 2) AI re-engagement: free bet posle neaktivnosti.
  timers.push(setInterval(reengagementTick, 15000));

  // 3) Recovery worker.
  timers.push(setInterval(recoveryTick, 12000));

  // 4) Retention (cistacica): brise staru papirologiju da baza ostane mala.
  timers.push(setInterval(() => {
    const n = retentionTick();
    if (n > 0) console.log(`[retention] obrisano ${n} starih redova`);
  }, 5 * 60 * 1000));
}

export function stopWorkers(): void {
  for (const t of timers) clearInterval(t);
}

/** Bira trenutak slanja free beta na osnovu ponasanja (podesivo + AI korekcija). */
function reengagementTick(): void {
  const players = all<{ player_id: string }>(`SELECT player_id FROM players WHERE role='PLAYER'`);
  const now = Date.now();
  for (const { player_id } of players) {
    const fb = getFreebet(player_id);
    if (fb.balance < config.freebetMinGrant) continue;

    const lastEvent = get<{ c: string }>(`SELECT MAX(created_at) AS c FROM player_events WHERE player_id=?`, [player_id]);
    if (!lastEvent?.c) continue;
    const inactiveSec = (now - new Date(lastEvent.c).getTime()) / 1000;

    // AI: ako je median razmak poznat, salji oko 1.2x median (ali min = base).
    const behavior = getBehavior(player_id);
    let threshold = config.freebetBaseInactivitySec;
    if (behavior?.median_session_gap_sec > 0) {
      threshold = Math.max(config.freebetBaseInactivitySec, behavior.median_session_gap_sec * 1.2);
    }
    // Visok churn rizik -> salji ranije.
    if (behavior?.churn_risk > 0.6) threshold *= 0.6;

    // Ne salji ako je vec dodeljen u zadnjih 'threshold' sekundi.
    const recentGrant = get<{ c: string }>(
      `SELECT MAX(created_at) AS c FROM freebet_grants WHERE player_id=?`,
      [player_id],
    );
    const grantedRecently = recentGrant?.c && (now - new Date(recentGrant.c).getTime()) / 1000 < threshold;

    if (inactiveSec >= threshold && !grantedRecently) {
      grantFreebet(player_id, "ai-reengagement");
    }
  }
}

const UNRESOLVED = [
  "DEBIT_UNKNOWN",
  "WIN_CREDIT_PENDING",
  "JACKPOT_PENDING",
  "BET_DEBIT_PENDING",
  "LOCK_ACQUIRED",
  "WIN_CALCULATED_EXPIRED",
];

function recoveryTick(): void {
  // a) Stale lock cleanup.
  const staleLocks = all<any>(`SELECT * FROM casino_active_locks WHERE lock_expires_at < ?`, [nowIso()]);
  for (const lock of staleLocks) {
    const round = lock.round_id ? get<any>(`SELECT * FROM casino_rounds WHERE round_id=?`, [lock.round_id]) : null;
    // Napustena interaktivna runda (Mines/Crash) -> zatvori kao gubitak (oslobadja i lock).
    if (round && round.status === "RESULT_GENERATED") {
      expireInteractiveRound(round.round_id);
      audit({ action: "INTERACTIVE_ROUND_EXPIRED", entityType: "round", entityId: round.round_id });
      continue;
    }
    if (!round || ["CLOSED", "FAILED", "ROLLED_BACK"].includes(round.status)) {
      run(`DELETE FROM casino_active_locks WHERE player_id=?`, [lock.player_id]);
      audit({ action: "STALE_LOCK_RELEASED", entityType: "lock", entityId: lock.lock_id });
    }
  }

  // b) WIN_CALCULATED predugo -> EXPIRED.
  run(
    `UPDATE casino_rounds SET status='WIN_CALCULATED_EXPIRED'
     WHERE status='WIN_CALCULATED' AND expected_next_status_deadline < ?`,
    [nowIso()],
  );

  // c) Atomic claim nedovrsenih rundi.
  const placeholders = UNRESOLVED.map(() => "?").join(",");
  const candidates = all<any>(
    `SELECT round_id FROM casino_rounds
     WHERE status IN (${placeholders})
       AND (recovery_lock_expires_at IS NULL OR recovery_lock_expires_at < ?)
     LIMIT 20`,
    [...UNRESOLVED, nowIso()],
  );
  const worker = `recovery@${process.pid}`;
  for (const { round_id } of candidates) {
    const claim = run(
      `UPDATE casino_rounds
       SET recovery_locked_by=?, recovery_locked_at=?, recovery_lock_expires_at=?, recovery_attempt_count=recovery_attempt_count+1
       WHERE round_id=? AND (recovery_lock_expires_at IS NULL OR recovery_lock_expires_at < ?)`,
      [worker, nowIso(), new Date(Date.now() + 30000).toISOString(), round_id, nowIso()],
    );
    if (claim.changes !== 1) continue;
    run(`INSERT INTO recovery_attempts (attempt_id, round_id, worker, action, result, created_at) VALUES (?,?,?,?,?,?)`, [
      uid("rca"),
      round_id,
      worker,
      "scan",
      "claimed",
      nowIso(),
    ]);
    // Posle vise pokusaja -> manual review.
    const r = get<any>(`SELECT * FROM casino_rounds WHERE round_id=?`, [round_id]);
    if (r && r.recovery_attempt_count >= 5) {
      run(`UPDATE casino_rounds SET status='MANUAL_REVIEW', manual_review_reason='recovery exhausted' WHERE round_id=?`, [
        round_id,
      ]);
      run(
        `INSERT INTO manual_review_queue (review_id, round_id, player_id, current_status, reason, severity, created_at)
         VALUES (?,?,?,?,?, 'HIGH', ?)`,
        [uid("mrq"), round_id, r.player_id, r.status, "recovery exhausted", nowIso()],
      );
      run(`DELETE FROM casino_active_locks WHERE round_id=?`, [round_id]);
    }
  }
}
