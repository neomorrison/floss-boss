// Hands-on flow: mount the 3D clean full screen, await it, pay out through the sim, show the result.
import { bus } from '../core/bus';
import { money } from '../core/format';
import { store } from '../core/store';
import type { CleanResult, CleanSetup, HandsOnPayout, SimEvent } from '../core/types';
import * as clean from '../clean';
import * as sim from '../sim';
import { layers } from './app';
import { h } from './dom';
import { flyCoins, haptic, music, sfx } from './fx';
import { activeClinic } from './game';
import { cashDisplay } from './hud';
import { icon } from './icons';
import { showLevelUp } from './levelup';
import { noDash } from './logic';
import { patientPortrait } from './portrait';
import { showCleanResult } from './result';
import { attempt, tryRun } from './safe';
import { suppressToasts, toast } from './toasts';
import { btn, stars } from './widgets';

let cleaning = false;
export function isCleaning(): boolean {
  return cleaning;
}

let bridge: HubBridge | null = null;
/** The mounted hub registers itself so debug hooks and other flows can start a clean. */
export function setHubBridge(b: HubBridge | null): void {
  bridge = b;
}
export function hubBridge(): HubBridge | null {
  return bridge;
}

export interface HubBridge {
  setClinicVisible(v: boolean): void;
  clinicEvents(events: SimEvent[]): void;
  focusOp(opId: string | null): void;
  chairEl(): HTMLElement | null;
}

/**
 * Mount the clean scene full screen and resolve with its result. If the scene cannot start
 * (no WebGL), a calm card offers to go back; that resolves with quit 'abort'.
 */
export async function runClean(setup: CleanSetup, opts: { onQuick?: () => void } = {}): Promise<CleanResult> {
  cleaning = true;
  suppressToasts(true);
  const layer = h('div.handson');
  layers.handson.appendChild(layer);
  layers.handson.classList.add('is-on');
  document.documentElement.classList.add('is-cleaning');
  music('music_clean');
  const started = tryRun(() => clean.startClean(layer, setup));
  let result: CleanResult;
  if (started.ok) {
    const session = started.value;
    const onVis = () => { try { session.pause(document.hidden); } catch { /* ignore */ } };
    document.addEventListener('visibilitychange', onVis);
    try {
      result = await session.done;
    } catch (e) {
      console.error('[ui] clean failed', e);
      result = abortResult();
    }
    document.removeEventListener('visibilitychange', onVis);
    try { session.dispose(); } catch (e) { console.error(e); }
  } else {
    console.warn('[ui] clean scene unavailable', started.error);
    result = await fallbackCard(layer, setup, opts.onQuick);
  }
  layer.remove();
  layers.handson.classList.remove('is-on');
  document.documentElement.classList.remove('is-cleaning');
  suppressToasts(false);
  cleaning = false;
  return result;
}

function abortResult(): CleanResult {
  return { quit: 'abort', tartar: 0, plaque: 0, stain: 0, debris: 0, polish: 0, mess: 0, clean: 0, comfort: 0, quality: 0, stars: 1, seconds: 0, chunks: 0, bestCombo: 0, gumHits: 0, gags: 0, perfect: false };
}

function fallbackCard(layer: HTMLElement, setup: CleanSetup, onQuick?: () => void): Promise<CleanResult> {
  return new Promise((resolve) => {
    const back = btn('Back', { variant: 'ghost', icon: 'arrowLeft', onClick: () => resolve(abortResult()) });
    const quick = onQuick ? btn('Quick clean', { variant: 'primary', icon: 'auto', onClick: () => { resolve(abortResult()); setTimeout(onQuick, 50); } }) : null;
    layer.appendChild(h('div.handson-fallback',
      h('div.card.card-pad.handson-fallback-card',
        patientPortrait(setup.patient, 'neutral', 88, 'ring'),
        h('h3', setup.patient.name),
        h('p.muted', 'The 3D view could not start on this device.'),
        h('div.row.row-wrap', { style: 'justify-content:center' }, back, quick),
      ),
    ));
  });
}

