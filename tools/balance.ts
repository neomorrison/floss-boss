// Headless economy simulation with bot strategies (npm run balance).
// Converts game time to real time: 1 game minute = 0.2 s at 1x, hands-on cleans take the bot's
// seconds plus hub overhead, and bots use 2x or 4x when idle like a player would.
// Prints the milestone table against the DESIGN 2 pacing targets, plus degenerate-strategy checks.
//
//   npm run balance              all bots, 5 seeds each
//   npm run balance -- --seeds 9 --bot median --verbose
import * as sim from '../src/sim/index';
import type { CleanResult, Clinic, GameState, OfficeTierId, Staff } from '../src/core/types';
import { makeRng } from '../src/core/rng';
import { REAL_SEC_PER_GAME_MIN } from '../src/core/constants';
import { OFFICES, TIER_ORDER } from '../src/data/offices';
import { TOOLS, EXTRAS } from '../src/data/tools';
import { EQUIPMENT, EQUIP_ORDER, CHAIRS } from '../src/data/upgrades';
import { SKILLS } from '../src/data/skills';

// ------------------------------------------------------------------ bot definitions

interface Bot {
  name: string;
  quality: number;          // hands-on quality mean
  secs: number;             // real seconds per hands-on clean
  overhead: number;         // real seconds of hub time per clean (result screen, clicking Clean)
  handsPerDay: number;      // owner phase: hands-on cleans per day before switching the chair to autopilot
  idleOwner: boolean;       // owner phase: chair on autopilot, 4x clock, minimal management
  greedy: boolean;          // loans to the max, moves and expands as early as possible
  priceMult: number;        // cleaning price multiplier the bot sets
  maxHours: number;
}

const BOTS: Bot[] = [
  { name: 'casual (q 0.70)', quality: 0.7, secs: 100, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, maxHours: 14 },
  { name: 'median (q 0.85)', quality: 0.85, secs: 100, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, maxHours: 14 },
  { name: 'expert (q 0.95)', quality: 0.95, secs: 100, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1, maxHours: 14 },
  { name: 'idle owner', quality: 0.85, secs: 100, overhead: 15, handsPerDay: 0, idleOwner: true, greedy: false, priceMult: 1, maxHours: 14 },
  { name: 'greedy expander', quality: 0.85, secs: 100, overhead: 15, handsPerDay: 2, idleOwner: false, greedy: true, priceMult: 1, maxHours: 14 },
  { name: 'median, price 1.5', quality: 0.85, secs: 100, overhead: 15, handsPerDay: 3, idleOwner: false, greedy: false, priceMult: 1.5, maxHours: 14 },
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
  log: string[];
  maxLoanSeen: number;
  minCash: number;
  nets: number[];
}

const M = (r: Run, key: string) => {
  if (r.m[key] == null) { r.m[key] = r.real; r.mc[key] = r.s.stats.cleanings; r.md[key] = r.ownerDays; }
};

function result(r: Run, q: number, secs: number, tartar: number): CleanResult {
  const qq = Math.max(0.3, Math.min(0.99, q + r.rng.normal(0, 0.04)));
  const stars = qq >= 0.92 ? 5 : qq >= 0.8 ? 4 : qq >= 0.65 ? 3 : qq >= 0.45 ? 2 : 1;
  return {
    quit: 'done', tartar: qq, plaque: qq, stain: qq, debris: qq, polish: qq, mess: 0, clean: qq, comfort: 70 + 25 * qq,
    quality: qq, stars, seconds: secs, chunks: Math.round(tartar * Math.min(1, qq + 0.1)), bestCombo: Math.round(3 + 6 * qq),
    gumHits: 1, gags: 0, perfect: qq >= 0.97,
  };
}

function handsOn(r: Run, pid: string): void {
  const setup = sim.beginHandsOn(r.s, pid);
  const secs = r.bot.secs * (0.9 + 0.2 * r.rng.next());
  r.real += secs + r.bot.overhead;
  sim.completeHandsOn(r.s, pid, result(r, r.bot.quality, secs, setup.dirt.tartarCount));
  if (r.s.phase === 'employee') {
    if (r.s.cash >= 300) M(r, 'firstTool');
    if (r.s.player.level >= 4) M(r, 'level4');
  }
}

