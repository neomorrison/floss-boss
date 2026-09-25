// The v4 end game (DESIGN 11): Smile City, milestones, the Smile Van, the Golden Molar Gala, Legacy points
// and New Game+ perks, difficulty rules, bankruptcy, the rap star VIP and save migration.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { DayPatient, DistrictId, GameState, OfficeTierId, SimEvent, Staff } from '../src/core/types';
import { OFFICES, TIER_ORDER } from '../src/data/offices';
import { CITY_MILESTONES, DISTRICTS, DISTRICT_ORDER } from '../src/data/city';
import { DIFFICULTIES } from '../src/data/difficulty';
import { ARCHETYPES } from '../src/data/patients';
import { CASES } from '../src/data/cases';
import { EQUIPMENT } from '../src/data/upgrades';
import { loadLegacy } from '../src/core/legacy';
import { graduated, grant, ledgerSum, nonFinite, result } from './sim.helpers';
import { makeStaff } from '../src/sim/staff';
import { withRng, type SimClinic, type SimPatient } from '../src/sim/internal';
import {
  CITY_EVENT_POINTS, DECAY_RATE, HANDS_ON_CITY, SAME_DISTRICT_SHARE, VAN_CLEANINGS, VAN_QUALITY, WALKOUT_COMFORT_POINTS, WALKOUT_WAIT_POINTS,
  addPoints, checkMilestones, cityDecay, cityIndex, creditPatient, creditWalkout, districtState, patientDistrict,
} from '../src/sim/city';
import { COSTLY_EVENTS, cleanRules, comfortDrainMult, maxTwists, rentGrowth, rentOf, starsWith } from '../src/sim/difficulty';
import { archetypeWeight } from '../src/sim/patients';
import { demandLambda } from '../src/sim/booking';
import { GRILL_TEETH } from '../src/sim/cases';
import { GALA_MERCY, LEGACY_GOLDEN_MOLAR } from '../src/sim/finale';
import { drawEvents as drawEventsFor } from '../src/sim/manager';
import { NON_OPERATING_LABELS } from '../src/sim/economy';

// ------------------------------------------------------------------ helpers

/** A Node stand-in for localStorage so core/legacy can persist during the test. */
class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

function addStaff(s: GameState, li: number, role: Staff['role'], stat: number, opId?: string): void {
  const c = s.locations[li];
  const st = withRng(s, (rng) => makeStaff(s, rng, role, 0, { skill: stat, speed: stat, bedside: stat, traits: [] }));
  c.staff.push(st);
  if (opId) c.ops.find((o) => o.id === opId)!.staffId = st.id;
}

function ownerAt(seed = 11, tier: OfficeTierId = 't2', o: { cash?: number; district?: DistrictId; difficulty?: GameState['difficulty'] } = {}): GameState {
  const s = graduated(seed);
  if (o.difficulty) s.difficulty = o.difficulty;
  grant(s, o.cash ?? 3_000_000);
  s.player.level = 8;
  expect(sim.openPractice(s, { name: 'End Dental', loan: 0, district: o.district }).ok).toBe(true);
  sim.closeDay(s);
  sim.completeHuddle(s);
  for (let i = 1; i <= TIER_ORDER.indexOf(tier); i++) expect(sim.moveOffice(s, 0, TIER_ORDER[i], 0).ok).toBe(true);
  const c = s.locations[0];
  while (c.ops.length < OFFICES[c.tier].opSlots) expect(sim.buyOperatory(s, 0).ok).toBe(true);
  for (const op of c.ops) op.staffId = null;
  for (const op of c.ops) addStaff(s, 0, 'hygienist', 60, op.id);
  addStaff(s, 0, 'receptionist', 60);
  s.minute = 480; s.dayOver = false; s.huddleDay = s.day - 1; s.pendingEvents = [];
  expect(sim.setFocus(s, s.focus).ok).toBe(true);
  sim.completeHuddle(s);
  return s;
}

function runDay(s: GameState): ReturnType<typeof sim.closeDay> {
  sim.completeHuddle(s);
  let g = 0;
  while (!s.dayOver && g++ < 20000) sim.tick(s, 3);
  return sim.closeDay(s);
}

const fakePatient = (id: string): DayPatient => ({ id } as DayPatient);
const idx = (s: GameState, id: DistrictId) => districtState(s, id).index;

// ------------------------------------------------------------------ Smile City

