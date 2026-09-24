// Game-state glue for the UI: selectors with safe fallbacks, actions with feedback, persistence.
import { store } from '../core/store';
import type { ActionResult, Clinic, GameState } from '../core/types';
import * as sim from '../sim';
import { signedMoney } from '../core/format';
import { floatText, sfx, haptic } from './fx';
import { noDash } from './logic';
import { attempt } from './safe';
import { toast } from './toasts';

export function S(): GameState {
  return store.state;
}

export function isOwner(s: GameState = store.state): boolean {
  return s.phase === 'owner';
}

/** The clinic the hub shows. Falls back to reading state directly while the sim is unavailable. */
export function activeClinic(s: GameState = store.state): Clinic | null {
  return attempt(() => sim.activeClinic(s), s.active >= 0 ? s.locations[s.active] ?? null : s.employer, 'activeClinic');
}

/** Index into state.locations of the clinic on screen (0 when showing the employer, for owner-only calls). */
export function activeIndex(s: GameState = store.state): number {
  return Math.max(0, Math.min(s.locations.length - 1, s.active));
}

export function playerTitle(s: GameState = store.state): string {
  return noDash(attempt(() => sim.title(s), s.player.title || 'Hygiene Student', 'title'));
}

export function hint(s: GameState = store.state): string {
  return noDash(attempt(() => sim.nextHint(s), '', 'nextHint'));
}

/** Persist now (and stamp lastSeen for offline progress). */
export function persist(): void {
  if (!store.loaded) return;
  try { store.state.lastSeen = Date.now(); } catch { /* ignore */ }
  store.saveNow();
}

export interface ActOpts {
  sound?: 'purchase' | 'ui_click' | 'cash' | 'hire' | null;
  success?: string;          // toast on success (product voice)
  quietFail?: boolean;
}

/** Run a sim action: commit on success, toast the reason on failure. Returns ok. */
export function act(fn: () => ActionResult, o: ActOpts = {}): boolean {
  let r: ActionResult;
  const cashBefore = store.loaded ? store.state.cash : 0;
  try {
    r = fn();
  } catch (e) {
    console.warn('[ui] action failed', e);
    r = { ok: false, reason: 'Not available yet' };
  }
  if (r.ok) {
    if (o.sound !== null) sfx(o.sound ?? 'purchase');
    haptic(10);
    const delta = store.loaded ? Math.round(store.state.cash - cashBefore) : 0;
    const pill = document.querySelector('.hud-cash');
    if (delta && pill) floatText(pill, signedMoney(delta), delta < 0 ? 'is-spend' : 'is-earn');
    const msg = o.success ?? r.message;
    if (msg) toast({ text: noDash(msg), kind: 'good', key: 'act' });
    store.commit();
    return true;
  }
  if (!o.quietFail) {
    sfx('error');
    toast({ text: noDash(r.reason), kind: 'bad', key: 'act-fail' });
  }
  return false;
}

export function canAfford(price: number, s: GameState = store.state): boolean {
  return s.cash >= price;
}
