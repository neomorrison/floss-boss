// "Your chair" card: the patient waiting for the player, with Clean and Quick clean.
import { clock } from '../core/format';
import { store } from '../core/store';
import type { DayPatient } from '../core/types';
import { ARCHETYPES } from '../data/patients';
import { SERVICES } from '../data/services';
import * as sim from '../sim';
import { h } from './dom';
import { activeClinic, isOwner } from './game';
import { icon } from './icons';
import { dirtLabel, moodFromPatient, nextPlayerAppointment } from './logic';
import { patientPortrait } from './portrait';
import { attempt } from './safe';
import { bar, btn, chip, setBar } from './widgets';

export interface ChairCardHandlers {
  clean(patientId: string): void;
  quick(patientId: string): void;
  openOp(opId: string): void;
}

export interface ChairCard { el: HTMLElement; frame(): void; dispose(): void }

export function createChairCard(hd: ChairCardHandlers): ChairCard {
  const el = h('div.chair-card.card');
  let key = '';
  let patienceBar: HTMLElement | null = null;
  let current: DayPatient | null = null;
  let t = 0;

  function frame(): void {
    if (!store.loaded) return;
    const s = store.state;
    if (s.phase === 'school') { el.style.display = 'none'; return; }
    // cheap throttle: queue lookups 6x a second
    const now = performance.now();
    if (now - t < 160 && key) { if (current && patienceBar) paintPatience(current); return; }
    t = now;
    const clinic = activeClinic(s);
    const queue = attempt(() => sim.playerQueue(s), [] as DayPatient[], 'playerQueue');
    const playerOp = clinic?.ops.find((o) => o.staffId === 'player') ?? null;
    const p = queue[0] ?? null;
    current = p;
    let k: string;
    if (p) k = `p|${p.id}|${queue.length}|${p.service}|${p.mood}`;
    else if (isOwner(s) && !playerOp) k = 'off';
    else if (isOwner(s) && playerOp?.playerMode === 'auto') k = `auto|${playerOp.id}|${playerOp.patientId}`;
    else {
      const next = nextPlayerAppointment(clinic);
      k = next ? `n|${next.id}|${next.state}|${s.dayOver}` : `none|${s.dayOver}`;
    }
    if (k === key) { if (p) paintPatience(p); return; }
    key = k;
    el.style.display = '';
    el.classList.toggle('is-ready', !!p);
    el.classList.toggle('is-compact', !p);
    patienceBar = null;
    if (p) renderPatient(p, queue.length);
    else if (k === 'off') renderInfo('chair', 'Off the floor', 'Tap an operatory to take a chair.');
    else if (k.startsWith('auto')) renderInfo('auto', 'Autopilot', 'Your chair runs on autopilot.', playerOp ? () => hd.openOp(playerOp.id) : undefined);
    else {
      const next = nextPlayerAppointment(clinic);
      if (s.dayOver) renderInfo('clock', 'Office closed', 'The day is wrapping up.');
      else if (!next) renderInfo('check', 'No more patients today', 'Your chair is free.');
      else if (next.state === 'scheduled') renderInfo('clock', `Next patient at ${clock(next.apptMin)}`, `${next.name}, ${ARCHETYPES[next.archetype]?.label ?? ''}`.replace(/, $/, ''));
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

  function renderPatient(p: DayPatient, count: number): void {
    const arch = ARCHETYPES[p.archetype];
    const d = dirtLabel(p.dirtLevel);
    patienceBar = bar(1, '', 'sm');
    el.replaceChildren(
      h('div.chair-head',
        h('span.eyebrow', 'Your chair'),
        count > 1 ? chip(`${count - 1} more waiting`, 'sun') : null,
      ),
      h('div.chair-body',
        patientPortrait(p, moodFromPatient(p), 64, 'chair-portrait'),
        h('div.grow',
          h('div.chair-name', p.name),
          h('div.row.row-wrap.gap-6',
            chip(arch?.label ?? p.archetype, 'teal'),
            p.service === 'deep' ? chip(SERVICES.deep.name, 'grape') : null,
            chip(`${d.label} gunk`, d.tone),
          ),
        ),
      ),
      h('div.chair-patience', h('span.tiny.bold.faint', 'Patience'), patienceBar),
      h('div.chair-actions',
        btn('Clean', { variant: 'primary', icon: 'hand', class: 'grow', onClick: () => hd.clean(p.id) }),
        btn('Quick clean', { variant: 'ghost', icon: 'auto', onClick: () => hd.quick(p.id) }),
      ),
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

  return { el, frame, dispose() { /* nothing global */ } };
}
