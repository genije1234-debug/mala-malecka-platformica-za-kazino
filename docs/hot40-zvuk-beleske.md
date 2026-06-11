# 40 Blazing Hot — beleške analize zvuka sa referentnih videa

Cilj: naša WebAudio sinteza prati raspored i karakter zvuka originala
(ne kopiramo audio fajlove — sintetišemo svoju verziju istog "osećaja").

## Video 1: ručno, SPORA brzina, sa dobitkom + naplata (12-52-36, 31.8s)

Struktura jednog ručnog spina (spora brzina):
- klik na dugme: 2 mikro-blipa (~36ms + ~22ms, razmak ~0.14s) = pritisak + start
- zatim ~0.41s TIŠINE (rolne se vrte nečujno — nema kontinualnog šuma!)
- blok stopova rolni: ukupno ~1.59s za 5 stopova → stagger ~0.28-0.32s
- svaki stop: dubok tup udar (<400Hz) + drveni klik ~1.3kHz + tihi sekundarni tik

Dobitak (Line 7 3x, WIN 6.00):
- serija toplih akordskih udara srednje-niskog registra (~390-520Hz, harmonici do ~780Hz)
- ravnomeran ritam ~0.22s, pa ZADRŽAN akord na kraju fraze
- tokom smene dobitnih linija: kratak akordski tik po liniji (fraza se ponavlja ~1.1-1.4s po bloku)

Brojanje dobitka:
- NIJE cvrkutavi arpeđo: nisko mehaničko "predenje" — gusto tiktakanje (~30ms korak)
- visina postepeno RASTE dok brojanje traje (sa ~150Hz ka ~430Hz)

Naplata (collect):
- kratka serija od 6-7 mekih "coin" pulseva oko 400Hz (razmak ~0.12s)
- završni malo viši puls; BEZ velike fanfare

## Video 2: ručno, SREDNJA brzina (12-53-57, 23.5s)

- isti potpis klika na dugme: 2 mikro-blipa (36ms + 22ms, razmak 0.14s)
- ista pauza ~0.41s tišine posle klika pre prvog stopa (NE skraćuje se sa brzinom!)
- blok stopova rolni: ~0.69-0.79s za 5 stopova → stagger ~0.17s (duplo brže od spore)
- karakter stopova identičan sporoj brzini (isti zvuk, samo gušći raspored)
- dobitni segmenti: isti topli akordski udari + predenje brojača kao na sporoj

## Video 3: ručno, NAJBRŽA brzina (13-04-57 (2), 15.0s)

- klik na dugme: isti mikro-blip (~36ms)
- pauza klik→stopovi: SAMO ~0.14s (na sporoj/srednjoj je ~0.41s — skraćuje se!)
- blok stopova: ~0.26s za svih 5 → stagger ~0.05-0.065s ("brrrap", skoro odjednom)
- pun ciklus spin→spin (bez dobitka): ~0.97s
- dobitak na brzoj: ista topla akordska fraza + predenje brojača (~1.4-1.6s blokovi),
  zvuk dobitka se NE skraćuje sa brzinom igre

## Video 4: AUTOPLAY, najsporija brzina (12-55-00, 16.1s)

- u autoplay-u NEMA klika na početku spina (nema mikro-blipova između ciklusa)
- ustaljen ritam: ~1.64s zvuk (5 stopova, stagger ~0.29s kao ručno sporo)
  + ~0.73s tišine = ciklus ~2.37s po spinu
- tišina od 0.73s pokriva: kraj brojanja/pauzu + nečujno vrtenje (~0.4s) do prvog stopa
- dobitak usred autoplay-a: duži zvučni blok ~2.6s (akordska fraza + predenje),
  autoplay nastavlja odmah posle — zvuk dobitka ne prekida kadencu

## Video 5: AUTOPLAY, srednja brzina (12-56-01, 15.4s)

- bez klika (kao i slow autoplay)
- ustaljen ritam: ~0.69s zvuk (5 stopova, stagger ~0.17s kao ručno srednje)
  + ~0.73s tišine = ciklus ~1.42s po spinu
- TIŠINA IZMEĐU SPINOVA JE ISTA (~0.73s) kao na sporom autoplay-u —
  sa brzinom se skraćuje SAMO blok stopova, pauza ostaje konstantna
