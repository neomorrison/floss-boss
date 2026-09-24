// "Your chair" card: the patient waiting for the player with their case, twists and bonus, Clean and
// Quick clean (gated by Bronze mastery of the case, DESIGN 5.9). Owner phase: also finds a patient
// waiting in your chair at another location.
import { clock } from '../core/format';
import { store } from '../core/store';
import type { CaseType, Clinic, DayPatient, GameState } from '../core/types';
import { CASES } from '../data/cases';
import { ARCHETYPES } from '../data/patients';
import { SERVICES } from '../data/services';
import * as sim from '../sim';
import { CASE_TONE, bonusText, caseOf, caseTile, patientBonus, tierMedal, twistChips } from './casebits';
import { h, replace, replay } from './dom';
import { sfx } from './fx';
import { activeClinic, isOwner } from './game';
import { icon } from './icons';
import { masteryInfo, moodFromPatient, nextPlayerAppointment, quickCleanGate, waitingCount, type QuickGate } from './logic';
import { patientPortrait } from './portrait';
import { attempt } from './safe';
import { toast } from './toasts';
import { bar, btn, chip, setBar } from './widgets';

export interface ChairCardHandlers {
  /** clinicIndex: where the patient sits (-1 = the employer, else an index into state.locations). */
  clean(patientId: string, clinicIndex: number): void;
  quick(patientId: string, clinicIndex: number): void;
  openOp(opId: string): void;
}

export interface ChairCard { el: HTMLElement; frame(): void; pulse(): void; dispose(): void }

export interface WaitingPatient { p: DayPatient; clinicIndex: number; clinic: Clinic }

/** Patients waiting in the player's chair: the active clinic first, then (owner) other locations. */
export function playerWaiting(s: GameState): WaitingPatient[] {
  const out: WaitingPatient[] = [];
  const active = activeClinic(s);
  const activeIdx = s.phase === 'owner' ? s.active : -1;
  const queue = attempt(() => sim.playerQueue(s), [] as DayPatient[], 'playerQueue');
  if (active) for (const p of queue) out.push({ p, clinicIndex: activeIdx, clinic: active });
  if (s.phase === 'owner') {
    s.locations.forEach((c, i) => {
      if (c === active) return;
      for (const p of c.patients) if (p.awaitingPlayer && p.state === 'inChair') out.push({ p, clinicIndex: i, clinic: c });
    });
  }
  return out;
}

/** The Quick clean gate for a patient: the sim's quickCleanStatus, else Bronze mastery from the save. */
export function quickGate(s: GameState, p: Pick<DayPatient, 'id' | 'caseType'>): QuickGate {
  const own = quickCleanGate(s.player.mastery, caseOf(p.caseType));
  const r = attempt(() => sim.quickCleanStatus(s, p.id), null, 'quickCleanStatus');
  if (!r) return own;
  // ok also needs the patient to be ready in the chair (transient): the lock is about mastery only
  const count = Number.isFinite(r.count) ? r.count : own.count;
  const need = Number.isFinite(r.need) && r.need > 0 ? r.need : own.need;
  if (r.ok || count >= need) return { ok: true, count, need, label: '', reason: '' };
  const name = CASES[caseOf(p.caseType)].name;
  return {
    ok: false, count, need,
    label: `Bronze needed: ${Math.min(count, need)}/${need}`,
    reason: `Clean ${need} ${name} patients by hand with 3 stars or more to unlock Quick clean.`,
  };
}

/** A case type the player has not cleaned by hand yet (the sim marks case_seen_<type> after a hands-on clean). */
function isNewCase(s: GameState, ct: CaseType): boolean {
  // routine is what school teaches: never "new"
  return ct !== 'routine' && !s.flags?.[`case_seen_${ct}`] && !((s.player.mastery ?? {})[ct]! > 0);
}

