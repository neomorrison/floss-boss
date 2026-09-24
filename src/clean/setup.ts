// Builds a CleanSetup from simple options, following the spawn contract in DESIGN 5.5. Used by the clean
// harness and tests (the game builds its own setups in the sim). Pure: no DOM.
import type {
  ArchetypeId, BonusId, CaseSpecial, CaseType, CleanModifiers, CleanSetup, DirtProfile, ExtraId, PatientTraits, ServiceId, SkillId, ToolLoadout, TwistId,
} from '../core/types';
import { ARCHETYPES } from '../data/patients';
import { problemToothCount } from '../data/cases';
import { TEETH_PER_ARCH } from '../core/mouth';
import { clamp, makeRng, type Rng } from '../core/rng';
import { parFor } from './dirt';

export const DEFAULT_MODS: CleanModifiers = {
  gumDamage: 1, scalerPower: 1, polishRadius: 1, polishSpeed: 1, eagleEye: false,
  parMult: 1, reassure: 1, comfortDrain: 1, fidget: 1, gagDelay: 0,
};

export function modsFromSkills(skills: SkillId[]): CleanModifiers {
  const has = (s: SkillId) => skills.includes(s);
  return {
    gumDamage: has('steady2') ? 0.5 : has('steady1') ? 0.75 : 1,
    scalerPower: has('power') ? 1.25 : 1,
    polishRadius: has('polishPro') ? 1.25 : 1,
    polishSpeed: has('polishPro') ? 1.25 : 1,
    eagleEye: has('eagleEye'),
    parMult: has('speedCleaner') ? 1.2 : 1,
    reassure: has('calmingVoice') ? 1.5 : 1,
    comfortDrain: has('smallTalk') ? 0.8 : 1,
    fidget: has('kidWhisperer') ? 0.4 : 1,
    gagDelay: has('gagGuru') ? 2 : 0,
  };
}

export const NO_SPECIAL: CaseSpecial = {
  goldTooth: null, braces: false, startShade: 0, targetShade: 0, sugarBugs: 0, sealants: 0,
  pockets: 0, treasure: false, barnacles: 0, seaweed: 0,
};

export interface SetupOptions {
  archetype?: ArchetypeId;
  caseType?: CaseType;
  level?: number;
  twists?: TwistId[];
  bonus?: BonusId | null;
  firstOfCase?: boolean;
  seed?: number;
  tutorial?: boolean;
  tools?: Partial<Omit<ToolLoadout, 'extras' | 'numbingGel'>>;
  extras?: ExtraId[];
  gel?: boolean;
  skills?: SkillId[];
  service?: ServiceId;
  name?: string;
}

const DEFAULT_ARCHETYPE: Record<CaseType, ArchetypeId> = {
  routine: 'regular', candy: 'kid', whitening: 'coffee', braces: 'athlete', pirate: 'pirate', deep: 'senior',
};

/** Pick `n` present teeth from `pool`, spread over both arches. */
function pickTeeth(rng: Rng, pool: number[], n: number): number[] {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; }
  const upper = a.filter((i) => i < TEETH_PER_ARCH), lower = a.filter((i) => i >= TEETH_PER_ARCH);
  const out: number[] = [];
  const lists = [lower, upper];
  for (let k = 0; out.length < n && (upper.length || lower.length); k++) {
    const from = lists[k % 2].length ? lists[k % 2] : lists[(k + 1) % 2];
    out.push(from.shift()!);
  }
  return out.sort((x, y) => x - y);
}

