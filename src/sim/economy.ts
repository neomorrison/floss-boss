// Shop, skills, the practice, offices, loans, prices and the day close. DESIGN 4.3, 4.4, 7, 8.6 to 8.8.
import type {
  ActionResult, ChairTier, Clinic, DayLine, DayReport, EquipId, ExtraId, GameState, OfficeTierId, OpUpgradeId, PriceKey,
  SimEvent, SkillId, ToolSlot,
} from '../core/types';
import { clamp } from '../core/rng';
import {
  EXTRA_OP_PRICE, LOAN_DAILY_PAYMENT, LOAN_DAILY_RATE, LOAN_MAX_SHARE, MAX_LOCATIONS, OPEN_MIN, PLAYER_ID,
} from '../core/constants';
import { money } from '../core/format';
import { MARKETING_LEVELS, OFFICES, TIER_ORDER } from '../data/offices';
import { PRICE_MAX, PRICE_MIN, PRICE_STEP, defaultPrices } from '../data/services';
import { SKILLS, skillById } from '../data/skills';
import { EXTRAS, NUMBING_GEL_PRICE, TOOLS } from '../data/tools';
import { CHAIRS, CHAIR_ORDER, EQUIPMENT, OP_UPGRADES } from '../data/upgrades';
import {
  REPORTS_MAX, S, SimReport, addCash, emptyDayStats, hasSkill, nextId, withRng,
} from './internal';
import { tierIndex, title } from './progress';
import { bookClinic, bookDay } from './booking';
import { checkAchievements, claimGoal, makeGoals } from './goals';
import { makeCandidates, salaryCost, staffDaily } from './staff';

const fail = (reason: string): ActionResult => ({ ok: false, reason });
const NO_CASH = 'Not enough cash';

// ------------------------------------------------------------------ tools, extras, gel, skills

export function buyTool(state: GameState, slot: ToolSlot, tier: number): ActionResult {
  const list = TOOLS[slot];
  if (!list) return fail('Unknown tool');
  const t = list[tier - 1];
  if (!t) return fail('Unknown tool');
  const owned = state.player.tools[slot] ?? 1;
  if (tier <= owned) return fail('Already owned');
  if (tier !== owned + 1) return fail(`Needs ${list[tier - 2].name} first`);
  if (state.cash < t.price) return fail(NO_CASH);
  addCash(state, -t.price, 'Tools');
  state.player.tools[slot] = tier;
  checkAchievements(state, null);
  return { ok: true, message: `${t.name} added to your kit` };
}

export function buyExtra(state: GameState, id: ExtraId): ActionResult {
  const e = EXTRAS.find((x) => x.id === id);
  if (!e) return fail('Unknown item');
  if (state.player.extras.includes(id)) return fail('Already owned');
  if (state.cash < e.price) return fail(NO_CASH);
  addCash(state, -e.price, 'Tools');
  state.player.extras.push(id);
  return { ok: true, message: `${e.name} added to your kit` };
}

export function buyGel(state: GameState, count: number): ActionResult {
  const n = Math.max(1, Math.min(100, Math.round(count) || 1));
  const price = n * NUMBING_GEL_PRICE;
  if (state.cash < price) return fail(NO_CASH);
  addCash(state, -price, 'Supplies');
  state.player.numbingGel += n;
  return { ok: true, message: `${n} numbing gel${n === 1 ? '' : 's'} added` };
}

export function skillStatus(state: GameState, id: SkillId): 'learned' | 'available' | 'locked' {
  if (state.player.skills.includes(id)) return 'learned';
  const s = SKILLS.find((k) => k.id === id);
  if (!s) return 'locked';
  if (state.player.level < s.minLevel) return 'locked';
  if (s.requires && !state.player.skills.includes(s.requires)) return 'locked';
  return 'available';
}

export function learnSkill(state: GameState, id: SkillId): ActionResult {
  const s = SKILLS.find((k) => k.id === id);
  if (!s) return fail('Unknown skill');
  if (state.player.skills.includes(id)) return fail('Already learned');
  if (state.player.level < s.minLevel) return fail(`Needs level ${s.minLevel}`);
  if (s.requires && !state.player.skills.includes(s.requires)) return fail(`Needs ${skillById(s.requires).name} first`);
  if (state.player.skillPoints < 1) return fail('No skill points');
  state.player.skillPoints -= 1;
  state.player.skills.push(id);
  return { ok: true, message: `${s.name} learned` };
}

