import { secureRandom, clamp, money, randomInt } from "../util.ts";
import type { GameType } from "@casino/shared";

export interface OutcomeDef {
  multiplier: number;
  weight: number;
  label?: string;
}

export interface GameConfig {
  game_id: string;
  game_type: GameType;
  rtp_target: number;
  max_win_multiplier: number;
  config_json: any;
}

export interface EngineResult {
  multiplier: number;
  outcome: any; // display podaci za frontend
  rawRng: number;
}

export interface PlayOptions {
  target?: number; // crash autocashout / limbo target
  picks?: number[]; // keno
}

/**
 * Velicina "loss bucket"-a (mult=0) tako da ocekivana vrednost tabele bude ~ ev.
 * ev je "requestedRtp" koji mozak trazi za ovaj spin (moze biti i > 1).
 */
function withLossBucket(nonLoss: OutcomeDef[], ev: number): OutcomeDef[] {
  const sumW = nonLoss.reduce((s, o) => s + o.weight, 0);
  const sumWM = nonLoss.reduce((s, o) => s + o.weight * o.multiplier, 0);
  // EV = sumWM / (L + sumW) = ev  =>  L = sumWM/ev - sumW
  let lossWeight = sumWM / ev - sumW;
  if (lossWeight < 0) lossWeight = 0; // tabela ne moze dostici tako visok EV -> bez gubitka
  return [{ multiplier: 0, weight: lossWeight, label: "loss" }, ...nonLoss];
}

/** Obican tezinski random izbor (EV je vec ugradjen u tabelu). */
function weightedPick(outcomes: OutcomeDef[]): OutcomeDef {
  const total = outcomes.reduce((s, o) => s + o.weight, 0);
  let r = secureRandom() * total;
  for (const o of outcomes) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return outcomes[outcomes.length - 1];
}

// ----------------- Default tabele po tipu (oblik/volatilnost) -----------------

function defaultTable(type: GameType, cfg: GameConfig): OutcomeDef[] {
  if (cfg.config_json?.outcomes) return cfg.config_json.outcomes as OutcomeDef[];
  switch (type) {
    case "classic_slot":
      return [
        { multiplier: 0.5, weight: 30 },
        { multiplier: 1, weight: 20 },
        { multiplier: 2, weight: 12 },
        { multiplier: 5, weight: 5 },
        { multiplier: 10, weight: 2 },
        { multiplier: 20, weight: 0.8 },
        { multiplier: 50, weight: 0.2 },
      ];
    case "book_slot":
      return [
        { multiplier: 0.5, weight: 25 },
        { multiplier: 2, weight: 10 },
        { multiplier: 5, weight: 4 },
        { multiplier: 10, weight: 2 },
        { multiplier: 20, weight: 1 },
        { multiplier: 100, weight: 0.25, label: "bonus" },
        { multiplier: 500, weight: 0.05, label: "bigbonus" },
      ];
    case "tumble_slot":
    case "megaways_slot":
      return [
        { multiplier: 0.5, weight: 28 },
        { multiplier: 1.5, weight: 14 },
        { multiplier: 3, weight: 8 },
        { multiplier: 8, weight: 3 },
        { multiplier: 20, weight: 1 },
        { multiplier: 100, weight: 0.2 },
        { multiplier: 500, weight: 0.04 },
        { multiplier: 1000, weight: 0.01 },
      ];
    case "fishing_slot":
      return [
        { multiplier: 0.5, weight: 26 },
        { multiplier: 1.5, weight: 12 },
        { multiplier: 4, weight: 6 },
        { multiplier: 10, weight: 2 },
        { multiplier: 50, weight: 0.6 },
        { multiplier: 250, weight: 0.08 },
        { multiplier: 2000, weight: 0.01 },
      ];
    case "instant":
      return [
        { multiplier: 1.2, weight: 30 },
        { multiplier: 2, weight: 12 },
        { multiplier: 5, weight: 4 },
        { multiplier: 10, weight: 1.5 },
        { multiplier: 50, weight: 0.3 },
        { multiplier: 1000, weight: 0.01 },
      ];
    default:
      return [
        { multiplier: 1, weight: 20 },
        { multiplier: 2, weight: 8 },
      ];
  }
}

// ----------------- Render po tipu (kozmeticki prikaz) -----------------

const SLOT_SYMBOLS = ["CHERRY", "LEMON", "ORANGE", "PLUM", "GRAPES", "WATERMELON", "SEVEN", "STAR"];

function renderSlotGrid(win: boolean, rows: number, cols: number): string[][] {
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push(SLOT_SYMBOLS[randomInt(0, SLOT_SYMBOLS.length - 1)]);
    grid.push(row);
  }
  if (win) {
    // Forsiraj jednu punu (horizontalnu) liniju da front uvek detektuje dobitnu liniju.
    const sym = SLOT_SYMBOLS[randomInt(0, 3)];
    const line = randomInt(0, rows - 1);
    for (let c = 0; c < cols; c++) grid[line][c] = sym;
  }
  return grid;
}

function slotShape(cfg: GameConfig): { rows: number; cols: number } {
  const s = cfg.config_json?.slot;
  if (s?.rows && s?.reels) return { rows: s.rows, cols: s.reels };
  return { rows: 3, cols: 5 };
}

// ----------------- Glavni dispatcher -----------------
// requestedRtp = EV koji mozak trazi za ovaj spin (vodjenje krive).

