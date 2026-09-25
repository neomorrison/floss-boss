// Difficulty modes (DESIGN 11.5). The sim and the clean read these; they may retune numbers (never ids).
import type { Difficulty } from '../core/types';

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  text: string;
  // hands-on clean
  snapAt: number;             // share of a problem tooth's dirt removed before it snaps clean
  starShiftPerTitle: number;  // star thresholds rise by this much per title above Staff Hygienist (cap starShiftCap)
  starShiftCap: number;
  fiveStarPar: number;        // 5 stars also needs time <= fiveStarPar * par
  dirtScale: number;          // dirt amounts multiplier on top of level scaling
  comfortDrainPerLevel: number;  // extra passive drain per level above 3 (cap comfortDrainCap)
  comfortDrainCap: number;
  maxTwists: number;          // at level 8+
  // economy
  rentGrowthPerWeek: number;  // rent rises with a location's reputation, up to rentGrowthCap
  rentGrowthCap: number;
  badEventWeight: number;     // weight multiplier for costly events at t3+
  salaryInflationPer10Days: number;
  bankruptcyDays: number;     // consecutive closes below zero cash before the bank acts
  cityGainMult: number;       // Smile Index gain multiplier
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  relaxed: {
    id: 'relaxed', name: 'Relaxed', text: 'Gentle patients, forgiving stars, no bankruptcy.',
    snapAt: 0.8, starShiftPerTitle: 0, starShiftCap: 0, fiveStarPar: 99, dirtScale: 1, comfortDrainPerLevel: 0, comfortDrainCap: 1,
    maxTwists: 2, rentGrowthPerWeek: 0, rentGrowthCap: 0, badEventWeight: 1, salaryInflationPer10Days: 0, bankruptcyDays: 999, cityGainMult: 1.3,
  },
  standard: {
    id: 'standard', name: 'Standard', text: 'The intended game. Standards rise as your title does.',
    snapAt: 0.8, starShiftPerTitle: 0.01, starShiftCap: 0.03, fiveStarPar: 1.15, dirtScale: 1.1, comfortDrainPerLevel: 0.05, comfortDrainCap: 1.4,
    maxTwists: 3, rentGrowthPerWeek: 0.08, rentGrowthCap: 0.5, badEventWeight: 1.5, salaryInflationPer10Days: 0.015, bankruptcyDays: 5, cityGainMult: 0.9,
  },
  veteran: {
    id: 'veteran', name: 'Veteran', text: 'Tough mouths, picky patients, thin margins.',
    snapAt: 0.88, starShiftPerTitle: 0.015, starShiftCap: 0.05, fiveStarPar: 1.0, dirtScale: 1.3, comfortDrainPerLevel: 0.08, comfortDrainCap: 1.6,
    maxTwists: 3, rentGrowthPerWeek: 0.1, rentGrowthCap: 0.8, badEventWeight: 2, salaryInflationPer10Days: 0.025, bankruptcyDays: 4, cityGainMult: 0.85,
  },
};
export const DIFFICULTY_ORDER: Difficulty[] = ['relaxed', 'standard', 'veteran'];
