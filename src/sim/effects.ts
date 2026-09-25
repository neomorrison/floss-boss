// Runtime effects of equipment, operatory upgrades, skills, staff perks and clinic modifiers (DESIGN 8, 10).
// Every number a blurb promises lives here, so booking, the clinic tick and the day close agree.
import type {
  AddonId, ArchetypeId, CaseType, Clinic, ClinicModifier, EquipId, GameState, Operatory, PerkId, Staff,
} from '../core/types';
import { CLOSE_MIN, LAST_APPT_MIN } from '../core/constants';
import { FOCUSES, PERKS } from '../data/manager';
import { CHAIRS } from '../data/upgrades';
import { hasSkill, isPresent } from './internal';

// ------------------------------------------------------------------ modifiers

/** First day a modifier applies: the day in its id ('campaign:kidsWeek:12', 'event:puppy:9.2'). A campaign
 * bought after the doors open carries tomorrow's day. 0 when the id has no day. */
export function modStartDay(m: ClinicModifier): number {
  const i = m.id.lastIndexOf(':');
  const d = i >= 0 ? parseInt(m.id.slice(i + 1), 10) : NaN;
  return Number.isFinite(d) ? d : 0;
}

export function modActive(state: GameState, m: ClinicModifier): boolean {
  return (m.untilDay == null || m.untilDay >= state.day) && modStartDay(m) <= state.day;
}

export interface ModAgg {
  demand: number; fees: number; supplies: number; speed: number; comfort: number; quality: number;
  addons: number; walkins: number; noShows: number; caseBoost: Partial<Record<CaseType, number>>; openDelay: number;
}

/** Every active modifier of a clinic folded into one set of multipliers (quality is additive). */
export function modAgg(state: GameState, c: Clinic): ModAgg {
  const a: ModAgg = { demand: 1, fees: 1, supplies: 1, speed: 1, comfort: 1, quality: 0, addons: 1, walkins: 1, noShows: 1, caseBoost: {}, openDelay: 0 };
  const mods = c.modifiers;
  if (!mods || !mods.length) return a;
  for (const m of mods) {
    if (!modActive(state, m)) continue;
    if (m.demand != null) a.demand *= m.demand;
    if (m.fees != null) a.fees *= m.fees;
    if (m.supplies != null) a.supplies *= m.supplies;
    if (m.speed != null) a.speed *= m.speed;
    if (m.comfort != null) a.comfort *= m.comfort;
    if (m.quality != null) a.quality += m.quality;
    if (m.addons != null) a.addons *= m.addons;
    if (m.walkins != null) a.walkins *= m.walkins;
    if (m.noShows != null) a.noShows *= m.noShows;
    if (m.openDelay != null && m.untilDay === state.day) a.openDelay = Math.max(a.openDelay, m.openDelay);
    if (m.caseBoost) for (const [ct, v] of Object.entries(m.caseBoost) as [CaseType, number][]) a.caseBoost[ct] = (a.caseBoost[ct] ?? 1) * v;
  }
  return a;
}

// ------------------------------------------------------------------ equipment and upgrades

export const has = (c: Clinic, id: EquipId) => c.equipment.includes(id);
/** Chain-wide equipment (Research Wing, Helipad): owned at any location. */
export function chainHas(state: GameState, id: EquipId): boolean {
  return state.locations.some((l) => l.equipment.includes(id));
}

/** Night Shift: owned locations take appointments and stay open an hour later. */
export function lateMinutes(state: GameState, c: Clinic): number {
  return c.ownedByPlayer && hasSkill(state, 'nightShift') ? 60 : 0;
}
export function lastAppt(state: GameState, c: Clinic): number { return LAST_APPT_MIN + lateMinutes(state, c); }
export function closeMin(state: GameState, c: Clinic): number { return CLOSE_MIN + lateMinutes(state, c); }

/** Demand multipliers from equipment (Online Booking, Loyalty Punch Cards, Patient App, Helipad). */
export function equipDemand(state: GameState, c: Clinic): number {
  return (has(c, 'onlineBooking') ? 1.1 : 1) * (has(c, 'loyaltyProgram') ? 1.08 : 1) * (has(c, 'patientApp') ? 1.05 : 1)
    * (c.ownedByPlayer && chainHas(state, 'helipad') ? 1.15 : 1);
}

/** Waiting-room patience: Espresso 1.25, Sound Masking 1.2, Spa Lounge 1.5, kids with a Kids Corner 1.3. */
export function patienceMult(c: Clinic, arch: ArchetypeId): number {
  return (has(c, 'espresso') ? 1.25 : 1) * (has(c, 'soundMasking') ? 1.2 : 1) * (has(c, 'spaLounge') ? 1.5 : 1)
    * (arch === 'kid' && has(c, 'kidsCorner') ? 1.3 : 1);
}

/** Laughing gas at this chair: the op upgrade, or the Central Nitrous Line. */
export function hasNitrous(c: Clinic, op: Operatory | null): boolean {
  return !!op?.upgrades.includes('nitrous') || has(c, 'nitrousSystem');
}

