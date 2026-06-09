import { Router, type Response } from "express";
import { all, get, run, nowIso } from "./db.ts";
import { uid, money } from "./util.ts";
import { config } from "./config.ts";
import { authMiddleware, adminMiddleware, authLimiter, playLimiter, type AuthedRequest } from "./middleware.ts";

import { registerPlayer, login } from "./services/session.ts";
import { startSessionCurve, getBrain, setManualRtp, effectiveRtp, getActiveCurve } from "./services/brain.ts";
import { getBalance, walletOp } from "./services/wallet.ts";
import { getFreebet } from "./services/freebet.ts";
import { listJackpots } from "./services/jackpot.ts";
import { houseStats } from "./services/houseGovernor.ts";
import { playRound, PlayError } from "./services/play.ts";
import {
  minesStart,
  minesReveal,
  minesCashout,
  crashStart,
  crashState,
  crashCashout,
  InteractiveError,
} from "./services/interactive.ts";
import { getBehavior, recomputeSessionMetrics } from "./services/behavior.ts";
import { audit } from "./services/audit.ts";
import { runReconciliation } from "./services/reconciliation.ts";
import { resetState } from "./seedData.ts";

/** Validacija novčanog uloga (anti-exploit). */
function validBet(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export const api = Router();

// ============================ AUTH ============================

api.post("/auth/register", authLimiter, (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "MISSING_FIELDS" });
  try {
    const playerId = registerPlayer(username, password);
    const { token, player } = login(username, password, { ip: req.ip, userAgent: req.headers["user-agent"] as string });
    startSessionCurve(playerId, null);
    res.json({ token, player_id: playerId, username: player.username });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

api.post("/auth/login", authLimiter, (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "MISSING_FIELDS" });
  try {
    const { token, player } = login(username, password, { ip: req.ip, userAgent: req.headers["user-agent"] as string });
    recomputeSessionMetrics(player.player_id);
    startSessionCurve(player.player_id, null);
    res.json({ token, player_id: player.player_id, username: player.username, role: player.role });
  } catch (e: any) {
    res.status(401).json({ error: e.message });
  }
});

api.get("/auth/me", authMiddleware, (req: AuthedRequest, res) => {
  const pid = req.auth!.player_id;
  res.json(buildProfile(pid));
});

// ============================ GAMES ============================

api.get("/games", (_req, res) => {
  const rows = all<any>(`SELECT * FROM casino_games WHERE status='ACTIVE' ORDER BY sort_order ASC`);
  res.json(rows.map(gameSummary));
});

api.get("/games/:id", (req, res) => {
  const g = get<any>(`SELECT * FROM casino_games WHERE game_id=?`, [req.params.id]);
  if (!g) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(gameSummary(g));
});

// ============================ PLAY ============================

api.post("/round/start", authMiddleware, playLimiter, (req: AuthedRequest, res) => {
  const { gameId, betAmount, mode, options } = req.body ?? {};
  if (!gameId || !betAmount) return res.status(400).json({ error: "MISSING_FIELDS" });
  try {
    const result = playRound({
      playerId: req.auth!.player_id,
      sessionId: req.auth!.session_id,
      gameId,
      betAmount: Number(betAmount),
      mode: mode === "FREEBET" ? "FREEBET" : "REAL",
      options,
    });
    res.json(result);
  } catch (e: any) {
    if (e instanceof PlayError) return res.status(400).json({ error: e.code });
    console.error(e);
    res.status(500).json({ error: "PLAY_FAILED" });
  }
});

// ---- Interaktivne igre: Mines ----
api.post("/round/mines/start", authMiddleware, playLimiter, (req: AuthedRequest, res) => {
  const { gameId, betAmount, mines, mode } = req.body ?? {};
  const bet = validBet(betAmount);
  if (bet == null) return res.status(400).json({ error: "INVALID_BET" });
  const mineCount = Math.min(24, Math.max(1, Math.floor(Number(mines ?? 3)) || 3));
  handleInteractive(res, () =>
    minesStart(
      req.auth!.player_id,
      req.auth!.session_id,
      gameId ?? "mines",
      bet,
      mineCount,
      mode === "FREEBET" ? "FREEBET" : "REAL",
    ),
  );
});

