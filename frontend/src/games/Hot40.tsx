import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import type { GameSummary, PlayResult, JackpotState } from "@casino/shared";
import type { ProfileData, OnUpdate } from "../App.tsx";
import { translate } from "../i18n.ts";
import { useTweenedJackpots } from "../jackpotAnim.ts";
import { createH40Audio, type H40Audio } from "./hot40audio.ts";
import "./hot40.css";

/**
 * 40 Blazing Hot — puna obrada (EGT/Amusnet stil, portret 1:1 po referentnim snimcima).
 * Backend šalje PRAVE linijske dobitke (pattern + iznos); front samo crta.
 * Tempo, konteksti dugmadi, plamen efekat i gamble — sve po merenjima iz videa.
 */

const SYMS = ["CHERRY", "LEMON", "ORANGE", "PLUM", "GRAPES", "WATERMELON", "SEVEN", "STAR"] as const;
const IMG: Record<string, string> = {
  CHERRY: "/symbols-hot40/cherry.png",
  LEMON: "/symbols-hot40/lemon.png",
  ORANGE: "/symbols-hot40/orange.png",
  PLUM: "/symbols-hot40/plum.png",
  GRAPES: "/symbols-hot40/grapes.png",
  WATERMELON: "/symbols-hot40/watermelon.png",
  SEVEN: "/symbols-hot40/seven.png",
  STAR: "/symbols-hot40/star.png",
};

const ROWS = 4;
const COLS = 5;
const FILL = 14; // simbola u traci pre finalnih (landing strip)

interface LineWin {
  line: number;
  pattern: number[];
  symbol: string;
  count: number;
  amount: number;
}

type Phase = "idle" | "spinning" | "landing" | "done";

/**
 * Tempo IZMEREN iz referentnih videa (motion analiza). TRI brzine:
 *  - first: prva rolna staje X ms posle starta spina
 *  - land:  trajanje decelerate animacije rolne
 *  - stagger: razmak zaustavljanja susednih rolni
 *  - gap: autoplay pauza posle zadnje rolne (bez dobitka)
 *  - winPause: autoplay pauza za prezentaciju dobitka
 */
const TEMPO = {
  normal: { first: 850, land: 450, stagger: 325, gap: 100, winPause: 2600 },
  quick: { first: 850, land: 380, stagger: 100, gap: 130, winPause: 1400 },
  turbo: { first: 300, land: 200, stagger: 0, gap: 60, winPause: 800 },
};
type Tempo = (typeof TEMPO)["normal"];
const SPEEDS = [TEMPO.normal, TEMPO.quick, TEMPO.turbo];
const SPEED_LABELS = ["SPORO", "SREDNJE", "NAJBRŽE"];
const SKIP_TEMPO: Tempo = { first: 0, land: 120, stagger: 0, gap: 60, winPause: 800 };

const LINE_COLORS = ["#b14cf0", "#ffd24a", "#4cc9f0", "#ff5d73", "#7cfc00", "#ff9e2c", "#ff4fa3", "#19d3a2"];

const rnd = () => SYMS[Math.floor(Math.random() * SYMS.length)];
const SPIN_PACKS = [10, 20, 50, 100, Infinity];

function fmt(n: number): string {
  return new Intl.NumberFormat("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
function fmt0(n: number): string {
  return new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 }).format(n);
}

interface GambleSt {
  round_id: string;
  amount: number;
  to_win: number;
  attempts_left: number;
  history: string[];
  status: "OPEN" | "LOST" | "CLOSED";
}
interface GambleRes extends GambleSt {
  result: "WIN" | "LOSE";
  card: string;
  balance: number;
}

