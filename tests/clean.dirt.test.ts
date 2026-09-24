import { describe, expect, it } from 'vitest';
import {
  applyGel, applyLamp, applyPocket, applyPolisher, applyRinse, applyScaler, applySuction, applyWaterFloss, CELLS, cellCenterU, cellCenterV,
  cheat, createModel, flossStroke, fractions, gelCoverage, meanShade, qualityFor, reassure, RATES, scoreClean, sideU, starsFor, tickModel,
  toothDone, visibleCell, REASSURE_COOLDOWN, REASSURE_AMOUNT, type CleanModel, type TickInput,
} from '../src/clean/dirt';
import { buildSetup } from '../src/clean/setup';
import { TEETH_PER_ARCH } from '../src/core/mouth';
import type { CaseType } from '../src/core/types';

const idle = (dt: number, extra: Partial<TickInput> = {}): TickInput => ({
  dt, working: false, molar: false, gum: false, gumRisk: 1, headphones: false, numbing: false, ...extra,
});

function scrapeAll(m: CleanModel) {
  for (const d of m.tartar) {
    let n = 0;
    while (!d.popped && !d.hidden && n < 3000) { applyScaler(m, d.tooth, d.u, d.v, RATES.strokeCap / 60, 1 / 60); n++; }
  }
}
function polishTooth(m: CleanModel, i: number, seconds = 12) {
  const t = m.teeth[i];
  for (let k = 0; k < seconds * 60; k++) {
    // sweep the face and the biting surface
    const u = 0.32 + 0.36 * ((k * 7) % 60) / 60;
    const v = k % 3 === 2 ? 0.93 : 0.08 + 0.7 * ((k * 13) % 50) / 50;
    applyPolisher(m, i, u, v, 1 / 60, 1, 1);
  }
  return t;
}

describe('spawn (DESIGN 5.2)', () => {
  it('is deterministic for a seed', () => {
    const a = createModel(buildSetup({ archetype: 'smoker', seed: 7 }));
    const b = createModel(buildSetup({ archetype: 'smoker', seed: 7 }));
    expect(a.tartar.map((d) => [d.tooth, d.u, d.v, d.size])).toEqual(b.tartar.map((d) => [d.tooth, d.u, d.v, d.size]));
    expect(a.problem).toEqual(b.problem);
    const c = createModel(buildSetup({ archetype: 'smoker', seed: 8 }));
    expect(c.tartar.map((d) => d.u)).not.toEqual(a.tartar.map((d) => d.u));
  });

  for (const caseType of ['routine', 'candy', 'whitening', 'braces', 'pirate', 'deep'] as CaseType[]) {
    it(`${caseType}: real dirt only on problem teeth and only on visible cells`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const m = createModel(buildSetup({ caseType, seed, level: 5 }));
        expect(m.problem.length).toBeGreaterThan(0);
        for (const t of m.teeth) {
          for (let i = 0; i < CELLS; i++) {
            if (!t.present) { expect(t.plaque[i]).toBe(0); expect(t.stain[i]).toBe(0); continue; }
            if (!visibleCell(t.kind, cellCenterU(i), cellCenterV(i))) {
              expect(t.plaque[i]).toBe(0);
              expect(t.stain[i]).toBe(0);
            }
            if (!t.problem) { expect(t.stain[i]).toBe(0); expect(t.plaque[i]).toBeLessThanOrEqual(0.25); }
          }
        }
        for (const d of m.tartar) {
          expect(m.teeth[d.tooth].problem).toBe(true);
          expect(d.u).toBeGreaterThanOrEqual(0.33);
          expect(d.u).toBeLessThanOrEqual(0.67);
        }
        for (const d of m.debris) {
          expect(m.teeth[d.a].present && m.teeth[d.b].present).toBe(true);
          if (d.kind !== 'doubloon') expect(m.teeth[d.a].problem || m.teeth[d.b].problem).toBe(true);
        }
        // 3 to 5 objectives plus the finish
        expect(m.objectives.length).toBeGreaterThanOrEqual(3);
        expect(m.objectives.length).toBeLessThanOrEqual(6);
        expect(m.objectives[m.objectives.length - 1].id).toBe('finish');
      }
    });
  }

  it('level 1 routine is light: about one chunk per problem tooth', () => {
    const s = buildSetup({ caseType: 'routine', level: 1, seed: 3 });
    const m = createModel(s);
    expect(m.problem.length).toBe(4);
    expect(m.tartar.length).toBe(4);
    expect(m.debris.length).toBe(1);
  });

  it('tutorial puts the first deposit on a lower front tooth and a popcorn in a front gap', () => {
    const m = createModel(buildSetup({ tutorial: true }));
    expect(m.tartar[0].tooth).toBe(TEETH_PER_ARCH + 7);
    expect(m.debris[0].kind).toBe('popcorn');
  });

  it('pirate barnacles have 2x hp; braces put food at brackets and block the cells under them', () => {
    const p = createModel(buildSetup({ caseType: 'pirate', seed: 5 }));
    const barn = p.tartar.filter((d) => d.kind === 'barnacle');
    expect(barn.length).toBeGreaterThanOrEqual(3);
    for (const d of barn) expect(d.hp0).toBeCloseTo(d.size * 2, 6);
    expect(p.teeth.filter((t) => t.gold).length).toBe(1);
    const b = createModel(buildSetup({ caseType: 'braces', seed: 5 }));
    expect(b.debris.every((d) => d.bracket && d.a === d.b && b.teeth[d.a].bracket)).toBe(true);
    const t = b.teeth.find((x) => x.bracket)!;
    expect(t.reachCount).toBeLessThan(b.teeth.find((x) => !x.bracket && x.kind === t.kind)?.reachCount ?? 9999);
  });
});

