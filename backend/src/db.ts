import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Osiguraj da postoji folder za bazu.
fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new DatabaseSync(config.dbFile);

/** Inicijalizuje schemu (idempotentno). */
export function initSchema(): void {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  db.exec(sql);
}

type Params = unknown[];

export function run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = db.prepare(sql);
  const res = stmt.run(...(params as any[]));
  return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
}

export function get<T = any>(sql: string, params: Params = []): T | undefined {
  const stmt = db.prepare(sql);
  return stmt.get(...(params as any[])) as T | undefined;
}

export function all<T = any>(sql: string, params: Params = []): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...(params as any[])) as T[];
}

/** Sinhrona transakcija: ako fn baci, radi se ROLLBACK. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
