// Synthesized fallback recipes for every SFX key. Used when the real mp3 is missing or fails to
// decode, so the game always has sound. Owner: audio builder. Simple oscillator/noise recipes only,
// no external samples. Each key renders deterministically (seeded by its own name) via renderOffline.
import type { SfxKey } from '../data/assets';
import { burst, envGain, hashSeed, mulberry32, noteFreq, renderOffline, tone } from './synthCore';

type Builder = (ctx: OfflineAudioContext, out: GainNode, rng: () => number) => void;

function scrape(pitch: number): Builder {
  return (ctx, out, rng) => {
    const dur = 0.32 + rng() * 0.1;
    // a handful of overlapping short noise "strokes" filtered into a gritty band, like a hand scaler dragging
    const strokes = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < strokes; i++) {
      const t = (i / strokes) * dur * 0.85;
      burst(ctx, out, {
        duration: dur / strokes + 0.03, rng, start: t,
        filter: 'bandpass', freq: pitch * (0.9 + rng() * 0.2), freqEnd: pitch * (1.1 + rng() * 0.3), Q: 2.2,
        peak: 0.55, attack: 0.004, decay: dur / strokes,
      });
    }
  };
}

function pop(peakFreq: number, size: number): Builder {
  return (ctx, out, rng) => {
    // a bright transient click plus a short pitch-dropping thump: a chunk cracking off
    burst(ctx, out, { duration: 0.05, rng, filter: 'highpass', freq: 1800, peak: 0.9, attack: 0.001, decay: 0.04 });
    tone(ctx, out, { type: 'triangle', freq: peakFreq, freqEnd: peakFreq * 0.4, duration: 0.12 * size, peak: 0.7 * size, attack: 0.002, decay: 0.1 * size });
  };
}

function loopTexture(kind: 'buzz' | 'whirr' | 'slurp' | 'hiss'): Builder {
  return (ctx, out, rng) => {
    const dur = 2.2;
    if (kind === 'buzz') {
      tone(ctx, out, { type: 'sine', freq: 8200, duration: dur, peak: 0.22, loop: true });
      burst(ctx, out, { duration: dur, rng, filter: 'highpass', freq: 6000, peak: 0.18, loop: true });
    } else if (kind === 'whirr') {
      tone(ctx, out, { type: 'sawtooth', freq: 180, duration: dur, peak: 0.18, loop: true });
      tone(ctx, out, { type: 'sawtooth', freq: 181.5, duration: dur, peak: 0.1, loop: true });
      burst(ctx, out, { duration: dur, rng, filter: 'lowpass', freq: 2200, peak: 0.22, loop: true });
    } else if (kind === 'slurp') {
      burst(ctx, out, { duration: dur, rng, filter: 'bandpass', freq: 700, Q: 1.4, peak: 0.5, loop: true });
    } else {
      burst(ctx, out, { duration: dur, rng, filter: 'highpass', freq: 3200, peak: 0.35, loop: true });
    }
  };
}

function bell(freq: number, ratio: number, dur: number, peak = 0.7): Builder {
  return (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq, duration: dur, peak, attack: 0.004, decay: dur });
    tone(ctx, out, { type: 'sine', freq: freq * ratio, duration: dur * 0.7, peak: peak * 0.4, attack: 0.004, decay: dur * 0.7 });
  };
}

function arpeggio(semis: number[], step: number, dur: number, type: OscillatorType = 'triangle', peak = 0.6): Builder {
  return (ctx, out) => {
    semis.forEach((s, i) => {
      tone(ctx, out, { type, freq: noteFreq(s), duration: dur, start: i * step, peak, attack: 0.004, decay: dur });
    });
  };
}

function pad(freq: number, dur: number, peak = 0.5): Builder {
  return (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq, duration: dur, peak, attack: dur * 0.25, decay: dur * 0.75 });
    tone(ctx, out, { type: 'sine', freq: freq * 1.5, duration: dur, peak: peak * 0.5, attack: dur * 0.3, decay: dur * 0.7 });
  };
}

function bonk(freq: number): Builder {
  return (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq, freqEnd: freq * 0.6, duration: 0.22, peak: 0.6, attack: 0.002, decay: 0.2 });
  };
}