describe('tools', () => {
  it('hand scaler needs stroke distance, deposits crack in stages', () => {
    const m = createModel(buildSetup({ seed: 5 }));
    const d = m.tartar[0];
    for (let i = 0; i < 120; i++) applyScaler(m, d.tooth, d.u, d.v, 0, 1 / 60);
    expect(d.hp).toBeCloseTo(d.hp0, 6);
    let frames = 0;
    while (!d.popped && frames < 600) { applyScaler(m, d.tooth, d.u, d.v, 0.03, 1 / 60); frames++; }
    expect(d.popped).toBe(true);
    expect(frames).toBeGreaterThan(20);
    const cracks = m.events.filter((e) => e.type === 'tartarCrack').map((e) => e.type === 'tartarCrack' && e.stage);
    expect(cracks).toEqual([1, 2]);
    const pop = m.events.find((e) => e.type === 'tartarPop');
    expect(pop && pop.type === 'tartarPop' && pop.bits.length).toBeGreaterThan(0);
  });

  it('ultrasonic is faster than every hand scaler', () => {
    const time = (tier: number) => {
      const m = createModel(buildSetup({ seed: 5, tools: { scaler: tier } }));
      const d = m.tartar[0];
      let t = 0;
      const ultra = tier >= 4;
      while (!d.popped && t < 10) { applyScaler(m, d.tooth, d.u, d.v, ultra ? 0 : RATES.strokeCap / 60, 1 / 60); t += 1 / 60; }
      return t / d.hp0;
    };
    const titanium = time(3);
    expect(time(4)).toBeLessThan(titanium);
    expect(time(5)).toBeLessThan(time(4));
    expect(time(4)).toBeLessThan(0.36);
  });

  it('polisher leaves paste that only rinse removes, and wrap assist reaches the sides', () => {
    const m = createModel(buildSetup({ caseType: 'whitening', seed: 9 }));
    const i = m.problem.find((x) => m.teeth[x].stain0 > 1)!;
    const t = m.teeth[i];
    applyPolisher(m, i, 0.5, 0.5, 1 / 60, 1, 0);
    let paste = 0, side = 0;
    for (let c = 0; c < CELLS; c++) { paste += t.paste[c]; if (Math.abs(cellCenterU(c) - 0.22) < 0.03 && Math.abs(cellCenterV(c) - 0.5) < 0.05) side += t.polish[c] + (t.paste[c] > 0 ? 1 : 0); }
    expect(paste).toBeGreaterThan(0);
    expect(side).toBeGreaterThan(0);            // the wrap band touched the far side of the crown
    // scaler, polisher, suction and time leave the paste alone
    for (let k = 0; k < 60; k++) { applySuction(m, 0, -1.6, 0, 1 / 60); tickModel(m, idle(1 / 60)); }
    let after = 0;
    for (let c = 0; c < CELLS; c++) after += t.paste[c];
    expect(after).toBeCloseTo(paste, 3);
    const p = m.placements[i];
    for (let k = 0; k < 90; k++) applyRinse(m, p.x + p.nx * 0.2, p.y + p.dir * 0.5, p.z + p.nz * 0.2, 1 / 60);
    let rinsed = 0;
    for (let c = 0; c < CELLS; c++) rinsed += t.paste[c];
    expect(rinsed).toBe(0);
    expect(m.events.some((e) => e.type === 'pasteRinsed' && e.tooth === i)).toBe(true);
  });

  it('suction only takes floating bits: resting bits need a rinse first', () => {
    const m = createModel(buildSetup({ seed: 5 }));
    const d = m.tartar[0];
    while (!d.popped) applyScaler(m, d.tooth, d.u, d.v, 0.04, 1 / 60);
    const bits = m.bits.filter((b) => b.state === 'resting');
    expect(bits.length).toBeGreaterThan(0);
    const b = bits[0];
    for (let k = 0; k < 120; k++) applySuction(m, b.x, b.y, b.z, 1 / 60);
    expect(b.state).toBe('resting');
    for (let k = 0; k < 30; k++) applyRinse(m, b.x, b.y, b.z, 1 / 60);
    expect(b.state).toBe('floating');
    expect(m.water).toBeGreaterThan(0.02);
    const tipX = b.x + 1.5;
    for (let k = 0; k < 60 * 3; k++) applySuction(m, tipX, b.y, b.z, 1 / 60);
    expect(b.state).toBe('gone');                // drifted to the tip and got sucked up
    expect(m.water).toBe(0);
  });

  it('floss strokes remove debris hp by floss power and clean between the teeth', () => {
    const m = createModel(buildSetup({ caseType: 'routine', seed: 2, level: 6 }));
    const d = m.debris.find((x) => x.hp0 === 3) ?? m.debris[0];
    let strokes = 0;
    while (!d.popped && strokes < 10) { flossStroke(m, { a: d.a, b: d.b }); strokes++; }
    expect(strokes).toBe(Math.ceil(d.hp0 / 1));
    expect(m.events.some((e) => e.type === 'debrisPop')).toBe(true);
    const m2 = createModel(buildSetup({ caseType: 'routine', seed: 2, level: 6, tools: { floss: 2 } }));
    const d2 = m2.debris.find((x) => x.id === d.id)!;
    let s2 = 0;
    while (!d2.popped && s2 < 10) { flossStroke(m2, { a: d2.a, b: d2.b }); s2++; }
    expect(s2).toBe(Math.ceil(d2.hp0 / 1.8));
  });

  it('water flosser pops bracket food while held', () => {
    const m = createModel(buildSetup({ caseType: 'braces', seed: 2, tools: { floss: 3 } }));
    const d = m.debris[0];
    let t = 0;
    while (!d.popped && t < 10) { applyWaterFloss(m, d.a, d.b, 1 / 60); t += 1 / 60; }
    expect(d.popped).toBe(true);
    expect(m.water).toBeGreaterThan(0);
  });

  it('sideU faces the neighbour', () => {
    const m = createModel(buildSetup());
    expect(sideU(m.placements[20], 21)).toBe(0.75);
    expect(sideU(m.placements[20], 19)).toBe(0.25);
    expect(sideU(m.placements[5], 6)).toBe(0.25);
  });
});

