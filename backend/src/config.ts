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

  currency: "EUR",

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

  // --- Startni balans demo igraca u mock walletu ---
  startingWalletBalance: 1000,

  // Admin nalog (seed).
  adminUsername: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASS ?? "admin123",
};

export const NUM_JACKPOTS = 10;