// ------------------------------------------------------------------ loans

/** Bank limit on total principal: 60% of the next big purchase (the practice while employed). */
export function maxLoan(state: GameState): number {
  if (state.phase === 'school') return 0;
  if (state.phase === 'employee') return Math.round(LOAN_MAX_SHARE * OFFICES.t1.price);
  let base = 0;
  const c = state.locations[state.active] ?? state.locations[0];
  if (c) {
    const i = tierIndex(c.tier);
    if (i < TIER_ORDER.length - 1) {
      const next = OFFICES[TIER_ORDER[i + 1]];
      base = Math.max(base, next.price - Math.round(OFFICES[c.tier].price * 0.5));
    }
  }
  if (state.locations.some((l) => tierIndex(l.tier) >= 1) && state.locations.length < MAX_LOCATIONS) base = Math.max(base, OFFICES.t2.price + franchiseFee(state));
  return Math.round(LOAN_MAX_SHARE * base);
}

export function takeLoan(state: GameState, amount: number): ActionResult {
  if (state.phase !== 'owner') return fail('The bank lends to practice owners');
  const a = Math.round(amount);
  if (!(a > 0)) return fail('Enter an amount');
  const room = maxLoan(state) - state.loan;
  if (a > room) return fail(room > 0 ? `The bank lends up to ${money(room)} more` : 'Loan limit reached');
  state.loan += a;
  addCash(state, a, 'Bank loan');
  return { ok: true, message: `Borrowed ${money(a)}` };
}

export function repayLoan(state: GameState, amount: number): ActionResult {
  const a = Math.min(Math.round(amount), state.loan);
  if (!(a > 0)) return fail(state.loan > 0 ? 'Enter an amount' : 'No loan to repay');
  if (state.cash < a) return fail(NO_CASH);
  addCash(state, -a, 'Loan repayment');
  state.loan -= a;
  if (state.loan <= 0) { state.loan = 0; state.flags.debtFree = true; checkAchievements(state, null); }
  return { ok: true, message: state.loan ? `Repaid ${money(a)}` : 'Loan paid off' };
}

/** Borrow `loan` (validated by the caller against the purchase limit) and pay `price`. */
function financed(state: GameState, price: number, loan: number, limit: number, label: string): ActionResult | null {
  const l = Math.max(0, Math.round(loan || 0));
  if (l > limit) return fail(`The bank lends up to ${money(limit)} for this`);
  if (state.cash + l < price) return fail(NO_CASH);
  if (l > 0) { state.loan += l; addCash(state, l, 'Bank loan'); }
  addCash(state, -price, label);
  return null;
}

// ------------------------------------------------------------------ practice

export function practiceStatus(state: GameState): { ok: boolean; price: number; maxLoan: number; cashNeeded: number; reasons: string[] } {
  const price = OFFICES.t1.price;
  const ml = Math.round(LOAN_MAX_SHARE * price);
  const cashNeeded = price - ml;
  const reasons: string[] = [];
  if (state.phase === 'school') reasons.push('Finish school first');
  if (state.phase === 'owner') reasons.push('You already own a practice');
  if (state.player.level < 4) reasons.push('Needs level 4');
  if (state.cash < cashNeeded) reasons.push(`Needs ${money(cashNeeded)} cash`);
  return { ok: reasons.length === 0, price, maxLoan: ml, cashNeeded, reasons };
}

function newClinic(state: GameState, tier: OfficeTierId, name: string, playerChair: boolean): Clinic {
  return {
    id: nextId(state, 'c'),
    name: (name || 'My Practice').slice(0, 32),
    tier,
    ownedByPlayer: true,
    ops: [{
      id: nextId(state, 'op'), slot: 0, chair: 'basic', upgrades: [], staffId: playerChair ? PLAYER_ID : null,
      assistantId: null, patientId: null, playerMode: 'hands',
    }],
    equipment: [],
    staff: [],
    prices: defaultPrices(),
    marketing: 0,
    rating: 3.5,
    reviews: [],
    served: 0,
    patients: [],
    day: emptyDayStats(),
    checkinBusyUntil: 0,
  };
}

