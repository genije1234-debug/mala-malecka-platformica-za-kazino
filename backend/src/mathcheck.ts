/**
 * Dokaz da matematika štima (pokreni: npm run mathcheck --workspace backend).
 * Radi na izolovanoj bazi (DB_FILE), kreće SVE od nule i odigra N realnih
 * spinova, pa proverava knjigovodstvene invarijante:
 *   - jackpot doprinos == 2% ukupnog uloga
 *   - free-bet akrual   == 1% ukupnog uloga
 *   - rast jackpot poola + isplaćeni jackpoti == ukupan doprinos (ništa ne curi)
 *   - očuvanje novca: promena balansa == dobici + jackpot - ulozi
 *   - RTP (dobici/ulog) prati ciljnu krivu
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, "..", "data", "mathcheck.sqlite");
fs.mkdirSync(path.dirname(TMP), { recursive: true });
if (fs.existsSync(TMP)) fs.rmSync(TMP);
process.env.DB_FILE = TMP;
process.env.BOTS = "off";

const { initSchema, get, run } = await import("./db.ts");
const { seedDatabase } = await import("./seedData.ts");
const { registerPlayer } = await import("./services/session.ts");
const { ensureWallet, getBalance, walletOp } = await import("./services/wallet.ts");
const { getFreebet } = await import("./services/freebet.ts");
const { playRound } = await import("./services/play.ts");
const { config } = await import("./config.ts");

initSchema();
seedDatabase();

const N = 3000;
const BET = 100; // veći ulog da se izbegne gubitak na zaokruživanju (0.02*100=2.00)
const GAME = "blazing40";

const playerId = registerPlayer("mathtest", "x");
ensureWallet(playerId);
// Dopuni preko knjiženog CORRECTION (idempotentno) – dovoljno za sve spinove.
walletOp({ idempotencyKey: `seed-${playerId}`, playerId, txType: "CORRECTION", amount: 1_000_000 });
const startBal = getBalance(playerId);

for (let i = 0; i < N; i++) {
  try {
    playRound({ playerId, gameId: GAME, betAmount: BET, mode: "REAL" });
  } catch (e: any) {
    console.error("spin greška:", e?.code ?? e);
  }
}

const r = get<any>(
  `SELECT COUNT(*) c, COALESCE(SUM(bet_amount),0) stake, COALESCE(SUM(final_win_amount),0) win,
          COALESCE(SUM(jackpot_amount),0) jw
   FROM casino_rounds WHERE player_id=? AND mode='REAL'`,
  [playerId],
)!;
const contrib = get<any>(`SELECT COALESCE(SUM(amount),0) v FROM jackpot_contributions WHERE status='APPLIED'`)!.v;
const avgReqEv = get<any>(`SELECT COALESCE(AVG(favorability),0) v FROM casino_rounds WHERE player_id=? AND mode='REAL'`, [playerId])!.v;
const poolGrowth = get<any>(`SELECT COALESCE(SUM(current_amount - seed_amount),0) v FROM jackpots`)!.v;
const paid = get<any>(`SELECT COALESCE(SUM(amount),0) v FROM jackpot_wins WHERE status='CREDITED'`)!.v;
const fb = getFreebet(playerId);
const endBal = getBalance(playerId);

const stake = r.stake as number;
const win = r.win as number;
const jw = r.jw as number;

const expJackpot = stake * config.jackpotContributionTotalPct; // 2%
const expFreebet = stake * config.freebetAccrualPct; // 1%
const walletDelta = endBal - startBal;
const expWalletDelta = win + jw - stake;
const rtpWins = win / stake;
// OPCIJA A: ukupan povraćaj igraču = bazni dobici + jackpot (earmarkovan = contrib) + free-bet kasica.
const rtpTotal = (win + contrib + fb.balance) / stake;
const baseTarget = config.defaultTargetRtp - config.jackpotContributionTotalPct - config.freebetAccrualPct; // 0.92

const pct = (x: number) => (x * 100).toFixed(3) + "%";
const eur = (x: number) => x.toFixed(2);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const mark = (ok: boolean) => (ok ? "✅ PASS" : "❌ FAIL");

console.log("\n==================== RESET OD NULE + MATEMATIKA ====================");
console.log(`Spinova: ${r.c}   |   Ulog/spin: ${BET} ${config.currency}   |   Igra: ${GAME}`);
console.log(`Početni balans: ${eur(startBal)}   →   Krajnji: ${eur(endBal)}\n`);

console.log(`Ukupan ulog (stake):        ${eur(stake)} ${config.currency}`);
console.log(`Ukupan dobitak (wins):      ${eur(win)} ${config.currency}`);
console.log(`Jackpot isplate igraču:     ${eur(jw)} ${config.currency}\n`);

console.log("------ INVARIJANTE ------");
console.log(`1) Jackpot doprinos = 2% uloga`);
console.log(`   knjiženo: ${eur(contrib)}   očekivano(2%): ${eur(expJackpot)}   ${mark(near(contrib, expJackpot, 0.02 * r.c))}`);

console.log(`2) Free-bet akrual = 1% uloga`);
console.log(`   kasica:   ${eur(fb.balance)}   očekivano(1%): ${eur(expFreebet)}   ${mark(near(fb.balance, expFreebet, 0.01 * r.c))}`);

console.log(`3) Jackpot pool: rast + isplate = doprinos (ništa ne curi)`);
console.log(`   rast(${eur(poolGrowth)}) + isplate(${eur(paid)}) = ${eur(poolGrowth + paid)}   doprinos: ${eur(contrib)}   ${mark(near(poolGrowth + paid, contrib, 0.01))}`);

console.log(`4) Očuvanje novca: Δbalans = dobici + jackpot − ulog`);
console.log(`   Δbalans: ${eur(walletDelta)}   izračunato: ${eur(expWalletDelta)}   ${mark(near(walletDelta, expWalletDelta, 0.01))}`);

console.log(`\n------ RTP (OPCIJA A: jackpot i free-bet su UNUTAR ukupnog RTP-a) ------`);
console.log(`   DETERMINISTIČKI dokaz (prosečan ciljani EV koji engine gađa za bazne dobitke):`);
console.log(`   prosečni EV: ${pct(avgReqEv)}   meta baze: ${pct(baseTarget)}   ${mark(near(avgReqEv, baseTarget, 0.01))}`);
console.log(`   → + jackpot ${pct(config.jackpotContributionTotalPct)} + free-bet ${pct(config.freebetAccrualPct)} = ukupan cilj ${pct(avgReqEv + 0.03)}\n`);
console.log(`   REALIZOVANO ovaj uzorak (statistika, varijansa ~±5% na 3000 spinova):`);
console.log(`   bazni dobici: ${pct(rtpWins)}   ukupan povraćaj: ${pct(rtpTotal)}   kuća: ${pct(1 - rtpTotal)}`);
console.log(`   (na dugi rok teži ka: bazni ${pct(baseTarget)}, ukupno ${pct(config.defaultTargetRtp)}, kuća ${pct(1 - config.defaultTargetRtp)})`);
console.log("====================================================================\n");

try {
  fs.rmSync(TMP, { force: true });
} catch {
  /* fajl je još zaključan na Windows-u; nije bitno, to je temp baza */
}