api.post("/round/mines/reveal", authMiddleware, (req: AuthedRequest, res) => {
  const { roundId, cell } = req.body ?? {};
  handleInteractive(res, () => minesReveal(req.auth!.player_id, req.auth!.session_id, roundId, Number(cell)));
});

api.post("/round/mines/cashout", authMiddleware, (req: AuthedRequest, res) => {
  const { roundId } = req.body ?? {};
  handleInteractive(res, () => minesCashout(req.auth!.player_id, req.auth!.session_id, roundId));
});

// ---- Interaktivne igre: Crash ----
api.post("/round/crash/start", authMiddleware, playLimiter, (req: AuthedRequest, res) => {
  const { gameId, betAmount, mode } = req.body ?? {};
  const bet = validBet(betAmount);
  if (bet == null) return res.status(400).json({ error: "INVALID_BET" });
  handleInteractive(res, () =>
    crashStart(
      req.auth!.player_id,
      req.auth!.session_id,
      gameId ?? "skyjet",
      bet,
      mode === "FREEBET" ? "FREEBET" : "REAL",
    ),
  );
});

api.post("/round/crash/state", authMiddleware, (req: AuthedRequest, res) => {
  const { roundId } = req.body ?? {};
  handleInteractive(res, () => crashState(req.auth!.player_id, req.auth!.session_id, roundId));
});

api.post("/round/crash/cashout", authMiddleware, (req: AuthedRequest, res) => {
  const { roundId } = req.body ?? {};
  handleInteractive(res, () => crashCashout(req.auth!.player_id, req.auth!.session_id, roundId));
});

api.get("/round/:id", authMiddleware, (req: AuthedRequest, res) => {
  const r = get<any>(`SELECT * FROM casino_rounds WHERE round_id=? AND player_id=?`, [
    req.params.id,
    req.auth!.player_id,
  ]);
  if (!r) return res.status(404).json({ error: "NOT_FOUND" });
  res.json(r);
});

api.get("/history", authMiddleware, (req: AuthedRequest, res) => {
  const rows = all<any>(
    `SELECT round_id, game_id, bet_amount, final_win_amount, jackpot_amount, status, created_at, outcome_json
     FROM casino_rounds WHERE player_id=? ORDER BY created_at DESC LIMIT 50`,
    [req.auth!.player_id],
  );
  res.json(rows);
});

// ============================ JACKPOTS ============================

api.get("/jackpots", (_req, res) => {
  res.json(listJackpots());
});

// ============================ PLAYER ============================

api.get("/player/profile", authMiddleware, (req: AuthedRequest, res) => {
  res.json(buildProfile(req.auth!.player_id));
});

api.get("/player/freebet", authMiddleware, (req: AuthedRequest, res) => {
  res.json(getFreebet(req.auth!.player_id));
});


api.get("/player/curve", authMiddleware, (req: AuthedRequest, res) => {
  const curve = getActiveCurve(req.auth!.player_id);
  res.json(curve ?? null);
});

api.get("/player/notifications", authMiddleware, (req: AuthedRequest, res) => {
  const rows = all<any>(`SELECT * FROM notifications WHERE player_id=? ORDER BY created_at DESC LIMIT 30`, [
    req.auth!.player_id,
  ]);
  res.json(rows);
});

api.post("/player/notifications/:id/read", authMiddleware, (req: AuthedRequest, res) => {
  run(`UPDATE notifications SET read=1 WHERE notification_id=? AND player_id=?`, [req.params.id, req.auth!.player_id]);
  res.json({ ok: true });
});

// ============================ ADMIN ============================

