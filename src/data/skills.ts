// Player skill tree. DESIGN 4.3. One point per level.
import type { SkillId } from '../core/types';

export type SkillBranch = 'technique' | 'bedside' | 'business';
export interface Skill { id: SkillId; branch: SkillBranch; name: string; text: string; requires: SkillId | null; minLevel: number }

export const SKILLS: Skill[] = [
  { id: 'steady1', branch: 'technique', name: 'Steady Hands I', text: 'Gum slips hurt 25% less.', requires: null, minLevel: 2 },
  { id: 'steady2', branch: 'technique', name: 'Steady Hands II', text: 'Gum slips hurt 50% less.', requires: 'steady1', minLevel: 5 },
  { id: 'power', branch: 'technique', name: 'Power Stroke', text: 'Scalers remove tartar 25% faster.', requires: null, minLevel: 2 },
  { id: 'polishPro', branch: 'technique', name: 'Polish Pro', text: 'Polisher 25% wider and faster.', requires: 'power', minLevel: 3 },
  { id: 'eagleEye', branch: 'technique', name: 'Eagle Eye', text: 'Leftover dirt pulses with an outline.', requires: 'polishPro', minLevel: 4 },
  { id: 'speedCleaner', branch: 'technique', name: 'Speed Cleaner', text: 'Par time +20%. Easier speed tips.', requires: 'eagleEye', minLevel: 6 },
  { id: 'calmingVoice', branch: 'bedside', name: 'Calming Voice', text: 'Reassure restores 50% more comfort.', requires: null, minLevel: 2 },
  { id: 'smallTalk', branch: 'bedside', name: 'Small Talk', text: 'Comfort drains 20% slower.', requires: 'calmingVoice', minLevel: 3 },
  { id: 'kidWhisperer', branch: 'bedside', name: 'Kid Whisperer', text: 'Kids fidget 60% less.', requires: null, minLevel: 3 },
  { id: 'gagGuru', branch: 'bedside', name: 'Gag Guru', text: 'Two extra seconds on molars before a gag.', requires: 'kidWhisperer', minLevel: 4 },
  { id: 'tipMagnet', branch: 'bedside', name: 'Tip Magnet', text: 'Tips +25%.', requires: 'smallTalk', minLevel: 5 },
  { id: 'negotiator', branch: 'business', name: 'Negotiator', text: 'Staff salaries -10%.', requires: null, minLevel: 4 },
  { id: 'marketer', branch: 'business', name: 'Marketer', text: 'Patient demand +12%.', requires: null, minLevel: 4 },
  { id: 'leader', branch: 'business', name: 'Leader', text: 'Staff morale +1 per day.', requires: 'negotiator', minLevel: 6 },
  { id: 'leanOps', branch: 'business', name: 'Lean Ops', text: 'Supplies cost 20% less.', requires: 'marketer', minLevel: 6 },
  { id: 'upseller', branch: 'business', name: 'Upseller', text: 'Add-ons accepted 15% more often.', requires: 'leanOps', minLevel: 8 },
];

export const SKILL_BRANCH_NAMES: Record<SkillBranch, string> = { technique: 'Technique', bedside: 'Bedside', business: 'Business' };

export function skillById(id: SkillId): Skill {
  const s = SKILLS.find((k) => k.id === id);
  if (!s) throw new Error('unknown skill ' + id);
  return s;
}