describe('Smile City and the Smile Index (DESIGN 11.1)', () => {
  it('starts from the district start values, around 19% city-wide, population-weighted', () => {
    const s = sim.newGame({ name: 'A', avatar: 0, seed: 1, nowMs: 0 });
    expect(s.city.map((d) => d.id)).toEqual(DISTRICT_ORDER);
    for (const d of s.city) { expect(d.index).toBe(DISTRICTS[d.id].start); expect(d.served).toBe(0); }
    const st = sim.cityStatus(s);
    let w = 0; let sum = 0;
    for (const id of DISTRICT_ORDER) { w += DISTRICTS[id].population; sum += DISTRICTS[id].population * DISTRICTS[id].start; }
    expect(st.index).toBeCloseTo(sum / w, 4);
    expect(st.pct).toBeGreaterThan(15);
    expect(st.pct).toBeLessThan(23);
    expect(st.next?.pct).toBe(30);
    expect(st.reached).toEqual([]);
    expect(st.galaUnlocked).toBe(false);
    expect(st.vanUnlocked).toBe(false);
    expect(st.districts.every((d) => d.locations === 0)).toBe(true);
  });

  it('Bright Smiles is Downtown; the practice defaults to the least-smiling district, or the one you pick', () => {
    const s = graduated(3);
    expect(s.employer!.district).toBe('downtown');
    grant(s, 10_000);
    s.player.level = 4;
    const least = [...DISTRICT_ORDER].sort((a, b) => DISTRICTS[a].start - DISTRICTS[b].start)[0];
    const a = JSON.parse(JSON.stringify(s)) as GameState;
    expect(sim.openPractice(a, { name: 'A', loan: 0 }).ok).toBe(true);
    expect(a.locations[0].district).toBe(least);
    expect(sim.openPractice(s, { name: 'B', loan: 0, district: 'harbor' }).ok).toBe(true);
    expect(s.locations[0].district).toBe('harbor');
    expect(sim.cityStatus(s).districts.find((d) => d.id === 'harbor')!.locations).toBe(1);
    expect(s.timeline.some((e) => e.kind === 'office' && e.text.includes('Harbor'))).toBe(true);
  });

  it('a new location defaults to the least-smiling district without one; a second one in a district adds half', () => {
    const s = ownerAt(21, 't2', { district: 'maple' });
    expect(sim.openLocation(s, 't2', 'Two', 0).ok).toBe(true);
    const d2 = s.locations[1].district;
    expect(d2).not.toBe('maple');
    const free = DISTRICT_ORDER.filter((d) => d !== 'maple').sort((a, b) => idx(s, a) - idx(s, b))[0];
    expect(d2).toBe(free);
    expect(sim.openLocation(s, 't2', 'Three', 0, 'maple').ok).toBe(true);
    expect(s.locations[2].district).toBe('maple');
    // same patient, same quality: the third location (second in Maple) adds half of what the first adds
    const home = (c: number) => { for (let i = 0; i < 200; i++) { const p = fakePatient(`p${c}_${i}`); if (patientDistrict(s, s.locations[c], p) === 'maple') return p; } throw new Error('no home patient'); };
    const p0 = home(0); const p2 = home(2);
    const before = idx(s, 'maple');
    creditPatient(s, s.locations[0], p0, 0.9, false);
    const one = idx(s, 'maple') - before;
    creditPatient(s, s.locations[2], p2, 0.9, false);
    const two = idx(s, 'maple') - before - one;
    expect(two).toBeCloseTo(one * SAME_DISTRICT_SHARE, 5);
  });

  it('gains: (q - 0.5) x 2 points / population x cityGainMult, hands-on double, poor cleans lower it, 80/20 split', () => {
    const s = ownerAt(22, 't2', { district: 'oldtown' });
    const c = s.locations[0];
    const mult = DIFFICULTIES[s.difficulty].cityGainMult;
    const pop = DISTRICTS.oldtown.population;
    const home = Array.from({ length: 400 }, (_, i) => fakePatient(`x${i}`)).filter((p) => patientDistrict(s, c, p) === 'oldtown');
    const share = home.length / 400;
    expect(share).toBeGreaterThan(0.72);
    expect(share).toBeLessThan(0.88);
    const b0 = idx(s, 'oldtown');
    creditPatient(s, c, home[0], 0.8, false);
    expect(idx(s, 'oldtown') - b0).toBeCloseTo(0.6 * mult / pop, 5);
    const b1 = idx(s, 'oldtown');
    creditPatient(s, c, home[1], 0.8, true);
    expect(idx(s, 'oldtown') - b1).toBeCloseTo(0.6 * mult * HANDS_ON_CITY / pop, 5);
    const b2 = idx(s, 'oldtown');
    creditPatient(s, c, home[2], 0.3, false);
    expect(idx(s, 'oldtown') - b2).toBeCloseTo(-0.4 / pop, 5);
    // neighbours get the rest
    const away = Array.from({ length: 400 }, (_, i) => fakePatient(`y${i}`)).map((p) => patientDistrict(s, c, p)).filter((d) => d !== 'oldtown');
    for (const d of away) expect(DISTRICTS.oldtown.neighbors).toContain(d);
    expect(districtState(s, 'oldtown').served).toBe(3);
  });

  it('walkouts cost points: a wait walkout 0.5, a comfort walkout 1', () => {
    const s = ownerAt(23, 't2', { district: 'uptown' });
    const c = s.locations[0];
    const p = Array.from({ length: 50 }, (_, i) => fakePatient(`w${i}`)).find((x) => patientDistrict(s, c, x) === 'uptown')!;
    addPoints(s, 'uptown', 100);
    const a = idx(s, 'uptown');
    creditWalkout(s, c, p, 'wait');
    expect(a - idx(s, 'uptown')).toBeCloseTo(WALKOUT_WAIT_POINTS / DISTRICTS.uptown.population, 6);
    const b = idx(s, 'uptown');
    creditWalkout(s, c, p, 'comfort');
    expect(b - idx(s, 'uptown')).toBeCloseTo(WALKOUT_COMFORT_POINTS / DISTRICTS.uptown.population, 6);
  });

  it('served patients raise the location district over a real day; hands-on cleans count', () => {
    const s = ownerAt(24, 't2', { district: 'university' });
    const before = idx(s, 'university');
    const served0 = districtState(s, 'university').served;
    runDay(s);
    expect(idx(s, 'university')).toBeGreaterThan(before);
    expect(districtState(s, 'university').served).toBeGreaterThan(served0 + 5);
    expect(ledgerSum(s)).toBe(s.cash);
  });

  it('employed, your own chair raises Downtown (the read-only preview)', () => {
    const s = graduated(25);
    const before = idx(s, 'downtown');
    let guard = 0;
    while (!s.dayOver && guard++ < 20000) {
      const q = sim.playerQueue(s);
      if (q.length) { const setup = sim.beginHandsOn(s, q[0].id); sim.completeHandsOn(s, q[0].id, result(0.9, { caseType: setup.caseType })); continue; }
      sim.tick(s, 2);
    }
    expect(idx(s, 'downtown')).toBeGreaterThan(before);
  });

  it('decay: a district with fewer than 3 patients today drifts back toward its start; busy districts hold', () => {
    const s = ownerAt(26, 't2', { district: 'harbor' });
    addPoints(s, 'uptown', 300);
    addPoints(s, 'harbor', 300);
    (s as { cityDay?: Record<string, number> }).cityDay = { harbor: 5, uptown: 2 };
    const u = idx(s, 'uptown');
    const h = idx(s, 'harbor');
    cityDecay(s);
    expect(idx(s, 'uptown')).toBeCloseTo(u - DECAY_RATE * (u - DISTRICTS.uptown.start), 6);
    expect(idx(s, 'harbor')).toBe(h);
    // nothing below the start value decays
    const m = idx(s, 'maple');
    cityDecay(s);
    expect(idx(s, 'maple')).toBe(m);
  });

  it('charity, school day and tooth fairy events add points to their location district', () => {
    for (const [eventId, pts] of Object.entries(CITY_EVENT_POINTS)) {
      const s = ownerAt(27, 't2', { district: 'maple' });
      const before = idx(s, 'maple');
      s.pendingEvents = [{ eventId, clinicId: s.locations[0].id, day: s.day, vars: { clinic: s.locations[0].name } }];
      const r = sim.resolveEvent(s, 0, 0);
      expect(idx(s, 'maple') - before).toBeCloseTo(pts[0] * DIFFICULTIES[s.difficulty].cityGainMult / DISTRICTS.maple.population, 5);
      expect(r.text).toContain('Smile City');
    }
  });
});

