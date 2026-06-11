export function translate(code: string): string {
  const map: Record<string, string> = {
    INSUFFICIENT_FUNDS: "Nemaš dovoljno novca",
    ACTIVE_ROUND_EXISTS: "Već imaš aktivnu rundu",
    BET_OUT_OF_LIMITS: "Ulog van limita",
    NO_FREEBET_BALANCE: "Nemaš free bet",
    GAME_NOT_ACTIVE: "Igra trenutno nije dostupna",
    GAME_NOT_FOUND: "Igra nije pronađena",
    SELF_EXCLUDED: "Nalog je samoisključen",
    COOLDOWN_ACTIVE: "Cooldown je aktivan",
    INVALID_MINES: "Neispravan broj mina",
    INVALID_CELL: "Neispravno polje",
    ALREADY_REVEALED: "Polje je već otvoreno",
    ROUND_OVER: "Runda je završena",
    ROUND_NOT_FOUND: "Runda nije pronađena",
    NOTHING_REVEALED: "Otvori bar jedno polje",
    WRONG_GAME: "Pogrešan tip igre",
    NETWORK: "Prekid veze sa serverom — pokušaj ponovo",
    TIMEOUT: "Server ne odgovara — pokušaj ponovo",
    TOO_MANY_REQUESTS: "Previše zahteva — uspori malo",
  };
  return map[code] || code;
}