function quick(r: Run, pid: string): void {
  r.real += 3;
  sim.quickClean(r.s, pid);
}

function clockSpeed(r: RunExt): number {
  if (r.s.phase === 'owner' && r.handsToday >= handsQuota(r)) return 4;
  return 2;
}

interface RunExt extends Run { handsToday: number }

function playDay(r: RunExt): void {
  const s = r.s;
  r.handsToday = 0;
  let guard = 0;
  while (!s.dayOver && guard++ < 20000) {
    const q = sim.playerQueue(s);
    if (q.length) {
      if (s.phase === 'employee' || r.handsToday < handsQuota(r)) { handsOn(r, q[0].id); r.handsToday++; }
      else quick(r, q[0].id);
      continue;
    }
    const before = s.minute;
    sim.tick(s, 2);
    r.real += (s.minute - before) * REAL_SEC_PER_GAME_MIN / clockSpeed(r);
  }
  if (s.phase === 'owner') r.ownerDays++;
  r.real += s.phase === 'owner' ? 10 : 6;   // day report and a glance at the hub
  const rep = sim.closeDay(s);
  if (s.cash < r.minCash) r.minCash = s.cash;
  if (process.argv.includes('--verbose')) {
    const c = s.locations[0];
    r.log.push(`d${rep.day} ${s.phase} ${(r.real / 60).toFixed(1)}m cash ${s.cash} loan ${s.loan} net ${rep.net} op ${(rep as any).opNet} lvl ${s.player.level} ` +
      (c ? `${c.tier} ops ${c.ops.length} staff ${c.staff.map((x) => x.role[0]).join('')} served ${rep.perLocation.map((l) => l.stats.served + "/" + l.stats.demand + " wo" + l.stats.walkouts + " ta" + l.stats.turnedAway + " ns" + l.stats.noShows).join(",")} rating ${c.rating} mk ${c.marketing} locs ${s.locations.length}` : ''));
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

function bestCandidate(s: GameState, role: Staff['role']) {
  const list = s.candidates.filter((c) => c.role === role);
  list.sort((a, b) => score(b) / b.ask - score(a) / a.ask);
  return list[0];
  function score(x: Staff) { return role === 'hygienist' ? (x.skill * 2 + x.speed + x.bedside) / 4 : x.skill; }
}

function employeeShopping(r: Run): void {
  const s = r.s;
  const st = sim.practiceStatus(s);
  if (st.ok) {
    sim.openPractice(s, { name: 'Bot Dental', loan: st.maxLoan });
    M(r, 'practice');
    return;
  }
  // skills: technique first
  learnSkills(r);
  // cheap tools while saving: first scaler upgrade, floss picks
  const cheap: [keyof typeof TOOLS, number][] = [['scaler', 2], ['floss', 2]];
  for (const [slot, tier] of cheap) {
    const t = TOOLS[slot][tier - 1];
    if (s.player.tools[slot] < tier && s.cash >= t.price) buy(r, sim.buyTool(s, slot, tier));
  }
}

function learnSkills(r: Run): void {
  const s = r.s;
  const order = ['power', 'steady1', 'calmingVoice', 'marketer', 'negotiator', 'polishPro', 'smallTalk', 'tipMagnet', 'leanOps', 'leader', 'eagleEye', 'steady2', 'upseller', 'speedCleaner', 'kidWhisperer', 'gagGuru'] as const;
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

function handsQuota(r: RunExt): number {
  if (r.bot.idleOwner) return 0;
  const ti = TIER_ORDER.indexOf(r.s.locations[0]?.tier ?? 't1');
  return Math.max(1, r.bot.handsPerDay - ti);
}

function hireBest(r: Run, li: number, role: Staff['role'], reserve: number): boolean {
  const s = r.s;
  const cand = bestCandidate(s, role);
  if (!cand || s.cash < cand.ask + reserve) return false;
  if (!buy(r, sim.hire(s, cand.id, li))) return false;
  M(r, 'firstHire');
  return true;
}

function ownerShopping(r: RunExt): void {
  const s = r.s;
  learnSkills(r);
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
    else if (f.demand > f.capacity * 1.25 && c.marketing > 0) sim.setMarketing(s, li, (c.marketing - 1) as 0 | 1 | 2);
    if (!c.equipment.includes('deepCert') && s.cash >= EQUIPMENT.deepCert.price + reserve * 2) buy(r, sim.buyEquipment(s, li, 'deepCert'));
    if (c.tier !== 't1' && !c.staff.some((x) => x.role === 'dentist') && s.cash >= 1500 + reserve * 2) hireBest(r, li, 'dentist', reserve);
    if (li > 0 && !c.staff.some((x) => x.role === 'manager')) hireBest(r, li, 'manager', reserve);
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
        if (spare() >= e.price) { buy(r, sim.buyEquipment(s, li, id)); break; }
      }
      for (const op of c.ops) if (op.chair === 'basic' && spare() >= CHAIRS.comfort.price) buy(r, sim.upgradeChair(s, li, op.id, 'comfort'));
    }
  }
  if (!r.bot.idleOwner) for (const slot of ['scaler', 'polisher', 'floss', 'suction'] as const) {
    const next = TOOLS[slot][s.player.tools[slot]];
    if (next && spare() >= next.price) buy(r, sim.buyTool(s, slot, next.tier));
  }
  if (!r.bot.greedy && s.loan > 0 && spare() > s.loan) sim.repayLoan(s, s.loan);
  void EXTRAS;
}