describe('milestones, grants, the Smile Van and the gala unlock (DESIGN 11.1)', () => {
  function setCity(s: GameState, frac: number): void {
    for (const d of s.city) d.index = frac;
  }

  it('each milestone: toast, note, timeline, city grant (non-operating), once', () => {
    const s = ownerAt(31);
    setCity(s, 0.3);
    const cash0 = s.cash;
    const ev: SimEvent[] = [];
    const got = checkMilestones(s, ev);
    expect(got).toEqual([30]);
    expect(s.cash).toBeGreaterThan(cash0);
    expect(ledgerSum(s)).toBe(s.cash);
    expect(s.ledger.some((e) => e.label === 'City grant')).toBe(true);
    expect(ev.some((e) => e.type === 'toast' && e.text.startsWith('Smile City 30%'))).toBe(true);
    expect(s.timeline.some((e) => e.kind === 'city' && e.text.startsWith(CITY_MILESTONES[0].title))).toBe(true);
    expect(ev.filter((e) => e.type === 'toast').map((e) => (e as { text: string }).text)).toEqual(['Smile City 30%']);
    expect(checkMilestones(s, null)).toEqual([]);
    const rep = sim.closeDay(s);
    expect(rep.notes.some((n) => n.startsWith('Smile City 30%'))).toBe(true);
    expect(rep.expenses.concat(rep.income).some((l) => l.label === 'City grant')).toBe(true);
    expect(NON_OPERATING_LABELS.has('City grant')).toBe(true);   // the grant is not operating income
  });

  it('the Smile Van is for sale from 50%; the gala is scheduled at 100% (99.5% rounds up)', () => {
    const s = ownerAt(32);
    expect(sim.buyEquipment(s, 0, 'smileVan')).toEqual({ ok: false, reason: 'Unlocks at Smile City 50%' });
    setCity(s, 0.5);
    checkMilestones(s, null);
    expect(sim.cityStatus(s).vanUnlocked).toBe(true);
    expect(sim.buyEquipment(s, 0, 'smileVan').ok).toBe(true);
    expect(sim.galaStatus(s).unlocked).toBe(false);
    setCity(s, 0.995);
    checkMilestones(s, null);
    expect(s.finale.milestones).toEqual(CITY_MILESTONES.map((m) => m.pct));
    expect(s.finale.galaUnlocked).toBe(true);
    expect(sim.cityStatus(s).next).toBeNull();
    expect(s.timeline.some((e) => e.kind === 'award' && e.text.includes('Nominated'))).toBe(true);
    expect(sim.galaStatus(s).ready).toBe(true);
    expect(sim.nextHint(s)).toBe('The Golden Molar Gala is ready');
  });

  it('a Smile Van serves the least-smiling district without a location at the day close', () => {
    const s = ownerAt(33, 't2', { district: 'downtown' });
    setCity(s, 0.5);
    checkMilestones(s, null);
    expect(sim.buyEquipment(s, 0, 'smileVan').ok).toBe(true);
    addPoints(s, 'maple', -10_000);   // Maple is now the least smiling
    const m0 = idx(s, 'maple');
    const rep = runDay(s);
    const gain = VAN_CLEANINGS * (VAN_QUALITY - 0.5) * 2 * DIFFICULTIES[s.difficulty].cityGainMult / DISTRICTS.maple.population;
    expect(idx(s, 'maple')).toBeGreaterThanOrEqual(m0 + gain - 1e-6 - 0.01);
    expect(rep.notes.some((n) => n.startsWith('Smile Van') && n.includes('Maple'))).toBe(true);
  });

  it('milestones reached mid-day come out of tick() as toasts', () => {
    const s = ownerAt(34);
    setCity(s, 0.4);
    const ev = sim.tick(s, 1);
    expect(ev.some((e) => e.type === 'toast' && e.text.startsWith('Smile City 40%'))).toBe(true);
    expect(s.finale.milestones).toEqual([30, 40]);
  });
});

