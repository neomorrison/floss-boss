// Headless economy simulation with bot strategies (npm run balance).
// Converts game time to real time: 1 game minute = 0.2 s at 1x, hands-on cleans take the bot's
// seconds plus hub overhead, and bots use 2x or 4x when idle like a player would.
// Prints the milestone table against the DESIGN 10.8 pacing targets, manager-layer stats (demand fill,
// waitlist, walkouts, events, campaigns, perks), plus degenerate-strategy checks.
//
//   npm run balance              all bots, 5 seeds each
//   npm run balance -- --seeds 9 --bot median --verbose
//   npm run balance -- --no-checks
//   npm run balance -- --raises ignore   every bot ignores raise requests (approve, ignore or auto)
import * as sim from '../src/sim/index';
import type { CampaignId, CaseType, CleanResult, CleanSetup, Clinic, FocusId, GameState, OfficeTierId, PendingEvent, SimEvent, Staff } from '../src/core/types';
import { makeStaff } from '../src/sim/staff';
import { withRng } from '../src/sim/internal';
import { makeRng } from '../src/core/rng';
import { REAL_SEC_PER_GAME_MIN } from '../src/core/constants';
import { OFFICES, TIER_ORDER } from '../src/data/offices';
import { TOOLS, EXTRAS } from '../src/data/tools';
import { EQUIPMENT, EQUIP_ORDER, CHAIRS, OP_UPGRADES } from '../src/data/upgrades';
import { SKILLS } from '../src/data/skills';
import { CAMPAIGNS, EVENTS, type EventEffect } from '../src/data/manager';

// ------------------------------------------------------------------ bot definitions

interface Bot {
  name: string;
  quality: number;          // hands-on quality mean
  secs: number;             // real seconds per hands-on clean
  overhead: number;         // real seconds of hub time per clean (result screen, clicking Clean)
  handsPerDay: number;      // owner phase: hands-on cleans per day before switching the chair to autopilot
  idleOwner: boolean;       // owner phase: chair on autopilot, 4x clock, minimal management, auto-huddle
  greedy: boolean;          // loans to the max, moves and expands as early as possible
  priceMult: number;        // cleaning price multiplier the bot sets
  events: 'first' | 'smart';   // event policy: always the first choice, or a simple expected-value score
  manage: boolean;          // uses focus, campaigns, interviews and picks perks
  raises: 'approve' | 'ignore' | 'auto';   // raise requests: approve each at once, ignore, or settings.autoRaise
  maxHours: number;
}

const BOTS: Bot[] = [
  { name: 'casual (q 0.70)', quality: 0.7, secs: 80, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, events: 'first', manage: true, raises: 'approve', maxHours: 14 },
  { name: 'median (q 0.85)', quality: 0.85, secs: 80, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, events: 'smart', manage: true, raises: 'approve', maxHours: 14 },
  { name: 'expert (q 0.95)', quality: 0.95, secs: 80, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, events: 'smart', manage: true, raises: 'approve', maxHours: 14 },
  { name: 'idle owner', quality: 0.85, secs: 80, overhead: 15, handsPerDay: 0, idleOwner: true, greedy: false, priceMult: 1, events: 'first', manage: false, raises: 'auto', maxHours: 14 },
  { name: 'greedy expander', quality: 0.85, secs: 80, overhead: 15, handsPerDay: 2, idleOwner: false, greedy: true, priceMult: 1, events: 'smart', manage: true, raises: 'approve', maxHours: 14 },
  { name: 'median, no manager', quality: 0.85, secs: 80, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, events: 'first', manage: false, raises: 'approve', maxHours: 14 },
];

// ------------------------------------------------------------------ run state

interface Run {
  bot: Bot;
  s: GameState;
  real: number;         // real seconds elapsed
  rng: ReturnType<typeof makeRng>;
  m: Record<string, number>;   // milestone -> real seconds
  mc: Record<string, number>;  // milestone -> hands-on cleaning count
  md: Record<string, number>;  // milestone -> owner days completed
  ownerDays: number;
  handsToday: number;
  log: string[];
  maxLoanSeen: number;
  minCash: number;
  nets: number[];
  treasure: number;
  cases: Partial<Record<CaseType, number>>;
  quicks: number;
  lockedQuick: number;
  // manager layer
  tierDays: Record<string, { demand: number; booked: number; cap: number; lost: number; wait: number; walkouts: number; waitWalk: number; served: number; days: number; firstWeekFill: number[] }>;
  eventCash: { in: number; out: number };
  eventsAnswered: number;
  campaigns: Partial<Record<CampaignId, number>>;
  focus: Partial<Record<FocusId, number>>;
  perks: number;
  interviews: number;
  twoStarWait: number;
  oneStar: number;
  reviews: number;
  raiseRequests: number;
  autoRaises: number;
}

const M = (r: Run, key: string) => {
  if (r.m[key] == null) { r.m[key] = r.real; r.mc[key] = r.s.stats.cleanings; r.md[key] = r.ownerDays; }
};

function result(r: Run, q: number, secs: number, setup: CleanSetup | null): CleanResult {
  const qq = Math.max(0.3, Math.min(0.99, q + r.rng.normal(0, 0.04)));
  const stars = qq >= 0.92 ? 5 : qq >= 0.8 ? 4 : qq >= 0.65 ? 3 : qq >= 0.45 ? 2 : 1;
  const tartar = setup ? setup.dirt.tartarCount + setup.special.barnacles + setup.special.pockets : 6;
  const bonusMet = !!setup?.bonus && r.rng.chance(Math.max(0, (qq - 0.6) * 1.6));
  return {
    quit: 'done', tartar: qq, plaque: qq, stain: qq, debris: qq, polish: qq, mess: 0, clean: qq, comfort: 70 + 25 * qq,
    quality: qq, stars, seconds: secs, chunks: Math.round(tartar * Math.min(1, qq + 0.1)), bestCombo: Math.round(Math.min(tartar, 3 + 6 * qq)),
    gumHits: 1, gags: 0, perfect: qq >= 0.97 && bonusMet,
    caseType: setup?.caseType ?? 'routine', objectives: [], bonusMet,
    treasure: !!setup?.special.treasure && r.rng.chance(Math.min(1, qq + 0.05)),
    shadeGain: setup?.caseType === 'whitening' ? Math.round((setup.special.startShade - setup.special.targetShade) * qq) : 0,
    before: null, after: null,
  };
}

/** A case the bot has not cleaned much yet goes a little worse (learning curve up to Bronze). */
function caseQuality(r: Run, setup: CleanSetup): number {
  const n = r.s.player.mastery[setup.caseType] ?? 0;
  return r.bot.quality - CASE_LEARNING * Math.max(0, 1 - n / 3);
}
const CASE_LEARNING = 0.08;

function levelMilestones(r: Run): void {
  const L = r.s.player.level;
  for (const k of [2, 3, 4, 5]) if (L >= k) M(r, 'level' + k);
}

