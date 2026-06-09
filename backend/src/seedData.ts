import { get, run, tx, nowIso } from "./db.ts";
import { uid } from "./util.ts";
import { config } from "./config.ts";
import { CATALOG } from "./games/catalog.ts";
import { registerPlayer } from "./services/session.ts";
import { fundOperatorSeed } from "./services/wallet.ts";

interface JackpotSeed {
  jackpot_id: string;
  name: string;
  tier: string;
  effect: string;
  color: string;
  seed: number;
  lower: number;
  upper: number;
}

// Vecina krece aktivna (current=seed >= lower) da rail odmah sjaji; VIP i
// Tournament krecu sivi (seed < lower) da se vidi i neaktivno stanje.
// Reset od nule: svi jackpotovi kreću od 0 i pune se isključivo iz 2% uplata
// (transparentno za proveru matematike). Gornje granice ostaju velike.
// Sve kreće od NULE: seed=0 i lower=0 (granice se postavljaju u back office-u).
// upper = must-drop plafon (ne sme biti 0 da must-drop ne bi okidao odmah);
// admin ga može promeniti. Pool se puni isključivo iz 2% uplata.
const JACKPOTS: JackpotSeed[] = [
  { jackpot_id: "jp_mega", name: "Colossal", tier: "mega", effect: "lightning", color: "#ef4444", seed: 0, lower: 0, upper: 5000000 },
  { jackpot_id: "jp_grand", name: "Grand", tier: "grand", effect: "flame", color: "#f59e0b", seed: 0, lower: 0, upper: 1000000 },
  { jackpot_id: "jp_weekly", name: "Weekly", tier: "weekly", effect: "halo", color: "#818cf8", seed: 0, lower: 0, upper: 300000 },
  { jackpot_id: "jp_major", name: "Major", tier: "major", effect: "sparkle", color: "#34d399", seed: 0, lower: 0, upper: 150000 },
  { jackpot_id: "jp_daily", name: "Daily", tier: "daily", effect: "wave", color: "#22d3ee", seed: 0, lower: 0, upper: 40000 },
  { jackpot_id: "jp_minor", name: "Minor", tier: "minor", effect: "pulse", color: "#a78bfa", seed: 0, lower: 0, upper: 8000 },
  { jackpot_id: "jp_mini", name: "Mini", tier: "mini", effect: "glow", color: "#38bdf8", seed: 0, lower: 0, upper: 2500 },
  { jackpot_id: "jp_random", name: "Random Drop", tier: "random", effect: "confetti", color: "#f472b6", seed: 0, lower: 0, upper: 1500 },
  { jackpot_id: "jp_vip", name: "VIP", tier: "vip", effect: "rainbow", color: "#fde047", seed: 0, lower: 0, upper: 5000 },
  { jackpot_id: "jp_tournament", name: "Tournament", tier: "tournament", effect: "shake", color: "#fb923c", seed: 0, lower: 0, upper: 3000 },
];

export function seedDatabase(): void {
  const now = nowIso();

  // --- Igre ---
  CATALOG.forEach((g, i) => {
    const exists = get(`SELECT game_id FROM casino_games WHERE game_id=?`, [g.game_id]);
    if (exists) return;
    run(
      `INSERT INTO casino_games
        (game_id, name, game_type, provider_style, theme, status, min_bet, max_bet, max_win_multiplier,
         rtp_target, volatility, jackpot_eligible, config_json, sort_order, created_at)
       VALUES (?,?,?,?,?, 'ACTIVE', ?,?,?,?,?,?,?,?,?)`,
      [
        g.game_id,
        g.name,
        g.game_type,
        g.provider_style,
        g.theme,
        g.min_bet,
        g.max_bet,
        g.max_win_multiplier,
        g.rtp_target,
        g.volatility,
        g.jackpot_eligible ? 1 : 0,
        JSON.stringify(g.config_json ?? {}),
        i,
        now,
      ],
    );
  });

  // --- Jackpotovi ---
  // Samo kreiramo jackpotove kojih NEMA. Postojeće NE diramo da ne bismo
  // pregazili granice/seed/status koje admin podesi u back office-u.
  JACKPOTS.forEach((j, i) => {
    const exists = get<any>(`SELECT jackpot_id FROM jackpots WHERE jackpot_id=?`, [j.jackpot_id]);
    if (exists) return;
    run(
      `INSERT INTO jackpots
        (jackpot_id, name, tier, effect, color, currency, seed_amount, current_amount, lower_bound, upper_bound,
         base_weight, status, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 1, 'ACTIVE', ?, ?, ?)`,
      [j.jackpot_id, j.name, j.tier, j.effect, j.color, config.currency, j.seed, j.seed, j.lower, j.upper, i, now, now],
    );
    fundOperatorSeed(j.jackpot_id, j.seed);
  });

  // --- Admin ---
  if (!get(`SELECT player_id FROM players WHERE username=?`, [config.adminUsername])) {
    registerPlayer(config.adminUsername, config.adminPassword, "ADMIN");
  }

  // --- Demo igrac ---
  if (!get(`SELECT player_id FROM players WHERE username=?`, ["igrac1"])) {
    registerPlayer("igrac1", "igrac123", "PLAYER");
  }
}

/**
 * Reset stanja "od nule" bez gašenja servera: briše svu istoriju igranja,
 * vraća jackpotove na seed, balanse na startni iznos, mozak/free-bet/ponašanje
 * na nulu. Igre, igrači i jackpot-definicije ostaju (botovi nastavljaju da rade).
 */
export function resetState(): void {
  const wipe = [
    "casino_rounds",
    "casino_round_events",
    "casino_transactions",
    "mock_wallet_ledger",
    "wallet_connector_idempotency_log",
    "casino_active_locks",
    "casino_rng_logs",
    "player_rtp_curve",
    "freebet_grants",
    "jackpot_contributions",
    "jackpot_wins",
    "jackpot_seed_funding",
    "contribution_refund_log",
    "player_events",
    "notifications",
    "audit_logs",
    "recovery_attempts",
    "event_outbox",
    "manual_review_queue",
    "risk_flags",
    "reconciliation_issues",
    "player_behavior_metrics",
    // casino_sessions se NE briše: aktivni admin/igrač ostaju ulogovani posle reseta.
  ];
  const now = nowIso();
  tx(() => {
    for (const t of wipe) run(`DELETE FROM ${t}`);
    run(`UPDATE jackpots SET current_amount = seed_amount, last_win_at = NULL, updated_at = ?`, [now]);
    run(`UPDATE mock_wallet_balances SET balance = 0, updated_at = ?`, [now]);
    run(`UPDATE player_freebet_wallet SET balance = 0, granted_balance = 0, updated_at = ?`, [now]);
    run(
      `UPDATE player_brain_state SET total_wagered = 0, total_returned = 0, lifetime_rounds = 0,
         manual_rtp = NULL, target_rtp = ?, updated_at = ?`,
      [config.defaultTargetRtp, now],
    );
    run(`UPDATE house_ledger SET total_staked = 0, total_returned = 0, updated_at = ?`, [now]);
  });
}