export function openPractice(state: GameState, opts: { name: string; loan: number }): ActionResult {
  const st = practiceStatus(state);
  if (!st.ok) return fail(st.reasons[0]);
  const err = financed(state, st.price, Math.min(opts.loan, st.maxLoan), st.maxLoan, 'Practice purchase');
  if (err) return err;
  const c = newClinic(state, 't1', opts.name, true);
  state.phase = 'owner';
  state.employer = null;
  state.locations = [c];
  state.active = 0;
  withRng(state, (rng) => {
    if (!state.dayOver) bookClinic(state, c, rng, Math.max(OPEN_MIN, Math.ceil(state.minute) + 5));
    makeCandidates(state, rng);
    makeGoals(state, rng);
  });
  state.player.title = title(state);
  checkAchievements(state, null);
  return { ok: true, message: `${c.name} is open` };
}

// ------------------------------------------------------------------ office

function ownedClinic(state: GameState, i: number): Clinic | null {
  return state.phase === 'owner' ? state.locations[i] ?? null : null;
}

export function buyOperatory(state: GameState, clinicIndex: number): ActionResult {
  const c = ownedClinic(state, clinicIndex);
  if (!c) return fail('Location not found');
  if (c.ops.length >= OFFICES[c.tier].opSlots) return fail('No room for another operatory');
  if (state.cash < EXTRA_OP_PRICE) return fail(NO_CASH);
  addCash(state, -EXTRA_OP_PRICE, 'Operatories');
  c.ops.push({ id: nextId(state, 'op'), slot: c.ops.length, chair: 'basic', upgrades: [], staffId: null, assistantId: null, patientId: null, playerMode: 'hands' });
  return { ok: true, message: `Operatory ${c.ops.length} added` };
}

export function upgradeChair(state: GameState, clinicIndex: number, opId: string, tier: ChairTier): ActionResult {
  const c = ownedClinic(state, clinicIndex);
  const op = c?.ops.find((o) => o.id === opId);
  if (!c || !op) return fail('Operatory not found');
  if (CHAIR_ORDER.indexOf(tier) <= CHAIR_ORDER.indexOf(op.chair)) return fail('Already has this chair or better');
  const price = CHAIRS[tier].price;
  if (state.cash < price) return fail(NO_CASH);
  addCash(state, -price, 'Chairs');
  op.chair = tier;
  return { ok: true, message: `${CHAIRS[tier].name} installed` };
}

export function buyOpUpgrade(state: GameState, clinicIndex: number, opId: string, id: OpUpgradeId): ActionResult {
  const c = ownedClinic(state, clinicIndex);
  const op = c?.ops.find((o) => o.id === opId);
  if (!c || !op) return fail('Operatory not found');
  const u = OP_UPGRADES[id];
  if (!u) return fail('Unknown upgrade');
  if (op.upgrades.includes(id)) return fail('Already installed');
  if (state.cash < u.price) return fail(NO_CASH);
  addCash(state, -u.price, 'Operatory upgrades');
  op.upgrades.push(id);
  return { ok: true, message: `${u.name} installed` };
}

export function buyEquipment(state: GameState, clinicIndex: number, id: EquipId): ActionResult {
  const c = ownedClinic(state, clinicIndex);
  if (!c) return fail('Location not found');
  const e = EQUIPMENT[id];
  if (!e) return fail('Unknown equipment');
  if (c.equipment.includes(id)) return fail('Already installed');
  if (tierIndex(c.tier) < tierIndex(e.minTier)) return fail(`Needs a ${OFFICES[e.minTier].name}`);
  if (state.cash < e.price) return fail(NO_CASH);
  addCash(state, -e.price, 'Equipment');
  c.equipment.push(id);
  return { ok: true, message: `${e.name} installed` };
}

export function moveQuote(state: GameState, clinicIndex: number, tier: OfficeTierId): { price: number; tradeIn: number; net: number; maxLoan: number; ok: boolean; reason?: string } {
  const c = ownedClinic(state, clinicIndex);
  const price = OFFICES[tier]?.price ?? 0;
  if (!c) return { price, tradeIn: 0, net: price, maxLoan: 0, ok: false, reason: 'Location not found' };
  const tradeIn = Math.round(OFFICES[c.tier].price * 0.5);
  const net = price - tradeIn;
  const ml = Math.round(LOAN_MAX_SHARE * net);
  if (tierIndex(tier) <= tierIndex(c.tier)) return { price, tradeIn, net, maxLoan: ml, ok: false, reason: 'Already at this size or bigger' };
  if (state.cash + ml < net) return { price, tradeIn, net, maxLoan: ml, ok: false, reason: `Needs ${money(net - ml)} cash` };
  return { price, tradeIn, net, maxLoan: ml, ok: true };
}