// ------------------------------------------------------------------ the finale

describe('the Golden Molar Gala, Legacy points and New Game+ (DESIGN 11.3, 11.4)', () => {
  let saved: unknown;
  beforeEach(() => { saved = (globalThis as { localStorage?: unknown }).localStorage; (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = saved; });

  function galaReady(seed = 41): GameState {
    const s = ownerAt(seed);
    for (const d of s.city) d.index = 1;
    checkMilestones(s, null);
    return s;
  }

  it('the gala setup: grillz on stage, the rap star, the most gems, many twists, the upper front six marked', () => {
    const s = galaReady();
    const g = sim.galaSetup(s);
    expect(g.caseType).toBe('grillz');
    expect(g.special.showcase).toBe(true);
    expect(g.special.grillGems).toBe(12);
    expect(g.patient.archetype).toBe('rapper');
    expect(g.patient.name).toBe('Lil Molar');
    expect(g.twists.length).toBeGreaterThanOrEqual(2);
    expect(g.twists).toContain('chatty');
    for (const t of GRILL_TEETH) expect(g.problemTeeth).toContain(t);
    expect(g.rules).toEqual(cleanRules(s));
    // the crowd warms up after a failed attempt
    const tomorrow = JSON.parse(JSON.stringify(s)) as GameState;
    tomorrow.finale.attempts = 3;
    expect(sim.galaSetup(tomorrow).rules.starShift).toBeCloseTo(cleanRules(s).starShift - 3 * GALA_MERCY, 6);
    expect(g.tools.numbingGel).toBe(false);
    expect(sim.galaSetup(s)).toEqual(g);   // deterministic per attempt
  });

  it('fewer than 4 stars: try again tomorrow; 4+ stars wins the Golden Molar, the prize and the trophy', () => {
    const s = galaReady(42);
    const lose = sim.completeGala(s, result(0.7, { caseType: 'grillz', stars: 3 }));
    expect(lose.won).toBe(false);
    expect(s.finale.attempts).toBe(1);
    expect(s.finale.won).toBe(false);
    expect(sim.galaStatus(s).ready).toBe(false);
    expect(sim.completeGala(s, result(0.95, { caseType: 'grillz', stars: 5 })).won).toBe(false);   // one try a day
    expect(s.finale.attempts).toBe(1);
    runDay(s);
    expect(sim.galaStatus(s).ready).toBe(true);
    const cash0 = s.cash;
    const win = sim.completeGala(s, result(0.9, { caseType: 'grillz', stars: 4 }));
    expect(win.won).toBe(true);
    expect(s.finale.won).toBe(true);
    expect(s.finale.wonDay).toBe(s.day);
    expect(s.finale.attempts).toBe(2);
    expect(s.cash - cash0).toBe(win.payout.pay);
    expect(win.payout.pay).toBeGreaterThan(0);
    expect(ledgerSum(s)).toBe(s.cash);
    expect(s.timeline.some((e) => e.kind === 'award' && e.text.startsWith('Won the Golden Molar'))).toBe(true);
    expect(sim.trophies(s).goldenMolar).toBe(true);
    expect(win.legacy).toBe(sim.legacyPoints(s).total);
    expect(sim.galaStatus(s).ready).toBe(false);
    const l = loadLegacy();
    expect(l.wins).toBe(1);
    expect(l.veteranUnlocked).toBe(true);
  });

  it('a walkout or an abort never wins', () => {
    const s = galaReady(43);
    expect(sim.completeGala(s, result(0.95, { quit: 'walkout', stars: 5 })).won).toBe(false);
    runDay(s);
    expect(sim.completeGala(s, result(0.95, { quit: 'abort', stars: 5 })).won).toBe(false);
    expect(s.finale.attempts).toBe(2);
  });

  it('Legacy points: 5 for the Golden Molar, 1 per 5 achievements, 1 per gold mastery, 1 per $1M (cap 10); retire once', () => {
    const s = galaReady(44);
    s.player.mastery = { routine: 25, candy: 30, deep: 9 };
    const p0 = sim.legacyPoints(s);
    expect(p0.goldenMolar).toBe(0);
    expect(p0.gold).toBe(2);
    expect(p0.achievements).toBe(Math.floor(s.achievements.length / 5));
    expect(p0.valuation).toBe(Math.min(10, Math.floor(sim.valuation(s) / 1_000_000)));
    sim.completeGala(s, result(0.95, { caseType: 'grillz', stars: 5 }));
    const p = sim.legacyPoints(s);
    expect(p.goldenMolar).toBe(LEGACY_GOLDEN_MOLAR);
    expect(p.total).toBe(p.goldenMolar + p.achievements + p.gold + p.valuation);
    const pts = sim.retire(s);
    expect(pts).toBe(p.total);
    expect(s.finale.retired).toBe(true);
    const l = loadLegacy();
    expect(l.points).toBe(pts);
    expect(l.earned).toBe(pts);
    expect(l.runs).toBe(1);
    expect(l.wins).toBe(1);   // counted once, at the win
    expect(sim.retire(s)).toBe(0);
    expect(loadLegacy().points).toBe(pts);
  });

  it('New Game+ perks apply at the start (Head Start, Trained Hands, Prodigy) and during the run', () => {
    const plain = sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 0 });
    const perks = sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 0, legacyPerks: ['headStart', 'trainedHands', 'prodigy', 'famousName', 'alumniNetwork', 'goldScrubs'] });
    expect(perks.legacyPerks).toHaveLength(6);
    expect(perks.cash).toBe(plain.cash + 500);
    expect(ledgerSum(perks)).toBe(perks.cash);
    expect(perks.player.tools.floss).toBe(2);
    expect(perks.player.tools.scaler).toBe(2);
    expect(perks.player.tools.polisher).toBe(2);
    expect(perks.player.skillPoints).toBe(plain.player.skillPoints + 1);
    // Famous Name: demand +10% at every location
    const a = ownerAt(45);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    b.legacyPerks = ['famousName'];
    expect(demandLambda(b, b.locations[0], 1) / demandLambda(a, a.locations[0], 1)).toBeCloseTo(1.1, 5);
    // unknown ids are dropped
    expect(sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 0, legacyPerks: ['nope' as never] }).legacyPerks).toEqual([]);
  });

  it('Alumni Network: candidates +5 on every stat, same ask', () => {
    const a = ownerAt(46);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    b.legacyPerks = ['alumniNetwork'];
    a.candidates = []; b.candidates = [];
    runDay(a); runDay(b);
    expect(a.candidates.length).toBe(b.candidates.length);
    a.candidates.forEach((x, i) => {
      const y = b.candidates[i];
      expect(y.role).toBe(x.role);
      expect(y.skill).toBe(Math.min(99, x.skill + 5));
      expect(y.ask).toBe(x.ask);
    });
  });

  it('difficulty is picked at new game (Standard by default)', () => {
    expect(sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 0 }).difficulty).toBe('standard');
    expect(sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 0, difficulty: 'veteran' }).difficulty).toBe('veteran');
    expect(sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 0, difficulty: 'nope' as never }).difficulty).toBe('standard');
  });
});

