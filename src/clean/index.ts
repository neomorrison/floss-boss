// PUBLIC CLEAN API. Owner: clean builder. The hands-on 3D cleaning scene.
// The UI mounts it full screen, awaits `done`, then disposes it and shows its own result screen.
// The scene renders its own in-scene HUD (tool bar, comfort meter, portrait, mini-map, Done, tutorial prompts)
// inside `container`, plays sounds through the audio module, and never touches the store.
import type { CleanResult, CleanSetup } from '../core/types';
import { preloadModels } from '../core/assets';
import { TOOLS } from '../data/tools';
import { CleanController, neededModels } from './session';

export interface CleanSession {
  /** Resolves when the player presses Done, the patient walks out, or the player backs out (quit 'abort'). */
  done: Promise<CleanResult>;
  /** Pause/resume (settings overlay, tab hidden). Comfort and the timer stop while paused. */
  pause(paused: boolean): void;
  /** Remove the canvas, HUD and listeners, free GPU memory. Safe to call twice. */
  dispose(): void;
}

export function startClean(container: HTMLElement, setup: CleanSetup): CleanSession {
  let resolve!: (r: CleanResult) => void;
  const done = new Promise<CleanResult>((r) => { resolve = r; });
  const ctl = new CleanController(container, setup, resolve);
  return {
    done,
    pause: (p) => ctl.pause(p),
    dispose: () => ctl.dispose(),
  };
}

/** Warm up models and textures (call on the title screen). */
export function preloadClean(): Promise<void> {
  const tools = Object.values(TOOLS).flat().map((t) => t.model);
  return preloadModels([...neededModels(null), ...tools]).catch(() => undefined);
}

export { buildSetup, modsFromSkills } from './setup';
export { parFor, scoreClean } from './dirt';
