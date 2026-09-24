// Patient generation, add-on decisions and the hands-on CleanSetup. DESIGN 6 and 7.
import type { AddonId, ArchetypeId, CaseType, Clinic, GameState, ServiceId } from '../core/types';
import type { Rng } from '../core/rng';
import { clamp } from '../core/rng';
import { ARCHETYPES, LAST_NAMES, PATIENT_ARCHETYPES } from '../data/patients';
import { CASES } from '../data/cases';
import { SERVICES } from '../data/services';
import { S, SimPatient, hasSkill, isPresent, nextId, priceOf } from './internal';
import { pickCase, pickTwists } from './cases';

/** Pirates sail in from level 3 (DESIGN 5.5): below it they are rerolled as someone else. */
export function pickArchetype(state: GameState, c: Clinic, rng: Rng): ArchetypeId {
  const kids = c.equipment.includes('kidsCorner') ? 2 : 1;
  const pirates = state.player.level >= CASES.pirate.minLevel ? 1 : 0;
  return rng.weighted(PATIENT_ARCHETYPES, (a) => ARCHETYPES[a].weight[c.tier] * (a === 'kid' ? kids : 1) * (a === 'pirate' ? pirates : 1));
}

/** Service that goes with a case: a deep case is a deep cleaning, everything else a cleaning. */
export function serviceFor(ct: CaseType): ServiceId {
  return ct === 'deep' ? 'deep' : 'cleaning';
}

export function patientName(arch: ArchetypeId, rng: Rng): string {
  const first = rng.pick(ARCHETYPES[arch].firstNames);
  if (first.includes(' ')) return first;
  return `${first} ${rng.pick(LAST_NAMES)}`;
}

export function makePatient(state: GameState, c: Clinic, rng: Rng, o: {
  apptMin: number; arriveAt: number; walkIn: boolean; archetype?: ArchetypeId; player?: boolean;
  caseType?: CaseType; avoidCase?: CaseType | null;
}): SimPatient {
  const arch = o.archetype ?? pickArchetype(state, c, rng);
  const a = ARCHETYPES[arch];
  const dirtLevel = Math.round(clamp((rng.next() + rng.next()) / 2, 0, 1) * 100) / 100;
  const caseType = o.caseType ?? pickCase(state, c, arch, rng, o.avoidCase ?? null);
  const twists = pickTwists(state, arch, rng);
  const service = serviceFor(caseType);
  const kidsWait = arch === 'kid' && c.equipment.includes('kidsCorner') ? 1.3 : 1;
  const patience = a.patience * (c.equipment.includes('espresso') ? 1.25 : 1) * kidsWait;
  return {
    id: nextId(state, 'p'),
    name: patientName(arch, rng),
    archetype: arch,
    portrait: arch,
    service,
    addons: [],
    apptMin: o.apptMin,
    walkIn: o.walkIn,
    state: 'scheduled',
    since: o.arriveAt,
    until: null,
    seat: null,
    opId: null,
    staffId: null,
    awaitingPlayer: false,
    arrivedMin: null,
    waitedMin: 0,
    patience,
    dirtLevel,
    quality: null,
    comfort: null,
    stars: null,
    fee: 0,
    tip: 0,
    isPlayerPatient: !!o.player,
    caseType,
    twists,
    mood: 'happy',
    arriveAt: o.arriveAt,
    pm: { [service]: c.prices[service] ?? 1 },
  };
}

/** A dentist is at work today (not on a course). */
export function hasDentist(state: GameState, c: Clinic): boolean {
  return c.staff.some((s) => s.role === 'dentist' && isPresent(state, s));
}

export function addonAcceptMult(state: GameState, c: Clinic, key: AddonId): number {
  const m = c.prices[key] ?? 1;
  return Math.pow(m, -2) * (hasSkill(state, 'upseller') ? 1.15 : 1) * (c.ops.some((o) => o.upgrades.includes('intraoralCam')) ? 1.1 : 1);
}

