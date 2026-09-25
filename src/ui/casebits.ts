// Case pieces shared by the chair card, the result modal, the patient card and the Cases tab:
// case icon tiles and badges, twist chips, mastery tier medals.
import type { BonusId, CaseType, DayPatient, TwistId } from '../core/types';
import { BONUSES, CASES, TWISTS } from '../data/cases';
import { h } from './dom';
import { sfx } from './fx';
import { icon } from './icons';
import { toast } from './toasts';

export type CaseTone = 'mint' | 'gum' | 'sky' | 'grape' | 'sun' | 'coral' | 'gold';

export const CASE_ICON: Record<CaseType, string> = {
  routine: 'caseRoutine', candy: 'caseCandy', whitening: 'caseWhitening', braces: 'caseBraces', pirate: 'casePirate', deep: 'caseDeep',
  grillz: 'caseGrillz',
};
export const CASE_TONE: Record<CaseType, CaseTone> = {
  routine: 'mint', candy: 'gum', whitening: 'sky', braces: 'grape', pirate: 'sun', deep: 'coral', grillz: 'gold',
};

/** Safe case lookup (old saves and unknown ids fall back to routine). */
export function caseOf(t: CaseType | undefined | null): CaseType {
  return t && CASES[t] ? t : 'routine';
}

export function caseName(t: CaseType | undefined | null): string {
  return CASES[caseOf(t)].name;
}

/** Tinted square tile with the case icon. */
export function caseTile(t: CaseType | undefined | null, size = 44, cls = ''): HTMLElement {
  const c = caseOf(t);
  return h('span.case-tile', { class: [`tone-${CASE_TONE[c]}`, cls], style: { '--cz': size + 'px' }, 'aria-hidden': 'true' }, icon(CASE_ICON[c]));
}

/** Chip with the case icon and name. */
export function caseChip(t: CaseType | undefined | null): HTMLElement {
  const c = caseOf(t);
  const tone = CASE_TONE[c] === 'gold' ? 'sun' : CASE_TONE[c];
  return h('span.chip.case-chip', { class: [`chip-${tone}`, { 'chip-gold': CASE_TONE[c] === 'gold' }] }, icon(CASE_ICON[c]), CASES[c].name);
}

/** Twist chips; a tap explains the twist (touch has no hover). */
export function twistChips(ids: TwistId[] | undefined | null): HTMLElement[] {
  return (ids ?? []).filter((id) => TWISTS[id]).map((id) => {
    const d = TWISTS[id];
    const b = h('button.chip.chip-btn.twist-chip', { type: 'button', title: d.text }, icon('twist'), d.name);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx('ui_click');
      toast({ text: d.name, sub: d.text, kind: 'info', icon: 'twist', key: 'twist' });
    });
    return b;
  });
}

export function bonusText(id: BonusId | null | undefined): string {
  return id && BONUSES[id] ? BONUSES[id].text : '';
}

/** Bonus a waiting patient carries, when the sim exposes it on DayPatient. */
export function patientBonus(p: DayPatient): BonusId | null {
  const b = (p as DayPatient & { bonus?: BonusId | null }).bonus;
  return b && BONUSES[b] ? b : null;
}

/** Round mastery medal: Unranked, Bronze, Silver, Gold. */
export function tierMedal(tier: number, size = 40, cls = ''): HTMLElement {
  const t = Math.max(0, Math.min(3, Math.round(tier)));
  return h('span.tier-medal', { class: [`tier-${t}`, cls], style: { '--mz': size + 'px' }, 'aria-hidden': 'true' }, icon(t ? 'star' : 'starLine'));
}
