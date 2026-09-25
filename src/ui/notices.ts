// Key event notices (owner follow-up): someone quits, asks for a raise the owner has to answer, can pick a
// perk, or a patient sits in your chair while you look elsewhere. Each one holds the clock until Resume.
// One notice at a time; the rest wait in a queue (src/ui/pause.ts NoticeQueue), never stacked.
import { money } from '../core/format';
import { store } from '../core/store';
import type { Clinic, Staff } from '../core/types';
import { ROLES } from '../data/staff';
import * as sim from '../sim';
import { currentScreen, go } from './app';
import { caseChip } from './casebits';
import { h } from './dom';
import { sfx } from './fx';
import { act, activeClinic } from './game';
import { icon } from './icons';
import { moodFromPatient, noDash } from './logic';
import { enqueue, modals, openModal, type ModalHandle } from './modal';
import { staffPanelIntent } from './panels/staff';
import { autoRaiseOn, NoticeQueue, raisePct, setGameSettings, type Notice, type NoticeItem, type NoticeKind } from './pause';
import { patientPortrait, staffPortrait } from './portrait';
import { quoteRaiseAll, summarizeRaiseAll } from './raiseall';
import { attempt } from './safe';
import { perkChooser, raiseAllFlow } from './staffcard';
import { toast } from './toasts';
import { btn, chip, toggle } from './widgets';

const queue = new NoticeQueue();
let handle: ModalHandle | null = null;
let scheduled = false;
/** The answer opened a panel: the next notice waits until the hub is back in view. */
let deferRest = false;

/** A key event notice is on screen (the clock is held until Resume). */
export function noticeOpen(): boolean {
  return !!handle;
}

export function noticesWaiting(): number {
  return queue.size;
}

let batching = 0;

/** Queue a notice item. It shows once no other modal is open; items of the same kind share one notice. */
export function notify(kind: NoticeKind, item: NoticeItem): void {
  if (!queue.push(kind, item)) return;
  if (!batching) schedule();
}

/** Collect the notices of one event batch (three raise requests at the close) into one notice each. */
export function batchNotices(fn: () => void): void {
  batching++;
  try { fn(); } finally {
    batching--;
    if (!batching && queue.size) schedule();
  }
}

function schedule(): void {
  if (handle || scheduled) return;
  scheduled = true;
  enqueue(() => { scheduled = false; showNext(); });
}

/** Hub frame, nothing covering the clinic: show a notice that waited for a panel to close. */
export function pumpNotices(): void {
  if (handle || scheduled || !queue.size) return;
  showNext();
}

/** Leaving the hub (title screen, new game): drop everything. */
export function clearNotices(): void {
  queue.clear();
  scheduled = false;
  const m = handle;
  handle = null;
  m?.close();
}

function panelOpen(): boolean {
  return document.documentElement.classList.contains('panel-open');
}

function clinicOf(id: string): { clinic: Clinic; index: number } | null {
  if (!store.loaded) return null;
  const i = store.state.locations.findIndex((c) => c.id === id);
  return i >= 0 ? { clinic: store.state.locations[i], index: i } : null;
}

function staffOf(it: NoticeItem): { clinic: Clinic; index: number; staff: Staff } | null {
  const f = clinicOf(it.clinicId);
  const st = f?.clinic.staff.find((x) => x.id === it.id);
  return f && st ? { ...f, staff: st } : null;
}

function relevant(kind: NoticeKind, it: NoticeItem): boolean {
  if (!store.loaded) return false;
  switch (kind) {
    case 'quit': return true;
    case 'raise': {
      const f = staffOf(it);
      return !!f && f.staff.salary < f.staff.ask && f.staff.tempUntilDay == null;
    }
    case 'perk': return !!staffOf(it)?.staff.pendingPerks?.length;
    case 'chair': {
      const p = clinicOf(it.clinicId)?.clinic.patients.find((x) => x.id === it.id);
      if (!p || !p.awaitingPlayer || p.state !== 'inChair') return false;
      const here = activeClinic(store.state);
      return !here || here.id !== it.clinicId || panelOpen();
    }
    default: return false;
  }
}

function showNext(): void {
  // never over the hands-on clean (the hub frame shows it once the clinic is back)
  if (handle || !store.loaded || currentScreen()?.name !== 'hub' || document.documentElement.classList.contains('is-cleaning')) return;
  const n = queue.next(relevant);
  if (!n) return;
  deferRest = false;
  sfx('notify');
  const m = openNotice(n);
  handle = m;
  m.closed.then(() => {
    if (handle !== m) return;
    handle = null;
    queue.done();
    // straight into the next one (ahead of queued sheets like the huddle); an answer that opened a panel
    // leaves the rest for when the clinic is back in view (hub frame, pumpNotices)
    if (deferRest || !queue.size) return;
    if (modals.count) schedule();
    else showNext();
  });
}

/** Show that location before acting on it. */
function toClinic(id: string): void {
  const f = clinicOf(id);
  if (!f || !store.loaded || store.state.phase !== 'owner' || f.index === store.state.active) return;
  attempt(() => sim.setActive(store.state, f.index), undefined, 'setActive');
  store.commit();
}

