// PUBLIC AUDIO API. Owner: audio builder. Web Audio engine: SFX one-shots, loops, music.
// Missing files must never throw: fall back to a synthesized blip or silence.
// iOS: the context must be unlocked on the first touchend/click and retried until it runs.
import type { MusicKey, SfxKey } from '../data/assets';
import * as engine from './engine';

export interface LoopHandle { setVolume(v: number): void; setRate(r: number): void; stop(): void }

export interface AudioApi {
  /** Start listening to bus 'sfx' / 'music' / 'settings:changed' and install the unlock handlers. */
  init(): void;
  play(key: SfxKey, opts?: { volume?: number; rate?: number; detune?: number }): void;
  loop(key: SfxKey, opts?: { volume?: number; rate?: number }): LoopHandle;
  music(key: MusicKey | null): void;
  preload(keys?: readonly string[]): Promise<void>;
}

export const audio: AudioApi = {
  init: engine.init,
  play: engine.play,
  loop: engine.loop,
  music: engine.music,
  preload: engine.preload,
};

/** Debug/harness only, not part of the AudioApi contract: the live AudioContext state. */
export const debugContextState = engine.contextState;
