import crypto from "node:crypto";

export function uid(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

/** Kratki citljivi round id. */
export function roundId(): string {
  return "R-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/** Zaokruzi novac na 2 decimale (radi sa centima da izbegne float greske). */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Kriptografski siguran random u [0, 1). */
export function secureRandom(): number {
  // 6 bajtova -> 48 bita preciznosti, dovoljno.
  const buf = crypto.randomBytes(6);
  let value = 0;
  for (const b of buf) value = value * 256 + b;
  return value / 2 ** 48;
}

export function randomInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(secureRandom() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(secureRandom() * arr.length)];
}
