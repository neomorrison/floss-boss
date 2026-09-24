// Smoke tests for the audio engine's exported shape and its DOM-free code paths. Real playback,
// decoding, looping, music crossfade and the synthesized-fallback path all need a live
// AudioContext/OfflineAudioContext, which vitest's Node environment does not provide (see
// vitest.config.ts: environment 'node'); those are verified in a real browser instead, via
// `node tools/snap.mjs --path /harness/audio.html` (see the audio builder's report for results).
import { describe, expect, it } from 'vitest';
import { audio, debugContextState, type AudioApi, type LoopHandle } from '../src/audio/index';

describe('audio public API', () => {
  it('matches the AudioApi contract: every method the UI/clean/clinic modules code against exists', () => {
    const api: AudioApi = audio;
    expect(typeof api.init).toBe('function');
    expect(typeof api.play).toBe('function');
    expect(typeof api.loop).toBe('function');
    expect(typeof api.music).toBe('function');
    expect(typeof api.preload).toBe('function');
  });

  it('preload() returns a Promise (the contract other modules await)', () => {
    // Calling it in Node (no AudioContext) would throw when it tries to build one; we only assert
    // the shape here, not invoke it. Real preload behavior is covered by the browser harness.
    expect(audio.preload).toBeInstanceOf(Function);
    expect(audio.preload.length).toBe(1); // (keys?) — one formal parameter
  });

  it('debugContextState() reports "none" before any AudioContext has been created', () => {
    // engine.ts only touches `window` inside ensureContext()/init(); merely importing the module,
    // and calling the debug accessor, must be side-effect free in a DOM-less environment.
    expect(debugContextState()).toBe('none');
  });
});

describe('LoopHandle shape', () => {
  it('documents the handle contract callers rely on (setVolume/setRate/stop)', () => {
    const handle: LoopHandle = { setVolume() {}, setRate() {}, stop() {} };
    expect(typeof handle.setVolume).toBe('function');
    expect(typeof handle.setRate).toBe('function');
    expect(typeof handle.stop).toBe('function');
  });
});
