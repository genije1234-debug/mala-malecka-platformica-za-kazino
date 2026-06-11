import { secureRandom, money, clamp } from "../util.ts";

/**
 * 40 SUPER HOT mehanika (Amusnet/EGT stil) — PRAVA linijska matematika.
 * 5 rolni x 4 reda, 40 FIKSNIH linija, 8 simbola:
 *   - SEVEN = WILD (menja sve osim STAR) i sam plaća najjače
 *   - STAR = SCATTER (plaća bilo gde, u multiplima UKUPNOG uloga)
 * Sve dobitne kombinacije idu sleva nadesno, osim scattera.
 *
 * Za razliku od generičkih slotova (kozmetički grid), ovde se ISPLAĆUJE TAČNO
 * ono što grid pokazuje: zavrti rolne -> evaluiraj 40 linija + scatter -> plati.
 * RTP vodjenje (mozak) ide preko rejection-sampling prihvatanja ishoda, pa
 * distribucija dobitaka ostaje prirodna (paytable se ne menja po spinu).
 */

export const HOT40_SYMBOLS = ["CHERRY", "LEMON", "ORANGE", "PLUM", "GRAPES", "WATERMELON", "SEVEN", "STAR"] as const;
export type Hot40Symbol = (typeof HOT40_SYMBOLS)[number];

const ROWS = 4;
const COLS = 5;
const LINES = 40;

const WILD: Hot40Symbol = "SEVEN";
const SCATTER: Hot40Symbol = "STAR";

/**
 * Paytable PO LINIJSKOM ulogu (ukupan ulog / 40) — POTVRDJENO iz video snimka
 * INFORMATION stranice (vrednosti kod uloga 6.00: linijski ulog 0.15):
 * SEVEN 150/60/6, GROZDJE 60/12/3, LUBENICA i SLJIVA 30/6/3,
 * LIMUN/POMORANDZA/TRESNJA 15/3/1.50.
 */
const LINE_PAY: Record<string, Record<number, number>> = {
  SEVEN: { 5: 1000, 4: 400, 3: 40 },
  GRAPES: { 5: 400, 4: 80, 3: 20 },
  WATERMELON: { 5: 200, 4: 40, 3: 20 },
  PLUM: { 5: 200, 4: 40, 3: 20 },
  ORANGE: { 5: 100, 4: 20, 3: 10 },
  LEMON: { 5: 100, 4: 20, 3: 10 },
  CHERRY: { 5: 100, 4: 20, 3: 10 },
};

/** Scatter (STAR) u multiplima UKUPNOG uloga — iz videa: 3000/120/30 kod 6.00. */
const SCATTER_PAY: Record<number, number> = { 5: 500, 4: 20, 3: 5 };

/**
 * 40 fiksnih linija na 5x4 gridu (red po koloni, 0=vrh).
 * Prve 4 su prave; ostale su standardne V/zig-zag putanje (korak <= 1).
 * Redosled je deterministički — front dobija putanje uz svaki dobitak.
 */
export const HOT40_LINES: number[][] = buildLines();

function buildLines(): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < ROWS; r++) lines.push([r, r, r, r, r]); // 1-4 prave
  // Klasične EGT putanje: V, obrnuto V, stepenice, talasi...
  const patterns: number[][] = [
    [0, 1, 2, 1, 0], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2], [3, 2, 1, 2, 3],
    [0, 0, 1, 0, 0], [1, 1, 0, 1, 1], [2, 2, 3, 2, 2], [3, 3, 2, 3, 3],
    [1, 0, 0, 0, 1], [2, 3, 3, 3, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
    [1, 2, 2, 2, 1], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [3, 2, 3, 2, 3],
    [1, 0, 1, 0, 1], [2, 3, 2, 3, 2], [1, 2, 1, 2, 1], [2, 2, 1, 2, 2],
    [1, 1, 2, 1, 1], [0, 0, 1, 2, 3], [3, 3, 2, 1, 0], [0, 1, 2, 3, 3],
    [3, 2, 1, 0, 0], [1, 0, 1, 2, 3], [2, 3, 2, 1, 0], [0, 1, 2, 2, 2],
    [3, 2, 1, 1, 1], [2, 1, 2, 3, 3], [1, 2, 1, 0, 0], [2, 2, 2, 1, 0],
    [1, 1, 1, 2, 3], [0, 0, 0, 1, 2], [3, 3, 3, 2, 1], [2, 1, 0, 0, 1],
  ];
  for (const p of patterns) {
    if (lines.length >= LINES) break;
    lines.push(p);
  }
  return lines.slice(0, LINES);
}