describe('tooth snap (DESIGN 5.2)', () => {
  it('a problem tooth snaps once tartar is gone and at most 15% of plaque and stain is left, with a rising count', () => {
    const m = createModel(buildSetup({ caseType: 'routine', seed: 4, level: 3 }));
    scrapeAll(m);
    const snaps: number[] = [];
    for (const i of m.problem) {
      const t = polishTooth(m, i);
      expect(t.snapped).toBe(true);
      expect(toothDone(m, i)).toBe(true);
    }
    for (const e of m.events) if (e.type === 'toothSnap') snaps.push(e.n);
    expect(snaps).toEqual(m.problem.map((_, k) => k + 1));
  });

  it('does not snap while a deposit is left', () => {
    const m = createModel(buildSetup({ caseType: 'routine', seed: 4 }));
    const d = m.tartar[0];
    polishTooth(m, d.tooth);
    expect(m.teeth[d.tooth].snapped).toBe(false);
    while (!d.popped) applyScaler(m, d.tooth, d.u, d.v, 0.04, 1 / 60);
    const others = m.tartar.filter((x) => x.tooth === d.tooth && !x.popped);
    for (const o of others) while (!o.popped) applyScaler(m, o.tooth, o.u, o.v, 0.04, 1 / 60);
    expect(m.teeth[d.tooth].snapped).toBe(true);
  });
});

