// Player settings (not part of the save). Wraps core/save settings with apply + change events.
import { bus } from '../core/bus';
import { loadSettings, saveSettings, type Settings } from '../core/save';

let current: Settings = loadSettings();

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  saveSettings(current);
  applySettings();
  bus.emit('settings:changed', undefined);
}

export function applySettings(): void {
  const root = document.documentElement;
  root.classList.toggle('reduced-motion', current.reducedMotion);
  root.classList.toggle('quality-low', current.quality === 'low');
  // the renderer lives in the 3D chunk: apply the quality there once it is loaded
  import('../core/renderer').then((m) => { try { m.applyQuality(); } catch { /* renderer not created yet */ } }).catch(() => undefined);
}

let mq: MediaQueryList | null = null;
/** True when motion should be minimal (OS setting or the in-game toggle). */
export function reducedMotion(): boolean {
  if (current.reducedMotion) return true;
  if (!mq && typeof matchMedia !== 'undefined') mq = matchMedia('(prefers-reduced-motion: reduce)');
  return !!mq?.matches;
}
