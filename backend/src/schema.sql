-- Casino Engine schema (SQLite dev; portabilno ka PostgreSQL).
-- Sve novcane vrednosti su REAL u osnovnoj valuti (EUR). Vreme = ISO8601 TEXT.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================ IGRACI / SESIJE ============================

CREATE TABLE IF NOT EXISTS players (
  player_id     TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'PLAYER', -- PLAYER | ADMIN
  status        TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | BLOCKED | SELF_EXCLUDED
  self_excluded INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  jurisdiction_allowed INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS casino_sessions (
  session_id  TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(player_id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ended_at    TEXT,
  ip_address  TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON casino_sessions(player_id);

-- ============================ MOCK WALLET (izvor istine) ============================
-- Simulira postojeci betting wallet. Casino ga menja samo preko Wallet Connectora.

CREATE TABLE IF NOT EXISTS mock_wallet_balances (
  player_id TEXT PRIMARY KEY REFERENCES players(player_id),
  balance   REAL NOT NULL DEFAULT 0,
  currency  TEXT NOT NULL DEFAULT 'EUR',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_wallet_ledger (
  ledger_id  TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  amount     REAL NOT NULL,        -- + kredit, - debit
  tx_type    TEXT NOT NULL,
  reference  TEXT,                 -- idempotency_key
  created_at TEXT NOT NULL
);

-- Lokalni idempotency layer Wallet Connectora.
CREATE TABLE IF NOT EXISTS wallet_connector_idempotency_log (
  idempotency_key TEXT PRIMARY KEY,   -- UNIQUE garancija
  player_id       TEXT,
  round_id        TEXT,
  tx_type         TEXT NOT NULL,
  amount          REAL NOT NULL,
  status          TEXT NOT NULL,      -- PENDING | SUCCESS | FAILED
  wallet_reference TEXT,
  response_json   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ============================ IGRE ============================

CREATE TABLE IF NOT EXISTS casino_games (
  game_id            TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  game_type          TEXT NOT NULL,
  provider_style     TEXT NOT NULL,
  theme              TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  min_bet            REAL NOT NULL,
  max_bet            REAL NOT NULL,
  max_win_multiplier REAL NOT NULL,
  rtp_target         REAL NOT NULL,
  volatility         TEXT NOT NULL,
  jackpot_eligible   INTEGER NOT NULL DEFAULT 1,
  game_version       TEXT NOT NULL DEFAULT '1.0.0',
  math_config_version TEXT NOT NULL DEFAULT 'v1',
  payout_table_version TEXT NOT NULL DEFAULT 'v1',
  config_json        TEXT NOT NULL DEFAULT '{}',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);

-- ============================ RUNDE ============================

CREATE TABLE IF NOT EXISTS casino_rounds (
  round_id            TEXT PRIMARY KEY,
  player_id           TEXT NOT NULL,
  game_id             TEXT NOT NULL,
  session_id          TEXT,
  mode                TEXT NOT NULL DEFAULT 'REAL', -- REAL | FREEBET | DEMO
  currency            TEXT NOT NULL DEFAULT 'EUR',
  bet_amount          REAL NOT NULL,
  raw_win_amount      REAL NOT NULL DEFAULT 0,
  final_win_amount    REAL NOT NULL DEFAULT 0,
  jackpot_amount      REAL NOT NULL DEFAULT 0,
  max_win_applied     INTEGER NOT NULL DEFAULT 0,
  game_version        TEXT,
  math_config_version TEXT,
  payout_table_version TEXT,
  status              TEXT NOT NULL,
  outcome_json        TEXT,
  effective_rtp_at_play REAL,
  favorability        REAL,
  created_at          TEXT NOT NULL,
  closed_at           TEXT,
  last_heartbeat_at   TEXT,
  expected_next_status TEXT,
  expected_next_status_deadline TEXT,
  recovery_locked_by  TEXT,
  recovery_locked_at  TEXT,
  recovery_lock_expires_at TEXT,
  recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_recovery_error TEXT,
  manual_review_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_rounds_player ON casino_rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON casino_rounds(status);

CREATE TABLE IF NOT EXISTS casino_round_events (
  event_id   TEXT PRIMARY KEY,
  round_id   TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_round_events_round ON casino_round_events(round_id);

-- Casino-side ledger (paralelno sa wallet ledgerom; za reconciliation).
CREATE TABLE IF NOT EXISTS casino_transactions (
  transaction_id  TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  round_id        TEXT,
  player_id       TEXT NOT NULL,
  game_id         TEXT,
  tx_type         TEXT NOT NULL,
  amount          REAL NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  status          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_player ON casino_transactions(player_id);

-- Active round lock (1 igrac = 1 aktivna real-money runda).
CREATE TABLE IF NOT EXISTS casino_active_locks (
  player_id       TEXT PRIMARY KEY,
  lock_id         TEXT NOT NULL,
  round_id        TEXT,
  game_id         TEXT,
  created_at      TEXT NOT NULL,
  lock_expires_at TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
);

-- ============================ RNG AUDIT ============================

CREATE TABLE IF NOT EXISTS casino_rng_logs (
  rng_id              TEXT PRIMARY KEY,
  round_id            TEXT NOT NULL,
  game_id             TEXT NOT NULL,
  player_id           TEXT NOT NULL,
  server_seed         TEXT,
  server_seed_hash    TEXT,
  nonce               INTEGER,
  raw_rng_output      TEXT,
  mapped_result       TEXT,
  algorithm_version   TEXT,
  hash_chain_previous TEXT,
  hash_chain_current  TEXT,
  created_at          TEXT NOT NULL
);

-- ============================ MOZAK / RTP ============================

CREATE TABLE IF NOT EXISTS player_brain_state (
  player_id        TEXT PRIMARY KEY REFERENCES players(player_id),
  target_rtp       REAL NOT NULL,        -- efektivna meta (manual override ili default)
  manual_rtp       REAL,                 -- rucno zadat RTP (NULL = nije zadat)
  total_wagered    REAL NOT NULL DEFAULT 0,
  total_returned   REAL NOT NULL DEFAULT 0,
  lifetime_rounds  INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);

-- Kriva po sesiji (parametri putanje koja vodi igraca).
CREATE TABLE IF NOT EXISTS player_rtp_curve (
  curve_id      TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL,
  session_id    TEXT,
  target_rtp    REAL NOT NULL,
  curve_json    TEXT NOT NULL,   -- parametri oblika (amplitude, faze...)
  session_wagered REAL NOT NULL DEFAULT 0,
  session_returned REAL NOT NULL DEFAULT 0,
  expected_session_volume REAL NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_curve_player ON player_rtp_curve(player_id, active);

-- ============================ FREE BET ============================

CREATE TABLE IF NOT EXISTS player_freebet_wallet (
  player_id  TEXT PRIMARY KEY REFERENCES players(player_id),
  balance    REAL NOT NULL DEFAULT 0,   -- akumulirana kasica (1% betova)
  granted_balance REAL NOT NULL DEFAULT 0, -- dodeljeni free bet spreman za igru
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS freebet_grants (
  grant_id   TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  amount     REAL NOT NULL,
  reason     TEXT,
  status     TEXT NOT NULL DEFAULT 'GRANTED', -- GRANTED | USED | EXPIRED
  created_at TEXT NOT NULL,
  used_at    TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grants_player ON freebet_grants(player_id, status);

-- ============================ JACKPOT ============================

CREATE TABLE IF NOT EXISTS jackpots (
  jackpot_id     TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  tier           TEXT NOT NULL,
  effect         TEXT NOT NULL,    -- vizuelni efekat (glow, shake, pulse...)
  color          TEXT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'EUR',
  seed_amount    REAL NOT NULL,
  current_amount REAL NOT NULL,
  lower_bound    REAL NOT NULL,    -- aktivacija
  upper_bound    REAL NOT NULL,    -- must-drop
  base_weight    REAL NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'ACTIVE',
  last_win_at    TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jackpot_contributions (
  contribution_id TEXT PRIMARY KEY,
  round_id   TEXT,
  player_id  TEXT NOT NULL,
  game_id    TEXT,
  jackpot_id TEXT NOT NULL,
  amount     REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'APPLIED', -- APPLIED | REVERSED | REFUNDED
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contrib_round ON jackpot_contributions(round_id);

CREATE TABLE IF NOT EXISTS jackpot_wins (
  jackpot_win_id TEXT PRIMARY KEY,
  jackpot_id   TEXT NOT NULL,
  round_id     TEXT,
  player_id    TEXT NOT NULL,
  amount       REAL NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|CREDIT_PENDING|CREDITED|FAILED|MANUAL_REVIEW|CANCELLED
  transaction_id TEXT,
  idempotency_key TEXT,
  created_at   TEXT NOT NULL,
  credited_at  TEXT
);

CREATE TABLE IF NOT EXISTS jackpot_seed_funding (
  seed_funding_id TEXT PRIMARY KEY,
  jackpot_id    TEXT NOT NULL,
  amount        REAL NOT NULL,
  funding_source TEXT NOT NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contribution_refund_log (
  refund_id   TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL,
  round_id    TEXT,
  jackpot_id  TEXT NOT NULL,
  amount      REAL NOT NULL,
  reason      TEXT,
  created_at  TEXT NOT NULL
);

-- ============================ PRACENJE PONASANJA ============================

CREATE TABLE IF NOT EXISTS player_events (
  event_id   TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,  -- LOGIN, SESSION_START, GAME_OPEN, BET, WIN, LOSS, STOP, FREEBET_GRANT, FREEBET_USE, JACKPOT_WIN
  game_id    TEXT,
  amount     REAL,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_player ON player_events(player_id, created_at);

CREATE TABLE IF NOT EXISTS player_behavior_metrics (
  player_id        TEXT PRIMARY KEY,
  total_sessions   INTEGER NOT NULL DEFAULT 0,
  total_rounds     INTEGER NOT NULL DEFAULT 0,
  avg_bet          REAL NOT NULL DEFAULT 0,
  last_bet         REAL NOT NULL DEFAULT 0,
  bet_trend        TEXT,             -- UP | DOWN | FLAT (reakcija na dobitak/gubitak)
  favorite_game    TEXT,
  median_session_gap_sec REAL,       -- za AI free-bet timing
  last_session_at  TEXT,
  tilt_score       REAL NOT NULL DEFAULT 0,   -- 0..1
  churn_risk       REAL NOT NULL DEFAULT 0,   -- 0..1
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_player ON notifications(player_id, read);

-- ============================ AUDIT / OPS ============================

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id    TEXT PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS recovery_attempts (
  attempt_id  TEXT PRIMARY KEY,
  round_id    TEXT NOT NULL,
  worker      TEXT,
  action      TEXT,
  result      TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_outbox (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  round_id    TEXT,
  priority_level INTEGER NOT NULL DEFAULT 50, -- 100 HIGH | 50 NORMAL | 10 LOW
  payload     TEXT,
  status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PUBLISHED | FAILED
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  created_at  TEXT NOT NULL,
  published_at TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON event_outbox(status, priority_level);

CREATE TABLE IF NOT EXISTS manual_review_queue (
  review_id   TEXT PRIMARY KEY,
  round_id    TEXT,
  player_id   TEXT,
  game_id     TEXT,
  current_status TEXT,
  reason      TEXT,
  severity    TEXT NOT NULL DEFAULT 'NORMAL',
  resolution_status TEXT NOT NULL DEFAULT 'OPEN',
  resolution_comment TEXT,
  resolved_by TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS risk_flags (
  flag_id    TEXT PRIMARY KEY,
  player_id  TEXT,
  round_id   TEXT,
  type       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'LOW',
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_issues (
  issue_id   TEXT PRIMARY KEY,
  round_id   TEXT,
  transaction_id TEXT,
  type       TEXT NOT NULL,
  detail     TEXT,
  status     TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL
);

-- Globalni "house governor" budzet: garancija da ukupna isplata nikad ne
-- predje ciljani RTP (npr. 95%) u odnosu na ukupan realan ulog.
CREATE TABLE IF NOT EXISTS house_ledger (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  total_staked   REAL NOT NULL DEFAULT 0,
  total_returned REAL NOT NULL DEFAULT 0,
  updated_at     TEXT
);
