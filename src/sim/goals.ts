// Daily goals and achievements. DESIGN 8.10.
import type { GameState, Goal, SimEvent } from '../core/types';
import type { Rng } from '../core/rng';
import { ACHIEVEMENTS } from '../data/achievements';
import { money } from '../core/format';
import { PLAYER_ID } from '../core/constants';
import { CAMPAIGN_ORDER } from '../data/manager';
import { S, SimGoal, addCash, nextId, pushEvent } from './internal';
import { avgNet, gainXp, tierIndex, valuation } from './progress';
import { campaignStatus } from './manager';

type Kind = Goal['kind'];

function goalText(kind: Kind, target: number, limit?: number, where?: string): string {
  switch (kind) {
    case 'chunks': return `Pop ${target} tartar chunks`;
    case 'fiveStars': return target === 1 ? 'Earn a five-star review' : `Earn ${target} five-star reviews`;
    case 'served': return `Serve ${target} patients`;
    // a clean only counts with 3 stars or more (out/fix/sim-late.md: the text now says so)
    case 'fastClean': return `Finish a 3-star cleaning in under ${limit ?? 90} s`;
    case 'addons': return `Sell ${target} add-ons`;
    case 'perfect': return 'Finish a perfect clean';
    case 'combo': return `Hit a ${target}-chunk combo`;
    case 'campaign': return 'Start a campaign';
    case 'noWalkouts': return `No walkouts at ${where ?? 'your office'} today`;
    case 'net': return target > 0 ? `Make ${money(target)} operating net today` : 'End the day with a positive operating net';
    case 'events': return target === 1 ? 'Answer an event card' : `Answer ${target} event cards`;
    case 'rating': return `Keep ${where ?? 'your office'} at ${(target / 100).toFixed(2)} stars or better`;
  }
}

/** Replace the daily goals (3). Owner goals come from management verbs (DESIGN 10.7); hands-on goals only
 * appear when the owner staffs a chair in hands mode. */
export function makeGoals(state: GameState, rng: Rng): void {
  const L = state.player.level;
  const owner = state.phase === 'owner';
  let cashEach: number;
  if (owner) cashEach = Math.max(100, Math.round((Math.max(0, avgNet(state, 3)) * GOAL_NET_SHARE) / 10) * 10);
  else cashEach = Math.round((20 + 5 * L) / 5) * 5;
  const xpEach = 15 + 5 * L;
  const make = (kind: Kind, target: number, limit?: number, clinicId?: string): SimGoal => {
    const where = clinicId ? state.locations.find((c) => c.id === clinicId)?.name : undefined;
    return {
      id: nextId(state, 'g'), kind, target, progress: 0, rewardCash: cashEach, rewardXp: xpEach,
      done: false, claimed: false, text: goalText(kind, kind === 'net' || kind === 'rating' ? limit ?? 0 : target, limit, where), limit, clinicId,
    };
  };
  const goals: SimGoal[] = [];
  if (!owner) {
    const shift = shiftSize(L);
    const pool: (() => SimGoal)[] = [
      () => make('chunks', 5 * Math.round((shift * 7 + L * 2) / 5)),
      () => make('fiveStars', rng.int(1, 2)),
      () => make('served', shift),
      () => make('fastClean', 1, [120, 100, 90, 80][rng.int(0, 3)]),
      () => make('combo', rng.int(4, 7)),
      () => make('perfect', 1),
    ];
    const order = pool.map((f, i) => ({ f, r: rng.next() + (i === 2 ? -0.3 : 0) })).sort((a, b) => a.r - b.r);
    for (const o of order.slice(0, 3)) goals.push(o.f());
  } else {
    const expected = state.locations.reduce((s, c) => s + Math.max(2, c.day.booked || c.day.served || c.ops.length * 5), 0);
    goals.push(make('served', Math.max(4, Math.round(expected * 0.85))));
    // a busy location for the location goals: the active one
    const c = state.locations[state.active] ?? state.locations[0];
    const net = Math.max(0, avgNet(state, 3));
    const second: (() => SimGoal)[] = [
      () => make('fiveStars', Math.max(1, Math.round(expected * 0.15))),
      () => make('addons', Math.max(2, Math.round(expected * 0.3))),
      () => make('noWalkouts', 1, undefined, c.id),
      () => make('net', 1, net > 0 ? Math.max(100, Math.round((net * 0.9) / 50) * 50) : 0),
    ];
    if (c.reviews.length >= 5) second.push(() => make('rating', 1, Math.max(300, Math.floor(c.rating * 20) * 5), c.id));
    goals.push(second[rng.int(0, second.length - 1)]());
    const k3: Kind = rng.chance(0.5) ? 'fiveStars' : 'addons';
    const third: { kind: Kind; f: () => SimGoal }[] = [
      { kind: k3, f: () => make(k3, Math.max(2, Math.round(expected * 0.2))) },
    ];
    const pending = state.pendingEvents?.length ?? 0;
    if (pending > 0 && !state.settings?.autoHuddle && (state.huddleDay ?? 0) < state.day) third.push({ kind: 'events', f: () => make('events', Math.min(pending, 2)) });
    const canCampaign = state.locations.some((_, i) => CAMPAIGN_ORDER.some((id) => campaignStatus(state, i, id).ok));
    if (canCampaign) third.push({ kind: 'campaign', f: () => make('campaign', 1) });
    // hands-on goals only when you clean somewhere yourself
    const hands = state.locations.some((l) => l.ops.some((o) => o.staffId === PLAYER_ID && o.playerMode === 'hands'));
    if (hands) {
      third.push(
        { kind: 'chunks', f: () => make('chunks', 10 + 5 * rng.int(1, 4)) },
        { kind: 'fastClean', f: () => make('fastClean', 1, [120, 100, 90][rng.int(0, 2)]) },
        { kind: 'combo', f: () => make('combo', rng.int(4, 7)) },
      );
    }
    // never two goals of the same kind
    const fresh = third.filter((t) => !goals.some((x) => x.kind === t.kind));
    const list = fresh.length ? fresh : third;
    goals.push(list[rng.int(0, list.length - 1)].f());
  }
  state.goals = goals;
  state.goalsDay = state.day;
}

