// The v4 clean work (DESIGN 11.3, 11.5, 11.6): difficulty rules drive the snap point and the stars (the same
// starsWith the sim uses), the Grill Glow-Up case, the gala showcase crowd meter, and the whitening coat
// threshold that the outline, the checklist and the lamp now share.
import { describe, expect, it } from 'vitest';
import {
  applyGel, applyGemBuff, applyGrillHold, applyLamp, applyPolisher, applyScaler, CELLS, cellCenterU, cellCenterV, cheat, createModel,
  CROWD, crowdDelta, fractions, gelCoverage, gelNeed, gelReady, GEM_TEETH, GRILL_TEETH, liveStars, parFor, PAR_PER_GEM, qualityFor,
  RATES, scoreClean, snapAt, tickCrowd, tickModel, toothDone, underGrillDone, updateObjectives, visibleCell,
  type CleanEvent, type CleanModel, type TickInput,
} from '../src/clean/dirt';
import { buildSetup, NO_RULES, rulesFor } from '../src/clean/setup';
import { fiveStarLine } from '../src/clean/hud';
import { starsWith as coreStarsWith, fiveStarNeeds } from '../src/core/stars';
import { cleanRules, starsWith as simStarsWith } from '../src/sim/difficulty';
import { buildCaseSetup } from '../src/sim/cases';
import { fiveStarRule } from '../src/ui/endlogic';
import { DIFFICULTIES } from '../src/data/difficulty';
import { graduated } from './sim.helpers';
import type { CleanSetup, GameState } from '../src/core/types';

const idle = (dt: number, extra: Partial<TickInput> = {}): TickInput => ({
  dt, working: false, molar: false, gum: false, gumRisk: 1, headphones: false, numbing: false, ...extra,
});

/** Pop a tooth's tartar and leave `left` of its plaque and stain (0..1). */
function cleanTo(m: CleanModel, i: number, left: number) {
  for (const d of m.tartar) if (d.tooth === i) { d.popped = true; d.hp = 0; }
  const t = m.teeth[i];
  for (let c = 0; c < CELLS; c++) { t.plaque[c] *= left; t.stain[c] *= left; }
}

/** Scrape and polish tooth i the way a player does until it snaps (or the time runs out). */
function scrubTooth(m: CleanModel, i: number, seconds = 20) {
  for (const d of m.tartar) {
    if (d.tooth !== i) continue;
    for (let n = 0; n < 3000 && !d.popped; n++) applyScaler(m, i, d.u, d.v, RATES.strokeCap / 60, 1 / 60);
  }
  for (let k = 0; k < seconds * 60 && !m.teeth[i].snapped; k++) {
    const u = 0.32 + 0.36 * ((k * 7) % 60) / 60;
    const v = k % 3 === 2 ? 0.93 : 0.08 + 0.7 * ((k * 13) % 50) / 50;
    applyPolisher(m, i, u, v, 1 / 60, 1, 1);
  }
}

function stateAt(difficulty: GameState['difficulty'], title: string): GameState {
  const s = graduated(61);
  s.difficulty = difficulty;
  s.player.title = title;
  return s;
}

