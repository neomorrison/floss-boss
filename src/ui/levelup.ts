// Level up modal: burst badge, new title, skill point reminder, newly unlocked skills.
import { store } from '../core/store';
import type { TwistId } from '../core/types';
import { CASE_ORDER, CASES, TWISTS } from '../data/cases';
import { SKILLS } from '../data/skills';
import { caseChip } from './casebits';
import { go } from './app';
import { h } from './dom';
import { confetti, sfx } from './fx';
import { playerTitle } from './game';
import { icon } from './icons';
import { enqueue, openModal } from './modal';
import { btn, chip } from './widgets';

let shownLevel = 0;

/** Show the level up modal once per level (queued behind any open modal). */
export function showLevelUp(level: number): void {
  if (level <= shownLevel) return;
  shownLevel = level;
  enqueue(() => open(level));
}

export function resetLevelUps(level = 0): void {
  shownLevel = level;
}

function open(level: number): void {
  if (!store.loaded) return;
  const s = store.state;
  const unlocked = SKILLS.filter((k) => k.minLevel === level);
  // patients who can now walk in with a new case or twist (employee phase picks cases by level)
  const newCases = CASE_ORDER.filter((c) => CASES[c].minLevel === level);
  const newTwists = (Object.keys(TWISTS) as TwistId[]).filter((t) => TWISTS[t].minLevel === level);
  const skillsBtn = btn('Skills', { variant: 'primary', icon: 'skills', onClick: () => { m.close(); go('skills'); } });
  const later = btn('Later', { variant: 'ghost', onClick: () => m.close() });
  const badge = h('div.lvl-burst',
    h('div.lvl-rays'),
    h('div.lvl-badge', h('span.lvl-badge-label', 'Level'), h('span.lvl-badge-num', String(level))),
  );
  const m = openModal({
    hero: badge,
    body: h('div.col.center.gap-14',
      h('h2', 'Level up'),
      h('div.lvl-title', playerTitle(s)),
      h('div.lvl-points', icon('skills'), h('span', s.player.skillPoints === 1 ? '1 skill point to spend' : `${s.player.skillPoints} skill points to spend`)),
      unlocked.length ? h('div.col.gap-6', h('div.eyebrow', 'New skills'), h('div.row.row-wrap', { style: 'justify-content:center' }, ...unlocked.map((k) => chip(k.name, 'mint', 'sparkle')))) : null,
      newCases.length && s.phase === 'employee' ? h('div.col.gap-6', h('div.eyebrow', 'New cases'), h('div.row.row-wrap', { style: 'justify-content:center' }, ...newCases.map((c) => caseChip(c)))) : null,
      newTwists.length && s.phase === 'employee' ? h('div.col.gap-6', h('div.eyebrow', 'New twists'), h('div.row.row-wrap', { style: 'justify-content:center' }, ...newTwists.map((t) => chip(TWISTS[t].name, 'grape', 'twist')))) : null,
    ),
    actions: [later, skillsBtn],
    size: 'sm',
    cls: 'modal-levelup',
  });
  sfx('level_up');
  requestAnimationFrame(() => confetti(badge, 80));
}