api.get("/admin/players", authMiddleware, adminMiddleware, (_req, res) => {
  const rows = all<any>(
    `SELECT p.player_id, p.username, p.status, b.target_rtp, b.manual_rtp, b.total_wagered, b.total_returned, b.lifetime_rounds
     FROM players p LEFT JOIN player_brain_state b ON b.player_id=p.player_id
     WHERE p.role='PLAYER' ORDER BY p.created_at DESC`,
  );
  res.json(
    rows.map((r) => ({
      ...r,
      balance: getBalance(r.player_id),
      effective_rtp: r.total_wagered > 0 ? r.total_returned / r.total_wagered : r.target_rtp,
    })),
  );
});

api.get("/admin/players/:id", authMiddleware, adminMiddleware, (req, res) => {
  const pid = req.params.id;
  const player = get<any>(`SELECT player_id, username, status, created_at FROM players WHERE player_id=?`, [pid]);
  if (!player) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({
    player,
    brain: getBrain(pid),
    behavior: getBehavior(pid),
    curve: getActiveCurve(pid),
    balance: getBalance(pid),
    freebet: getFreebet(pid),
    recent_rounds: all<any>(`SELECT * FROM casino_rounds WHERE player_id=? ORDER BY created_at DESC LIMIT 25`, [pid]),
  });
});

api.post("/admin/players/:id/rtp", authMiddleware, adminMiddleware, (req: AuthedRequest, res) => {
  const pid = req.params.id;
  const { rtp } = req.body ?? {};
  const value = rtp == null || rtp === "" ? null : Number(rtp);
  const old = getBrain(pid);
  setManualRtp(pid, value);
  audit({
    actorId: req.auth!.player_id,
    action: "MANUAL_RTP_SET",
    entityType: "player",
    entityId: pid,
    oldValue: { manual_rtp: old.manual_rtp },
    newValue: { manual_rtp: value },
  });
  res.json({ ok: true, target_rtp: value ?? config.defaultTargetRtp });
});

// Admin dopuna balansa igraču (uplata). Pravilno knjiženo: DEPOSIT tip
// (ledger + casino_transactions preko walletOp) + audit log.
api.post("/admin/players/:id/credit", authMiddleware, adminMiddleware, (req: AuthedRequest, res) => {
  const pid = req.params.id;
  const player = get<any>(`SELECT player_id FROM players WHERE player_id=?`, [pid]);
  if (!player) return res.status(404).json({ error: "NOT_FOUND" });
  const amount = validBet((req.body ?? {}).amount);
  if (amount == null) return res.status(400).json({ error: "INVALID_AMOUNT" });
  const capped = Math.min(amount, 1_000_000); // sanity plafon
  const before = getBalance(pid);
  const r = walletOp({
    idempotencyKey: `deposit-${pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    playerId: pid,
    txType: "DEPOSIT",
    amount: capped,
  });
  audit({
    actorId: req.auth!.player_id,
    action: "PLAYER_DEPOSIT",
    entityType: "player",
    entityId: pid,
    oldValue: { balance: before },
    newValue: { balance: r.balance, amount: capped },
  });
  res.json({ ok: r.status === "SUCCESS", balance: r.balance });
});

api.get("/admin/games", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(all<any>(`SELECT * FROM casino_games ORDER BY sort_order ASC`));
});

api.post("/admin/games/:id/status", authMiddleware, adminMiddleware, (req: AuthedRequest, res) => {
  const { status } = req.body ?? {};
  const valid = ["ACTIVE", "INACTIVE", "MAINTENANCE", "RETIRED"];
  if (!valid.includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
  const old = get<any>(`SELECT status FROM casino_games WHERE game_id=?`, [req.params.id]);
  run(`UPDATE casino_games SET status=? WHERE game_id=?`, [status, req.params.id]);
  audit({
    actorId: req.auth!.player_id,
    action: "GAME_STATUS_CHANGE",
    entityType: "game",
    entityId: req.params.id,
    oldValue: old,
    newValue: { status },
  });
  res.json({ ok: true });
});

api.get("/admin/jackpots", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(all<any>(`SELECT * FROM jackpots ORDER BY sort_order ASC`));
});

api.post("/admin/jackpots/:id", authMiddleware, adminMiddleware, (req: AuthedRequest, res) => {
  const { lower_bound, upper_bound, base_weight, status, seed_amount } = req.body ?? {};
  const old = get<any>(`SELECT * FROM jackpots WHERE jackpot_id=?`, [req.params.id]);
  if (!old) return res.status(404).json({ error: "NOT_FOUND" });
  run(
    `UPDATE jackpots SET lower_bound=?, upper_bound=?, base_weight=?, status=?, seed_amount=?, updated_at=? WHERE jackpot_id=?`,
    [
      lower_bound ?? old.lower_bound,
      upper_bound ?? old.upper_bound,
      base_weight ?? old.base_weight,
      status ?? old.status,
      seed_amount ?? old.seed_amount,
      nowIso(),
      req.params.id,
    ],
  );
  audit({ actorId: req.auth!.player_id, action: "JACKPOT_CONFIG_CHANGE", entityType: "jackpot", entityId: req.params.id, oldValue: old, newValue: req.body });
  res.json({ ok: true });
});

api.get("/admin/audit", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(all<any>(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`));
});