export function playGame(cfg: GameConfig, requestedRtp: number, opts: PlayOptions = {}): EngineResult {
  const rawRng = secureRandom();
  const ev = clamp(requestedRtp, 0.3, 2.0);

  switch (cfg.game_type) {
    case "crash": {
      // Kontrola EV: P(dostigne target) = ev/target.
      const target = opts.target && opts.target > 1 ? opts.target : 2;
      const pWin = clamp(ev / target, 0.0001, 0.97);
      const win = secureRandom() < pWin;
      let crashPoint: number;
      if (win) {
        // crash point >= target (do max win)
        crashPoint = target + secureRandom() * Math.min(target * 2, cfg.max_win_multiplier - target);
      } else {
        crashPoint = 1 + secureRandom() * (target - 1);
      }
      crashPoint = clamp(crashPoint, 1, cfg.max_win_multiplier);
      return {
        multiplier: win ? target : 0,
        outcome: { kind: "crash", crashPoint: money(crashPoint), target, cashedOut: win },
        rawRng,
      };
    }

    case "keno": {
      // EV-kontrolisan multiplikator, pa rekonstruisemo broj pogodaka.
      const payTable: { matches: number; multiplier: number; weight: number }[] = [
        { matches: 5, multiplier: 5, weight: 5 },
        { matches: 6, multiplier: 20, weight: 1.2 },
        { matches: 7, multiplier: 75, weight: 0.3 },
        { matches: 8, multiplier: 300, weight: 0.06 },
        { matches: 9, multiplier: 1200, weight: 0.012 },
        { matches: 10, multiplier: 5000, weight: 0.002 },
      ];
      const table = withLossBucket(
        payTable.map((p) => ({ multiplier: p.multiplier, weight: p.weight })),
        ev,
      );
      const chosen = weightedPick(table);
      const matchRow = payTable.find((p) => p.multiplier === chosen.multiplier);
      const matches = matchRow ? matchRow.matches : randomInt(0, 4);

      const pool = 80;
      const picks =
        opts.picks && opts.picks.length > 0
          ? opts.picks.slice(0, 10)
          : uniqueRandoms(10, 1, pool);
      const drawn = new Set<number>();
      // ubaci 'matches' igracevih
      const shuffledPicks = [...picks].sort(() => secureRandom() - 0.5);
      for (let i = 0; i < matches && i < shuffledPicks.length; i++) drawn.add(shuffledPicks[i]);
      while (drawn.size < 20) {
        const n = randomInt(1, pool);
        if (!picks.includes(n) || drawn.has(n)) drawn.add(n);
        if (drawn.size >= 20) break;
        if (picks.includes(n)) continue; // ne dodaji vise pogodaka nego sto treba
      }
      return {
        multiplier: chosen.multiplier,
        outcome: { kind: "keno", picks, drawn: [...drawn].slice(0, 20), matches },
        rawRng,
      };
    }

    case "instant": {
      const sub = cfg.config_json?.sub;
      if (sub === "plinko") {
        const p = plinkoResult(ev);
        return { multiplier: p.multiplier, outcome: { kind: "plinko", ...p }, rawRng };
      }
      const table = withLossBucket(defaultTable("instant", cfg), ev);
      const chosen = weightedPick(table);
      return {
        multiplier: chosen.multiplier,
        outcome: { kind: sub ?? "instant", multiplier: chosen.multiplier, label: chosen.label },
        rawRng,
      };
    }

    default: {
      // Svi slot tipovi.
      const table = withLossBucket(defaultTable(cfg.game_type, cfg), ev);
      const chosen = weightedPick(table);
      const win = chosen.multiplier > 0;
      const { rows, cols } = slotShape(cfg);
      return {
        multiplier: chosen.multiplier,
        outcome: {
          kind: cfg.game_type,
          grid: renderSlotGrid(win, rows, cols),
          multiplier: chosen.multiplier,
          bonus: chosen.label === "bonus" || chosen.label === "bigbonus",
        },
        rawRng,
      };
    }
  }
}

function uniqueRandoms(count: number, min: number, max: number): number[] {
  const set = new Set<number>();
  while (set.size < count) set.add(randomInt(min, max));
  return [...set];
}

/**
 * Plinko: 12 redova -> 13 korpi (simetricno: ivice visoke, sredina niska).
 * EV se vodi tezinom centralne korpe (0.2x) da bi se postigao trazeni requestedRtp.
 * Vraca i `path` (niz 0/1 = levo/desno) koji front animira do korpe.
 */
function plinkoResult(ev: number): { multiplier: number; bucket: number; path: number[]; buckets: number[]; rows: number } {
  const ROWS = 12;
  const buckets = [29, 8, 3, 1.4, 0.6, 0.3, 0.2, 0.3, 0.6, 1.4, 3, 8, 29];
  const binom = (n: number, k: number): number => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c;
  };
  const weights = buckets.map((_, k) => binom(ROWS, k));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sumWM = weights.reduce((a, b, i) => a + b * buckets[i], 0);
  // (sumWM + Wc*0.2) / (sumW + Wc) = ev  ->  resi za dodatnu centralnu tezinu
  const center = 6;
  const cval = buckets[center];
  const targetEv = clamp(ev, cval + 0.01, 5);
  const wc = (sumWM - targetEv * sumW) / (targetEv - cval);
  if (wc > 0) weights[center] += wc;

  const total = weights.reduce((a, b) => a + b, 0);
  let r = secureRandom() * total;
  let idx = center;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      idx = i;
      break;
    }
  }
  // Korpa idx = tacno `idx` skretanja udesno kroz ROWS redova.
  const path: number[] = new Array(ROWS).fill(0);
  const rightSlots = [...Array(ROWS).keys()].sort(() => secureRandom() - 0.5).slice(0, idx);
  for (const s of rightSlots) path[s] = 1;
  return { multiplier: buckets[idx], bucket: idx, path, buckets, rows: ROWS };
}
