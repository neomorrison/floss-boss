// PUBLIC AUDIO API. Owner: audio builder. Web Audio engine: SFX one-shots, loops, music.
// Missing files must never throw: fall back to a synthesized blip or silence.
// iOS: the context must be unlocked on the first touchend/click and retried until it runs.
import type { MusicKey, SfxKey } from '../data/assets';

export interface LoopHandle { setVolume(v: number): void; setRate(r: number): void; stop(): void }

export interface AudioApi {
  /** Start listening to bus 'sfx' / 'music' / 'settings:changed' and install the unlock handlers. */
  init(): void;
  play(key: SfxKey, opts?: { volume?: number; rate?: number; detune?: number }): void;
  loop(key: SfxKey, opts?: { volume?: number; rate?: number }): LoopHandle;
  music(key: MusicKey | null): void;
  preload(keys?: readonly string[]): Promise<void>;
}

const noopLoop: LoopHandle = { setVolume() {}, setRate() {}, stop() {} };
export const audio: AudioApi = {
  init() {},
  play() {},
  loop() { return noopLoop; },
  music() {},
  preload() { return Promise.resolve(); },
};