function blip(freq: number, dur = 0.09): Builder {
  return (ctx, out) => {
    tone(ctx, out, { type: 'square', freq, duration: dur, peak: 0.35, attack: 0.002, decay: dur });
  };
}

function vocalSweep(f0: number, f1: number, dur: number, type: OscillatorType = 'triangle'): Builder {
  return (ctx, out) => {
    tone(ctx, out, { type, freq: f0, freqEnd: f1, duration: dur, peak: 0.55, attack: 0.01, decay: dur });
  };
}

function giggleBuilder(): Builder {
  return (ctx, out, rng) => {
    const n = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const f = 480 + rng() * 220 + i * 30;
      tone(ctx, out, { type: 'triangle', freq: f, freqEnd: f * 1.3, duration: 0.1, start: i * 0.11, peak: 0.45, attack: 0.005, decay: 0.09 });
    }
  };
}

function chatterBuilder(): Builder {
  return (ctx, out, rng) => {
    const n = 4 + Math.floor(rng() * 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const d = 0.06 + rng() * 0.06;
      burst(ctx, out, { duration: d, rng, start: t, filter: 'bandpass', freq: 500 + rng() * 500, Q: 3, peak: 0.4, attack: 0.005, decay: d });
      t += d + 0.03 + rng() * 0.03;
    }
  };
}

function gagBuilder(): Builder {
  return (ctx, out) => {
    tone(ctx, out, { type: 'sawtooth', freq: 220, freqEnd: 90, duration: 0.14, peak: 0.5, attack: 0.005, decay: 0.12 });
    tone(ctx, out, { type: 'sawtooth', freq: 140, freqEnd: 260, duration: 0.16, start: 0.15, peak: 0.45, attack: 0.01, decay: 0.14 });
  };
}

function coinsBuilder(): Builder {
  return (ctx, out, rng) => {
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const f = 1800 + rng() * 1400;
      tone(ctx, out, { type: 'square', freq: f, duration: 0.09, start: i * 0.045 + rng() * 0.02, peak: 0.25, attack: 0.002, decay: 0.08 });
    }
  };
}

function cashBuilder(): Builder {
  return (ctx, out, rng) => {
    burst(ctx, out, { duration: 0.08, rng, filter: 'bandpass', freq: 2500, Q: 1.5, peak: 0.5, attack: 0.002, decay: 0.07 });
    tone(ctx, out, { type: 'square', freq: 1500, duration: 0.1, start: 0.02, peak: 0.3, attack: 0.002, decay: 0.09 });
    bell(1760, 2, 0.5, 0.6)(ctx, out, rng);
  };
}

function splashBuilder(): Builder {
  return (ctx, out, rng) => {
    burst(ctx, out, { duration: 0.4, rng, filter: 'lowpass', freq: 4000, freqEnd: 500, Q: 0.8, peak: 0.6, attack: 0.004, decay: 0.36 });
  };
}

function doorChimeBuilder(): Builder {
  return (ctx, out, rng) => {
    bell(noteFreq(7), 2, 0.5, 0.6)(ctx, out, rng);
    bell(noteFreq(3), 2, 0.55, 0.55)(ctx, out, rng);
  };
}