function handsOn(r: Run, pid: string): void {
  const setup = sim.beginHandsOn(r.s, pid);
  const secs = r.bot.secs * (0.9 + 0.2 * r.rng.next());
  r.real += secs + r.bot.overhead;
  const out = sim.completeHandsOn(r.s, pid, result(r, caseQuality(r, setup), secs, setup));
  r.treasure += out.payout.treasure;
  r.cases[setup.caseType] = (r.cases[setup.caseType] ?? 0) + 1;
  if (r.s.phase === 'employee') {
    if (r.s.cash >= TOOLS.scaler[1].price) M(r, 'firstTool');
    levelMilestones(r);
  }
}

function quick(r: Run, pid: string): void {
  r.real += 3;
  r.quicks++;
  sim.quickClean(r.s, pid);
}

function clockSpeed(r: Run): number {
  if (r.s.phase === 'owner' && r.handsToday >= handsQuota(r)) return 4;
  return 2;
}

function tierStats(r: Run, tier: string) {
  return (r.tierDays[tier] ??= { demand: 0, booked: 0, cap: 0, lost: 0, wait: 0, walkouts: 0, waitWalk: 0, served: 0, days: 0, firstWeekFill: [] });
}

function playDay(r: Run): void {
  const s = r.s;
  r.handsToday = 0;
  // morning numbers per location (after the huddle): capacity, booked, waitlist
  const morning = s.phase === 'owner' ? s.locations.map((c, i) => ({ id: c.id, tier: c.tier, cap: sim.dayOutlook(s, i).capacity, booked: c.day.booked, wait: (c as { waitIn?: number }).waitIn ?? 0 })) : [];
  let guard = 0;
  let waitWalk = 0;
  while (!s.dayOver && guard++ < 20000) {
    const q = sim.playerQueue(s);
    if (q.length) {
      if (s.phase === 'employee' || r.handsToday < handsQuota(r)) { handsOn(r, q[0].id); r.handsToday++; }
      else if (sim.quickCleanStatus(s, q[0].id).ok) quick(r, q[0].id);
      else { r.lockedQuick++; handsOn(r, q[0].id); }   // no Bronze on this case yet: clean it yourself
      continue;
    }
    const before = s.minute;
    const ev = sim.tick(s, 2);
    for (const e of ev) {
      if (e.type === 'walkout' && e.reason === 'wait') waitWalk++;
      if (e.type === 'review') { r.reviews++; if (e.stars === 1) r.oneStar++; if (e.stars === 2 && e.text.startsWith('Waited')) r.twoStarWait++; }
    }
    r.real += (s.minute - before) * REAL_SEC_PER_GAME_MIN / clockSpeed(r);
  }
  if (s.phase === 'owner') {
    r.ownerDays++;
    for (const m of morning) {
      const c = s.locations.find((l) => l.id === m.id);
      if (!c) continue;
      const t = tierStats(r, m.tier);
      t.days++; t.demand += c.day.demand; t.booked += m.booked; t.cap += m.cap; t.lost += c.day.turnedAway; t.wait += m.wait;
      t.walkouts += c.day.walkouts; t.served += c.day.served;
      const key = `open:${c.id}:${c.tier}`;
      if (r.md[key] == null) r.md[key] = r.ownerDays;
      if (r.ownerDays - r.md[key] < 5 && m.cap > 0) t.firstWeekFill.push(Math.min(1.5, (c.day.demand) / m.cap));
    }
    const last = tierStats(r, s.locations[0].tier);
    last.waitWalk += waitWalk;
  }
  r.real += s.phase === 'owner' ? 10 : 6;   // day report and a glance at the hub
  const rep = sim.closeDay(s);
  // raise requests arrive with the report (DESIGN 8.5); auto raises are settled inside closeDay
  for (const e of rep.events ?? []) {
    if (e.type !== 'raiseRequest') continue;
    r.raiseRequests++;
    const li = s.locations.findIndex((l) => l.id === e.clinicId);
    const st = s.locations[li]?.staff.find((x) => x.id === e.staffId);
    if (st && r.bot.raises !== 'ignore') { sim.setSalary(s, li, st.id, st.ask); r.real += 3; }
  }
  r.autoRaises += rep.notes.filter((n) => n.startsWith('Auto raise')).length;
  for (const e of rep.income) if (e.label === 'Events') r.eventCash.in += e.amount;
  for (const e of rep.expenses) if (e.label === 'Events') r.eventCash.out += e.amount;
  if (s.cash < r.minCash) r.minCash = s.cash;
  if (process.argv.includes('--verbose')) {
    const c = s.locations[0];
    r.log.push(`d${rep.day} ${s.phase} ${(r.real / 60).toFixed(1)}m cash ${s.cash} loan ${s.loan} net ${rep.net} op ${rep.operatingNet} lvl ${s.player.level} ` +
      (c ? `${c.tier} ops ${c.ops.length} staff ${c.staff.map((x) => x.role[0]).join('')} served ${rep.perLocation.map((l) => l.stats.served + '/' + l.stats.booked + ' d' + l.stats.demand + ' wo' + l.stats.walkouts + ' ta' + l.stats.turnedAway + ' wl' + ((l as { waitlist?: number }).waitlist ?? 0)).join(',')} rating ${c.rating} mk ${c.marketing} locs ${s.locations.length} focus ${s.focus.join('+')} camp ${c.campaign?.id ?? '-'}` : ''));
  }
}

// ------------------------------------------------------------------ bot decisions

function buy(r: Run, res: { ok: boolean }): boolean {
  if (res.ok) r.real += 3;
  return res.ok;
}

function dailyCosts(s: GameState): number {
  let c = 0;
  for (const l of s.locations) {
    c += OFFICES[l.tier].rent + l.staff.reduce((t, x) => t + x.salary, 0) + 120;
  }
  return c + s.loan * 0.0125;
}

/** The bot's estimate of a candidate: exact once interviewed, the range midpoint before. */
function est(x: GameState['candidates'][number], k: 'skill' | 'speed' | 'bedside'): number {
  return x.interviewed ? x[k] : (x.range[k][0] + x.range[k][1]) / 2;
}
function score(x: GameState['candidates'][number], role: Staff['role']) {
  return role === 'hygienist' ? (est(x, 'skill') * 2 + est(x, 'speed') + est(x, 'bedside')) / 4 : est(x, 'skill');
}

function bestCandidate(r: Run, role: Staff['role']) {
  const s = r.s;
  let list = s.candidates.filter((c) => c.role === role);
  if (r.bot.manage && list.length > 1) {
    // interview the two most promising before hiring (free with Talent Scout)
    list.sort((a, b) => score(b, role) / b.ask - score(a, role) / a.ask);
    for (const c of list.slice(0, 2)) if (!c.interviewed && s.cash > sim.interviewCost(s) + c.ask && sim.interview(s, c.id).ok) { r.interviews++; r.real += 2; }
    list = s.candidates.filter((c) => c.role === role);
  }
  list.sort((a, b) => score(b, role) / b.ask - score(a, role) / a.ask);
  return list[0];
}