export function moveOffice(state: GameState, clinicIndex: number, tier: OfficeTierId, loan: number): ActionResult {
  const q = moveQuote(state, clinicIndex, tier);
  const c = ownedClinic(state, clinicIndex);
  if (!c || !q.ok) return fail(q.reason ?? 'Cannot move');
  const err = financed(state, q.net, loan, q.maxLoan, 'Office move');
  if (err) return err;
  c.tier = tier;
  state.player.title = title(state);
  withRng(state, (rng) => makeCandidates(state, rng));
  checkAchievements(state, null);
  return { ok: true, message: `Moved into the ${OFFICES[tier].name}` };
}

/** Franchise license for another location: grows 2.25x with every location you already own (DESIGN 8.6). */
export const FRANCHISE_FEE = 78_000;
export const FRANCHISE_GROWTH = 2.25;
export function franchiseFee(state: GameState): number {
  const n = Math.max(1, state.locations.length);
  return Math.round(FRANCHISE_FEE * Math.pow(FRANCHISE_GROWTH, n - 1) / 1000) * 1000;
}

export function locationQuote(state: GameState, tier: OfficeTierId): { price: number; maxLoan: number; ok: boolean; reason?: string } {
  const price = (OFFICES[tier]?.price ?? 0) + franchiseFee(state);
  const ml = Math.round(LOAN_MAX_SHARE * price);
  if (state.phase !== 'owner') return { price, maxLoan: ml, ok: false, reason: 'Open a practice first' };
  if (state.locations.length >= MAX_LOCATIONS) return { price, maxLoan: ml, ok: false, reason: `Up to ${MAX_LOCATIONS} locations` };
  if (!state.locations.some((c) => tierIndex(c.tier) >= 1)) return { price, maxLoan: ml, ok: false, reason: 'Needs a Main Street Office first' };
  if (state.cash + ml < price) return { price, maxLoan: ml, ok: false, reason: `Needs ${money(price - ml)} cash` };
  return { price, maxLoan: ml, ok: true };
}

export function openLocation(state: GameState, tier: OfficeTierId, name: string, loan: number): ActionResult {
  const q = locationQuote(state, tier);
  if (!q.ok) return fail(q.reason ?? 'Cannot open');
  const err = financed(state, q.price, loan, q.maxLoan, 'New location');
  if (err) return err;
  const c = newClinic(state, tier, name || `Location ${state.locations.length + 1}`, false);
  state.locations.push(c);
  withRng(state, (rng) => {
    if (!state.dayOver) bookClinic(state, c, rng, Math.max(OPEN_MIN, Math.ceil(state.minute) + 5));
  });
  state.player.title = title(state);
  checkAchievements(state, null);
  return { ok: true, message: `${c.name} is open` };
}

export function setPrice(state: GameState, clinicIndex: number, key: PriceKey, mult: number): void {
  const c = ownedClinic(state, clinicIndex);
  if (!c || !Number.isFinite(mult)) return;
  const v = Math.round(clamp(mult, PRICE_MIN, PRICE_MAX) / PRICE_STEP) * PRICE_STEP;
  c.prices[key] = Math.round(v * 100) / 100;
}

export function setMarketing(state: GameState, clinicIndex: number, level: 0 | 1 | 2 | 3): void {
  const c = ownedClinic(state, clinicIndex);
  if (!c) return;
  c.marketing = clamp(Math.round(level), 0, 3) as 0 | 1 | 2 | 3;
}

export function setActive(state: GameState, index: number): void {
  if (state.phase === 'employee') { state.active = -1; return; }
  if (state.phase !== 'owner' || !state.locations.length) return;
  state.active = clamp(Math.round(index), 0, state.locations.length - 1);
}

export function marketingCost(c: Clinic): number {
  return Math.round((MARKETING_LEVELS[c.marketing]?.cost ?? 0) * OFFICES[c.tier].tierScale);
}

