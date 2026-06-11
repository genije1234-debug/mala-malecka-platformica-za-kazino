import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { GameSummary, PlayResult, JackpotState } from "@casino/shared";
import type { ProfileData, OnUpdate } from "../App.tsx";
import { gameIcon } from "./Lobby.tsx";
import { translate } from "../i18n.ts";
import { Crash } from "../games/Crash.tsx";
import { Mines } from "../games/Mines.tsx";
import { Plinko } from "../games/Plinko.tsx";
import { Slot } from "../games/Slot.tsx";
import { Hot40 } from "../games/Hot40.tsx";

export function GameScreen({
  gameId,
  profile,
  jackpots,
  onBack,
  onUpdate,
  showToast,
}: {
  gameId: string;
  profile: ProfileData;
  jackpots: JackpotState[];
  onBack: () => void;
  onUpdate: OnUpdate;
  showToast: (m: string) => void;
}) {
  const [game, setGame] = useState<GameSummary | null>(null);

  useEffect(() => {
    api.get<GameSummary>(`/games/${gameId}`).then(setGame);
  }, [gameId]);

  if (!game) return <div className="card">Učitavanje...</div>;

  // Igre sa punom obradom: zauzimaju ceo ekran (sopstveni header/kontrole).
  if (game.engine === "hot40") {
    return (
      <Hot40 game={game} profile={profile} jackpots={jackpots} onUpdate={onUpdate} onBack={onBack} showToast={showToast} />
    );
  }

  const isCrash = game.game_type === "crash";
  const isMines = game.theme.includes("mine");
  const isPlinko = game.theme.includes("plinko");
  const isSlot = !!game.slot;

  return (
    <div>
      <div className="game-header">
        <button className="btn secondary" style={{ width: "auto", padding: "8px 14px" }} onClick={onBack}>
          ←
        </button>
        <div>
          <div style={{ fontWeight: 800 }}>{game.name}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{game.provider_style}</div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 26 }}>{gameIcon(game)}</div>
      </div>

      {isCrash && <Crash game={game} profile={profile} onUpdate={onUpdate} showToast={showToast} />}
      {isMines && <Mines game={game} profile={profile} onUpdate={onUpdate} showToast={showToast} />}
      {isPlinko && <Plinko game={game} profile={profile} onUpdate={onUpdate} showToast={showToast} />}
      {isSlot && <Slot game={game} profile={profile} jackpots={jackpots} onUpdate={onUpdate} showToast={showToast} />}
      {!isCrash && !isMines && !isPlinko && !isSlot && (
        <ClassicGame game={game} profile={profile} onUpdate={onUpdate} showToast={showToast} />
      )}
    </div>
  );
}