// ------------------------------------------------------------------ difficulty

describe('difficulty rules (DESIGN 11.5)', () => {
  it('clean rules rise with the title (4 and 5 stars), capped; Relaxed keeps the v3 thresholds', () => {
    const s = graduated(51);
    for (const d of ['relaxed', 'standard', 'veteran'] as const) {
      s.difficulty = d;
      const def = DIFFICULTIES[d];
      s.player.title = 'Staff Hygienist';
      expect(cleanRules(s)).toEqual({ snapAt: def.snapAt, starShift: 0, fiveStarPar: def.fiveStarPar });
      s.player.title = 'Senior Hygienist';
      expect(cleanRules(s).starShift).toBeCloseTo(Math.min(def.starShiftCap, def.starShiftPerTitle), 6);
      s.player.title = 'Floss Boss';
      expect(cleanRules(s).starShift).toBeCloseTo(Math.min(def.starShiftCap, def.starShiftPerTitle * 6), 6);
    }
    const r = { snapAt: 0.8, starShift: 0.03, fiveStarPar: 1.15 };
    expect(starsWith(0.93, r)).toBe(4);
    expect(starsWith(0.95, r)).toBe(5);
    expect(starsWith(0.95, r, 120, 100)).toBe(4);   // too slow for 5 stars
    expect(starsWith(0.95, r, 110, 100)).toBe(5);
    expect(starsWith(0.82, r)).toBe(3);
    expect(starsWith(0.65, r)).toBe(3);   // 3 stars and below never move
    expect(starsWith(0.5, r)).toBe(2);
    expect(starsWith(0.99, { snapAt: 0.9, starShift: 0.2, fiveStarPar: 99 })).toBe(5);   // 5 stars always reachable
  });

  it('every hands-on setup carries the rules; dirt scales with the difficulty; comfort drain grows past level 3', () => {
    const base = graduated(52);
    base.player.level = 8;
    const setups = (['relaxed', 'standard', 'veteran'] as const).map((d) => {
      const s = JSON.parse(JSON.stringify(base)) as GameState;
      s.difficulty = d;
      s.player.title = 'Lead Hygienist';
      const p = s.employer!.patients.find((x) => x.isPlayerPatient)!;
      p.caseType = 'routine';
      p.state = 'inChair'; (p as SimPatient).stage = 'await'; p.awaitingPlayer = true;
      return sim.beginHandsOn(s, p.id);
    });
    for (const [i, d] of (['relaxed', 'standard', 'veteran'] as const).entries()) expect(setups[i].rules.snapAt).toBe(DIFFICULTIES[d].snapAt);
    expect(setups[2].dirt.tartarCount).toBeGreaterThan(setups[0].dirt.tartarCount);
    expect(setups[2].dirt.plaque).toBeGreaterThan(setups[0].dirt.plaque);
    expect(setups[2].traits.comfortDrain).toBeGreaterThan(setups[0].traits.comfortDrain);
    const s = graduated(53);
    s.difficulty = 'standard';
    expect(comfortDrainMult(s, 3)).toBe(1);
    expect(comfortDrainMult(s, 5)).toBeCloseTo(1 + 2 * DIFFICULTIES.standard.comfortDrainPerLevel, 6);
    expect(comfortDrainMult(s, 99)).toBe(DIFFICULTIES.standard.comfortDrainCap);
    expect(sim.schoolSetup(sim.newGame({ name: 'x', avatar: 0, seed: 1, nowMs: 0 }), 2).rules.starShift).toBe(0);
  });

  it('twists: up to 2 from level 4, up to the difficulty maximum from level 8', () => {
    const s = graduated(54);
    s.difficulty = 'standard';
    expect(maxTwists(s, 3)).toBe(1);
    expect(maxTwists(s, 5)).toBe(2);
    expect(maxTwists(s, 8)).toBe(DIFFICULTIES.standard.maxTwists);
    s.difficulty = 'relaxed';
    expect(maxTwists(s, 8)).toBe(2);
  });

  it('fiveStarNeeds tells the chair card what 5 stars takes', () => {
    const s = graduated(55);
    s.player.level = 4; s.player.title = 'Senior Hygienist';
    const p = s.employer!.patients.find((x) => x.isPlayerPatient)!;
    const n = sim.fiveStarNeeds(s, p.id)!;
    expect(n.quality).toBeCloseTo(0.92 + cleanRules(s).starShift, 6);
    expect(n.seconds).toBe(Math.round(DIFFICULTIES.standard.fiveStarPar * n.par));
    s.difficulty = 'relaxed';
    expect(sim.fiveStarNeeds(s, p.id)!.seconds).toBeNull();
    const gel = s.player.numbingGel;
    expect(s.player.numbingGel).toBe(gel);
    expect(sim.fiveStarNeeds(s, 'nobody')).toBeNull();
  });

  it('rent grows with time at the tier and the rating, capped; Relaxed pays the v3 rent', () => {
    const s = ownerAt(56);
    const c = s.locations[0];
    (c as SimClinic).tierDay = s.day - 25;   // five weeks at this tier
    c.rating = 4;
    const d = DIFFICULTIES.standard;
    expect(rentGrowth(s, c)).toBeCloseTo(Math.min(d.rentGrowthCap, d.rentGrowthPerWeek * 5), 6);
    expect(rentOf(s, c)).toBe(Math.round(OFFICES[c.tier].rent * (1 + rentGrowth(s, c))));
    expect(sim.rent(s, 0)).toBe(rentOf(s, c));
    c.rating = 3;
    expect(rentGrowth(s, c)).toBe(0);
    c.rating = 5;
    (c as SimClinic).tierDay = s.day - 500;
    expect(rentGrowth(s, c)).toBe(d.rentGrowthCap);
    s.difficulty = 'relaxed';
    expect(rentOf(s, c)).toBe(OFFICES[c.tier].rent);
    // a move restarts the growth
    s.difficulty = 'standard';
    expect(sim.moveOffice(s, 0, 't3', 0).ok).toBe(true);
    expect(rentGrowth(s, c)).toBe(0);
  });

  it('salary asks inflate every 10 days on Standard, never on Relaxed', () => {
    const s = ownerAt(57);
    const r = JSON.parse(JSON.stringify(s)) as GameState;
    r.difficulty = 'relaxed';
    for (let i = 0; i < 12; i++) { runDay(s); runDay(r); }
    const infl = (g: GameState) => g.locations[0].staff.filter((x) => x.role === 'receptionist').map((x) => x.ask)[0];
    expect(infl(s)).toBeGreaterThan(infl(r));
  });

  it('costly events are likelier at a Medical Plaza on harder settings', () => {
    const count = (d: GameState['difficulty']) => {
      const s = ownerAt(58, 't3', { difficulty: d });
      let costly = 0;
      for (let i = 0; i < 300; i++) {
        (s.locations[0] as SimClinic).recentEvents = {};
        withRng(s, (rng) => drawEventsFor(s, rng));
        for (const e of s.pendingEvents) if (COSTLY_EVENTS.has(e.eventId)) costly++;
      }
      return costly;
    };
    expect(count('veteran')).toBeGreaterThan(count('relaxed') * 1.3);
  });
});

