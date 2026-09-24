import { describe, expect, it } from 'vitest';
import {
  applyPolisher, applyRinse, applyScaler, applySuction, applyWaterFloss, CELLS, cellCenterU, cellCenterV, cheat,
  createModel, flossSwipe, fractions, parFor, qualityFor, reassure, scoreClean, sideU, starsFor, tickModel,
  REASSURE_COOLDOWN, type CleanModel, type TickInput,
} from '../src/clean/dirt';
import { buildSetup } from '../src/clean/setup';
import { reachable, TEETH_PER_ARCH } from '../src/core/mouth';

const idle = (dt: number, extra: Partial<TickInput> = {}): TickInput => ({
  dt, working: false, molar: false, gum: false, gumRisk: 1, headphones: false, numbing: false, ...extra,
});

function coverage(m: CleanModel, layer: 'plaque' | 'stain'): number {
  let on = 0, reach = 0;
  for (const t of m.teeth) {
    if (!t.present) continue;
    for (let i = 0; i < CELLS; i++) { if (!t.reach[i]) continue; reach++; if (t[layer][i] > 0) on++; }
  }
  return on / reach;
}

describe('spawn', () => {
  it('is deterministic for a seed', () => {
    const a = createModel(buildSetup({ archetype: 'smoker', seed: 7 }));
    const b = createModel(buildSetup({ archetype: 'smoker', seed: 7 }));
    expect(a.tartar.map((d) => [d.tooth, d.u, d.v, d.size])).toEqual(b.tartar.map((d) => [d.tooth, d.u, d.v, d.size]));
    expect(Array.from(a.teeth[20].plaque)).toEqual(Array.from(b.teeth[20].plaque));
    const c = createModel(buildSetup({ archetype: 'smoker', seed: 8 }));
    expect(c.tartar.map((d) => d.u)).not.toEqual(a.tartar.map((d) => d.u));
  });

  it('matches the dirt profile coverage and counts', () => {
    const s = buildSetup({ archetype: 'regular', seed: 3 });
    const m = createModel(s);
    expect(coverage(m, 'plaque')).toBeCloseTo(s.dirt.plaque * 0.45, 1);
    expect(coverage(m, 'stain')).toBeCloseTo(s.dirt.stain * 0.35, 1);
    expect(m.tartar.length).toBe(s.dirt.tartarCount);
    expect(m.debris.length).toBe(s.dirt.debrisCount);
    for (const d of m.tartar) {
      expect(d.v).toBeGreaterThanOrEqual(0.03);
      expect(d.v).toBeLessThanOrEqual(0.25);
      expect(d.hp).toBeCloseTo(d.size, 6);
    }
  });

  it('only puts dirt on reachable cells of present teeth', () => {
    const m = createModel(buildSetup({ archetype: 'senior', seed: 11 }));
    expect(m.setup.missingTeeth.length).toBeGreaterThanOrEqual(3);
    for (const t of m.teeth) {
      for (let i = 0; i < CELLS; i++) {
        const ok = t.present && reachable(t.kind, cellCenterU(i), cellCenterV(i));
        if (!ok) { expect(t.plaque[i]).toBe(0); expect(t.stain[i]).toBe(0); }
      }
    }
    for (const d of m.tartar) expect(m.teeth[d.tooth].present).toBe(true);
    for (const d of m.debris) { expect(m.teeth[d.a].present && m.teeth[d.b].present).toBe(true); expect(d.b).toBe(d.a + 1); }
  });

  it('tutorial puts the first deposit and a popcorn in the front', () => {
    const m = createModel(buildSetup({ archetype: 'mannequin', tutorial: true }));
    expect(m.tartar[0].tooth).toBe(TEETH_PER_ARCH + 7);
    expect(m.debris[0].kind).toBe('popcorn');
  });
});

