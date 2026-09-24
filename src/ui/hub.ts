// Hub: the clinic view full-bleed, the HUD over it, Your chair, nav, location tabs, panels, and the
// game loop (ARCHITECTURE "State flow"): tick with speed, emit sim:events, frame the view, update the HUD.
import { bus } from '../core/bus';
import { REAL_SEC_PER_GAME_MIN } from '../core/constants';
import { store } from '../core/store';
import type { DayReport, SimEvent } from '../core/types';
import type { ClinicView } from '../clinic';
import * as sim from '../sim';
import { layers, setPanelOpener, type PanelName, type Screen } from './app';
import { createBoard } from './board';
import { createChairCard, playerWaiting } from './chair';
import { showDayReport } from './dayreport';
import { h } from './dom';
import { music, sfx } from './fx';
import { activeClinic, hint, isOwner, persist } from './game';
import { cleanPatient, isCleaning, quickCleanPatient, setHubBridge, type HubBridge } from './handson';
import { createHud } from './hud';
import { icon } from './icons';
import { enqueue, modals } from './modal';
import { toast } from './toasts';
import { openDeskCard, openOpPanel, openPatientCard, openAddOperatory } from './oppanel';
import { createPanelHost } from './panelhost';
import { createPracticeCard } from './practice';
import { attempt, tryRun } from './safe';
import { settings } from './settings';
import { openPerkChoice, openStaffCard } from './staffcard';
import { huddleOpen, queueHuddle, resumeHuddleIfDue } from './huddle';
import { huddleDue, perkOffers } from './mgr';
import { myDay, type MyDay } from './mgrlogic';

