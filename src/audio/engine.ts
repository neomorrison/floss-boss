// Web Audio engine internals. Owner: audio builder. See index.ts for the public API this backs.
// A missing or undecodable file NEVER throws and never leaves a caller without sound: getBuffer()
// always resolves, falling back to a synthesized recipe (synthSfx / synthMusic) on any failure.
import { audioUrl, MUSIC_KEYS, SFX_KEYS, type MusicKey, type SfxKey } from '../data/assets';
import { bus } from '../core/bus';
import { loadSettings } from '../core/save';
import type { LoopHandle } from './index';
import { synthesizeSfx } from './synthSfx';
import { synthesizeMusic } from './synthMusic';

const MUSIC_CROSSFADE = 1.5;   // seconds, per DESIGN 8
const LOOP_FADE = 0.08;        // seconds, short fade on loop stop/start
const PITCH_JITTER = 0.04;     // +-4% default random variation when no explicit rate is given

const musicKeySet = new Set<string>(MUSIC_KEYS);
const isMusicKey = (k: string): k is MusicKey => musicKeySet.has(k);
const isKnownSfx = (k: string): k is SfxKey => (SFX_KEYS as readonly string[]).includes(k);

let ctx: AudioContext | null = null;
let masterGain: GainNode;
let musicGain: GainNode;
let sfxGain: GainNode;
let started = false;

function ensureContext(): AudioContext {
  if (ctx) return ctx;
  const Ctor = (window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!;
  ctx = new Ctor();
  masterGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.connect(ctx.destination);
  applySettings();
  return ctx;
}

/** Debug/harness only: the live AudioContext state, or 'none' before init(). */
export function contextState(): AudioContextState | 'none' {
  return ctx?.state ?? 'none';
}

function applySettings(): void {
  if (!ctx) return;
  const s = loadSettings();
  masterGain.gain.value = s.master;
  musicGain.gain.value = s.music;
  sfxGain.gain.value = s.sfx;
}

// ---------------------------------------------------------------- decode + synth fallback cache
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();

async function fetchAndDecode(c: AudioContext, key: string): Promise<AudioBuffer> {
  const res = await fetch(audioUrl(key));
  if (!res.ok) throw new Error(`audio ${key}: ${res.status}`);
  const arr = await res.arrayBuffer();
  return c.decodeAudioData(arr);
}

function getBuffer(key: string, kind: 'sfx' | 'music'): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(key);
  if (cached) return cached;
  const c = ensureContext();
  const p = (async (): Promise<AudioBuffer | null> => {
    try {
      return await fetchAndDecode(c, key);
    } catch {
      try {
        if (kind === 'music' && isMusicKey(key)) return await synthesizeMusic(key);
        if (kind === 'sfx' && isKnownSfx(key)) return await synthesizeSfx(key);
        return null;
      } catch {
        return null; // truly nothing playable; callers no-op rather than throw
      }
    }
  })();
  bufferCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------- one-shots
export function play(key: SfxKey, opts?: { volume?: number; rate?: number; detune?: number }): void {
  const c = ensureContext();
  getBuffer(key, 'sfx').then((buffer) => {
    if (!buffer) return;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const jitter = opts?.rate !== undefined ? 0 : (Math.random() * 2 - 1) * PITCH_JITTER;
    src.playbackRate.value = (opts?.rate ?? 1) * (1 + jitter);
    if (opts?.detune !== undefined) src.detune.value = opts.detune;
    const g = c.createGain();
    g.gain.value = opts?.volume ?? 1;
    src.connect(g);
    g.connect(sfxGain);
    src.start();
  }).catch(() => { /* never throw */ });
}

// ---------------------------------------------------------------- loops
export function loop(key: SfxKey, opts?: { volume?: number; rate?: number }): LoopHandle {
  const c = ensureContext();
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(sfxGain);
  let src: AudioBufferSourceNode | null = null;
  let stopped = false;
  let wantVolume = opts?.volume ?? 1;
  let wantRate = opts?.rate ?? 1;

  getBuffer(key, 'sfx').then((buffer) => {
    if (stopped || !buffer) return;
    src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = wantRate;
    src.connect(gain);
    const now = c.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(wantVolume, now + LOOP_FADE);
    src.start();
  }).catch(() => { /* never throw */ });

  return {
    setVolume(v: number) {
      wantVolume = v;
      if (stopped || !ctx) return;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(v, now + LOOP_FADE);
    },
    setRate(r: number) {
      wantRate = r;
      if (src) src.playbackRate.linearRampToValueAtTime(r, (ctx?.currentTime ?? 0) + LOOP_FADE);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ctx?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + LOOP_FADE);
      const s = src;
      setTimeout(() => {
        try { s?.stop(); } catch { /* already stopped */ }
        try { gain.disconnect(); } catch { /* already disconnected */ }
      }, LOOP_FADE * 1000 + 60);
    },
  };
}

// ---------------------------------------------------------------- music
let currentMusicKey: MusicKey | null = null;
let currentMusicNode: { gain: GainNode; src: AudioBufferSourceNode | null } | null = null;
let musicToken = 0;

export function music(key: MusicKey | null): void {
  if (key === currentMusicKey) return;
  const c = ensureContext();
  const token = ++musicToken;
  const prev = currentMusicNode;
  currentMusicKey = key;
  currentMusicNode = null;

  if (prev) {
    const now = c.currentTime;
    prev.gain.gain.cancelScheduledValues(now);
    prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
    prev.gain.gain.linearRampToValueAtTime(0, now + MUSIC_CROSSFADE);
    const s = prev.src;
    const g = prev.gain;
    setTimeout(() => {
      try { s?.stop(); } catch { /* already stopped */ }
      try { g.disconnect(); } catch { /* already disconnected */ }
    }, MUSIC_CROSSFADE * 1000 + 100);
  }
  if (!key) return;

  getBuffer(key, 'music').then((buffer) => {
    if (token !== musicToken || !buffer || !ctx) return; // superseded by a later call
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(musicGain);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(g);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + MUSIC_CROSSFADE);
    src.start();
    currentMusicNode = { gain: g, src };
  }).catch(() => { /* never throw */ });
}

// ---------------------------------------------------------------- preload
export function preload(keys?: readonly string[]): Promise<void> {
  ensureContext();
  const list = keys ?? [...SFX_KEYS, ...MUSIC_KEYS];
  return Promise.all(list.map((k) => getBuffer(k, isMusicKey(k) ? 'music' : 'sfx'))).then(() => undefined);
}

// ---------------------------------------------------------------- lifecycle: bus, visibility, iOS unlock
export function init(): void {
  if (started) return;
  started = true;
  ensureContext();

  bus.on('sfx', ({ key, volume, rate }) => { if (isKnownSfx(key)) play(key, { volume, rate }); });
  bus.on('music', ({ key }) => { if (key === null || isMusicKey(key)) music(key as MusicKey | null); });
  bus.on('settings:changed', () => applySettings());

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    });
  }

  if (typeof window !== 'undefined') {
    const tryResume = () => {
      const c = ensureContext();
      if (c.state === 'running') { removeUnlock(); return; }
      c.resume().catch(() => {});
    };
    const events: (keyof WindowEventMap)[] = ['touchend', 'pointerup', 'click', 'keydown'];
    const removeUnlock = () => events.forEach((e) => window.removeEventListener(e, tryResume));
    events.forEach((e) => window.addEventListener(e, tryResume, { passive: true }));
  }
}