export function Hot40({
  game,
  profile,
  jackpots,
  onUpdate,
  onBack,
  showToast,
}: {
  game: GameSummary;
  profile: ProfileData;
  jackpots: JackpotState[];
  onUpdate: OnUpdate;
  onBack: () => void;
  showToast: (m: string) => void;
}) {
  const ladder = useMemo(
    () => (game.bets && game.bets.length ? game.bets : [0.4, 0.6, 0.8, 1, 2, 5, 10, 20, 50, 100]),
    [game.bets],
  );
  const [betIdx, setBetIdx] = useState(() => Math.max(0, ladder.findIndex((b) => b >= Math.max(game.min_bet, 0.6))));
  const bet = ladder[betIdx];

  const [grid, setGrid] = useState<string[][]>(() =>
    Array.from({ length: ROWS }, () => Array.from({ length: COLS }, rnd)),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [spinKey, setSpinKey] = useState(0);
  const [landTempo, setLandTempo] = useState<Tempo>(TEMPO.normal);
  const [lineWins, setLineWins] = useState<LineWin[]>([]);
  const [scatterCells, setScatterCells] = useState<Array<[number, number]>>([]);
  const [activeWin, setActiveWin] = useState(0);
  const [shownWin, setShownWin] = useState(0);
  const [counting, setCounting] = useState(false);
  const [lastWin, setLastWin] = useState(0);
  const [totalWin, setTotalWin] = useState(0);
  const [jackpotPop, setJackpotPop] = useState<PlayResult["jackpot_win"] | null>(null);
  const [lastRoundId, setLastRoundId] = useState<string | null>(null);
  const [gambleUsed, setGambleUsed] = useState(false);
  const [gamble, setGamble] = useState<GambleSt | null>(null);

  // podesavanja
  const [sound, setSound] = useState(true);
  const [speed, setSpeed] = useState(0); // 0=sporo 1=srednje 2=najbrze
  const speedRef = useRef(0);
  speedRef.current = speed;
  const [modal, setModal] = useState<null | "bet" | "menu">(null);
  const [menuTab, setMenuTab] = useState<"settings" | "auto" | "info" | "history">("settings");
  const [spinPicker, setSpinPicker] = useState(false);

  // autoplay
  const [autoLeft, setAutoLeft] = useState(0); // 0 = iskljucen; Infinity = ∞
  const autoLeftRef = useRef(0);
  autoLeftRef.current = autoLeft;
  const autoStart = useRef(0);
  const [stopLoss, setStopLoss] = useState(0);
  const [stopWin, setStopWin] = useState(0);
  const [stopGain, setStopGain] = useState(0);

  const turboRef = useRef(false); // drzanje SPIN = najbrze (za taj spin)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<H40Audio | null>(null);
  const audio = (audioRef.current ??= createH40Audio());
  const balRef = useRef(profile.balance);
  balRef.current = profile.balance;

  useEffect(() => {
    audio.setEnabled(sound);
  }, [sound, audio]);
  useEffect(
    () => () => {
      audio.spinEnd();
      audio.stopCount();
    },
    [audio],
  );

  // tok spina (apsolutno vreme, da tempo bude tacan i kad mreza kasni)
  const spinStartRef = useRef(0);
  const pendingRef = useRef<null | {
    res: PlayResult;
    finalGrid: string[][];
    wins: LineWin[];
    scat: Array<[number, number]>;
    tp: Tempo;
  }>(null);
  const skipRef = useRef(false);
  const countRaf = useRef(0);
  const totalWinRef = useRef(0);
  totalWinRef.current = totalWin;

  // loading ekran (preload simbola) — puni se postepeno do 100 (~3.5s, kao original)
  const [loadProg, setLoadProg] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const urls = Object.values(IMG);
    let real = 0;
    urls.forEach((u) => {
      const im = new Image();
      const bump = () => {
        real++;
      };
      im.onload = bump;
      im.onerror = bump;
      im.src = u;
    });
    const DUR = 3500;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // vremenska rampa, ali ne ispred stvarnog ucitavanja (zadnjih 10% ceka slike)
      const timeP = Math.min(1, (now - t0) / DUR);
      const gate = real >= urls.length ? 1 : 0.9;
      const p = Math.min(timeP, gate);
      setLoadProg(p);
      if (p >= 1) {
        setTimeout(() => setLoaded(true), 350);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // sat (dole desno)
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  // velicina celije: 5 kolona preko cele sirine; VISINA = sirina/1.5
  // (original ima pravougaona polja ~90x60, ne kvadratna -> nizi igraci deo)
  const cellH = () => Math.round((Math.min(window.innerWidth, 520) - 12) / COLS / 1.5);
  const [cell, setCell] = useState(cellH);
  useEffect(() => {
    const f = () => setCell(cellH());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      cancelAnimationFrame(countRaf.current);
    },
    [],
  );

  // ciklicno prikazivanje dobitnih linija (uz kratak akordski tik kao original)
  useEffect(() => {
    if (phase !== "done" || lineWins.length === 0) return;
    const id = setInterval(() => {
      setActiveWin((i) => (i + 1) % lineWins.length);
      if (lineWins.length > 1) audio.lineTick();
    }, 900);
    return () => clearInterval(id);
  }, [phase, lineWins.length]);

  const spinning = phase === "spinning" || phase === "landing";
  const canAfford = profile.balance >= bet;
  const inAuto = autoLeft > 0;
  const canGamble =
    phase === "done" && totalWin > 0 && lastRoundId != null && !gambleUsed && !inAuto && !jackpotPop;

  function tempo(): Tempo {
    if (turboRef.current) return TEMPO.turbo;
    return SPEEDS[speedRef.current] ?? TEMPO.normal;
  }

  function stopAuto() {
    setAutoLeft(0);
  }

  async function spin() {
    if (spinning) return;
    if (!canAfford) {
      showToast(translate("INSUFFICIENT_FUNDS"));
      stopAuto();
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(countRaf.current);
    audio.stopCount(); // ubij petlju brojanja ako jos vrti (dug veliki dobitak)
    setCounting(false);
    setLineWins([]);
    setScatterCells([]);
    setActiveWin(0);
    setShownWin(0);
    setGamble(null);
    setGambleUsed(false);
    setPhase("spinning");
    setSpinKey((k) => k + 1);
    skipRef.current = false;
    spinStartRef.current = performance.now();
    audio.unlock();
    // klik samo na rucni spin — autoplay je necujan na startu (kao original)
    audio.spinStart(autoLeftRef.current <= 0);

    const tp = tempo();
    try {
      // postIdem: kratak prekid tunela/veze se sam ponovi BEZ duplog uloga
      const res = await api.postIdem<PlayResult>("/round/start", {
        gameId: game.game_id,
        betAmount: bet,
        mode: "REAL",
      });
      const o: any = res.outcome;
      const finalGrid: string[][] = Array.isArray(o?.grid) ? o.grid : grid;
      const wins: LineWin[] = Array.isArray(o?.line_wins) ? o.line_wins : [];
      const scat: Array<[number, number]> = o?.scatter_win?.cells ?? [];
      pendingRef.current = { res, finalGrid, wins, scat, tp };

      if (skipRef.current) {
        land(true);
        return;
      }
      // Prva rolna staje tacno tp.first posle starta -> landing krece first-land.
      const wait = Math.max(0, spinStartRef.current + tp.first - tp.land - performance.now());
      const t1 = setTimeout(() => land(false), wait);
      timers.current.push(t1);
    } catch (e: any) {
      showToast(translate(e.message));
      setPhase("idle");
      pendingRef.current = null;
      stopAuto();
    }
  }

  function land(skip: boolean) {
    const p = pendingRef.current;
    if (!p) return;
    const tp = skip ? SKIP_TEMPO : p.tp;
    setLandTempo(tp);
    setGrid(p.finalGrid);
    setPhase("landing");
    audio.reelStops(tp.land, tp.stagger, COLS);
    const total = tp.land + tp.stagger * (COLS - 1);
    const t2 = setTimeout(() => finish(), total);
    timers.current.push(t2);
  }

  function finish() {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    const { res, wins, scat, tp } = p;
    setPhase("done");
    audio.spinEnd();
    setLastRoundId(res.round_id);
    // POSLEDNJI DOBITAK stoji do sledeceg dobitka (ne brise se na gubitnom spinu)
    if (res.final_win > 0) setLastWin(res.final_win);
    if (res.final_win > 0) {
      setLineWins(wins.map((w) => ({ ...w, amount: w.amount * bet })));
      setScatterCells(scat);
      setTotalWin(res.final_win);
      const dur = inAutoRefSafe()
        ? Math.min(tp.winPause - 200, 400 + res.final_win * 25)
        : Math.min(2200, 400 + res.final_win * 30);
      countUp(res.final_win, Math.max(350, dur));
      audio.winFanfare(res.final_win / bet);
    } else {
      setTotalWin(0);
    }
    if (res.jackpot_win) {
      setJackpotPop(res.jackpot_win);
      stopAuto();
    }
    onUpdate({ balance: res.balance, freebet_balance: res.freebet_balance });
    afterSpin(res, tp);
  }

  function inAutoRefSafe() {
    return autoLeftRef.current > 0;
  }

  /** STOP tokom spina — preskoci animaciju. */
  function skipSpin() {
    if (phase === "spinning") {
      if (pendingRef.current) {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        land(true);
      } else {
        skipRef.current = true; // odgovor jos putuje -> sleti cim stigne
      }
    } else if (phase === "landing") {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      finish();
    }
  }

  /** Autoplay: stop uslovi + sledeci spin (kadenca po merenjima). */
  function afterSpin(res: PlayResult, tp: Tempo) {
    const left = autoLeftRef.current;
    if (left <= 0) return;
    const next = left === Infinity ? Infinity : left - 1;
    setAutoLeft(next);
    const diff = res.balance - autoStart.current;
    const stop =
      next <= 0 ||
      (stopLoss > 0 && -diff >= stopLoss) ||
      (stopWin > 0 && res.final_win >= stopWin) ||
      (stopGain > 0 && diff >= stopGain) ||
      res.balance < bet;
    if (stop) {
      setAutoLeft(0);
      return;
    }
    const pause = res.final_win > 0 ? tp.winPause : tp.gap;
    const t = setTimeout(() => spinAgain(), pause);
    timers.current.push(t);
  }

  const spinAgainRef = useRef(() => {});
  spinAgainRef.current = () => spin();
  function spinAgain() {
    spinAgainRef.current();
  }

  function countUp(target: number, dur: number) {
    cancelAnimationFrame(countRaf.current);
    setCounting(true);
    // veliki dobitak (>=10x ulog) -> muzicka petlja; mali -> nisko predenje
    audio.startCount(target >= bet * 10);
    const startT = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startT) / dur);
      setShownWin(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) countRaf.current = requestAnimationFrame(tick);
      else {
        setShownWin(target);
        setCounting(false);
        audio.stopCount(true); // silazni "purr" rep — brojac legne
      }
    };
    countRaf.current = requestAnimationFrame(tick);
  }

  /** COLLECT — odmah zavrsi brojanje. */
  function collectNow() {
    cancelAnimationFrame(countRaf.current);
    setShownWin(totalWinRef.current);
    setCounting(false);
    audio.collect();
  }

  function startAutoplay(count: number) {
    setSpinPicker(false);
    setModal(null);
    autoStart.current = balRef.current;
    setAutoLeft(count);
    if (!spinning) spin();
  }

  // SPIN dugme: hold = turbo; tap tokom spina = STOP (skip); tap u autoplay = stop auto
  function spinDown() {
    if (inAuto) return;
    if (spinning) return;
    holdTimer.current = setTimeout(() => {
      turboRef.current = true;
      if (!spinning) spin();
    }, 450);
  }
  function spinUp() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (inAuto) {
      stopAuto();
      return;
    }
    if (turboRef.current) {
      turboRef.current = false;
      return;
    }
    if (spinning) {
      skipSpin();
      return;
    }
    if (counting) {
      collectNow();
      return;
    }
    spin();
  }

  // ---- GAMBLE ----
  async function openGamble() {
    if (!lastRoundId) return;
    collectNow();
    stopAuto();
    try {
      const st = await api.post<GambleSt>("/round/gamble/state", { roundId: lastRoundId });
      if (st.status !== "OPEN") return;
      setGamble(st);
    } catch (e: any) {
      showToast(translate(e.message));
    }
  }
  function closeGamble(finalAmount: number | null) {
    setGamble(null);
    setGambleUsed(true);
    if (finalAmount != null) {
      setLastWin(finalAmount);
      setTotalWin(finalAmount);
      setShownWin(finalAmount);
      if (finalAmount === 0) {
        setLineWins([]);
        setScatterCells([]);
      }
    }
  }

  // SVE dobitne celije gore odjednom (kao original); linija/poruka rotira posebno.
  const winCells = useMemo(() => {
    const s = new Set<string>();
    if (phase !== "done") return s;
    for (const w of lineWins) {
      for (let c = 0; c < w.count; c++) s.add(`${w.pattern[c]}-${c}`);
    }
    for (const [r, c] of scatterCells) s.add(`${r}-${c}`);
    return s;
  }, [phase, lineWins, scatterCells]);

  const activeLine = phase === "done" && lineWins.length ? lineWins[activeWin % lineWins.length] : null;
  const lineColor = activeLine ? LINE_COLORS[activeLine.line % LINE_COLORS.length] : "#ffd24a";

  // poruka u centru statusa
  let message: ReactNode = "MOLIMO POSTAVITE VAŠ ULOG";
  if (spinning) message = inAuto ? "" : "SREĆNO!";
  else if (phase === "done" && totalWin > 0) {
    if (activeLine) {
      message = (
        <>
          LINIJA {activeLine.line + 1}&nbsp;&nbsp;{activeLine.count}x{" "}
          <img className="h40-msg-sym" src={IMG[activeLine.symbol]} alt="" /> = {fmt(activeLine.amount)}
        </>
      );
    } else if (scatterCells.length) {
      message = (
        <>
          {scatterCells.length}x <img className="h40-msg-sym" src={IMG.STAR} alt="" /> = {fmt(totalWin)}
        </>
      );
    } else message = `DOBITAK ${fmt(totalWin)}`;
  } else if (!canAfford) message = "NEDOVOLJAN BALANS";

  // bet red kontekst (red je UVEK vidljiv kao u originalu):
  // brojanje -> COLLECT; bilo koja vrtnja (rucna ili auto) -> STOP ALL; inace izbor uloga
  const betContext: "bet" | "stopall" | "collect" = counting
    ? "collect"
    : inAuto || spinning
      ? "stopall"
      : "bet";

  const betRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = betRowRef.current?.querySelector(".h40-bet.on");
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" as ScrollBehavior });
  }, [betIdx, betContext]);

  function fullscreen() {
    const el = document.documentElement as any;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  return (
    <div className="h40">
      <TopJackpotBar jackpots={jackpots} currency={profile.currency} onFullscreen={fullscreen} />

      <div className="h40-body">
        {/* Header kao original: gornji red 2 VECA jackpota, donji red 2 manja,
            logo u sredini izmedju donja dva (preklapa oba reda). */}
        <div className="h40-head">
          <div className="h40-jp-row big">
            <JpPlaque cls="spade" big jackpots={jackpots} rank={0} currency={profile.currency} />
            <span className="h40-jp-gap" />
            <JpPlaque cls="heart" big jackpots={jackpots} rank={1} currency={profile.currency} />
          </div>
          <div className="h40-jp-row sm">
            <JpPlaque cls="diamond" jackpots={jackpots} rank={2} currency={profile.currency} />
            <span className="h40-jp-gap wide" />
            <JpPlaque cls="club" jackpots={jackpots} rank={3} currency={profile.currency} />
          </div>
          {/* jedan gotov logo (slika): emblem preko plocica, natpis ispod */}
          <img
            className="h40-logo-img"
            src="/symbols-hot40/logo.png"
            alt="40 Blazing Hot"
            draggable={false}
          />
        </div>

        <div className={`h40-reels-wrap ${phase === "done" && totalWin > 0 ? "win" : ""}`}>
          <div className="h40-reels" style={{ height: ROWS * cell }}>
            {Array.from({ length: COLS }).map((_, c) => (
              <Reel
                key={c}
                index={c}
                phase={phase}
                spinKey={spinKey}
                cell={cell}
                finals={Array.from({ length: ROWS }, (_, r) => grid[r][c])}
                winCells={winCells}
                hitColor={lineColor}
                tempo={landTempo}
              />
            ))}
            {activeLine && (
              <svg className="h40-lines-svg" viewBox={`0 0 ${COLS} ${ROWS}`} preserveAspectRatio="none">
                <polyline
                  points={activeLine.pattern.map((r, c) => `${c + 0.5},${r + 0.5}`).join(" ")}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={0.08}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {spinPicker && (
              <div className="h40-spin-picker" onClick={(e) => e.stopPropagation()}>
                {SPIN_PACKS.map((n) => (
                  <button key={String(n)} onClick={() => startAutoplay(n)}>
                    {n === Infinity ? "∞" : n}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="h40-status">
          <div className="h40-meter">
            <small>BALANS:</small>
            <b>{fmt(profile.balance)}</b>
            <i>{profile.currency}</i>
          </div>
          <div className={`h40-msg ${phase === "done" && totalWin > 0 ? "win" : ""}`}>
            <span className="h40-msg-line">{message}</span>
          </div>
          <div className="h40-meter right">
            {counting || (phase === "done" && totalWin > 0) ? (
              <>
                <small className="winlbl">DOBITAK:</small>
                <b className="winval">{fmt(shownWin)}</b>
                <i>{profile.currency}</i>
              </>
            ) : (
              <>
                <small>POSLEDNJI DOBITAK:</small>
                <b>{lastWin > 0 ? fmt(lastWin) : "-"}</b>
                <i>{profile.currency}</i>
              </>
            )}
          </div>
        </div>

        <div className="h40-betrow-wrap">
          {/* Red uloga je UVEK vidljiv (kao original): RSD tag u uglu, beli broj,
              natpis ispod se menja (STOP ALL / COLLECT). */}
          <div className="h40-betrow scroll" ref={betRowRef}>
            {ladder.map((v, i) => (
              <button
                key={v}
                className={`h40-bet ${i === betIdx ? "on" : ""}`}
                onClick={() => {
                  if (betContext === "collect") collectNow();
                  else if (betContext === "stopall") {
                    if (inAuto) stopAuto();
                    else skipSpin();
                  } else setBetIdx(i);
                }}
              >
                <small className="rsd">{profile.currency}</small>
                <b>{v < 100 ? v.toFixed(2) : fmt0(v)}</b>
                {betContext !== "bet" && (
                  <small className={`cap ${betContext === "collect" ? "collect" : "stop"}`}>
                    {betContext === "collect" ? "COLLECT" : "STOP ALL"}
                  </small>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="h40-controls">
          <div className="h40-auto-wrap">
            {canGamble ? (
              <button className="h40-ctrl gamble" onClick={openGamble} title="Dupliranje">
                x2
              </button>
            ) : (
              <button
                className={`h40-ctrl auto ${inAuto ? "on" : ""}`}
                onClick={() => (inAuto ? stopAuto() : setSpinPicker((s) => !s))}
                title="Autoplay"
              >
                <AutoIcon />
              </button>
            )}
          </div>

          <div className="h40-spin-wrap">
            <button
              className={`h40-ctrl spin ${spinning ? "spinning" : ""} ${inAuto ? "autoplay" : ""}`}
              disabled={!canAfford && !inAuto && !spinning && !counting}
              onPointerDown={spinDown}
              onPointerUp={spinUp}
              onPointerLeave={() => {
                if (holdTimer.current) {
                  clearTimeout(holdTimer.current);
                  holdTimer.current = null;
                }
              }}
            >
              {inAuto ? (
                <span className="h40-auto-count">{autoLeft === Infinity ? "∞" : autoLeft}</span>
              ) : spinning ? (
                <StopIcon />
              ) : counting ? (
                <CollectIcon />
              ) : (
                <SpinIcon />
              )}
            </button>
            <button
              className={`h40-quick s${speed}`}
              onClick={() => {
                audio.uiTap();
                setSpeed((s) => (s + 1) % 3);
              }}
              title={`Brzina: ${SPEED_LABELS[speed]}`}
            >
              <i className="on">▶</i>
              <i className={speed >= 1 ? "on" : ""}>▶</i>
              <i className={speed >= 2 ? "on" : ""}>▶</i>
            </button>
          </div>

          <button className="h40-ctrl chips" onClick={() => setModal("bet")} title="Ulozi" disabled={spinning || inAuto}>
            <ChipsIcon />
          </button>
        </div>

        <div className="h40-bottombar">
          <button onClick={onBack} title="Izlaz">
            <HomeIcon />
          </button>
          <span className="h40-bb-right">
            <button onClick={() => setSound((s) => !s)} title="Zvuk">
              {sound ? <VolIcon /> : <VolOffIcon />}
            </button>
            <button
              onClick={() => {
                setMenuTab("settings");
                setModal("menu");
              }}
              title="Meni"
            >
              <MenuIcon />
            </button>
          </span>
        </div>

        <div className="h40-meta">
          <span>{lastRoundId ? `#${lastRoundId.slice(-8)}` : ""}</span>
          <span>{clock.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      {modal === "bet" && (
        <div className="h40-overlay" onClick={() => setModal(null)}>
          <div className="h40-panel" onClick={(e) => e.stopPropagation()}>
            <div className="h40-panel-head">
              <span>OPCIJE ULOGA</span>
              <button className="h40-x" onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <div className="h40-bet-grid">
              {ladder.map((v, i) => (
                <button
                  key={v}
                  className={`h40-bet ${i === betIdx ? "on" : ""}`}
                  onClick={() => {
                    setBetIdx(i);
                    setModal(null);
                  }}
                >
                  <small>{profile.currency}</small>
                  <b>{v < 100 ? v.toFixed(2) : fmt0(v)}</b>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {modal === "menu" && (
        <MenuSheet
          tab={menuTab}
          setTab={setMenuTab}
          close={() => setModal(null)}
          game={game}
          profile={profile}
          bet={bet}
          sound={sound}
          setSound={setSound}
          speed={speed}
          setSpeed={setSpeed}
          stopLoss={stopLoss}
          setStopLoss={setStopLoss}
          stopWin={stopWin}
          setStopWin={setStopWin}
          stopGain={stopGain}
          setStopGain={setStopGain}
          startAutoplay={startAutoplay}
        />
      )}

      {gamble && (
        <GambleOverlay
          initial={gamble}
          currency={profile.currency}
          balance={profile.balance}
          jackpots={jackpots}
          onBalance={(b) => onUpdate({ balance: b })}
          onClose={closeGamble}
          audio={audio}
        />
      )}

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

      {!loaded && (
        <div className="h40-loading">
          <div className="h40-load-logo">
            <span className="h40-load-a">A</span>
          </div>
          <div className="h40-load-name">
            <span className="h40-logo-40">40</span> <span className="h40-logo-txt">BLAZING HOT</span>
          </div>
          <div className="h40-load-bar">
            <i style={{ width: `${Math.round(loadProg * 100)}%` }} />
          </div>
          <span className="h40-load-pct">{Math.round(loadProg * 100)}%</span>
        </div>
      )}
    </div>
  );
}

// ---------------- GAMBLE ekran (dupliranje, crveno/crno) ----------------

const SUIT_GLYPH: Record<string, string> = { SPADE: "♠", CLUB: "♣", HEART: "♥", DIAMOND: "♦" };
const SUIT_RED = (s: string) => s === "HEART" || s === "DIAMOND";

function GambleOverlay({
  initial,
  currency,
  balance,
  jackpots,
  onBalance,
  onClose,
  audio,
}: {
  initial: GambleSt;
  currency: string;
  balance: number;
  jackpots: JackpotState[];
  onBalance: (b: number) => void;
  onClose: (finalAmount: number | null) => void;
  audio: H40Audio;
}) {
  const [st, setSt] = useState<GambleSt>(initial);
  const [history, setHistory] = useState<string[]>(initial.history);
  const [card, setCard] = useState<{ suit: string; up: boolean } | null>({ suit: "", up: false });
  const [banner, setBanner] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [shownAmt, setShownAmt] = useState(initial.amount);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // petlja napetosti dok se ceka izbor (karta poledjinom); gasi se na flip/kraj
  const waiting = !busy && card != null && !card.up;
  useEffect(() => {
    if (waiting) audio.gambleLoopStart();
    else audio.gambleLoopStop();
    return () => audio.gambleLoopStop();
  }, [waiting, audio]);

  async function pick(color: "RED" | "BLACK") {
    if (busy || !card || card.up) return;
    setBusy(true);
    try {
      const res = await api.post<GambleRes>("/round/gamble/play", { roundId: st.round_id, pick: color });
      onBalance(res.balance);
      audio.gambleFlip();
      // flip karte
      setCard({ suit: res.card, up: true });
      const t1 = setTimeout(() => {
        setHistory(res.history);
        if (res.result === "WIN") {
          audio.gambleWin();
          setBanner(res.amount);
          setShownAmt(res.amount);
          const t2 = setTimeout(() => {
            setBanner(null);
            setSt(res);
            if (res.status === "OPEN") {
              setCard({ suit: "", up: false }); // nova karta se deli
              setBusy(false);
            } else {
              onClose(res.amount); // max pokusaja -> automatska naplata
            }
          }, 1500);
          timers.current.push(t2);
        } else {
          // gubitak: WIN broji nanize do 0 pa nazad u igru
          audio.gambleLose();
          const from = st.amount;
          const start = performance.now();
          const dur = 900;
          const tick = (now: number) => {
            const p = Math.min(1, (now - start) / dur);
            setShownAmt(from * (1 - p));
            if (p < 1) requestAnimationFrame(tick);
            else {
              const t3 = setTimeout(() => onClose(0), 250);
              timers.current.push(t3);
            }
          };
          requestAnimationFrame(tick);
        }
      }, 550);
      timers.current.push(t1);
    } catch {
      setBusy(false);
    }
  }

  async function collect() {
    if (busy) return;
    audio.collect();
    try {
      await api.post("/round/gamble/collect", { roundId: st.round_id });
    } catch {
      /* sesija se svakako zatvara */
    }
    onClose(st.amount);
  }

  return (
    <div className="h40-gamble">
      <div className="h40-g-spots" />
      <div className="h40-g-suits">
        <SuitJackpots jackpots={jackpots} side="left" />
        <SuitJackpots jackpots={jackpots} side="right" />
      </div>

      <div className="h40-g-history">
        <small>ISTORIJA</small>
        <div className="h40-g-hist-row">
          <div className="h40-g-mini back" />
          {history.slice(-6).map((h, i) => (
            <div key={i} className={`h40-g-mini ${SUIT_RED(h) ? "red" : "black"}`}>
              {SUIT_GLYPH[h]}
            </div>
          ))}
        </div>
      </div>

      <div className="h40-g-amounts">
        <div className="h40-g-amt">
          <b>
            {fmt(st.amount)} <small>{currency}</small>
          </b>
          <span>IZNOS DUPLIRANJA</span>
        </div>
        <div className="h40-g-amt">
          <b>
            {fmt(st.to_win)} <small>{currency}</small>
          </b>
          <span>MOGUĆI DOBITAK</span>
        </div>
      </div>

      <div className="h40-g-stage">
        <div className="h40-g-podium" />
        <div className={`h40-g-card ${card?.up ? "up" : ""}`}>
          <div className="h40-g-face back" />
          <div className={`h40-g-face front ${card && SUIT_RED(card.suit) ? "red" : "black"}`}>
            <span className="corner tl">{card ? SUIT_GLYPH[card.suit] : ""}</span>
            <span className="big">{card ? SUIT_GLYPH[card.suit] : ""}</span>
            <span className="corner br">{card ? SUIT_GLYPH[card.suit] : ""}</span>
          </div>
        </div>
        {banner != null && (
          <div className="h40-g-banner">
            <span>DOBITAK</span>
            <b>{fmt(banner)}</b>
          </div>
        )}
      </div>

      <div className="h40-g-attempts">
        PREOSTALO POKUŠAJA <b>{st.attempts_left}</b>
      </div>

      <div className="h40-g-btns">
        <button className="h40-g-pick black" disabled={busy} onClick={() => pick("BLACK")}>
          ♠
        </button>
        <button className="h40-g-collect" disabled={busy} onClick={collect}>
          <CollectIcon />
          <span>NAPLATI</span>
        </button>
        <button className="h40-g-pick red" disabled={busy} onClick={() => pick("RED")}>
          ♥
        </button>
      </div>

      <div className="h40-g-foot">
        <span>
          BALANS: <b>{fmt(balance)} {currency}</b>
        </span>
        <span>
          DOBITAK: <b>{fmt(shownAmt)} {currency}</b>
        </span>
      </div>
    </div>
  );
}

// ---------------- Gornja traka: nasi jackpotovi u parovima (rotacija) ----------------

function TopJackpotBar({
  jackpots,
  currency,
  onFullscreen,
}: {
  jackpots: JackpotState[];
  currency: string;
  onFullscreen: () => void;
}) {
  const [page, setPage] = useState(0);
  const disp = useTweenedJackpots(jackpots);
  const pairs = useMemo(() => {
    const out: JackpotState[][] = [];
    for (let i = 0; i < jackpots.length; i += 2) out.push(jackpots.slice(i, i + 2));
    return out;
  }, [jackpots]);

  useEffect(() => {
    if (pairs.length <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pairs.length), 5000);
    return () => clearInterval(id);
  }, [pairs.length]);

  const pair = pairs[page % Math.max(pairs.length, 1)] ?? [];

  return (
    <div className="h40-topbar">
      <div className="h40-top-icon">
        <span className="ico">🎰</span>
        <span className="lbl">Slot</span>
      </div>
      <div className="h40-top-jps" key={page}>
        {pair.map((j) => (
          <div key={j.jackpot_id} className="h40-top-jp">
            <span className="nm" style={{ color: "#cfd6e4" }}>
              <i style={{ background: j.color }} /> {j.name.toUpperCase()}
            </span>
            <b>
              {fmt(disp[j.jackpot_id] ?? j.current_amount)} {currency}
            </b>
          </div>
        ))}
      </div>
      <button className="h40-fs" onClick={onFullscreen} title="Ceo ekran">
        ⛶
      </button>
    </div>
  );
}

// ---------------- Jackpot Cards plocice (4 najveca, po bojama karata) ----------------

const SUITS = [
  { glyph: "♠", cls: "spade" },
  { glyph: "♥", cls: "heart" },
  { glyph: "♦", cls: "diamond" },
  { glyph: "♣", cls: "club" },
];

/** Pojedinacna jackpot plocica u headeru: crna, zlatni okvir, beli broj, tag valute. */
function JpPlaque({
  jackpots,
  rank,
  cls,
  big,
  currency,
}: {
  jackpots: JackpotState[];
  rank: number;
  cls: string;
  big?: boolean;
  currency: string;
}) {
  const disp = useTweenedJackpots(jackpots);
  const top4 = useMemo(
    () => [...jackpots].sort((a, b) => b.current_amount - a.current_amount).slice(0, 4),
    [jackpots],
  );
  const j = top4[rank];
  const glyph = cls === "spade" ? "♠" : cls === "heart" ? "♥" : cls === "diamond" ? "♦" : "♣";
  if (!j) return <div className={`h40-plq ${cls} ${big ? "big" : "sm"} empty`} />;
  return (
    <div className={`h40-plq ${cls} ${big ? "big" : "sm"}`}>
      <span className="sg">{glyph}</span>
      <RollNum value={fmt(disp[j.jackpot_id] ?? j.current_amount)} />
      <span className="tag">{currency.toUpperCase().slice(0, 3)}</span>
    </div>
  );
}

function SuitJackpots({ jackpots, side }: { jackpots: JackpotState[]; side: "left" | "right" }) {
  const disp = useTweenedJackpots(jackpots);
  const top4 = useMemo(
    () => [...jackpots].sort((a, b) => b.current_amount - a.current_amount).slice(0, 4),
    [jackpots],
  );
  // levo: ♠ (1.) i ♦ (3.); desno: ♥ (2.) i ♣ (4.) — kao original
  const idx = side === "left" ? [0, 2] : [1, 3];
  return (
    <div className={`h40-suits ${side}`}>
      {idx.map((i) => {
        const j = top4[i];
        if (!j) return null;
        return (
          <div key={j.jackpot_id} className={`h40-suit ${SUITS[i].cls}`}>
            <span className="sg">{SUITS[i].glyph}</span>
            <RollNum value={fmt(disp[j.jackpot_id] ?? j.current_amount)} />
          </div>
        );
      })}
    </div>
  );
}

/** Cifre koje se "roluju" pri promeni (kao na originalnim plocicama). */
function RollNum({ value }: { value: string }) {
  return (
    <b className="h40-roll">
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="rd">
            <span key={`${i}:${ch}`} className="rdv">
              {ch}
            </span>
          </span>
        ) : (
          <span key={i} className="rs">
            {ch}
          </span>
        ),
      )}
    </b>
  );
}

// ---------------- Rolna ----------------

function Reel({
  index,
  phase,
  spinKey,
  cell,
  finals,
  winCells,
  hitColor,
  tempo,
}: {
  index: number;
  phase: Phase;
  spinKey: number;
  cell: number;
  finals: string[];
  winCells: Set<string>;
  hitColor: string;
  tempo: Tempo;
}) {
  // Finalni simboli su na VRHU trake: traka pri sletanju klizi NADOLE
  // (isti smer kao vrtnja) i cisto stane — bez "odbijanja" odozdo.
  const landStrip = useMemo(() => [...finals, ...Array.from({ length: FILL }, rnd)], [spinKey, finals.join()]);
  const loopStrip = useMemo(() => Array.from({ length: 8 }, rnd), [spinKey]);

  // Svaka rolna se VRTI dok ne dodje njen red da stane (rolna po rolna,
  // kao na originalu) — ne smrzava se dok ceka stagger.
  const [mode, setMode] = useState<"rest" | "loop" | "land">("rest");
  useEffect(() => {
    if (phase === "spinning") {
      setMode("loop");
      return;
    }
    if (phase === "landing") {
      const delay = index * tempo.stagger;
      if (delay <= 0) {
        setMode("land");
        return;
      }
      const t = setTimeout(() => setMode("land"), delay);
      return () => clearTimeout(t);
    }
    setMode("rest");
  }, [phase, spinKey, index, tempo.stagger]);

  // y=0 -> vide se finalni simboli (vrh trake). Sletanje: traku podignemo
  // BEZ animacije na -FILL*cell, pa je sa animacijom spustimo na 0 (nadole).
  const [y, setY] = useState(0);
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    if (mode === "land") {
      setAnim(false);
      setY(-FILL * cell);
      const r = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnim(true);
          setY(0);
        }),
      );
      return () => cancelAnimationFrame(r);
    }
    setAnim(false);
    if (mode === "rest") setY(0);
  }, [mode, spinKey, cell]);

  if (mode === "loop") {
    return (
      <div className="h40-reel" style={{ height: ROWS * cell }}>
        <div className="h40-reel-inner h40-spin-loop" style={{ ["--cell" as any]: `${cell}px` }}>
          {loopStrip.concat(loopStrip).map((s, i) => (
            <Cell key={i} sym={s} cell={cell} />
          ))}
        </div>
      </div>
    );
  }

  // ease-out BEZ overshoot-a + animacija tek od druge faze (anim flag),
  // da pocetno postavljanje trake ne napravi vidljiv skok.
  const transition =
    mode === "land" && anim ? `transform ${tempo.land}ms cubic-bezier(.22,.7,.3,1)` : "none";
  return (
    <div className="h40-reel" style={{ height: ROWS * cell }}>
      <div className="h40-reel-inner" style={{ transform: `translateY(${y}px)`, transition }}>
        {landStrip.map((s, i) => {
          const isFinal = i < ROWS;
          const rowIdx = i;
          const hit = isFinal && winCells.has(`${rowIdx}-${index}`);
          return (
            <Cell
              key={i}
              sym={s}
              cell={cell}
              hit={hit}
              hitColor={hitColor}
              dim={winCells.size > 0 && isFinal && !hit}
            />
          );
        })}
      </div>
    </div>
  );
}

function Cell({
  sym,
  cell,
  hit,
  hitColor,
  dim,
}: {
  sym: string;
  cell: number;
  hit?: boolean;
  hitColor?: string;
  dim?: boolean;
}) {
  return (
    <div
      className={`h40-cell ${hit ? "hit" : ""} ${dim ? "dim" : ""}`}
      style={{ height: cell, ...(hit && hitColor ? { ["--hitc" as any]: hitColor } : {}) }}
    >
      {hit && (
        <span className="h40-flame">
          <i className="f1" />
          <i className="f2" />
          <i className="f3" />
          <i className="f4" />
          <i className="f5" />
        </span>
      )}
      <img src={IMG[sym]} alt={sym} draggable={false} />
    </div>
  );
}

// ---------------- Meni (settings / autoplay / info / history) ----------------

function MenuSheet(props: {
  tab: "settings" | "auto" | "info" | "history";
  setTab: (t: "settings" | "auto" | "info" | "history") => void;
  close: () => void;
  game: GameSummary;
  profile: ProfileData;
  bet: number;
  sound: boolean;
  setSound: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  stopLoss: number;
  setStopLoss: (v: number) => void;
  stopWin: number;
  setStopWin: (v: number) => void;
  stopGain: number;
  setStopGain: (v: number) => void;
  startAutoplay: (n: number) => void;
}) {
  const { tab, setTab, close } = props;
  const titles: Record<string, string> = {
    settings: "PODEŠAVANJA IGRE",
    auto: "AUTOPLAY PODEŠAVANJA",
    info: "INFORMACIJE",
    history: "ISTORIJA",
  };
  return (
    <div className="h40-sheet">
      <div className="h40-sheet-head">
        <span>{titles[tab]}</span>
        <button className="h40-x" onClick={close}>
          ✕
        </button>
      </div>
      <div className="h40-sheet-body">
        {tab === "settings" && <SettingsTab {...props} />}
        {tab === "auto" && <AutoTab {...props} />}
        {tab === "info" && <InfoTab game={props.game} bet={props.bet} currency={props.profile.currency} />}
        {tab === "history" && <HistoryTab game={props.game} currency={props.profile.currency} />}
      </div>
      <div className="h40-sheet-tabs">
        <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
          <GearIcon />
        </button>
        <button className={tab === "auto" ? "on" : ""} onClick={() => setTab("auto")}>
          <AutoIcon />
        </button>
        <button className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>
          <InfoIcon />
        </button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
          <ClockIcon />
        </button>
      </div>
    </div>
  );
}

function SettingsTab({
  sound,
  setSound,
  speed,
  setSpeed,
}: {
  sound: boolean;
  setSound: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
}) {
  return (
    <div className="h40-settings">
      <label className="h40-toggle-row">
        <span>Zvuk</span>
        <button className={`h40-toggle ${sound ? "on" : ""}`} onClick={() => setSound(!sound)}>
          <i />
        </button>
      </label>
      <div className="h40-toggle-row">
        <span>Brzina igre</span>
        <div className="h40-speed-opts">
          {SPEED_LABELS.map((l, i) => (
            <button key={l} className={`h40-speed-opt ${speed === i ? "on" : ""}`} onClick={() => setSpeed(i)}>
              {"▶".repeat(i + 1)}
              <small>{l}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AutoTab({
  profile,
  bet,
  stopLoss,
  setStopLoss,
  stopWin,
  setStopWin,
  stopGain,
  setStopGain,
  startAutoplay,
}: {
  profile: ProfileData;
  bet: number;
  stopLoss: number;
  setStopLoss: (v: number) => void;
  stopWin: number;
  setStopWin: (v: number) => void;
  stopGain: number;
  setStopGain: (v: number) => void;
  startAutoplay: (n: number) => void;
}) {
  const [pack, setPack] = useState(10);
  const maxLoss = bet * 40;
  const maxWin = bet * 100;
  return (
    <div className="h40-auto">
      <h3>ZAUSTAVI AUTOPLAY</h3>
      <SliderRow label="Ako se balans smanji za" value={stopLoss} max={maxLoss} onChange={setStopLoss} cur={profile.currency} />
      <SliderRow label="Ako je jedan dobitak veći od" value={stopWin} max={maxWin} onChange={setStopWin} cur={profile.currency} />
      <SliderRow label="Ako se balans poveća za" value={stopGain} max={maxWin} onChange={setStopGain} cur={profile.currency} />
      <div className="h40-packs">
        {SPIN_PACKS.map((n) => (
          <button key={String(n)} className={`h40-pack ${pack === n ? "on" : ""}`} onClick={() => setPack(n as number)}>
            <b>{n === Infinity ? "∞" : n}</b>
            <span>Spinova</span>
            <small>{n === Infinity ? "—" : `${fmt(bet * (n as number))} ${profile.currency}`}</small>
          </button>
        ))}
      </div>
      <button className="h40-playnow" onClick={() => startAutoplay(pack)}>
        IGRAJ ODMAH
      </button>
      <div className="h40-auto-foot">
        <span>
          BALANS: <b>{fmt(profile.balance)} {profile.currency}</b>
        </span>
        <span>
          ULOG: <b>{fmt(bet)} {profile.currency}</b>
        </span>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  max,
  onChange,
  cur,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  cur: string;
}) {
  return (
    <div className="h40-slider-row">
      <div className="h40-slider-top">
        <span>{label}</span>
        <b>
          {fmt(value)} <small>{cur}</small>
        </b>
      </div>
      <input type="range" min={0} max={max} step={max / 100} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="h40-slider-bounds">
        <span>0.00 {cur}</span>
        <span>{fmt(max)} {cur}</span>
      </div>
    </div>
  );
}

// ---------------- INFORMACIJE (paytable iz backenda — isti podaci koji placaju) ----------------

interface PaytableInfo {
  rows: number;
  cols: number;
  lines: number;
  wild: string;
  scatter: string;
  linePay: Record<string, Record<number, number>>;
  scatterPay: Record<number, number>;
  paylines: number[][];
}

function InfoTab({ game, bet, currency }: { game: GameSummary; bet: number; currency: string }) {
  const [info, setInfo] = useState<PaytableInfo | null>(null);
  useEffect(() => {
    api.get<PaytableInfo>(`/games/${game.game_id}/paytable`).then(setInfo).catch(() => {});
  }, [game.game_id]);

  if (!info) return <div className="h40-info">Učitavanje...</div>;
  const lineBet = bet / info.lines;
  const order = ["SEVEN", "STAR", "GRAPES", "WATERMELON", "PLUM", "ORANGE", "LEMON", "CHERRY"];

  return (
    <div className="h40-info">
      <div className="h40-info-logo">
        <span className="h40-logo-40">40</span> <span className="h40-logo-txt">BLAZING HOT</span>
      </div>
      <h3>Uvod</h3>
      <p>
        Video slot sa 5 rolni i {info.lines} fiksnih linija. Igra ima 8 simbola — 1 wild i 1 scatter. Sve dobitne
        kombinacije se isplaćuju sleva nadesno, osim scattera.
      </p>

      <h3 className="hot">WILD</h3>
      <div className="h40-pay-card">
        <img src={IMG[info.wild]} alt="wild" />
        <table>
          <tbody>
            {[5, 4, 3].map((n) =>
              info.linePay[info.wild]?.[n] ? (
                <tr key={n}>
                  <td>x{n}</td>
                  <td>
                    {fmt(info.linePay[info.wild][n] * lineBet)} <small>{currency}</small>
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      <p>Menja sve simbole osim SCATTER-a.</p>

      <h3 className="hot">SCATTER</h3>
      <div className="h40-pay-card">
        <img src={IMG[info.scatter]} alt="scatter" />
        <table>
          <tbody>
            {[5, 4, 3].map((n) =>
              info.scatterPay[n] ? (
                <tr key={n}>
                  <td>x{n}</td>
                  <td>
                    {fmt(info.scatterPay[n] * bet)} <small>{currency}</small>
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      <p>Isplaćuje se na bilo kojoj poziciji (u multiplima ukupnog uloga).</p>

      <h3 className="hot">SIMBOLI</h3>
      {order
        .filter((s) => s !== info.wild && s !== info.scatter)
        .map((s) => (
          <div key={s} className="h40-pay-card">
            <img src={IMG[s]} alt={s} />
            <table>
              <tbody>
                {[5, 4, 3].map((n) =>
                  info.linePay[s]?.[n] ? (
                    <tr key={n}>
                      <td>x{n}</td>
                      <td>
                        {fmt(info.linePay[s][n] * lineBet)} <small>{currency}</small>
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>
        ))}

      <h3 className="hot">DUPLIRANJE (GAMBLE)</h3>
      <p>
        Posle dobitka možeš pokušati dupliranje: izaberi CRVENO ili CRNO. Pogodak duplira dobitak, promašaj ga gubi.
        Broj pokušaja je ograničen i prikazan na ekranu.
      </p>

      <h3 className="hot">LINIJE</h3>
      <div className="h40-lines-map">
        {info.paylines.map((p, i) => (
          <div key={i} className="h40-line-mini">
            <span>{i + 1}</span>
            <svg viewBox={`0 0 ${info.cols} ${info.rows}`} preserveAspectRatio="none">
              <polyline
                points={p.map((r, c) => `${c + 0.5},${r + 0.5}`).join(" ")}
                fill="none"
                stroke="#ffd24a"
                strokeWidth={0.18}
              />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- ISTORIJA ----------------

function HistoryTab({ game, currency }: { game: GameSummary; currency: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [tab, setTab] = useState<"current" | "all">("current");
  useEffect(() => {
    api.get<any[]>("/history").then(setRows).catch(() => {});
  }, []);
  const filtered = tab === "current" ? rows.filter((r) => r.game_id === game.game_id) : rows;
  const today = new Date().toLocaleDateString("sr-RS");
  return (
    <div className="h40-history">
      <div className="h40-date-chip">{today}</div>
      <div className="h40-hist-tabs">
        <button className={tab === "current" ? "on" : ""} onClick={() => setTab("current")}>
          Ova igra
        </button>
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          Sve igre
        </button>
      </div>
      {filtered.length === 0 && <div className="h40-norec">Nema zapisa</div>}
      {filtered.map((r) => (
        <div key={r.round_id} className="h40-hist-row">
          <span className="t">{new Date(r.created_at).toLocaleTimeString("sr-RS")}</span>
          <span>-{fmt(r.bet_amount)}</span>
          <span className={r.final_win_amount > 0 ? "w" : ""}>
            {r.final_win_amount > 0 ? `+${fmt(r.final_win_amount + (r.jackpot_amount || 0))}` : "0.00"} {currency}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------- Ikonice (SVG, bez zavisnosti) ----------------

function SpinIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h40-spin-ico">
      <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M38 24a14 14 0 1 1-4.1-9.9" />
        <path d="M34 6v8h-8" strokeWidth="0" fill="currentColor" transform="rotate(8 34 10)" />
      </g>
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h40-spin-ico">
      <rect x="14" y="14" width="20" height="20" rx="3" fill="currentColor" />
    </svg>
  );
}
function CollectIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h40-spin-ico">
      <g fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 8v18M24 26l-7-7M24 26l7-7" />
        <path d="M10 30v6a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4v-6" />
      </g>
    </svg>
  );
}
function AutoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M12 3a9 9 0 1 1-8.6 6.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 9.5v5l4.2-2.5z" fill="currentColor" />
    </svg>
  );
}
function ChipsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <ellipse cx="12" cy="7" rx="8" ry="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7v6c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4V7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 13v4c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4v-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M3 11 12 3l9 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.5 10v10h13V10" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function VolIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function VolOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" />
      <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.2v.2M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
