import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import type { GameSummary } from "@casino/shared";
import type { ProfileData, OnUpdate } from "../App.tsx";
import { translate } from "../i18n.ts";

// Mora odgovarati backendu: m(t) = exp(0.10 * t_sec)
const GROWTH = 0.1;

type Phase = "idle" | "running" | "crashed" | "cashed";

export function Crash({
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [mult, setMult] = useState(1);
  const [result, setResult] = useState<{ win?: number; crashPoint?: number; cashed?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const roundRef = useRef<string | null>(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);

  useEffect(() => () => cleanup(), []);
  function cleanup() {
    cancelAnimationFrame(rafRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
  }

  const step = game.min_bet < 1 ? 0.5 : 1;
  const icon = game.theme.includes("astronaut") ? "👨‍🚀" : game.theme.includes("fish") ? "🐟" : game.theme.includes("jet") ? "🛩️" : "🚀";

  async function start(mode: "REAL" | "FREEBET") {
    if (busy || phase === "running") return;
    setBusy(true);
    setResult(null);
    setMult(1);
    try {
      const r = await api.post<any>("/round/crash/start", { gameId: game.game_id, betAmount: bet, mode });
      roundRef.current = r.round_id;
      const offset = r.server_now - Date.now();
      startRef.current = r.started_at - offset;
      endedRef.current = false;
      setPhase("running");
      loop();
      pollRef.current = setInterval(poll, 350);
      // FREEBET: menja se freebet kasica (nije u odgovoru) -> pun refresh; REAL: patch balansa.
      await onUpdate(mode === "REAL" ? { balance: r.balance } : undefined);
    } catch (e: any) {
      showToast(translate(e.message));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  function loop() {
    const t = (Date.now() - startRef.current) / 1000;
    setMult(Math.max(1, Math.exp(GROWTH * t)));
    if (!endedRef.current) rafRef.current = requestAnimationFrame(loop);
  }

  async function poll() {
    if (endedRef.current || !roundRef.current) return;
    try {
      const s = await api.post<any>("/round/crash/state", { roundId: roundRef.current });
      if (s.ended) finishCrash(s.crashPoint ?? mult, s.balance);
    } catch {
      /* ignore poll glitch */
    }
  }

  function finishCrash(cp: number, balance?: number) {
    endedRef.current = true;
    cleanup();
    setMult(cp);
    setPhase("crashed");
    setResult({ crashPoint: cp, cashed: false });
    // Na bust balans je nepromenjen od starta (ulog je već skinut); patch ako stigao.
    onUpdate(balance != null ? { balance } : {});
  }

  async function cashout() {
    if (endedRef.current || !roundRef.current) return;
    endedRef.current = true;
    cleanup();
    try {
      const s = await api.post<any>("/round/crash/cashout", { roundId: roundRef.current });
      if (s.busted) {
        setMult(s.crashPoint);
        setPhase("crashed");
        setResult({ crashPoint: s.crashPoint, cashed: false });
      } else {
        setMult(s.multiplier);
        setPhase("cashed");
        setResult({ win: s.win, cashed: true, crashPoint: s.crashPoint });
        if (s.jackpot_win) showToast(`🎉 ${s.jackpot_win.name} JACKPOT +${s.jackpot_win.amount.toFixed(2)}`);
      }
      if (s.busted || s.cashed) {
        await onUpdate({ balance: s.balance });
      }
    } catch (e: any) {
      showToast(translate(e.message));
    }
  }

  const running = phase === "running";
  const color = phase === "crashed" ? "var(--red)" : phase === "cashed" ? "var(--green)" : "var(--text)";
  // vizuelna visina rakete: raste sa mnoziocem (log skala)
  const rise = Math.min(1, Math.log(mult) / Math.log(20));

  return (
    <div>
      <div className={`crash-stage ${phase}`}>
        <div className="crash-grid" />
        <div
          className="crash-rocket"
          style={{ bottom: `${8 + rise * 70}%`, left: `${8 + rise * 64}%`, opacity: phase === "crashed" ? 0.3 : 1 }}
        >
          {phase === "crashed" ? "💥" : icon}
        </div>
        <div className="crash-mult" style={{ color }}>
          {mult.toFixed(2)}×
        </div>
        <div className="crash-sub">
          {phase === "idle" && "Postavi ulog i poleti"}
          {running && "Pokupi pre nego što pukne!"}
          {phase === "crashed" && `Puklo na ${result?.crashPoint?.toFixed(2)}× — bez dobitka`}
          {phase === "cashed" && `Pokupljeno na ${mult.toFixed(2)}× — +${(result?.win ?? 0).toFixed(2)} ${profile.currency}`}
        </div>
      </div>

      <div className="bet-controls">
        {!running ? (
          <>
            <div className="bet-row">
              <span className="bet-label">Ulog</span>
              <div className="stepper">
                <button onClick={() => setBet((b) => Math.max(game.min_bet, +(b - step).toFixed(2)))}>−</button>
                <input value={bet} onChange={(e) => setBet(clampBet(Number(e.target.value), game))} />
                <button onClick={() => setBet((b) => Math.min(game.max_bet, +(b + step).toFixed(2)))}>+</button>
              </div>
            </div>
            <button className="btn" onClick={() => start("REAL")} disabled={busy}>
              {busy ? "..." : `Poleti za ${bet.toFixed(2)} ${profile.currency}`}
            </button>
            {profile.freebet_balance >= bet && (
              <button className="btn freebet" style={{ marginTop: 10 }} onClick={() => start("FREEBET")} disabled={busy}>
                🎁 Free bet ({profile.freebet_balance.toFixed(2)})
              </button>
            )}
          </>
        ) : (
          <button className="btn cashout" onClick={cashout}>
            Pokupi {(bet * mult).toFixed(2)} {profile.currency} @ {mult.toFixed(2)}×
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
