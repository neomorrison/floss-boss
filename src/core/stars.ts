// Star rating from quality and the clean's difficulty rules (DESIGN 5.8 and 11.5). Shared by the sim
// (pay, reviews, mastery) and the clean scene (live ring, result), so the two can never disagree.
import type { CleanSetup } from './types';

/** Base quality thresholds for 5, 4, 3 and 2 stars. The star shift only raises the 5 and 4 star bars. */
export const STAR_STEPS = [0.92, 0.8, 0.65, 0.45] as const;

export function starsWith(quality: number, rules: CleanSetup['rules'] | null | undefined, seconds = 0, par = 0): number {
  const sh = rules?.starShift ?? 0;
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;   // 0.92 + 0.03 is exactly 0.95
  const five = Math.min(0.99, r6(STAR_STEPS[0] + sh));
  const t = STAR_STEPS.map((x, i) => (i === 0 ? five : i === 1 ? Math.min(five, r6(x + sh)) : x));
  let stars = quality >= t[0] ? 5 : quality >= t[1] ? 4 : quality >= t[2] ? 3 : quality >= t[3] ? 2 : 1;
  if (stars === 5 && rules && seconds > 0 && par > 0 && seconds > rules.fiveStarPar * par) stars = 4;
  return stars;
}

/** What 5 stars needs: the quality and, when the difficulty has a time limit, the seconds. */
export function fiveStarNeeds(rules: CleanSetup['rules'], parSeconds: number): { quality: number; seconds: number | null } {
  const q = Math.min(0.99, STAR_STEPS[0] + rules.starShift);
  return { quality: Math.round(q * 1000) / 1000, seconds: rules.fiveStarPar < 20 ? Math.round(rules.fiveStarPar * parSeconds) : null };
}
