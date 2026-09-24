// Shared helpers for the sim tests (not a test file itself).
import * as sim from '../src/sim/index';
import type { CleanResult, GameState } from '../src/core/types';

export function result(q: number, o: Partial<CleanResult> = {}): CleanResult {
  const stars = q >= 0.92 ? 5 : q >= 0.8 ? 4 : q >= 0.65 ? 3 : q >= 0.45 ? 2 : 1;
  return {
    quit: 'done', tartar: q, plaque: q, stain: q, debris: q, polish: q, mess: 0, clean: q, comfort: 80,
    quality: q, stars, seconds: 95, chunks: 8, bestCombo: 4, gumHits: 1, gags: 0, perfect: q >= 0.97,
    caseType: 'routine', objectives: [], bonusMet: false, treasure: false, shadeGain: 0, before: null, after: null, ...o,
  };
}

export function graduated(seed = 7): GameState {
  const s = sim.newGame({ name: 'Tess', avatar: 1, seed, nowMs: 1_000_000 });
  sim.completeSchool(s, 1, result(0.85));
  sim.completeSchool(s, 2, result(0.85));
  return s;
}

/** Run the rest of the day: hands-on every patient that sits in the player's chair (or quick clean). */
export function playDay(s: GameState, how: 'hands' | 'quick' = 'hands', q = 0.85, step = 1.7): void {
  let guard = 0;
  while (!s.dayOver && guard++ < 20000) {
    const queue = sim.playerQueue(s);
    if (queue.length) {
      const p = queue[0];
      // quick clean needs Bronze on the case: fall back to a hands-on clean when it is locked
      if (how === 'hands' || !sim.quickCleanStatus(s, p.id).ok) {
        const setup = sim.beginHandsOn(s, p.id);
        sim.completeHandsOn(s, p.id, result(q, { caseType: setup.caseType }));
      } else {
        sim.quickClean(s, p.id);
      }
      continue;
    }
    sim.tick(s, step);
  }
  if (!s.dayOver) throw new Error('day never ended');
}

/** Give the player cash through the ledger so cash == ledger sum stays true. */
export function grant(s: GameState, amount: number): void {
  s.cash += amount;
  s.ledger.push({ day: s.day, minute: s.minute, amount, label: 'Test grant', kind: 'income' });
}

/** Every number anywhere in the object graph is finite. Returns the paths that are not. */
export function nonFinite(obj: unknown, path = 'state', out: string[] = []): string[] {
  if (typeof obj === 'number') { if (!Number.isFinite(obj)) out.push(path); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => nonFinite(v, `${path}[${i}]`, out)); return out; }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) nonFinite(v, `${path}.${k}`, out);
  return out;
}

export function ledgerSum(s: GameState): number {
  return s.ledger.reduce((a, e) => a + e.amount, 0);
}
