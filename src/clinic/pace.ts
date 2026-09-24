// Pure timing helpers for the diorama's people. No three.js, no DOM: safe to unit test directly.
// See out/fix/clinic.md #2 and #3 (QA findings this file fixes) and DESIGN 8.1.

/**
 * Extra walking-speed multiplier so a patient reaches the operatory chair before the "seated within
 * about 15% of the cleaning" budget runs out. At high game speeds the sim gives the walk itself almost
 * no real time (the toChair phase is a fixed number of game minutes, which shrinks toward nothing as
 * the clock races), so the actor has to move faster than the base walk-speed multiplier alone provides.
 * Returns a value in [1, cap]: 1 when there is no hurry (or nothing left to walk), up to cap when the
 * walk would otherwise land well after the sim already has the patient in the chair.
 */
export function seatCatchupBoost(opts: {
  remaining: number;   // meters left to walk (or an approximation when no route exists yet)
  sinceMin: number;    // patient.since: the inChair phase started, game minutes
  untilMin: number;    // patient.until: the cleaning ends, game minutes
  minute: number;      // current clinic clock, game minutes
  gameRate: number;    // game minutes per real second at the current speed
  speedMps: number;    // this actor's walking speed in meters/real-second at rate = 1
  rate: number;        // the clinic's current walk-speed multiplier (already includes the speed exponent)
  cap: number;         // the largest multiplier this can return
}): number {
  const { remaining, sinceMin, untilMin, minute, gameRate, speedMps, rate, cap } = opts;
  if (remaining <= 0.05 || speedMps <= 0 || rate <= 0) return 1;
  const gr = Math.max(1, gameRate);
  const realTotal = Math.max(0, untilMin - sinceMin) / gr;
  const realLeft = Math.max(0, untilMin - minute) / gr;
  const budget = Math.max(0.3, Math.min(0.15 * realTotal - (minute - sinceMin) / gr, 0.5 * realLeft));
  const need = remaining / budget / (speedMps * rate);
  return Math.min(cap, Math.max(1, need));
}

/**
 * Walk-speed multiplier from the current game speed: the sim squeezes a whole day into a couple of
 * minutes at high speeds, so people need to walk faster than real time to keep up. Capped well above
 * the shipped max speed (4x -> gameRate/5 = 4) so debug speeds and future pacing levers (DESIGN 2,
 * "Known tension") keep headroom instead of hitting the ceiling exactly at the current max.
 */
export function walkRate(gameRate: number, headroom: number): number {
  return Math.pow(Math.min(headroom, Math.max(1, gameRate / 5)), 1.35);
}