describe('difficulty rules in the clean (DESIGN 11.5)', () => {
  it('the snap point is rules.snapAt: 84% removed snaps on Standard (0.8) but not on Veteran (0.88)', () => {
    for (const [rules, snaps] of [[rulesFor('standard'), true], [rulesFor('veteran'), false], [NO_RULES, true]] as const) {
      const m = createModel(buildSetup({ caseType: 'routine', seed: 4, level: 3, rules }));
      expect(snapAt(m)).toBe(rules.snapAt);
      const i = m.problem.find((x) => m.teeth[x].plaque0 + m.teeth[x].stain0 > 1)!;
      cleanTo(m, i, 0.16);
      expect(toothDone(m, i)).toBe(snaps);
      cleanTo(m, i, 0.11);
      expect(toothDone(m, i)).toBe(true);
    }
  });

  it('area objectives count snapAt of a layer as all of it', () => {
    const std = createModel(buildSetup({ caseType: 'routine', seed: 4, level: 3, rules: rulesFor('standard') }));
    const vet = createModel(buildSetup({ caseType: 'routine', seed: 4, level: 3, rules: rulesFor('veteran') }));
    for (const m of [std, vet]) {
      for (const i of m.problem) { const t = m.teeth[i]; for (let c = 0; c < CELLS; c++) t.plaque[c] *= 0.16; }
      updateObjectives(m, true);
    }
    const p = (m: CleanModel) => m.objectives.find((o) => o.id === 'plaque')!.progress;
    expect(p(std)).toBeCloseTo(1, 6);
    expect(p(vet)).toBeCloseTo(0.84 / 0.88, 2);
  });

  it('result stars, live stars and the sim use one function: Standard and Veteran rules from the sim', () => {
    for (const [diff, title] of [['standard', 'Lead Hygienist'], ['veteran', 'Clinic Director'], ['standard', 'Staff Hygienist'], ['relaxed', 'Floss Boss']] as const) {
      const rules = cleanRules(stateAt(diff, title));
      const d = DIFFICULTIES[diff];
      expect(rules.snapAt).toBe(d.snapAt);
      expect(simStarsWith).toBe(coreStarsWith);   // the sim re-exports the very same function
      for (const frac of [0.3, 0.6, 0.8, 0.9, 1]) {
        const m = createModel(buildSetup({ caseType: 'grillz', seed: 7, level: 5, rules }));
        cheat(m, frac);
        for (const seconds of [30, m.setup.parSeconds, m.setup.parSeconds * 1.1, m.setup.parSeconds * 1.3]) {
          const r = scoreClean(m, 'done', seconds);
          const want = coreStarsWith(r.quality, rules, seconds, m.setup.parSeconds);
          expect(r.stars).toBe(want);
          expect(liveStars(m, seconds)).toBe(want);
          expect(r.quality).toBeCloseTo(qualityFor(fractions(m).clean, m.comfort, false), 9);
        }
      }
    }
    // a perfect clean: Standard 5 stars within 1.15 x par, 4 past it; Veteran needs par itself
    const std = rulesFor('standard', 3), vet = rulesFor('veteran', 3);
    for (const [rules, mult] of [[std, 1.15], [vet, 1]] as const) {
      const m = createModel(buildSetup({ caseType: 'grillz', seed: 8, level: 5, rules }));
      cheat(m, 1);
      m.comfort = 100;
      const par = m.setup.parSeconds;
      expect(scoreClean(m, 'done', par * mult - 1).stars).toBe(5);
      expect(scoreClean(m, 'done', par * mult + 1).stars).toBe(4);
    }
    // quality between the shifted and unshifted five-star bar: 4 stars under a shift, 5 without
    expect(coreStarsWith(0.93, std)).toBe(4);
    expect(coreStarsWith(0.93, NO_RULES)).toBe(5);
  });

  it('the intro line matches the chair card line (fiveStarNeeds)', () => {
    const setup = buildSetup({ caseType: 'grillz', seed: 3, level: 4, rules: rulesFor('standard', 2) });
    const n = fiveStarNeeds(setup.rules, setup.parSeconds);
    expect(fiveStarLine(setup)).toBe(fiveStarRule(setup.rules, setup.parSeconds).text);
    expect(fiveStarLine(setup)).toMatch(new RegExp(`^5 stars: ${Math.round(n.quality * 100)}% and under \\d+:\\d\\d$`));
    expect(fiveStarLine({ ...setup, rules: rulesFor('relaxed') })).toBe('5 stars: 92%');
    expect(fiveStarLine({ ...setup, rules: undefined as unknown as CleanSetup['rules'] })).toBeNull();
  });
});