api.get("/admin/manual-review", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(all<any>(`SELECT * FROM manual_review_queue ORDER BY created_at DESC LIMIT 100`));
});

api.get("/admin/behavior", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(all<any>(`SELECT * FROM player_behavior_metrics ORDER BY updated_at DESC LIMIT 100`));
});

api.get("/admin/rounds", authMiddleware, adminMiddleware, (req, res) => {
  const pid = req.query.player_id as string | undefined;
  const rows = pid
    ? all<any>(
        `SELECT round_id, player_id, game_id, mode, bet_amount, final_win_amount, jackpot_amount, status, created_at
         FROM casino_rounds WHERE player_id=? ORDER BY created_at DESC LIMIT 100`,
        [pid],
      )
    : all<any>(
        `SELECT round_id, player_id, game_id, mode, bet_amount, final_win_amount, jackpot_amount, status, created_at
         FROM casino_rounds ORDER BY created_at DESC LIMIT 100`,
      );
  res.json(rows);
});

api.get("/admin/transactions", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(
    all<any>(
      `SELECT transaction_id, round_id, player_id, tx_type, amount, currency, status, created_at
       FROM casino_transactions ORDER BY created_at DESC LIMIT 120`,
    ),
  );
});

api.get("/admin/events", authMiddleware, adminMiddleware, (req, res) => {
  const pid = req.query.player_id as string | undefined;
  const rows = pid
    ? all<any>(`SELECT * FROM player_events WHERE player_id=? ORDER BY created_at DESC LIMIT 100`, [pid])
    : all<any>(`SELECT * FROM player_events ORDER BY created_at DESC LIMIT 100`);
  res.json(rows);
});

// ============================ REPORTS ============================

api.get("/reports/total", authMiddleware, adminMiddleware, (_req, res) => {
  const r = get<any>(
    `SELECT COUNT(*) AS rounds, COALESCE(SUM(bet_amount),0) AS total_bet,
            COALESCE(SUM(final_win_amount),0) AS total_win,
            COALESCE(SUM(jackpot_amount),0) AS total_jackpot
     FROM casino_rounds WHERE mode='REAL'`,
  )!;
  const totalBet = r.total_bet || 0;
  const totalReturn = (r.total_win || 0) + (r.total_jackpot || 0);
  const hs = houseStats();
  res.json({
    total_rounds: r.rounds,
    total_bet: money(totalBet),
    total_win: money(r.total_win),
    total_jackpot_payout: money(r.total_jackpot),
    ggr: money(totalBet - totalReturn),
    total_rtp: totalBet > 0 ? totalReturn / totalBet : 0,
    // House governor: tvrdi plafon isplate (garantovano <= ciljani RTP).
    house_staked: money(hs.staked),
    house_returned: money(hs.returned),
    house_rtp: hs.rtp,
    house_budget: money(hs.budget),
    house_target_rtp: config.defaultTargetRtp,
  });
});

