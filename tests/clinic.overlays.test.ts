import { describe, expect, it } from 'vitest';
import { CASE_BADGE } from '../src/clinic/overlays';
import { CASE_ORDER } from '../src/data/cases';

describe('clinic overlays: case badge colors (DESIGN 5.5)', () => {
  it('has a badge color for every case type in the catalog', () => {
    for (const c of CASE_ORDER) expect(CASE_BADGE[c], c).toBeDefined();
  });

  it('gives every case a visually distinct fill', () => {
    const fills = CASE_ORDER.map((c) => CASE_BADGE[c].fill.toLowerCase());
    expect(new Set(fills).size).toBe(fills.length);
  });

  it('marks the pirate case black-and-gold, the one two-tone badge', () => {
    expect(CASE_BADGE.pirate.fill.toLowerCase()).toBe('#16323a');
    expect(CASE_BADGE.pirate.ring.toLowerCase()).toBe('#ffd166');
    for (const c of CASE_ORDER) {
      if (c === 'pirate') continue;
      expect(CASE_BADGE[c].ring.toLowerCase()).toBe('#ffffff');
    }
  });
});
