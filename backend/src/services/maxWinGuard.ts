import { money } from "../util.ts";

/** Ogranicava raw win na bet * max_win_multiplier pre slanja walletu. */
export function applyMaxWinGuard(
  rawWin: number,
  betAmount: number,
  maxWinMultiplier: number,
): { finalWin: number; capped: boolean } {
  const cap = money(betAmount * maxWinMultiplier);
  if (rawWin > cap) return { finalWin: cap, capped: true };
  return { finalWin: money(rawWin), capped: false };
}