function employeeShopping(r: Run): void {
  const s = r.s;
  const st = sim.practiceStatus(s);
  if (st.ok) {
    sim.openPractice(s, { name: 'Bot Dental', loan: st.maxLoan });
    M(r, 'practice');
    return;
  }
  learnSkills(r);
  // cheap tools while saving: first scaler upgrade, floss picks
  const cheap: [keyof typeof TOOLS, number][] = [['floss', 2], ['scaler', 2]];
  for (const [slot, tier] of cheap) {
    const t = TOOLS[slot][tier - 1];
    if (s.player.tools[slot] < tier && s.cash >= t.price) buy(r, sim.buyTool(s, slot, tier));
  }
}

function learnSkills(r: Run): void {
  const s = r.s;
  const order = r.bot.manage
    ? ['power', 'steady1', 'paperworkPro', 'calmingVoice', 'marketer', 'talentScout', 'huddlePro', 'negotiator', 'bulkBuyer', 'hrGuru', 'polishPro', 'smallTalk', 'crisisManager', 'leanOps', 'brandBuilder', 'leader', 'mentorProgram', 'investorRelations', 'tipMagnet', 'delegator', 'moraleOfficer', 'franchiseSavvy', 'eagleEye', 'steady2', 'upseller', 'nightShift', 'speedCleaner', 'kidWhisperer', 'gagGuru'] as const
    : ['power', 'steady1', 'calmingVoice', 'marketer', 'negotiator', 'polishPro', 'smallTalk', 'tipMagnet', 'leanOps', 'leader', 'eagleEye', 'steady2', 'upseller', 'speedCleaner', 'kidWhisperer', 'gagGuru', 'paperworkPro', 'bulkBuyer'] as const;
  for (const id of order) {
    if (s.player.skillPoints < 1) break;
    if (sim.skillStatus(s, id) === 'available') sim.learnSkill(s, id);
  }
  void SKILLS;
}

/** Cash the bot wants on hand before its next big purchase (move up or new location). */
function savingsGoal(r: Run): number {
  const s = r.s;
  const share = r.bot.greedy ? 1 : 0.8;
  const c0 = s.locations[0];
  const ti = TIER_ORDER.indexOf(c0.tier);
  if (ti < 3 && !(ti >= 2 && s.locations.length < 2 && !r.bot.greedy)) {
    const q = sim.moveQuote(s, 0, TIER_ORDER[ti + 1]);
    return q.net - Math.round(q.maxLoan * share);
  }
  const q = sim.locationQuote(s, 't2');
  return q.price - Math.round(q.maxLoan * share);
}

function handsQuota(r: Run): number {
  if (r.bot.idleOwner) return 0;
  const ti = TIER_ORDER.indexOf(r.s.locations[0]?.tier ?? 't1');
  return Math.max(1, r.bot.handsPerDay - ti);
}

function hireBest(r: Run, li: number, role: Staff['role'], reserve: number): boolean {
  const s = r.s;
  const cand = bestCandidate(r, role);
  if (!cand || s.cash < cand.ask + reserve) return false;
  if (!buy(r, sim.hire(s, cand.id, li))) return false;
  M(r, 'firstHire');
  return true;
}

// ---------------------------------------------------------------- the morning huddle

/** Rough daily revenue of a location, for weighing event choices. */
function dayRevenue(s: GameState, li: number): number {
  const f = sim.forecast(s, li);
  return Math.max(300, f.revenue);
}

/** Simple expected-value score of an event choice (the 'smart' policy). */
function effectValue(s: GameState, li: number, ef: EventEffect, spare: boolean): number {
  const c = s.locations[li];
  const scale = OFFICES[c.tier].tierScale;
  const rev = dayRevenue(s, li);
  const days = (d: number | null) => (d == null ? 40 : d);
  switch (ef.kind) {
    case 'cash': return ef.amount * (ef.scaled ? scale : 1);
    case 'rating': return ef.delta * 8 * rev;
    case 'awareness': return ef.delta * 20 * rev;
    case 'modifier': {
      let v = 0;
      const n = days(ef.days);
      if (ef.demand) v += (ef.demand - 1) * n * rev * (spare ? 0.8 : 0.15);
      if (ef.fees) v += (ef.fees - 1) * n * rev;
      if (ef.supplies) v += (1 - ef.supplies) * n * 150 * scale;
      if (ef.comfort) v += (ef.comfort - 1) * n * rev * 0.5;
      if (ef.noShows) v -= (ef.noShows - 1) * n * rev * 0.08;
      if (ef.walkins) v += (ef.walkins - 1) * n * rev * (spare ? 0.1 : 0.02);
      return v;
    }
    case 'morale': return ef.delta * (ef.who === 'all' ? c.staff.length : 1) * 25;
    case 'skill': return ef.delta * 40;
    case 'salary': return -ef.pct / 100 * 300 * 30 + 1500;   // keeps a good hygienist
    case 'quitChance': return -ef.p * 4000;
    case 'vip': return ef.fee;
    case 'closeOp': return -ef.days * rev / Math.max(1, c.ops.length);
    case 'openLate': return -ef.minutes / 480 * rev;
    case 'tempStaff': return ef.days * 120;
    case 'discountEquip': return 0;
    case 'freeEquip': return 2000;
    case 'xp': return ef.amount * 2;
    case 'chance': {
      const p = Math.min(1, ef.p + (s.player.skills.includes('crisisManager') ? 0.2 : 0));
      const sum = (xs: EventEffect[]) => xs.reduce((t, x) => t + effectValue(s, li, x, spare), 0);
      return p * sum(ef.win) + (1 - p) * sum(ef.lose);
    }
  }
  return 0;
}

function pickChoice(r: Run, pe: PendingEvent): number {
  if (r.bot.events === 'first') return 0;
  const s = r.s;
  const e = EVENTS.find((x) => x.id === pe.eventId);
  const li = s.locations.findIndex((c) => c.id === pe.clinicId);
  if (!e || li < 0) return 0;
  const o = sim.dayOutlook(s, li);
  const spare = o.booked < o.capacity * 0.9;
  let best = 0;
  let bestV = -Infinity;
  e.choices.forEach((ch, i) => {
    const v = ch.effects.reduce((t, x) => t + effectValue(s, li, x, spare), 0);
    if (v > bestV + 1) { bestV = v; best = i; }
  });
  return best;
}

function chooseFocus(r: Run): FocusId[] {
  const s = r.s;
  const opts = sim.focusOptions(s);
  const ok = (id: FocusId) => opts.options.some((o) => o.id === id && o.ok);
  const outlooks = s.locations.map((_, i) => sim.dayOutlook(s, i));
  const cap = outlooks.reduce((t, o) => t + o.capacity, 0);
  const spare = outlooks.reduce((t, o) => t + o.booked, 0) < cap * 0.8;
  const morale = s.locations.flatMap((c) => c.staff).reduce((t, x, _, a) => t + x.morale / a.length, 0);
  const picks: FocusId[] = [];
  if (morale && morale < 45 && ok('team')) picks.push('team');
  if (spare && ok('walkin')) picks.push('walkin');
  if (!spare && ok('upsell')) picks.push('upsell');
  if (!spare && ok('speed')) picks.push('speed');
  picks.push('quality');
  return [...new Set(picks)].slice(0, opts.slots);
}