// ---------------------------------------------------------------- key -> recipe table
const RECIPES: Record<SfxKey, { build: Builder; duration: number; channels?: 1 | 2 }> = {
  scrape_1: { build: scrape(3200), duration: 0.5 },
  scrape_2: { build: scrape(3600), duration: 0.5 },
  scrape_3: { build: scrape(4000), duration: 0.55 },
  crunch_pop: { build: pop(320, 1), duration: 0.3 },
  crack_big: { build: pop(220, 1.6), duration: 0.4 },
  flake: { build: (ctx, out, rng) => burst(ctx, out, { duration: 0.05, rng, filter: 'highpass', freq: 5000, peak: 0.5, attack: 0.001, decay: 0.04 }), duration: 0.1 },
  ultrasonic_loop: { build: loopTexture('buzz'), duration: 2.2 },
  polish_loop: { build: loopTexture('whirr'), duration: 2.2 },
  suction_loop: { build: loopTexture('slurp'), duration: 2.2 },
  rinse_loop: { build: loopTexture('hiss'), duration: 2.2 },
  floss_snap: { build: (ctx, out, rng) => { tone(ctx, out, { type: 'triangle', freq: 900, freqEnd: 300, duration: 0.08, peak: 0.5, attack: 0.002, decay: 0.07 }); burst(ctx, out, { duration: 0.03, rng, filter: 'highpass', freq: 4000, peak: 0.3, decay: 0.02 }); }, duration: 0.15 },
  debris_pop: { build: pop(700, 0.5), duration: 0.15 },
  tooth_ding: { build: bell(noteFreq(12), 2.5, 0.55, 0.75), duration: 0.6 },
  sparkle: { build: arpeggio([12, 16, 19, 24], 0.05, 0.3, 'sine', 0.4), duration: 0.5 },
  gag: { build: gagBuilder(), duration: 0.35 },
  ow: { build: vocalSweep(500, 750, 0.16), duration: 0.25 },
  mmhm: { build: (ctx, out) => { tone(ctx, out, { type: 'sine', freq: 160, duration: 0.14, peak: 0.4, attack: 0.02, decay: 0.1 }); tone(ctx, out, { type: 'sine', freq: 190, duration: 0.16, start: 0.2, peak: 0.4, attack: 0.02, decay: 0.12 }); }, duration: 0.4 },
  giggle: { build: giggleBuilder(), duration: 0.6 },
  chatter: { build: chatterBuilder(), duration: 0.7 },
  reassure: { build: pad(noteFreq(0), 0.8, 0.5), duration: 0.9 },
  combo: { build: arpeggio([0, 4, 7], 0.06, 0.16, 'triangle', 0.55), duration: 0.35 },
  perfect: { build: arpeggio([0, 4, 7, 12, 16], 0.09, 0.5, 'triangle', 0.6), duration: 1.1 },
  star: { build: bell(noteFreq(19), 2, 0.3, 0.6), duration: 0.35 },
  splash: { build: splashBuilder(), duration: 0.45 },
  door_chime: { build: doorChimeBuilder(), duration: 0.7 },
  cash: { build: cashBuilder(), duration: 0.6 },
  coins: { build: coinsBuilder(), duration: 0.45 },
  ui_click: { build: (ctx, out, rng) => { burst(ctx, out, { duration: 0.02, rng, filter: 'bandpass', freq: 1800, Q: 3, peak: 0.35, decay: 0.015 }); tone(ctx, out, { type: 'sine', freq: 1200, duration: 0.04, peak: 0.3, attack: 0.001, decay: 0.03 }); }, duration: 0.08 },
  ui_tab: { build: (ctx, out) => tone(ctx, out, { type: 'sine', freq: 700, freqEnd: 950, duration: 0.07, peak: 0.3, attack: 0.002, decay: 0.06 }), duration: 0.12 },
  purchase: { build: arpeggio([0, 7], 0.06, 0.2, 'triangle', 0.55), duration: 0.35 },
  level_up: { build: arpeggio([0, 5, 9, 12], 0.07, 0.28, 'triangle', 0.6), duration: 0.55 },
  hire: { build: arpeggio([0, 5], 0.08, 0.3, 'sine', 0.55), duration: 0.45 },
  error: { build: bonk(220), duration: 0.3 },
  day_end: { build: pad(noteFreq(-5), 1.0, 0.45), duration: 1.1 },
  review_good: { build: arpeggio([0, 4, 9], 0.07, 0.25, 'sine', 0.5), duration: 0.45 },
  review_bad: { build: arpeggio([9, 4, 0], 0.08, 0.28, 'sine', 0.45), duration: 0.5 },
  notify: { build: blip(1200, 0.07), duration: 0.2 },
};

const cache = new Map<SfxKey, Promise<AudioBuffer>>();

/** Renders (and caches) the synthesized fallback for an SFX key. Never throws: callers get an audible buffer. */
export function synthesizeSfx(key: SfxKey): Promise<AudioBuffer> {
  let p = cache.get(key);
  if (!p) {
    const recipe = RECIPES[key];
    const rng = mulberry32(hashSeed(key));
    p = renderOffline(recipe.duration, recipe.channels ?? 1, (ctx, out) => recipe.build(ctx, out, rng));
    cache.set(key, p);
  }
  return p;
}
