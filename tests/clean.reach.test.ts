import { describe, expect, it } from 'vitest';
import {
  applyPolisher, applyScaler, CELLS, cellAt, cellCenterU, cellCenterV, createModel, fractions, lastBits, RATES, spawnCell, toothDirtLeft,
  toothDone, toothProgress, toothRemoval, updateObjectives, type CleanModel,
} from '../src/clean/dirt';
import { pressable } from '../src/clean/reach';
import { buildSetup } from '../src/clean/setup';
import { TEETH_PER_ARCH } from '../src/core/mouth';
import type { CaseType } from '../src/core/types';

const CASES: CaseType[] = ['routine', 'candy', 'whitening', 'braces', 'pirate', 'deep'];
const BACK = [0, 1, 12, 13];

function popTartarOn(m: CleanModel, tooth: number) {
  for (const d of m.tartar) {
    if (d.tooth !== tooth) continue;
    d.hidden = false;
    let n = 0;
    while (!d.popped && n++ < 3000) applyScaler(m, d.tooth, d.u, d.v, RATES.strokeCap / 60, 1 / 60);
  }
}
/** Scale a tooth's plaque and stain so `removed` of what it started with is gone. */
function leaveShare(m: CleanModel, tooth: number, removed: number) {
  const t = m.teeth[tooth];
  let cur = 0;
  for (let c = 0; c < CELLS; c++) cur += t.plaque[c] + t.stain[c];
  const want = (t.plaque0 + t.plaqueAdded + t.stain0) * (1 - removed);
  const k = cur > 0 ? want / cur : 0;
  for (let c = 0; c < CELLS; c++) { t.plaque[c] *= k; t.stain[c] *= k; }
}

