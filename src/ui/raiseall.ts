// Pure UI helpers for "Raise all" (Payroll Day skill, Hard Bargain upgrade: DESIGN 8.5 raise rules, 10.6).
// No DOM: unit tested in tests/ui.raiseall.test.ts.
//
// The sim side (sim.raiseAllQuote, sim.raiseAll) is built in parallel with this UI. Every call here goes
// through a guard (raiseAllReady / quoteRaiseAll / runRaiseAll) that takes the sim module as a plain value
// instead of importing it directly: an object missing those two exports still satisfies RaiseAllModule
// (both fields are optional), so this file, and anything that calls it, compiles and runs whether or not
// they have landed yet. Once sim exports the real functions with these signatures, calls flow straight
// through with no code change needed here.
import type { ActionResult, GameState } from '../core/types';
import { money, signedMoney } from '../core/format';

/** One staff member's raise in a quote (sim/staff.ts RaiseAllStaff: not re-exported by name from '../sim',
 * so this mirrors its shape structurally). */
export interface RaiseAllStaff { clinicIndex: number; staffId: string; name: string; from: number; to: number }

/** sim.raiseAllQuote's return shape. */
export interface RaiseAllQuote {
  ok: boolean;
  reason?: string;
  count: number;
  perDay: number;      // what raising everyone below their ask costs per day
  fullPerDay: number;  // what a full raise (no discount) would have cost per day
  staff: RaiseAllStaff[];
}

export interface RaiseAllModule {
  raiseAllQuote?: (state: GameState, clinicIndex: number | 'all') => RaiseAllQuote;
  raiseAll?: (state: GameState, clinicIndex: number | 'all') => ActionResult;
}

/** True once both sim functions exist. */
export function raiseAllReady(mod: RaiseAllModule): boolean {
  return typeof mod.raiseAllQuote === 'function' && typeof mod.raiseAll === 'function';
}

/** The quote, or null while sim.raiseAllQuote has not landed yet (or throws: DESIGN "not built yet" guard). */
export function quoteRaiseAll(mod: RaiseAllModule, state: GameState, clinicIndex: number | 'all'): RaiseAllQuote | null {
  if (typeof mod.raiseAllQuote !== 'function') return null;
  try { return mod.raiseAllQuote(state, clinicIndex); } catch { return null; }
}

/** Give the raise. 'Not available yet' while sim.raiseAll has not landed (matches src/ui/game.ts act()'s own
 * fallback for a missing sim call, so a stale UI fails the same calm way). */
export function runRaiseAll(mod: RaiseAllModule, state: GameState, clinicIndex: number | 'all'): ActionResult {
  if (typeof mod.raiseAll !== 'function') return { ok: false, reason: 'Not available yet' };
  return mod.raiseAll(state, clinicIndex);
}

export interface RaiseAllSummary {
  count: number;
  perDay: number;
  savings: number;                    // > 0 only meaningful with Hard Bargain
  subLabel: string | undefined;       // button sub-text, e.g. "+$184/day"
  confirmText: string;                // confirm dialog body, product voice, no em dashes
  disabledReason: string | undefined; // set when q.ok is false ("Everyone is paid what they ask")
}

/** Formats a quote for the button and the confirm dialog (DESIGN 8.5 raise rules, 10.6). */
export function summarizeRaiseAll(q: RaiseAllQuote, hardBargain: boolean): RaiseAllSummary {
  const savings = hardBargain ? Math.max(0, q.fullPerDay - q.perDay) : 0;
  const lines = [`Raise ${q.count} staff: ${signedMoney(q.perDay)}/day.`];
  if (savings > 0) lines.push(`Saves ${money(savings)}/day.`);
  return {
    count: q.count,
    perDay: q.perDay,
    savings,
    subLabel: q.count ? `${signedMoney(q.perDay)}/day` : undefined,
    confirmText: lines.join(' '),
    disabledReason: q.ok ? undefined : (q.reason || 'Everyone is paid what they ask'),
  };
}
