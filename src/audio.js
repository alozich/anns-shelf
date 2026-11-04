// Hover audio: plays an album's song preview while its sleeve is hovered,
// with a quiet vinyl crackle underneath.
//
// Sound is on by default, but browsers block audio until the visitor's first
// click, tap or key press on the page, so it starts playing from then on.
// The sound button mutes/unmutes with disable()/enable().

const HOVER_DELAY = 250;   // ms on a sleeve before audio starts, so sweeping the mouse stays quiet
const MUSIC_VOLUME = 0.6;
const CRACKLE_VOLUME = 0.012; // kept well under the music; raise for more vinyl noise
const FADE_IN = 0.6;       // seconds
const FADE_OUT = 0.35;

export class HoverAudio {
  constructor() {
    this.enabled = true;
    this.unlocked = false;   // true after the first click/tap/key press
    this.onUnlock = null;    // called once audio is allowed to play
    this.ctx = null;
    this.crackleGain = null;
    this.players = new Map(); // album -> HTMLAudioElement, created on first hover
    this.current = null;
    this.album = null;
    this._timer = 0;

    // Stop playing when the tab is hidden.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setAlbum(null);
    });

    // The first click, tap or key press anywhere lets the browser play audio.
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      this._unlock();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  _unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this._startCrackle();
    }
    this.ctx.resume();
    if (this.unlocked) return;
    this.unlocked = true;
    const album = this.album;
    this.album = null;
    this.setAlbum(album); // start playing if something is already hovered
    this.onUnlock?.();
  }

  /** Turn sound back on (from the sound button, which counts as a click). */
  enable() {
    this.enabled = true;
    this._unlock();
    const album = this.album;
    this.album = null;
    this.setAlbum(album);
  }

  disable() {
    this.setAlbum(null);
    this.enabled = false;
  }

  /** Call whenever the hovered album changes (null for none). */
  setAlbum(album) {
    if (album === this.album) return;
    this.album = album;
    clearTimeout(this._timer);

    if (this.current) {
      const leaving = this.current;
      if (document.hidden) {
        fades.delete(leaving); // fades run on animation frames, which stop in hidden tabs
        leaving.pause();
      } else {
        fade(leaving, 0, FADE_OUT, () => leaving.pause());
      }
      this.current = null;
    }
    this._setCrackle(0);

    if (!album || !this.enabled || !this.unlocked) return;
    this._timer = setTimeout(() => this._play(album), HOVER_DELAY);
  }

  _play(album) {
    if (album !== this.album) return;
    this._setCrackle(CRACKLE_VOLUME);
    if (!album.preview) return;

    let audio = this.players.get(album);
    if (!audio) {
      audio = new Audio(album.preview);
      audio.preload = 'auto';
      audio.loop = true;
      this.players.set(album, audio);
    }
    audio.volume = 0;
    audio.play().catch((err) => console.warn(`Could not play preview for "${album.title}"`, err));
    fade(audio, MUSIC_VOLUME, FADE_IN);
    this.current = audio;
  }

  /** A strummed E major chord, at most once every 1.2 s so hovering on and off isn't noisy. */
  strum() {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (now - (this._lastStrum ?? -Infinity) < 1200) return;
    this._lastStrum = now;

    this._strumBuffer ??= makeStrum(this.ctx);
    const source = this.ctx.createBufferSource();
    source.buffer = this._strumBuffer;
    const gain = this.ctx.createGain();
    gain.gain.value = STRUM_VOLUME;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  /**
   * Play a knick-knack's hover sound by name (see SFX below). Each sound plays
   * at most once every 0.8 s so wiggling the mouse over an object stays calm.
   */
  sfx(name) {
    if (!this.enabled || !this.ctx) return;
    if (name === 'strum') return this.strum();
    if (name !== 'drink' && !SFX[name]) return;
    this._lastSfx ??= {};
    const now = performance.now();
    if (now - (this._lastSfx[name] ?? -Infinity) < (SFX_COOLDOWN[name] ?? 800)) return;
    this._lastSfx[name] = now;

    if (!this._sfxOut) {
      this._sfxOut = this.ctx.createGain();
      this._sfxOut.gain.value = SFX_VOLUME;
      this._sfxOut.connect(this.ctx.destination);
    }
    if (name === 'drink') {
      SFX.growl(new Synth(this.ctx, this._sfxOut));
      oldManShouts('Drink!');
      return;
    }
    SFX[name](new Synth(this.ctx, this._sfxOut));
  }

  _setCrackle(volume) {
    if (!this.ctx) return;
    this.crackleGain.gain.setTargetAtTime(volume, this.ctx.currentTime, volume ? 0.15 : 0.08);
  }

  // Two seconds of looping noise: soft hiss plus random pops, like a needle in the groove.
  _startCrackle() {
    const ctx = this.ctx;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.04;
    for (let p = 0; p < 24; p++) {
      const start = Math.floor(Math.random() * length);
      const amp = 0.1 + Math.random() * 0.3; // softer pops
      const decay = 20 + Math.random() * 120;
      for (let j = 0; j < 200 && start + j < length; j++) {
        data[start + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / decay * 4);
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3500; // duller, less hissy
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    source.connect(lowpass).connect(this.crackleGain).connect(ctx.destination);
    source.start();
  }
}

// Fade an <audio> element's volume over `seconds`, then call `done`.
// A newer fade on the same element cancels an older one.
const fades = new WeakMap();
function fade(audio, to, seconds, done) {
  const from = audio.volume;
  const start = performance.now();
  const token = {};
  fades.set(audio, token);
  const step = (now) => {
    if (fades.get(audio) !== token) return;
    // The frame timestamp can be a hair earlier than `start`, so clamp to 0..1.
    const t = Math.min(1, Math.max(0, (now - start) / (seconds * 1000)));
    audio.volume = Math.min(1, Math.max(0, from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

// Karplus-Strong plucked strings: each string is a short burst of noise fed
// through a delay line that averages and decays, which sounds like a plucked
// string. Six strings with a small delay between them make a downstrum.
const STRUM_VOLUME = 0.35;
function makeStrum(ctx) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 3);
  const buffer = ctx.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);
  const chord = [82.41, 123.47, 164.81, 207.65, 246.94, 329.63]; // E major, low to high

  chord.forEach((freq, i) => {
    const offset = Math.floor(i * 0.025 * rate);
    const period = Math.round(rate / freq);
    const line = new Float32Array(period).map(() => Math.random() * 2 - 1);
    let idx = 0;
    for (let n = 0; n + offset < length; n++) {
      const cur = line[idx];
      const next = line[(idx + 1) % period];
      line[idx] = (cur + next) * 0.5 * 0.997;
      out[n + offset] += cur * 0.2;
      idx = (idx + 1) % period;
    }
  });
  // Gentle overdrive for an electric edge.
  for (let n = 0; n < length; n++) out[n] = Math.tanh(out[n] * 1.8) * 0.6;
  return buffer;
}

/* ------------------------------------------------------------------ */
/* Knick-knack sound effects, synthesized (no audio files)            */
/* ------------------------------------------------------------------ */

const SFX_VOLUME = 0.5;
// Longer clips get longer cooldowns so they can't pile up on top of each other.
const SFX_COOLDOWN = { croatia: 4000, jig: 4200, cheer: 3000, drink: 1500, pour: 2200, train: 3600 };

// Note name to frequency, e.g. 'A4' -> 440.
const NOTE = (name) => {
  const steps = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[name[0]];
  const sharp = name.includes('#') ? 1 : 0;
  const octave = Number(name.at(-1));
  return 440 * 2 ** ((steps + sharp + (octave - 4) * 12) / 12);
};

// An angry old man (Father Jack style) using the browser's built-in speech.
// Prefers an Irish English voice, then British, then any English one.
// Chrome loads its voice list in the background; keep the latest copy.
let voices = [];
if (window.speechSynthesis) {
  const load = () => { voices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.addEventListener('voiceschanged', load);
}

function oldManShouts(text) {
  const speech = window.speechSynthesis;
  if (!speech) return;
  if (!voices.length) voices = speech.getVoices();
  const voice = voices.find((v) => v.lang === 'en-IE')
    ?? voices.find((v) => v.lang === 'en-GB' && /male|george|ryan|thomas|daniel/i.test(v.name))
    ?? voices.find((v) => v.lang === 'en-GB')
    ?? voices.find((v) => v.lang.startsWith('en'));
  const say = new SpeechSynthesisUtterance(text);
  if (voice) say.voice = voice;
  say.pitch = 0;    // as low and gravelly as it goes
  say.rate = 1.15;  // barked, not drawn out
  say.volume = 1;
  speech.cancel();
  speech.speak(say);
}

let noiseBuffer = null;

// Tiny helper for building short sounds from oscillators and filtered noise.
class Synth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.t = ctx.currentTime + 0.01;
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
  }

  // Volume envelope: quick rise to `peak`, then fade out over `dur`.
  _env(at, attack, dur, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + dur);
    g.connect(this.out);
    return g;
  }

  tone({ at = 0, freq, to, type = 'sine', dur = 0.2, peak = 0.2, attack = 0.005, vibrato }) {
    const t = this.t + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = vibrato.rate;
      depth.gain.setValueAtTime(vibrato.depth, t);
      depth.gain.exponentialRampToValueAtTime(1, t + attack + dur);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + attack + dur + 0.05);
    }
    osc.connect(this._env(t, attack, dur, peak));
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
  }

  noise({ at = 0, dur = 0.1, peak = 0.2, attack = 0.003, filter = 'bandpass', freq = 1000, to, q = 1, pulse }) {
    const t = this.t + at;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
    let chain = src.connect(f);
    if (pulse) {
      // Fast on/off throbbing (cicadas): an LFO swings the volume between 0 and 1.
      const am = this.ctx.createGain();
      am.gain.value = 0.5;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = pulse;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      lfo.start(t);
      lfo.stop(t + attack + dur + 0.05);
      chain = chain.connect(am);
    }
    chain.connect(this._env(t, attack, dur, peak));
    src.start(t, Math.random() * 2);
    src.stop(t + attack + dur + 0.05);
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

const SFX = {
  // Wooden frame tipping against the wall
  knock(s) {
    s.tone({ freq: 190, to: 120, type: 'triangle', dur: 0.08, peak: 0.5 });
    s.noise({ freq: 900, q: 3, dur: 0.03, peak: 0.25 });
    s.tone({ at: 0.11, freq: 160, to: 105, type: 'triangle', dur: 0.07, peak: 0.3 });
  },
  // Riffling pages
  pages(s) {
    for (let i = 0; i < 7; i++) s.noise({ at: i * 0.035, freq: rand(2500, 4000), q: 0.8, dur: 0.035, peak: rand(0.08, 0.18) });
  },
  // A cute little turtle bloop
  bloop(s) {
    s.tone({ freq: 300, to: 620, dur: 0.12, peak: 0.25 });
    s.tone({ at: 0.13, freq: 620, to: 430, dur: 0.12, peak: 0.18 });
  },
  // Perfume spritz plus a soft glass ting
  spritz(s) {
    s.noise({ filter: 'highpass', freq: 4500, dur: 0.22, attack: 0.01, peak: 0.3 });
    s.tone({ at: 0.02, freq: 2900, dur: 0.35, peak: 0.05 });
  },
  // Leaves rustling
  rustle(s) {
    for (let i = 0; i < 8; i++) s.noise({ at: rand(0, 0.35), freq: rand(1800, 3200), q: 0.7, dur: rand(0.05, 0.12), peak: rand(0.05, 0.12) });
  },
  // Keyboard clicks and a terminal beep
  typing(s) {
    let at = 0;
    for (let i = 0; i < 7; i++) {
      s.noise({ at, freq: rand(2000, 3500), q: 2, dur: 0.02, peak: rand(0.2, 0.35) });
      at += rand(0.055, 0.1);
    }
    s.tone({ at: at + 0.05, freq: 880, type: 'square', dur: 0.08, peak: 0.06 });
  },
  // 8-bit coin chime
  coin(s) {
    s.tone({ freq: 988, type: 'square', dur: 0.07, peak: 0.1, attack: 0.002 });
    s.tone({ at: 0.075, freq: 1319, type: 'square', dur: 0.35, peak: 0.1, attack: 0.002 });
  },
  // Spoon clinking on a ceramic mug
  clink(s) {
    s.tone({ freq: 2100, dur: 0.45, peak: 0.14, attack: 0.002 });
    s.tone({ freq: 5800, dur: 0.2, peak: 0.05, attack: 0.002 });
    s.tone({ at: 0.13, freq: 2050, dur: 0.35, peak: 0.08, attack: 0.002 });
  },
  // Plastic DVD cases knocking together
  clack(s) {
    s.noise({ freq: 1500, q: 1.5, dur: 0.05, peak: 0.35 });
    s.tone({ freq: 420, type: 'triangle', dur: 0.04, peak: 0.15 });
    s.noise({ at: 0.07, freq: 1700, q: 1.5, dur: 0.04, peak: 0.2 });
  },
  // Cartoon spring boing
  boing(s) {
    s.tone({ freq: 180, to: 420, dur: 0.5, peak: 0.22, vibrato: { rate: 16, depth: 60 } });
  },
  // Dalmatian summer: cicadas, the sea, a distant church bell and seagulls
  croatia(s) {
    s.noise({ freq: 5200, q: 6, dur: 3.2, attack: 0.4, peak: 0.07, pulse: 38 });
    s.noise({ at: 0.2, freq: 6100, q: 8, dur: 2.6, attack: 0.5, peak: 0.04, pulse: 44 });
    s.noise({ filter: 'lowpass', freq: 400, to: 1100, dur: 2.4, attack: 1.0, peak: 0.16 });
    for (const at of [0.3, 1.7]) {
      // Bell: inharmonic partials with long, staggered decays
      [[1, 0.09, 2.4], [2, 0.05, 1.8], [2.4, 0.04, 1.4], [3, 0.03, 1.1], [4.2, 0.02, 0.8]].forEach(([ratio, peak, dur]) => {
        s.tone({ at, freq: 392 * ratio, dur, peak, attack: 0.003 });
      });
    }
    for (const at of [1.0, 2.3]) {
      // Gull: a quick rising "kee" then a falling "ow"
      s.tone({ at, freq: 1250, to: 1900, type: 'triangle', dur: 0.1, peak: 0.05, vibrato: { rate: 30, depth: 40 } });
      s.tone({ at: at + 0.12, freq: 1900, to: 1050, type: 'triangle', dur: 0.28, peak: 0.05, vibrato: { rate: 30, depth: 40 } });
    }
  },
  // "The Irish Washerwoman" (traditional): tin whistle and bodhran
  jig(s) {
    const eighth = 0.16;
    const tune = ['D6',
      'B5', 'G5', 'G5', 'D5', 'G5', 'G5',
      'B5', 'G5', 'B5', 'D6', 'C6', 'B5',
      'C6', 'B5', 'C6', 'A5', 'D6', 'C6',
      'B5', 'G5', 'G5', 'G5'];
    tune.forEach((note, i) => {
      const last = i === tune.length - 1;
      s.tone({
        at: i * eighth, freq: NOTE(note), type: 'triangle', attack: 0.012,
        dur: last ? eighth * 3 : eighth * 0.8, peak: 0.11, vibrato: last ? { rate: 5.5, depth: 8 } : undefined,
      });
      s.noise({ at: i * eighth, filter: 'highpass', freq: 6000, dur: 0.03, peak: 0.015 }); // breath
    });
    // Bodhran on every dotted quarter (each group of three eighths), after the pickup note
    for (let beat = 0; beat < 8; beat++) {
      const at = eighth * (1 + beat * 3);
      s.tone({ at, freq: 95, to: 60, dur: 0.16, peak: beat % 2 ? 0.2 : 0.32 });
      s.noise({ at, filter: 'lowpass', freq: 350, dur: 0.05, peak: 0.12 });
    }
  },
  // Crowd cheering: a roar, whoops, applause and a whistle
  cheer(s) {
    s.noise({ freq: 900, q: 0.5, dur: 2.2, attack: 0.35, peak: 0.22 });
    s.noise({ freq: 2200, q: 0.8, dur: 2.0, attack: 0.4, peak: 0.1 });
    for (let i = 0; i < 6; i++) {
      const base = rand(260, 480);
      s.tone({ at: rand(0, 0.7), freq: base, to: base * rand(1.3, 1.7), type: 'triangle', dur: rand(0.8, 1.4), attack: 0.08, peak: 0.035, vibrato: { rate: 6, depth: 12 } });
    }
    for (let i = 0; i < 45; i++) s.noise({ at: rand(0.15, 2.3), freq: rand(1200, 2200), q: 1.2, dur: 0.015, peak: rand(0.05, 0.13) });
    s.tone({ at: 0.6, freq: 2000, to: 2700, dur: 0.25, peak: 0.05 });
    s.tone({ at: 0.88, freq: 2700, to: 1800, dur: 0.35, peak: 0.05 });
  },
  // A Chicago "L" train rattling past on the elevated tracks: a rumble that
  // swells and fades, wheels clacking over the rail joints, a motor whine
  // that drops in pitch as it passes, and a squeal of steel on the curve.
  train(s) {
    const pass = 3.0; // seconds for the whole pass
    s.noise({ filter: 'lowpass', freq: 180, to: 420, dur: pass, attack: 1.3, peak: 0.35 });
    s.noise({ freq: 900, q: 0.7, dur: pass * 0.8, attack: 1.2, peak: 0.08 });
    s.tone({ at: 0.4, freq: 210, to: 150, type: 'sawtooth', dur: 2.2, attack: 0.9, peak: 0.025 });
    // Wheel sets crossing a rail joint: clack-clack pairs, loudest mid-pass
    for (let i = 0; i < 14; i++) {
      const at = 0.35 + i * 0.17;
      const loud = Math.sin((i / 13) * Math.PI) * 0.3 + 0.04;
      for (const offset of [0, 0.045]) {
        s.noise({ at: at + offset, freq: 650, q: 2.5, dur: 0.035, peak: loud });
        s.tone({ at: at + offset, freq: 120, to: 80, type: 'triangle', dur: 0.04, peak: loud * 0.6 });
      }
    }
    s.tone({ at: 1.2, freq: 2600, to: 2350, dur: 0.9, attack: 0.25, peak: 0.025, vibrato: { rate: 9, depth: 40 } });
  },
  // Coffee pouring into the mug: a stream that rises in pitch as the cup
  // fills, a few glugs, then a spoon clink.
  pour(s) {
    s.noise({ freq: 700, to: 1700, q: 4, dur: 1.3, attack: 0.08, peak: 0.22 });
    s.noise({ filter: 'lowpass', freq: 500, to: 900, dur: 1.3, attack: 0.08, peak: 0.12 });
    for (let i = 0; i < 9; i++) {
      const f = rand(350, 700) * (1 + i * 0.06);
      s.tone({ at: 0.1 + i * 0.13 + rand(0, 0.05), freq: f, to: f * 1.6, dur: 0.05, peak: 0.06 });
    }
    s.tone({ at: 1.45, freq: 2100, dur: 0.4, peak: 0.1, attack: 0.002 });
    s.tone({ at: 1.45, freq: 5800, dur: 0.18, peak: 0.04, attack: 0.002 });
  },
  // A short, gravelly growl under the shouted word
  growl(s) {
    s.tone({ freq: 85, to: 70, type: 'sawtooth', dur: 0.45, attack: 0.02, peak: 0.08, vibrato: { rate: 28, depth: 12 } });
    s.noise({ filter: 'lowpass', freq: 600, dur: 0.4, attack: 0.02, peak: 0.06 });
  },
  // Gentle Adriatic sea wash
  waves(s) {
    s.noise({ filter: 'lowpass', freq: 500, to: 1400, dur: 1.4, attack: 0.8, peak: 0.25 });
  },
  // Atlantic wind over the cliffs, with surf below
  wind(s) {
    s.noise({ freq: 450, to: 900, q: 0.8, dur: 1.8, attack: 0.9, peak: 0.2 });
    s.noise({ at: 0.4, filter: 'lowpass', freq: 350, to: 900, dur: 1.4, attack: 0.6, peak: 0.2 });
  },
};
