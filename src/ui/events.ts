// SimEvent reactions: toasts for reviews, walkouts, goals, achievements; key event notices (quits, raise
// requests); level up modal; commits. Owner phase: reviews and walkouts only toast for the location on
// screen, the rest roll into a per-location tally on the location tabs (src/ui/pause.ts).
import { bus } from '../core/bus';
import { money } from '../core/format';
import { store } from '../core/store';
import type { SimEvent } from '../core/types';
import { go } from './app';
import { h } from './dom';
import { sfx } from './fx';
import { activeClinic } from './game';
import { showLevelUp } from './levelup';
import { modals } from './modal';
import { noDash } from './logic';
import { batchNotices, notify } from './notices';
import { autoPauseOn, onScreen, Tallies } from './pause';
import { toast } from './toasts';
import { stars } from './widgets';

let lastReviewToast = 0;
const COMMIT_ON = new Set<SimEvent['type']>(['levelUp', 'goalDone', 'achievement', 'staffQuit', 'raiseRequest', 'dayOver']);
const REFRESH_ON = new Set<SimEvent['type']>(['paid', 'review', 'walkout', 'awaitingPlayer', 'seated', 'cleaned']);

/** Payments, reviews and walkouts at owned locations off screen, since the player last looked at each. */
export const locationTally = new Tallies();

export function initEventReactions(): void {
  bus.on('sim:events', (events) => {
    let commit = false;
    let refresh = false;
    if (store.loaded && store.state.phase === 'owner' && store.state.locations.length > 1) {
      const here = activeClinic(store.state);
      if (locationTally.add(events, here?.id ?? null, store.state.locations.map((c) => c.id))) refresh = true;
    }
    // level ups open a modal: handle them after the toasts of the same batch
    const ordered = [...events.filter((e) => e.type !== 'levelUp'), ...events.filter((e) => e.type === 'levelUp')];
    // quits and raise requests of one batch (the day close) share a notice per kind
    batchNotices(() => {
      for (const e of ordered) {
        if (COMMIT_ON.has(e.type)) commit = true;
        if (REFRESH_ON.has(e.type)) refresh = true;
        react(e);
      }
    });
    if (commit) store.commit();
    else if (refresh) bus.emit('state:changed', undefined);
  });
  bus.on('toast', (t) => toast({ text: noDash(t.text), kind: t.kind ?? 'info' }));
}

/** An event from the location on screen (always true outside the owner phase). */
function here(clinicId: string): boolean {
  if (!store.loaded) return true;
  const s = store.state;
  return onScreen(s.phase, activeClinic(s)?.id, clinicId);
}

function react(e: SimEvent): void {
  switch (e.type) {
    case 'review': {
      // employee phase: reviews belong to Dr. Canal's office; yours show in the clean result
      if (store.loaded && store.state.phase !== 'owner') return;
      // other locations: counted on their tab and in the day report
      if (!here(e.clinicId) || modals.count) return;
      const now = performance.now();
      // keep the stack readable at 4x: at most one review toast every 2.5 s, always show 1-star and 5-star
      if (now - lastReviewToast < 2500 && e.stars > 1 && e.stars < 5) return;
      lastReviewToast = now;
      toast({
        text: `“${noDash(e.text)}”`,
        sub: e.name,
        kind: e.stars >= 4 ? 'good' : e.stars <= 2 ? 'bad' : 'info',
        lead: h('div.toast-stars', stars(e.stars, 14)),
        ms: 3200,
      });
      break;
    }
    case 'walkout': {
      const mine = isPlayerPatient(e.clinicId, e.patientId);
      if (store.loaded && store.state.phase !== 'owner' && !mine) return;
      // owner: only the location on screen, and your own chair wherever it is
      if (!here(e.clinicId) && !mine) return;
      const name = patientName(e.clinicId, e.patientId);
      const reason = e.reason === 'wait' ? 'Waited too long' : 'Too uncomfortable';
      const where = !here(e.clinicId) ? clinicName(e.clinicId) : '';
      toast({ text: `${name} walked out`, sub: where ? `${reason}, ${where}` : reason, kind: 'bad', icon: 'door', key: 'walkout-' + e.patientId });
      break;
    }
    case 'levelUp':
      showLevelUp(e.level);
      break;
    case 'goalDone':
      sfx('notify');
      toast({ text: 'Goal done', sub: noDash(e.text), kind: 'gold', icon: 'goals', onClick: () => go('goals'), ms: 4500 });
      break;
    case 'achievement':
      sfx('notify');
      toast({ text: `Achievement: ${e.name}`, kind: 'gold', icon: 'medal', onClick: () => go('goals'), ms: 4500 });
      break;
    case 'staffQuit':
      if (autoPauseOn(store.loaded ? store.state : null)) { notify('quit', { id: e.staffId, clinicId: e.clinicId, name: e.name }); break; }
      toast({ text: `${e.name} quit`, sub: 'Hire a replacement on the Staff screen', kind: 'bad', icon: 'door', onClick: () => go('staff'), ms: 5000 });
      break;
    case 'raiseRequest':
      if (autoPauseOn(store.loaded ? store.state : null)) { notify('raise', { id: e.staffId, clinicId: e.clinicId, name: e.name, ask: e.ask }); break; }
      toast({ text: `${e.name} asks for a raise`, sub: `${money(e.ask)} a day`, kind: 'info', icon: 'trendUp', onClick: () => go('staff'), ms: 5000 });
      break;
    case 'toast':
      toast({ text: noDash(e.text), kind: e.kind });
      break;
    default:
      break;
  }
}

function findPatient(clinicId: string, patientId: string) {
  if (!store.loaded) return null;
  const s = store.state;
  const c = [s.employer, ...s.locations].find((x) => x && x.id === clinicId);
  return c?.patients.find((p) => p.id === patientId) ?? null;
}
function clinicName(clinicId: string): string {
  if (!store.loaded) return '';
  return store.state.locations.find((c) => c.id === clinicId)?.name ?? '';
}
function patientName(clinicId: string, patientId: string): string {
  return findPatient(clinicId, patientId)?.name ?? 'A patient';
}
function isPlayerPatient(clinicId: string, patientId: string): boolean {
  const p = findPatient(clinicId, patientId);
  return !!p && (p.isPlayerPatient || p.staffId === 'player');
}
