import type { JackpotState } from "@casino/shared";
import { useTweenedJackpots } from "../jackpotAnim.ts";

export function JackpotRail({ jackpots }: { jackpots: JackpotState[] }) {
  const disp = useTweenedJackpots(jackpots);
  if (jackpots.length === 0) return null;
  return (
    <div className="jp-rail">
      {jackpots.map((j) => (
        <div
          key={j.jackpot_id}
          className={`jp-card fx-${j.effect} ${j.active ? "active" : "inactive"}`}
          style={
            {
              ["--intensity" as any]: j.intensity.toFixed(3),
              ["--jp-color" as any]: j.color,
            } as React.CSSProperties
          }
        >
          <div className="jp-name">{j.name}</div>
          <div className="jp-amount">
            {(disp[j.jackpot_id] ?? j.current_amount).toFixed(2)} <small>{j.currency}</small>
          </div>
          <div className="jp-bar">
            <i style={{ width: `${Math.round(j.intensity * 100)}%`, background: j.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