describe('cases', () => {
  it('whitening: gel then lamp brightens a shade per 1.2 s, zings after 4 s nonstop, shadeGain reported', () => {
    const m = createModel(buildSetup({ caseType: 'whitening', seed: 3 }));
    const sp = m.setup.special;
    expect(sp.startShade).toBeGreaterThanOrEqual(11);
    const i = m.teeth.find((t) => t.gelTarget && t.present)!.index;
    // no gel: nothing happens
    for (let k = 0; k < 60; k++) { applyLamp(m, i, 1 / 60); tickModel(m, idle(1 / 60)); }
    expect(m.teeth[i].shade).toBe(sp.startShade);
    for (let k = 0; k < 60; k++) applyGel(m, i, 0.5, 0.45, 1 / 60, k / 60);
    expect(gelCoverage(m, i)).toBeGreaterThan(0.6);
    expect(m.events.some((e) => e.type === 'gelDone')).toBe(true);
    let zing = 0;
    for (let k = 0; k < 60 * 3.7; k++) { applyLamp(m, i, 1 / 60); tickModel(m, idle(1 / 60)); }
    expect(sp.startShade - m.teeth[i].shade).toBe(3);
    for (let k = 0; k < 60; k++) { applyLamp(m, i, 1 / 60); tickModel(m, idle(1 / 60)); }
    zing = m.events.filter((e) => e.type === 'zing' && e.tooth === i).length;
    expect(zing).toBe(1);
    cheat(m, 1);
    const r = scoreClean(m, 'done', 60);
    expect(meanShade(m)).toBe(sp.targetShade);
    expect(r.shadeGain).toBe(sp.startShade - sp.targetShade);
    expect(r.objectives.every((o) => o.done)).toBe(true);
  });

  it('candy: bugs spread plaque every 6 s and squash under the polisher', () => {
    const m = createModel(buildSetup({ caseType: 'candy', seed: 3, level: 3 }));
    expect(m.bugs.length).toBe(4);
    expect(m.teeth.filter((t) => t.sealTarget).length).toBe(4);
    const added0 = m.problem.reduce((s, i) => s + m.teeth[i].plaqueAdded, 0);
    for (let k = 0; k < 60 * 8; k++) tickModel(m, idle(1 / 60));
    expect(m.events.filter((e) => e.type === 'bugSpread').length).toBeGreaterThanOrEqual(m.bugs.length);
    expect(m.problem.reduce((s, i) => s + m.teeth[i].plaqueAdded, 0)).toBeGreaterThan(added0);
    const b = m.bugs[0];
    applyPolisher(m, b.tooth, b.u, b.v, 1 / 60);
    expect(b.alive).toBe(false);
    expect(m.events.some((e) => e.type === 'bugSquash')).toBe(true);
    // a bug sidles away from a tool that comes near
    const c = m.bugs[1];
    const u0 = c.u;
    for (let k = 0; k < 20; k++) tickModel(m, idle(1 / 60, { tool: { tooth: c.tooth, u: c.u - 0.05, v: c.v } }));
    expect(c.u === u0 ? c.tooth !== m.bugs[1].tooth : true).toBe(true);
  });

  it('deep: holding the scaler 0.8 s opens a pocket and reveals its hidden tartar; clearing it heals the gum', () => {
    const m = createModel(buildSetup({ caseType: 'deep', seed: 3, level: 4 }));
    const pk = m.pockets[0];
    const hidden = m.tartar.filter((d) => d.pocket === pk.id);
    expect(hidden.every((d) => d.hidden)).toBe(true);
    // scraping a hidden deposit does nothing
    applyScaler(m, hidden[0].tooth, hidden[0].u, hidden[0].v, 0.04, 1 / 60);
    expect(hidden[0].hp).toBe(hidden[0].hp0);
    let t = 0;
    while (!pk.opened && t < 2) { applyPocket(m, pk.id, 1 / 60); tickModel(m, idle(1 / 60)); t += 1 / 60; }
    expect(t).toBeGreaterThan(0.75);
    expect(t).toBeLessThan(0.9);
    expect(hidden.every((d) => !d.hidden)).toBe(true);
    for (const d of hidden) while (!d.popped) applyScaler(m, d.tooth, d.u, d.v, 0.04, 1 / 60);
    expect(pk.healed).toBe(true);
    expect(m.events.some((e) => e.type === 'pocketHeal')).toBe(true);
  });

  it('pirate: the doubloon is treasure', () => {
    let m: CleanModel | null = null;
    for (let s = 1; s < 20 && !m; s++) { const x = createModel(buildSetup({ caseType: 'pirate', seed: s, bonus: 'treasure' })); if (x.debris.some((d) => d.kind === 'doubloon')) m = x; }
    expect(m).not.toBeNull();
    const d = m!.debris.find((x) => x.kind === 'doubloon')!;
    expect(d.a % TEETH_PER_ARCH === 0 || d.a % TEETH_PER_ARCH === 12).toBe(true);
    while (!d.popped) flossStroke(m!, { a: d.a, b: d.b });
    cheat(m!, 1);
    const r = scoreClean(m!, 'done', 10);
    expect(r.treasure).toBe(true);
    expect(r.bonusMet).toBe(true);
    expect(r.perfect).toBe(true);
  });
});