function campaigns(r: Run): void {
  const s = r.s;
  for (let li = 0; li < s.locations.length; li++) {
    const c = s.locations[li];
    if (c.campaign) continue;
    const o = sim.dayOutlook(s, li);
    const spare = o.booked + o.waitlist < o.capacity * 0.9;
    const reserve = dailyCosts(s) * 2;
    const order: CampaignId[] = spare
      ? ['grandOpening', 'smileMakeover', 'goldenYears', 'kidsWeek', 'bracesBonanza', 'pirateDay']
      : ['smileMakeover', 'goldenYears'];
    for (const id of order) {
      const st = sim.campaignStatus(s, li, id);
      if (!st.ok || s.cash < st.cost + reserve) continue;
      if (buy(r, sim.startCampaign(s, li, id))) { r.campaigns[id] = (r.campaigns[id] ?? 0) + 1; break; }
    }
  }
}

function huddle(r: Run): void {
  const s = r.s;
  if (s.phase !== 'owner') return;
  for (const c of s.locations) for (const x of c.staff) if (x.pendingPerks?.length && r.bot.manage) {
    const li = s.locations.indexOf(c);
    if (sim.pickPerk(s, li, x.id, x.pendingPerks[0]).ok) r.perks++;
  }
  if (!sim.huddlePending(s)) return;
  if (r.bot.manage) {
    const f = chooseFocus(r);
    sim.setFocus(s, f);
    for (const id of s.focus) r.focus[id] = (r.focus[id] ?? 0) + 1;
    campaigns(r);
  }
  while (s.pendingEvents.length) {
    const choice = pickChoice(r, s.pendingEvents[0]);
    sim.resolveEvent(s, 0, choice);
    r.eventsAnswered++;
  }
  sim.completeHuddle(s);
  r.real += r.bot.manage ? 12 : 4;
}

function ownerShopping(r: Run): void {
  const s = r.s;
  learnSkills(r);
  if (r.bot.idleOwner) s.settings.autoHuddle = true;
  s.settings.autoRaise = r.bot.raises === 'auto';
  const costs = dailyCosts(s);
  const reserve = costs * (r.bot.greedy ? 0.5 : 1);
  const goal = Math.max(0, savingsGoal(r));
  const spare = () => s.cash - goal - reserve * 2;   // money beyond the savings goal
  for (let li = 0; li < s.locations.length; li++) {
    const c = s.locations[li];
    if (c.prices.cleaning !== r.bot.priceMult) sim.setPrice(s, li, 'cleaning', r.bot.priceMult);
    const mine = c.ops.find((o) => o.staffId === 'player');
    if (mine) sim.setPlayerMode(s, li, mine.id, r.bot.idleOwner ? 'auto' : 'hands');
    if (!c.staff.some((x) => x.role === 'receptionist')) hireBest(r, li, 'receptionist', reserve * 0.3);
    while (c.ops.some((o) => o.staffId == null) && hireBest(r, li, 'hygienist', reserve * 0.3)) { /* staff every op */ }
    const f = sim.forecast(s, li);
    const last = s.reports[s.reports.length - 1];
    const turned = last?.perLocation.find((l) => l.clinicId === c.id)?.stats.turnedAway ?? 0;
    if (c.ops.length < OFFICES[c.tier].opSlots && (turned >= 1 || f.demand > f.capacity * 0.9) && s.cash >= 4000 + reserve) {
      buy(r, sim.buyOperatory(s, li));
      while (c.ops.some((o) => o.staffId == null) && hireBest(r, li, 'hygienist', reserve * 0.3)) { /* staff it */ }
    }
    if (f.demand < f.capacity * 0.8 && c.marketing < 3 && c.served > 30) sim.setMarketing(s, li, (c.marketing + 1) as 1 | 2 | 3);
    else if (f.demand > f.capacity * 1.2 && c.marketing > 0) sim.setMarketing(s, li, (c.marketing - 1) as 0 | 1 | 2);
    if (!c.equipment.includes('deepCert') && s.cash >= sim.equipmentPrice(s, li, 'deepCert') + reserve * 2) buy(r, sim.buyEquipment(s, li, 'deepCert'));
    if (c.tier !== 't1' && !c.staff.some((x) => x.role === 'dentist') && s.cash >= 1500 + reserve * 2) hireBest(r, li, 'dentist', reserve);
    if (li > 0 && !c.staff.some((x) => x.role === 'manager')) hireBest(r, li, 'manager', reserve);
    // a salesman's discount on something the bot would buy anyway
    for (const d of (s as { discounts?: { clinicId: string; equipId: keyof typeof EQUIPMENT }[] }).discounts ?? []) {
      if (d.clinicId === c.id && spare() + EQUIPMENT[d.equipId].price * 0.3 >= sim.equipmentPrice(s, li, d.equipId)) buy(r, sim.buyEquipment(s, li, d.equipId));
    }
  }
  // grow: move the first location up, or open another (median waits for a Medical Plaza first)
  const c0 = s.locations[0];
  const ti = TIER_ORDER.indexOf(c0.tier);
  const share = r.bot.greedy ? 1 : 0.8;
  const cushion = reserve * (r.bot.greedy ? 1 : 3);
  const wantLocation = s.locations.length < 5 && (r.bot.greedy ? ti >= 1 : ti >= 2);
  if (ti < 3 && !(wantLocation && s.locations.length < 2 && !r.bot.greedy)) {
    const next = TIER_ORDER[ti + 1] as OfficeTierId;
    const q = sim.moveQuote(s, 0, next);
    const loan = Math.min(q.maxLoan, Math.round(q.maxLoan * share));
    if (q.ok && s.cash + loan - q.net >= cushion && buy(r, sim.moveOffice(s, 0, next, loan))) M(r, next);
  }
  if (wantLocation) {
    const q = sim.locationQuote(s, 't2');
    const loan = Math.round(q.maxLoan * share);
    if (q.ok && s.cash + loan - q.price >= cushion + 4000 && buy(r, sim.openLocation(s, 't2', `Bot ${s.locations.length + 1}`, loan))) {
      M(r, 'loc' + s.locations.length);
      const li = s.locations.length - 1;
      buy(r, sim.buyOperatory(s, li));
    }
  }
  // luxuries only with money beyond the savings goal
  for (let li = 0; li < s.locations.length; li++) {
    const c = s.locations[li];
    if (!r.bot.idleOwner) {
      for (const id of EQUIP_ORDER) {
        const e = EQUIPMENT[id];
        if (c.equipment.includes(id) || TIER_ORDER.indexOf(c.tier) < TIER_ORDER.indexOf(e.minTier)) continue;
        if (spare() >= sim.equipmentPrice(s, li, id)) { buy(r, sim.buyEquipment(s, li, id)); break; }
      }
      for (const op of c.ops) if (op.chair === 'basic' && spare() >= sim.chairPrice(s, 'comfort')) buy(r, sim.upgradeChair(s, li, op.id, 'comfort'));
      if (r.bot.manage) for (const op of c.ops) {
        if (!op.upgrades.includes('ergoStool') && spare() >= sim.opUpgradePrice(s, 'ergoStool')) buy(r, sim.buyOpUpgrade(s, li, op.id, 'ergoStool'));
      }
      if (r.bot.manage && !c.ops.some((o) => o.upgrades.includes('whiteningLamp')) && c.tier !== 't1' && spare() >= OP_UPGRADES.whiteningLamp.price) {
        const op = c.ops.find((o) => o.staffId && o.staffId !== 'player');
        if (op) buy(r, sim.buyOpUpgrade(s, li, op.id, 'whiteningLamp'));
      }
    }
  }
  if (!r.bot.idleOwner) for (const slot of ['scaler', 'polisher', 'floss', 'suction'] as const) {
    const next = TOOLS[slot][s.player.tools[slot]];
    if (next && spare() >= next.price) buy(r, sim.buyTool(s, slot, next.tier));
  }
  if (!r.bot.greedy && s.loan > 0 && spare() > s.loan) sim.repayLoan(s, s.loan);
  void EXTRAS; void CHAIRS; void CAMPAIGNS;
}

