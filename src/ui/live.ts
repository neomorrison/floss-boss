// A modal whose body re-renders when the game state changes (op panel, staff card).
import { bus } from '../core/bus';
import { h } from './dom';
import { icon } from './icons';
import { openModal, type ModalHandle, type ModalOpts } from './modal';

export function liveModal(o: Omit<ModalOpts, 'body'>, render: (m: ModalHandle) => HTMLElement): ModalHandle {
  const holder = h('div.live-body');
  const m = openModal({ ...o, body: holder, blocking: o.blocking ?? false });
  let t: ReturnType<typeof setTimeout> | null = null;
  let down = false;
  const draw = () => {
    t = null;
    if (!m.open) return;
    const a = document.activeElement as HTMLElement | null;
    if (down || (a && m.el.contains(a) && (a.tagName === 'SELECT' || a.tagName === 'INPUT'))) { t = setTimeout(draw, 400); return; }
    const sc = m.body.scrollTop;
    try {
      holder.replaceChildren(render(m));
    } catch (e) {
      console.warn('[ui] live modal', e);
      holder.replaceChildren(h('div.empty', icon('info'), h('b', 'Nothing to show yet')));
    }
    m.body.scrollTop = sc;
  };
  m.el.addEventListener('pointerdown', () => { down = true; });
  const up = () => { down = false; };
  window.addEventListener('pointerup', up);
  const off = bus.on('state:changed', () => { if (!t) t = setTimeout(draw, 250); });
  m.closed.then(() => { off(); window.removeEventListener('pointerup', up); if (t) clearTimeout(t); });
  draw();
  return m;
}

/** Native <select> with the design system look (touch friendly: opens the OS picker). */
export function select<T extends string>(options: { value: T; label: string; disabled?: boolean }[], value: T, onPick: (v: T) => void, label = ''): HTMLElement {
  const sel = h('select.select-input', { 'aria-label': label }) as HTMLSelectElement;
  for (const o of options) {
    const opt = h('option', { value: o.value, disabled: !!o.disabled }, o.label) as HTMLOptionElement;
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { onPick(sel.value as T); sel.blur(); });
  return h('label.select', sel, icon('chevronDown'));
}
