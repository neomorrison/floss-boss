import { describe, expect, it } from 'vitest';
import { buildSetup, modsFromSkills, DEFAULT_MODS } from '../src/clean/setup';
import { createModel, fractions, parFor, scoreClean, tickModel, applyScaler, RATES } from '../src/clean/dirt';
import { PATIENT_ARCHETYPES } from '../src/data/patients';
import type { CaseType } from '../src/core/types';

describe('setup builder', () => {
  it('maps skills to clean modifiers (DESIGN 4.3)', () => {
    expect(modsFromSkills([])).toEqual(DEFAULT_MODS);
    const m = modsFromSkills(['steady1', 'steady2', 'power', 'polishPro', 'eagleEye', 'speedCleaner', 'calmingVoice', 'smallTalk', 'kidWhisperer', 'gagGuru']);
    expect(m.gumDamage).toBe(0.5);
    expect(m.scalerPower).toBe(1.25);
    expect(m.polishRadius).toBe(1.25);
    expect(m.eagleEye).toBe(true);
    expect(m.parMult).toBe(1.2);
    expect(m.reassure).toBe(1.5);
    expect(m.comfortDrain).toBe(0.8);
    expect(m.fidget).toBe(0.4);
    expect(m.gagDelay).toBe(2);
  });

  it('builds a valid setup for every archetype and case, par per DESIGN 5.8', () => {
    for (const a of ['mannequin', ...PATIENT_ARCHETYPES] as const) {
      for (const c of ['routine', 'candy', 'whitening', 'braces', 'pirate', 'deep'] as CaseType[]) {
        const s = buildSetup({ archetype: a, caseType: c, seed: 99, level: 3 });
        expect(s.patient.archetype).toBe(a);
        expect(s.caseType).toBe(c);
        expect(s.parSeconds).toBe(Math.round(parFor(s)));
        for (const t of s.problemTeeth) expect(s.missingTeeth).not.toContain(t);
        const m = createModel(s);
        expect(fractions(m).clean).toBe(0);
      }
    }
    const s = buildSetup({ caseType: 'routine', level: 1 });
    expect(parFor(s)).toBeCloseTo(20 + 2.6 * s.dirt.tartarCount * s.dirt.tartarSize + 5 * s.problemTeeth.length + 4 * s.dirt.debrisCount, 6);
    const w = buildSetup({ caseType: 'whitening' });
    expect(parFor(w) - parFor({ ...w, caseType: 'routine' })).toBeCloseTo(25, 6);
  });

  it('pirates miss 3 to 6 teeth but keep their front teeth', () => {
    for (let seed = 1; seed < 10; seed++) {
      const s = buildSetup({ caseType: 'pirate', seed });
      expect(s.missingTeeth.length).toBeGreaterThanOrEqual(3);
      expect(s.missingTeeth.length).toBeLessThanOrEqual(6);
      expect(s.special.goldTooth).not.toBeNull();
      expect(s.missingTeeth).not.toContain(s.special.goldTooth);
    }
  });

  it('speed cleaner raises par', () => {
    const a = buildSetup({ archetype: 'regular' });
    const b = buildSetup({ archetype: 'regular', skills: ['speedCleaner'] });
    expect(b.parSeconds).toBeGreaterThan(a.parSeconds);
  });
});

describe('a quick session', () => {
  it('scraping every deposit pops them fast and records chunks', () => {
    const m = createModel(buildSetup({ archetype: 'smoker', seed: 3, level: 5 }));
    for (const d of m.tartar) {
      let n = 0;
      while (!d.popped && n < 2000) { applyScaler(m, d.tooth, d.u, d.v, RATES.strokeCap / 60, 1 / 60); tickModel(m, { dt: 1 / 60, working: true, molar: false, gum: false, gumRisk: 1, headphones: false, numbing: false }); n++; }
      expect(d.popped).toBe(true);
    }
    const r = scoreClean(m, 'done', m.time);
    expect(r.tartar).toBe(1);
    expect(r.chunks).toBe(m.tartar.length);
    expect(r.mess).toBeGreaterThan(0);        // bits resting on the tongue until rinsed and suctioned
    // a Sickle Scaler takes under a second of scraping per deposit
    expect(m.time / m.tartar.length).toBeLessThan(1);
  });
});