describe('Grill Glow-Up (DESIGN 11.6)', () => {
  it('the harness setup: the upper front six always marked, 6 to 10 gems (12 on the showcase), par per gem', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = buildSetup({ caseType: 'grillz', seed, level: 4 });
      expect(s.patient.archetype).toBe('rapper');
      for (const t of GRILL_TEETH) expect(s.problemTeeth).toContain(t);
      expect(s.special.grillGems).toBeGreaterThanOrEqual(6);
      expect(s.special.grillGems).toBeLessThanOrEqual(10);
      expect(s.special.showcase).toBe(false);
      expect(s.parSeconds).toBe(Math.round(parFor(s)));
    }
    const g = buildSetup({ caseType: 'grillz', seed: 2, showcase: true, level: 8 });
    expect(g.special.grillGems).toBe(12);
    expect(g.special.showcase).toBe(true);
    const a = buildSetup({ caseType: 'grillz', seed: 2, gems: 6 }), b = buildSetup({ caseType: 'grillz', seed: 2, gems: 10 });
    expect(parFor(b) - parFor(a)).toBeCloseTo(4 * PAR_PER_GEM, 6);
    expect(GEM_TEETH.slice(0, 6).sort()).toEqual([...GRILL_TEETH].sort());   // six gems: one on every tooth
  });

  it('plays the sim setup as built: objectives in order, par equal to the sim', () => {
    const state = graduated(71);
    for (const showcase of [false, true]) {
      const setup = buildCaseSetup(state, {
        patientId: 'vip', name: 'Lil Molar', archetype: 'rapper', service: 'cleaning', caseType: 'grillz', twists: [],
        dirtLevel: 0.6, level: showcase ? 8 : 4, tutorial: false, consumeGel: false, firstOfCase: false, showcase,
      });
      expect(setup.parSeconds).toBe(Math.round(parFor(setup)));
      const m = createModel(setup);
      expect(m.grill!.gems.length).toBe(setup.special.grillGems);
      const ids = m.objectives.map((o) => o.id);
      expect(ids.slice(0, 3)).toEqual(['grill', 'under', 'gems']);
      expect(ids[ids.length - 1]).toBe('finish');
      expect(m.objectives.find((o) => o.id === 'grill')!.label).toBe('Take out the grill');
      expect(m.objectives.find((o) => o.id === 'under')!.label).toBe('Clean under the grill');
      expect(m.objectives.find((o) => o.id === 'gems')!.count).toBe(setup.special.grillGems);
      expect(m.crowd >= 0).toBe(showcase);
      // the gunk under the grill: a band on every tooth it covers and all the tartar lumps
      for (const i of m.grill!.teeth) expect(m.teeth[i].plaque0).toBeGreaterThan(0.5);
      expect(m.tartar.length).toBeGreaterThan(0);
      for (const d of m.tartar) expect(GRILL_TEETH).toContain(d.tooth);
      expect(m.debris.length).toBe(0);
      cheat(m, 1);
      const r = scoreClean(m, 'done', 60);
      expect(r.objectives.every((o) => o.done)).toBe(true);
      expect(r.clean).toBe(1);
    }
  });

  it('hold 0.6 s to take the grill out; the teeth under it are out of reach until then', () => {
    const m = createModel(buildSetup({ caseType: 'grillz', seed: 5, level: 4, gems: 8 }));
    const g = m.grill!;
    expect(g.state).toBe('in');
    const d = m.tartar[0];
    const hp = d.hp;
    for (let k = 0; k < 30; k++) applyScaler(m, d.tooth, d.u, d.v, RATES.strokeCap / 60, 1 / 60);
    expect(d.hp).toBe(hp);   // under the grill: nothing happens
    // a short hold runs back down when let go
    for (let k = 0; k < 18; k++) { applyGrillHold(m, 1 / 60); tickModel(m, idle(1 / 60)); }
    expect(g.hold).toBeCloseTo(0.3, 5);
    for (let k = 0; k < 30; k++) tickModel(m, idle(1 / 60));
    expect(g.hold).toBe(0);
    // a full hold takes it out at 0.6 s
    let f = 0, frames = 0;
    while (g.state === 'in' && frames < 120) { f = applyGrillHold(m, 1 / 60); tickModel(m, idle(1 / 60)); frames++; }
    expect(f).toBe(1);
    expect(frames).toBe(Math.round(RATES.grillHold * 60));
    expect(m.events.filter((e) => e.type === 'grillOut').length).toBe(1);
    expect(m.objectives.find((o) => o.id === 'grill')!.done).toBe(true);
    expect(applyGrillHold(m, 1 / 60)).toBe(-1);
    // now the tartar scrapes off
    for (let k = 0; k < 300 && !d.popped; k++) applyScaler(m, d.tooth, d.u, d.v, RATES.strokeCap / 60, 1 / 60);
    expect(d.popped).toBe(true);
  });

  it('clean under the grill, it snaps back in, then buff every diamond (the gem pitch climbs)', () => {
    const m = createModel(buildSetup({ caseType: 'grillz', seed: 6, level: 4, gems: 10 }));
    const g = m.grill!;
    while (g.state === 'in') { applyGrillHold(m, 1 / 60); tickModel(m, idle(1 / 60)); }
    // diamonds cannot be buffed while the grill sits on the tray
    expect(applyGemBuff(m, 0, 1 / 60)).toBe(0);
    const under = m.objectives.find((o) => o.id === 'under')!;
    for (const i of g.teeth) {
      scrubTooth(m, i);
      expect(m.teeth[i].snapped).toBe(true);
      tickModel(m, idle(1 / 60));
      if (!underGrillDone(m)) expect(under.progress).toBeLessThan(1);
    }
    expect(under.done).toBe(true);
    expect(g.state).toBe('back');
    expect(m.events.filter((e) => e.type === 'grillBack').length).toBe(1);
    // back in: the teeth are covered again
    expect(applyScaler(m, g.teeth[0], 0.5, 0.3, 0.04, 1 / 60).plaque).toBe(0);
    // buffing: the Prophy Angle finishes a stone in about 0.6 to 1.2 s; its partner on the same tooth shines along
    const gem = g.gems[0];
    const twin = g.gems.find((x) => x !== gem && x.tooth === gem.tooth)!;
    let k = 0;
    while (!gem.done && k < 300) { applyGemBuff(m, gem.id, 1 / 60, 1); tickModel(m, idle(1 / 60)); k++; }
    expect(k / 60).toBeGreaterThan(0.5);
    expect(k / 60).toBeLessThan(1.2);
    expect(twin.shine).toBeCloseTo(RATES.gemShare, 2);
    expect(twin.done).toBe(false);
    for (const x of g.gems) for (let n = 0; n < 300 && !x.done; n++) { applyGemBuff(m, x.id, 1 / 60, 1); tickModel(m, idle(1 / 60)); }
    const done = m.events.filter((e): e is Extract<CleanEvent, { type: 'gemDone' }> => e.type === 'gemDone');
    expect(done.map((e) => e.n)).toEqual(g.gems.map((_, i) => i + 1));
    const gems = m.objectives.find((o) => o.id === 'gems')!;
    expect(gems.have).toBe(10);
    expect(gems.done).toBe(true);
    expect(applyGemBuff(m, gem.id, 1 / 60)).toBe(0);   // a finished stone takes no more
  });

  it('only the grill case has a grill; a grill with no gems has no diamond row', () => {
    expect(createModel(buildSetup({ caseType: 'routine', seed: 3 })).grill).toBeNull();
    const m = createModel(buildSetup({ caseType: 'grillz', seed: 3, gems: 0 }));
    expect(m.grill!.gems.length).toBe(0);
    expect(m.objectives.some((o) => o.id === 'gems')).toBe(false);
  });
});

