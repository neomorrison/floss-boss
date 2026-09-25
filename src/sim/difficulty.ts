// Difficulty modes (DESIGN 11.5): clean rules, dirt and comfort scaling, twists, rent growth, costly
// events, salary inflation. Every rule reads state.difficulty through diff().
import type { CleanSetup, Clinic, GameState } from '../core/types';
import { DIFFICULTIES, type DifficultyDef } from '../data/difficulty';
import { OFFICES } from '../data/offices';
import { SimClinic } from './internal';
import { tierIndex, titleRank } from './progress';

export function diff(state: GameState): DifficultyDef {
  return DIFFICULTIES[state.difficulty] ?? DIFFICULTIES.standard;
}

/** The star thresholds of a clean before any shift (DESIGN 5.8). */
export const STAR_STEPS = [0.92, 0.8, 0.65, 0.45] as const;

/** Clean rules for the player's current title: the snap point, how far the star thresholds rise (per title
 * above Staff Hygienist, capped) and the time 5 stars needs (fiveStarPar x par). School practicals use
 * the snap point only. */
export function cleanRules(state: GameState): CleanSetup['rules'] {
  const d = diff(state);
  if (state.phase === 'school') return { snapAt: d.snapAt, starShift: 0, fiveStarPar: 99 };
  const above = Math.max(0, titleRank(state.player.title) - titleRank('Staff Hygienist'));
  const shift = Math.min(d.starShiftCap, d.starShiftPerTitle * above);
  return { snapAt: d.snapAt, starShift: Math.round(shift * 1000) / 1000, fiveStarPar: d.fiveStarPar };
}

/** Stars of a clean under the rules: the 5-star and 4-star thresholds rise by starShift (5 stars never above
 * 0.99; 3 stars and below stay put, so case mastery and Quick clean stay in reach), and 5 stars also needs
 * seconds <= fiveStarPar x par when both are known. */
export { starsWith, fiveStarNeeds } from '../core/stars';

/** Passive comfort drain multiplier of a clean: grows past level 3, capped. */
export function comfortDrainMult(state: GameState, level: number): number {
  const d = diff(state);
  return Math.min(d.comfortDrainCap, 1 + d.comfortDrainPerLevel * Math.max(0, level - 3));
}

/** Most twists a patient can bring: 1 below level 4, 2 from 4, and the difficulty's maximum from level 8. */
export function maxTwists(state: GameState, level: number): number {
  const base = level >= 4 ? 2 : 1;
  return level >= 8 ? Math.max(base, diff(state).maxTwists) : base;
}

/** Rent growth of a location: rentGrowthPerWeek per 5 working days at its tier, scaled by its reputation
 * (rating 3.0 adds nothing, 4.0 the full rate, 4.5 one and a half), capped at rentGrowthCap. */
export function rentGrowth(state: GameState, c: Clinic): number {
  const d = diff(state);
  if (!(d.rentGrowthPerWeek > 0) || !c.ownedByPlayer) return 0;
  const since = (c as SimClinic).tierDay ?? state.day;
  const weeks = Math.floor(Math.max(0, state.day - since) / 5);
  const rep = Math.max(0, Math.min(1.5, c.rating - 3));
  return Math.min(d.rentGrowthCap, d.rentGrowthPerWeek * weeks * rep);
}

/** Rent of a location today (DESIGN 8.6 rent plus the difficulty's growth). */
export function rentOf(state: GameState, c: Clinic): number {
  return Math.round(OFFICES[c.tier].rent * (1 + rentGrowth(state, c)));
}

/** Salary asks inflate by salaryInflationPer10Days every 10 working days, for the first INFLATION_PERIODS
 * periods (then they hold: prices never inflate, so endless inflation would squeeze every office to death). */
export const INFLATION_PERIODS = 12;
export function inflationPeriods(day: number): number {
  return Math.min(INFLATION_PERIODS, Math.floor(Math.max(0, day) / 10));
}
/** Factor for asks set today. */
export function askInflation(state: GameState): number {
  const r = diff(state).salaryInflationPer10Days;
  return r > 0 ? Math.pow(1 + r, inflationPeriods(state.day)) : 1;
}
/** Today is an inflation day (every 10th working day, for the first INFLATION_PERIODS periods). */
export function inflationDay(state: GameState): boolean {
  return diff(state).salaryInflationPer10Days > 0 && state.day % 10 === 0 && state.day / 10 <= INFLATION_PERIODS;
}

/** Heavier mouths take your hygienists longer too: NPC chair time x dirtScale^0.5 at your offices. */
export function npcDirtTime(state: GameState): number {
  return Math.sqrt(diff(state).dirtScale);
}

/** Events that cost money or patients whatever you answer: more likely at big offices on harder settings. */
export const COSTLY_EVENTS = new Set(['inspector', 'flu', 'pipe', 'rival', 'poach', 'outage', 'heatwave']);

/** Weight multiplier of an event at a location: costly events at a Medical Plaza or bigger x badEventWeight. */
export function eventWeightMult(state: GameState, c: Clinic, eventId: string): number {
  if (!COSTLY_EVENTS.has(eventId) || tierIndex(c.tier) < 2) return 1;
  return diff(state).badEventWeight;
}