const firstName = (name: string | undefined) => (name ?? '').split(' ')[0] || 'Someone';
/** The pay policy approves asks up to this much above the salary (sim AUTO_RAISE_MAX). */
const AUTO_RAISE = 0.15;

interface Built { icon: string; eyebrow: string; title: string; body: HTMLElement; actions: HTMLElement[]; extra?: HTMLElement | null }

function openNotice(n: Notice): ModalHandle {
  const s = store.state;
  const multi = s.locations.length > 1;
  const places = [...new Set(n.items.map((it) => it.clinicId))];
  const where = places.length === 1 ? clinicOf(places[0])?.clinic.name ?? '' : `${places.length} locations`;
  let m: ModalHandle | null = null;
  const close = () => { m?.close(); };
  const built: Built = n.kind === 'quit' ? quitNotice(n.items, multi, close)
    : n.kind === 'raise' ? raiseNotice(n.items, multi, close)
      : n.kind === 'perk' ? perkNotice(n.items, close, (t, e) => { titleEl()?.replaceChildren(t); eyebrowEl()?.replaceChildren(e); })
        : chairNotice(n.items[0], close);
  const more = queue.size;
  const resume = btn('Resume', { variant: built.actions.length ? 'ghost' : 'primary', icon: 'playFill', class: 'notice-resume', onClick: close });
  const foot = h('div.notice-foot',
    built.extra ?? null,
    h('div.notice-foot-row',
      h('span.notice-paused', icon('pause'), more ? `Paused · ${more} more` : 'Paused'),
      h('div.notice-btns', resume, ...built.actions),
    ),
  );
  m = openModal({
    icon: built.icon,
    eyebrow: built.eyebrow || where,
    title: built.title,
    body: built.body,
    actions: [foot],
    size: n.kind === 'perk' || n.items.length > 1 ? 'md' : 'sm',
    cls: `modal-notice notice-${n.kind}${n.kind === 'perk' ? ' modal-perk' : ''}`,
    dismissable: true,
    backdropClose: false,
    closeButton: false,
  });
  // Enter or Space resumes (the hub leaves those keys to an open modal)
  requestAnimationFrame(() => { if (m?.open) resume.focus({ preventScroll: true }); });
  const titleEl = () => m?.el.querySelector('.modal-title');
  const eyebrowEl = () => m?.el.querySelector('.modal-head .eyebrow');
  return m;
}

// ---------------------------------------------------------------- quit

function quitNotice(items: NoticeItem[], multi: boolean, close: () => void): Built {
  const title = items.length === 1 ? `${firstName(items[0].name)} quit` : `${items.length} people quit`;
  const rows = items.map((it) => {
    const c = clinicOf(it.clinicId)?.clinic;
    return h('div.notice-row', h('div.notice-row-icon.is-bad', icon('door')),
      h('div.grow', h('b', it.name ?? 'A team member'), h('div.small.muted', c ? `Left ${c.name}` : 'Left the team')));
  });
  const hire = btn('Hire board', {
    variant: 'primary', icon: 'userPlus',
    onClick: () => {
      toClinic(items[0].clinicId);
      deferRest = true;
      close();
      staffPanelIntent('hire');
      go('staff');
    },
  });
  return {
    icon: 'door',
    eyebrow: '',
    title,
    body: h('div.notice-body', ...rows, h('p.small.muted', multi ? 'Hire replacements on the hire board of each location.' : 'Hire a replacement on the hire board.')),
    actions: [hire],
  };
}

// ---------------------------------------------------------------- raise