describe('the gala crowd meter (DESIGN 11.3)', () => {
  it('rises with pops, snaps, ticks and gems, dips on slips, stays within 0..1, cheers once per threshold', () => {
    const m = createModel(buildSetup({ caseType: 'grillz', seed: 4, showcase: true, level: 8 }));
    expect(m.crowd).toBe(CROWD.start);
    expect(crowdDelta({ type: 'toothSnap', tooth: 5, n: 1 })).toBeGreaterThan(0);
    expect(crowdDelta({ type: 'ow' })).toBeLessThan(0);
    expect(crowdDelta({ type: 'hic' })).toBe(0);
    // a long run of pops cannot push it past 1, and passes each cheer threshold once
    for (let k = 0; k < 60; k++) { m.events.push({ type: 'toothSnap', tooth: 5, n: k + 1 }); tickCrowd(m, 1 / 60); }
    expect(m.crowd).toBeLessThanOrEqual(1);
    expect(m.crowd).toBeGreaterThan(0.95);
    const cheers = m.events.filter((e) => e.type === 'crowdCheer');
    expect(cheers.length).toBe(CROWD.cheers.length);
    // the same events are never counted twice
    const v = m.crowd;
    tickCrowd(m, 0);
    expect(m.crowd).toBe(v);
    // slips pull it down, never below 0
    for (let k = 0; k < 40; k++) { m.events.push({ type: 'ow' }); tickCrowd(m, 1 / 60); }
    expect(m.crowd).toBe(0);
    // climbing again re-arms the cheers
    for (let k = 0; k < 60; k++) { m.events.push({ type: 'objective', obj: m.objectives[0] }); tickCrowd(m, 1 / 60); }
    expect(m.events.filter((e) => e.type === 'crowdCheer').length).toBe(2 * CROWD.cheers.length);
    // a warm crowd settles back slowly, never under the start
    const s = createModel(buildSetup({ caseType: 'grillz', seed: 4, showcase: true, level: 8 }));
    s.events.push({ type: 'grillOut' }, { type: 'toothSnap', tooth: 4, n: 1 });
    tickCrowd(s, 0);
    const hot = s.crowd;
    for (let k = 0; k < 600; k++) tickCrowd(s, 1 / 60);
    expect(s.crowd).toBeLessThan(hot);
    expect(s.crowd).toBeGreaterThanOrEqual(CROWD.start);
  });

  it('follows the real clean: taking the grill out and snapping teeth raises it, a gum slip lowers it', () => {
    const m = createModel(buildSetup({ caseType: 'grillz', seed: 9, showcase: true, level: 8 }));
    while (m.grill!.state === 'in') { applyGrillHold(m, 1 / 60); tickModel(m, idle(1 / 60)); }
    const afterOut = m.crowd;
    expect(afterOut).toBeGreaterThan(CROWD.start);
    scrubTooth(m, m.grill!.teeth[0]);
    tickModel(m, idle(1 / 60));
    expect(m.crowd).toBeGreaterThan(afterOut);
    const before = m.crowd;
    for (let k = 0; k < 20; k++) tickModel(m, idle(1 / 60, { working: true, gum: true }));
    expect(m.gumHits).toBe(1);
    expect(m.crowd).toBeLessThan(before);
    // no showcase, no crowd
    const plain = createModel(buildSetup({ caseType: 'grillz', seed: 9 }));
    tickModel(plain, idle(1 / 60));
    expect(plain.crowd).toBe(-1);
  });
});

