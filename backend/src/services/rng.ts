import crypto from "node:crypto";
import { get, run, nowIso } from "../db.ts";
import { uid, sha256, secureRandom } from "../util.ts";

/**
 * Server-side RNG sa audit logom i hash chain-om. Frontend nikad ne generise ishod.
 */
export function generateAndLog(params: {
  roundId: string;
  gameId: string;
  playerId: string;
  rawOutput: number;
  mappedResult: unknown;
  algorithmVersion: string;
}): void {
  const serverSeed = crypto.randomBytes(16).toString("hex");
  const serverSeedHash = sha256(serverSeed);

  const prev = get<{ hash_chain_current: string }>(
    `SELECT hash_chain_current FROM casino_rng_logs ORDER BY created_at DESC LIMIT 1`,
  );
  const previousHash = prev?.hash_chain_current ?? "GENESIS";
  const ts = nowIso();
  const mapped = JSON.stringify(params.mappedResult);
  const hashCurrent = sha256(
    `${params.roundId}|${params.rawOutput}|${mapped}|${previousHash}|${ts}`,
  );

  run(
    `INSERT INTO casino_rng_logs
      (rng_id, round_id, game_id, player_id, server_seed, server_seed_hash, nonce, raw_rng_output, mapped_result,
       algorithm_version, hash_chain_previous, hash_chain_current, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uid("rng"),
      params.roundId,
      params.gameId,
      params.playerId,
      serverSeed,
      serverSeedHash,
      1,
      String(params.rawOutput),
      mapped,
      params.algorithmVersion,
      previousHash,
      hashCurrent,
      ts,
    ],
  );
}

export { secureRandom };
