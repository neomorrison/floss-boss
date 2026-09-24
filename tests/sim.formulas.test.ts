import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import { starsFor, employeeRate } from '../src/sim/progress';
import { reviewStars, computeRating } from '../src/sim/clinic';
import { awareness, demandLambda, PRICE_ELASTICITY } from '../src/sim/booking';
import { emptySpecial, parSeconds } from '../src/sim/cases';
import { askFor } from '../src/sim/staff';
import { CASES } from '../src/data/cases';
import { graduated, grant, result } from './sim.helpers';

describe('progression formulas', () => {
  it('xpToNext = 60, 100, 150 through level 3, then round(60 * L^1.4)', () => {
    expect(sim.xpToNext(1)).toBe(60);
    expect(sim.xpToNext(2)).toBe(100);
    expect(sim.xpToNext(3)).toBe(150);
    expect(sim.xpToNext(4)).toBe(418);
    expect(sim.xpToNext(10)).toBe(Math.round(60 * Math.pow(10, 1.4)));
  });

  it('clean stars thresholds (DESIGN 5.5)', () => {
    expect(starsFor(0.92)).toBe(5);
    expect(starsFor(0.919)).toBe(4);
    expect(starsFor(0.8)).toBe(4);
    expect(starsFor(0.65)).toBe(3);
    expect(starsFor(0.45)).toBe(2);
    expect(starsFor(0.44)).toBe(1);
  });

  it('review stars (DESIGN 8.3) reward quality, comfort and short waits, punish high prices', () => {
    expect(reviewStars(0.9, 0.9, 0, 45, 1)).toBe(5);
    expect(reviewStars(0.67, 0.62, 5, 45, 1)).toBe(3);   // an average NPC clean
    expect(reviewStars(0.2, 0.2, 45, 45, 1)).toBe(1);
    expect(reviewStars(0.9, 0.9, 0, 45, 1.5)).toBeLessThan(reviewStars(0.9, 0.9, 0, 45, 1));
  });

  it('rating blends a 3.5 prior of weight 3 with weighted reviews', () => {
    const c = { equipment: [], reviews: [] } as unknown as Parameters<typeof computeRating>[0];
    expect(computeRating(c)).toBe(3.5);
    c.reviews.push({ day: 1, name: 'a', archetype: 'regular', stars: 5, weight: 1, text: '' });
    expect(computeRating(c)).toBeCloseTo((3.5 * 3 + 5) / 4, 2);
    c.reviews.push({ day: 1, name: 'b', archetype: 'influencer', stars: 1, weight: 3, text: '' });
    expect(computeRating(c)).toBeCloseTo((3.5 * 3 + 5 + 3) / 7, 2);
  });

  it('par time (DESIGN 5.8)', () => {
    const d = { plaque: 0.5, stain: 0.3, tartarCount: 6, tartarSize: 1, debrisCount: 2 };
    const sp = emptySpecial();
    expect(parSeconds(d, 5, sp, 'routine', 1)).toBe(Math.round(20 + 2.6 * 6 + 5 * 5 + 4 * 2));
    expect(parSeconds(d, 5, sp, 'routine', 1.2)).toBe(Math.round((20 + 2.6 * 6 + 5 * 5 + 4 * 2) * 1.2));
    const pirate = { ...sp, barnacles: 4, seaweed: 2, treasure: true };
    expect(parSeconds(d, 5, pirate, 'pirate', 1)).toBe(Math.round(20 + 2.6 * (6 + 8) + 25 + 4 * (2 + 2 + 1) + 20));
  });

  it('salary asks follow the role formulas', () => {
    expect(askFor('hygienist', { skill: 50, speed: 50, bedside: 50 })).toBe(400);
    expect(askFor('receptionist', { skill: 60, speed: 0, bedside: 0 })).toBe(210);
  });
});

