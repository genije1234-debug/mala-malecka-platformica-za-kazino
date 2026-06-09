import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import type { GameSummary } from "@casino/shared";

const TYPE_LABELS: Record<string, string> = {
  all: "Sve",
  classic_slot: "Voćke",
  book_slot: "Book",
  tumble_slot: "Tumble",
  megaways_slot: "Megaways",
  fishing_slot: "Fishing",
  crash: "Crash",
  keno: "Keno",
  instant: "Instant",
};

export function gameIcon(g: GameSummary): string {
  const t = g.theme;
  if (t.includes("fruit")) return "🍒";
  if (t.includes("royal")) return "👑";
  if (t.includes("joker")) return "🃏";
  if (t.includes("egypt")) return "📖";
  if (t.includes("ocean")) return "🐬";
  if (t.includes("fortune")) return "🍀";
  if (t.includes("greek")) return "⚡";
  if (t.includes("candy")) return "🍬";
  if (t.includes("anime")) return "🌟";
  if (t.includes("dog")) return "🐶";
  if (t.includes("fish")) return "🎣";
  if (g.game_type === "crash") return "🚀";
  if (g.game_type === "keno") return "🔢";
  if (t.includes("plinko")) return "🔻";
  if (t.includes("mine")) return "💣";
  if (t.includes("dice")) return "🎲";
  if (t.includes("football")) return "⚽";
  if (t.includes("limbo")) return "📉";
  return "🎰";
}

export function Lobby({ onOpenGame }: { onOpenGame: (id: string) => void }) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    api.get<GameSummary[]>("/games").then(setGames).catch(() => {});
  }, []);

  const types = useMemo(() => ["all", ...Array.from(new Set(games.map((g) => g.game_type)))], [games]);
  const shown = filter === "all" ? games : games.filter((g) => g.game_type === filter);

  return (
    <div>
      <div className="filters">
        {types.map((t) => (
          <button key={t} className={`chip ${filter === t ? "on" : ""}`} onClick={() => setFilter(t)}>
            {TYPE_LABELS[t] || t}
          </button>
        ))}
      </div>

      <div className="section-title">{shown.length} igara</div>
      <div className="game-grid">
        {shown.map((g) => (
          <div key={g.game_id} className="game-tile" onClick={() => onOpenGame(g.game_id)}>
            <div className="game-thumb" style={{ background: thumbBg(g) }}>
              {gameIcon(g)}
              {g.jackpot_eligible && <span className="badge-jp">JACKPOT</span>}
            </div>
            <div className="meta">
              <div className="gname">{g.name}</div>
              <div className="gsub">
                {TYPE_LABELS[g.game_type]} • RTP {(g.rtp_target * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function thumbBg(g: GameSummary): string {
  const palettes: Record<string, string> = {
    classic_slot: "linear-gradient(160deg,#3a1c1c,#1a0e0e)",
    book_slot: "linear-gradient(160deg,#3a2e10,#1a1505)",
    tumble_slot: "linear-gradient(160deg,#3a1030,#1a0518)",
    megaways_slot: "linear-gradient(160deg,#102a3a,#05151a)",
    fishing_slot: "linear-gradient(160deg,#103a34,#05181a)",
    crash: "linear-gradient(160deg,#1a1040,#0a0518)",
    keno: "linear-gradient(160deg,#2a2a10,#15150a)",
    instant: "linear-gradient(160deg,#102a1a,#05180c)",
  };
  return palettes[g.game_type] || "var(--card-2)";
}
