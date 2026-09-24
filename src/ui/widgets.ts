// Reusable UI pieces built on the design system classes (components.css).
import { money } from '../core/format';
import { thumbUrl } from '../data/assets';
import { h, replay, type Child, type ClassValue } from './dom';
import { toast } from './toasts';
import { sfx } from './fx';
import { coin, icon } from './icons';
import { swapInImage } from './img';

export type BtnVariant = 'primary' | 'teal' | 'sun' | 'gum' | 'danger' | 'ghost' | 'soft';
export interface BtnOpts {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  iconRight?: string;
  sub?: string;
  block?: boolean;
  disabled?: boolean;
  title?: string;
  class?: ClassValue;
  sound?: 'ui_click' | 'ui_tab' | null;
  onClick?: (ev: MouseEvent) => void;
}

export function btn(label: Child, o: BtnOpts = {}): HTMLButtonElement {
  // disabled with a reason (title): looks disabled but a tap explains why (touch has no hover tooltips)
  const blocked = !!o.disabled && !!o.title;
  const el = h('button', {
    type: 'button',
    class: ['btn', `btn-${o.variant ?? 'ghost'}`, o.size && o.size !== 'md' ? `btn-${o.size}` : '', { 'btn-block': !!o.block, 'btn-stack': !!o.sub, 'btn-icon': label === null || label === '', 'is-disabled': blocked }, o.class],
    disabled: !!o.disabled && !blocked,
    title: o.title,
    'aria-disabled': blocked ? 'true' : false,
    'aria-label': typeof label === 'string' ? undefined : o.title,
  }) as HTMLButtonElement;
  const main = h('span.row.gap-6', { style: 'justify-content:center' }, o.icon ? icon(o.icon) : null, label, o.iconRight ? icon(o.iconRight) : null);
  el.appendChild(main);
  if (o.sub) el.appendChild(h('span.btn-sub', o.sub));
  if (blocked) {
    el.addEventListener('click', () => {
      sfx('error');
      toast({ text: o.title!, kind: 'bad', key: 'blocked' });
      replay(el, 'anim-shake');
    });
  } else if (o.onClick) {
    el.addEventListener('click', (ev) => {
      if (el.disabled) return;
      if (o.sound !== null) sfx(o.sound ?? 'ui_click');
      o.onClick!(ev as MouseEvent);
    });
  }
  return el;
}

export function iconBtn(name: string, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const el = h('button.icon-btn', { type: 'button', class: cls, 'aria-label': label, title: label }, icon(name)) as HTMLButtonElement;
  el.addEventListener('click', () => { sfx('ui_click'); onClick(); });
  return el;
}

export function chip(text: Child, tone: '' | 'mint' | 'teal' | 'sun' | 'gum' | 'coral' | 'sky' | 'grape' | 'ink' = '', iconName?: string): HTMLElement {
  return h('span.chip', { class: tone ? `chip-${tone}` : '' }, iconName ? icon(iconName) : null, text);
}

/** Rating stars with partial fill (0..5). */
export function stars(value: number, size = 16): HTMLElement {
  const v = Math.max(0, Math.min(5, value));
  const row = () => Array.from({ length: 5 }, () => icon('star'));
  return h('span.stars', { style: { fontSize: size + 'px' }, 'aria-label': `${v.toFixed(1)} stars` },
    ...row(),
    h('span.stars-fill', { style: { width: `${(v / 5) * 100}%` } }, ...row()),
  );
}

export function bar(frac: number, tone = '', size: '' | 'sm' | 'lg' = ''): HTMLElement {
  const f = Math.max(0, Math.min(1, frac));
  return h('div.bar', { class: [tone, size ? `bar-${size}` : ''] }, h('i', { style: { width: `${f * 100}%` } }));
}

export function setBar(el: HTMLElement, frac: number): void {
  const i = el.querySelector('i');
  if (i) (i as HTMLElement).style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
}

export function statRow(label: string, value: number, max = 100, tone = ''): HTMLElement {
  return h('div.stat-row', h('span', label), bar(value / max, tone, 'sm'), h('span.num', String(Math.round(value))));
}

export function priceTag(amount: number, cls = ''): HTMLElement {
  return h('span.price', { class: cls }, coin(), money(amount));
}

/** Shop thumbnail: the Blender render when it exists, else a tinted icon. */
export function thumb(modelKey: string, fallbackIcon: string, size = 88, locked = false): HTMLElement {
  const el = h('div.thumb', { class: { locked }, style: { '--tz': size + 'px' } }, icon(fallbackIcon));
  if (!modelKey) return el;
  swapInImage(el, thumbUrl(modelKey));
  return el;
}

export interface SliderOpts {
  min: number; max: number; step: number; value: number;
  tone?: '' | 'sun';
  disabled?: boolean;
  label?: string;
  onInput?: (v: number) => void;
  onChange?: (v: number) => void;
}
export function slider(o: SliderOpts): HTMLInputElement {
  const el = h('input.range', {
    type: 'range', min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.value),
    class: o.tone ?? '', disabled: !!o.disabled, 'aria-label': o.label,
  }) as HTMLInputElement;
  const paint = () => {
    const span = o.max - o.min || 1;
    el.style.setProperty('--p', `${((Number(el.value) - o.min) / span) * 100}%`);
  };
  paint();
  el.addEventListener('input', () => { paint(); o.onInput?.(Number(el.value)); });
  el.addEventListener('change', () => { o.onChange?.(Number(el.value)); });
  return el;
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label = ''): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('change', () => { sfx('ui_click'); onChange(input.checked); });
  return h('label.toggle', input, h('i'));
}

export function seg<T extends string | number>(options: { value: T; label: Child; icon?: string; title?: string }[], value: T, onPick: (v: T) => void, cls = ''): HTMLElement {
  const wrap = h('div.seg', { class: cls, role: 'group' });
  for (const opt of options) {
    const b = h('button', { type: 'button', class: { 'is-on': opt.value === value }, title: opt.title, 'aria-pressed': String(opt.value === value) },
      opt.icon ? icon(opt.icon) : null, opt.label) as HTMLButtonElement;
    b.addEventListener('click', () => {
      sfx('ui_tab');
      wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
      b.classList.add('is-on');
      b.setAttribute('aria-pressed', 'true');
      onPick(opt.value);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

export function tabs<T extends string>(options: { value: T; label: Child; badge?: number }[], value: T, onPick: (v: T) => void): HTMLElement {
  const wrap = h('div.tabs', { role: 'tablist' });
  for (const opt of options) {
    const b = h('button', { type: 'button', role: 'tab', class: { 'is-on': opt.value === value }, 'aria-selected': String(opt.value === value) },
      opt.label, opt.badge ? h('span.badge', String(opt.badge)) : null);
    b.addEventListener('click', () => { if (opt.value !== value) { sfx('ui_tab'); onPick(opt.value); } });
    wrap.appendChild(b);
  }
  return wrap;
}

export function empty(iconName: string, title: string, text?: string, action?: HTMLElement): HTMLElement {
  return h('div.empty', icon(iconName), h('b', title), text ? h('p', text) : null, action ?? null);
}

export function sectionTitle(title: string, iconName?: string, right?: Child): HTMLElement {
  return h('div.section-title', h('h3', iconName ? icon(iconName) : null, title), right ?? null);
}
