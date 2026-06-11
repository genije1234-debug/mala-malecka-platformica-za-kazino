/**
 * Zvučni sloj za 40 Blazing Hot — sintetisan WebAudio-om (bez audio fajlova).
 * Raspored i karakter prate merenja sa referentnih snimaka (docs/hot40-zvuk-beleske.md):
 *  - vrtnja TIHA; klik samo na ručni spin (2 mikro-blipa)
 *  - stop rolne: dubok thump + drveni klik (~1.3kHz) + sekundarni tik
 *  - dobitak: topli akordski udari 390-520Hz u ritmu ~0.22s, zadržan akord;
 *    dramatika raste sa veličinom dobitka (ratio = dobitak/ulog)
 *  - brojanje: mali dobitak = nisko mehaničko predenje koje raste;
 *    veliki (>=10x) = ritmična muzička petlja (bas + rif ~0.11s puls)
 *  - naplata: serija mekih coin pulseva ~400Hz
 *  - gamble: petlja napetosti (~0.16s puls), uzlazna win serija, silazna lose serija
 * Sva sinteza je originalna.
 */

type AC = AudioContext;

function makeNoise(ac: AC, sec = 1.2): AudioBuffer {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * sec), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export interface H40Audio {
  setEnabled(v: boolean): void;
  unlock(): void;
  /** Klik na dugme — samo za RUČNI spin (autoplay je nečujan na startu). */
  spinStart(manual: boolean): void;
  reelStops(landMs: number, staggerMs: number, cols: number): void;
  spinEnd(): void;
  /** Dramatika po veličini: ratio = dobitak / ulog. */
  winFanfare(ratio: number): void;
  lineTick(): void;
  /** big = muzička petlja (veliki dobitak); inače nisko predenje. */
  startCount(big: boolean): void;
  /** settle = odsviraj silazni "purr" rep kad brojač legne. */
  stopCount(settle?: boolean): void;
  collect(): void;
  gambleLoopStart(): void;
  gambleLoopStop(): void;
  gambleFlip(): void;
  gambleWin(): void;
  gambleLose(): void;
  uiTap(): void;
}

