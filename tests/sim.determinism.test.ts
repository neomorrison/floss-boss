import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { GameState } from '../src/core/types';
import { graduated, grant, playDay, result } from './sim.helpers';

function script(seed: number): GameState {
  const s = graduated(seed);
  for (let d = 0; d < 3; d++) { playDay(s, 'hands', 0.8 + 0.05 * d); sim.closeDay(s); }
  grant(s, 8000);
  s.player.level = Math.max(4, s.player.level);
  sim.openPractice(s, { name: 'Det Dental', loan: 2000 });
  const cand = s.candidates.find((c) => c.role === 'receptionist') ?? s.candidates[0];
  sim.hire(s, cand.id, 0);
  for (let d = 0; d < 4; d++) { playDay(s, d % 2 ? 'quick' : 'hands'); sim.closeDay(s); }
  return s;
}

describe('determinism', () => {
  it('same seed and same actions give the same state', () => {
    const a = JSON.stringify(script(123));
    const b = JSON.stringify(script(123));
    expect(a).toBe(b);
  });

  it('different seeds give different days', () => {
    expect(JSON.stringify(script(1))).not.toBe(JSON.stringify(script(2)));
  });

  it('how tick() is sliced does not change the outcome', () => {
    const base = graduated(99);
    const a: GameState = JSON.parse(JSON.stringify(base));
    const b: GameState = JSON.parse(JSON.stringify(base));
    const c: GameState = JSON.parse(JSON.stringify(base));
    // put every chair on autopilot so no player input is needed
    for (const s of [a, b, c]) sim.setPlayerMode(s, -1, s.employer!.ops[0].id, 'auto');
    const evA = sim.tick(a, 240);
    const evB: unknown[] = [];
    for (let i = 0; i < 240 * 3; i++) evB.push(...sim.tick(b, 1 / 3));
    const evC: unknown[] = [];
    let left = 240;
    const slices = [0.7, 3.3, 0.05, 11, 0.95, 2.5];
    for (let i = 0; left > 1e-9; i++) { const m = Math.min(left, slices[i % slices.length]); evC.push(...sim.tick(c, m)); left -= m; }
    const strip = (s: GameState) => JSON.stringify({ ...s, minute: Math.round(s.minute * 1000) / 1000 });
    expect(strip(b)).toBe(strip(a));
    expect(strip(c)).toBe(strip(a));
    expect(evB.length).toBe(evA.length);
    expect(evC.length).toBe(evA.length);
  });

  it('never uses Math.random', () => {
    const orig = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    try {
      const s = graduated(5);
      playDay(s, 'hands');
      sim.closeDay(s);
      sim.schoolSetup(sim.newGame({ name: 'x', avatar: 0, seed: 1, nowMs: 0 }), 1);
      sim.completeSchool(sim.newGame({ name: 'x', avatar: 0, seed: 1, nowMs: 0 }), 1, result(0.9));
    } finally {
      Math.random = orig;
    }
  });
});
