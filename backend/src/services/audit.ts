import { run, nowIso } from "../db.ts";
import { uid } from "../util.ts";

export function audit(params: {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ip?: string;
}): void {
  run(
    `INSERT INTO audit_logs (audit_id, actor_id, action, entity_type, entity_id, old_value, new_value, reason, ip_address, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      uid("aud"),
      params.actorId ?? null,
      params.action,
      params.entityType ?? null,
      params.entityId ?? null,
      params.oldValue != null ? JSON.stringify(params.oldValue) : null,
      params.newValue != null ? JSON.stringify(params.newValue) : null,
      params.reason ?? null,
      params.ip ?? null,
      nowIso(),
    ],
  );
}

/** Ubacuje event u outbox (settlement je primaran, event je sekundaran). */
export function emitEvent(params: {
  type: string;
  entityType?: string;
  entityId?: string;
  roundId?: string;
  priority?: number;
  payload?: unknown;
}): void {
  // Rutinski low-priority eventi (npr. ROUND_CLOSED svake runde) se ne pisu:
  // niko ih ne konzumira, a punili su bazu 1 red po spinu.
  if ((params.priority ?? 50) < 50) return;
  run(
    `INSERT INTO event_outbox (event_id, event_type, entity_type, entity_id, round_id, priority_level, payload, status, created_at, next_retry_at)
     VALUES (?,?,?,?,?,?,?, 'PENDING', ?, ?)`,
    [
      uid("evt"),
      params.type,
      params.entityType ?? null,
      params.entityId ?? null,
      params.roundId ?? null,
      params.priority ?? 50,
      params.payload != null ? JSON.stringify(params.payload) : null,
      nowIso(),
      nowIso(),
    ],
  );
}