/** The spawn contract of DESIGN 5.5 as a pure function (the sim does the same for real patients). */
export function caseSpawn(caseType: CaseType, level: number, archetype: ArchetypeId, missing: number[], rng: Rng, tutorial = false): {
  dirt: DirtProfile; problemTeeth: number[]; special: CaseSpecial;
} {
  const L = Math.max(1, level);
  const a = ARCHETYPES[archetype];
  const present = (i: number) => !missing.includes(i);
  const all = Array.from({ length: 28 }, (_, i) => i).filter(present);
  const inPos = (lo: number, hi: number) => all.filter((i) => { const p = i % TEETH_PER_ARCH; return p >= lo && p <= hi; });
  const n = problemToothCount(L);
  const special: CaseSpecial = { ...NO_SPECIAL, startShade: clamp(4 + Math.round(a.dirt.stain * 4), 2, 9) };
  let problemTeeth: number[];
  let dirt: DirtProfile;
  switch (caseType) {
    case 'candy':
      problemTeeth = pickTeeth(rng, all, n);
      dirt = { tartarCount: 2, tartarSize: 0.7, plaque: 0.7, stain: 0.1, debrisCount: rng.int(2, 4) };
      special.sugarBugs = Math.min(8, 3 + Math.floor(L / 2));
      special.sealants = L >= 3 ? 4 : 0;
      break;
    case 'whitening': {
      problemTeeth = pickTeeth(rng, inPos(4, 9), rng.int(4, 6));
      dirt = { tartarCount: 2, tartarSize: 1.0, plaque: 0.3, stain: 0.9, debrisCount: 0 };
      const dark = archetype === 'coffee' || archetype === 'smoker' ? 2 : 0;
      special.startShade = clamp(rng.int(11, 13) + dark, 11, 15);
      special.targetShade = Math.max(1, special.startShade - rng.int(6, 8));
      break;
    }
    case 'braces':
      problemTeeth = pickTeeth(rng, inPos(2, 11), n);
      dirt = { tartarCount: 3, tartarSize: 1.0, plaque: 0.7, stain: 0.2, debrisCount: rng.int(3, 5) };
      special.braces = true;
      break;
    case 'pirate': {
      const front = inPos(4, 9);
      special.goldTooth = front.length ? rng.pick(front) : null;
      // the gold tooth is never a problem tooth (DESIGN 5.5 sim notes)
      problemTeeth = pickTeeth(rng, all.filter((i) => i !== special.goldTooth), n);
      dirt = { tartarCount: 2, tartarSize: 1.0, plaque: 0.4, stain: 0.6, debrisCount: 0 };
      special.barnacles = rng.int(3, 5);
      special.seaweed = rng.int(2, 3);
      special.treasure = rng.chance(0.7);
      special.startShade = 9;
      break;
    }
    case 'deep':
      problemTeeth = pickTeeth(rng, all, n);
      dirt = { tartarCount: rng.int(3, 5), tartarSize: 1.2, plaque: 0.6, stain: 0.3, debrisCount: 1 };
      special.pockets = rng.int(2, 4);
      special.startShade = 7;
      break;
    default: {
      const pool = tutorial ? all.filter((i) => { const p = i % TEETH_PER_ARCH; return p >= 3 && p <= 10; }) : all;
      problemTeeth = pickTeeth(rng, pool, n);
      if (tutorial && present(TEETH_PER_ARCH + 7) && !problemTeeth.includes(TEETH_PER_ARCH + 7)) problemTeeth[0] = TEETH_PER_ARCH + 7;
      problemTeeth.sort((x, y) => x - y);
      dirt = {
        tartarCount: Math.min(problemTeeth.length * 2, Math.round(problemTeeth.length * (1 + 0.1 * (L - 1)))),
        tartarSize: clamp(1 + 0.04 * (L - 1), 1, 1.3),
        plaque: Math.min(0.9, 0.5 + 0.05 * (L - 1)),
        stain: clamp(a.dirt.stain * 0.6, 0, 1),
        debrisCount: Math.round(1 + L / 3),
      };
    }
  }
  return { dirt, problemTeeth, special };
}

/** Twists are written into traits the way the sim does it: chatty, gag, fidget (at least 0.5), Sensitive Gums x2. */
export function traitsWithTwists(base: PatientTraits, twists: TwistId[]): PatientTraits {
  const t = { ...base };
  if (twists.includes('chatty')) t.chatty = true;
  if (twists.includes('gagger')) t.gag = true;
  if (twists.includes('fidget')) t.fidget = Math.max(0.5, t.fidget);
  if (twists.includes('sensitive')) t.gumSensitivity *= 2;
  return t;
}

export function buildSetup(o: SetupOptions = {}): CleanSetup {
  const caseType = o.caseType ?? 'routine';
  const archetype = o.archetype ?? (o.tutorial ? 'mannequin' : DEFAULT_ARCHETYPE[caseType]);
  const a = ARCHETYPES[archetype];
  const seed = o.seed ?? 12345;
  const rng = makeRng(seed ^ 0x5eed);
  const missing: number[] = [];
  const nMiss = caseType === 'pirate' ? Math.max(3, rng.int(a.missing[0], a.missing[1])) : rng.int(a.missing[0], a.missing[1]);
  while (missing.length < nMiss) {
    const t = rng.int(0, 27);
    // pirates keep their front teeth (the gold tooth lives there); everyone keeps the tutorial teeth
    const pos = t % TEETH_PER_ARCH;
    if (caseType === 'pirate' && pos >= 4 && pos <= 9) continue;
    if (!missing.includes(t)) missing.push(t);
  }
  const mods = modsFromSkills(o.skills ?? []);
  const spawn = caseSpawn(caseType, o.level ?? 1, archetype, missing, rng, !!o.tutorial);
  const first = o.name ?? a.firstNames[rng.int(0, a.firstNames.length - 1)];
  const setup: CleanSetup = {
    seed,
    patientId: 'p' + seed,
    patient: { name: archetype === 'mannequin' ? 'Dennis the Dummy' : first, archetype, portrait: archetype },
    caseType,
    twists: o.twists ?? [],
    bonus: o.bonus === undefined ? null : o.bonus,
    problemTeeth: spawn.problemTeeth,
    special: spawn.special,
    firstOfCase: !!o.firstOfCase,
    service: o.service ?? (caseType === 'deep' ? 'deep' : 'cleaning'),
    missingTeeth: missing,
    dirt: spawn.dirt,
    traits: traitsWithTwists(a.traits, o.twists ?? []),
    tools: {
      scaler: o.tools?.scaler ?? 1, polisher: o.tools?.polisher ?? 1, floss: o.tools?.floss ?? 1,
      suction: o.tools?.suction ?? 1, rinse: o.tools?.rinse ?? 1,
      extras: o.extras ?? [], numbingGel: !!o.gel,
    },
    mods,
    tutorial: !!o.tutorial,
    parSeconds: 0,
    lines: a.lines.slice(),
  };
  setup.parSeconds = Math.round(parFor(setup));
  return setup;
}