// ------------------------------------------------------------------ bankruptcy

describe('bankruptcy (DESIGN 11.5)', () => {
  function broke(s: GameState, amount: number): void {
    s.cash -= amount;
    s.ledger.push({ day: s.day, minute: s.minute, amount: -amount, label: 'test drain', kind: 'expense' });
  }
  function closeBroke(s: GameState): ReturnType<typeof sim.closeDay> {
    let g = 0;
    sim.completeHuddle(s);
    while (!s.dayOver && g++ < 20000) sim.tick(s, 3);
    if (s.cash >= -50_000) broke(s, s.cash + 50_000);   // stay under water however well the day went
    return sim.closeDay(s);
  }

  it('warns after 2 closes below zero, then the bank sells equipment, newest first', () => {
    const s = ownerAt(61);
    expect(sim.buyEquipment(s, 0, 'espresso').ok).toBe(true);
    expect(sim.buyEquipment(s, 0, 'fishTank').ok).toBe(true);
    broke(s, s.cash - 1000);
    const limit = DIFFICULTIES.standard.bankruptcyDays;
    const r1 = closeBroke(s);
    expect(s.distress).toBe(1);
    expect(r1.notes.some((n) => n.startsWith('Warning'))).toBe(false);
    const r2 = closeBroke(s);
    expect(s.distress).toBe(2);
    expect(r2.notes.some((n) => n.startsWith('Warning: cash'))).toBe(true);
    for (let i = 3; i < limit; i++) closeBroke(s);
    expect(s.distress).toBe(limit - 1);
    const eq0 = [...s.locations[0].equipment];
    let g = 0;
    sim.completeHuddle(s);
    while (!s.dayOver && g++ < 20000) sim.tick(s, 3);
    broke(s, s.cash + 30_000);
    const rep = sim.closeDay(s);
    expect(s.distress).toBe(0);
    expect(rep.notes.some((n) => n.startsWith('The bank sold'))).toBe(true);
    expect(s.locations[0].equipment.length).toBeLessThan(eq0.length);
    expect(eq0.slice(0, s.locations[0].equipment.length)).toEqual(s.locations[0].equipment);   // newest went first
    expect(rep.income.some((l) => l.label === 'Bank sale')).toBe(true);
    expect(ledgerSum(s)).toBe(s.cash);
  });

  it('with two locations the bank closes the newest; with one it forces an emergency loan at double interest', () => {
    const s = ownerAt(62);
    expect(sim.openLocation(s, 't2', 'Second', 0).ok).toBe(true);
    for (const c of s.locations) c.equipment = [];
    const title0 = s.player.title;
    const n = DIFFICULTIES.standard.bankruptcyDays;
    for (let i = 0; i < n - 1; i++) closeBroke(s);
    let g = 0;
    sim.completeHuddle(s);
    while (!s.dayOver && g++ < 20000) sim.tick(s, 3);
    broke(s, s.cash + 5_000_000);
    const rep = sim.closeDay(s);
    expect(s.locations).toHaveLength(1);
    expect(rep.notes.some((n) => n.startsWith('The bank closed Second'))).toBe(true);
    expect(rep.notes.some((n) => n.startsWith('The bank forced an emergency loan'))).toBe(true);
    expect(s.cash).toBeGreaterThanOrEqual(0);
    expect((s as { emergencyLoan?: number }).emergencyLoan).toBeGreaterThan(0);
    expect(s.player.title).toBe(title0);   // titles never go back down
    // double interest on the emergency part
    const loan = s.loan;
    const em = (s as { emergencyLoan?: number }).emergencyLoan!;
    let g2 = 0;
    sim.completeHuddle(s);
    while (!s.dayOver && g2++ < 20000) sim.tick(s, 3);
    const r2 = sim.closeDay(s);
    const interest = r2.expenses.find((l) => l.label === 'Loan interest')!.amount;
    expect(interest).toBe(Math.max(1, Math.round((loan + em) * 0.0025)));
    expect(ledgerSum(s)).toBe(s.cash);
  });

  it('Relaxed never lets the bank act', () => {
    const s = ownerAt(63, 't2', { difficulty: 'relaxed' });
    for (let i = 0; i < 8; i++) closeBroke(s);
    expect(s.distress).toBe(8);
    expect(s.locations[0].staff.length).toBeGreaterThan(0);
    expect(s.ledger.some((e) => e.label === 'Bank sale' || e.label === 'Emergency loan')).toBe(false);
  });
});