function ClassicGame({
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
  const [target, setTarget] = useState(2);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [jackpotPop, setJackpotPop] = useState<PlayResult["jackpot_win"] | null>(null);

  const needsTarget = game.theme.includes("limbo");
  const step = game.min_bet < 1 ? 0.5 : 1;
  const canFreebet = profile.freebet_balance >= bet;

  async function play(mode: "REAL" | "FREEBET") {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const options = needsTarget ? { target } : undefined;
      const res = await api.postIdem<PlayResult>("/round/start", { gameId: game.game_id, betAmount: bet, mode, options });
      await new Promise((r) => setTimeout(r, 450));
      setResult(res);
      if (res.jackpot_win) setJackpotPop(res.jackpot_win);
      await onUpdate({ balance: res.balance, freebet_balance: res.freebet_balance });
    } catch (e: any) {
      showToast(translate(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="game-stage">
        {!result && <div style={{ fontSize: 64, opacity: busy ? 0.4 : 1 }}>{gameIcon(game)}</div>}
        {busy && <div style={{ marginTop: 12, color: "var(--muted)" }}>Server generiše ishod...</div>}
        {result && <ResultView result={result} />}
      </div>

      <div className="bet-controls">
        {needsTarget && (
          <div className="bet-row">
            <span className="bet-label">Cilj ×</span>
            <div className="stepper">
              <button onClick={() => setTarget((t) => Math.max(1.1, +(t - 0.5).toFixed(2)))}>−</button>
              <input value={target} onChange={(e) => setTarget(Math.max(1.1, Number(e.target.value) || 1.1))} />
              <button onClick={() => setTarget((t) => +(t + 0.5).toFixed(2))}>+</button>
            </div>
          </div>
        )}
        <div className="bet-row">
          <span className="bet-label">Ulog</span>
          <div className="stepper">
            <button onClick={() => setBet((b) => Math.max(game.min_bet, +(b - step).toFixed(2)))}>−</button>
            <input value={bet} onChange={(e) => setBet(clampBet(Number(e.target.value), game))} />
            <button onClick={() => setBet((b) => Math.min(game.max_bet, +(b + step).toFixed(2)))}>+</button>
          </div>
        </div>

        <button className="btn" onClick={() => play("REAL")} disabled={busy}>
          {busy ? "..." : `Zavrti za ${bet.toFixed(2)} ${profile.currency}`}
        </button>
        {profile.freebet_balance > 0 && (
          <button className="btn freebet" style={{ marginTop: 10 }} onClick={() => play("FREEBET")} disabled={busy || !canFreebet}>
            🎁 Free bet ({profile.freebet_balance.toFixed(2)} {profile.currency})
          </button>
        )}
      </div>

      {jackpotPop && (
        <div className="jackpot-pop" onClick={() => setJackpotPop(null)}>
          <div className="box">
            <h1>🎉 {jackpotPop.name} JACKPOT! 🎉</h1>
            <div className="amt">
              +{jackpotPop.amount.toFixed(2)} {profile.currency}
            </div>
            <p style={{ color: "var(--muted)" }}>Tapni da zatvoriš</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultView({ result }: { result: PlayResult }) {
  const o: any = result.outcome;
  const win = result.final_win > 0;

  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      {o?.grid && (
        <div className="slot-grid">
          {o.grid.flatMap((row: string[], r: number) =>
            row.map((s, c) => (
              <div key={`${r}-${c}`} className="slot-cell">
                {symbol(s)}
              </div>
            )),
          )}
        </div>
      )}
      {o?.kind === "keno" && (
        <div style={{ fontSize: 13 }}>
          <div style={{ color: "var(--muted)" }}>Tvoji: {o.picks.join(", ")}</div>
          <div style={{ margin: "8px 0", fontWeight: 800 }}>Pogođeno: {o.matches}/10</div>
        </div>
      )}
      {(o?.kind === "dice" || o?.kind === "limbo" || o?.kind === "penalty" || o?.kind === "instant") && (
        <div className="instant-num">{o.multiplier?.toFixed?.(2) ?? o.multiplier}×</div>
      )}

      <div className={`win-banner ${win ? "win" : "lose"}`} style={{ marginTop: 14 }}>
        {win ? `+${result.final_win.toFixed(2)}` : "Bez dobitka"}
      </div>
      {result.max_win_applied && <div style={{ color: "var(--accent)", fontSize: 12 }}>Max win limit primenjen</div>}
    </div>
  );
}

function symbol(s: string): string {
  const map: Record<string, string> = {
    CHERRY: "🍒", LEMON: "🍋", ORANGE: "🍊", PLUM: "🍑", GRAPES: "🍇", WATERMELON: "🍉", SEVEN: "7️⃣", STAR: "⭐",
    "7": "7️⃣", BAR: "🅱️", BELL: "🔔", CROWN: "👑",
  };
  return map[s] || s;
}

function clampBet(v: number, g: GameSummary): number {
  if (isNaN(v)) return g.min_bet;
  return Math.min(g.max_bet, Math.max(g.min_bet, v));
}
