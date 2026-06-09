import { get, run, tx, nowIso } from "../db.ts";
import { uid } from "../util.ts";
import { config } from "../config.ts";
import { audit } from "./audit.ts";

export interface ActiveLock {
  player_id: string;
  lock_id: string;
  round_id: string | null;
  game_id: string | null;
  created_at: string;
  lock_expires_at: string;
  status: string;
}

/** 1 igrac = 1 aktivna real-money runda. Vraca lock ili null ako je zauzeto. */
export function acquireLock(playerId: string, gameId: string): ActiveLock | null {
  return tx<ActiveLock | null>(() => {
    const existing = get<ActiveLock>(`SELECT * FROM casino_active_locks WHERE player_id = ?`, [playerId]);
    const now = Date.now();
    if (existing && existing.status === "ACTIVE" && new Date(existing.lock_expires_at).getTime() > now) {
      return null; // aktivni lock postoji
    }
    if (existing) {
      // Stale ili stari lock -> oslobodi.
      run(`DELETE FROM casino_active_locks WHERE player_id = ?`, [playerId]);
      if (new Date(existing.lock_expires_at).getTime() <= now) {
        audit({ action: "STALE_LOCK_RELEASED", entityType: "lock", entityId: existing.lock_id, reason: "expired" });
      }
    }
    const lockId = uid("lck");
    const createdAt = nowIso();
    const expiresAt = new Date(now + config.maxRoundDurationSec * 1000).toISOString();
    run(
      `INSERT INTO casino_active_locks (player_id, lock_id, round_id, game_id, created_at, lock_expires_at, status)
       VALUES (?,?,?,?,?,?, 'ACTIVE')`,
      [playerId, lockId, null, gameId, createdAt, expiresAt],
    );
    return { player_id: playerId, lock_id: lockId, round_id: null, game_id: gameId, created_at: createdAt, lock_expires_at: expiresAt, status: "ACTIVE" };
  });
}

export function attachRoundToLock(playerId: string, roundId: string): void {
  run(`UPDATE casino_active_locks SET round_id = ? WHERE player_id = ?`, [roundId, playerId]);
}

export function releaseLock(playerId: string): void {
  run(`DELETE FROM casino_active_locks WHERE player_id = ?`, [playerId]);
}

export function getLock(playerId: string): ActiveLock | undefined {
  return get<ActiveLock>(`SELECT * FROM casino_active_locks WHERE player_id = ?`, [playerId]);
}