describe('demand', () => {
  it('awareness grows with patients served and saturates', () => {
    expect(awareness(0)).toBeCloseTo(0.5, 5);
    expect(awareness(150)).toBeGreaterThan(0.8);
    expect(awareness(5000)).toBeCloseTo(1, 2);
  });

  it('lambda scales with rating, price, marketing and weekday', () => {
    const s = graduated();
    grant(s, 10000);
    s.player.level = 4;
    expect(sim.openPractice(s, { name: 'Test Dental', loan: 0 }).ok).toBe(true);
    const c = s.locations[0];
    const base = demandLambda(s, c, 1);
    c.rating = 4.5;
    expect(demandLambda(s, c, 1) / base).toBeCloseTo((0.6 + 0.16 * 4.5) / (0.6 + 0.16 * 3.5), 5);
    c.rating = 3.5;
    c.prices.cleaning = 1.2;
    expect(demandLambda(s, c, 1) / base).toBeCloseTo(Math.pow(1.2, -PRICE_ELASTICITY), 5);
    c.prices.cleaning = 1;
    c.marketing = 2;
    expect(demandLambda(s, c, 1) / base).toBeCloseTo(1.45, 5);
    c.marketing = 0;
    expect(demandLambda(s, c, 4) / base).toBeCloseTo(1.15, 5);
  });
});

describe('employee pay (DESIGN 3.2)', () => {
  it('pays rate(title) * (0.4 + 0.8 q) plus the tip formula', () => {
    const s = graduated(21);
    let guard = 0;
    while (!sim.playerQueue(s).length && guard++ < 1000) sim.tick(s, 1);
    const p = sim.playerQueue(s)[0];
    expect(p).toBeTruthy();
    const setup = sim.beginHandsOn(s, p.id);
    const q = 0.9;
    const secs = 60;
    const { payout } = sim.completeHandsOn(s, p.id, result(q, { seconds: secs }));
    const pm = CASES[p.caseType].payMult;
    expect(payout.pay).toBe(Math.round(employeeRate(s.player.level) * (0.4 + 0.8 * q) * pm));
    const speed = Math.max(0, Math.min(1, (setup.parSeconds - secs) / setup.parSeconds));
    const tipRates: Record<string, number> = { regular: 0.1 };
    const tipRate = tipRates[p.archetype] ?? null;
    if (tipRate != null) expect(payout.tip).toBe(Math.round(Math.round(120 * pm) * tipRate * ((q - 0.6) / 0.4) * (1 + 0.5 * speed)));
    expect(payout.xp).toBe(Math.round(10 + 30 * q));
  });

  it('no tip below quality 0.6; quick cleans pay half the wage, no tip and no XP', () => {
    const s = graduated(22);
    let guard = 0;
    while (!sim.playerQueue(s).length && guard++ < 1000) sim.tick(s, 1);
    const p = sim.playerQueue(s)[0];
    sim.beginHandsOn(s, p.id);
    const r1 = sim.completeHandsOn(s, p.id, result(0.55));
    expect(r1.payout.tip).toBe(0);
    guard = 0;
    while (!sim.playerQueue(s).length && !s.dayOver && guard++ < 1000) sim.tick(s, 1);
    const p2 = sim.playerQueue(s)[0];
    const aq = sim.autoQuality(s);
    s.player.mastery[p2.caseType] = 3;   // Bronze
    const r2 = sim.quickClean(s, p2.id);
    expect(r2.payout.tip).toBe(0);
    expect(r2.payout.quality).toBeCloseTo(aq, 5);
    expect(r2.payout.xp).toBe(0);
    expect(r2.payout.pay).toBe(Math.round(employeeRate(s.player.level) * (0.4 + 0.8 * aq) * CASES[p2.caseType].payMult * 0.5));
  });

  it('auto quality formula (DESIGN 4.2)', () => {
    const s = graduated();
    s.player.level = 4;
    expect(sim.autoQuality(s)).toBeCloseTo(0.6, 5);
    s.player.tools.scaler = 4;
    s.player.tools.polisher = 2;
    expect(sim.autoQuality(s)).toBeCloseTo(0.6 + 0.1, 5);
    s.player.level = 30;
    expect(sim.autoQuality(s)).toBe(0.9);
  });
});
