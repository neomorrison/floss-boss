import { describe, expect, it } from 'vitest';
import type { DistrictState, GameState } from '../src/core/types';
import type { LegacyState } from '../src/core/legacy';
import { DISTRICTS, DISTRICT_ORDER } from '../src/data/city';
import { DIFFICULTIES } from '../src/data/difficulty';
import {
  buyPerk, canBuyPerk, cityIndex, defaultDistrict, distressInfo, districtFill, districtIndex, fiveStarRule, grantsFor, legacyPointsFor,
  locationsByDistrict, milestoneLabel, milestoneView, nextMilestone, promotionLine, rulesFor, runPerks, smileCurve, smilePct, timelineView,
  titleRank, TITLE_ORDER, unseenMilestones, vanDistrict,
} from '../src/ui/endlogic';
import { noDash } from '../src/ui/logic';

const cityAt = (v: number): DistrictState[] => DISTRICT_ORDER.map((id) => ({ id, index: v, served: 0 }));
const legacy = (o: Partial<LegacyState> = {}): LegacyState => ({ points: 0, earned: 0, owned: [], wins: 0, runs: 0, veteranUnlocked: false, ...o });

describe('Smile City', () => {
  it('weights the city index by population and falls back to the starting values', () => {
    expect(cityIndex(cityAt(0.5))).toBeCloseTo(0.5, 6);
    const pop = DISTRICT_ORDER.reduce((a, id) => a + DISTRICTS[id].population, 0);
    const start = DISTRICT_ORDER.reduce((a, id) => a + DISTRICTS[id].start * DISTRICTS[id].population, 0) / pop;
    expect(cityIndex(undefined)).toBeCloseTo(start, 6);
    // only Downtown at 100%: its population share
    const one = cityAt(0).map((d) => (d.id === 'downtown' ? { ...d, index: 1 } : d));
    expect(cityIndex(one)).toBeCloseTo(DISTRICTS.downtown.population / pop, 6);
    expect(districtIndex([], 'harbor')).toBe(DISTRICTS.harbor.start);
  });

  it('shows whole percents like the sim lands milestones', () => {
    expect(smilePct(0.495)).toBe(50);
    expect(smilePct(0.494)).toBe(49);
    expect(smilePct(1.2)).toBe(100);
    expect(smilePct(Number.NaN)).toBe(0);
  });

  it('finds the next milestone and the progress toward it', () => {
    const n = nextMilestone(0.35, [30]);
    expect(n?.milestone.pct).toBe(40);
    expect(n?.from).toBe(30);
    expect(n?.frac).toBeCloseTo(0.5, 6);
    expect(nextMilestone(0.2, [])?.milestone.pct).toBe(30);
    expect(nextMilestone(1, [30, 40, 50, 60, 70, 80, 90, 100])).toBeNull();
    expect(milestoneView(50)?.unlock).toMatch(/Smile Van/);
    expect(milestoneView(30)?.unlock).toBe('');
    expect(milestoneView(33)).toBeNull();
  });

  it('labels milestones without repeating the percent', () => {
    expect(milestoneLabel({ pct: 60, title: 'Smile City 60%' })).toBe('Smile City 60%');
    expect(milestoneLabel({ pct: 50, title: 'Halfway There' })).toBe('Halfway There (50%)');
  });

  it('lists milestones not celebrated yet, once and in order', () => {
    const seen = new Set([30]);
    expect(unseenMilestones([50, 30, 40, 40, 35], (p) => seen.has(p))).toEqual([40, 50]);
    expect(unseenMilestones(undefined, () => false)).toEqual([]);
  });

  it('maps city grants to the milestones just reached', () => {
    const ledger = [{ label: 'Rent', amount: -200 }, { label: 'City grant', amount: 1500 }, { label: 'Fees', amount: 90 }, { label: 'City grant', amount: 2000 }];
    const m = grantsFor([40, 30], ledger);
    expect(m.get(30)).toBe(1500);
    expect(m.get(40)).toBe(2000);
    expect(grantsFor([30, 40, 50], ledger).size).toBe(0);
  });

  it('tints districts from grey to their colour and bends the smile', () => {
    expect(districtFill('#FF0000', 0)).toBe('rgb(205, 214, 216)');
    expect(districtFill('#FF0000', 1)).toBe('rgb(255, 0, 0)');
    expect(smileCurve(0)).toBeLessThan(0);
    expect(smileCurve(1)).toBe(1);
  });

  it('counts locations per district and picks where the next office helps most', () => {
    const locs = [{ district: 'downtown' as const }, { district: 'downtown' as const }, { district: 'uptown' as const }];
    const n = locationsByDistrict(locs);
    expect(n.downtown).toBe(2);
    expect(n.uptown).toBe(1);
    expect(n.harbor).toBe(0);
    const city = cityAt(0.5).map((d) => (d.id === 'harbor' ? { ...d, index: 0.1 } : d.id === 'uptown' ? { ...d, index: 0.05 } : d));
    expect(defaultDistrict(city, locs)).toBe('harbor');
    expect(vanDistrict(city, locs)).toBe('harbor');
    expect(vanDistrict(city, DISTRICT_ORDER.map((d) => ({ district: d })))).toBeNull();
  });
});

