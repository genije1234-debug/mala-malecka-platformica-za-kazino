import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import type { GameSummary, PlayResult, JackpotState } from "@casino/shared";
import type { ProfileData, OnUpdate } from "../App.tsx";
import { translate } from "../i18n.ts";
import { useTweenedJackpots } from "../jackpotAnim.ts";

const SYMBOLS = ["CHERRY", "LEMON", "ORANGE", "PLUM", "GRAPES", "WATERMELON", "SEVEN", "STAR"];
const IMG: Record<string, string> = {
  CHERRY: "/symbols/cherry.png",
  LEMON: "/symbols/lemon.png",
  ORANGE: "/symbols/orange.png",
  PLUM: "/symbols/plum.png",
  GRAPES: "/symbols/grapes.png",
  WATERMELON: "/symbols/watermelon.png",
  SEVEN: "/symbols/seven.png",
  STAR: "/symbols/star.png",
};

const FILL = 18;
const LINE_COLORS = ["#f5b400", "#34d399", "#4f8cff", "#ef4444", "#a78bfa", "#f472b6", "#22d3ee", "#fde047"];

// Brzina igre: sporo / srednje / brzo (kao na pravom aparatu - "BRZINA").
// ~20% brže od prethodnog tempa.
const SPEEDS = [
  // cycle = ukupno vreme po spinu (od početka do početka sledećeg) ->
  //   Brzo 1000ms = 60/min, Srednje 1500ms = 40/min, Sporo 3000ms = 20/min.
  // min/land/stagger su animacija (mora da stane u cycle); ostatak je pauza za rezultat.
  { label: "Sporo", cycle: 3000, min: 1500, land: 700, stagger: 90, cls: "slow" },
  { label: "Srednje", cycle: 1500, min: 700, land: 380, stagger: 55, cls: "" },
  { label: "Brzo", cycle: 1000, min: 440, land: 230, stagger: 34, cls: "turbo" },
];

type Phase = "idle" | "spinning" | "landing" | "done";

const rnd = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

// Generiše linije: prve su prave (po redu), pa zig-zag putanje sa korakom <=1.
function buildPaylines(rows: number, cols: number, count: number): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < rows; r++) lines.push(Array(cols).fill(r));
  const all: number[][] = [];
  const rec = (cur: number[]) => {
    if (all.length > 800 || cur.length === cols) {
      if (cur.length === cols) all.push([...cur]);
      return;
    }
    const last = cur[cur.length - 1];
    for (let r = 0; r < rows; r++) if (cur.length === 0 || Math.abs(r - last) <= 1) rec([...cur, r]);
  };
  rec([]);
  for (const p of all) {
    if (lines.length >= count) break;
    if (p.every((x) => x === p[0])) continue;
    if (!lines.some((l) => l.join() === p.join())) lines.push(p);
  }
  return lines.slice(0, count);
}

function betPresets(g: GameSummary): number[] {
  const base = g.min_bet;
  const raw = [base, base * 2, base * 5, base * 10, base * 25];
  return Array.from(new Set(raw.map((v) => Math.min(g.max_bet, +v.toFixed(2))))).slice(0, 5);
}