// ------------------------------------------------------------------ one game

function newRun(bot: Bot, seed: number): Run {
  const s = sim.newGame({ name: 'Bot', avatar: 0, seed, nowMs: 0 });
  return {
    bot, s, real: 0, rng: makeRng(seed ^ 0x5eed), m: {}, mc: {}, md: {}, ownerDays: 0, log: [], handsToday: 0, maxLoanSeen: 0, minCash: 0, nets: [],
    treasure: 0, cases: {}, quicks: 0, lockedQuick: 0,
    tierDays: {}, eventCash: { in: 0, out: 0 }, eventsAnswered: 0, campaigns: {}, focus: {}, perks: 0, interviews: 0, twoStarWait: 0, oneStar: 0, reviews: 0,
    raiseRequests: 0, autoRaises: 0,
  };
}

function playGame(bot: Bot, seed: number, stop?: (r: Run) => boolean): Run {
  const r = newRun(bot, seed);
  const s = r.s;
  for (const step of [1, 2] as const) {
    const setup = sim.schoolSetup(s, step);
    const secs = bot.secs * (step === 1 ? 1.6 : 1.0);   // the tutorial takes longer
    r.real += secs + bot.overhead;
    sim.completeSchool(s, step, result(r, bot.quality, secs, setup));
    levelMilestones(r);
  }
  r.real += 20; // title, name, graduation card
  M(r, 'school');
  M(r, 'firstTool');   // the signing bonus covers Floss Picks right after school
  while (r.real < bot.maxHours * 3600) {
    if (stop && stop(r)) break;
    if (s.phase === 'employee') {
      levelMilestones(r);
      employeeShopping(r);
    } else {
      huddle(r);
      ownerShopping(r);
      if (s.locations.some((c) => c.tier !== 't1')) M(r, 't2');
      if (s.locations.some((c) => c.tier === 't3' || c.tier === 't4')) M(r, 't3');
      if (s.locations.length >= 2) M(r, 'loc2');
      if (sim.title(s) === 'Floss Boss') { M(r, 'flossBoss'); break; }
    }
    r.maxLoanSeen = Math.max(r.maxLoanSeen, s.loan);
    playDay(r);
    if (s.phase === 'employee') levelMilestones(r);
    if (s.phase === 'owner') {
      r.nets.push(s.reports[s.reports.length - 1]?.operatingNet ?? 0);
    }
  }
  return r;
}

// ------------------------------------------------------------------ report

