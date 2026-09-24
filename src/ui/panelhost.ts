// Panel host: the sheet that holds Tools, Skills, Staff, Office, Finance, Goals and Settings over the
// clinic. Re-renders on state changes (throttled, and never mid-drag or while typing).
import { store } from '../core/store';
import type { PanelName } from './app';
import { h } from './dom';
import { sfx } from './fx';
import { isOwner } from './game';
import { icon } from './icons';
import { financePanel } from './panels/finance';
import { goalsPanel } from './panels/goals';
import { officePanel } from './panels/office';
import { settingsPanel } from './panels/settings';
import { skillsPanel } from './panels/skills';
import { staffPanel } from './panels/staff';
import { toolsPanel } from './panels/tools';

export interface PanelCtx {
  close(): void;
  rerender(): void;
  openOp(opId: string): void;
  openStaff(staffId: string): void;
}
export interface PanelInst {
  title: string;
  icon: string;
  render(): HTMLElement;
  aside?(): HTMLElement | null;   // header extra (skill points, cash)
  /** Cheap signature of the state this panel shows. Background state changes re-render only when it changes. */
  key?(): string;
  dispose?(): void;
}
export type PanelBuilder = (ctx: PanelCtx) => PanelInst;

const BUILDERS: Record<PanelName, PanelBuilder> = {
  tools: toolsPanel,
  skills: skillsPanel,
  staff: staffPanel,
  office: officePanel,
  finance: financePanel,
  goals: goalsPanel,
  settings: settingsPanel,
};
const OWNER_ONLY: PanelName[] = ['staff', 'office', 'finance'];

export interface PanelHost {
  el: HTMLElement;
  current: PanelName | null;
  open(p: PanelName | null): void;
  onState(): void;
  onChange(fn: () => void): void;
  dispose(): void;
}

export function createPanelHost(links: { openOp(id: string): void; openStaff(id: string): void }): PanelHost {
  const titleEl = h('h2.panel-title');
  const iconEl = h('div.panel-icon');
  const asideEl = h('div.panel-aside');
  const body = h('div.panel-body.scroll');
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close' }, icon('close'));
  const sheet = h('section.panel.card', { role: 'region' },
    h('header.panel-head', iconEl, titleEl, asideEl, closeBtn),
    body,
  );
  const el = h('div.panel-host', h('div.panel-scrim'), sheet);
  let inst: PanelInst | null = null;
  let name: PanelName | null = null;
  let listeners: (() => void)[] = [];
  let pointerDown = false;
  let lastRender = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastUserAct = 0;

  el.querySelector('.panel-scrim')!.addEventListener('click', () => host.open(null));
  closeBtn.addEventListener('click', () => { sfx('ui_click'); host.open(null); });
  sheet.addEventListener('pointerdown', () => { pointerDown = true; lastUserAct = performance.now(); });
  const onUp = () => { if (pointerDown) { pointerDown = false; if (pendingTimer === null) schedule(60); } };
  const onCancel = () => { pointerDown = false; };
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);

  const ctx: PanelCtx = {
    close: () => host.open(null),
    rerender: () => render(),
    openOp: (id) => links.openOp(id),
    openStaff: (id) => links.openStaff(id),
  };

  let lastKey = '';
  const keyOf = () => { try { return inst?.key?.() ?? String(Math.random()); } catch { return String(Math.random()); } };

  function render(): void {
    if (!inst) return;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    lastRender = performance.now();
    lastKey = keyOf();
    const scroll = body.scrollTop;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
    let content: HTMLElement;
    try {
      content = inst.render();
    } catch (e) {
      console.warn('[ui] panel render', e);
      content = h('div.empty', icon('info'), h('b', 'Nothing to show yet'));
    }
    body.replaceChildren(content);
    body.scrollTop = scroll;
    try { asideEl.replaceChildren(inst.aside?.() ?? ''); } catch { asideEl.replaceChildren(); }
    if (focusedId) (body.querySelector(`[data-focus-key="${focusedId}"]`) as HTMLElement | null)?.focus();
  }

  function asideRefresh(): void {
    try { asideEl.replaceChildren(inst?.aside?.() ?? ''); } catch { /* ignore */ }
  }

  function busy(): boolean {
    if (pointerDown) return true;
    const a = document.activeElement as HTMLElement | null;
    return !!a && sheet.contains(a) && (a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'text' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }

  function schedule(ms: number): void {
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (!inst) return;
      if (busy()) { schedule(400); return; }
      if (inst.key && keyOf() === lastKey) { asideRefresh(); return; }
      render();
    }, ms);
  }

  const host: PanelHost = {
    el,
    get current() { return name; },
    open(p) {
      if (p && OWNER_ONLY.includes(p) && store.loaded && !isOwner(store.state)) p = null;
      if (p === name) { if (p) render(); return; }
      inst?.dispose?.();
      inst = null;
      name = p;
      document.documentElement.classList.toggle('panel-open', !!p);
      if (!p) {
        el.classList.remove('is-open');
        listeners.forEach((f) => f());
        return;
      }
      inst = BUILDERS[p](ctx);
      titleEl.textContent = inst.title;
      iconEl.replaceChildren(icon(inst.icon));
      sheet.dataset.panel = p;
      body.scrollTop = 0;
      render();
      el.classList.add('is-open');
      listeners.forEach((f) => f());
    },
    onState() {
      if (!inst) return;
      if (name && OWNER_ONLY.includes(name) && store.loaded && !isOwner(store.state)) { host.open(null); return; }
      const now = performance.now();
      const recentUser = now - lastUserAct < 1200;
      if (recentUser && !busy()) { render(); return; }
      if (inst.key && keyOf() === lastKey) { asideRefresh(); return; }
      schedule(Math.max(0, 700 - (now - lastRender)));
    },
    onChange(fn) { listeners.push(fn); },
    dispose() {
      inst?.dispose?.();
      inst = null;
      if (pendingTimer) clearTimeout(pendingTimer);
      listeners = [];
      document.documentElement.classList.remove('panel-open');
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    },
  };
  return host;
}