export function Slot({
  game,
  profile,
  jackpots,
  onUpdate,
  showToast,
}: {
  game: GameSummary;
  profile: ProfileData;
  jackpots: JackpotState[];
  onUpdate: OnUpdate;
  showToast: (m: string) => void;
}) {
  const COLS = game.slot?.reels ?? 5;
  const ROWS = game.slot?.rows ?? 3;
  const LINES = game.slot?.lines ?? 5;
  const CELL = Math.max(46, Math.min(96, Math.round(290 / COLS)));

  const PAYLINES = useMemo(() => buildPaylines(ROWS, COLS, LINES), [ROWS, COLS, LINES]);
  const randomGrid = () => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, rnd));

  const presets = useMemo(() => betPresets(game), [game]);
  const [bet, setBet] = useState(presets[0] ?? Math.max(game.min_bet, 1));
  const [grid, setGrid] = useState<string[][]>(randomGrid);
  const [phase, setPhase] = useState<Phase>("idle");
  const [spinKey, setSpinKey] = useState(0);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [wins, setWins] = useState<{ line: number[]; count: number }[]>([]);
  const [activeWin, setActiveWin] = useState(0);
  const [shownWin, setShownWin] = useState(0);
  const [jackpotPop, setJackpotPop] = useState<PlayResult["jackpot_win"] | null>(null);
  const [speed, setSpeed] = useState(1);
  const [auto, setAuto] = useState(false);
  const [muted, setMuted] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const acRef = useRef<AudioContext | null>(null);
  const autoRef = useRef(false);
  autoRef.current = auto;
  const spinStartRef = useRef(0); // početak tekućeg spina
  const nextStartRef = useRef(0); // apsolutni cilj početka sledećeg spina (drift-free kadenca)

  function winningLines(g: string[][]): { line: number[]; count: number }[] {
    const out: { line: number[]; count: number }[] = [];
    for (const line of PAYLINES) {
      const sym = g[line[0]][0];
      let count = 1;
      for (let c = 1; c < COLS; c++) {
        if (g[line[c]][c] === sym) count++;
        else break;
      }
      if (count >= 3) out.push({ line, count });
    }
    return out;
  }

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (phase !== "done" || wins.length === 0) return;
    const id = setInterval(() => setActiveWin((i) => (i + 1) % wins.length), 800);
    return () => clearInterval(id);
  }, [phase, wins.length]);

  const spinning = phase === "spinning" || phase === "landing";
  const canAfford = profile.balance >= bet;

  const winCells = useMemo(() => {
    const s = new Set<string>();
    if (phase === "done" && wins.length) {
      const w = wins[activeWin % wins.length];
      for (let c = 0; c < w.count; c++) s.add(`${w.line[c]}-${c}`);
    }
    return s;
  }, [phase, wins, activeWin]);

  function beep(freq: number, dur: number, type: OscillatorType = "sine", when = 0) {
    if (muted) return;
    try {
      const ac = (acRef.current ??= new (window.AudioContext || (window as any).webkitAudioContext)());
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ac.destination);
      const t = ac.currentTime + when;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    } catch {
      /* audio nedostupan */
    }
  }

  async function spin(mode: "REAL" | "FREEBET") {
    if (spinning) return;
    if (mode === "REAL" && !canAfford) {
      showToast(translate("INSUFFICIENT_FUNDS"));
      setAuto(false);
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    spinStartRef.current = performance.now();
    setResult(null);
    setWins([]);
    setActiveWin(0);
    setShownWin(0);
    setPhase("spinning");
    setSpinKey((k) => k + 1);
    beep(220, 0.08, "square");

    const sp = SPEEDS[speed];
    const minSpinMs = sp.min;
    const landMs = sp.land;
    const stagger = sp.stagger;

    try {
      const res = await api.post<PlayResult>("/round/start", { gameId: game.game_id, betAmount: bet, mode });
      const o: any = res.outcome;
      const finalGrid: string[][] = Array.isArray(o?.grid) ? o.grid : randomGrid();

      const t1 = setTimeout(() => {
        setGrid(finalGrid);
        setPhase("landing");
        const total = landMs + stagger * (COLS - 1);
        const t2 = setTimeout(() => {
          setPhase("done");
          setResult(res);
          if (res.final_win > 0) {
            setWins(winningLines(finalGrid));
            countUp(res.final_win);
            beep(660, 0.12, "triangle", 0);
            beep(880, 0.14, "triangle", 0.12);
            beep(1180, 0.18, "triangle", 0.26);
          }
          if (res.jackpot_win) setJackpotPop(res.jackpot_win);
          onUpdate({ balance: res.balance, freebet_balance: res.freebet_balance });
        }, total);
        timers.current.push(t2);
      }, minSpinMs);
      timers.current.push(t1);
    } catch (e: any) {
      showToast(translate(e.message));
      setPhase("idle");
      setAuto(false);
    }
  }

  function countUp(target: number) {
    const startT = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startT) / dur);
      setShownWin(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
      else setShownWin(target);
    };
    requestAnimationFrame(tick);
  }

  useEffect(() => {
    if (phase === "done" && autoRef.current && !jackpotPop) {
      if (profile.balance < bet) {
        setAuto(false);
        return;
      }
      // Drift-free kadenca: cilj sledećeg starta = prethodni cilj + cycle.
      // Sitno kašnjenje tajmera se samo-koriguje pa rate ostaje 60/40/20/min.
      const now = performance.now();
      const cycle = SPEEDS[speed].cycle;
      if (!nextStartRef.current || nextStartRef.current < spinStartRef.current) {
        nextStartRef.current = spinStartRef.current; // (re)usidri na prvi auto-spin
      }
      nextStartRef.current += cycle;
      let wait = nextStartRef.current - now;
      if (wait < 120) {
        wait = 120; // animacija ne stiže u cycle -> resinhronizuj
        nextStartRef.current = now + 120;
      }
      const t = setTimeout(() => spin("REAL"), wait);
      timers.current.push(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const isWin = phase === "done" && result != null && result.final_win > 0;
  const status = spinning
    ? "SREĆNO..."
    : !canAfford
      ? "NEDOVOLJNA SREDSTVA"
      : isWin
        ? `DOBITNE LINIJE: ${wins.length}`
        : "POSTAVI ULOG I ZAVRTI";

  return (
    <div className="slot-cabinet" style={{ ["--cell" as any]: `${CELL}px` }}>
      <JackpotPanel jackpots={jackpots} currency={profile.currency} />

      <div className="slot-name-banner">
        {game.name}
        <span className="slot-lines-badge">{LINES} {LINES === 1 ? "LINIJA" : "LINIJA"}</span>
      </div>

      <div className={`slot-window ${isWin ? "win" : ""}`}>
        <div className="slot-reels" style={{ height: ROWS * CELL, gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {Array.from({ length: COLS }).map((_, c) => (
            <Reel
              key={c}
              index={c}
              phase={phase}
              spinKey={spinKey}
              speed={speed}
              cell={CELL}
              rows={ROWS}
              finals={Array.from({ length: ROWS }, (_, r) => grid[r][c])}
              winCells={winCells}
            />
          ))}
          {phase === "done" && wins.length > 0 && (
            <svg className="slot-lines-svg" viewBox={`0 0 ${COLS} ${ROWS}`} preserveAspectRatio="none">
              {wins.map((w, i) => (
                <polyline
                  key={i}
                  points={w.line.slice(0, w.count).map((r, c) => `${c + 0.5},${r + 0.5}`).join(" ")}
                  fill="none"
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={i === activeWin % wins.length ? 0.12 : 0.05}
                  strokeOpacity={i === activeWin % wins.length ? 1 : 0.35}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}
        </div>
      </div>

      <div className="slot-meters">
        <div className="meter">
          <small>STANJE</small>
          <b>{profile.balance.toFixed(2)}</b>
        </div>
        <div className={`slot-status ${!canAfford && !spinning ? "warn" : ""}`}>{status}</div>
        <div className="meter right">
          <small>DOBITAK</small>
          <b className={isWin ? "hot" : ""}>{shownWin.toFixed(2)}</b>
        </div>
      </div>

      <div className="slot-chips">
        {presets.map((p) => (
          <button key={p} className={`chip-bet ${bet === p ? "on" : ""}`} onClick={() => setBet(p)} disabled={spinning}>
            {p.toFixed(2)}
          </button>
        ))}
      </div>

      <div className="slot-speed">
        <span className="slot-speed-label">BRZINA</span>
        {SPEEDS.map((s, i) => (
          <button key={s.label} className={`spd ${speed === i ? "on" : ""}`} onClick={() => setSpeed(i)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="slot-actions">
        <button className={`slot-side ${auto ? "on" : ""}`} onClick={() => setAuto((a) => !a)} disabled={!canAfford && !auto} title="Auto">
          🔁
        </button>
        <button className={`slot-spin-btn ${spinning ? "spinning" : ""}`} onClick={() => spin("REAL")} disabled={spinning || !canAfford}>
          <span className="ico">↻</span>
          <span className="lbl">{spinning ? "" : "SPIN"}</span>
        </button>
        <button className={`slot-side ${muted ? "off" : "on"}`} onClick={() => setMuted((m) => !m)} title="Zvuk">
          {muted ? "🔇" : "🔊"}
        </button>
        {profile.freebet_balance >= bet ? (
          <button className="slot-side fb" onClick={() => spin("FREEBET")} disabled={spinning} title="Free bet">
            🎁
          </button>
        ) : (
          <div className="slot-side ghost" />
        )}
      </div>

      {jackpotPop && (
        <div className="jackpot-pop" onClick={() => setJackpotPop(null)}>
          <div className="box">
            <h1>🎉 {jackpotPop.name} JACKPOT! 🎉</h1>
            <div className="amt">+{jackpotPop.amount.toFixed(2)} {profile.currency}</div>
            <p style={{ color: "var(--muted)" }}>Tapni da zatvoriš</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Jackpot kartice (žive, rastu) ----------

function JackpotPanel({ jackpots, currency }: { jackpots: JackpotState[]; currency: string }) {
  const sorted = useMemo(() => [...jackpots].sort((a, b) => b.current_amount - a.current_amount), [jackpots]);
  const big = sorted.slice(0, 2);
  const cards = sorted.slice(2, 6);

  const disp = useTweenedJackpots(jackpots);

  return (
    <div className="jp-panel">
      <div className="jp-big-row">
        {big.map((j) => (
          <div key={j.jackpot_id} className="jp-big" style={{ ["--c" as any]: j.color }}>
            <span className="jp-big-name">{j.name.toUpperCase()}</span>
            <span className="jp-big-amt">
              {fmtMoney(disp[j.jackpot_id] ?? j.current_amount)} {currency}
            </span>
          </div>
        ))}
      </div>
      <div className="jp-cards">
        {cards.map((j) => (
          <div key={j.jackpot_id} className={`jp-card2 ${j.active ? "on" : "off"}`} style={{ ["--c" as any]: j.color }}>
            <span className="jp-card2-name">{j.name}</span>
            <span className="jp-card2-amt">{fmtMoney(disp[j.jackpot_id] ?? j.current_amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Reel({
  index,
  phase,
  spinKey,
  speed,
  cell,
  rows,
  finals,
  winCells,
}: {
  index: number;
  phase: Phase;
  spinKey: number;
  speed: number;
  cell: number;
  rows: number;
  finals: string[];
  winCells: Set<string>;
}) {
  const sp = SPEEDS[speed];
  const looping = phase === "spinning";
  const landStrip = useMemo(() => [...Array.from({ length: FILL }, rnd), ...finals], [spinKey, finals.join()]);
  const loopStrip = useMemo(() => Array.from({ length: 8 }, rnd), [spinKey]);

  const [y, setY] = useState(-FILL * cell);
  useEffect(() => {
    if (phase === "landing") {
      setY(0);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setY(-FILL * cell)));
      return () => cancelAnimationFrame(r);
    }
    if (phase === "idle" || phase === "done") setY(-FILL * cell);
  }, [phase, spinKey, cell]);

  if (looping) {
    return (
      <div className="reel" style={{ height: rows * cell }}>
        <div className={`reel-inner spin ${sp.cls}`} style={{ ["--cell" as any]: `${cell}px` }}>
          {loopStrip.concat(loopStrip).map((s, i) => (
            <Cell key={i} sym={s} />
          ))}
        </div>
      </div>
    );
  }

  const landMs = sp.land;
  const stagger = sp.stagger;
  const transition = phase === "landing" ? `transform ${landMs}ms cubic-bezier(.16,.84,.28,1.05) ${index * stagger}ms` : "none";
  return (
    <div className="reel" style={{ height: rows * cell }}>
      <div className="reel-inner" style={{ transform: `translateY(${y}px)`, transition }}>
        {landStrip.map((s, i) => {
          const isFinal = i >= landStrip.length - rows;
          const rowIdx = i - (landStrip.length - rows);
          const hit = isFinal && winCells.has(`${rowIdx}-${index}`);
          return <Cell key={i} sym={s} hit={hit} />;
        })}
      </div>
    </div>
  );
}

function Cell({ sym, hit }: { sym: string; hit?: boolean }) {
  return (
    <div className={`reel-cell ${hit ? "hit" : ""}`}>
      <img src={IMG[sym]} alt={sym} draggable={false} />
    </div>
  );
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
