// PUBLIC CLEAN API. Owner: clean builder. The hands-on 3D cleaning scene.
// The UI mounts it full screen, awaits `done`, then disposes it and shows its own result screen.
// The scene renders its own in-scene HUD (tool bar, comfort meter, portrait, mini-map, Done, tutorial prompts)
// inside `container`, plays sounds through bus.emit('sfx', ...) / the audio module, and never touches the store.
import type { CleanResult, CleanSetup } from '../core/types';

export interface CleanSession {
  /** Resolves when the player presses Done, the patient walks out, or the player backs out (quit 'abort'). */
  done: Promise<CleanResult>;
  /** Pause/resume (settings overlay, tab hidden). Comfort and the timer stop while paused. */
  pause(paused: boolean): void;
  /** Remove the canvas, HUD and listeners, free GPU memory. Safe to call twice. */
  dispose(): void;
}

export function startClean(container: HTMLElement, setup: CleanSetup): CleanSession {
  throw new Error('clean.startClean not built yet');
}

/** Warm up models and textures (call on the title screen). */
export function preloadClean(): Promise<void> {
  return Promise.resolve();
}
