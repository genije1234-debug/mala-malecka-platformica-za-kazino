import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_JWT_SECRET = "casino-dev-secret-change-me";
const isProd = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;

// Fail-fast: u produkciji se NE sme koristiti podrazumevani (javno poznati) ključ,
// jer bi svako mogao da iskuje validan token (lažni igrač/admin).
if (isProd && jwtSecret === DEFAULT_JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET mora biti postavljen u produkciji (NODE_ENV=production).");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  jwtExpiresIn: "12h",
  // Dozvoljeni CORS origin(i). Ako nije zadat -> otvoreno (dev/tunnel). U produkciji zadaj domen frontenda.
  corsOrigin: process.env.CORS_ORIGIN,
  isProd,

  // Mora se poklapati sa valutom kladionice (izvor istine za novac).
  // Sada USD; kasnije multi-valutno (currency kod se već nosi uz svaki iznos).
  currency: "USD",

  /** Putanja do SQLite fajla (lokalni dev). U produkciji se menja PostgreSQL-om. */
  dbFile: process.env.DB_FILE ?? path.join(__dirname, "..", "data", "casino.sqlite"),

  // --- Mozak / RTP ---
  defaultTargetRtp: 0.95,
  // Sirina koridora oko krive (u RTP jedinicama). Unutar ovoga je cist RNG.
  rtpCorridorHalfWidth: 0.04,
  // Koliko jako engine koriguje ka krivi kad se izadje iz koridora.
  rtpCorrectionGain: 2.6,
  // Donja/gornja tvrda zastita (kriva je vaznija, ovo su samo ivice).
  rtpHardFloor: 0.7,
  rtpHardCeil: 1.15,
  // Koliko realnog uloga blendamo sa istorijom na pocetku sesije (stabilnost).
  brainHistoryDays: 30,

  // --- House gas (dvosmerni regulator na UKUPNOM RTP-u) ---
  // Kad ukupni RTP padne ispod praga, "gas" blago podize EV igracima koji su
  // ispod svoje mete, dok se kuca ne vrati na metu oporavka. Histereza:
  // pali se na trigger, gasi tek na recover. Tvrdi plafon ostaje defaultTargetRtp.
  gasTriggerRtp: 0.91, // ispod ovoga -> gas se PALI
  gasRecoverRtp: 0.945, // dostigne ovo -> gas se GASI (jastuk ispod 95)
  gasGain: 3.0, // koliko jako gura (mnozi razliku do mete oporavka)
  gasMaxBoost: 0.35, // maks dodatak na requestedRtp po potezu (da bude postepeno)
  gasFullNeed: 0.1, // potreba igraca (meta - efektivni) za PUN gas (10 poena)

  // --- Jackpot ---
  // Ukupan procenat svake uplate koji ide na svih 10 jackpotova.
  jackpotContributionTotalPct: 0.02,

  // --- Free bet ---
  // Procenat svake uplate koji ide u licnu free-bet kasicu igraca.
  freebetAccrualPct: 0.01,
  // Osnovni prag neaktivnosti (sekunde) pre re-engagement poruke. AI ga koriguje.
  freebetBaseInactivitySec: Number(process.env.FREEBET_INACTIVITY_SEC ?? 60),
  // Minimalna kasica da bi se dodelio free bet.
  freebetMinGrant: 0.5,

  // --- Round / lock ---
  maxRoundDurationSec: 120,

  // --- Retention (cistacica baze) ---
  // Logovi/papirologija (round eventi, jackpot doprinosi, rng, outbox, player
  // eventi, transakcije...) cuvaju se ovoliko dana pa se automatski brisu.
  // KPI brojke NE zavise od ovoga (zive u game_stats / house_ledger / jackpots).
  retentionDays: Number(process.env.RETENTION_DAYS ?? 1),
  // Zavrsene runde (istorija igranja) cuvaju se duze.
  roundsRetentionDays: Number(process.env.ROUNDS_RETENTION_DAYS ?? 3),

  // --- Startni balans demo igraca u mock walletu ---
  startingWalletBalance: 1000,

  // Admin nalog (seed).
  adminUsername: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASS ?? "admin123",

  // --- Operator (kladionica) wallet most ---
  // Transfer model: kladionica je izvor istine za novac. Kazino zove ovaj API
  // SAMO na ulazu (withdraw-all) i izlazu (deposit), nikad po spinu.
  // Ako operatorWalletEnabled=false ILI igrac nema operator_user_id -> koristi se
  // lokalni mock wallet (demo/botovi rade kao i pre).
  operatorWalletEnabled: process.env.OPERATOR_WALLET_ENABLED === "1",
  // Bazni URL kladionickog API-ja, npr. https://admin.domen.com/api
  operatorBaseUrl: process.env.OPERATOR_BASE_URL ?? "",
  // Deljeni token (isti kao LIVE_FEED_TOKEN u kladionici).
  operatorToken: process.env.OPERATOR_TOKEN ?? "",
  // Timeout za poziv kladionice (ms).
  operatorTimeoutMs: Number(process.env.OPERATOR_TIMEOUT_MS ?? 8000),
};

export const NUM_JACKPOTS = 10;