describe('tools', () => {
  it('hand scaler needs stroke distance, not holding', () => {
    const m = createModel(buildSetup({ archetype: 'regular', seed: 5 }));
    const d = m.tartar[0];
    for (let i = 0; i < 120; i++) applyScaler(m, d.tooth, d.u, d.v, 0, 1 / 60);
    expect(d.hp).toBeCloseTo(d.hp0, 6);
    let frames = 0;
    while (!d.popped && frames < 600) { applyScaler(m, d.tooth, d.u, d.v, 0.03, 1 / 60); frames++; }
    expect(d.popped).toBe(true);
    expect(frames).toBeGreaterThan(20);    // several scrapes, not one
    expect(m.chunks).toBe(1);
    expect(m.events.some((e) => e.type === 'tartarHit')).toBe(true);
    const pop = m.events.find((e) => e.type === 'tartarPop');
    expect(pop && pop.type === 'tartarPop' && pop.bits.length).toBeGreaterThan(0);
    expect(m.bitsCreated).toBeGreaterThan(0);
  });

  it('caps the counted stroke speed', () => {
    const m = createModel(buildSetup({ archetype: 'regular', seed: 5 }));
    const d = m.tartar[0];
    applyScaler(m, d.tooth, d.u, d.v, 50, 1 / 60);
    expect(d.popped).toBe(false);
  });

  it('ultrasonic works on time and adds water', () => {
    const m = createModel(buildSetup({ archetype: 'regular', seed: 5, tools: { scaler: 4 } }));
    const d = m.tartar[0];
    let t = 0;
    while (!d.popped && t < 10) { applyScaler(m, d.tooth, d.u, d.v, 0, 1 / 60); t += 1 / 60; }
    expect(d.popped).toBe(true);
    expect(m.water).toBeGreaterThan(0);
  });

  it('power stroke speeds the scaler up', () => {
    const run = (skills: any[]) => {
      const m = createModel(buildSetup({ archetype: 'regular', seed: 5, skills }));
      const d = m.tartar[0];
      let n = 0;
      while (!d.popped && n < 1000) { applyScaler(m, d.tooth, d.u, d.v, 0.03, 1 / 60); n++; }
      return n;
    };
    expect(run(['power'])).toBeLessThan(run([]));
  });

  it('polisher removes plaque and stain and only polishes clean cells', () => {
    const m = createModel(buildSetup({ archetype: 'coffee', seed: 9 }));
    const t = m.teeth.find((x) => x.present && x.stain0 > 5)!;
    let cell = -1;
    for (let i = 0; i < CELLS; i++) if (t.stain[i] > 0.5) { cell = i; break; }
    const u = cellCenterU(cell), v = cellCenterV(cell);
    const r = applyPolisher(m, t.index, u, v, 1 / 60);
    expect(r.stain).toBeGreaterThan(0);
    expect(t.polish[cell]).toBe(0);  // still stained, no shine yet
    for (let i = 0; i < 600; i++) applyPolisher(m, t.index, u, v, 1 / 60);
    expect(t.stain[cell]).toBe(0);
    expect(t.plaque[cell]).toBe(0);
    expect(t.polish[cell]).toBeGreaterThan(0.9);
  });

  it('floss swipes pop debris after hp swipes and clean between teeth', () => {
    const m = createModel(buildSetup({ archetype: 'kid', seed: 2 }));
    const d = m.debris[0];
    let swipes = 0;
    while (!d.popped && swipes < 10) { flossSwipe(m, d.a, d.b); swipes++; }
    expect(swipes).toBe(Math.ceil(d.hp0 / 1));
    expect(m.events.some((e) => e.type === 'debrisPop')).toBe(true);
  });

  it('floss picks need fewer swipes', () => {
    const m = createModel(buildSetup({ archetype: 'kid', seed: 2, tools: { floss: 2 } }));
    const d = m.debris.find((x) => x.hp0 === 3) ?? m.debris[0];
    let swipes = 0;
    while (!d.popped && swipes < 10) { flossSwipe(m, d.a, d.b); swipes++; }
    expect(swipes).toBe(Math.ceil(d.hp0 / 1.8));
  });

  it('water flosser pops debris while held', () => {
    const m = createModel(buildSetup({ archetype: 'kid', seed: 2, tools: { floss: 3 } }));
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

  it('rinse washes bits, suction drains water and collects bits', () => {
    const m = createModel(buildSetup({ archetype: 'regular', seed: 5 }));
    cheat(m, 0.5);
    expect(m.bitsCreated).toBeGreaterThan(0);
    const b = m.bits.find((x) => x.state === 'loose')!;
    for (let i = 0; i < 60; i++) applyRinse(m, b.x, b.y, b.z, 1 / 60);
    expect(b.state).toBe('washed');
    expect(m.water).toBeGreaterThan(0.1);
    for (let i = 0; i < 60 * 8; i++) applySuction(m, 0, -1.6, 0, 1 / 60);
    expect(m.water).toBe(0);
    expect(b.state).toBe('gone');
    const loose = m.bits.filter((x) => x.state === 'loose');
    for (const x of loose) applySuction(m, x.x, x.y, x.z, 1 / 60);
    expect(m.bits.every((x) => x.state === 'gone')).toBe(true);
  });
});

describe('comfort', () => {
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

  it('gum contact hurts after a short delay and counts one hit per contact', () => {
    const m = createModel(buildSetup({ archetype: 'nervous' }));
    const c0 = m.comfort;
    for (let i = 0; i < 60; i++) tickModel(m, idle(1 / 60, { working: true, gum: true }));
    expect(m.gumHits).toBe(1);
    // ~0.85 s of hurt at 8 * 1.4 per second plus the passive drain
    expect(c0 - m.comfort).toBeGreaterThan(8);
    expect(m.events.some((e) => e.type === 'ow')).toBe(true);
    tickModel(m, idle(1 / 60));
    for (let i = 0; i < 30; i++) tickModel(m, idle(1 / 60, { working: true, gum: true }));
    expect(m.gumHits).toBe(2);
  });

  it('steady hands and numbing gel soften gum hits', () => {
    const hurt = (o: any) => {
      const m = createModel(buildSetup({ archetype: 'regular', ...o }));
      m.setup.traits.comfortDrain = 0;
      const c0 = m.comfort;
      for (let i = 0; i < 120; i++) tickModel(m, idle(1 / 60, { working: true, gum: true, numbing: !!o.gel }));
      return c0 - m.comfort;
    };
    const base = hurt({});
    expect(hurt({ skills: ['steady1', 'steady2'] })).toBeCloseTo(base * 0.5, 1);
    expect(hurt({ gel: true })).toBeCloseTo(base * 0.5, 1);
  });

  it('gags after long molar work and closes the jaw', () => {
    const m = createModel(buildSetup({ archetype: 'gagger' }));
    for (let i = 0; i < 60 * 3; i++) tickModel(m, idle(1 / 60, { working: true, molar: true }));
    expect(m.gags).toBe(1);
    expect(m.jawClosed).toBeGreaterThan(0);
    const d = m.tartar[0];
    const r = applyScaler(m, d.tooth, d.u, d.v, 0.05, 1 / 60);
    expect(r.tartar).toBe(0);
  });

  it('gag guru delays the gag', () => {
    const m = createModel(buildSetup({ archetype: 'gagger', skills: ['kidWhisperer', 'gagGuru'] }));
    for (let i = 0; i < 60 * 3; i++) tickModel(m, idle(1 / 60, { working: true, molar: true }));
    expect(m.gags).toBe(0);
  });

  it('chatty patients close the jaw to talk', () => {
    const m = createModel(buildSetup({ archetype: 'chatty' }));
    for (let i = 0; i < 60 * 31; i++) tickModel(m, idle(1 / 60));
    const chats = m.events.filter((e) => e.type === 'chat' && e.closesJaw);
    expect(chats.length).toBeGreaterThanOrEqual(1);
  });

  it('reassure has a cooldown', () => {
    const m = createModel(buildSetup({ archetype: 'nervous', skills: ['calmingVoice'] }));
    m.comfort = 40;
    expect(reassure(m)).toBe(true);
    expect(m.comfort).toBeCloseTo(58, 6);
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

describe('scoring', () => {
  it('follows DESIGN 5.5', () => {
    expect(starsFor(0.92)).toBe(5);
    expect(starsFor(0.91)).toBe(4);
    expect(starsFor(0.8)).toBe(4);
    expect(starsFor(0.65)).toBe(3);
    expect(starsFor(0.45)).toBe(2);
    expect(starsFor(0.44)).toBe(1);
    expect(qualityFor(1, 100, false)).toBe(1);
    expect(qualityFor(0.5, 50, false)).toBeCloseTo(0.82 * 0.5 + 0.09, 6);
    expect(qualityFor(1, 100, true)).toBe(0.25);
    const s = buildSetup({ archetype: 'regular' });
    expect(parFor(s)).toBeCloseTo(25 + 3.2 * 10 + 15 + 7.5 + 8, 6);
  });

  it('an untouched mouth scores low, a full cheat scores perfect', () => {
    const m = createModel(buildSetup({ archetype: 'smoker', seed: 4 }));
    const f0 = fractions(m);
    expect(f0.tartar).toBe(0);
    expect(f0.plaque).toBe(0);
    expect(f0.clean).toBe(0);
    cheat(m, 0.5);
    const f1 = fractions(m);
    expect(f1.tartar).toBeGreaterThan(0.3);
    expect(f1.plaque).toBeCloseTo(0.5, 1);
    cheat(m, 1);
    const r = scoreClean(m, 'done', 90);
    expect(r.clean).toBeGreaterThanOrEqual(0.97);
    expect(r.perfect).toBe(true);
    expect(r.chunks).toBe(m.tartar.length);
    expect(r.stars).toBe(5);
    const clean = 0.35 * r.tartar + 0.25 * r.plaque + 0.2 * r.stain + 0.1 * r.debris + 0.1 * r.polish - 0.1 * r.mess;
    expect(r.clean).toBeCloseTo(Math.min(1, clean), 6);
  });

  it('awards a tooth-clean event once per tooth', () => {
    const m = createModel(buildSetup({ archetype: 'regular', seed: 6 }));
    cheat(m, 1);
    const cleanEvents = m.events.filter((e) => e.type === 'toothClean');
    const dirtyTeeth = m.teeth.filter((t) => t.present && t.startedDirty).length;
    expect(cleanEvents.length).toBe(dirtyTeeth);
    cheat(m, 1);
    expect(m.events.filter((e) => e.type === 'toothClean').length).toBe(dirtyTeeth);
  });
});