export function createChairCard(hd: ChairCardHandlers): ChairCard {
  const el = h('div.chair-card.card');
  let key = '';
  let patienceBar: HTMLElement | null = null;
  let current: DayPatient | null = null;
  let t = 0;
  let busyTimer: ReturnType<typeof setTimeout> | null = null;

  function frame(): void {
    if (!store.loaded) return;
    const s = store.state;
    if (s.phase === 'school') { el.style.display = 'none'; return; }
    // cheap throttle: queue lookups 6x a second
    const now = performance.now();
    if (now - t < 160 && key) { if (current && patienceBar) paintPatience(current); return; }
    t = now;
    const clinic = activeClinic(s);
    const owner = isOwner(s);
    const waiting = playerWaiting(s);
    const playerOp = clinic?.ops.find((o) => o.staffId === 'player') ?? null;
    const w = waiting[0] ?? null;
    const p = w?.p ?? null;
    current = p;
    let k: string;
    if (w && p) {
      const gate = quickGate(s, p);
      k = `p|${p.id}|${w.clinicIndex}|${waiting.length}|${p.service}|${p.mood}|${p.caseType}|${(p.twists ?? []).join(',')}|${gate.ok}|${gate.count}`;
    } else if (owner && !playerOp) k = 'off';
    else if (owner && playerOp?.playerMode === 'auto') k = `auto|${playerOp.id}|${playerOp.patientId}`;
    else {
      const next = nextPlayerAppointment(clinic, owner);
      k = next ? `n|${next.id}|${next.state}|${s.dayOver}|${owner ? waitingCount(clinic) : 0}` : `none|${s.dayOver}`;
    }
    if (k === key) { if (p) paintPatience(p); return; }
    key = k;
    el.style.display = '';
    el.classList.toggle('is-ready', !!p);
    el.classList.toggle('is-compact', !p);
    el.classList.remove(...Array.from(el.classList).filter((c) => c.startsWith('tone-')));
    patienceBar = null;
    if (w && p) {
      el.classList.add(`tone-${CASE_TONE[caseOf(p.caseType)]}`);
      renderPatient(w, waiting.length);
    } else if (k === 'off') renderInfo('chair', 'Off the floor', 'Tap an operatory to take a chair.');
    else if (k.startsWith('auto')) renderInfo('auto', 'Autopilot', 'Your chair runs on autopilot.', playerOp ? () => hd.openOp(playerOp.id) : undefined);
    else {
      const next = nextPlayerAppointment(clinic, owner);
      const inRoom = owner ? waitingCount(clinic) : 0;
      if (s.dayOver) renderInfo('clock', 'Office closed', 'The day is wrapping up.');
      else if (!next) renderInfo('check', 'No more patients today', 'Your chair is free.');
      else if (inRoom > 0) renderInfo('user', inRoom === 1 ? '1 patient waiting' : `${inRoom} patients waiting`, 'The next one takes the first free chair.');
      else if (next.state === 'scheduled') renderInfo('clock', `Next patient at ${clock(next.apptMin)}`, owner ? 'Your chair is free.' : `${next.name}, ${ARCHETYPES[next.archetype]?.label ?? ''}`.replace(/, $/, ''));
      else renderInfo('user', `${next.name} is on the way`, next.state === 'toChair' ? 'Walking to your chair' : 'Checking in');
    }
  }

  function paintPatience(p: DayPatient): void {
    if (!patienceBar) return;
    // the sim scales waitedMin for seated patients, so waitedMin / patience is the true fraction used
    const frac = 1 - Math.min(1, p.waitedMin / Math.max(1, p.patience));
    setBar(patienceBar, frac);
    patienceBar.classList.toggle('coral', frac < 0.3);
    patienceBar.classList.toggle('sun', frac >= 0.3 && frac < 0.6);
  }

  function renderPatient(w: WaitingPatient, count: number): void {
    const s = store.state;
    const p = w.p;
    const ct = caseOf(p.caseType);
    const def = CASES[ct];
    const arch = ARCHETYPES[p.archetype];
    const gate = quickGate(s, p);
    const elsewhere = w.clinic !== activeClinic(s);
    const bonus = bonusText(patientBonus(p));
    const tier = masteryInfo(s.player.mastery?.[ct] ?? 0).tier;
    patienceBar = bar(1, '', 'sm');

    const cleanBtn = btn('Clean', { variant: 'primary', icon: 'hand', class: 'grow', onClick: () => { lock(); hd.clean(p.id, w.clinicIndex); } });
    let quickBtn: HTMLButtonElement;
    if (gate.ok) {
      quickBtn = btn('Quick clean', { variant: 'ghost', icon: 'auto', sub: isOwner(s) ? 'No tip, no XP' : 'Half pay, no XP', onClick: () => { lock(); hd.quick(p.id, w.clinicIndex); } });
    } else {
      quickBtn = btn('Quick clean', { variant: 'ghost', icon: 'lock', sub: gate.label, class: 'is-locked', sound: null, title: gate.reason });
      quickBtn.setAttribute('aria-disabled', 'true');
      quickBtn.addEventListener('click', () => {
        sfx('ui_click');
        replay(quickBtn, 'anim-shake');
        toast({ text: gate.label, sub: gate.reason, kind: 'info', icon: 'lock', key: 'quick-lock', ms: 5200 });
      });
    }
    const buttons = [cleanBtn, quickBtn];
    function lock(): void {
      buttons.forEach((b) => { b.disabled = true; b.classList.add('is-busy'); });
      // if the patient is still here after the action (failed, or the clean was cancelled), rebuild
      if (busyTimer) clearTimeout(busyTimer);
      busyTimer = setTimeout(() => { busyTimer = null; key = ''; }, 900);
    }

    replace(el,
      h('div.chair-case',
        caseTile(ct, 42),
        h('div.grow',
          h('div.eyebrow', elsewhere ? `Your chair at ${w.clinic.name}` : 'Your chair'),
          h('div.chair-case-name', def.name, tier > 0 ? tierMedal(tier, 22, 'chair-tier') : null),
          h('div.chair-case-blurb', def.blurb),
        ),
        count > 1 ? chip(`${count - 1} more`, 'sun') : isNewCase(s, ct) ? chip('New case', 'gum', 'sparkle') : null,
      ),
      h('div.chair-body',
        patientPortrait(p, moodFromPatient(p), 56, 'chair-portrait'),
        h('div.grow',
          h('div.chair-name', p.name),
          h('div.row.row-wrap.gap-6',
            chip(arch?.label ?? p.archetype, 'teal'),
            p.service === 'deep' && ct !== 'deep' ? chip(SERVICES.deep.name, 'grape') : null,
            ...twistChips(p.twists),
          ),
        ),
      ),
      bonus ? h('div.chair-bonus', icon('star'), h('span', h('b', 'Bonus'), ` ${bonus}`)) : null,
      h('div.chair-patience', h('span.tiny.bold.faint', 'Patience'), patienceBar),
      h('div.chair-actions', ...buttons),
    );
    paintPatience(p);
  }

  function renderInfo(iconName: string, title: string, text: string, onClick?: () => void): void {
    el.replaceChildren(
      h('div.chair-info',
        h('div.chair-info-icon', icon(iconName)),
        h('div.grow', h('div.eyebrow', 'Your chair'), h('div.chair-info-title', title), h('div.small.muted', text)),
        onClick ? btn(null, { variant: 'ghost', size: 'sm', icon: 'chevronRight', title: 'Operatory', onClick }) : null,
      ),
    );
  }

  return {
    el,
    frame,
    pulse() { replay(el, 'anim-attn'); },
    dispose() { if (busyTimer) clearTimeout(busyTimer); },
  };
}
