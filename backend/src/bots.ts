import { all, get, run, nowIso } from "./db.ts";
import { uid, money } from "./util.ts";
import { config } from "./config.ts";
import { registerPlayer } from "./services/session.ts";
import { ensureWallet, getBalance, walletOp } from "./services/wallet.ts";
import { playRound, PlayError } from "./services/play.ts";

// 20 "lažnih" igrača koji stalno igraju – pune jackpotove, generišu
// transakcije, ponašanje i KPI-jeve za back office. Samo dev/demo.

const NAMES = [
  "Marko", "Jelena", "Stefan", "Ana", "Nikola", "Milica", "Luka", "Sara",
  "Petar", "Ivana", "Vuk", "Teodora", "Filip", "Katarina", "Lazar", "Jovana",
  "Uros", "Tara", "Dusan", "Andjela",
];

// 3 brzine igranja (ms po potezu): Brzo=60/min, Srednje=40/min, Sporo=20/min.
const SPEED_MS = [1000, 1500, 3000];
const SPEED_LABEL = ["Brzo", "Srednje", "Sporo"];

interface Bot {
  playerId: string;
  sessionId: string;
  name: string;
  baseDelay: number; // tempo (brzina igranja) – jedna od 3 brzine
  games: { game_id: string; min: number; max: number }[];
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ensureBotSession(playerId: string): string {
  const sessionId = uid("ses");
  const now = new Date();
  const exp = new Date(now.getTime() + 24 * 3600 * 1000);
  run(
    `INSERT INTO casino_sessions (session_id, player_id, created_at, expires_at, ip_address, user_agent)
     VALUES (?,?,?,?,?,?)`,
    [sessionId, playerId, now.toISOString(), exp.toISOString(), "127.0.0.1", "casino-bot"],
  );
  return sessionId;
}

function topUpIfNeeded(playerId: string, bet: number): void {
  if (getBalance(playerId) < bet) {
    walletOp({
      idempotencyKey: `bot-topup-${playerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      playerId,
      txType: "CORRECTION",
      amount: 2000,
    });
  }
}

function chipFor(min: number, max: number): number {
  // Botovi igraju SAMO 3 najveće visine uloga (krupno) – ograničeno na max igre.
  const chips = [min * 10, min * 25, min * 50];
  const v = Math.min(max, Math.max(min, pick(chips)));
  return money(v);
}

function playOnce(bot: Bot): void {
  const g = pick(bot.games);
  const bet = chipFor(g.min, g.max);
  topUpIfNeeded(bot.playerId, bet);

  try {
    playRound({
      playerId: bot.playerId,
      sessionId: bot.sessionId,
      gameId: g.game_id,
      betAmount: bet,
      mode: "REAL",
    });
  } catch (e) {
    if (!(e instanceof PlayError)) console.error("[bot] greška:", e);
    // ACTIVE_ROUND_EXISTS / limiti – samo preskoči ovaj potez.
  }
}

function scheduleBot(bot: Bot): void {
  // Mali jitter (±15%) da botovi iste brzine ne pucaju u isto vreme,
  // ali tempo ostaje blizu dodeljene brzine.
  const jitter = bot.baseDelay * (0.85 + Math.random() * 0.3);
  setTimeout(() => {
    playOnce(bot);
    scheduleBot(bot);
  }, jitter);
}

export function startBots(): void {
  if (process.env.BOTS === "off") {
    console.log("[bots] isključeni (BOTS=off)");
    return;
  }

  const games = all<any>(
    `SELECT game_id, min_bet AS min, max_bet AS max FROM casino_games WHERE status='ACTIVE'`,
  ).map((g) => ({ game_id: g.game_id, min: g.min, max: g.max }));

  if (games.length === 0) return;

  const bots: Bot[] = [];
  NAMES.forEach((name, i) => {
    const username = `bot_${name.toLowerCase()}`;
    let player = get<any>(`SELECT player_id FROM players WHERE username=?`, [username]);
    if (!player) {
      const playerId = registerPlayer(username, "botpass123", "PLAYER");
      ensureWallet(playerId, 3000 + Math.floor(Math.random() * 7000));
      player = { player_id: playerId };
    }
    const sessionId = ensureBotSession(player.player_id);
    // Ravnomerno rasporedi botove po 3 brzine (round-robin): ~7 brzih, 7 srednjih, 6 sporih.
    const tier = i % 3;
    bots.push({
      playerId: player.player_id,
      sessionId,
      name,
      baseDelay: SPEED_MS[tier],
      games,
    });
  });

  bots.forEach(scheduleBot);
  const dist = [0, 1, 2].map((t) => `${SPEED_LABEL[t]}: ${bots.filter((_, i) => i % 3 === t).length}`).join(", ");
  console.log(`[bots] pokrenuto ${bots.length} lažnih igrača (${dist}). Isključi sa BOTS=off`);
}
