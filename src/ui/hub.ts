// Hub: the clinic view full-bleed, the HUD over it, Your chair, nav, location tabs, panels, and the
// game loop (ARCHITECTURE "State flow"): tick with speed, emit sim:events, frame the view, update the HUD.
import { bus } from '../core/bus';
import { REAL_SEC_PER_GAME_MIN } from '../core/constants';
import { store } from '../core/store';
import type { DayReport, SimEvent } from '../core/types';
import * as clinicMod from '../clinic';
import type { ClinicView } from '../clinic';
import * as sim from '../sim';
import { layers, setPanelOpener, type PanelName, type Screen } from './app';
import { createBoard } from './board';
import { createChairCard } from './chair';
import { showDayReport } from './dayreport';
import { h } from './dom';
import { music, sfx } from './fx';
import { activeClinic, hint, isOwner, persist } from './game';
import { cleanPatient, isCleaning, quickCleanPatient, setHubBridge, type HubBridge } from './handson';
import { createHud } from './hud';
import { icon } from './icons';
import { enqueue, modals } from './modal';
import { openDeskCard, openOpPanel, openPatientCard, openAddOperatory } from './oppanel';
import { createPanelHost } from './panelhost';
import { createPracticeCard } from './practice';
import { attempt, tryRun } from './safe';
import { settings } from './settings';
import { openStaffCard } from './staffcard';

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
  };

  const chair = createChairCard({
    clean: (id) => cleanPatient(id, bridge),
    quick: (id) => quickCleanPatient(id, bridge),
    openOp: (id) => openOpPanel(id),
  });
  const practice = createPracticeCard();
  const panels = createPanelHost({ openOp: (id) => openOpPanel(id), openStaff: (id) => openStaffCard(id) });

  const navBtns = new Map<string, HTMLButtonElement>();
  const navBadges = new Map<string, HTMLElement>();
  const nav = h('nav.dock', { 'aria-label': 'Main' });
  for (const item of NAV) {
    const badge = h('span.badge.dock-badge', { style: { display: 'none' } });
    const b = h('button.dock-btn', { type: 'button', 'data-id': item.id, 'aria-label': item.label },
      h('span.dock-icon', icon(item.icon), badge), h('span.dock-label', item.label)) as HTMLButtonElement;
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
  function mountView(): void {
    if (disposed || !el.isConnected) return;
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
  requestAnimationFrame(mountView);

  const offEvents = bus.on('sim:events', (events) => bridge.clinicEvents(events));

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
    nav.classList.toggle('is-owner', owner);
  }

  function syncLocTabs(): void {
    if (!store.loaded) return;
    const s = store.state;
    const key = `${s.phase}|${s.active}|${s.locations.map((c) => c.name + c.tier).join(',')}`;
    if (key === lastLocKey) return;
    lastLocKey = key;
    const show = isOwner(s) && s.locations.length > 1;
    locTabs.style.display = show ? '' : 'none';
    if (!show) { locTabs.replaceChildren(); return; }
    locTabs.replaceChildren(...s.locations.map((c, i) => {
      const b = h('button.loc-tab', { type: 'button', class: { 'is-on': i === s.active } }, icon('pin'), h('span.ellipsis', c.name));
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
      const report = attempt(() => sim.closeDay(st), null as DayReport | null, 'closeDay');
      if (!report) return;
      store.commit({ saveNow: true });
      sfx('day_end');
      showDayReport(report);
    });
  }

  // ---------------------------------------------------------------- frame
  let autosave = 0;
  let hintT = 0;
  function frame(dt: number): void {
    if (!store.loaded) return;
    const s = store.state;
    const cleaning = isCleaning();
    const paused = cleaning || modals.blocking || document.hidden;
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
  panels.onChange(() => syncNav());
  onState();

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