const median = (xs: number[]) => { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

const ROWS: { key: string; label: string; target: string; lo: number; hi: number; unit: 'clean' | 'min' | 'h' | 'days' }[] = [
  { key: 'school', label: 'Tutorial done', target: '< 5 min', lo: 0, hi: 5, unit: 'min' },
  { key: 'firstTool', label: 'First tool affordable (cleaning #)', target: '<= 2', lo: 0, hi: 2, unit: 'clean' },
  { key: 'level2', label: 'Level 2 (cleaning #)', target: '2', lo: 0, hi: 2, unit: 'clean' },
  { key: 'level3', label: 'Level 3 (cleaning #)', target: '4 to 5', lo: 4, hi: 5, unit: 'clean' },
  { key: 'level4', label: 'Level 4 (cleaning #)', target: '9 to 12', lo: 9, hi: 12, unit: 'clean' },
  { key: 'practice', label: 'Practice opened (cleaning #)', target: '15 to 20', lo: 15, hi: 20, unit: 'clean' },
  { key: 'practiceMin', label: 'Practice opened (time)', target: '25 to 35 min', lo: 25, hi: 35, unit: 'min' },
  { key: 'firstHireDays', label: 'First hire (owner days)', target: '<= 2', lo: 0, hi: 2, unit: 'days' },
  { key: 't2', label: 'Office T2', target: '1.25 to 2 h', lo: 1.25, hi: 2, unit: 'h' },
  { key: 't3', label: 'Office T3', target: '2.5 to 3.5 h', lo: 2.5, hi: 3.5, unit: 'h' },
  { key: 'loc2', label: 'Second location', target: '3.5 to 4.5 h', lo: 3.5, hi: 4.5, unit: 'h' },
  { key: 'flossBoss', label: 'Floss Boss title', target: '7 to 10 h', lo: 7, hi: 10, unit: 'h' },
];

function value(r: Run, key: string): number {
  switch (key) {
    case 'firstTool': return r.mc.firstTool ?? NaN;
    case 'level2': case 'level3': case 'level4': return r.mc[key] ?? NaN;
    case 'practice': return r.mc.practice ?? NaN;
    case 'practiceMin': return r.m.practice != null ? r.m.practice / 60 : NaN;
    case 'school': return r.m.school / 60;
    case 'firstHireDays': return r.md.firstHire ?? NaN;
    default: return r.m[key] != null ? r.m[key] / 3600 : NaN;
  }
}

function main() {
  const args = process.argv.slice(2);
  const seedsN = Number(args[args.indexOf('--seeds') + 1]) || 5;
  const only = args.includes('--bot') ? args[args.indexOf('--bot') + 1] : null;
  const verbose = args.includes('--verbose');
  const raisePolicy = args.includes('--raises') ? args[args.indexOf('--raises') + 1] as Bot['raises'] : null;
  const bots = (only ? BOTS.filter((b) => b.name.includes(only)) : BOTS).map((b) => (raisePolicy ? { ...b, raises: raisePolicy } : b));
  const all: Record<string, Run[]> = {};
  for (const bot of bots) {
    const runs: Run[] = [];
    for (let i = 0; i < seedsN; i++) {
      const t0 = Date.now();
      const r = playGame(bot, 1000 + i * 7919);
      runs.push(r);
      if (verbose && i === 0) console.log(r.log.join('\n'));
      const s = r.s;
      const sum = s.ledger.reduce((a, e) => a + e.amount, 0);
      if (sum !== s.cash) console.log(`  !! ledger mismatch ${bot.name} seed ${i}: ${sum} vs ${s.cash}`);
      if (!Number.isFinite(s.cash)) console.log(`  !! cash not finite ${bot.name}`);
      process.stderr.write(`  ${bot.name} seed ${i}: ${((Date.now() - t0) / 1000).toFixed(1)} s cpu, ${(r.real / 3600).toFixed(1)} h game, practice at cleaning ${r.mc.practice}, T2 ${((r.m.t2 ?? NaN) / 3600).toFixed(2)} h\n`);
    }
    all[bot.name] = runs;
  }
  console.log('\nFloss Boss balance: median of ' + seedsN + ' seeds per bot (80 s cleans + 15 s hub, DESIGN 10.8)\n');
  const header = ['Milestone'.padEnd(36), 'Target'.padEnd(14), ...bots.map((b) => b.name.padEnd(20))].join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of ROWS) {
    const cells = bots.map((b) => {
      const v = median(all[b.name].map((r) => value(r, row.key)));
      if (!Number.isFinite(v)) return '-'.padEnd(20);
      const ok = v >= row.lo && v <= row.hi;
      const txt = row.unit === 'h' ? `${v.toFixed(2)} h` : row.unit === 'min' ? `${v.toFixed(1)} min` : `${v.toFixed(0)}`;
      return (txt + (ok ? '  ok' : '  !!')).padEnd(20);
    });
    console.log([row.label.padEnd(36), row.target.padEnd(14), ...cells].join(''));
  }
  console.log('\nOwner days at each milestone (median) and operating net per owner day (median over windows):');
  for (const b of bots) {
    const runs = all[b.name];
    const d = (k: string) => median(runs.map((r) => r.md[k] ?? NaN));
    const win = (a: number, z: number) => median(runs.map((r) => { const xs = r.nets.slice(a, z); return xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN; }));
    console.log(`  ${b.name.padEnd(20)} hire ${d('firstHire')}  T2 ${d('t2')}  T3 ${d('t3')}  loc2 ${d('loc2')}  boss ${d('flossBoss')}  | net d1-5 ${Math.round(win(0, 5))}  d6-15 ${Math.round(win(5, 15))}  d16-30 ${Math.round(win(15, 30))}  d31-60 ${Math.round(win(30, 60))}  d61-120 ${Math.round(win(60, 120))}  d121+ ${Math.round(win(120, 999))}`);
  }
  console.log('\nDemand and capacity per office tier (all locations, median of runs): new demand / morning capacity, first-week fill of a new or moved office, lost for good, waitlisted, walkouts per day');
  for (const b of bots) {
    const runs = all[b.name];
    const parts: string[] = [];
    for (const t of TIER_ORDER) {
      const rows = runs.map((r) => r.tierDays[t]).filter((x) => x && x.days > 0);
      if (!rows.length) continue;
      const fill = median(rows.map((x) => x.demand / Math.max(1, x.cap)));
      const fw = median(rows.map((x) => median(x.firstWeekFill)));
      const lost = median(rows.map((x) => x.lost / Math.max(1, x.demand)));
      const wait = median(rows.map((x) => x.wait / x.days));
      const wo = median(rows.map((x) => x.walkouts / x.days));
      parts.push(`${t}: fill ${(fill * 100).toFixed(0)}% wk1 ${(fw * 100).toFixed(0)}% lost ${(lost * 100).toFixed(0)}% wait ${wait.toFixed(1)} wo ${wo.toFixed(2)}`);
    }
    console.log(`  ${b.name.padEnd(20)} ${parts.join(' | ')}`);
  }
  console.log('\nManager layer (median per run): events answered, event cash in/out, campaigns, focus days, perks, interviews, reviews (1-star, 2-star wait)');
  for (const b of bots) {
    const runs = all[b.name];
    const med = (f: (r: Run) => number) => Math.round(median(runs.map(f)));
    const camp = (id: CampaignId) => med((r) => r.campaigns[id] ?? 0);
    const foc = (id: FocusId) => med((r) => r.focus[id] ?? 0);
    console.log(`  ${b.name.padEnd(20)} events ${med((r) => r.eventsAnswered)}  cash +${med((r) => r.eventCash.in)}/-${med((r) => r.eventCash.out)}  campaigns open ${camp('grandOpening')} kids ${camp('kidsWeek')} smile ${camp('smileMakeover')} golden ${camp('goldenYears')} braces ${camp('bracesBonanza')} pirate ${camp('pirateDay')}  focus q ${foc('quality')} sp ${foc('speed')} wi ${foc('walkin')} up ${foc('upsell')} team ${foc('team')}  perks ${med((r) => r.perks)} interviews ${med((r) => r.interviews)}  reviews ${med((r) => r.reviews)} 1-star ${med((r) => r.oneStar)} 2-star wait ${med((r) => r.twoStarWait)}`);
  }
  console.log('\nRaises (median per run, DESIGN 8.5): requests that reached the owner (per owner day), auto raises');
  for (const b of bots) {
    const runs = all[b.name];
    const med = (f: (r: Run) => number) => median(runs.map(f));
    console.log(`  ${b.name.padEnd(20)} policy ${b.raises}  requests ${med((r) => r.raiseRequests)} (${med((r) => r.raiseRequests / Math.max(1, r.ownerDays)).toFixed(2)}/day)  auto raises ${med((r) => r.autoRaises)}`);
  }
  console.log('\nCases (median per run): hands-on cleans by case, treasure paid, quick cleans, locked quick cleans cleaned by hand, bronze badges');
  for (const b of bots) {
    const runs = all[b.name];
    const c = (ct: CaseType) => median(runs.map((r) => r.cases[ct] ?? 0));
    console.log(`  ${b.name.padEnd(20)} routine ${c('routine')} candy ${c('candy')} whitening ${c('whitening')} braces ${c('braces')} pirate ${c('pirate')} deep ${c('deep')}  treasure $${median(runs.map((r) => r.treasure))}  quick ${median(runs.map((r) => r.quicks))}  locked ${median(runs.map((r) => r.lockedQuick))}  bronze ${median(runs.map((r) => Object.values(r.s.player.mastery).filter((n) => (n ?? 0) >= 3).length))}/6`);
  }
  console.log('\nEnd state after the run (median):');
  for (const b of bots) {
    const runs = all[b.name];
    const val = median(runs.map((r) => sim.valuation(r.s)));
    const cash = median(runs.map((r) => r.s.cash));
    const locs = median(runs.map((r) => r.s.locations.length));
    const hours = median(runs.map((r) => r.real / 3600));
    const lvl = median(runs.map((r) => r.s.player.level));
    const minCash = Math.min(...runs.map((r) => r.minCash));
    const maxLoan = Math.max(...runs.map((r) => r.maxLoanSeen));
    console.log(`  ${b.name.padEnd(20)} ${hours.toFixed(1)} h  level ${lvl}  locations ${locs}  cash ${Math.round(cash)}  valuation ${Math.round(val)}  lowest cash ${Math.round(minCash)}  peak loan ${Math.round(maxLoan)}`);
  }
}

// ------------------------------------------------------------------ degenerate-strategy checks

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Run plain owner days: the player's chair is on autopilot, nothing is bought, events take choice 0
 * unless `answer` picks. Returns cash per day. */