describe('reachability (DESIGN 5.2): dirt only where a pointer can press it', () => {
  it('the baked table is mirror-symmetric and every tooth has a reachable face', () => {
    for (let i = 0; i < 28; i++) {
      const arch = Math.floor(i / TEETH_PER_ARCH), pos = i % TEETH_PER_ARCH;
      const mi = arch * TEETH_PER_ARCH + (TEETH_PER_ARCH - 1 - pos);
      let face = 0;
      for (let c = 0; c < CELLS; c++) {
        const iu = c % 32, iv = Math.floor(c / 32);
        expect(pressable(i, c)).toBe(pressable(mi, iv * 32 + (31 - iu)));
        const u = cellCenterU(c);
        if (pressable(i, c) && u >= 0.3 && u <= 0.7) face++;
      }
      // at least 60% of the outward face (13 columns x 24 rows) on every tooth, back molars included
      expect(face, `tooth ${i}`).toBeGreaterThan(0.6 * 13 * 24);
    }
  });

  it('back molars (arch positions 0, 1, 12, 13) can carry a plaque band from just above the gum to the top', () => {
    for (const arch of [0, 1]) for (const pos of BACK) {
      const i = arch * TEETH_PER_ARCH + pos;
      for (const v of [0.08, 0.2, 0.4, 0.6, 0.8]) {
        let n = 0;
        for (let iu = 10; iu <= 21; iu++) if (pressable(i, cellAt((iu + 0.5) / 32, v))) n++;
        expect(n, `tooth ${i} v ${v}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  for (const caseType of CASES) {
    it(`${caseType}: every dirt cell and every deposit is pressable, and bands start above the gum`, () => {
      for (const level of [1, 4, 8]) for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = createModel(buildSetup({ caseType, seed, level }));
        for (const t of m.teeth) {
          if (!t.present) continue;
          for (let c = 0; c < CELLS; c++) {
            if (t.plaque[c] <= 0 && t.stain[c] <= 0) continue;
            expect(spawnCell(t.index, t.kind, c), `${caseType} L${level} s${seed} tooth ${t.index} cell ${c}`).toBe(true);
            expect(pressable(t.index, c)).toBe(true);
            expect(cellCenterV(c)).toBeGreaterThanOrEqual(RATES.bandFloor);
          }
        }
        for (const d of m.tartar) expect(pressable(d.tooth, cellAt(d.u, d.v)), `${caseType} deposit on ${d.tooth} at ${d.u.toFixed(2)},${d.v.toFixed(2)}`).toBe(true);
        for (const b of m.bugs) expect(m.teeth[b.tooth].vis[cellAt(b.u, b.v)]).toBe(1);
      }
    });
  }

  it('the polisher at the gum edge (v 0.02) clears the bottom of a plaque band on a back molar', () => {
    for (const tooth of [0, 13, 14, 27]) {
      let m: CleanModel | null = null;
      for (let seed = 1; seed < 80 && !m; seed++) {
        const x = createModel(buildSetup({ caseType: 'routine', level: 6, seed }));
        if (x.problem.includes(tooth) && x.teeth[tooth].plaque0 > 2) m = x;
      }
      expect(m, `a seed with plaque on tooth ${tooth}`).not.toBeNull();
      const t = m!.teeth[tooth];
      const low = () => { let s = 0; for (let c = 0; c < CELLS; c++) if (cellCenterV(c) < 0.15) s += t.plaque[c]; return s; };
      const before = low();
      expect(before).toBeGreaterThan(0);
      for (let k = 0; k < 90; k++) applyPolisher(m!, tooth, 0.4 + 0.2 * ((k * 7) % 10) / 10, 0.02, 1 / 60, 1, k / 60);
      expect(low()).toBeLessThan(before * 0.2);
    }
  });
});

describe('snap at 80% removal (DESIGN 5.2)', () => {
  function withPlaque(): { m: CleanModel; tooth: number } {
    for (let seed = 1; seed < 60; seed++) {
      const m = createModel(buildSetup({ caseType: 'routine', level: 4, seed }));
      const tooth = m.problem.find((i) => m.teeth[i].plaque0 + m.teeth[i].stain0 > 5);
      if (tooth !== undefined) return { m, tooth };
    }
    throw new Error('no seed');
  }

  it('does not snap at 78% removed, snaps once 80% is gone', () => {
    const { m, tooth } = withPlaque();
    popTartarOn(m, tooth);
    const t = m.teeth[tooth];
    expect(t.snapped).toBe(false);
    leaveShare(m, tooth, 0.78);
    expect(toothDone(m, tooth)).toBe(false);
    leaveShare(m, tooth, 0.801);
    expect(toothDone(m, tooth)).toBe(true);
    // the next touch of a tool snaps it, and the leftover specks fade
    applyPolisher(m, tooth, 0.5, 0.3, 1 / 60, 1, 0);
    expect(t.snapped).toBe(true);
    let left = 0;
    for (let c = 0; c < CELLS; c++) left += t.plaque[c] + t.stain[c];
    expect(left).toBe(0);
    expect(m.events.some((e) => e.type === 'toothSnap' && e.tooth === tooth)).toBe(true);
  });

  it('area objectives count 80% removal on a tooth as all of it', () => {
    const { m } = withPlaque();
    for (const i of m.problem) { popTartarOn(m, i); leaveShare(m, i, 0.8); }
    updateObjectives(m, true);
    const plaque = m.objectives.find((o) => o.id === 'plaque');
    if (plaque) expect(plaque.progress).toBeGreaterThan(0.999);
    expect(fractions(m).plaque).toBeGreaterThan(0.79);
  });

  it('last bits: specks pulse from 70% removed, not before, and never on a snapped tooth', () => {
    const { m, tooth } = withPlaque();
    popTartarOn(m, tooth);
    // removal weighs plaque and stain 1 and each popped lump 0.5
    const wT = 0.5 * m.tartar.filter((d) => d.tooth === tooth).length;
    const at = (area: number) => (area + wT) / (1 + wT);
    let below = 0.3;
    while (at(below + 0.02) < RATES.lastBits) below += 0.02;
    leaveShare(m, tooth, below);
    expect(toothRemoval(m, tooth)).toBeCloseTo(at(below), 3);
    expect(lastBits(m, tooth)).toBe(false);
    leaveShare(m, tooth, Math.max(0.72, below + 0.04));
    expect(lastBits(m, tooth)).toBe(true);
    // the mini-map reads progress toward the snap
    expect(toothProgress(m, tooth)).toBeGreaterThan(0.85);
    expect(toothDirtLeft(m, tooth)).toBeLessThan(0.15);
    leaveShare(m, tooth, 0.85);
    applyPolisher(m, tooth, 0.5, 0.3, 1 / 60, 1, 0);
    expect(m.teeth[tooth].snapped).toBe(true);
    expect(lastBits(m, tooth)).toBe(false);
    expect(toothDirtLeft(m, tooth)).toBe(0);
  });

  it('a tooth with a lump left is not in last bits until the lump is mostly gone', () => {
    for (let seed = 1; seed < 60; seed++) {
      const m = createModel(buildSetup({ caseType: 'routine', level: 4, seed }));
      const tooth = m.problem.find((i) => m.tartar.some((d) => d.tooth === i) && m.teeth[i].plaque0 + m.teeth[i].stain0 > 5);
      if (tooth === undefined) continue;
      leaveShare(m, tooth, 1);
      expect(toothDone(m, tooth)).toBe(false);
      const nd = m.tartar.filter((d) => d.tooth === tooth).length;
      expect(lastBits(m, tooth)).toBe(1 / (1 + 0.5 * nd) >= RATES.lastBits);
      popTartarOn(m, tooth);
      expect(m.teeth[tooth].snapped).toBe(true);
      return;
    }
    throw new Error('no seed');
  });
});
