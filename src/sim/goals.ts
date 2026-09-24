// Daily goals and achievements. DESIGN 8.10.
import type { GameState, Goal, SimEvent } from '../core/types';
import type { Rng } from '../core/rng';
import { ACHIEVEMENTS } from '../data/achievements';
import { money } from '../core/format';
import { S, SimGoal, addCash, nextId, pushEvent } from './internal';
import { avgNet, gainXp, tierIndex, valuation } from './progress';

type Kind = Goal['kind'];

function goalText(kind: Kind, target: number, limit?: number): string {
  switch (kind) {
    case 'chunks': return `Pop ${target} tartar chunks`;
    case 'fiveStars': return target === 1 ? 'Earn a five-star review' : `Earn ${target} five-star reviews`;
    case 'served': return `Serve ${target} patients`;
    case 'fastClean': return `Finish a cleaning in under ${limit ?? 90} s`;
    case 'addons': return `Sell ${target} add-ons`;
    case 'perfect': return 'Finish a perfect clean';
    case 'combo': return `Hit a ${target}-chunk combo`;
  }
}

/** Replace the daily goals (3). */
export function makeGoals(state: GameState, rng: Rng): void {
  const L = state.player.level;
  const owner = state.phase === 'owner';
  let cashEach: number;
  if (owner) cashEach = Math.max(100, Math.round((Math.max(0, avgNet(state, 3)) * 0.17) / 10) * 10);
  else cashEach = Math.round((30 + 8 * L) / 5) * 5;
  const xpEach = 15 + 5 * L;
  const make = (kind: Kind, target: number, limit?: number): SimGoal => ({
    id: nextId(state, 'g'), kind, target, progress: 0, rewardCash: cashEach, rewardXp: xpEach,
    done: false, claimed: false, text: goalText(kind, target, limit), limit,
  });
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
    const expected = state.locations.reduce((s, c) => s + Math.max(2, c.day.served || c.ops.length * 5), 0);
    goals.push(make('served', Math.max(4, Math.round(expected * 0.9))));
    const second: (() => SimGoal)[] = [
      () => make('fiveStars', Math.max(1, Math.round(expected * 0.15))),
      () => make('addons', Math.max(2, Math.round(expected * 0.3))),
    ];
    goals.push(second[rng.int(0, 1)]());
    const third: (() => SimGoal)[] = [
      () => make('chunks', 10 + 5 * rng.int(1, 4)),
      () => make('fastClean', 1, [120, 100, 90][rng.int(0, 2)]),
      () => make('combo', rng.int(4, 7)),
      () => make(rng.chance(0.5) ? 'fiveStars' : 'addons', Math.max(2, Math.round(expected * 0.2))),
    ];
    goals.push(third[rng.int(0, third.length - 1)]());
  }
  state.goals = goals;
  state.goalsDay = state.day;
}

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

export function claimGoal(state: GameState, goalId: string, ev: SimEvent[] | null = null): { ok: true; message?: string } | { ok: false; reason: string } {
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) return { ok: false, reason: 'Goal not found' };
  if (g.claimed) return { ok: false, reason: 'Already claimed' };
  if (!g.done) return { ok: false, reason: 'Goal not done yet' };
  g.claimed = true;
  addCash(state, g.rewardCash, 'Goal rewards');
  gainXp(state, g.rewardXp, ev);
  const s = S(state);
  (s.dayGoals ??= []).push(g.text);
  checkAchievements(state, ev);
  return { ok: true, message: `${money(g.rewardCash)} and ${g.rewardXp} XP` };
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
