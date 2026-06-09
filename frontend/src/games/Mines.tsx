import { useState } from "react";
import { api } from "../api.ts";
import type { GameSummary } from "@casino/shared";
import type { ProfileData, OnUpdate } from "../App.tsx";
import { translate } from "../i18n.ts";

type CellState = "hidden" | "gem" | "bomb" | "bombMiss";
type Phase = "idle" | "playing" | "ended";

const TILES = 25;

export function Mines({
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
  const [mines, setMines] = useState(3);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cells, setCells] = useState<CellState[]>(Array(TILES).fill("hidden"));
  const [mult, setMult] = useState(1);
  const [nextMult, setNextMult] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ win: number; busted: boolean } | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);

  const step = game.min_bet < 1 ? 0.5 : 1;
  const won = phase === "playing" && mult > 1;

  async function start(mode: "REAL" | "FREEBET") {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<any>("/round/mines/start", { gameId: game.game_id, betAmount: bet, mines, mode });
      setRoundId(r.round_id);
      setCells(Array(TILES).fill("hidden"));
      setMult(1);
      setNextMult(r.next_multiplier);
      setPhase("playing");
      // FREEBET: menja se freebet kasica (nije u odgovoru) -> pun refresh; REAL: patch balansa.
      await onUpdate(mode === "REAL" ? { balance: r.balance } : undefined);
    } catch (e: any) {
      showToast(translate(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(i: number) {
    if (phase !== "playing" || busy || cells[i] !== "hidden") return;
    setBusy(true);
    try {
      const r = await api.post<any>("/round/mines/reveal", { roundId, cell: i });
      if (r.busted) {
        const next = [...cells];
        for (const b of r.bombs as number[]) next[b] = b === r.hit ? "bomb" : "bombMiss";
        setCells(next);
        setMult(0);
        setPhase("ended");
        setResult({ win: 0, busted: true });
        await onUpdate({ balance: r.balance });
      } else if (r.cashed) {
        // auto-cashout (sva bezbedna polja otvorena)
        finishCashout(r);
        await onUpdate({ balance: r.balance });
      } else {
        const next = [...cells];
        next[i] = "gem";
        setCells(next);
        setMult(r.multiplier);
        setNextMult(r.next_multiplier);
      }
    } catch (e: any) {
      showToast(translate(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function cashout() {
    if (phase !== "playing" || busy || mult <= 1) return;
    setBusy(true);
    try {
      const r = await api.post<any>("/round/mines/cashout", { roundId });
      finishCashout(r);
      await onUpdate({ balance: r.balance });
    } catch (e: any) {
      showToast(translate(e.message));
    } finally {
      setBusy(false);
    }
  }

  function finishCashout(r: any) {
    const next = [...cells];
    for (const b of r.bombs as number[]) if (next[b] === "hidden") next[b] = "bombMiss";
    setCells(next);
    setMult(r.multiplier);
    setPhase("ended");
    setResult({ win: r.win, busted: false });
    if (r.jackpot_win) showToast(`🎉 ${r.jackpot_win.name} JACKPOT +${r.jackpot_win.amount.toFixed(2)}`);
  }

  return (
    <div>
      <div className="mines-head">
        <div>
          <div className="mines-mult">{mult.toFixed(2)}×</div>
          {phase === "playing" && <div className="mines-next">sledeće: {nextMult.toFixed(2)}×</div>}
          {phase === "ended" && result && (
            <div className={`mines-next ${result.busted ? "lose" : "win"}`}>
              {result.busted ? "BUM 💥" : `+${result.win.toFixed(2)} ${profile.currency}`}
            </div>
          )}
        </div>
        {phase === "playing" && (
          <button className="btn cashout" style={{ width: "auto", padding: "10px 16px" }} onClick={cashout} disabled={busy || mult <= 1}>
            Pokupi {(bet * mult).toFixed(2)}
          </button>
        )}
      </div>

      <div className={`mines-grid ${phase}`}>
        {cells.map((c, i) => (
          <button key={i} className={`mine-cell ${c}`} onClick={() => reveal(i)} disabled={phase !== "playing" || c !== "hidden"}>
            {c === "gem" ? "💎" : c === "bomb" ? "💣" : c === "bombMiss" ? "💣" : ""}
          </button>
        ))}
      </div>

      <div className="bet-controls">
        {phase !== "playing" && (
          <>
            <div className="bet-row">
              <span className="bet-label">Mine</span>
              <div className="stepper">
                <button onClick={() => setMines((m) => Math.max(1, m - 1))}>−</button>
                <input value={mines} onChange={(e) => setMines(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} />
                <button onClick={() => setMines((m) => Math.min(24, m + 1))}>+</button>
              </div>
            </div>
            <div className="bet-row">
              <span className="bet-label">Ulog</span>
              <div className="stepper">
                <button onClick={() => setBet((b) => Math.max(game.min_bet, +(b - step).toFixed(2)))}>−</button>
                <input value={bet} onChange={(e) => setBet(clampBet(Number(e.target.value), game))} />
                <button onClick={() => setBet((b) => Math.min(game.max_bet, +(b + step).toFixed(2)))}>+</button>
              </div>
            </div>
            <button className="btn" onClick={() => start("REAL")} disabled={busy}>
              {busy ? "..." : `Igraj za ${bet.toFixed(2)} ${profile.currency}`}
            </button>
            {profile.freebet_balance >= bet && (
              <button className="btn freebet" style={{ marginTop: 10 }} onClick={() => start("FREEBET")} disabled={busy}>
                🎁 Free bet ({profile.freebet_balance.toFixed(2)})
              </button>
            )}
          </>
        )}
        {phase === "playing" && <div className="mines-hint">Otvaraj polja i pokupi pre nego što naiđeš na minu.</div>}
      </div>
    </div>
  );
}

function clampBet(v: number, g: GameSummary): number {
  if (isNaN(v)) return g.min_bet;
  return Math.min(g.max_bet, Math.max(g.min_bet, v));
}