describe('whitening: one coat threshold (the verifier edge case)', () => {
  /** Paint whole face cells of tooth i until `share` of its gel face is coated. */
  function coat(m: CleanModel, i: number, share: number) {
    const t = m.teeth[i];
    const cells: number[] = [];
    for (let c = 0; c < CELLS; c++) if (t.reach[c] && visibleCell(t.kind, cellCenterU(c), cellCenterV(c)) && cellCenterV(c) >= 0.03) cells.push(c);
    t.gel.fill(0);
    for (let k = 0; k < Math.round(cells.length * share); k++) t.gel[cells[k]] = 1;
    return cells.length;
  }

  it('a tooth at 45 to 59% neither cures nor loses its outline; the outline dims with a partial coat', () => {
    const m = createModel(buildSetup({ caseType: 'whitening', seed: 3 }));
    const i = m.teeth.find((t) => t.gelTarget && t.present)!.index;
    const shade0 = m.teeth[i].shade;
    expect(gelNeed(m, i)).toBe(1);
    coat(m, i, 0.5);
    expect(gelCoverage(m, i)).toBeGreaterThanOrEqual(0.45);
    expect(gelCoverage(m, i)).toBeLessThan(RATES.gelDone);
    expect(gelReady(m, i)).toBe(false);
    const partial = gelNeed(m, i);
    expect(partial).toBeGreaterThan(0.3);
    expect(partial).toBeLessThan(1);
    for (let f = 0; f < 60; f++) { applyLamp(m, i, 1 / 60); tickModel(m, idle(1 / 60)); }
    expect(m.teeth[i].shade).toBe(shade0);   // the old gate (0.45) would have cured here
    // brushing past the threshold: the coat snaps full, the outline goes, the lamp cures
    for (let f = 0; f < 30 && !gelReady(m, i); f++) applyGel(m, i, 0.5, 0.45, 1 / 60, f / 60);
    expect(gelReady(m, i)).toBe(true);
    expect(gelCoverage(m, i)).toBe(1);
    expect(m.teeth[i].gelled).toBe(true);
    expect(gelNeed(m, i)).toBe(0);
    for (let f = 0; f < 40; f++) { applyLamp(m, i, 1 / 60); tickModel(m, idle(1 / 60)); }
    expect(m.teeth[i].shade).toBeLessThan(shade0);
  });

  it('the outline comes back if the coat washes off before the tooth reaches its shade, and stays off once it does', () => {
    const m = createModel(buildSetup({ caseType: 'whitening', seed: 5 }));
    const t = m.teeth.find((x) => x.gelTarget && x.present)!;
    coat(m, t.index, 1);
    expect(gelNeed(m, t.index)).toBe(0);
    coat(m, t.index, 0.2);
    expect(gelNeed(m, t.index)).toBeGreaterThan(0.5);
    t.shade = Math.max(1, m.setup.special.targetShade);
    expect(gelNeed(m, t.index)).toBe(0);
    // cheat paints the coat with the checklist, so they agree
    const c = createModel(buildSetup({ caseType: 'whitening', seed: 5 }));
    cheat(c, 0.5);
    for (const x of c.teeth) if (x.gelled && x.gelTarget) expect(gelReady(c, x.index)).toBe(true);
  });
});