function plainDays(s: GameState, days: number, each?: (s: GameState) => void, answer?: (s: GameState, pe: PendingEvent) => number): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    each?.(s);
    s.locations.forEach((c, li) => { for (const o of c.ops) if (o.staffId === 'player') sim.setPlayerMode(s, li, o.id, 'auto'); });
    while (s.pendingEvents.length) sim.resolveEvent(s, 0, answer ? answer(s, s.pendingEvents[0]) : 0);
    sim.completeHuddle(s);
    let g = 0;
    while (!s.dayOver && g++ < 20000) sim.tick(s, 3);
    sim.closeDay(s);
    out.push(s.cash);
  }
  return out;
}

const grant = (s: GameState, amount: number) => { s.cash += amount; s.ledger.push({ day: s.day, minute: s.minute, amount, label: 'test grant', kind: 'income' }); };

/** Raise requests per day over 30 owner days at a fresh Main Street Office with 6 new staff (4 hygienists,
 * a receptionist and an assistant, or an Office Manager instead of the assistant). The owner either approves
 * every request at once or ignores them (DESIGN 8.5: at most one per staff member per 10 days). */
function raiseFrequency(seed: number, policy: 'approve' | 'ignore' | 'auto' | 'manager'): { perDay: number; autos: number; quits: number } {
  const s = sim.newGame({ name: 'Raise', avatar: 0, seed, nowMs: 0 });
  for (const step of [1, 2] as const) sim.completeSchool(s, step, { quit: 'done', tartar: 0.85, plaque: 0.85, stain: 0.85, debris: 0.85, polish: 0.85, mess: 0, clean: 0.85, comfort: 80, quality: 0.85, stars: 4, seconds: 90, chunks: 6, bestCombo: 4, gumHits: 0, gags: 0, perfect: false, caseType: 'routine', objectives: [], bonusMet: false, treasure: false, shadeGain: 0, before: null, after: null });
  grant(s, 3_000_000);
  s.player.level = 8;
  sim.openPractice(s, { name: 'Raise Dental', loan: 0 });
  sim.closeDay(s);
  sim.completeHuddle(s);
  sim.moveOffice(s, 0, 't2', 0);
  const c = s.locations[0];
  while (c.ops.length < OFFICES[c.tier].opSlots) sim.buyOperatory(s, 0);
  for (const op of c.ops) op.staffId = null;
  c.staff = [];
  const add = (role: Staff['role'], opId?: string) => {
    const st = withRng(s, (rng) => makeStaff(s, rng, role, OFFICES.t2.candidateQuality));
    c.staff.push(st);
    if (opId) c.ops.find((o) => o.id === opId)!.staffId = st.id;
    if (role === 'assistant') c.ops[0].assistantId = st.id;
  };
  for (const op of c.ops) add('hygienist', op.id);
  add('receptionist');
  add(policy === 'manager' ? 'manager' : 'assistant');
  s.settings.autoRaise = policy === 'auto';
  let n = 0;
  let autos = 0;
  let quits = 0;
  const seen = (ev: SimEvent[]) => {
    for (const e of ev) {
      if (e.type === 'staffQuit') quits++;
      if (e.type !== 'raiseRequest') continue;
      n++;
      const st = c.staff.find((x) => x.id === e.staffId);
      if (st && policy !== 'ignore') sim.setSalary(s, 0, st.id, st.ask);
    }
  };
  for (let d = 0; d < 30; d++) {
    for (const x of c.staff) if (x.pendingPerks?.length) sim.pickPerk(s, 0, x.id, x.pendingPerks[0]);
    while (s.pendingEvents.length) sim.resolveEvent(s, 0, 0);
    sim.completeHuddle(s);
    let g = 0;
    while (!s.dayOver && g++ < 20000) seen(sim.tick(s, 3));
    const rep = sim.closeDay(s);
    seen(rep.events ?? []);
    autos += rep.notes.filter((x) => x.startsWith('Auto raise')).length;
  }
  return { perDay: n / 30, autos, quits };
}

