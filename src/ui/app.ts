// App shell: layers, screen router and the single rAF loop.
import { bus } from '../core/bus';
import { store } from '../core/store';
import { h } from './dom';
import { initModals, modals } from './modal';
import { initToasts } from './toasts';

export type ScreenName = 'title' | 'newgame' | 'school' | 'hub';
export type PanelName = 'tools' | 'skills' | 'staff' | 'office' | 'finance' | 'city' | 'goals' | 'settings';
export const PANELS: PanelName[] = ['tools', 'skills', 'staff', 'office', 'finance', 'city', 'goals', 'settings'];

export interface Screen {
  name: ScreenName;
  el: HTMLElement;
  frame?(dt: number): void;
  onState?(): void;
  dispose(): void;
}

export type ScreenFactory = (params: Record<string, unknown>) => Screen;

export const layers = {
  root: null as unknown as HTMLElement,
  screen: null as unknown as HTMLElement,
  handson: null as unknown as HTMLElement,
  modal: null as unknown as HTMLElement,
  toast: null as unknown as HTMLElement,
};

const factories: Partial<Record<ScreenName, ScreenFactory>> = {};
let current: Screen | null = null;
let panelOpener: ((p: PanelName | null) => void) | null = null;

export function registerScreen(name: ScreenName, f: ScreenFactory): void {
  factories[name] = f;
}

/** The hub registers this so `go('staff')` opens the Staff panel inside it. */
export function setPanelOpener(fn: ((p: PanelName | null) => void) | null): void {
  panelOpener = fn;
}

export function currentScreen(): Screen | null {
  return current;
}

export function initApp(root: HTMLElement): void {
  root.innerHTML = '';
  layers.root = root;
  layers.screen = h('div.layer-screen');
  layers.handson = h('div.layer-handson');
  layers.modal = h('div.layer-modal');
  layers.toast = h('div.layer-toast', { 'aria-live': 'polite' });
  root.append(layers.screen, layers.handson, layers.modal, layers.toast);
  initModals(layers.modal);
  initToasts(layers.toast);

  bus.on('navigate', ({ screen, params }) => go(screen, params ?? {}));
  let pending = false;
  bus.on('state:changed', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; current?.onState?.(); });
  });
  startLoop();
}

export function go(name: string, params: Record<string, unknown> = {}): void {
  if ((PANELS as string[]).includes(name)) {
    if (current?.name !== 'hub') {
      if (!store.loaded) return;
      showScreen('hub', {});
    }
    panelOpener?.(name as PanelName);
    return;
  }
  if (name === 'clinic' || (name === 'hub' && current?.name === 'hub')) {
    // the hub follows phase and clinic changes by itself: never rebuild it (that would recreate the 3D view)
    if (current?.name !== 'hub') showScreen('hub', {});
    else current.onState?.();
    panelOpener?.(null);
    return;
  }
  showScreen(name as ScreenName, params);
}

function showScreen(name: ScreenName, params: Record<string, unknown>): void {
  const f = factories[name];
  if (!f) { console.warn('[ui] unknown screen', name); return; }
  modals.closeAll();
  const prev = current;
  current = null;
  if (prev) {
    try { prev.dispose(); } catch (e) { console.error(e); }
    const old = prev.el;
    old.classList.add('is-leaving');
    setTimeout(() => old.remove(), 260);
  }
  const next = f(params);
  current = next;
  next.el.classList.add('screen', `screen-${name}`);
  layers.screen.appendChild(next.el);
  document.documentElement.dataset.screen = name;
}

// ------------------------------------------------------------------ loop
let last = 0;
function startLoop(): void {
  const step = (now: number) => {
    requestAnimationFrame(step);
    const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 0;
    last = now;
    if (current?.frame) {
      try { current.frame(dt); } catch (e) { console.error('[ui] frame', e); }
    }
  };
  requestAnimationFrame(step);
}