api.get("/reports/per-game", authMiddleware, adminMiddleware, (_req, res) => {
  const rows = all<any>(
    `SELECT g.game_id, g.name, g.game_type,
            COUNT(r.round_id) AS rounds,
            COALESCE(SUM(r.bet_amount),0) AS total_bet,
            COALESCE(SUM(r.final_win_amount),0) AS total_win,
            COALESCE(SUM(r.jackpot_amount),0) AS total_jackpot,
            COALESCE(MAX(r.final_win_amount),0) AS max_win
     FROM casino_games g LEFT JOIN casino_rounds r ON r.game_id=g.game_id AND r.mode='REAL'
     GROUP BY g.game_id ORDER BY rounds DESC`,
  );
  res.json(
    rows.map((r) => ({
      ...r,
      rtp: r.total_bet > 0 ? (r.total_win + r.total_jackpot) / r.total_bet : null,
      ggr: money(r.total_bet - r.total_win - r.total_jackpot),
    })),
  );
});

api.get("/reports/jackpots", authMiddleware, adminMiddleware, (_req, res) => {
  const rows = all<any>(`SELECT * FROM jackpots ORDER BY sort_order ASC`);
  res.json(
    rows.map((j) => {
      const wins = get<any>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM jackpot_wins WHERE jackpot_id=? AND status='CREDITED'`,
        [j.jackpot_id],
      )!;
      const contrib = get<any>(
        `SELECT COALESCE(SUM(amount),0) AS total FROM jackpot_contributions WHERE jackpot_id=? AND status='APPLIED'`,
        [j.jackpot_id],
      )!;
      return {
        jackpot_id: j.jackpot_id,
        name: j.name,
        current_amount: money(j.current_amount),
        total_contributions: money(contrib.total),
        total_payouts: money(wins.total),
        number_of_wins: wins.n,
        last_win_at: j.last_win_at,
      };
    }),
  );
});

api.post("/admin/reconciliation/run", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(runReconciliation());
});

// Restart/reset stanja "od nule" (briše istoriju, vraća jackpotove/balanse).
api.post("/admin/reset", authMiddleware, adminMiddleware, (req: AuthedRequest, res) => {
  resetState();
  audit({ actorId: req.auth!.player_id, action: "STATE_RESET", entityType: "system", entityId: "all" });
  res.json({ ok: true });
});

// ============================ helpers ============================

function handleInteractive(res: Response, fn: () => unknown) {
  try {
    res.json(fn());
  } catch (e: any) {
    if (e instanceof InteractiveError) return res.status(400).json({ error: e.code });
    console.error(e);
    res.status(500).json({ error: "PLAY_FAILED" });
  }
}

function gameSummary(g: any) {
  let slot: { reels: number; rows: number; lines: number } | undefined;
  try {
    const cfg = typeof g.config_json === "string" ? JSON.parse(g.config_json) : g.config_json;
    if (cfg?.slot) slot = cfg.slot;
  } catch {
    /* ignorisi neispravan config */
  }
  return {
    game_id: g.game_id,
    name: g.name,
    game_type: g.game_type,
    status: g.status,
    provider_style: g.provider_style,
    theme: g.theme,
    min_bet: g.min_bet,
    max_bet: g.max_bet,
    max_win_multiplier: g.max_win_multiplier,
    rtp_target: g.rtp_target,
    volatility: g.volatility,
    jackpot_eligible: !!g.jackpot_eligible,
    slot,
  };
}

function buildProfile(playerId: string) {
  const player = get<any>(`SELECT player_id, username, role FROM players WHERE player_id=?`, [playerId])!;
  const brain = getBrain(playerId);
  const fb = getFreebet(playerId);
  return {
    player_id: playerId,
    username: player.username,
    role: player.role,
    balance: getBalance(playerId),
    currency: config.currency,
    freebet_balance: money(fb.balance + fb.granted_balance),
    freebet_accrued: fb.balance,
    freebet_granted: fb.granted_balance,
    effective_rtp: effectiveRtp(playerId),
    target_rtp: brain.target_rtp,
    total_wagered: money(brain.total_wagered),
    total_returned: money(brain.total_returned),
  };
}