/** Additive comfort of an operatory: chair, Ceiling TV, Aromatherapy, laughing gas (op 0.15, line 0.10). */
export function opComfort(c: Clinic, op: Operatory | null): number {
  const chair = op ? CHAIRS[op.chair]?.comfort ?? 0 : 0;
  const tv = op?.upgrades.includes('tv') ? 0.08 : 0;
  const gas = op?.upgrades.includes('nitrous') ? 0.15 : has(c, 'nitrousSystem') ? 0.1 : 0;
  return chair + tv + (has(c, 'aromatherapy') ? 0.05 : 0) + gas;
}

/** Additive quality of an operatory: chair, Sterilizer Pro, Intraoral Camera. */
export function opQuality(c: Clinic, op: Operatory | null): number {
  const chair = op ? CHAIRS[op.chair]?.quality ?? 0 : 0;
  return chair + (has(c, 'sterilizer') ? 0.03 : 0) + (op?.upgrades.includes('intraoralCam') ? 0.03 : 0);
}

/** Chair-time multiplier from the operatory (Ultrasonic Kits 0.9, Ergonomic Stool 1/1.05). */
export function opDuration(c: Clinic, op: Operatory | null): number {
  return (has(c, 'ultrasonicKits') ? 0.9 : 1) * (op?.upgrades.includes('ergoStool') ? 1 / 1.05 : 1);
}

export function suppliesMult(state: GameState, c: Clinic): number {
  return (hasSkill(state, 'leanOps') ? 0.8 : 1) * (has(c, 'waterFilter') ? 0.9 : 1) * modAgg(state, c).supplies;
}

export function noShowRate(state: GameState, c: Clinic): number {
  const rec = c.staff.some((s) => s.role === 'receptionist' && isPresent(state, s));
  const r = 0.12 * (rec ? 0.6 : 1) * (has(c, 'onlineBooking') ? 0.5 : 1) * (has(c, 'patientApp') ? 0.7 : 1) * modAgg(state, c).noShows;
  return Math.max(0, Math.min(0.6, r));
}

/** Fee multiplier of an add-on from equipment: Laser Whitening +25% whitening, CAD/CAM +50% fillings. */
export function addonFeeMult(c: Clinic, key: AddonId): number {
  if (key === 'whitening' && has(c, 'laserWhitening')) return 1.25;
  if (key === 'filling' && has(c, 'cadcam')) return 1.5;
  return 1;
}

/** Minutes multiplier of an add-on: Digital X-Ray halves X-rays, CAD/CAM takes a third off fillings. */
export function addonMinutesMult(c: Clinic, key: AddonId): number {
  if (key === 'xray' && has(c, 'digitalXray')) return 0.5;
  if (key === 'filling' && has(c, 'cadcam')) return 2 / 3;
  return 1;
}

/** Smile Studio makeover VIP: flat fee and review weight. */
export const STUDIO_VIP_FEE = 2400;
export const VIP_WEIGHT = 5;

// ------------------------------------------------------------------ perks

export const perksOf = (s: Staff | null | undefined): PerkId[] => (s && Array.isArray(s.perks) ? s.perks : []);

/** Product of a multiplicative perk field (speed, addons, tipMult) over a staff member's perks. */
export function perkMult(s: Staff | null | undefined, key: 'speed' | 'addons'): number {
  let m = 1;
  for (const id of perksOf(s)) { const v = PERKS[id]?.[key]; if (v != null) m *= v; }
  return m;
}
export function perkAdd(s: Staff | null | undefined, key: 'comfort' | 'quality' | 'overworkBonus'): number {
  let a = 0;
  for (const id of perksOf(s)) { const v = PERKS[id]?.[key]; if (v != null) a += v; }
  return a;
}
/** The perk that makes this staff member a specialist of a case type, if any. */
export function specialty(s: Staff | null | undefined, ct: CaseType) {
  for (const id of perksOf(s)) { const d = PERKS[id]; if (d?.caseType === ct) return d; }
  return null;
}

// ------------------------------------------------------------------ staff

/** Staff XP multiplier: Ambitious 2x, Training Day, a Mentor teammate, Mentor Program, Research Wing. */
export function staffXpMult(state: GameState, c: Clinic, s: Staff): number {
  let m = s.traits.includes('ambitious') ? 2 : 1;
  if (c.ownedByPlayer) {
    for (const f of state.focus ?? []) m *= FOCUSES[f]?.staffXp ?? 1;
    if (c.staff.some((o) => o !== s && isPresent(state, o) && perksOf(o).includes('mentor'))) m *= PERKS.mentor.mentorXp ?? 1.5;
    if (hasSkill(state, 'mentorProgram')) m *= 1.5;
    if (chainHas(state, 'researchWing')) m *= 1.5;
  }
  return m;
}

/** Add staff XP for work done (base 1 per patient). */
export function addStaffXp(state: GameState, c: Clinic, s: Staff, base = 1): void {
  s.xp += base * staffXpMult(state, c, s);
}