describe('twists and comfort', () => {
  it('drains passively and faster with water', () => {
    const m = createModel(buildSetup({ archetype: 'regular' }));
    const c0 = m.comfort;
    for (let i = 0; i < 600; i++) tickModel(m, idle(1 / 60));
    expect(c0 - m.comfort).toBeCloseTo(3.5, 1);
    m.water = 0.8;
    const c1 = m.comfort;
    for (let i = 0; i < 60; i++) tickModel(m, idle(1 / 60));
    expect(c1 - m.comfort).toBeCloseTo(3.35, 1);
  });

  it('deep cleaning drains 1.5x', () => {
    const m = createModel(buildSetup({ caseType: 'deep', archetype: 'regular' }));
    const c0 = m.comfort;
    for (let i = 0; i < 600; i++) tickModel(m, idle(1 / 60));
    expect(c0 - m.comfort).toBeCloseTo(3.5 * 1.5, 1);
  });

  it('gum contact hurts after a short delay; sensitive gums double it', () => {
    const hurt = (tw: any[]) => {
      const m = createModel(buildSetup({ archetype: 'regular', twists: tw }));
      m.setup.traits.comfortDrain = 0;
      const c0 = m.comfort;
      for (let i = 0; i < 60; i++) tickModel(m, idle(1 / 60, { working: true, gum: true }));
      expect(m.gumHits).toBe(1);
      return c0 - m.comfort;
    };
    expect(hurt(['sensitive'])).toBeCloseTo(hurt([]) * 2, 1);
  });

  it('gag reflex warns at 60% before it gags', () => {
    const m = createModel(buildSetup({ archetype: 'regular', twists: ['gagger'] }));
    const warnAt: number[] = [];
    for (let i = 0; i < 60 * 3; i++) {
      tickModel(m, idle(1 / 60, { working: true, molar: true }));
      if (m.events.some((e) => e.type === 'gagWarn') && !warnAt.length) warnAt.push(m.time);
    }
    expect(warnAt[0]).toBeGreaterThan(1.4);
    expect(warnAt[0]).toBeLessThan(1.6);
    expect(m.gags).toBe(1);
    expect(m.jawClosed).toBeGreaterThan(0);
    const d = m.tartar[0];
    expect(applyScaler(m, d.tooth, d.u, d.v, 0.05, 1 / 60).tartar).toBe(0);
  });

  it('hiccups: a scaler touching during the jolt slips, lifting it does not', () => {
    const m = createModel(buildSetup({ archetype: 'regular', twists: ['hiccups'] }));
    let hic = -1;
    for (let i = 0; i < 60 * 14 && hic < 0; i++) { tickModel(m, idle(1 / 60)); if (m.events.some((e) => e.type === 'hic')) hic = m.time; }
    expect(hic).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) tickModel(m, idle(1 / 60, { scaling: true, working: true }));
    expect(m.gumHits).toBe(1);
    const m2 = createModel(buildSetup({ archetype: 'regular', twists: ['hiccups'] }));
    for (let i = 0; i < 60 * 30; i++) tickModel(m2, idle(1 / 60));
    expect(m2.gumHits).toBe(0);
  });

  it('sleepy: dozes, the jaw closes and blocks the lower arch; Nudge wakes', () => {
    const m = createModel(buildSetup({ archetype: 'regular', twists: ['sleepy'] }));
    for (let i = 0; i < 60 * 26; i++) tickModel(m, idle(1 / 60));
    expect(m.dozing).toBe(true);
    expect(m.doze).toBeGreaterThan(0.6);
    const lower = m.tartar.find((d) => m.teeth[d.tooth].arch === 'lower');
    if (lower) expect(applyScaler(m, lower.tooth, lower.u, lower.v, 0.04, 1 / 60).tartar).toBe(0);
    reassure(m);
    expect(m.dozing).toBe(false);
    for (let i = 0; i < 60; i++) tickModel(m, idle(1 / 60));
    expect(m.doze).toBe(0);
  });

  it('chatty patients close the jaw to talk', () => {
    const m = createModel(buildSetup({ archetype: 'regular', twists: ['chatty'] }));
    for (let i = 0; i < 60 * 31; i++) tickModel(m, idle(1 / 60));
    expect(m.events.filter((e) => e.type === 'chat' && e.closesJaw).length).toBeGreaterThanOrEqual(1);
  });

  it('reassure is +8 per 18 s', () => {
    const m = createModel(buildSetup({ archetype: 'nervous', skills: ['calmingVoice'] }));
    m.comfort = 40;
    expect(REASSURE_AMOUNT).toBe(8);
    expect(REASSURE_COOLDOWN).toBe(18);
    expect(reassure(m)).toBe(true);
    expect(m.comfort).toBeCloseTo(52, 6);
    expect(reassure(m)).toBe(false);
    for (let i = 0; i < 60 * REASSURE_COOLDOWN + 2; i++) tickModel(m, idle(1 / 60));
    expect(reassure(m)).toBe(true);
  });

  it('walks out at zero comfort', () => {
    const m = createModel(buildSetup({ archetype: 'nervous' }));
    m.comfort = 1;
    for (let i = 0; i < 120; i++) tickModel(m, idle(1 / 60, { working: true, gum: true }));
    expect(m.walkout).toBe(true);
    const r = scoreClean(m, 'done', 30);
    expect(r.quit).toBe('walkout');
    expect(r.quality).toBeLessThanOrEqual(0.25);
    expect(r.stars).toBe(1);
  });
});

