// Patient generation, add-on decisions and the hands-on CleanSetup. DESIGN 6 and 7.
import type { AddonId, ArchetypeId, CleanSetup, Clinic, DirtProfile, GameState, ServiceId, ToolLoadout } from '../core/types';
import type { Rng } from '../core/rng';
import { hashSeed, makeRng, clamp } from '../core/rng';
import { ARCHETYPES, LAST_NAMES, PATIENT_ARCHETYPES } from '../data/patients';
import { SERVICES } from '../data/services';
import { TOOLS } from '../data/tools';
import { S, SimPatient, hasSkill, nextId } from './internal';
import { cleanMods } from './progress';

export function pickArchetype(c: Clinic, rng: Rng): ArchetypeId {
  const kids = c.equipment.includes('kidsCorner') ? 2 : 1;
  return rng.weighted(PATIENT_ARCHETYPES, (a) => ARCHETYPES[a].weight[c.tier] * (a === 'kid' ? kids : 1));
}

export function patientName(arch: ArchetypeId, rng: Rng): string {
  const first = rng.pick(ARCHETYPES[arch].firstNames);
  if (first.includes(' ')) return first;
  return `${first} ${rng.pick(LAST_NAMES)}`;
}

export function makePatient(state: GameState, c: Clinic, rng: Rng, o: {
  apptMin: number; arriveAt: number; walkIn: boolean; archetype?: ArchetypeId; player?: boolean; service?: ServiceId;
}): SimPatient {
  const arch = o.archetype ?? pickArchetype(c, rng);
  const a = ARCHETYPES[arch];
  const dirtLevel = Math.round(clamp((rng.next() + rng.next()) / 2, 0, 1) * 100) / 100;
  let service: ServiceId = o.service ?? 'cleaning';
  if (!o.service && !o.player && c.equipment.includes('deepCert') && rng.chance(a.deepChance)) service = 'deep';
  const patience = a.patience * (c.equipment.includes('espresso') ? 1.25 : 1);
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
    mood: 'happy',
    arriveAt: o.arriveAt,
  };
}

export function hasDentist(state: GameState, c: Clinic): boolean {
  return c.staff.some((s) => s.role === 'dentist');
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
  if (c.ops.some((o) => o.upgrades.includes('whiteningLamp'))) out.push('whitening');
  if (hasDentist(state, c)) {
    // the front desk stops selling exams when the dentist is booked up
    const docs = c.staff.filter((s) => s.role === 'dentist').length;
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

/** Decide the accepted add-ons at check-in and set the fee (dentist fillings are added later). */
export function decideAddons(state: GameState, c: Clinic, p: SimPatient, rng: Rng): void {
  const accepted: AddonId[] = [];
  if (!p.isPlayerPatient) {
    for (const id of offerableAddons(state, c, p)) {
      const pr = clamp(addonBase(p, id) * addonAcceptMult(state, c, id), 0, 0.95);
      if (rng.chance(pr)) accepted.push(id);
    }
  }
  p.addons = accepted;
  p.fee = feeFor(c, p);
}

export function feeFor(c: Clinic, p: SimPatient): number {
  let fee = SERVICES[p.service].fee * (c.prices[p.service] ?? 1);
  for (const a of p.addons) fee += SERVICES[a].fee * (c.prices[a] ?? 1);
  return Math.round(fee);
}

/** Fee of the parts billed at the end of a hands-on clean (service + non-dentist add-ons). */
export function handsFee(c: Clinic, p: SimPatient): number {
  let fee = SERVICES[p.service].fee * (c.prices[p.service] ?? 1);
  for (const a of p.addons) if (!SERVICES[a].requiresDentist) fee += SERVICES[a].fee * (c.prices[a] ?? 1);
  return Math.round(fee);
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

export function difficultyScale(state: GameState): number {
  if (state.phase === 'school') return 1;
  return Math.min(1.5, 1 + 0.05 * (state.player.level - 1));
}

export function dirtFor(state: GameState, p: { archetype: ArchetypeId; dirtLevel: number; service: ServiceId }, scale: number): DirtProfile {
  const a = ARCHETYPES[p.archetype];
  const m = 0.8 + 0.4 * p.dirtLevel;
  const deep = p.service === 'deep';
  return {
    plaque: clamp(a.dirt.plaque * scale * m, 0.05, 1),
    stain: clamp(a.dirt.stain * scale * m, 0, 1),
    tartarCount: Math.max(1, Math.round(a.dirt.tartarCount * scale * m * (deep ? 1.3 : 1))),
    tartarSize: Math.round(a.dirt.tartarSize * (deep ? 1.15 : 1) * 100) / 100,
    debrisCount: Math.max(0, Math.round(a.dirt.debrisCount * (0.75 + 0.5 * p.dirtLevel))),
  };
}

export function parSeconds(d: DirtProfile, parMult: number): number {
  return Math.round((25 + 3.2 * d.tartarCount * d.tartarSize + 30 * d.plaque + 25 * d.stain + 4 * d.debrisCount) * parMult);
}

export function loadout(state: GameState, useGel: boolean): ToolLoadout {
  const t = state.player.tools;
  const cap = (slot: keyof typeof TOOLS, v: number) => clamp(Math.round(v) || 1, 1, TOOLS[slot].length);
  return {
    scaler: cap('scaler', t.scaler),
    polisher: cap('polisher', t.polisher),
    floss: cap('floss', t.floss),
    suction: cap('suction', t.suction),
    rinse: cap('rinse', t.rinse),
    extras: [...state.player.extras],
    numbingGel: useGel,
  };
}

function missingTeeth(arch: ArchetypeId, seed: number): number[] {
  const [lo, hi] = ARCHETYPES[arch].missing;
  if (hi <= 0) return [];
  const r = makeRng(seed);
  const n = r.int(lo, hi);
  // prefer molars and premolars; never both central incisors
  const pool = Array.from({ length: 28 }, (_, i) => i).filter((i) => ![6, 7, 20, 21].includes(i));
  const out: number[] = [];
  while (out.length < n && pool.length) {
    const t = r.weighted(pool, (i) => { const pos = i % 14; return pos <= 3 || pos >= 10 ? 3 : 1; });
    out.push(t);
    pool.splice(pool.indexOf(t), 1);
  }
  return out.sort((a, b) => a - b);
}

export function buildSetup(state: GameState, o: {
  patientId: string; name: string; archetype: ArchetypeId; service: ServiceId; dirtLevel: number;
  tutorial: boolean; dirtScale: number; consumeGel: boolean;
}): CleanSetup {
  const seed = hashSeed(state.seed, o.patientId, state.day);
  const a = ARCHETYPES[o.archetype];
  const dirt = dirtFor(state, { archetype: o.archetype, dirtLevel: o.dirtLevel, service: o.service }, o.dirtScale);
  const mods = cleanMods(state);
  let gel = false;
  if (o.consumeGel && state.player.useGel && state.player.numbingGel > 0) {
    gel = true;
    state.player.numbingGel -= 1;
  }
  const lines = [...a.lines];
  return {
    seed,
    patientId: o.patientId,
    patient: { name: o.name, archetype: o.archetype, portrait: o.archetype },
    service: o.service,
    missingTeeth: missingTeeth(o.archetype, hashSeed(seed, 'missing')),
    dirt,
    traits: { ...a.traits },
    tools: loadout(state, gel),
    mods,
    tutorial: o.tutorial,
    parSeconds: parSeconds(dirt, mods.parMult),
    lines,
  };
}

export { S };