function checks(): void {
  console.log('\nDegenerate-strategy checks (A/B from the same forked state, 3 seeds):');
  const median0 = BOTS[1];
  const rows: string[] = [];
  const payback: number[] = [];
  const hireGain: number[] = [];
  const price: Record<string, number[]> = { '1.0': [], '1.2': [], '1.5': [] };
  const priceT1: Record<string, number[]> = { '1.0': [], '1.2': [], '1.5': [] };
  const underpay: { quits: number; gain: number }[] = [];
  const campFull: number[] = [];
  const campSpare: number[] = [];
  const campSmile: number[] = [];
  const insurance: { join: number; stay: number }[] = [];
  const eventAlways: number[] = [];
  const eventNever: number[] = [];
  const med = (xs: number[]) => { const a = xs.filter(Number.isFinite).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
  for (let i = 0; i < 3; i++) {
    const seed = 1000 + i * 7919;
    // 1. hiring payback at T1: a second operatory plus a hygienist vs keep going alone
    const r1 = playGame(median0, seed, (r) => r.ownerDays >= 6);
    const base = clone(r1.s);
    const a = clone(base);
    grant(a, 20000);
    const b = clone(a);
    if (a.locations[0].ops.length < 2) sim.buyOperatory(a, 0);
    const cand = [...a.candidates].filter((c) => c.role === 'hygienist').sort((x, y) => y.skill - x.skill)[0];
    if (cand) sim.hire(a, cand.id, 0);
    const ca = plainDays(a, 20);
    const cb = plainDays(b, 20);
    let pb = NaN;
    for (let d = 0; d < 20; d++) if (ca[d] >= cb[d]) { pb = d + 1; break; }
    payback.push(pb);
    hireGain.push((ca[19] - cb[19]) / 20);
    // 2. prices at T1 and at T2 (after the move)
    for (const m of ['1.0', '1.2', '1.5']) {
      const t = clone(base);
      const c0 = t.cash;
      const cs = plainDays(t, 15, (st) => sim.setPrice(st, 0, 'cleaning', Number(m)));
      priceT1[m].push((cs[14] - c0) / 15);
    }
    const r2 = playGame(median0, seed, (r) => r.s.phase === 'owner' && r.s.locations[0].tier === 't2' && r.ownerDays >= (r.md.t2 ?? 1e9) + 8);
    for (const m of ['1.0', '1.2', '1.5']) {
      const t = clone(r2.s);
      const c0 = t.cash;
      const cs = plainDays(t, 20, (st) => sim.setPrice(st, 0, 'cleaning', Number(m)));
      price[m].push((cs[19] - c0) / 20);
    }
    // 3. underpaying every employee (the lowest salary allowed) for 30 days at T2
    const full = clone(r2.s);
    const half = clone(r2.s);
    for (const st of half.locations[0].staff) sim.setSalary(half, 0, st.id, 0);
    const staff0 = half.locations[0].staff.length;
    const cf = plainDays(full, 30);
    const ch = plainDays(half, 30);
    underpay.push({ quits: staff0 - half.locations[0].staff.length, gain: (ch[29] - cf[29]) / 30 });
    // 4. campaigns: Kids Week at a full office vs at an office with spare capacity, Smile Makeover with a lamp
    const campaignAB = (st0: GameState, id: CampaignId, days = 10): number => {
      const x = clone(st0);
      const y = clone(st0);
      grant(x, 50000); grant(y, 50000);
      for (const s of [x, y]) {
        sim.completeHuddle(s);
        for (const c of s.locations) { c.campaign = null; c.campaignCooldownUntil = 0; c.modifiers = c.modifiers.filter((m) => m.source !== 'campaign'); }
      }
      const res = sim.startCampaign(x, 0, id);
      if (!res.ok) return NaN;
      const cx = plainDays(x, days);
      const cy = plainDays(y, days);
      return (cx[days - 1] - cy[days - 1]) / days;
    };
    const t2 = clone(r2.s);
    campFull.push(campaignAB(t2, 'kidsWeek'));
    const spareState = clone(r2.s);
    // spare capacity: a fresh extra operatory staffed by the best hygienist on the board
    grant(spareState, 20000);
    if (spareState.locations[0].ops.length < OFFICES[spareState.locations[0].tier].opSlots) sim.buyOperatory(spareState, 0);
    const h = [...spareState.candidates].filter((c) => c.role === 'hygienist').sort((x, y) => y.skill - x.skill)[0];
    if (h) sim.hire(spareState, h.id, 0);
    spareState.locations[0].marketing = 0;
    campSpare.push(campaignAB(spareState, 'kidsWeek'));
    const lamp = clone(r2.s);
    grant(lamp, 20000);
    const lop = lamp.locations[0].ops.find((o) => o.staffId && o.staffId !== 'player');
    if (lop && !lop.upgrades.includes('whiteningLamp')) sim.buyOpUpgrade(lamp, 0, lop.id, 'whiteningLamp');
    campSmile.push(campaignAB(lamp, 'smileMakeover'));
    // 5. the insurance event: join (demand +25%, fees -10% for good) vs stay independent, 30 days at T2
    const ins = clone(r2.s);
    sim.completeHuddle(ins);
    ins.pendingEvents = [{ eventId: 'insurance', clinicId: ins.locations[0].id, day: ins.day, vars: { clinic: ins.locations[0].name } }];
    const join = clone(ins);
    const stay = clone(ins);
    sim.resolveEvent(join, 0, 0);
    sim.resolveEvent(stay, 0, 1);
    const j0 = join.cash;
    const s0 = stay.cash;
    const cj = plainDays(join, 30);
    const cs2 = plainDays(stay, 30);
    insurance.push({ join: (cj[29] - j0) / 30, stay: (cs2[29] - s0) / 30 });
    // 6. event money: always the richest-looking choice vs always the first, 40 days at T2
    const ev1 = clone(r2.s);
    const ev2 = clone(r2.s);
    const c1 = ev1.cash;
    const c2 = ev2.cash;
    const richest = (st: GameState, pe: PendingEvent) => {
      const e = EVENTS.find((x) => x.id === pe.eventId);
      if (!e) return 0;
      let best = 0; let bv = -Infinity;
      e.choices.forEach((ch, k) => { const v = ch.effects.reduce((t, x) => t + (x.kind === 'cash' ? x.amount : x.kind === 'vip' ? x.fee : 0), 0); if (v > bv) { bv = v; best = k; } });
      return best;
    };
    const e1 = plainDays(ev1, 40, undefined, richest);
    const e2 = plainDays(ev2, 40);
    eventAlways.push((e1[39] - c1) / 40);
    eventNever.push((e2[39] - c2) / 40);
  }
  // loan round trip
  const r3 = playGame(median0, 1000, (r) => r.ownerDays >= 3);
  const s = r3.s;
  const before = s.cash;
  const ml = sim.maxLoan(s) - s.loan;
  const took = sim.takeLoan(s, ml);
  const over = sim.takeLoan(s, 1000);
  const back = sim.repayLoan(s, ml);
  rows.push(`  Hiring: 2nd operatory + hygienist at T1 (owner day 6) pays back after ${payback.map((x) => (Number.isFinite(x) ? x : '>20')).join(', ')} days, then +${Math.round(med(hireGain))}/day on average over 20 days`);
  rows.push(`  Price at T1 (owner day 6), net/day: 1.0 ${Math.round(med(priceT1['1.0']))}  1.2 ${Math.round(med(priceT1['1.2']))}  1.5 ${Math.round(med(priceT1['1.5']))}`);
  rows.push(`  Price at T2 (8 days after the move), net/day: 1.0 ${Math.round(med(price['1.0']))}  1.2 ${Math.round(med(price['1.2']))}  1.5 ${Math.round(med(price['1.5']))}`);
  rows.push(`  Underpaying all staff at the 75% floor for 30 days at T2: ${underpay.map((u) => `${u.quits} quit, ${u.gain >= 0 ? '+' : ''}${Math.round(u.gain)}/day`).join(' | ')}`);
  rows.push(`  Campaigns (net/day over 10 days vs none, cost included): Kids Week at a full T2 office ${campFull.map((x) => Math.round(x)).join(', ')} | with a fresh spare operatory ${campSpare.map((x) => Math.round(x)).join(', ')} | Smile Makeover with a lamp ${campSmile.map((x) => Math.round(x)).join(', ')}`);
  rows.push(`  Insurance network at T2, net/day over 30 days: join ${insurance.map((x) => Math.round(x.join)).join(', ')} vs stay independent ${insurance.map((x) => Math.round(x.stay)).join(', ')}`);
  rows.push(`  Event money: richest choice every time ${eventAlways.map((x) => Math.round(x)).join(', ')} vs first choice ${eventNever.map((x) => Math.round(x)).join(', ')} net/day over 40 days`);
  rows.push(`  Loan round trip: take ${ml} ${took.ok ? 'ok' : 'refused'}, over the limit ${over.ok ? 'ALLOWED' : 'refused'}, repay ${back.ok ? 'ok' : 'refused'}, cash change ${s.cash - before}`);
  // raise requests (owner: "make them ask for raises less"; v3 rules asked about 0.8 to 0.9 a day here)
  const rf = (p: 'approve' | 'ignore' | 'auto' | 'manager') => [11, 23, 37, 41, 53].map((sd) => raiseFrequency(sd, p));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const fmt = (p: 'approve' | 'ignore' | 'auto' | 'manager') => {
    const r = rf(p);
    const per = r.map((x) => x.perDay);
    return `${mean(per).toFixed(2)}/day (max ${Math.max(...per).toFixed(2)}${p === 'auto' || p === 'manager' ? `, ${mean(r.map((x) => x.autos)).toFixed(1)} auto raises` : ''}, ${r.reduce((a, x) => a + x.quits, 0)} quits)`;
  };
  rows.push(`  Raise requests at a new T2 office, 6 new staff, 30 days, 5 seeds: owner approves each ${fmt('approve')} | ignores them ${fmt('ignore')} | autoRaise ${fmt('auto')} | Office Manager ${fmt('manager')}`);
  console.log(rows.join('\n'));
}

main();
if (!process.argv.includes('--no-checks')) checks();

export type { Clinic };
