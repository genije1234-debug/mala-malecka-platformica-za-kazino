# Lucky Brain Casino — Casino Engine

Mobile-first casino platforma gde je **mozak (RTP kriva po igraču)** srce sistema.
Igre, jackpotovi i free bet su alati koji vode igrača kroz iskustvo i ka ciljanom RTP-u.

> Imena igara su naša. Mehanika odgovara poznatim tipovima (slot, book, tumble, megaways,
> fishing, crash, keno, instant). 26 igara = ~8 tipova engine-a + konfiguracija po igri.

## Šta je unutra

- **Mozak / RTP kriva po igraču** — na početku sesije pravi se kriva iz zadnjih 30 dana igranja
  + ručni RTP override po igraču. Engine vodi ishode kroz "koridor" oko krive
  (unutra = čist RNG, van = korekcija nazad). RTP je globalan za sve igre.
- **Game Engine** — jedan engine, 8 tipova mehanike, svih 26 igara kroz konfiguraciju.
  Server generiše svaki ishod (EV kontrolisan), nikad frontend. RNG audit + hash chain.
- **10 jackpotova** — 2% od svake uplate, AI balanser deli punjenje, dobitnik je igrač
  kome najviše treba da se digne RTP, atomic claim (nema duple isplate), reset na seed.
  Donja granica = aktivacija (sivi dok nije aktivan), gornja = must-drop, može pasti i pre.
  Živi vizuelni efekti (sjaj/treskanje) preko WebSocket-a, intenzitet raste ka vrhu.
- **Free bet / re-engagement** — 1% svakog beta ide u ličnu kasicu; kad igrač prestane da
  igra, AI bira trenutak i šalje notifikaciju "dobio si free betove". Free bet ide ceo.
- **Praćenje ponašanja** — sesije, ulozi, trend uloga, tilt, omiljena igra, churn signali.
- **Wallet Connector** — postojeći wallet je izvor istine; idempotency layer, recovery worker,
  reconciliation, manual review, audit log, event outbox. Ovde je **mock wallet** (lokalni),
  spreman za zamenu pravim API contractom.
- **Admin panel** — ručni RTP po igraču, status igara, jackpot config, izveštaji (RTP po igri),
  ponašanje igrača, audit, manual review.

## Tehnologije

- **Frontend:** React + TypeScript + Vite (mobile-first)
- **Backend:** Node.js + TypeScript (Express) + WebSocket
- **Baza:** SQLite (ugrađen `node:sqlite`) za lokalni dev — bez ikakvog spoljnog servera.
  Schema i upiti su pisani tako da se kasnije lako prebace na PostgreSQL za produkciju.

## Pokretanje (Windows)

Potreban je Node.js 22.5+ (preporučeno 24). Iz root foldera:

```bash
npm install
npm run dev
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173 (otvori na telefonu/uskom prozoru za mobilni izgled)

Frontend automatski proksira `/api` i `/ws` ka backendu.

### Nalozi (seed)

- Igrač: `igrac1` / `igrac123`
- Admin: `admin` / `admin123`

### Reset baze

Obriši `backend/data/` i ponovo pokreni — sve se iznova seed-uje (igre, 10 jackpotova, nalozi).

## Struktura

```
shared/    zajednički TypeScript tipovi
backend/   Casino Engine (API, mozak, igre, jackpot, free bet, workeri)
  src/services/  brain, wallet, jackpot, freebet, round, lock, session, behavior...
  src/games/     engines (8 tipova) + catalog (26 igara)
  src/schema.sql sve tabele
frontend/  mobilni React UI (lobi, igra, profil sa RTP krivom, admin)
```

## Napomena

Ovo je razvojni MVP po internoj specifikaciji. Pre bilo kakvog real-money launcha potrebni su
pravni/compliance pregled, sertifikacija RNG/matematike ako jurisdikcija zahteva, i zamena
mock walleta pravim Wallet Connector API contractom.
