import type { GameType } from "@casino/shared";

export interface CatalogGame {
  game_id: string;
  name: string;
  game_type: GameType;
  provider_style: string; // inspiracija (mehanika), nase ime
  theme: string;
  min_bet: number;
  max_bet: number;
  max_win_multiplier: number;
  rtp_target: number;
  volatility: string;
  jackpot_eligible: boolean;
  config_json?: any;
}

// 26 igara = ~8 tipova mehanike. Imena su nasa (brendovi su zasticeni),
// mehanika odgovara navedenim igrama.
export const CATALOG: CatalogGame[] = [
  // --- Klasicni voceni slotovi (EGT/Novomatic/Play'nGO stil) ---
  { game_id: "blazing40", name: "40 Blazing Fruits", game_type: "classic_slot", provider_style: "EGT 40 Super Hot", theme: "fruits", min_bet: 0.2, max_bet: 100, max_win_multiplier: 1000, rtp_target: 0.96, volatility: "low", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 4, lines: 40 } } },
  { game_id: "inferno40", name: "40 Inferno Fruits", game_type: "classic_slot", provider_style: "EGT 40 Burning Hot", theme: "fruits-fire", min_bet: 0.2, max_bet: 100, max_win_multiplier: 1000, rtp_target: 0.96, volatility: "low", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 4, lines: 40 } } },
  { game_id: "crowns40", name: "40 Royal Crowns", game_type: "classic_slot", provider_style: "EGT 40 Shining Crown", theme: "royal", min_bet: 0.2, max_bet: 100, max_win_multiplier: 1000, rtp_target: 0.96, volatility: "low", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 4, lines: 40 } } },
  { game_id: "sizzlingsevens", name: "Sizzling Sevens", game_type: "classic_slot", provider_style: "Sizzling Hot Deluxe", theme: "fruits", min_bet: 0.1, max_bet: 100, max_win_multiplier: 1000, rtp_target: 0.95, volatility: "medium", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 3, lines: 5 } } },
  { game_id: "flamingjoker", name: "Flaming Joker", game_type: "classic_slot", provider_style: "Play'n GO Fire Joker", theme: "joker", min_bet: 0.1, max_bet: 100, max_win_multiplier: 800, rtp_target: 0.96, volatility: "medium", jackpot_eligible: true, config_json: { slot: { reels: 3, rows: 3, lines: 5 } } },

  // --- Book slotovi (expanding symbol + free spins) ---
  { game_id: "bookofpharaoh", name: "Book of Pharaoh", game_type: "book_slot", provider_style: "Book of Ra Deluxe", theme: "egypt", min_bet: 0.2, max_bet: 100, max_win_multiplier: 5000, rtp_target: 0.95, volatility: "high", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 3, lines: 10 } } },
  { game_id: "luckyladycharms", name: "Lucky Lady Charms", game_type: "book_slot", provider_style: "Lucky Lady's Charm Deluxe", theme: "fortune", min_bet: 0.2, max_bet: 100, max_win_multiplier: 4000, rtp_target: 0.95, volatility: "high", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 3, lines: 10 } } },
  { game_id: "dolphintreasure", name: "Dolphin Treasure", game_type: "book_slot", provider_style: "Dolphin's Pearl Deluxe", theme: "ocean", min_bet: 0.2, max_bet: 100, max_win_multiplier: 4000, rtp_target: 0.95, volatility: "high", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 3, lines: 10 } } },
  { game_id: "tomeofdead", name: "Tome of the Dead", game_type: "book_slot", provider_style: "Book of Dead", theme: "egypt-adventure", min_bet: 0.1, max_bet: 100, max_win_multiplier: 5000, rtp_target: 0.96, volatility: "high", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 3, lines: 10 } } },

  // --- Tumble / cluster + multiplikatori (Pragmatic stil) ---
  { game_id: "olympusgates", name: "Olympus Gates 1000", game_type: "tumble_slot", provider_style: "Gates of Olympus 1000", theme: "greek-gods", min_bet: 0.2, max_bet: 100, max_win_multiplier: 15000, rtp_target: 0.96, volatility: "very_high", jackpot_eligible: true },
  { game_id: "sweetfiesta", name: "Sweet Fiesta 1000", game_type: "tumble_slot", provider_style: "Sweet Bonanza 1000", theme: "candy", min_bet: 0.2, max_bet: 100, max_win_multiplier: 15000, rtp_target: 0.96, volatility: "very_high", jackpot_eligible: true },
  { game_id: "starlightempress", name: "Starlight Empress 1000", game_type: "tumble_slot", provider_style: "Starlight Princess 1000", theme: "anime-space", min_bet: 0.2, max_bet: 100, max_win_multiplier: 15000, rtp_target: 0.96, volatility: "very_high", jackpot_eligible: true },
  { game_id: "sugarblast", name: "Sugar Blast 1000", game_type: "tumble_slot", provider_style: "Sugar Rush 1000", theme: "candy-grid", min_bet: 0.2, max_bet: 100, max_win_multiplier: 10000, rtp_target: 0.96, volatility: "very_high", jackpot_eligible: true },

  // --- Megaways ---
  { game_id: "doggyhouse", name: "Doggy House Megaways", game_type: "megaways_slot", provider_style: "The Dog House Megaways", theme: "dogs", min_bet: 0.2, max_bet: 100, max_win_multiplier: 12000, rtp_target: 0.96, volatility: "very_high", jackpot_eligible: true },

  // --- Fishing / money-collect ---
  { game_id: "bigbasscatch", name: "Big Bass Catch", game_type: "fishing_slot", provider_style: "Big Bass", theme: "fishing", min_bet: 0.1, max_bet: 100, max_win_multiplier: 5000, rtp_target: 0.96, volatility: "high", jackpot_eligible: true, config_json: { slot: { reels: 5, rows: 3, lines: 10 } } },

  // --- Crash ---
  { game_id: "skyjet", name: "SkyJet", game_type: "crash", provider_style: "Aviator (Spribe)", theme: "plane", min_bet: 0.1, max_bet: 100, max_win_multiplier: 10000, rtp_target: 0.97, volatility: "high", jackpot_eligible: true, config_json: { sub: "plane" } },
  { game_id: "jetblast", name: "Jet Blast", game_type: "crash", provider_style: "JetX (SmartSoft)", theme: "jet", min_bet: 0.1, max_bet: 100, max_win_multiplier: 10000, rtp_target: 0.97, volatility: "high", jackpot_eligible: true, config_json: { sub: "jet" } },
  { game_id: "cosmorunner", name: "Cosmo Runner", game_type: "crash", provider_style: "Spaceman (Pragmatic)", theme: "astronaut", min_bet: 0.1, max_bet: 100, max_win_multiplier: 10000, rtp_target: 0.97, volatility: "high", jackpot_eligible: true, config_json: { sub: "astronaut" } },
  { game_id: "bassreelcrash", name: "Big Bass Reel Crash", game_type: "crash", provider_style: "Big Bass Crash (Pragmatic)", theme: "fishing-crash", min_bet: 0.1, max_bet: 100, max_win_multiplier: 10000, rtp_target: 0.97, volatility: "high", jackpot_eligible: true, config_json: { sub: "fish" } },

  // --- Draw / Keno ---
  { game_id: "luckysixdraw", name: "Lucky Six Draw", game_type: "keno", provider_style: "Lucky Six (NSoft)", theme: "lottery", min_bet: 0.2, max_bet: 50, max_win_multiplier: 5000, rtp_target: 0.92, volatility: "high", jackpot_eligible: true },
  { game_id: "hellenickeno", name: "Hellenic Keno", game_type: "keno", provider_style: "Greek / OPAP Keno", theme: "keno", min_bet: 0.2, max_bet: 50, max_win_multiplier: 5000, rtp_target: 0.92, volatility: "high", jackpot_eligible: true },

  // --- Instant / skill ---
  { game_id: "plinkodrop", name: "Plinko Drop", game_type: "instant", provider_style: "Plinko", theme: "plinko", min_bet: 0.1, max_bet: 100, max_win_multiplier: 1000, rtp_target: 0.97, volatility: "medium", jackpot_eligible: true, config_json: { sub: "plinko" } },
  { game_id: "mines", name: "Mines", game_type: "instant", provider_style: "Mines", theme: "mines", min_bet: 0.1, max_bet: 100, max_win_multiplier: 1000, rtp_target: 0.97, volatility: "medium", jackpot_eligible: true, config_json: { sub: "mines" } },
  { game_id: "diceroll", name: "Dice Roll", game_type: "instant", provider_style: "Dice", theme: "dice", min_bet: 0.1, max_bet: 100, max_win_multiplier: 100, rtp_target: 0.97, volatility: "low", jackpot_eligible: false, config_json: { sub: "dice" } },
  { game_id: "penaltyshootout", name: "Penalty Shootout", game_type: "instant", provider_style: "Goal / Penalty", theme: "football", min_bet: 0.1, max_bet: 100, max_win_multiplier: 500, rtp_target: 0.96, volatility: "medium", jackpot_eligible: true, config_json: { sub: "penalty" } },
  { game_id: "limbo", name: "Limbo", game_type: "instant", provider_style: "Limbo", theme: "limbo", min_bet: 0.1, max_bet: 100, max_win_multiplier: 10000, rtp_target: 0.97, volatility: "high", jackpot_eligible: true, config_json: { sub: "limbo" } },
];
