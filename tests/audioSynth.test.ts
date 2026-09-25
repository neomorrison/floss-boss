// Unit tests for the pure, DOM-free parts of the synthesized-fallback audio.
// vitest runs in a plain Node environment (no Web Audio, see vitest.config.ts), so the parts that
// need an AudioContext/OfflineAudioContext (synthesizeSfx, synthesizeMusic, the engine's play/loop/
// music) are verified for real in a browser instead: `node tools/snap.mjs --path /harness/audio.html`
// exercises decode, playback, looping, music crossfade and (via a simulated-offline fetch) the
// synthesized fallback path itself, and confirmed no clipping (see the audio builder's report).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, noteFreq, noiseBuffer, envGain } from '../src/audio/synthCore';
import { SFX_KEYS, MUSIC_KEYS } from '../src/data/assets';

describe('hashSeed', () => {
  it('is deterministic for the same string', () => {
    expect(hashSeed('scrape_1')).toBe(hashSeed('scrape_1'));
  });
  it('differs across different keys (no accidental collisions in the SFX list)', () => {
    const hashes = new Set(SFX_KEYS.map(hashSeed));
    expect(hashes.size).toBe(SFX_KEYS.length);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });
  it('stays within [0, 1)', () => {
    const rng = mulberry32(hashSeed('tooth_ding'));
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('different seeds produce different sequences', () => {
    const a = mulberry32(hashSeed('cash'));
    const b = mulberry32(hashSeed('coins'));
    expect(a()).not.toBe(b());
  });
});

describe('noteFreq', () => {
  it('anchors semitone 0 to C5 (523.25 Hz)', () => {
    expect(noteFreq(0)).toBeCloseTo(523.25, 1);
  });
  it('an octave up doubles the frequency', () => {
    expect(noteFreq(12)).toBeCloseTo(noteFreq(0) * 2, 1);
  });
  it('an octave down halves the frequency', () => {
    expect(noteFreq(-12)).toBeCloseTo(noteFreq(0) / 2, 1);
  });
});

// ------------------------------------------------------------------ minimal BaseAudioContext double
// Just enough of the Web Audio surface for noiseBuffer/envGain (createBuffer + a real-looking
// Float32Array-backed channel) to run under plain Node, without pretending to model real DSP.
class FakeAudioBuffer {
  private channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(ch: number): Float32Array { return this.channels[ch]; }
}
class FakeGainParam {
  value = 1;
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
}
class FakeGainNode { gain = new FakeGainParam(); connect() { return this; } }
class FakeCtx {
  sampleRate = 44100;
  createBuffer(ch: number, length: number, sampleRate: number) { return new FakeAudioBuffer(ch, length, sampleRate) as unknown as AudioBuffer; }
  createGain() { return new FakeGainNode() as unknown as GainNode; }
}

describe('noiseBuffer', () => {
  it('fills every sample in [-1, 1) and respects duration * sampleRate', () => {
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const rng = mulberry32(1);
    const buf = noiseBuffer(ctx, 0.1, rng);
    expect(buf.length).toBe(Math.ceil(0.1 * 44100));
    const data = buf.getChannelData(0);
    let allInRange = true;
    for (let i = 0; i < data.length; i++) if (data[i] < -1 || data[i] >= 1) allInRange = false;
    expect(allInRange).toBe(true);
  });
  it('is not silent (a synthesized fallback must actually make sound)', () => {
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const rng = mulberry32(hashSeed('flake'));
    const buf = noiseBuffer(ctx, 0.05, rng);
    const data = buf.getChannelData(0);
    const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.01);
  });
});

describe('envGain', () => {
  it('builds a monotonically applied envelope ending at the last point value', () => {
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const g = envGain(ctx, [[0, 0], [0.01, 1], [0.2, 0]]);
    expect(g.gain.value).toBe(0); // linear ramps: the fake param just records the last call, exp path untested here
  });
});

describe('SFX/music key lists (data/assets contract this module renders a fallback for)', () => {
  it('has the expected key counts (canary: fails loudly if the shared data contract changes)', () => {
    // v3 manager layer (DESIGN 10) added 7 keys: event_card, event_good, event_bad, campaign_start,
    // perk_pick, huddle, interview (53 -> 60). v4 end game (DESIGN 11) added 8: bling, ayy, grill_pop,
    // crowd_cheer, fanfare_gala, ribbon_snip, milestone, promotion (60 -> 68).
    expect(SFX_KEYS.length).toBe(68);
    expect(MUSIC_KEYS.length).toBe(3);
  });
  it('ships a real mp3 for every SFX and music key (the synth recipes are only the fallback)', () => {
    const dir = path.resolve(__dirname, '..', 'public', 'audio');
    const missing = [...SFX_KEYS, ...MUSIC_KEYS].filter((k) => {
      const f = path.join(dir, `${k}.mp3`);
      return !fs.existsSync(f) || fs.statSync(f).size < 1000;
    });
    expect(missing).toEqual([]);
  });
  it('every SFX key is a non-empty lowercase_snake_case id', () => {
    for (const k of SFX_KEYS) expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

// Note: synthSfx.ts / synthMusic.ts declare their recipe tables as Record<SfxKey, ...> and
// Record<MusicKey, ...>, so `npx tsc --noEmit` alone already fails if a key from data/assets.ts
// has no synthesized recipe: that exhaustiveness check runs on every build, not just here.
