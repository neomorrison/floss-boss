// Modal manager. Modals stack; `blocking` ones pause the game loop. `enqueue` shows a modal once
// nothing else is open (level up after a clean result, day report after a toast storm).
import { h, type Child } from './dom';
import { sfx } from './fx';
import { icon } from './icons';
import { clearToasts } from './toasts';

export interface ModalOpts {
  title?: Child;
  eyebrow?: string;
  icon?: string;
  body: Child;
  actions?: Child[];
  size?: 'sm' | 'md' | 'lg' | 'xl';
  blocking?: boolean;       // pauses the clinic clock (default true)
  dismissable?: boolean;    // Esc and backdrop close it (default true)
  closeButton?: boolean;    // show the X (default = dismissable)
  cls?: string;
  hero?: Child;             // full-bleed top area (art, badges)
  onClose?: () => void;
}

export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  close(): void;
  closed: Promise<void>;
  readonly open: boolean;
}

let host: HTMLElement | null = null;
const stack: { handle: ModalHandle; blocking: boolean; dismissable: boolean }[] = [];
const waiting: (() => void)[] = [];

export function initModals(root: HTMLElement): void {
  host = root;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    if (top.dismissable) { e.preventDefault(); top.handle.close(); }
  });
}

export const modals = {
  get blocking(): boolean { return stack.some((m) => m.blocking); },
  get count(): number { return stack.length; },
  closeAll(): void { [...stack].reverse().forEach((m) => m.handle.close()); },
};

export function openModal(o: ModalOpts): ModalHandle {
  if (!host) throw new Error('modals not initialised');
  const dismissable = o.dismissable ?? true;
  const blocking = o.blocking ?? true;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => { resolveClosed = r; });
  let isOpen = true;

  const body = h('div.modal-body.scroll');
  const foot = h('div.modal-foot');
  const closeBtn = (o.closeButton ?? dismissable)
    ? h('button.icon-btn.modal-x', { type: 'button', 'aria-label': 'Close', onClick: () => { sfx('ui_click'); handle.close(); } }, icon('close'))
    : null;
  const hasHead = !!(o.title || o.eyebrow);
  const head = hasHead
    ? h('header.modal-head',
      o.icon ? h('div.modal-icon', icon(o.icon)) : null,
      h('div.grow', o.eyebrow ? h('div.eyebrow', o.eyebrow) : null, o.title ? h('h2.modal-title', o.title) : null),
      closeBtn)
    : null;
  if (!hasHead && closeBtn) closeBtn.classList.add('modal-x-float');
  const card = h('div.modal.card', { class: [`modal-${o.size ?? 'md'}`, o.cls, { 'is-bare': !hasHead && !o.hero }], role: 'dialog', 'aria-modal': 'true' },
    o.hero ? h('div.modal-hero', o.hero) : null,
    head,
    body,
    foot,
    !hasHead ? closeBtn : null,
  );
  const backdrop = h('div.modal-backdrop');
  const root = h('div.modal-root', backdrop, h('div.modal-wrap', card));
  if (dismissable) backdrop.addEventListener('click', () => handle.close());
  root.querySelector('.modal-wrap')!.addEventListener('click', (e) => {
    if (dismissable && e.target === e.currentTarget) handle.close();
  });

  const fill = (el: HTMLElement, c: Child) => { if (c !== null && c !== undefined && c !== false) (Array.isArray(c) ? c : [c]).forEach((x) => { if (x instanceof Node) el.appendChild(x); else if (x !== null && x !== undefined && x !== false) el.appendChild(document.createTextNode(String(x))); }); };
  fill(body, o.body);
  if (o.actions?.length) o.actions.forEach((a) => fill(foot, a));
  else foot.remove();

  const handle: ModalHandle = {
    el: card,
    body,
    foot,
    closed,
    get open() { return isOpen; },
    close() {
      if (!isOpen) return;
      isOpen = false;
      const i = stack.findIndex((m) => m.handle === handle);
      if (i >= 0) stack.splice(i, 1);
      root.classList.add('is-leaving');
      const done = () => { root.remove(); };
      setTimeout(done, 220);
      try { o.onClose?.(); } catch (e) { console.error(e); }
      resolveClosed();
      if (!stack.length) flushQueue();
    },
  };
  stack.push({ handle, blocking, dismissable });
  // big blocking sheets (result, day report) own the screen: clear the toast stack for them
  if (blocking && (o.size === 'lg' || o.size === 'xl')) clearToasts();
  host.appendChild(root);
  requestAnimationFrame(() => root.classList.add('is-in'));
  return handle;
}

function flushQueue(): void {
  if (!waiting.length) return;
  setTimeout(() => {
    // a queued opener may decide not to open anything (stale level up, day already closed): keep going
    while (!stack.length && waiting.length) {
      const next = waiting.shift()!;
      try { next(); } catch (e) { console.error(e); }
    }
  }, 120);
}

/** Show `open` now if nothing is open, else when the stack empties. */
export function enqueue(open: () => void): void {
  if (!stack.length && !waiting.length) open();
  else waiting.push(open);
}

/** Confirm dialog. Resolves true when confirmed. */
export function confirmModal(o: { title: string; text: Child; confirm: string; cancel?: string; danger?: boolean; icon?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const yes = h('button.btn', { type: 'button', class: o.danger ? 'btn-danger' : 'btn-primary' }, o.confirm);
    const no = h('button.btn.btn-ghost', { type: 'button' }, o.cancel ?? 'Cancel');
    const m = openModal({
      title: o.title,
      icon: o.icon ?? (o.danger ? 'alert' : 'info'),
      body: h('p.confirm-text', o.text),
      actions: [no, yes],
      size: 'sm',
      cls: o.danger ? 'modal-danger' : '',
      onClose: () => { if (!answered) resolve(false); },
    });
    yes.addEventListener('click', () => { answered = true; sfx('ui_click'); resolve(true); m.close(); });
    no.addEventListener('click', () => { answered = true; sfx('ui_click'); resolve(false); m.close(); });
  });
}
