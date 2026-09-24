import { describe, expect, it } from 'vitest';
import { FLOSS, flossHook, flossMove, flossTick, newFloss, type FlossEvent } from '../src/clean/floss';
import { createModel, flossStroke } from '../src/clean/dirt';
import { buildSetup } from '../src/clean/setup';

/** Move in small steps like a pointer would. */
function glide(st: ReturnType<typeof newFloss>, along: number, cross: number, steps = 20): FlossEvent[] {
  const out: FlossEvent[] = [];
  for (let i = 0; i < steps; i++) flossMove(st, along / steps, cross, out);
  return out;
}

describe('floss state machine (DESIGN 5.4)', () => {
  it('cross-axis motion is blocked: the string bows and creaks but does not move', () => {
    const st = newFloss();
    flossHook(st, false, false);
    const out = glide(st, 0, 0.8);
    expect(st.s).toBe(0);
    expect(st.bend).toBeGreaterThan(0.8);
    expect(out).toContain('creak');
  });

  it('pushing to the contact builds pressure and snaps through with a thwip', () => {
    const st = newFloss();
    flossHook(st, false, false);
    const a = glide(st, FLOSS.contact, 0);
    expect(st.phase).toBe('above');
    expect(st.s).toBeCloseTo(FLOSS.contact, 6);
    expect(a).not.toContain('thwip');
    const b = glide(st, 0.1, 0);
    expect(st.phase).toBe('above');
    expect(st.pressure).toBeGreaterThan(0.3);
    expect(b).toContain('press');
    const c = glide(st, 0.2, 0);
    expect(c).toContain('thwip');
    expect(st.phase).toBe('through');
    expect(st.s).toBeGreaterThan(FLOSS.contact);
  });

  it('easing off before the snap relaxes the pressure', () => {
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, FLOSS.contact + 0.15, 0);
    const p = st.pressure;
    glide(st, -0.05, 0);
    expect(st.pressure).toBeLessThan(p);
    expect(st.s).toBeCloseTo(FLOSS.contact, 6);
  });

  it('saw strokes: each reversal with enough travel counts; small jiggles do not', () => {
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, FLOSS.contact + 0.3, 0);
    expect(st.phase).toBe('through');
    const out: FlossEvent[] = [];
    for (let k = 0; k < 4; k++) { out.push(...glide(st, 0.25, 0)); out.push(...glide(st, -0.25, 0)); }
    expect(out.filter((e) => e === 'stroke').length).toBeGreaterThanOrEqual(6);
    const jig: FlossEvent[] = [];
    for (let k = 0; k < 10; k++) { jig.push(...glide(st, 0.02, 0, 2)); jig.push(...glide(st, -0.02, 0, 2)); }
    // only the first reversal (ending the last long stroke) may count
    expect(jig.filter((e) => e === 'stroke').length).toBeLessThanOrEqual(1);
  });

  it('pulling back past the contact zips out', () => {
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, FLOSS.contact + 0.3, 0);
    const out = glide(st, -0.9, 0, 40);
    expect(out).toContain('zip');
    expect(st.phase).toBe('idle');
  });

  it('braces: threading needs 0.6 s of stillness first', () => {
    const st = newFloss();
    flossHook(st, true, true);
    expect(st.phase).toBe('thread');
    const out: FlossEvent[] = [];
    flossMove(st, 0.5, 0, out);
    expect(st.s).toBeCloseTo(0.55, 6);
    for (let i = 0; i < 20; i++) flossTick(st, 1 / 60, true, out);
    expect(st.phase).toBe('thread');
    for (let i = 0; i < 20; i++) flossTick(st, 1 / 60, true, out);
    expect(out).toContain('threaded');
    expect(st.phase).toBe('through');
  });

  it('strokes pop the food through the model', () => {
    const m = createModel(buildSetup({ caseType: 'routine', seed: 2, level: 3 }));
    const d = m.debris[0];
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, FLOSS.contact + 0.3, 0);
    for (let k = 0; k < 6 && !d.popped; k++) {
      for (const e of [...glide(st, 0.3, 0), ...glide(st, -0.3, 0)]) if (e === 'stroke') flossStroke(m, { a: d.a, b: d.b });
    }
    expect(d.popped).toBe(true);
  });
});