/** Each owner goal pays this share of the average operating net of the last 3 days (DESIGN 8.10). */
export const GOAL_NET_SHARE = 0.2;

export function shiftSize(level: number): number {
  return level >= 7 ? 6 : level >= 4 ? 5 : 4;
}

/** Progress every open goal of `kind`. `value` is added (or, for combo/fastClean, compared). */
export function progressGoal(state: GameState, kind: Kind, value: number, ev: SimEvent[] | null): void {
  for (const g of state.goals as SimGoal[]) {
    if (g.kind !== kind || g.done) continue;
    if (kind === 'combo') g.progress = Math.max(g.progress, Math.min(g.target, value));
    else if (kind === 'fastClean') { if (value > 0 && value <= (g.limit ?? 90)) g.progress = 1; }
    else g.progress = Math.min(g.target, g.progress + value);
    if (g.progress >= g.target) {
      g.done = true;
      pushEvent(ev, { type: 'goalDone', goalId: g.id, text: g.text });
    }
  }
}

/** Claim a finished goal. `share` below 1 pays part of the reward (left unclaimed at close without Paperwork Pro). */
export function claimGoal(state: GameState, goalId: string, ev: SimEvent[] | null = null, share = 1): { ok: true; message?: string } | { ok: false; reason: string } {
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) return { ok: false, reason: 'Goal not found' };
  if (g.claimed) return { ok: false, reason: 'Already claimed' };
  if (!g.done) return { ok: false, reason: 'Goal not done yet' };
  g.claimed = true;
  addCash(state, Math.round(g.rewardCash * share), 'Goal rewards');
  gainXp(state, Math.round(g.rewardXp * share), ev);
  const s = S(state);
  (s.dayGoals ??= []).push(g.text);
  checkAchievements(state, ev);
  return { ok: true, message: `${money(Math.round(g.rewardCash * share))} and ${Math.round(g.rewardXp * share)} XP` };
}

/** Goals judged at the day close: operating net, no walkouts, keep the rating. */
export function endOfDayGoals(state: GameState, opNet: number, ev: SimEvent[] | null): void {
  for (const g of state.goals as SimGoal[]) {
    if (g.done) continue;
    const kind = g.kind;
    const c = g.clinicId ? state.locations.find((l) => l.id === g.clinicId) : null;
    let ok = false;
    if (kind === 'net') ok = opNet >= (g.limit ?? 0) && opNet > 0;
    else if (kind === 'noWalkouts') ok = !!c && c.day.walkouts === 0 && c.day.served > 0;
    else if (kind === 'rating') ok = !!c && Math.round(c.rating * 100) >= (g.limit ?? 0);
    else continue;
    if (ok) {
      g.progress = g.target;
      g.done = true;
      pushEvent(ev, { type: 'goalDone', goalId: g.id, text: g.text });
    }
  }
}

/** Award any achievement whose condition now holds. Safe to call often. */
export function checkAchievements(state: GameState, ev: SimEvent[] | null): void {
  const st = state.stats;
  const f = state.flags;
  const locs = state.locations;
  const has = (id: string) => state.achievements.includes(id);
  const cond: Record<string, () => boolean> = {
    firstChunk: () => st.chunks >= 1,
    graduate: () => state.phase !== 'school',
    fiveStar: () => st.fiveStars >= 1,
    perfect: () => st.perfect >= 1,
    combo10: () => st.bestCombo >= 10,
    chunks100: () => st.chunks >= 100,
    chunks1000: () => st.chunks >= 1000,
    speed60: () => !!f.speed60,
    noOw: () => !!f.noOw,
    senior: () => state.player.level >= 4,
    lead: () => state.player.level >= 7,
    ultrasonic: () => state.player.tools.scaler >= 4,
    owner: () => state.phase === 'owner',
    firstHire: () => st.hires >= 1,
    fullStaff: () => locs.some((c) => c.ops.length >= 2 && c.ops.every((o) => o.staffId !== null)),
    dentist: () => locs.some((c) => c.staff.some((s) => s.role === 'dentist')),
    rating45: () => locs.some((c) => c.rating >= 4.5 && c.reviews.length >= 10),
    t2: () => locs.some((c) => tierIndex(c.tier) >= 1),
    t3: () => locs.some((c) => tierIndex(c.tier) >= 2),
    t4: () => locs.some((c) => tierIndex(c.tier) >= 3),
    chain2: () => locs.length >= 2,
    chain5: () => locs.length >= 5,
    million: () => state.phase === 'owner' && valuation(state) >= 1_000_000,
    debtFree: () => !!f.debtFree,
  };
  for (const a of ACHIEVEMENTS) {
    if (has(a.id)) continue;
    const fn = cond[a.id];
    if (fn && fn()) {
      state.achievements.push(a.id);
      pushEvent(ev, { type: 'achievement', id: a.id, name: a.name });
    }
  }
}
