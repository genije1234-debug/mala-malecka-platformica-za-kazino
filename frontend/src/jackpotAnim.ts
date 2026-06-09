import { useEffect, useRef, useState } from "react";
import type { JackpotState } from "@casino/shared";

/**
 * Glatko "klizanje" jackpot iznosa ka poslednjoj vrednosti sa servera.
 * - rast: easing ka meti (nema skoka, nema overshoot-a pa vraćanja unazad);
 * - pad (drop/reset): snap dole.
 * Backend šalje stanje svake ~1s; ovo popunjava prelaz između snapshotova.
 */
export function useTweenedJackpots(jackpots: JackpotState[]): Record<string, number> {
  const targets = useRef<Record<string, number>>({});
  const disp = useRef<Record<string, number>>({});
  const [, force] = useState(0);

  useEffect(() => {
    const m: Record<string, number> = {};
    for (const j of jackpots) {
      m[j.jackpot_id] = j.current_amount;
      if (disp.current[j.jackpot_id] == null) disp.current[j.jackpot_id] = j.current_amount;
    }
    targets.current = m;
  }, [jackpots]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let changed = false;
      for (const id in targets.current) {
        const tgt = targets.current[id];
        const cur = disp.current[id] ?? tgt;
        const diff = tgt - cur;
        if (Math.abs(diff) < 0.005) {
          if (cur !== tgt) {
            disp.current[id] = tgt;
            changed = true;
          }
          continue;
        }
        // Veći pad (isplata jackpota / reset) -> snap dole, da ne "curi" nadole.
        disp.current[id] = diff < -1 ? tgt : cur + diff * Math.min(1, dt * 1.8);
        changed = true;
      }
      if (changed) force((n) => (n + 1) & 0xffffff);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return disp.current;
}