export function createH40Audio(): H40Audio {
  let ac: AC | null = null;
  let master: GainNode | null = null;
  let enabled = true;
  let noise: AudioBuffer | null = null;
  let countTimer: ReturnType<typeof setInterval> | null = null;
  let gambleTimer: ReturnType<typeof setInterval> | null = null;

  function ctx(): AC | null {
    if (!enabled) return null;
    try {
      if (!ac) {
        ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.12;
        master = ac.createGain();
        master.gain.value = 1.6;
        master.connect(comp).connect(ac.destination);
      }
      if (ac.state === "suspended") void ac.resume();
      noise ??= makeNoise(ac);
      return ac;
    } catch {
      return null;
    }
  }

  function out(): AudioNode | null {
    return ctx() ? master : null;
  }

  function tone(freq: number, dur: number, opts: { type?: OscillatorType; when?: number; gain?: number; slideTo?: number } = {}) {
    const a = ctx();
    const dst = out();
    if (!a || !dst) return;
    const { type = "triangle", when = 0, gain = 0.06, slideTo } = opts;
    const t = a.currentTime + when;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dst);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function burst(dur: number, opts: { when?: number; gain?: number; type?: BiquadFilterType; freq?: number; freqTo?: number; q?: number } = {}) {
    const a = ctx();
    const dst = out();
    if (!a || !dst || !noise) return;
    const { when = 0, gain = 0.1, type = "bandpass", freq = 900, freqTo, q = 1.2 } = opts;
    const t = a.currentTime + when;
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = a.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dst);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Stop rolne: dubok thump + drveni klik ~1.3kHz + tihi sekundarni tik. */
  function thump(when: number, pitch = 95) {
    tone(pitch, 0.08, { type: "sine", when, gain: 0.26, slideTo: pitch * 0.5 });
    burst(0.04, { when, gain: 0.18, freq: 1300, q: 1.1, type: "bandpass" });
    burst(0.07, { when: when + 0.003, gain: 0.12, freq: 360, q: 1.4 });
    burst(0.025, { when: when + 0.055, gain: 0.07, freq: 1500, q: 1.4 });
  }

  /** Topli akordski udar (root + kvinta + oktava + bas sloj + DUBOKI temelj). */
  function stab(root: number, when: number, gain: number, dur = 0.22) {
    for (const ratio of [1, 1.5, 2]) {
      tone(root * ratio, dur, { when, gain: gain * (ratio === 1 ? 1 : 0.6), type: "triangle" });
    }
    tone(root / 2, dur * 0.8, { when, gain: gain * 0.9, type: "sine" });
    tone(root / 4, dur * 0.9, { when, gain: gain * 0.75, type: "sine" }); // dubina/dramatika
  }

  return {
    setEnabled(v: boolean) {
      enabled = v;
      if (!v) {
        this.stopCount();
        this.gambleLoopStop();
      }
    },
    unlock() {
      void ctx();
    },

    spinStart(manual: boolean) {
      const a = ctx();
      if (!a) return;
      if (!manual) return; // autoplay: bez klika (kao original)
      // 2 mikro-blipa: pritisak + start (36ms + 22ms, razmak ~0.14s)
      burst(0.035, { gain: 0.12, freq: 1600, q: 1.2 });
      tone(240, 0.035, { type: "sine", gain: 0.08 });
      burst(0.022, { when: 0.14, gain: 0.08, freq: 2000, q: 1.4 });
    },

    reelStops(landMs: number, staggerMs: number, cols: number) {
      for (let c = 0; c < cols; c++) {
        const when = (landMs + c * staggerMs) / 1000;
        thump(when, 92 + c * 6);
      }
    },

    spinEnd() {
      // vrtnja je tiha — nista za gasenje
    },

    /**
     * Dobitna fraza: topli akordski udari u ritmu ~0.22s + zadržan akord.
     * Dramatika raste sa ratio (dobitak/ulog):
     *  <3x  : kratka fraza (3 udara + hold)
     *  3-10 : puna fraza (4 udara + jači hold)
     *  10-25: + eskalacija naviše i sjaj
     *  >=25 : + druga eskalacija, sub udari, dug svetlucavi rep
     */
    winFanfare(ratio: number) {
      // Zvonki registar (784Hz+) + DUBOK udarni temelj na startu za dramatiku
      const g = Math.min(0.17, 0.12 + ratio * 0.0035);
      // duboki impakt: "tup" koji se oseti (jaci za vece dobitke)
      tone(120, 0.4, { gain: Math.min(0.3, 0.16 + ratio * 0.008), type: "sine", slideTo: 65 });
      burst(0.12, { gain: 0.1, freq: 240, q: 1.2, type: "lowpass" });
      stab(784, 0, g);
      stab(880, 0.22, g * 0.95);
      stab(784, 0.44, g);
      if (ratio >= 3) stab(988, 0.66, g);
      const holdAt = ratio >= 3 ? 0.9 : 0.66;
      const holdDur = ratio >= 10 ? 0.9 : 0.55;
      stab(1046, holdAt, g * 1.1, holdDur);
      burst(0.4, { when: holdAt, gain: 0.05, freq: 3000, freqTo: 6400, q: 0.8 });
      if (ratio >= 10) {
        stab(1175, holdAt + 0.45, g * 1.1, 0.5);
        stab(1318, holdAt + 0.9, g * 1.15, 0.9);
        tone(110, 0.55, { when: holdAt + 0.9, gain: 0.26, type: "sine", slideTo: 60 }); // DUBOK sub udar
        burst(0.8, { when: holdAt + 0.7, gain: 0.07, freq: 3200, freqTo: 7000, q: 0.7 });
      }
      if (ratio >= 25) {
        stab(1568, holdAt + 1.5, g * 1.2, 0.6);
        stab(1760, holdAt + 2.0, g * 1.25, 1.1);
        tone(98, 0.7, { when: holdAt + 2.0, gain: 0.3, type: "sine", slideTo: 50 }); // najdublji udar
        burst(1.4, { when: holdAt + 1.6, gain: 0.08, freq: 3600, freqTo: 8000, q: 0.6 });
      }
    },

    /** Kratak akordski tik pri smeni dobitne linije (oktavu vise — zvonko). */
    lineTick() {
      for (const f of [784, 1176]) tone(f, 0.16, { gain: 0.06, type: "triangle" });
      tone(392, 0.14, { gain: 0.06, type: "sine" });
    },

    startCount(big: boolean) {
      this.stopCount();
      const a = ctx();
      if (!a) return;
      if (!big) {
        // LEPO predenje brojaca (kao original): mekan nizak motor koji raste,
        // triangle umesto ostrog square-a + topli coin klik + povremeni sjaj
        let step = 0;
        countTimer = setInterval(() => {
          const f = Math.min(180 + step * 5, 420);
          step++;
          tone(f, 0.045, { type: "triangle", gain: 0.06 });
          tone(f * 1.5, 0.03, { type: "sine", gain: 0.022 });
          burst(0.018, { gain: 0.04, freq: 1100, q: 3 }); // coin tik
          if (step % 6 === 0) tone(1568, 0.05, { type: "sine", gain: 0.022 }); // sjaj
        }, 30);
        return;
      }
      // VELIKI dobitak: ritmična muzička petlja (~0.11s puls), OKTAVU VISE —
      // zvonki rif + laki bas, akcenat na svaki 4. korak
      const riff = [660, 784, 880, 1046, 880, 784, 660, 523];
      let step = 0;
      countTimer = setInterval(() => {
        const i = step % riff.length;
        const f = riff[i];
        const accent = step % 4 === 0;
        step++;
        tone(f, 0.1, { type: "triangle", gain: accent ? 0.09 : 0.065 });
        tone(f * 2, 0.07, { type: "sine", gain: accent ? 0.04 : 0.025, when: 0.005 });
        if (i % 2 === 0) tone(330, 0.1, { type: "sine", gain: 0.07 }); // laki bas
        if (accent) tone(165, 0.12, { type: "sine", gain: 0.1 }); // DUBOK bas na akcenat
        burst(0.02, { gain: 0.03, freq: 3000, q: 2.5 }); // svetlucavi sloj
      }, 110);
    },

    stopCount(settle = false) {
      if (countTimer) {
        clearInterval(countTimer);
        countTimer = null;
        if (settle) {
          // silazni "purr" rep: brojač legne (~0.45s)
          for (let i = 0; i < 11; i++) {
            tone(400 - i * 23, 0.04, { when: i * 0.04, type: "square", gain: 0.045 - i * 0.003 });
          }
        }
      }
    },

    collect() {
      this.stopCount();
      // serija mekih "coin" pulseva ~400Hz + završni viši puls
      for (let i = 0; i < 7; i++) {
        const f = i % 2 === 0 ? 400 : 470;
        tone(f, 0.09, { when: i * 0.12, gain: 0.1, type: "triangle" });
        tone(f * 2, 0.06, { when: i * 0.12 + 0.01, gain: 0.03, type: "sine" });
      }
      tone(560, 0.18, { when: 0.86, gain: 0.11, type: "triangle" });
    },

    // ---- GAMBLE ----

    /** Petlja napetosti dok se čeka izbor: nizak puls + klik na ~0.16s. */
    gambleLoopStart() {
      this.gambleLoopStop();
      const a = ctx();
      if (!a) return;
      let step = 0;
      gambleTimer = setInterval(() => {
        const low = step % 2 === 0 ? 220 : 196;
        step++;
        tone(low, 0.07, { type: "square", gain: 0.04 });
        burst(0.018, { gain: 0.035, freq: 1400, q: 2 });
      }, 160);
    },
    gambleLoopStop() {
      if (gambleTimer) {
        clearInterval(gambleTimer);
        gambleTimer = null;
      }
    },

    /** Svetli akcenat otkrivanja karte. */
    gambleFlip() {
      this.gambleLoopStop();
      burst(0.08, { gain: 0.1, freq: 2400, q: 1.2 });
      tone(1100, 0.06, { type: "triangle", gain: 0.07, when: 0.01 });
    },
    /** Pogodak: uzlazna serija toplih tonova ~270 -> 820Hz, korak 0.15s. */
    gambleWin() {
      [294, 370, 466, 587, 740].forEach((f, i) => {
        tone(f, 0.2, { when: i * 0.15, gain: 0.11, type: "triangle" });
        tone(f / 2, 0.16, { when: i * 0.15, gain: 0.06, type: "sine" });
      });
      burst(0.4, { when: 0.6, gain: 0.06, freq: 2400, freqTo: 5000, q: 0.8 });
    },
    /** Promašaj: silazna serija — ogledalo win zvuka, bez dodatne dramatike. */
    gambleLose() {
      [740, 587, 466, 370, 294].forEach((f, i) => {
        tone(f, 0.2, { when: i * 0.15, gain: 0.1, type: "triangle" });
        tone(f / 2, 0.16, { when: i * 0.15, gain: 0.055, type: "sine" });
      });
    },

    /** Meki kratki "tap" (promena uloga, meni) — bez tonskog bipa. */
    uiTap() {
      burst(0.03, { gain: 0.045, freq: 1800, q: 1.6 });
      tone(300, 0.03, { type: "sine", gain: 0.035 });
    },
  };
}
