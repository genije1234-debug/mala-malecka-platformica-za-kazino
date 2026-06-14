import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { get, run, nowIso } from "../db.ts";
import { uid } from "../util.ts";
import { config } from "../config.ts";
import { ensureWallet } from "./wallet.ts";
import { ensureBrain } from "./brain.ts";
import { trackEvent } from "./behavior.ts";

export interface SessionToken {
  player_id: string;
  session_id: string;
  role: string;
}

export function registerPlayer(username: string, password: string, role = "PLAYER"): string {
  const existing = get(`SELECT player_id FROM players WHERE username = ?`, [username]);
  if (existing) throw new Error("USERNAME_TAKEN");
  const playerId = uid("ply");
  const hash = bcrypt.hashSync(password, 10);
  run(
    `INSERT INTO players (player_id, username, password_hash, role, status, created_at) VALUES (?,?,?,?, 'ACTIVE', ?)`,
    [playerId, username, hash, role, nowIso()],
  );
  ensureWallet(playerId);
  ensureBrain(playerId);
  run(`INSERT OR IGNORE INTO player_freebet_wallet (player_id, balance, granted_balance, updated_at) VALUES (?,0,0,?)`, [
    playerId,
    nowIso(),
  ]);
  return playerId;
}

/** Otvori casino sesiju za vec poznatog igraca i izdaj JWT (deljeno izmedju login i SSO launch). */
export function issueSession(player: any, meta: { ip?: string; userAgent?: string } = {}): { token: string; player: any } {
  const sessionId = uid("ses");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 12 * 3600 * 1000);
  run(
    `INSERT INTO casino_sessions (session_id, player_id, created_at, expires_at, ip_address, user_agent) VALUES (?,?,?,?,?,?)`,
    [sessionId, player.player_id, createdAt.toISOString(), expiresAt.toISOString(), meta.ip ?? null, meta.userAgent ?? null],
  );
  run(`UPDATE players SET last_seen_at = ? WHERE player_id = ?`, [nowIso(), player.player_id]);

  trackEvent({ playerId: player.player_id, sessionId, type: "LOGIN" });

  const token = jwt.sign(
    { player_id: player.player_id, session_id: sessionId, role: player.role } as SessionToken,
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any },
  );
  return { token, player };
}

export function login(
  username: string,
  password: string,
  meta: { ip?: string; userAgent?: string } = {},
): { token: string; player: any } {
  const player = get<any>(`SELECT * FROM players WHERE username = ?`, [username]);
  if (!player) throw new Error("INVALID_CREDENTIALS");
  if (!bcrypt.compareSync(password, player.password_hash)) throw new Error("INVALID_CREDENTIALS");
  if (player.status === "BLOCKED") throw new Error("ACCOUNT_BLOCKED");

  return issueSession(player, meta);
}

/**
 * SSO: nadji igraca vezanog za kladionicki user_id, ili ga napravi (bez lozinke - prijava ide
 * iskljucivo preko launch tokena). Username se izvodi iz kladionickog, sa sufiksom ako je zauzet.
 */
export function findOrCreateOperatorPlayer(operatorUserId: string, preferredUsername?: string): any {
  const existing = get<any>(`SELECT * FROM players WHERE operator_user_id = ?`, [operatorUserId]);
  if (existing) return existing;

  let username = (preferredUsername && preferredUsername.trim()) || `op_${operatorUserId}`;
  if (get(`SELECT player_id FROM players WHERE username = ?`, [username])) {
    username = `${username}_op${operatorUserId}`;
  }

  const playerId = uid("ply");
  run(
    `INSERT INTO players (player_id, username, password_hash, role, status, operator_user_id, created_at)
     VALUES (?,?,?,?,'ACTIVE',?,?)`,
    [playerId, username, "", "PLAYER", operatorUserId, nowIso()],
  );
  ensureWallet(playerId);
  ensureBrain(playerId);
  run(`INSERT OR IGNORE INTO player_freebet_wallet (player_id, balance, granted_balance, updated_at) VALUES (?,0,0,?)`, [
    playerId,
    nowIso(),
  ]);
  return get<any>(`SELECT * FROM players WHERE player_id = ?`, [playerId]);
}

export function verifyToken(token: string): SessionToken {
  const decoded = jwt.verify(token, config.jwtSecret) as SessionToken;
  const session = get<any>(`SELECT * FROM casino_sessions WHERE session_id = ?`, [decoded.session_id]);
  if (!session || session.ended_at) throw new Error("SESSION_INVALID");
  if (new Date(session.expires_at).getTime() < Date.now()) throw new Error("SESSION_EXPIRED");
  return decoded;
}

/** Eligibility (responsible gambling + jurisdiction) pre nove real-money runde. */
export function checkEligibility(playerId: string): { ok: boolean; reason?: string } {
  const player = get<any>(`SELECT * FROM players WHERE player_id = ?`, [playerId]);
  if (!player) return { ok: false, reason: "PLAYER_NOT_FOUND" };
  if (player.status !== "ACTIVE") return { ok: false, reason: "ACCOUNT_NOT_ACTIVE" };
  if (player.self_excluded) return { ok: false, reason: "SELF_EXCLUDED" };
  if (player.jurisdiction_allowed === 0) return { ok: false, reason: "JURISDICTION_BLOCKED" };
  if (player.cooldown_until && new Date(player.cooldown_until).getTime() > Date.now())
    return { ok: false, reason: "COOLDOWN_ACTIVE" };
  return { ok: true };
}
