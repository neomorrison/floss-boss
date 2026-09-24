// Toast stack (reviews, walkouts, goals, achievements, action results).
import { h, type Child } from './dom';
import { icon } from './icons';

export type ToastKind = 'info' | 'good' | 'bad' | 'gold';
export interface ToastOpts {
  text: Child;
  sub?: Child;
  kind?: ToastKind;
  icon?: string;
  lead?: HTMLElement;     // portrait or stars instead of the icon
  ms?: number;
  key?: string;           // same key replaces the previous toast (e.g. "Not enough cash")
  onClick?: () => void;
}

let host: HTMLElement | null = null;
let suppressed = false;
const MAX = 4;

export function initToasts(root: HTMLElement): void {
  host = root;
}

/** While true (hands-on clean running) only 'bad' toasts show. */
export function suppressToasts(v: boolean): void {
  suppressed = v;
}

const DEFAULT_ICON: Record<ToastKind, string> = { info: 'info', good: 'check', bad: 'alert', gold: 'sparkle' };

export function toast(o: ToastOpts): void {
  if (!host) return;
  if (suppressed && o.kind !== 'bad') return;
  if (o.key) host.querySelector(`[data-key="${CSS.escape(o.key)}"]`)?.remove();
  const kind = o.kind ?? 'info';
  const el = h('div.toast', { class: `toast-${kind}`, 'data-key': o.key ?? false, role: 'status' },
    o.lead ?? h('div.toast-icon', icon(o.icon ?? DEFAULT_ICON[kind])),
    h('div.toast-text', h('div.toast-main', o.text), o.sub ? h('div.toast-sub', o.sub) : null),
  );
  if (o.onClick) { el.classList.add('is-action'); el.addEventListener('click', () => { o.onClick!(); dismiss(el); }); }
  else el.addEventListener('click', () => dismiss(el));
  host.appendChild(el);
  const items = host.querySelectorAll('.toast:not(.is-leaving)');
  if (items.length > MAX) dismiss(items[0] as HTMLElement);
  setTimeout(() => dismiss(el), o.ms ?? 3600);
}

function dismiss(el: HTMLElement): void {
  if (el.classList.contains('is-leaving')) return;
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 260);
}

export function clearToasts(): void {
  host?.querySelectorAll('.toast').forEach((t) => t.remove());
}