/**
 * Težine simbola po rolni (rolne su nezavisne trake).
 * SEVEN (wild) je ređi; STAR (scatter) najređi. Kalibrisano da prirodni RTP
 * bude blizu rtp_target igre (~0.96); mozak fino vodi preko steering-a.
 */
// Kalibrisano Monte Carlom (500k spinova, sa stekovima): prirodni EV ~0.96,
// hit-rate ~0.24 (realno za 40-linijski voćni slot sa stekovima).
const REEL_WEIGHTS: Record<Hot40Symbol, number>[] = Array.from({ length: COLS }, () => ({
  CHERRY: 11.5,
  LEMON: 12,
  ORANGE: 15,
  PLUM: 9,
  GRAPES: 11,
  WATERMELON: 9.5,
  SEVEN: 2.35,
  STAR: 1.85,
}));

/**
 * Verovatnoća da se simbol u traci NASTAVI u nizu (stekovi kao na originalu:
 * često cela kolona isti simbol). Scatter se ne stekuje.
 */
const STACK_CONT: Record<Hot40Symbol, number> = {
  CHERRY: 0.62,
  LEMON: 0.62,
  ORANGE: 0.62,
  PLUM: 0.6,
  GRAPES: 0.55,
  WATERMELON: 0.55,
  SEVEN: 0.5,
  STAR: 0,
};

function pickSymbol(col: number): Hot40Symbol {
  const w = REEL_WEIGHTS[col];
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let x = secureRandom() * total;
  for (const s of HOT40_SYMBOLS) {
    x -= w[s];
    if (x <= 0) return s;
  }
  return "CHERRY";
}

function spinReel(col: number): Hot40Symbol[] {
  // Simboli dolaze u STEKOVIMA (nizovi istog simbola na traci).
  // Pravilo originala: NAJVISE JEDAN scatter (STAR) po koloni.
  const out: Hot40Symbol[] = [];
  let starUsed = false;
  let cur = pickSymbol(col);
  if (cur === "STAR") starUsed = true;
  out.push(cur);
  while (out.length < ROWS) {
    if (secureRandom() < STACK_CONT[cur]) {
      out.push(cur);
    } else {
      let next = pickSymbol(col);
      let guard = 0;
      // zabrana drugog scattera u koloni + izbegni "lazni stek" (isti simbol posle prekida)
      while (guard++ < 10 && ((next === "STAR" && starUsed) || (next === cur && next !== "STAR"))) {
        next = pickSymbol(col);
      }
      if (next === "STAR") {
        if (starUsed) next = "CHERRY"; // guard istekao -> sigurna zamena
        else starUsed = true;
      }
      cur = next;
      out.push(cur);
    }
  }
  return out;
}

/** Grid kao rows x cols (grid[r][c]). */
function spinGrid(): Hot40Symbol[][] {
  const colVals = Array.from({ length: COLS }, (_, c) => spinReel(c));
  return Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => colVals[c][r]));
}

export interface Hot40LineWin {
  line: number; // index linije (0-based; prikaz +1)
  pattern: number[]; // putanja (red po koloni) — front crta tačno ovo
  symbol: Hot40Symbol;
  count: number;
  amount: number; // multiplikator UKUPNOG uloga
}

export interface Hot40Eval {
  multiplier: number; // ukupno, u multiplima UKUPNOG uloga
  lineWins: Hot40LineWin[];
  scatterWin: { count: number; amount: number; cells: Array<[number, number]> } | null;
}