function raiseNotice(items: NoticeItem[], multi: boolean, close: () => void): Built {
  const list = h('div.notice-body');
  const rows: { it: NoticeItem; idx: number; settle: (quiet: boolean) => boolean; markRaised: () => void }[] = [];
  let open = 0;
  const settled = () => { open--; if (open <= 0) setTimeout(close, 450); };
  for (const it of items) {
    const f = staffOf(it);
    if (!f) continue;
    open++;
    const st = f.staff;
    const idx = f.index;
    const pct = raisePct(st.salary, st.ask);
    const row = h('div.notice-row', { 'data-staff': st.id },
      staffPortrait(st, 44, '', ROLES[st.role].scrubs),
      h('div.grow',
        h('b', st.name),
        h('div.small.muted', `${money(st.salary)} now, asks ${money(st.ask)} a day${pct ? ` (${pct})` : ''}`),
        multi ? h('div.tiny.faint', f.clinic.name) : null,
      ),
    );
    let done = false;
    const markRaised = () => {
      if (done) return;
      done = true;
      raise.replaceWith(chip('Raised', 'mint', 'check'));
      settled();
    };
    const settle = (quiet: boolean): boolean => {
      const cur = staffOf(it)?.staff;
      if (done || !cur) return false;
      const ok = act(() => sim.setSalary(store.state, idx, cur.id, cur.ask), quiet
        ? { sound: null, success: '', quietFail: true }
        : { sound: 'cash', success: `${firstName(cur.name)} is happy with the raise` });
      if (!ok) return false;
      markRaised();
      return true;
    };
    const raise = btn('Raise', { variant: 'sun', size: 'sm', icon: 'trendUp', sub: `+${money(st.ask - st.salary)}/day`, sound: null, onClick: () => { settle(false); } });
    row.appendChild(raise);
    list.appendChild(row);
    rows.push({ it, idx, settle, markRaised });
  }
  // Payroll Day: raise everyone below their ask across this notice's location(s) in one tap, next to the
  // individual raise buttons above (DESIGN 8.5 raise rules, 10.6).
  const s0 = store.state;
  let raiseAllBtn: HTMLElement | null = null;
  if (s0.player.skills.includes('payrollDay')) {
    const clinicIds = [...new Set(items.map((it) => it.clinicId))];
    const scope: number | 'all' = clinicIds.length === 1 ? (clinicOf(clinicIds[0])?.index ?? 'all') : 'all';
    const q = quoteRaiseAll(sim, s0, scope);
    if (q && q.ok) {
      const sum = summarizeRaiseAll(q, s0.player.skills.includes('hardBargain'));
      raiseAllBtn = btn('Raise all', {
        variant: 'sun', icon: 'trendUp', sub: sum.subLabel, sound: null,
        onClick: () => { void raiseAllFlow(scope, 'Raise all').then((ok) => { if (ok) rows.forEach((r) => r.markRaised()); }); },
      });
    }
  }
  const st0 = staffOf(items[0])?.staff;
  const title = items.length === 1 ? `${firstName(st0?.name ?? items[0].name)} asks for a raise` : `${items.length} raise requests`;
  const auto = h('div.notice-opt',
    toggle(autoRaiseOn(store.state), (v) => {
      if (!store.loaded) return;
      setGameSettings(store.state, { autoRaise: v });
      store.commit();
      if (!v) return;
      // the policy covers these requests too: approve the ones within 15% now
      let n = 0;
      for (const r of rows) {
        const cur = staffOf(r.it)?.staff;
        if (cur && cur.ask <= cur.salary * (1 + AUTO_RAISE) && r.settle(true)) n++;
      }
      if (n) { sfx('cash'); toast({ text: n === 1 ? 'Raise approved' : `${n} raises approved`, kind: 'good', icon: 'trendUp', key: 'act' }); }
    }, 'Approve raises up to 15%'),
    h('span.grow', h('b', 'Approve raises up to 15%'), h('span.tiny.faint', 'At the end of each day. An Office Manager does this at their location either way.')),
  );
  return { icon: 'trendUp', eyebrow: '', title, body: list, actions: raiseAllBtn ? [raiseAllBtn] : [], extra: auto };
}

// ---------------------------------------------------------------- perk

function perkNotice(items: NoticeItem[], close: () => void, retitle: (title: string, eyebrow: string) => void): Built {
  const body = h('div.notice-body');
  let first = true;
  let title = '';
  let eyebrow = '';
  const paint = () => {
    const f = items.map(staffOf).find((x) => !!x?.staff.pendingPerks?.length) ?? null;
    if (!f) { close(); return; }
    const st = f.staff;
    title = `${st.name} leveled up`;
    eyebrow = f.clinic.name;
    if (!first) retitle(title, eyebrow);
    first = false;
    body.replaceChildren(
      h('div.row.gap-14', staffPortrait(st, 64, '', ROLES[st.role].scrubs),
        h('div.grow', h('div.bold', `${ROLES[st.role].name}, level ${st.level}`), h('div.small.muted', 'Pick one. The other one is gone for good.'))),
      perkChooser(f.index, st, () => setTimeout(paint, 380)) ?? h('div'),
      h('div.tiny.faint', 'Not picked in 2 days: the first one is chosen.'),
    );
  };
  paint();
  return { icon: 'sparkle', eyebrow, title, body, actions: [] };
}

// ---------------------------------------------------------------- chair

function chairNotice(it: NoticeItem, close: () => void): Built {
  const f = clinicOf(it.clinicId);
  const p = f?.clinic.patients.find((x) => x.id === it.id) ?? null;
  const here = store.loaded ? activeClinic(store.state) : null;
  const same = !!here && here.id === it.clinicId;
  const go2 = btn(same ? 'Go to your chair' : `Go to ${f?.clinic.name ?? 'the chair'}`, {
    variant: 'primary', icon: same ? 'chair' : 'pin',
    onClick: () => { toClinic(it.clinicId); close(); go('clinic'); },
  });
  return {
    icon: 'chair',
    eyebrow: f?.clinic.name ?? '',
    title: 'A patient is waiting in your chair',
    body: h('div.notice-body',
      p ? h('div.notice-row', patientPortrait(p, moodFromPatient(p), 52),
        h('div.grow', h('b', p.name), h('div.row.row-wrap.gap-6', caseChip(p.caseType)))) : null,
      h('p.small.muted', noDash(same ? 'Their patience runs down while you are away.' : `Your chair at ${f?.clinic.name ?? 'another location'}. Their patience runs down while you look elsewhere.`)),
    ),
    actions: [go2],
  };
}