- dobitak: blokovi ~1.5s + ~1.3s (fraza + predenje), pa se kadenca nastavlja

## Video 6: AUTOPLAY, najbrža brzina (13-05-22, 13.2s)

- ustaljen ritam: ~0.255s zvuk (5 stopova, stagger ~0.05s) + ~0.33s tišine
  = ciklus ~0.58s po spinu (!)
- pauza između spinova se na najbržoj SKRAĆUJE na ~0.33s (slow/medium: 0.73s)
- dobitak: i na najbržoj puna fraza ~1.1-1.6s (ne skraćuje se), pa se kadenca nastavlja

### Tabela kadence (autoplay, izmereno)
| brzina  | blok stopova | stagger | pauza | ciklus  |
|---------|--------------|---------|-------|---------|
| sporo   | ~1.64s       | ~0.29s  | ~0.73s| ~2.37s  |
| srednje | ~0.69s       | ~0.17s  | ~0.73s| ~1.42s  |
| najbrže | ~0.255s      | ~0.05s  | ~0.33s| ~0.58s  |

## Video 7: GAMBLE — win i lose (12-57-00, 9.4s)

- ČEKANJE (karta okrenuta poleđinom): kontinuirana niska "tiktakajuća" petlja
  napetosti — bazni puls ~200-280Hz + kratak klik transijent na ~0.16s intervala;
  vrti se sve dok igrač ne izabere boju
- WIN (pogodak): UZLAZNA serija od ~4-5 toplih tonova (~270 → 820Hz,
  korak ~0.15s), sa svetlim akcentom na otkrivanju karte (flip hit ~1.1k/2.4kHz)
- LOSE (promašaj): SILAZNA serija od ~4-5 tonova istog tembra (820 → 270Hz)
  — ogledalo win zvuka, bez dodatne dramatike
- posle ishoda: ponovo petlja čekanja ako ima još pokušaja

## Video 8: GAMBLE — dobitno (12-57-28, 16.5s)

- potvrđuje obrazac iz videa 7: petlja čekanja (~0.8s segmenti između poteza),
  uzlazna win serija na pogodak
- posle pogotka petlja čekanja se NASTAVLJA (novi pokušaj) bez prekida ritma
- na kraju (naplata gamble dobitka): dug blok ~3.8s — win fraza + predenje
  brojača kao kod običnog dobitka (isti "count" karakter), pa tišina
- zaključak: gamble koristi ISTE zvukove brojanja/naplate kao osnovna igra

## Video 9: dugmići + punjenje VELIKOG dobitka (12-59-34, 30.8s; WIN 24.81, Line 9 4x)

- VELIKI dobitak — brojanje je MUZIČKA PETLJA, ne samo predenje:
  ritmični melodijski rif (fundamentali ~320 / ~640 / ~950Hz, puls ~0.11-0.12s)
  sa basom i harmonijom, traje CELO punjenje (~7.4s za 24.81 = ~62x ulog linije)
- završetak brojanja: kratak niski silazni "purr" rep (~0.5s) — brojač "legne"
- mali dobitak (videi 1-2): obično nisko predenje; veliki: muzička petlja
  → prag: npr. win >= 10x ulog -> muzička petlja, inače predenje
- zvukovi dugmića (bet +/-, meni): vrlo kratki meki klikovi (~40-100ms),
  tiši od spin klika; bez tona "biip" — vise "tap"

## Zaključci za implementaciju

1. Vrtnja TIHA — bez huma; samo klik na start (implementirano).
2. Stop zvuk identičan na svim brzinama; menja se samo STAGGER:
   sporo ~0.28-0.32s, srednje ~0.17s, najbrže ~0.05-0.065s.
3. Pauza klik→prvi stop: sporo/srednje ~0.41s, najbrže ~0.14s.
4. Fanfara = topli akordski udari (390-520Hz) u ritmu ~0.22s + zadržan akord (implementirano).
5. Brojanje = nisko mehaničko predenje sa rastućom visinom (implementirano).
6. Naplata = serija coin pulseva ~400Hz (implementirano).
7. lineTick na smenu dobitne linije (implementirano).

## Čeka se (najavljeni videi)
- brza brzina ručno? / autoplay? / gamble sa zvukom? — dopuniti beleške pa finalno
  uskladiti TEMPO konstante u Hot40.tsx (audio stagger vs animacija) i jačine.
