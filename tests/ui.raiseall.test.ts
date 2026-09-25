// "Raise all" (Payroll Day skill, Hard Bargain upgrade: DESIGN 8.5 raise rules, 10.6). The guard is tested
// against a plain mock module (never the real sim import) so these stay meaningful whether or not
// sim.raiseAllQuote / sim.raiseAll have landed in src/sim.
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/core/types';
import {
  quoteRaiseAll, raiseAllReady, runRaiseAll, summarizeRaiseAll, type RaiseAllModule, type RaiseAllQuote,
} from '../src/ui/raiseall';

const state = {} as GameState;

const quote = (over: Partial<RaiseAllQuote> = {}): RaiseAllQuote =>
  ({ ok: true, count: 5, perDay: 184, fullPerDay: 184, staff: [], ...over });

describe('raise all: the guard around sim.raiseAllQuote / sim.raiseAll', () => {
  it('is not ready when either export is missing', () => {
    expect(raiseAllReady({})).toBe(false);
    expect(raiseAllReady({ raiseAllQuote: () => quote() })).toBe(false);
    expect(raiseAllReady({ raiseAll: () => ({ ok: true }) })).toBe(false);
    expect(raiseAllReady({ raiseAllQuote: () => quote(), raiseAll: () => ({ ok: true }) })).toBe(true);
  });

  it('quoteRaiseAll returns null while the sim side has not landed, or if it throws', () => {
    expect(quoteRaiseAll({}, state, 0)).toBeNull();
    const throws: RaiseAllModule = { raiseAllQuote: () => { throw new Error('not built yet'); } };
    expect(quoteRaiseAll(throws, state, 0)).toBeNull();
  });

  it('quoteRaiseAll calls straight through once landed, with the scope untouched', () => {
    let seen: unknown;
    const mod: RaiseAllModule = { raiseAllQuote: (s, idx) => { seen = idx; return quote({ count: 3 }); } };
    expect(quoteRaiseAll(mod, state, 'all')?.count).toBe(3);
    expect(seen).toBe('all');
    expect(quoteRaiseAll(mod, state, 2)?.count).toBe(3);
    expect(seen).toBe(2);
  });

  it('runRaiseAll fails calmly, in product voice, while sim.raiseAll has not landed', () => {
    const r = runRaiseAll({}, state, 0);
    expect(r).toEqual({ ok: false, reason: 'Not available yet' });
  });

  it('runRaiseAll calls straight through once landed', () => {
    const mod: RaiseAllModule = { raiseAll: () => ({ ok: true, message: 'Raised 5 staff: +$184/day' }) };
    expect(runRaiseAll(mod, state, 'all')).toEqual({ ok: true, message: 'Raised 5 staff: +$184/day' });
  });
});

describe('raise all: quote summary (button and confirm text)', () => {
  it('shows the raise and a per-day sub-label without Hard Bargain', () => {
    const sum = summarizeRaiseAll(quote({ count: 5, perDay: 184, fullPerDay: 184 }), false);
    expect(sum.subLabel).toBe('+$184/day');
    expect(sum.confirmText).toBe('Raise 5 staff: +$184/day.');
    expect(sum.savings).toBe(0);
    expect(sum.disabledReason).toBeUndefined();
    expect(sum.confirmText).not.toMatch(/Saves/);
  });

  it('adds a savings line with Hard Bargain', () => {
    const sum = summarizeRaiseAll(quote({ count: 5, perDay: 110, fullPerDay: 184 }), true);
    expect(sum.savings).toBe(74);
    expect(sum.subLabel).toBe('+$110/day');
    expect(sum.confirmText).toBe('Raise 5 staff: +$110/day. Saves $74/day.');
  });

  it('has no savings line when Hard Bargain has nothing to discount', () => {
    const sum = summarizeRaiseAll(quote({ count: 1, perDay: 20, fullPerDay: 20 }), true);
    expect(sum.savings).toBe(0);
    expect(sum.confirmText).not.toMatch(/Saves/);
  });

  it('carries the reason, with a calm fallback, when nobody is below their ask', () => {
    const empty: RaiseAllQuote = { ok: false, reason: 'Everyone is paid what they ask', count: 0, perDay: 0, fullPerDay: 0, staff: [] };
    expect(summarizeRaiseAll(empty, false).disabledReason).toBe('Everyone is paid what they ask');
    expect(summarizeRaiseAll(empty, false).subLabel).toBeUndefined();
    const noReason: RaiseAllQuote = { ok: false, count: 0, perDay: 0, fullPerDay: 0, staff: [] };
    expect(summarizeRaiseAll(noReason, false).disabledReason).toBe('Everyone is paid what they ask');
  });

  it('never reads as AI writing: no em dashes in the confirm text', () => {
    expect(summarizeRaiseAll(quote({ perDay: 110, fullPerDay: 184 }), true).confirmText).not.toMatch(/—/);
  });
});
