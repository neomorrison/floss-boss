// Player skill tree. DESIGN 4.3. One point per level.
import type { SkillId } from '../core/types';

export type SkillBranch = 'technique' | 'bedside' | 'business' | 'management';
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
  { id: 'paperworkPro', branch: 'business', name: 'Paperwork Pro', text: 'Goals you forget to claim pay in full at the end of the day, not half.', requires: null, minLevel: 3 },
  { id: 'bulkBuyer', branch: 'business', name: 'Bulk Buyer', text: 'Equipment, chairs and upgrades cost 10% less.', requires: 'paperworkPro', minLevel: 5 },
  { id: 'brandBuilder', branch: 'business', name: 'Brand Builder', text: 'New patients find you twice as fast. Campaigns cost 25% less.', requires: 'marketer', minLevel: 7 },
  { id: 'investorRelations', branch: 'business', name: 'Investor Relations', text: 'Loan interest halved. Valuation +10%.', requires: 'bulkBuyer', minLevel: 9 },
  { id: 'franchiseSavvy', branch: 'business', name: 'Franchise Savvy', text: 'New locations and office moves cost 20% less.', requires: 'investorRelations', minLevel: 11 },
  { id: 'talentScout', branch: 'management', name: 'Talent Scout', text: 'Interviews are free. Two more candidates each day.', requires: null, minLevel: 4 },
  { id: 'huddlePro', branch: 'management', name: 'Huddle Pro', text: 'Pick two daily focuses instead of one.', requires: null, minLevel: 5 },
  { id: 'hrGuru', branch: 'management', name: 'HR Guru', text: 'Training costs 40% less and teaches 50% more.', requires: 'talentScout', minLevel: 6 },
  { id: 'crisisManager', branch: 'management', name: 'Crisis Manager', text: 'Risky event choices go your way 20% more often.', requires: 'huddlePro', minLevel: 7 },
  { id: 'mentorProgram', branch: 'management', name: 'Mentor Program', text: 'Staff level up 50% faster.', requires: 'hrGuru', minLevel: 8 },
  { id: 'moraleOfficer', branch: 'management', name: 'Morale Officer', text: 'Staff morale never drops below 30.', requires: 'mentorProgram', minLevel: 10 },
  { id: 'delegator', branch: 'management', name: 'Delegator', text: 'Locations without a manager run at full demand.', requires: 'crisisManager', minLevel: 10 },
  { id: 'nightShift', branch: 'management', name: 'Night Shift', text: 'Every location stays open an hour later.', requires: 'delegator', minLevel: 12 },
];

export const SKILL_BRANCH_NAMES: Record<SkillBranch, string> = { technique: 'Technique', bedside: 'Bedside', business: 'Business', management: 'Management' };

export function skillById(id: SkillId): Skill {
  const s = SKILLS.find((k) => k.id === id);
  if (!s) throw new Error('unknown skill ' + id);
  return s;
}