// ------------------------------------------------------------------ one game

function playGame(bot: Bot, seed: number, stop?: (r: RunExt) => boolean): RunExt {
  const s = sim.newGame({ name: 'Bot', avatar: 0, seed, nowMs: 0 });
  const r: RunExt = { bot, s, real: 0, rng: makeRng(seed ^ 0x5eed), m: {}, mc: {}, md: {}, ownerDays: 0, log: [], handsToday: 0, maxLoanSeen: 0, minCash: 0, nets: [] };
  for (const step of [1, 2] as const) {
    const setup = sim.schoolSetup(s, step);
    const secs = bot.secs * (step === 1 ? 1.4 : 1.0);   // the tutorial takes longer
    r.real += secs + bot.overhead;
    sim.completeSchool(s, step, result(r, bot.quality, secs, setup.dirt.tartarCount));
  }
  r.real += 20; // title, name, graduation card
  M(r, 'school');
  M(r, 'firstTool');   // the signing bonus covers Floss Picks right after school
  while (r.real < bot.maxHours * 3600) {
    if (stop && stop(r)) break;
    if (s.phase === 'employee') {
      if (s.player.level >= 4) M(r, 'level4');
      employeeShopping(r);
    } else {
      ownerShopping(r);
      if (s.locations.some((c) => c.tier !== 't1')) M(r, 't2');
      if (s.locations.some((c) => c.tier === 't3' || c.tier === 't4')) M(r, 't3');
      if (s.locations.length >= 2) M(r, 'loc2');
      if (sim.title(s) === 'Floss Boss') { M(r, 'flossBoss'); break; }
    }
    r.maxLoanSeen = Math.max(r.maxLoanSeen, s.loan);
    playDay(r);
    if (s.phase === 'employee' && s.player.level >= 4) M(r, 'level4');
    if (s.phase === 'owner') {
      const rep = s.reports[s.reports.length - 1] as { opNet?: number };
      r.nets.push(rep?.opNet ?? 0);
    }
  }
  return r;
}

// ------------------------------------------------------------------ report