/** Evaluacija: 40 linija sleva (wild menja sve osim scattera) + scatter bilo gde. */
export function evaluateHot40(grid: Hot40Symbol[][]): Hot40Eval {
  const lineWins: Hot40LineWin[] = [];
  const lineBet = 1 / LINES; // u jedinicama ukupnog uloga

  for (let li = 0; li < HOT40_LINES.length; li++) {
    const pattern = HOT40_LINES[li];
    // Varijanta A: wild menja simbole -> linija prvog ne-wild simbola.
    let lineSym: Hot40Symbol | null = null;
    let count = 0;
    let wildRun = 0; // vodeci niz sedmica (varijanta B)
    let leading = true;
    for (let c = 0; c < COLS; c++) {
      const s = grid[pattern[c]][c];
      if (s === SCATTER) break; // scatter prekida liniju
      if (s === WILD) {
        count++;
        if (leading) wildRun++;
        continue;
      }
      leading = false;
      if (lineSym === null) {
        lineSym = s;
        count++;
      } else if (s === lineSym) {
        count++;
      } else break;
    }
    const paySym = lineSym ?? WILD; // sve wild = linija sedmica
    const payA = LINE_PAY[paySym]?.[count] ?? 0;
    // Varijanta B: vodece sedmice placene KAO SEDMICE (npr. 4x SEVEN + tresnja
    // mora platiti SEVEN x4 = 400, ne tresnja x5 = 100). Placa se BOLJA varijanta.
    const payB = LINE_PAY[WILD]?.[wildRun] ?? 0;
    if (payA === 0 && payB === 0) continue;
    if (payB > payA) {
      lineWins.push({ line: li, pattern, symbol: WILD, count: wildRun, amount: money(payB * lineBet) });
    } else {
      lineWins.push({ line: li, pattern, symbol: paySym, count, amount: money(payA * lineBet) });
    }
  }

  // Najveci dobitak prvi (prikaz na frontu ide ovim redom).
  lineWins.sort((a, b) => b.amount - a.amount || a.line - b.line);

  // Scatter bilo gde.
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] === SCATTER) cells.push([r, c]);
  const sPay = SCATTER_PAY[Math.min(cells.length, 5)];
  const scatterWin = sPay ? { count: cells.length, amount: money(sPay), cells } : null;

  const total = lineWins.reduce((s, w) => s + w.amount, 0) + (scatterWin?.amount ?? 0);
  return { multiplier: money(total), lineWins, scatterWin };
}

// ----------------- Prirodne konstante (Monte Carlo, jednom po procesu) -----------------

let NAT: { ev: number; pWin: number; pLoss: number } | null = null;

function naturalStats(): { ev: number; pWin: number; pLoss: number } {
  if (NAT) return NAT;
  const N = 120_000;
  let sum = 0;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const m = evaluateHot40(spinGrid()).multiplier;
    sum += m;
    if (m > 0) wins++;
  }
  NAT = { ev: sum / N, pWin: wins / N, pLoss: 1 - wins / N };
  return NAT;
}

// ----------------- Steering (rejection sampling) -----------------

/**
 * Mozak traži EV = requestedRtp. Prirodni EV traka je ~0.96.
 * - traženi < prirodni: dobitni grid se prihvata sa p = r*L/(n - r*Q)
 * - traženi > prirodni: gubitni grid se prihvata sa p = (n/r - Q)/L
 * (izvedeno iz E[prihvaćeno] = r). Distribucija oblika dobitka ostaje prirodna.
 */
export function spinHot40(requestedRtp: number, maxMult = Infinity): { grid: Hot40Symbol[][]; ev: Hot40Eval; rawRng: number } {
  const { ev: n, pWin: Q, pLoss: L } = naturalStats();
  const r = clamp(requestedRtp, 0.1, Math.max(1.5, (n / Math.max(Q, 0.05)) * 0.9));

  let acceptWin = 1;
  let acceptLoss = 1;
  if (r < n) {
    acceptWin = clamp((r * L) / Math.max(n - r * Q, 1e-6), 0.02, 1);
  } else if (r > n) {
    acceptLoss = clamp((n / r - Q) / Math.max(L, 1e-6), 0.02, 1);
  }

  let grid = spinGrid();
  let ev = evaluateHot40(grid);
  const rawRng = secureRandom();
  for (let i = 0; i < 60; i++) {
    // Grid preko plafona (max win / house budzet) se NIKAD ne prihvata:
    // ono sto se prikaze mora moci i da se isplati 1:1 (nema secenja posle).
    if (ev.multiplier <= maxMult) {
      const p = ev.multiplier > 0 ? acceptWin : acceptLoss;
      if (secureRandom() < p) break;
    }
    grid = spinGrid();
    ev = evaluateHot40(grid);
  }
  // Sigurnosna petlja: ako je poslednji pokusaj i dalje preko plafona,
  // vrti dok ne padne ispod (gubitni grid uvek prolazi; P(gubitak) ~ 0.75).
  let guard = 0;
  while (ev.multiplier > maxMult && guard++ < 500) {
    grid = spinGrid();
    ev = evaluateHot40(grid);
  }
  return { grid, ev, rawRng };
}

/** Dijagnostika/kalibracija: prirodni EV i hit-rate traka (Monte Carlo). */
export function hot40Natural(): { ev: number; pWin: number; pLoss: number } {
  return naturalStats();
}

/** Za config/info ekran (paytable se prikazuje iz istih podataka koji plaćaju). */
export function hot40Info() {
  return {
    rows: ROWS,
    cols: COLS,
    lines: LINES,
    wild: WILD,
    scatter: SCATTER,
    linePay: LINE_PAY,
    scatterPay: SCATTER_PAY,
    paylines: HOT40_LINES,
  };
}