describe('objectives and scoring (DESIGN 5.8)', () => {
  it('star thresholds and quality', () => {
    expect(starsFor(0.92)).toBe(5);
    expect(starsFor(0.91)).toBe(4);
    expect(starsFor(0.65)).toBe(3);
    expect(starsFor(0.44)).toBe(1);
    expect(qualityFor(1, 100, false)).toBe(1);
    expect(qualityFor(0.5, 50, false)).toBeCloseTo(0.8 * 0.5 + 0.1, 6);
    expect(qualityFor(1, 100, true)).toBe(0.25);
  });

  it('clean is the mean of objective progress; the finish waits for a mess', () => {
    const m = createModel(buildSetup({ caseType: 'routine', seed: 4 }));
    expect(fractions(m).clean).toBe(0);
    const tartar = m.objectives.find((o) => o.id === 'tartar')!;
    const d = m.tartar[0];
    while (!d.popped) applyScaler(m, d.tooth, d.u, d.v, 0.04, 1 / 60);
    tickModel(m, idle(1 / 60));
    expect(tartar.have).toBe(1);
    expect(tartar.progress).toBeCloseTo(1 / tartar.count, 6);
    const fin = m.objectives.find((o) => o.id === 'finish')!;
    expect(fin.progress).toBeGreaterThan(0);
    expect(fin.done).toBe(false);
    const mean = m.objectives.reduce((s, o) => s + o.progress, 0) / m.objectives.length;
    expect(fractions(m).clean).toBeCloseTo(mean, 6);
  });

  it('an objective ticks once with an event', () => {
    const m = createModel(buildSetup({ caseType: 'routine', seed: 4 }));
    scrapeAll(m);
    tickModel(m, idle(1 / 60));
    tickModel(m, idle(1 / 60));
    expect(m.events.filter((e) => e.type === 'objective' && e.obj.id === 'tartar').length).toBe(1);
  });

  it('cheat(0.5) is half way, cheat(1) is perfect with the bonus', () => {
    for (const caseType of ['routine', 'candy', 'whitening', 'braces', 'pirate', 'deep'] as CaseType[]) {
      const m = createModel(buildSetup({ caseType, seed: 6, bonus: 'combo', level: 4 }));
      cheat(m, 0.5);
      const c = fractions(m).clean;
      expect(c).toBeGreaterThan(0.25);
      expect(c).toBeLessThan(0.9);
      cheat(m, 1);
      const r = scoreClean(m, 'done', 90);
      expect(r.objectives.every((o) => o.done)).toBe(true);
      expect(r.clean).toBe(1);
      expect(r.stars).toBe(5);
      expect(r.caseType).toBe(caseType);
      expect(r.perfect).toBe(r.bonusMet);
    }
  });

  it('bonus: no slips fails on a gum hit; spotless needs every marked tooth', () => {
    const m = createModel(buildSetup({ seed: 4, bonus: 'noSlips' }));
    cheat(m, 1);
    expect(scoreClean(m, 'done', 20).bonusMet).toBe(true);
    for (let i = 0; i < 30; i++) tickModel(m, idle(1 / 60, { working: true, gum: true }));
    const r = scoreClean(m, 'done', 20);
    expect(r.bonusMet).toBe(false);
    expect(r.perfect).toBe(false);
    const s = createModel(buildSetup({ seed: 4, bonus: 'spotless' }));
    cheat(s, 1);
    expect(scoreClean(s, 'done', 20).bonusMet).toBe(true);
  });
});
