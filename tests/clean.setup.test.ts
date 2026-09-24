import { describe, expect, it } from 'vitest';
import { buildSetup, modsFromSkills, DEFAULT_MODS } from '../src/clean/setup';
import { createModel, fractions, parFor, scoreClean, tickModel, applyScaler, RATES } from '../src/clean/dirt';
import { PATIENT_ARCHETYPES } from '../src/data/patients';

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

  it('builds a valid setup for every archetype and the par matches DESIGN 5.5', () => {
    for (const a of ['mannequin', ...PATIENT_ARCHETYPES] as const) {
      const s = buildSetup({ archetype: a, seed: 99 });
      expect(s.patient.archetype).toBe(a);
      expect(s.parSeconds).toBe(Math.round(parFor(s)));
      const m = createModel(s);
      expect(m.tartar.length).toBe(Math.round(s.dirt.tartarCount));
      const f = fractions(m);
      expect(f.clean).toBeGreaterThanOrEqual(0);
      expect(f.clean).toBeLessThanOrEqual(0.12);
    }
    const senior = buildSetup({ archetype: 'senior', seed: 4 });
    expect(senior.missingTeeth.length).toBeGreaterThanOrEqual(3);
    expect(senior.missingTeeth.length).toBeLessThanOrEqual(6);
  });

  it('speed cleaner raises par', () => {
    const a = buildSetup({ archetype: 'regular' });
    const b = buildSetup({ archetype: 'regular', skills: ['speedCleaner'] });
    expect(b.parSeconds).toBeGreaterThan(a.parSeconds);
  });
});

describe('a quick session', () => {
  it('scraping every deposit raises the clean score and records chunks', () => {
    const m = createModel(buildSetup({ archetype: 'smoker', seed: 3 }));
    for (const d of m.tartar) {
      let n = 0;
      while (!d.popped && n < 2000) { applyScaler(m, d.tooth, d.u, d.v, RATES.strokeCap / 60, 1 / 60); tickModel(m, { dt: 1 / 60, working: true, molar: false, gum: false, gumRisk: 1, headphones: false, numbing: false }); n++; }
      expect(d.popped).toBe(true);
    }
    const r = scoreClean(m, 'done', m.time);
    expect(r.tartar).toBe(1);
    expect(r.chunks).toBe(m.tartar.length);
    expect(r.bestCombo).toBeGreaterThanOrEqual(2);
    expect(r.mess).toBeGreaterThan(0);        // bits left on the tongue until suctioned
    // about a second of full-speed scraping per deposit at tier 1
    expect(m.time / m.tartar.length).toBeLessThan(2.5);
  });
});
