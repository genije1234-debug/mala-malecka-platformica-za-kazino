// Zajednicki tipovi koje koriste i backend i frontend.

export type GameType =
  | "classic_slot"
  | "book_slot"
  | "tumble_slot"
  | "megaways_slot"
  | "fishing_slot"
  | "crash"
  | "keno"
  | "instant";

export type GameStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "RETIRED";

export interface GameSummary {
  game_id: string;
  name: string;
  game_type: GameType;
  status: GameStatus;
  provider_style: string;
  theme: string;
  min_bet: number;
  max_bet: number;
  max_win_multiplier: number;
  rtp_target: number;
  volatility: string;
  jackpot_eligible: boolean;
  slot?: SlotShape;
}

/** Oblik slot mreže (po igri). Ako postoji, igra se renderuje kao animirani slot. */
export interface SlotShape {
  reels: number;
  rows: number;
  lines: number;
}

export type RoundStatus =
  | "CREATED"
  | "LOCK_ACQUIRED"
  | "BET_DEBIT_PENDING"
  | "BET_DEBITED"
  | "DEBIT_UNKNOWN"
  | "RESULT_GENERATED"
  | "WIN_CALCULATED"
  | "MAX_WIN_APPLIED"
  | "WIN_CREDIT_PENDING"
  | "WIN_CREDITED"
  | "JACKPOT_PENDING"
  | "JACKPOT_CREDITED"
  | "CLOSED"
  | "FAILED"
  | "ROLLED_BACK"
  | "MANUAL_REVIEW";

export type WalletTxType =
  | "BET_DEBIT"
  | "WIN_CREDIT"
  | "JACKPOT_CREDIT"
  | "REFUND"
  | "ROLLBACK"
  | "CORRECTION"
  | "DEPOSIT"
  | "OPERATOR_FUNDED_SEED";

export interface PlayResult {
  round_id: string;
  game_id: string;
  bet_amount: number;
  currency: string;
  mode: "REAL" | "FREEBET" | "DEMO";
  outcome: unknown;
  raw_win: number;
  final_win: number;
  max_win_applied: boolean;
  jackpot_win?: JackpotWinInfo | null;
  balance: number;
  freebet_balance: number;
  effective_rtp: number;
  status: RoundStatus;
}

export interface JackpotWinInfo {
  jackpot_id: string;
  name: string;
  amount: number;
}

export interface JackpotState {
  jackpot_id: string;
  name: string;
  tier: string;
  effect: string;
  color: string;
  currency: string;
  current_amount: number;
  seed_amount: number;
  lower_bound: number;
  upper_bound: number;
  active: boolean;
  /** 0..1 koliko je pool napunjen izmedju donje i gornje granice (jacina efekta) */
  intensity: number;
  last_win_at: string | null;
}

export interface PlayerProfile {
  player_id: string;
  username: string;
  balance: number;
  currency: string;
  freebet_balance: number;
  effective_rtp: number;
  target_rtp: number;
  total_wagered: number;
  total_returned: number;
}

export const CURRENCY = "EUR";
