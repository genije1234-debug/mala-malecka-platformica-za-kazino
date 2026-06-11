import { useRef, useState } from "react";
import { api } from "../api.ts";
import type { GameSummary, PlayResult } from "@casino/shared";
import type { ProfileData, OnUpdate } from "../App.tsx";
import { translate } from "../i18n.ts";

interface PlinkoOutcome {
  kind: "plinko";
  multiplier: number;
  bucket: number;
  path: number[];
  buckets: number[];
  rows: number;
}

export function Plinko({
  game,
  profile,
  onUpdate,
  showToast,
}: {
  game: GameSummary;
  profile: ProfileData;
  onUpdate: OnUpdate;
  showToast: (m: string) => void;
}) {
  const [bet, setBet] = useState(Math.max(game.min_bet, 1));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PlinkoOutcome | null>(null);
  const [ball, setBall] = useState<{ x: number; y: number } | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [win, setWin] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const step = game.min_bet < 1 ? 0.5 : 1;
  const ROWS = 12;
  const bucketDefs = outcome?.buckets ?? [29, 8, 3, 1.4, 0.6, 0.3, 0.2, 0.3, 0.6, 1.4, 3, 8, 29];

  async function drop(mode: "REAL" | "FREEBET") {
    if (busy) return;
    setBusy(true);
    setWin(null);
    setLanded(null);
    try {
      const res = await api.postIdem<PlayResult>("/round/start", { gameId: game.game_id, betAmount: bet, mode });
      const o = res.outcome as PlinkoOutcome;
      setOutcome(o);
      animate(o, res);
      await onUpdate({ balance: res.balance, freebet_balance: res.freebet_balance });
    } catch (e: any) {
      showToast(translate(e.message));
      setBusy(false);
    }
  }

  function animate(o: PlinkoOutcome, res: PlayResult) {
    if (timerRef.current) clearInterval(timerRef.current);
    let stepIdx = 0;
    let cumRight = 0;
    setBall({ x: 0.5, y: 0 });
    timerRef.current = setInterval(() => {
      if (stepIdx >= o.rows) {
        clearInterval(timerRef.current!);
        setLanded(o.bucket);
        setWin(res.final_win);
        setBusy(false);
        if (res.jackpot_win) showToast(`🎉 ${res.jackpot_win.name} JACKPOT +${res.jackpot_win.amount.toFixed(2)}`);
        return;
      }
      if (o.path[stepIdx]) cumRight++;
      stepIdx++;
      const x = 0.5 + (2 * cumRight - stepIdx) * (0.5 / o.rows);
      setBall({ x, y: stepIdx / o.rows });
    }, 120);
  }

  return (
    <div>
      <div className="plinko-board">
        <div className="plinko-pegs">
          {Array.from({ length: ROWS }).map((_, r) =>
            Array.from({ length: r + 1 }).map((__, c) => {
              const left = 0.5 + (c - r / 2) * (1 / ROWS);
              const top = ((r + 1) / (ROWS + 2)) * 100;
              return <span key={`${r}-${c}`} className="peg" style={{ left: `${left * 100}%`, top: `${top}%` }} />;
            }),
          )}
        </div>
        {ball && (
          <span
            className="plinko-ball"
            style={{ left: `${ball.x * 100}%`, top: `${(ball.y * ROWS) / (ROWS + 2) * 100}%` }}
          />
        )}
        <div className="plinko-buckets">
          {bucketDefs.map((m, i) => (
            <div key={i} className={`bucket ${landed === i ? "hit" : ""} ${m >= 2 ? "hot" : m < 1 ? "cold" : ""}`}>
              {m}×
            </div>
          ))}
        </div>
      </div>

      {win != null && (
        <div className={`win-banner ${win > 0 ? "win" : "lose"}`} style={{ textAlign: "center", marginTop: 10 }}>
          {win > 0 ? `+${win.toFixed(2)} ${profile.currency}` : "Bez dobitka"}
        </div>
      )}

      <div className="bet-controls">
        <div className="bet-row">
          <span className="bet-label">Ulog</span>
          <div className="stepper">
            <button onClick={() => setBet((b) => Math.max(game.min_bet, +(b - step).toFixed(2)))}>−</button>
            <input value={bet} onChange={(e) => setBet(clampBet(Number(e.target.value), game))} />
            <button onClick={() => setBet((b) => Math.min(game.max_bet, +(b + step).toFixed(2)))}>+</button>
          </div>
        </div>
        <button className="btn" onClick={() => drop("REAL")} disabled={busy}>
          {busy ? "Pada..." : `Pusti kuglicu za ${bet.toFixed(2)} ${profile.currency}`}
        </button>
        {profile.freebet_balance >= bet && (
          <button className="btn freebet" style={{ marginTop: 10 }} onClick={() => drop("FREEBET")} disabled={busy}>
            🎁 Free bet ({profile.freebet_balance.toFixed(2)})
          </button>
        )}
      </div>
    </div>
  );
}

function clampBet(v: number, g: GameSummary): number {
  if (isNaN(v)) return g.min_bet;
  return Math.min(g.max_bet, Math.max(g.min_bet, v));
}