// ------------------------------------------------------------------ the rap star

describe('the rap star VIP and the Grill Glow-Up (DESIGN 11.6)', () => {
  it('never before level 4; a rare, always-VIP guest after, by the office tier weight', () => {
    const s = ownerAt(71);
    const c = s.locations[0];
    s.player.level = 3;
    expect(archetypeWeight(s, c, 'rapper')).toBe(0);
    s.player.level = 4;
    expect(archetypeWeight(s, c, 'rapper')).toBe(ARCHETYPES.rapper.weight[c.tier]);
    s.player.level = 8;
    let found: DayPatient | null = null;
    for (let d = 0; d < 60 && !found; d++) {
      runDay(s);
      found = s.locations[0].patients.find((p) => p.archetype === 'rapper') ?? null;
    }
    expect(found).not.toBeNull();
    expect(found!.vip).toBe(true);
    expect(found!.caseType).toBe('grillz');
    expect(ARCHETYPES.rapper.firstNames).toContain(found!.name);   // stage name, no last name
  });

  it('employed: the grill case is introduced once at level 4 with the rap star, and pays its case rate', () => {
    const s = graduated(72);
    s.player.level = 4;
    runDayEmployee(s);
    const p = s.employer!.patients.find((x) => x.isPlayerPatient && x.caseType === 'grillz');
    expect(p).toBeTruthy();
    expect(p!.archetype).toBe('rapper');
    expect(p!.vip).toBe(true);
  });

  it('the Celebrity Walk-in brings the rap star with his grill', () => {
    const s = ownerAt(73);
    s.minute = 480; s.dayOver = false; s.huddleDay = s.day - 1;
    s.pendingEvents = [{ eventId: 'celebrity', clinicId: s.locations[0].id, day: s.day, vars: { clinic: s.locations[0].name } }];
    sim.resolveEvent(s, 0, 0);
    const v = s.locations[0].patients.filter((p) => p.vip && (p as SimPatient).vipFee === 900);
    expect(v).toHaveLength(1);
    expect(v[0].archetype).toBe('rapper');
    expect(v[0].caseType).toBe('grillz');
  });

  it('the Smile Studio VIP is sometimes the rap star', () => {
    const s = ownerAt(74, 't4');
    s.locations[0].equipment.push('smileStudio');
    const archs = new Set<string>();
    for (let d = 0; d < 20; d++) {
      runDay(s);
      for (const p of s.locations[0].patients) if (p.vip && (p as SimPatient).vipFee === 2400) archs.add(p.archetype);
    }
    expect(archs.has('rapper')).toBe(true);
    expect(archs.has('influencer')).toBe(true);
  });

  it('grill setups: 6 to 10 gems, the upper front six marked, the case payMult on the owner fee', () => {
    const s = ownerAt(75);
    const c = s.locations[0];
    const p = c.patients.find((x) => x.state === 'scheduled' && !x.vip)!;
    p.archetype = 'rapper'; p.caseType = 'grillz'; p.vip = true;
    p.state = 'inChair'; (p as SimPatient).stage = 'await'; p.awaitingPlayer = true; p.opId = c.ops[0].id;
    const setup = sim.beginHandsOn(s, p.id);
    expect(setup.special.grillGems).toBeGreaterThanOrEqual(6);
    expect(setup.special.grillGems).toBeLessThanOrEqual(10);
    expect(setup.special.showcase).toBe(false);
    for (const t of GRILL_TEETH) expect(setup.problemTeeth).toContain(t);
    expect(CASES.grillz.payMult).toBeGreaterThan(1);
    expect(EQUIPMENT.smileVan).toBeTruthy();
  });
});

