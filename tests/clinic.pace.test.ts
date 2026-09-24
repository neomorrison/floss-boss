import { describe, expect, it } from 'vitest';
import { seatCatchupBoost, walkRate } from '../src/clinic/pace';

describe('clinic pace: walkRate', () => {
  it('matches the old fixed cap at every speed a player can actually pick (out/fix/clinic.md #2)', () => {
    // Speed = 0 | 1 | 2 | 4; gameRate is game-minutes per real second, 5 per 1x.
    for (const speed of [1, 2, 4]) {
      const gameRate = 5 * speed;
      expect(walkRate(gameRate, 8)).toBeCloseTo(Math.pow(speed, 1.35), 6);
    }
  });

  it('keeps headroom above the shipped max instead of a hard ceiling exactly at it', () => {
    // Only reachable via the dev harness/debug hooks (speed=8), never the shipped Speed union.
    const atShippedMax = walkRate(20, 8);         // 4x
    const beyondShippedMax = walkRate(40, 8);      // 8x, debug-only
    expect(beyondShippedMax).toBeGreaterThan(atShippedMax);
    // the old code hard-capped at exactly gameRate/5 = 4, so anything past 4x got zero extra speed
    expect(walkRate(40, 4)).toBeCloseTo(walkRate(20, 4), 6);
  });
});

describe('clinic pace: seatCatchupBoost', () => {
  const base = { sinceMin: 600, untilMin: 640, minute: 600, gameRate: 20, speedMps: 3.5, rate: 6, cap: 6 };

  it('does nothing once the walk is basically done', () => {
    expect(seatCatchupBoost({ ...base, remaining: 0 })).toBe(1);
    expect(seatCatchupBoost({ ...base, remaining: 0.02 })).toBe(1);
  });

  it('boosts past 1x when the walk would otherwise miss the seat-early budget', () => {
    // a long walk left at the very start of a short, fast (4x-like) cleaning
    const need = seatCatchupBoost({ ...base, remaining: 10 });
    expect(need).toBeGreaterThan(1);
  });

  it('never exceeds the cap passed in, however far behind the walk is', () => {
    const need = seatCatchupBoost({ ...base, remaining: 500, cap: 6 });
    expect(need).toBeLessThanOrEqual(6);
    expect(need).toBe(6);
  });

  it('needs less boost the longer the cleaning (more real time budget for the walk)', () => {
    const short = seatCatchupBoost({ ...base, remaining: 6, untilMin: 620 });   // 20 sim-min cleaning
    const long = seatCatchupBoost({ ...base, remaining: 6, untilMin: 720 });    // 120 sim-min cleaning
    expect(long).toBeLessThanOrEqual(short);
  });

  it('is a no-op when the patient state carries no cleaning window yet', () => {
    expect(seatCatchupBoost({ ...base, remaining: 5, speedMps: 0 })).toBe(1);
    expect(seatCatchupBoost({ ...base, remaining: 5, rate: 0 })).toBe(1);
  });
});
