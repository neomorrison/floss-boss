// New Game+ Legacy perks (DESIGN 11.4). Legacy points persist across runs in core/legacy.ts.
import type { LegacyPerkId } from '../core/types';

export interface LegacyPerkDef { id: LegacyPerkId; name: string; text: string; cost: number }

export const LEGACY_PERKS: Record<LegacyPerkId, LegacyPerkDef> = {
  headStart: { id: 'headStart', name: 'Head Start', text: 'Start with $500 and Floss Picks.', cost: 2 },
  trainedHands: { id: 'trainedHands', name: 'Trained Hands', text: 'Start with the Gracey Curette and the Cordless Polisher.', cost: 3 },
  prodigy: { id: 'prodigy', name: 'Prodigy', text: 'One extra skill point at the start.', cost: 3 },
  famousName: { id: 'famousName', name: 'Famous Name', text: 'Patient demand +10% at every location.', cost: 5 },
  alumniNetwork: { id: 'alumniNetwork', name: 'Alumni Network', text: 'Candidates have +5 on every stat.', cost: 4 },
  goldScrubs: { id: 'goldScrubs', name: 'Gold Scrubs', text: 'Gold scrubs in the office. Pure style.', cost: 1 },
};
export const LEGACY_ORDER: LegacyPerkId[] = ['headStart', 'trainedHands', 'prodigy', 'famousName', 'alumniNetwork', 'goldScrubs'];
