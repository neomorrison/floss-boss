// Case types, twists, bonus objectives and mastery. DESIGN 5. The sim may retune numbers (never ids).
import type { ArchetypeId, BonusId, CaseType, TwistId } from '../core/types';

export interface CaseDef {
  id: CaseType;
  name: string;            // Title Case, shown on chair cards and the case intro
  blurb: string;           // one line, character voice allowed
  tip: string;             // "New case" explainer: the one thing to know, product voice
  minLevel: number;        // first player level it can appear at (employee phase)
  weight: Partial<Record<ArchetypeId, number>>;   // relative odds per archetype (missing = 0)
  payMult: number;         // employee wage multiplier; owner fee comes from the service/add-on
  requires: 'whiteningLamp' | 'deepCert' | null;  // owner phase: needed in the operatory / office, else falls back to routine
}

export const CASES: Record<CaseType, CaseDef> = {
  routine: {
    id: 'routine', name: 'Routine Cleaning', blurb: 'Tartar, a little plaque, a stain or two.',
    tip: 'Pop the tartar, polish the marked teeth, then rinse and suction.',
    minLevel: 1, payMult: 1,
    weight: { regular: 10, coffee: 4, kid: 2, nervous: 8, gagger: 8, smoker: 4, senior: 3, influencer: 3, athlete: 6, chatty: 8 },
    requires: null,
  },
  candy: {
    id: 'candy', name: 'Sugar Bug Attack', blurb: 'Sugar bugs moved in. They brought friends.',
    tip: 'Squash the sugar bugs before they spread more plaque. Floss out the gummies.',
    minLevel: 1, payMult: 1.05,
    weight: { kid: 10, athlete: 2, regular: 1 },
    requires: null,
  },
  whitening: {
    id: 'whitening', name: 'Whitening', blurb: 'Coffee, wine, regret. Time to brighten up.',
    tip: 'Polish the stains, paint gel on the front teeth, then cure each tooth under the lamp. Keep the lamp moving.',
    minLevel: 2, payMult: 1.35,
    weight: { coffee: 6, smoker: 4, influencer: 8, regular: 1 },
    requires: 'whiteningLamp',
  },
  braces: {
    id: 'braces', name: 'Braces Check', blurb: 'Food loves hiding behind a wire.',
    tip: 'Hold the floss at a bracket to thread it under the wire, then saw the food out. The polisher cannot touch brackets.',
    minLevel: 3, payMult: 1.15,
    weight: { kid: 4, athlete: 4, influencer: 2 },
    requires: null,
  },
  pirate: {
    id: 'pirate', name: 'Pirate Visit', blurb: 'Barnacles, seaweed, and a gold tooth. Arr.',
    tip: 'Crack the barnacles, floss out the seaweed and buff the gold tooth. Something shiny may be stuck in the back.',
    minLevel: 3, payMult: 1.3,
    weight: { pirate: 10 },
    requires: null,
  },
  deep: {
    id: 'deep', name: 'Deep Cleaning', blurb: 'Angry gums hiding tartar underneath.',
    tip: 'Hold the scaler on a red gum pocket to open it, then scrape out the hidden tartar. The gum heals when it is clean.',
    minLevel: 4, payMult: 1.5,
    weight: { senior: 10, smoker: 5 },
    requires: 'deepCert',
  },
};

export const CASE_ORDER: CaseType[] = ['routine', 'candy', 'whitening', 'braces', 'pirate', 'deep'];

export interface TwistDef { id: TwistId; name: string; text: string; minLevel: number }
export const TWISTS: Record<TwistId, TwistDef> = {
  chatty: { id: 'chatty', name: 'Chatty', text: 'Closes their mouth to talk now and then.', minLevel: 2 },
  fidget: { id: 'fidget', name: 'Fidgety', text: 'Cannot keep still.', minLevel: 2 },
  gagger: { id: 'gagger', name: 'Gag Reflex', text: 'Short bursts on the back molars.', minLevel: 3 },
  sensitive: { id: 'sensitive', name: 'Sensitive Gums', text: 'Gum slips hurt twice as much.', minLevel: 3 },
  hiccups: { id: 'hiccups', name: 'Hiccups', text: 'Lift the tool when you see "hic".', minLevel: 4 },
  sleepy: { id: 'sleepy', name: 'Sleepy', text: 'Dozes off. Tap Nudge before the jaw closes.', minLevel: 4 },
};

export interface BonusDef { id: BonusId; text: string }
export const BONUSES: Record<BonusId, BonusDef> = {
  noSlips: { id: 'noSlips', text: 'No gum slips' },
  fast: { id: 'fast', text: 'Finish under par' },
  combo: { id: 'combo', text: 'Pop a 4-chunk combo' },
  spotless: { id: 'spotless', text: 'Snap every marked tooth' },
  treasure: { id: 'treasure', text: 'Find the doubloon' },
};

/** Hands-on cleans of 3+ stars needed for bronze, silver and gold mastery of a case type. */
export const MASTERY_TIERS = [3, 10, 25] as const;
export const MASTERY_NAMES = ['Unranked', 'Bronze', 'Silver', 'Gold'] as const;
export const MASTERY_PERKS = [
  'Earn bronze to delegate this case with Quick clean.',
  'Quick clean unlocked for this case.',
  'Hands-on pay +10% on this case.',
  'Tips +20% on this case.',
] as const;

/** Marked problem teeth per case by player level (employee) or clinic tier (owner). DESIGN 5.2 */
export function problemToothCount(level: number): number {
  return level <= 1 ? 4 : level <= 2 ? 5 : level <= 3 ? 6 : level <= 5 ? 7 : level <= 7 ? 8 : 9;
}
