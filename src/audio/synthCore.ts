// Low-level helpers for building synthesized fallback sounds: a tiny seeded RNG, noise buffers,
// envelope helpers and note/burst builders on top of an OfflineAudioContext. Owner: audio builder.
export const SAMPLE_RATE = 44100;

/** Deterministic 32-bit hash of a string, used to seed each key's synthesized variant. */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good-enough seeded PRNG. Returns a 0..1 generator. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** musical helper: semitones from C5 (523.25 Hz) to a frequency. */
export function noteFreq(semisFromC5: number): number {
  return 523.25 * Math.pow(2, semisFromC5 / 12);
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Renders `build` into an offline context of the given duration and returns the resulting buffer. */
export function renderOffline(
  duration: number,
  channels: 1 | 2,
  build: (ctx: OfflineAudioContext, out: GainNode) => void,
): Promise<AudioBuffer> {
  const Ctor = (window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor })
    .OfflineAudioContext
    ?? (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext;
  if (!Ctor) return Promise.reject(new Error('OfflineAudioContext unsupported'));
  const off = new Ctor(channels, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE);
  const out = off.createGain();
  out.gain.value = 1;
  // A safety limiter: recipes layer several notes/bursts into `out` without hand-tuning headroom,
  // so overlapping peaks can exceed 0 dBFS. This keeps every synthesized fallback un-clipped.
  const limiter = off.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 2;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  out.connect(limiter);
  limiter.connect(off.destination);
  build(off, out);
  return off.startRendering();
}

export function noiseBuffer(ctx: BaseAudioContext, duration: number, rng: () => number): AudioBuffer {
  const len = Math.max(1, Math.ceil(duration * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
  return buf;
}

export function noiseSource(ctx: BaseAudioContext, duration: number, rng: () => number, loop = false): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, loop ? duration : duration + 0.03, rng);
  src.loop = loop;
  return src;
}

/** Piecewise-linear (or exponential) gain envelope on a fresh GainNode. Values are floored so exp ramps are legal. */
export function envGain(ctx: BaseAudioContext, points: [number, number][], curve: 'lin' | 'exp' = 'lin'): GainNode {
  const g = ctx.createGain();
  const [t0, v0] = points[0];
  g.gain.setValueAtTime(Math.max(v0, 0.0001), t0);
  for (let i = 1; i < points.length; i++) {
    const [t, v] = points[i];
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), Math.max(t, t0 + 0.001));
    else g.gain.linearRampToValueAtTime(v, Math.max(t, t0));
  }
  return g;
}

export interface BurstOpts {
  duration: number;
  rng: () => number;
  filter?: 'lowpass' | 'highpass' | 'bandpass';
  freq?: number;
  freqEnd?: number;
  Q?: number;
  peak?: number;
  attack?: number;
  decay?: number;
  start?: number;
  loop?: boolean;
}

/** Filtered noise burst (or loop) with an amplitude envelope. The core recipe for scrapes, cracks, hiss and whirr. */
export function burst(ctx: BaseAudioContext, out: AudioNode, opts: BurstOpts): void {
  const start = opts.start ?? 0;
  const src = noiseSource(ctx, opts.duration, opts.rng, opts.loop);
  let node: AudioNode = src;
  if (opts.filter) {
    const f = ctx.createBiquadFilter();
    f.type = opts.filter;
    f.frequency.setValueAtTime(opts.freq ?? 2000, start);
    if (opts.freqEnd !== undefined) f.frequency.linearRampToValueAtTime(opts.freqEnd, start + opts.duration);
    f.Q.value = opts.Q ?? 1;
    node.connect(f);
    node = f;
  }
  const attack = opts.attack ?? 0.005;
  const decay = opts.decay ?? Math.max(0.02, opts.duration - attack);
  const peak = opts.peak ?? 1;
  const g = opts.loop
    ? (() => { const gg = ctx.createGain(); gg.gain.value = peak; return gg; })()
    : envGain(ctx, [[start, 0], [start + attack, peak], [start + attack + decay, 0]]);
  node.connect(g);
  g.connect(out);
  src.start(start);
  if (!opts.loop) src.stop(start + opts.duration + 0.06);
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  duration: number;
  peak?: number;
  attack?: number;
  decay?: number;
  start?: number;
  detune?: number;
  loop?: boolean;
}

/** A single oscillator note with an exponential pluck/decay envelope. The core recipe for bells and chimes. */
export function tone(ctx: BaseAudioContext, out: AudioNode, opts: ToneOpts): void {
  const start = opts.start ?? 0;
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, start);
  if (opts.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), start + opts.duration);
  if (opts.detune) osc.detune.value = opts.detune;
  const attack = opts.attack ?? 0.006;
  const decay = opts.decay ?? Math.max(0.03, opts.duration - attack);
  const peak = opts.peak ?? 0.8;
  const g = opts.loop
    ? (() => { const gg = ctx.createGain(); gg.gain.value = peak; return gg; })()
    : envGain(ctx, [[start, 0], [start + attack, peak], [start + attack + decay, 0]], 'exp');
  osc.connect(g);
  g.connect(out);
  osc.start(start);
  if (!opts.loop) osc.stop(start + attack + decay + 0.06);
}