function ownedIds(): string[] {
  return store.loaded ? store.state.locations.map((c) => c.id) : [];
}

/** Hands-on clean of a waiting patient from the hub. */
export async function cleanPatient(patientId: string, hub: HubBridge): Promise<void> {
  if (cleaning || !store.loaded) return;
  const s = store.state;
  const setup = attempt(() => sim.beginHandsOn(s, patientId), null as CleanSetup | null, 'beginHandsOn');
  if (!setup) { sfx('error'); toast({ text: 'This patient is not ready yet', kind: 'bad', key: 'clean' }); return; }
  const patient = { name: setup.patient.name, archetype: setup.patient.archetype };
  const opId = activeClinic(s)?.patients.find((p) => p.id === patientId)?.opId ?? null;
  sfx('ui_click');
  hub.setClinicVisible(false);
  const result = await runClean(setup, { onQuick: () => quickCleanPatient(patientId, hub) });
  hub.setClinicVisible(true);
  music('music_clinic');
  const before = { level: s.player.level, xp: s.player.xp, cash: s.cash };
  const out = attempt(() => sim.completeHandsOn(s, patientId, result), null as { payout: HandsOnPayout; events: SimEvent[] } | null, 'completeHandsOn');
  store.commit({ saveNow: true });
  if (!out) return;
  hub.clinicEvents(out.events);
  hub.focusOp(opId);
  if (result.quit === 'abort') {
    toast({ text: `${patient.name} is back in the chair`, kind: 'info', key: 'clean' });
    return;
  }
  const after = { level: s.player.level, xp: s.player.xp, cash: s.cash };
  await showCleanResult({
    patient, patientId, result, payout: out.payout, parSeconds: setup.parSeconds, before, after,
    events: out.events, phase: s.phase, ownedClinicIds: ownedIds(),
  });
  if (after.level > before.level) showLevelUp(after.level);
}

/** Quick clean: auto quality, compact result toast, coins to the counter. */
export function quickCleanPatient(patientId: string, hub: HubBridge): void {
  if (cleaning || !store.loaded) return;
  const s = store.state;
  const before = { level: s.player.level, cash: s.cash };
  const out = attempt(() => sim.quickClean(s, patientId), null as { payout: HandsOnPayout; events: SimEvent[] } | null, 'quickClean');
  if (!out) { sfx('error'); toast({ text: 'Quick clean is not available right now', kind: 'bad', key: 'clean' }); return; }
  store.commit();
  hub.clinicEvents(out.events);
  // notable events from the fast-forward window (no review or payment spam)
  const notable = out.events.filter((e) => e.type === 'goalDone' || e.type === 'achievement' || e.type === 'staffQuit' || e.type === 'raiseRequest' || e.type === 'walkout');
  if (notable.length) bus.emit('sim:events', notable);
  const p = out.payout;
  const gained = p.pay + p.tip + p.bonus;
  haptic(12);
  sfx('cash');
  toast({
    text: `Quick clean done`,
    sub: `+${money(gained)}  ·  +${Math.round(p.xp)} XP`,
    kind: 'gold',
    lead: h('div.toast-stars', stars(p.stars, 15)),
    key: 'quick',
  });
  p.lines.slice(0, 1).forEach((line) => toast({ text: noDash(line), kind: 'info', lead: h('div.toast-icon', icon('sparkle')) }));
  const from = hub.chairEl();
  const target = cashDisplay.target();
  if (from && target && gained > 0) {
    cashDisplay.hold(before.cash);
    const n = Math.max(3, Math.min(8, Math.round(gained / 30)));
    let paid = 0;
    flyCoins(from, target, n, (i, total) => {
      const amt = i === total - 1 ? gained - paid : gained / total;
      paid += amt;
      cashDisplay.add(amt);
    }).then(() => cashDisplay.release());
  }
  if (s.player.level > before.level) showLevelUp(s.player.level);
}