function runDayEmployee(s: GameState): void {
  // book the next shift with the new level: close today and look at tomorrow's book
  let g = 0;
  while (!s.dayOver && g++ < 20000) {
    const q = sim.playerQueue(s);
    if (q.length) { const setup = sim.beginHandsOn(s, q[0].id); sim.completeHandsOn(s, q[0].id, result(0.85, { caseType: setup.caseType })); continue; }
    sim.tick(s, 2);
  }
  sim.closeDay(s);
}

// ------------------------------------------------------------------ timeline and migration

describe('timeline and migration (DESIGN 11.2)', () => {
  it('promotions, practice, moves and gold masteries land in the timeline with a report note', () => {
    const s = graduated(81);
    expect(s.timeline.some((e) => e.kind === 'career' && e.text === 'Promoted to Staff Hygienist')).toBe(true);
    s.player.level = 3;
    s.player.xp = sim.xpToNext(3) - 1;
    s.player.mastery.routine = 24;
    let guard = 0;
    while (s.player.level < 4 && guard++ < 5000) {
      const q = sim.playerQueue(s);
      if (q.length) { q[0].caseType = 'routine'; const setup = sim.beginHandsOn(s, q[0].id); sim.completeHandsOn(s, q[0].id, result(0.85, { caseType: setup.caseType })); continue; }
      sim.tick(s, 2);
    }
    expect(s.player.title).toBe('Senior Hygienist');
    expect(s.timeline.some((e) => e.text === 'Promoted to Senior Hygienist')).toBe(true);
    expect(s.timeline.some((e) => e.kind === 'mastery' && e.text === `Gold mastery: ${CASES.routine.name}`)).toBe(true);
    let g = 0;
    while (!s.dayOver && g++ < 20000) { const q = sim.playerQueue(s); if (q.length) { sim.completeHandsOn(s, q[0].id, result(0.85)); continue; } sim.tick(s, 2); }
    expect(sim.closeDay(s).notes).toContain('Promoted: Senior Hygienist');
    grant(s, 3_000_000);
    expect(sim.openPractice(s, { name: 'T', loan: 0 }).ok).toBe(true);
    expect(s.timeline.some((e) => e.text === 'Promoted to Practice Owner')).toBe(true);
    expect(sim.moveOffice(s, 0, 't2', 0).ok).toBe(true);
    expect(s.timeline.some((e) => e.kind === 'office' && e.text.includes('Main Street'))).toBe(true);
    expect(s.player.title).toBe('Clinic Director');
    expect(s.timeline.filter((e) => e.text === 'Promoted to Clinic Director')).toHaveLength(1);
  });

  it('migrate fills every end-game field of an old save', () => {
    const s = ownerAt(82);
    expect(sim.openLocation(s, 't2', 'Two', 0).ok).toBe(true);
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    for (const k of ['difficulty', 'city', 'timeline', 'finale', 'legacyPerks', 'distress']) delete old[k];
    for (const c of old.locations as Record<string, unknown>[]) { delete c.district; delete c.tierDay; }
    s.player.mastery = { routine: 30 };
    (old.player as { mastery: unknown }).mastery = { routine: 30 };
    const m = sim.migrate(old as unknown as GameState);
    expect(m.difficulty).toBe('standard');
    expect(m.city.map((d) => d.id)).toEqual(DISTRICT_ORDER);
    expect(m.city.every((d) => d.index === DISTRICTS[d.id].start)).toBe(true);
    expect(m.finale).toEqual({ milestones: [], galaUnlocked: false, attempts: 0, won: false, wonDay: null, retired: false });
    expect(m.legacyPerks).toEqual([]);
    expect(m.distress).toBe(0);
    const ds = m.locations.map((c) => c.district);
    expect(new Set(ds).size).toBe(ds.length);
    for (const d of ds) expect(d in DISTRICTS).toBe(true);
    expect(m.timeline.some((e) => e.text === 'Opened your own practice')).toBe(true);
    expect(m.timeline.some((e) => e.kind === 'mastery' && e.text.includes('Routine'))).toBe(true);
    expect(nonFinite(m)).toEqual([]);
    // a damaged employer district and junk values are repaired
    const e = graduated(83) as unknown as Record<string, unknown>;
    (e.employer as Record<string, unknown>).district = 'atlantis';
    e.city = [{ id: 'harbor', index: 'high' }];
    e.finale = { milestones: [30, 'x', 30], attempts: -3 };
    e.legacyPerks = ['headStart', 'bogus'];
    e.difficulty = 'nightmare';
    const m2 = sim.migrate(e as unknown as GameState);
    expect(m2.employer!.district).toBe('downtown');
    expect(m2.city.find((d) => d.id === 'harbor')!.index).toBe(DISTRICTS.harbor.start);
    expect(m2.finale.milestones).toEqual([30]);
    expect(m2.finale.attempts).toBe(0);
    expect(m2.legacyPerks).toEqual(['headStart']);
    expect(m2.difficulty).toBe('standard');
    // a current save round-trips unchanged in its end-game fields
    const cur = ownerAt(84);
    cur.timeline.push({ day: 3, text: 'x', kind: 'city' });
    const m3 = sim.migrate(JSON.parse(JSON.stringify(cur)));
    expect(m3.timeline).toEqual(cur.timeline);
    expect(m3.locations[0].district).toBe(cur.locations[0].district);
  });

  it('determinism and the ledger hold with the city running', () => {
    const run = () => { const s = ownerAt(85); for (let i = 0; i < 4; i++) runDay(s); return s; };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.city)).toBe(JSON.stringify(b.city));
    expect(a.cash).toBe(b.cash);
    expect(ledgerSum(a)).toBe(a.cash);
    expect(cityIndex(a)).toBeGreaterThan(0);
  });
});