// ------------------------------------------------------------------ day close

const CAPITAL_LABELS = new Set([
  'Tools', 'Practice purchase', 'Office move', 'New location', 'Operatories', 'Chairs', 'Operatory upgrades', 'Equipment',
  'Bank loan', 'Loan repayment', 'Loan payment', 'Hiring fees', 'Training', 'Severance', 'Signing bonus', 'Earlier activity',
]);

export function closeDay(state: GameState): DayReport {
  const s = S(state);
  const ev: SimEvent[] = [];
  const owner = state.phase === 'owner';
  const notes: string[] = [...(s.dayNotes ?? [])];
  if (owner) {
    const negotiator = hasSkill(state, 'negotiator');
    for (const c of state.locations) {
      const sal = c.staff.reduce((t, st) => t + salaryCost(state, st), 0);
      addCash(state, -sal, 'Salaries');
      addCash(state, -OFFICES[c.tier].rent, 'Rent');
      addCash(state, -Math.round(c.day.supplies * (hasSkill(state, 'leanOps') ? 0.8 : 1)), 'Supplies');
      addCash(state, -marketingCost(c), 'Marketing');
      if (c.day.turnedAway > 0) notes.push(`${c.name}: ${c.day.turnedAway} patients turned away`);
    }
    void negotiator;
    if (state.loan > 0) {
      const interest = Math.max(1, Math.round(state.loan * LOAN_DAILY_RATE));
      const pay = Math.min(state.loan, Math.max(1, Math.round(state.loan * LOAN_DAILY_PAYMENT)));
      addCash(state, -interest, 'Loan interest');
      addCash(state, -pay, 'Loan payment');
      state.loan -= pay;
      if (state.loan <= 0) {
        state.loan = 0;
        state.flags.debtFree = true;
        notes.push('Loan paid off');
      }
    }
    withRng(state, (rng) => staffDaily(state, ev, rng));
  }
  // auto-claim finished goals so no reward is lost
  for (const g of state.goals) if (g.done && !g.claimed) claimGoal(state, g.id, ev);
  // report from today's ledger
  const income: DayLine[] = [];
  const expenses: DayLine[] = [];
  let net = 0;
  let opNet = 0;
  for (const e of state.ledger) {
    if (e.day !== state.day) continue;
    if (e.amount >= 0) income.push({ label: e.label, amount: e.amount });
    else expenses.push({ label: e.label, amount: -e.amount });
    net += e.amount;
    if (!CAPITAL_LABELS.has(e.label)) opNet += e.amount;
  }
  const clinics = state.phase === 'employee' ? (state.employer ? [state.employer] : []) : state.locations;
  const perLocation = clinics.map((c) => ({
    clinicId: c.id, name: c.name, stats: { ...c.day }, rating: c.rating,
    ratingDelta: Math.round((c.rating - ((c as { startRating?: number }).startRating ?? c.rating)) * 100) / 100,
  }));
  for (const m of s.dayNotes ?? []) if (!notes.includes(m)) notes.push(m);
  if (state.cash < 0) notes.push('Cash is below zero. Cut costs or take a loan.');
  const report: SimReport = {
    day: state.day,
    weekday: ((state.day - 1) % 5 + 5) % 5,
    phase: state.phase,
    perLocation,
    income,
    expenses,
    net,
    cashAfter: state.cash,
    xpGained: s.dayXp ?? 0,
    levelUps: s.dayLevelUps ?? 0,
    goalsDone: [...(s.dayGoals ?? [])],
    notes: Array.from(new Set(notes)),
    opNet,
  };
  state.reports.push(report);
  if (state.reports.length > REPORTS_MAX) state.reports.splice(0, state.reports.length - REPORTS_MAX);
  state.stats.daysPlayed += 1;
  checkAchievements(state, ev);
  // next working day (weekends are skipped: day counts working days)
  state.day += 1;
  state.minute = OPEN_MIN;
  state.dayOver = false;
  s.dayXp = 0;
  s.dayLevelUps = 0;
  s.dayGoals = [];
  s.dayNotes = [];
  withRng(state, (rng) => {
    if (owner) makeCandidates(state, rng);
    makeGoals(state, rng);
    bookDay(state, rng);
  });
  state.player.title = title(state);
  return report;
}

export { claimGoal };