const fmtT = (sec?: number) => (sec == null ? '   -   ' : sec < 3600 ? `${(sec / 60).toFixed(0).padStart(3)} min` : `${(sec / 3600).toFixed(2).padStart(4)} h `);
const median = (xs: number[]) => { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

const ROWS: { key: string; label: string; target: string; lo: number; hi: number; unit: 'clean' | 'min' | 'h' | 'days' }[] = [
  { key: 'school', label: 'Tutorial done', target: '< 5 min', lo: 0, hi: 5, unit: 'min' },
  { key: 'firstTool', label: 'First tool affordable (cleaning #)', target: '<= 3', lo: 0, hi: 3, unit: 'clean' },
  { key: 'level4', label: 'Level 4 (cleaning #)', target: '12 to 16', lo: 12, hi: 16, unit: 'clean' },
  { key: 'practice', label: 'Practice opened (cleaning #)', target: '20 to 28', lo: 20, hi: 28, unit: 'clean' },
  { key: 'practiceMin', label: 'Practice opened (time)', target: '40 to 50 min', lo: 40, hi: 50, unit: 'min' },
  { key: 'firstHireDays', label: 'First hire (owner days)', target: '<= 2', lo: 0, hi: 2, unit: 'days' },
  { key: 't2', label: 'Office T2', target: '1.5 to 2.5 h', lo: 1.5, hi: 2.5, unit: 'h' },
  { key: 't3', label: 'Office T3', target: '3 to 4 h', lo: 3, hi: 4, unit: 'h' },
  { key: 'loc2', label: 'Second location', target: '4 to 5 h', lo: 4, hi: 5, unit: 'h' },
  { key: 'flossBoss', label: 'Floss Boss title', target: '8 to 12 h', lo: 8, hi: 12, unit: 'h' },
];

function value(r: RunExt, key: string): number {
  switch (key) {
    case 'firstTool': return r.mc.firstTool ?? NaN;
    case 'level4': return r.mc.level4 ?? NaN;
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
  const bots = only ? BOTS.filter((b) => b.name.includes(only)) : BOTS;
  const all: Record<string, RunExt[]> = {};
  for (const bot of bots) {
    const runs: RunExt[] = [];
    for (let i = 0; i < seedsN; i++) {
      const t0 = Date.now();
      const r = playGame(bot, 1000 + i * 7919);
      runs.push(r);
      if (verbose && i === 0) console.log(r.log.join('\n'));
      const s = r.s;
      const sum = s.ledger.reduce((a, e) => a + e.amount, 0);
      if (sum !== s.cash) console.log(`  !! ledger mismatch ${bot.name} seed ${i}: ${sum} vs ${s.cash}`);
      if (!Number.isFinite(s.cash)) console.log(`  !! cash not finite ${bot.name}`);
      process.stderr.write(`  ${bot.name} seed ${i}: ${((Date.now() - t0) / 1000).toFixed(1)} s cpu, ${(r.real / 3600).toFixed(1)} h game\n`);
    }
    all[bot.name] = runs;
  }
  console.log('\nFloss Boss balance: median of ' + seedsN + ' seeds per bot\n');
  const header = ['Milestone'.padEnd(36), 'Target'.padEnd(14), ...bots.map((b) => b.name.padEnd(18))].join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of ROWS) {
    const cells = bots.map((b) => {
      const v = median(all[b.name].map((r) => value(r, row.key)));
      if (!Number.isFinite(v)) return '-'.padEnd(18);
      const ok = v >= row.lo && v <= row.hi;
      const txt = row.unit === 'h' ? `${v.toFixed(2)} h` : row.unit === 'min' ? `${v.toFixed(1)} min` : `${v.toFixed(0)}`;
      return (txt + (ok ? '  ok' : '  !!')).padEnd(18);
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

/** Run plain owner days: the player's chair is quick-cleaned, nothing is bought. Returns cash per day. */
function plainDays(s: GameState, days: number, each?: (s: GameState) => void): number[] {
  const out: number[] = [];
  for (let d = 0; d < days; d++) {
    each?.(s);
    let g = 0;
    while (!s.dayOver && g++ < 20000) {
      const q = sim.playerQueue(s);
      if (q.length) { sim.quickClean(s, q[0].id); continue; }
      sim.tick(s, 3);
    }
    sim.closeDay(s);
    out.push(s.cash);
  }
  return out;
}

function checks(): void {
  console.log('\nDegenerate-strategy checks (A/B from the same forked state, 3 seeds):');
  const median = BOTS[1];
  const rows: string[] = [];
  const payback: number[] = [];
  const hireGain: number[] = [];
  const price: Record<string, number[]> = { '1.0': [], '1.2': [], '1.5': [] };
  const priceT1: Record<string, number[]> = { '1.0': [], '1.2': [], '1.5': [] };
  const underpay: { quits: number; gain: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const seed = 1000 + i * 7919;
    // 1. hiring payback at T1: a second operatory plus a hygienist vs keep going alone
    const r1 = playGame(median, seed, (r) => r.ownerDays >= 6);
    const base = clone(r1.s);
    const a = clone(base);
    const cash0 = a.cash;
    a.cash += 20000; a.ledger.push({ day: a.day, minute: a.minute, amount: 20000, label: 'test grant', kind: 'income' });
    const b = clone(a);
    const opsBefore = a.locations[0].ops.length;
    if (opsBefore < 2) sim.buyOperatory(a, 0);
    const cand = [...a.candidates].filter((c) => c.role === 'hygienist').sort((x, y) => y.skill - x.skill)[0];
    if (cand) sim.hire(a, cand.id, 0);
    const ca = plainDays(a, 20);
    const cb = plainDays(b, 20);
    let pb = NaN;
    for (let d = 0; d < 20; d++) if (ca[d] >= cb[d]) { pb = d + 1; break; }
    payback.push(pb);
    hireGain.push((ca[19] - cb[19]) / 20);
    void cash0;
    // 2. prices at T1 (demand-limited) and at T2 (after the move)
    for (const m of ['1.0', '1.2', '1.5']) {
      const t = clone(base);
      const c0 = t.cash;
      const cs = plainDays(t, 15, (st) => sim.setPrice(st, 0, 'cleaning', Number(m)));
      priceT1[m].push((cs[14] - c0) / 15);
    }
    const r2 = playGame(median, seed, (r) => r.s.phase === 'owner' && r.s.locations[0].tier === 't2' && r.ownerDays >= (r.md.t2 ?? 1e9) + 8);
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
  }
  // 4. loan round trip
  const r3 = playGame(median, 1000, (r) => r.ownerDays >= 3);
  const s = r3.s;
  const before = s.cash;
  const ml = sim.maxLoan(s) - s.loan;
  const took = sim.takeLoan(s, ml);
  const over = sim.takeLoan(s, 1000);
  const back = sim.repayLoan(s, ml);
  const med = (xs: number[]) => { const a = xs.filter(Number.isFinite).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
  rows.push(`  Hiring: 2nd operatory + hygienist at T1 (owner day 6) pays back after ${payback.map((x) => (Number.isFinite(x) ? x : '>20')).join(', ')} days, then +${Math.round(med(hireGain))}/day on average over 20 days`);
  rows.push(`  Price at T1 (owner day 6), net/day: 1.0 ${Math.round(med(priceT1['1.0']))}  1.2 ${Math.round(med(priceT1['1.2']))}  1.5 ${Math.round(med(priceT1['1.5']))}`);
  rows.push(`  Price at T2 (8 days after the move), net/day: 1.0 ${Math.round(med(price['1.0']))}  1.2 ${Math.round(med(price['1.2']))}  1.5 ${Math.round(med(price['1.5']))}`);
  rows.push(`  Underpaying all staff at the 75% floor for 30 days at T2: ${underpay.map((u) => `${u.quits} quit, ${u.gain >= 0 ? '+' : ''}${Math.round(u.gain)}/day`).join(' | ')}`);
  rows.push(`  Loan round trip: take ${ml} ${took.ok ? 'ok' : 'refused'}, over the limit ${over.ok ? 'ALLOWED' : 'refused'}, repay ${back.ok ? 'ok' : 'refused'}, cash change ${s.cash - before}`);
  console.log(rows.join('\n'));
}

main();
if (!process.argv.includes('--no-checks')) checks();

export type { Clinic };