/** Which add-ons this clinic can offer this patient right now (before the acceptance roll). */
export function offerableAddons(state: GameState, c: Clinic, p: SimPatient): AddonId[] {
  const out: AddonId[] = ['fluoride'];
  if (p.archetype === 'kid') out.push('sealant');
  if (c.equipment.includes('xray')) out.push('xray');
  // whitening is not an upsell any more: it comes with the whitening case (decideAddons)
  if (hasDentist(state, c)) {
    // the front desk stops selling exams when the dentist is booked up
    const docs = c.staff.filter((s) => s.role === 'dentist' && isPresent(state, s)).length;
    let pending = 0;
    for (const q of c.patients) if (q.addons.includes('exam') && !(q as SimPatient).examDone && (q.state === 'waiting' || q.state === 'toChair' || q.state === 'inChair')) pending++;
    if (pending < 3 * docs) out.push('exam');
  }
  return out;
}

export function addonBase(p: SimPatient, id: AddonId): number {
  if (id === 'whitening') return ARCHETYPES[p.archetype].whitening;
  return SERVICES[id].baseAccept;
}

/**
 * Decide the accepted add-ons at check-in and set the fee (dentist fillings are added later).
 * Add-on prices are locked here; the service price was locked at booking (walk-ins: at arrival).
 * A whitening case always bills the whitening add-on.
 */
export function decideAddons(state: GameState, c: Clinic, p: SimPatient, rng: Rng): void {
  const accepted: AddonId[] = [];
  if (!p.isPlayerPatient) {
    for (const id of offerableAddons(state, c, p)) {
      const pr = clamp(addonBase(p, id) * addonAcceptMult(state, c, id), 0, 0.95);
      if (rng.chance(pr)) accepted.push(id);
    }
    if (p.caseType === 'whitening') accepted.push('whitening');
  }
  p.addons = accepted;
  // lock only what can be billed (keeps saves small): the service, accepted add-ons, a filling after an exam
  const pm = { ...(p.pm ?? {}) };
  pm[p.service] ??= c.prices[p.service] ?? 1;
  for (const k of accepted) pm[k] = c.prices[k] ?? 1;
  if (accepted.includes('exam')) pm.filling = c.prices.filling ?? 1;
  p.pm = pm;
  p.fee = feeFor(c, p);
}

export function feeFor(c: Clinic, p: SimPatient): number {
  let fee = SERVICES[p.service].fee * priceOf(c, p, p.service);
  for (const a of p.addons) fee += SERVICES[a].fee * priceOf(c, p, a);
  return Math.round(fee);
}

/** Fee of the parts billed at the end of a hands-on clean (service + non-dentist add-ons). */
export function handsFee(c: Clinic, p: SimPatient): number {
  let fee = SERVICES[p.service].fee * priceOf(c, p, p.service);
  for (const a of p.addons) if (!SERVICES[a].requiresDentist) fee += SERVICES[a].fee * priceOf(c, p, a);
  return Math.round(fee);
}

/** Turn a case the operatory cannot do into a routine cleaning (owner phase), fixing service and fee. */
export function downgradeCase(c: Clinic, p: SimPatient): void {
  p.caseType = 'routine';
  if (p.service === 'deep') p.service = 'cleaning';
  if (p.addons.includes('whitening')) p.addons = p.addons.filter((a) => a !== 'whitening');
  if (p.pm) p.pm.cleaning ??= c.prices.cleaning ?? 1;
  if (p.state !== 'scheduled' && p.state !== 'entering' && p.state !== 'checkin') p.fee = feeFor(c, p);
}

/** Chair minutes of the hygienist part: service plus non-dentist add-ons. */
export function chairMinutes(p: SimPatient): number {
  let m = SERVICES[p.service].minutes;
  for (const a of p.addons) if (!SERVICES[a].requiresDentist) m += SERVICES[a].minutes;
  return m;
}

export function addonMinutes(p: SimPatient): number {
  let m = 0;
  for (const a of p.addons) if (!SERVICES[a].requiresDentist) m += SERVICES[a].minutes;
  return m;
}

export function suppliesFor(p: SimPatient): number {
  let s = SERVICES[p.service].supplies;
  for (const a of p.addons) s += SERVICES[a].supplies;
  return s;
}

// ------------------------------------------------------------------ hands-on setup

/** Employee difficulty scaling of NPC work (DESIGN 6); the v2 hands-on dirt comes from cases.ts. */
export function difficultyScale(state: GameState): number {
  if (state.phase === 'school') return 1;
  return Math.min(1.5, 1 + 0.05 * (state.player.level - 1));
}

export { S };