interface NavItem { id: PanelName | 'clinic'; label: string; icon: string; ownerOnly?: boolean }
const NAV: NavItem[] = [
  { id: 'clinic', label: 'Clinic', icon: 'clinic' },
  { id: 'tools', label: 'Tools', icon: 'tools' },
  { id: 'skills', label: 'Skills', icon: 'skills' },
  { id: 'staff', label: 'Staff', icon: 'staff', ownerOnly: true },
  { id: 'office', label: 'Office', icon: 'office', ownerOnly: true },
  { id: 'finance', label: 'Finance', icon: 'finance', ownerOnly: true },
  { id: 'goals', label: 'Goals', icon: 'goals' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function hubScreen(): Screen {
  music('music_clinic');
  const stage = h('div.hub-stage');
  const board = createBoard({
    onOp: (id) => openOpPanel(id),
    onEmpty: (slot) => openAddOperatory(slot),
    onPatient: (id) => openPatientCard(id),
  });
  const hud = createHud();
  const hintText = h('span');
  const hintEl = h('div.hub-hint', icon('bulb'), hintText);
  const locTabs = h('div.loc-tabs.scroll-x');
  let view: ClinicView | null = null;

  const bridge: HubBridge = {
    setClinicVisible(v) { if (view) attempt(() => view!.setVisible(v), undefined); el.classList.toggle('is-hidden-for-clean', !v); },
    clinicEvents(events) { if (view && events.length) attempt(() => view!.events(events), undefined); },
    focusOp(opId) { if (view) attempt(() => view!.focusOp(opId), undefined); },
    chairEl: () => chair.el,
    chairAttention: () => chairAttention(),
  };

  /** Show the clinic where the patient sits before starting (owner, chair at another location). */
  function switchTo(clinicIndex: number): void {
    const s = store.state;
    if (s.phase !== 'owner' || clinicIndex < 0 || clinicIndex === s.active) return;
    attempt(() => sim.setActive(s, clinicIndex), undefined, 'setActive');
    store.commit();
  }

  const chair = createChairCard({
    clean: (id, idx) => { switchTo(idx); void cleanPatient(id, bridge); },
    quick: (id, idx) => { switchTo(idx); quickCleanPatient(id, bridge); },
    openOp: (id) => openOpPanel(id),
  });

  /** A patient sat down in your chair: slow the clock to 1x so there is time to reach Clean, and pulse the card. */
  function chairAttention(): void {
    if (!store.loaded || isCleaning()) return;
    const s = store.state;
    if (s.phase === 'school' || s.dayOver) return;
    if (!playerWaiting(s).length) return;
    if (s.speed > 1) { s.speed = 1; store.commit(); }
    chair.pulse();
  }

  function onChairEvents(events: SimEvent[]): void {
    if (!store.loaded || isCleaning()) return;
    const s = store.state;
    const seated = events.filter((e): e is Extract<SimEvent, { type: 'awaitingPlayer' }> => e.type === 'awaitingPlayer');
    if (!seated.length) return;
    const here = activeClinic(s);
    const own = s.phase === 'owner' ? s.locations.map((c) => c.id) : [s.employer?.id ?? ''];
    const mine = seated.filter((e) => (here && e.clinicId === here.id) || own.includes(e.clinicId));
    if (!mine.length) return;
    chairAttention();
    const away = mine.find((e) => !here || e.clinicId !== here.id);
    if (!away && panels.current) {
      // the open panel covers the chair card: say it once, tap to get back to the chair
      sfx('notify');
      toast({ text: 'A patient is waiting in your chair', kind: 'info', icon: 'chair', key: 'chair-here', ms: 5000, onClick: () => { panels.open(null); syncNav(); } });
    }
    if (away && s.phase === 'owner') {
      const idx = s.locations.findIndex((c) => c.id === away.clinicId);
      if (idx >= 0) {
        sfx('notify');
        toast({ text: 'A patient is waiting in your chair', sub: s.locations[idx].name, kind: 'info', icon: 'chair', key: 'chair-away', ms: 5000, onClick: () => switchTo(idx) });
      }
    }
  }
  const practice = createPracticeCard();
  const panels = createPanelHost({ openOp: (id) => openOpPanel(id), openStaff: (id) => openStaffCard(id) });

  const navBtns = new Map<string, HTMLButtonElement>();
  const navBadges = new Map<string, HTMLElement>();
  const nav = h('nav.dock', { 'aria-label': 'Main' });
  for (const item of NAV) {
    const badge = h('span.badge.dock-badge', { style: { display: 'none' } });
    const b = h('button.dock-btn', { type: 'button', 'data-id': item.id, 'aria-label': item.label },
      h('span.dock-icon', icon(item.icon), badge), h('span.dock-label', item.label)) as HTMLButtonElement;
    if (item.id === 'clinic') badge.replaceChildren(icon('chair'));
    b.addEventListener('click', () => {
      sfx('ui_tab');
      if (item.id === 'clinic') panels.open(null);
      else panels.open(panels.current === item.id ? null : item.id);
      syncNav();
    });
    navBtns.set(item.id, b);
    navBadges.set(item.id, badge);
    nav.appendChild(b);
  }

  const el = h('div.hub',
    stage,
    board.el,
    h('div.hub-top', hud.el, h('div.hub-sub', locTabs, hintEl)),
    h('div.hub-bottom', chair.el, practice.el),
    panels.el,
    nav,
  );

  // ---------------------------------------------------------------- clinic view
  let disposed = false;
  async function mountView(): Promise<void> {
    if (disposed || !el.isConnected) return;
    // the 3D diorama is its own chunk (fetched early by the title screen)
    const clinicMod = await import('../clinic').catch((e: unknown) => { console.warn('[ui] clinic module', e); return null; });
    if (disposed || !el.isConnected) return;
    if (!clinicMod) { board.el.style.display = ''; return; }
    const r = tryRun(() => clinicMod.createClinicView(stage, {
      onOpClick: (opId) => openOpPanel(opId),
      onEmptySlotClick: (slot) => openAddOperatory(slot),
      onStaffClick: (id) => openStaffCard(id),
      onPatientClick: (id) => openPatientCard(id),
      onDeskClick: () => openDeskCard(),
    }));
    if (r.ok) {
      view = r.value;
      board.el.style.display = 'none';
      el.classList.add('has-view');
    } else {
      console.info('[ui] clinic view unavailable, using the board', r.error);
      view = null;
      board.el.style.display = '';
    }
  }
  requestAnimationFrame(() => { void mountView(); });

  const offEvents = bus.on('sim:events', (events) => { bridge.clinicEvents(events); onChairEvents(events); });

  // ---------------------------------------------------------------- sync (state changes)
  let lastLocKey = '';
  function syncNav(): void {
    if (!store.loaded) return;
    const s = store.state;
    const owner = isOwner(s);
    for (const item of NAV) {
      const b = navBtns.get(item.id)!;
      b.style.display = item.ownerOnly && !owner ? 'none' : '';
      b.classList.toggle('is-on', (panels.current ?? 'clinic') === item.id);
    }
    const setBadge = (id: string, n: number) => {
      const bd = navBadges.get(id)!;
      bd.textContent = n > 0 ? String(n) : '';
      bd.style.display = n > 0 ? '' : 'none';
    };
    setBadge('skills', s.player.skillPoints);
    setBadge('goals', s.goals.filter((g) => g.done && !g.claimed).length);
    setBadge('staff', owner ? perkOffers(s).length : 0);
    nav.classList.toggle('is-owner', owner);
  }

  /** Clinic button badge: a patient waits in your chair while a panel covers the chair card. */
  let clinicAttn = false;
  function syncClinicBadge(on: boolean): void {
    if (on === clinicAttn) return;
    clinicAttn = on;
    const bd = navBadges.get('clinic')!;
    bd.style.display = on ? '' : 'none';
    navBtns.get('clinic')!.classList.toggle('is-attn', on);
    bd.setAttribute('aria-label', on ? 'Patient waiting in your chair' : '');
  }

  /** New perk choices: say it once per staff member ("Ava leveled up: choose a perk"). */
  const perkSeen = new Set<string>();
  function syncPerks(): void {
    if (!store.loaded || !isOwner(store.state)) return;
    const offers = perkOffers(store.state);
    const ids = new Set(offers.map((o) => o.staff.id));
    for (const id of [...perkSeen]) if (!ids.has(id)) perkSeen.delete(id);
    let shown = 0;
    for (const o of offers) {
      if (perkSeen.has(o.staff.id)) continue;
      perkSeen.add(o.staff.id);
      if (shown++ >= 2) continue;
      sfx('notify', { volume: 0.6 });
      toast({ text: `${o.staff.name.split(' ')[0]} leveled up: choose a perk`, sub: o.clinic.name, kind: 'gold', icon: 'sparkle', key: `perk-${o.staff.id}`, ms: 6000, onClick: () => openPerkChoice(o.staff.id) });
    }
  }

  function syncLocTabs(): void {
    if (!store.loaded) return;
    const s = store.state;
    const waitingAt = new Set(isOwner(s) ? playerWaiting(s).map((w) => w.clinicIndex) : []);
    const key = `${s.phase}|${s.active}|${s.locations.map((c) => c.name + c.tier).join(',')}|${[...waitingAt].join(',')}`;
    if (key === lastLocKey) return;
    lastLocKey = key;
    const show = isOwner(s) && s.locations.length > 1;
    locTabs.style.display = show ? '' : 'none';
    if (!show) { locTabs.replaceChildren(); return; }
    locTabs.replaceChildren(...s.locations.map((c, i) => {
      const b = h('button.loc-tab', { type: 'button', class: { 'is-on': i === s.active }, title: c.name }, icon('pin'), h('span.ellipsis', c.name),
        waitingAt.has(i) && i !== s.active ? h('span.badge.loc-badge', { 'aria-label': 'Patient waiting in your chair' }, icon('chair')) : null);
      b.addEventListener('click', () => {
        if (i === store.state.active) return;
        sfx('ui_tab');
        attempt(() => sim.setActive(store.state, i), undefined, 'setActive');
        store.commit();
      });
      return b;
    }));
  }

  function onState(): void {
    if (!store.loaded) return;
    hintT = Math.min(hintT, 0.1);
    hud.sync();
    syncNav();
    syncLocTabs();
    practice.sync();
    panels.onState();
    board.sync();
    syncPerks();
  }

  // ---------------------------------------------------------------- day end
  let reportForDay = -1;
  function checkDayOver(): void {
    const s = store.state;
    if (!s.dayOver || reportForDay === s.day || isCleaning()) return;
    reportForDay = s.day;
    enqueue(() => {
      const st = store.state;
      if (!st.dayOver) return;
      // the employee report shows your own shift: read it before closeDay books tomorrow
      const mine: MyDay | null = st.phase === 'employee' && st.employer ? myDay(st.employer.patients) : null;
      // Paperwork Pro files finished goals at the close without a word: list them on the report
      const autoClaimed = (st.player.skills as string[]).includes('paperworkPro') ? st.goals.filter((g) => g.done && !g.claimed).map((g) => g.text) : [];
      const report = attempt(() => sim.closeDay(st), null as DayReport | null, 'closeDay');
      if (!report) return;
      store.commit({ saveNow: true });
      sfx('day_end');
      // events raised while closing (achievements, level ups) show once the report is dismissed,
      // then the owner's Morning Huddle
      void showDayReport(report, { mine, autoClaimed }).then(() => {
        const ev = report.events ?? [];
        if (ev.length) bus.emit('sim:events', ev);
        if (store.loaded && store.state.phase === 'owner') queueHuddle();
      });
    });
  }

  // ---------------------------------------------------------------- frame
  let autosave = 0;
  let hintT = 0;
  let attnT = 0;
  let huddleT = 0.4;
  let waitingMine = false;
  function frame(dt: number): void {
    if (!store.loaded) return;
    const s = store.state;
    const cleaning = isCleaning();
    // a panel pauses the clock in the employee phase (it is someone else's clinic), and for owners while a
    // patient waits in your chair (the panel covers the chair card)
    attnT -= dt;
    if (attnT <= 0) {
      attnT = 0.25;
      waitingMine = !cleaning && s.phase !== 'school' && !s.dayOver && playerWaiting(s).length > 0;
      syncClinicBadge(!!panels.current && waitingMine);
    }
    const panelPause = !!panels.current && (s.phase === 'employee' || waitingMine);
    // the sim opens the doors by itself if the clock runs before the Morning Huddle: hold it, and bring the
    // huddle back if nothing is showing it (reload, a modal that closed in between)
    const huddleHold = !cleaning && huddleDue(s);
    if (huddleHold && !modals.count && !huddleOpen()) { huddleT -= dt; if (huddleT <= 0) { huddleT = 0.6; queueHuddle(); } }
    const paused = cleaning || modals.blocking || document.hidden || panelPause || huddleHold;
    if (!paused && !s.dayOver && s.speed > 0 && s.phase !== 'school') {
      const minutes = (dt / REAL_SEC_PER_GAME_MIN) * s.speed;
      const events = attempt(() => sim.tick(s, minutes), [] as SimEvent[], 'tick');
      if (events.length) bus.emit('sim:events', events);
    }
    if (s.dayOver) checkDayOver();
    if (!cleaning) {
      const c = activeClinic(s);
      if (view && c) attempt(() => view!.frame(c, s.minute, dt), undefined, 'view.frame');
      else if (!view) board.frame(dt);
      hud.frame(dt, paused);
      chair.frame();
    }
    hintT -= dt;
    if (hintT <= 0) {
      hintT = 1;
      const t = settings().showHints ? hint(s) : '';
      if (hintText.textContent !== t) hintText.textContent = t;
      hintEl.style.display = t ? '' : 'none';
    }
    autosave += dt;
    if (autosave >= 10) { autosave = 0; persist(); }
  }

  // ---------------------------------------------------------------- keys
  const onKey = (e: KeyboardEvent) => {
    if (!store.loaded || isCleaning()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const s = store.state;
    if (e.key === ' ') { e.preventDefault(); s.speed = s.speed === 0 ? 1 : 0; sfx('ui_tab'); store.commit(); }
    else if (e.key === '1' || e.key === '2' || e.key === '3') { s.speed = ([1, 2, 4] as const)[Number(e.key) - 1]; sfx('ui_tab'); store.commit(); }
    else if (e.key === 'Escape' && panels.current && !modals.count) { panels.open(null); syncNav(); }
  };
  window.addEventListener('keydown', onKey);

  setPanelOpener((p) => { panels.open(p); syncNav(); });
  setHubBridge(bridge);
  panels.onChange(() => { syncNav(); attnT = 0; });
  onState();
  // a huddle left open by a reload (or a fresh owner morning) comes back
  setTimeout(() => resumeHuddleIfDue(), 400);

  return {
    name: 'hub',
    el,
    frame,
    onState,
    dispose() {
      disposed = true;
      setPanelOpener(null);
      setHubBridge(null);
      window.removeEventListener('keydown', onKey);
      offEvents();
      panels.dispose();
      hud.dispose();
      chair.dispose();
      if (view) attempt(() => view!.dispose(), undefined);
      view = null;
      layers.handson.replaceChildren();
    },
  };
}