describe('difficulty', () => {
  it('builds the five-star rule text from the rules and par', () => {
    expect(fiveStarRule({ starShift: 0.02, fiveStarPar: 1.15, snapAt: 0.8 }, 70).text).toBe('5 stars: 94% and under 1:21');
    expect(fiveStarRule({ starShift: 0, fiveStarPar: 99, snapAt: 0.7 }, 70).text).toBe('5 stars: 92%');
    expect(fiveStarRule(null, 0).seconds).toBeNull();
  });

  it('raises the star shift with the title, capped', () => {
    expect(rulesFor('standard', 'Staff Hygienist').starShift).toBe(0);
    const std = DIFFICULTIES.standard;
    expect(rulesFor('standard', 'Lead Hygienist').starShift).toBeCloseTo(Math.min(std.starShiftCap, std.starShiftPerTitle * 2), 6);
    expect(rulesFor('standard', 'Floss Boss').starShift).toBeCloseTo(DIFFICULTIES.standard.starShiftCap, 6);
    expect(rulesFor('relaxed', 'Floss Boss').starShift).toBe(0);
    expect(rulesFor(undefined, 'Staff Hygienist').fiveStarPar).toBe(DIFFICULTIES.standard.fiveStarPar);
  });

  it('warns about the bank from two closes below zero, never on Relaxed', () => {
    expect(distressInfo({ distress: 1, difficulty: 'standard', phase: 'owner' }).show).toBe(false);
    const d = distressInfo({ distress: 3, difficulty: 'standard', phase: 'owner' });
    expect(d.show).toBe(true);
    expect(d.left).toBe(DIFFICULTIES.standard.bankruptcyDays - 3);
    expect(distressInfo({ distress: 4, difficulty: 'relaxed', phase: 'owner' }).show).toBe(false);
    expect(distressInfo({ distress: 4, difficulty: 'standard', phase: 'employee' }).show).toBe(false);
  });
});

describe('titles and Legacy', () => {
  it('ranks the titles and has a Dr. Canal line for each, without em dashes', () => {
    expect(titleRank('Staff Hygienist')).toBe(0);
    expect(titleRank('Floss Boss')).toBe(6);
    expect(titleRank('Hygiene Student')).toBe(-1);
    for (const t of TITLE_ORDER) {
      const line = promotionLine(t);
      expect(line.length).toBeGreaterThan(10);
      expect(noDash(line)).toBe(line);
    }
  });

  it('counts Legacy points like DESIGN 11.4', () => {
    const s = { achievements: Array.from({ length: 11 }, (_, i) => `a${i}`), player: { mastery: { routine: 25, candy: 30, pirate: 9 } }, finale: { won: true } } as unknown as GameState;
    const r = legacyPointsFor(s, 12_500_000);
    expect(r.total).toBe(5 + 2 + 2 + 10);
    expect(r.parts.map((p) => p.label)).toContain('Golden Molar');
    const none = legacyPointsFor({ achievements: [], player: { mastery: {} } } as unknown as GameState, 0);
    expect(none.total).toBe(0);
  });

  it('buys each perk once with enough points', () => {
    const l = legacy({ points: 3 });
    expect(canBuyPerk(l, 'famousName').ok).toBe(false);
    const a = buyPerk(l, 'headStart');
    expect(a.points).toBe(1);
    expect(a.owned).toEqual(['headStart']);
    expect(buyPerk(a, 'headStart')).toBe(a);
    expect(canBuyPerk(a, 'headStart').reason).toBe('Owned');
    expect(runPerks(['goldScrubs', 'headStart'], new Set(['headStart', 'prodigy', 'goldScrubs']))).toEqual(['headStart', 'goldScrubs']);
  });

  it('tells the timeline in order and keeps the start and the latest when long', () => {
    const t = timelineView([{ day: 2, text: 'b', kind: 'career' }, { day: 9, text: 'c', kind: 'city' }, { day: 1, text: 'a', kind: 'office' }, { day: 2, text: 'b2', kind: 'career' }]);
    expect(t.map((e) => e.text)).toEqual(['a', 'b', 'b2', 'c']);
    const long = Array.from({ length: 100 }, (_, i) => ({ day: i, text: `e${i}`, kind: 'career' as const }));
    const v = timelineView(long, 20);
    expect(v.length).toBe(20);
    expect(v[0].text).toBe('e0');
    expect(v[19].text).toBe('e99');
  });
});
