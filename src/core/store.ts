// Single source of truth for the running game. Sim functions mutate the state object they are
// given; UI code calls store.commit() afterwards to notify listeners and schedule an autosave.
import type { GameState } from './types';
import { saveGame } from './save';
import { bus } from './bus';

let current: GameState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const store = {
  get state(): GameState {
    if (!current) throw new Error('No game loaded');
    return current;
  },
  get loaded(): boolean { return current !== null; },
  set(state: GameState | null): void {
    current = state;
    bus.emit('state:changed', undefined);
  },
  /** Call after any mutation. Autosaves shortly after (debounced). */
  commit(opts: { saveNow?: boolean } = {}): void {
    bus.emit('state:changed', undefined);
    if (!current) return;
    if (saveTimer) clearTimeout(saveTimer);
    if (opts.saveNow) { saveGame(current); return; }
    saveTimer = setTimeout(() => { if (current) saveGame(current); }, 400);
  },
  saveNow(): void { if (current) saveGame(current); },
};
