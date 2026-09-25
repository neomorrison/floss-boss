// Hygiene school: two practicals on Dennis the Dummy, then the graduation card with Dr. Ruth Canal.
import { EMPLOYER_BOSS, EMPLOYER_NAME } from '../../core/constants';
import { store } from '../../core/store';
import type { CleanSetup, HandsOnPayout } from '../../core/types';
import * as sim from '../../sim';
import { go, type Screen } from '../app';
import { h } from '../dom';
import { confetti, music, sfx } from '../fx';
import { runClean } from '../handson';
import { icon } from '../icons';
import { openModal } from '../modal';
import { bossPortrait, patientPortrait } from '../portrait';
import { showCleanResult } from '../result';
import { attempt } from '../safe';
import { toast } from '../toasts';
import { btn, chip } from '../widgets';
import { titleBackdrop } from './title';

export const SCHOOL_FLAG = 'ui_school1';

export function schoolStep(): 1 | 2 {
  if (!store.loaded) return 1;
  const f = store.state.flags ?? {};
  return f[SCHOOL_FLAG] || f.school1 || f.schoolStep1 ? 2 : 1;
}

export function schoolScreen(): Screen {
  music('music_clinic');
  const wrap = h('div.school-wrap.scroll');
  const el = h('div.school-screen', titleBackdrop(), wrap);
  let busy = false;

  function render(): void {
    const step = schoolStep();
    const objectives: [string, string][] = [
      ['scaler', 'Pop the tartar on the marked teeth'],
      ['polisher', 'Polish off plaque and stains'],
      ['floss', 'Floss out the food'],
      ['rinse', 'Rinse, then suction the water'],
    ];
    const steps: HTMLElement[] = [];
    ['Practical 1', 'Practical 2', 'Graduation'].forEach((label, i) => {
      if (i) steps.push(h('i.school-line', { class: { 'is-done': i < step } }));
      steps.push(h('div.school-step', { class: { 'is-done': i + 1 < step, 'is-on': i + 1 === step } }, h('span.school-dot', i + 1 < step ? icon('check') : String(i + 1)), h('span', label)));
    });
    const start = btn(step === 1 ? 'Start practical' : 'Start practical 2', { variant: 'primary', size: 'lg', block: true, icon: 'hand', onClick: () => practical(step) });
    wrap.replaceChildren(h('div.card.school-card.anim-rise',
      h('div.row.row-between', h('div.eyebrow', 'Hygiene School'), chip(`Practical ${step} of 2`, 'teal', 'graduation')),
      h('h2', step === 1 ? 'Your first practical' : 'One more to graduate'),
      h('div.school-steps', ...steps),
      h('div.school-patient',
        patientPortrait({ name: 'Dennis', archetype: 'mannequin' }, 'neutral', 72, 'ring'),
        h('div', h('div.school-patient-name', 'Dennis the Dummy'), h('div.small.muted', 'Training dummy. Never flinches, never tips.')),
      ),
      h('ul.school-goals', ...objectives.map(([ic, t]) => h('li', h('span.school-goal-icon', icon(ic)), t))),
      start,
    ));
  }

  async function practical(step: 1 | 2): Promise<void> {
    if (busy || !store.loaded) return;
    const s = store.state;
    const setup = attempt(() => sim.schoolSetup(s, step), null as CleanSetup | null, 'schoolSetup');
    if (!setup) { sfx('error'); toast({ text: 'The practical room is not ready yet', kind: 'bad' }); return; }
    busy = true;
    const before = { level: s.player.level, xp: s.player.xp, cash: s.cash };
    const result = await runClean(setup);
    music('music_clinic');
    busy = false;
    if (result.quit === 'abort') return;
    const payout = attempt(() => sim.completeSchool(s, step, result), null as HandsOnPayout | null, 'completeSchool');
    if (!payout) { render(); return; }
    if (step === 1) s.flags[SCHOOL_FLAG] = true;
    store.commit({ saveNow: true });
    await showCleanResult({
      patient: setup.patient, result, payout, parSeconds: setup.parSeconds, before,
      after: { level: s.player.level, xp: s.player.xp, cash: s.cash },
      events: [], phase: 'school', ownedClinicIds: [], school: true,
      primaryLabel: step === 1 ? 'Next practical' : 'Graduate',
    });
    if (step === 1) render();
    else showGraduation();
  }

  render();
  return { name: 'school', el, dispose() { /* nothing */ } };
}

export function showGraduation(): void {
  // the first promotion (DESIGN 11.2): the title ribbon on the graduation card
  const hero = h('div.grad-hero',
    h('div.grad-cap', icon('graduation')),
    bossPortrait(132, 'grad-boss ring'),
    h('div.promo-ribbon.grad-ribbon', h('span', 'Staff Hygienist')),
  );
  const take = btn('Take the job', { variant: 'primary', size: 'lg', block: true, iconRight: 'arrowRight' });
  const m = openModal({
    hero,
    eyebrow: 'Hygiene School',
    title: 'You graduated',
    body: h('div.col.gap-14',
      h('div.speaker',
        h('div.grow',
          h('div.who', EMPLOYER_BOSS),
          h('div.bubble', 'Congratulations, graduate! I have a chair open at Bright Smiles Dental and a feeling you will fill it nicely. The pay is fair and the puns are free.'),
        ),
      ),
      h('div.grad-offer',
        h('div.grad-offer-icon', icon('office')),
        h('div', h('div.bold', EMPLOYER_NAME), h('div.small.muted', 'Staff Hygienist. Paid per patient, plus tips.')),
      ),
    ),
    actions: [take],
    size: 'md',
    dismissable: false,
    cls: 'modal-grad',
  });
  sfx('promotion');
  requestAnimationFrame(() => confetti(hero, 110));
  take.addEventListener('click', () => { sfx('ui_click'); m.close(); go('hub'); });
}
