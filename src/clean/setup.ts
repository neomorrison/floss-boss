// Builds a CleanSetup from simple options. Used by the clean harness and tests (the game builds its
// own setups in the sim). Pure: no DOM.
import type { ArchetypeId, CleanModifiers, CleanSetup, ExtraId, ServiceId, SkillId, ToolLoadout } from '../core/types';
import { ARCHETYPES } from '../data/patients';
import { makeRng } from '../core/rng';
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

export interface SetupOptions {
  archetype?: ArchetypeId;
  seed?: number;
  tutorial?: boolean;
  tools?: Partial<Omit<ToolLoadout, 'extras' | 'numbingGel'>>;
  extras?: ExtraId[];
  gel?: boolean;
  skills?: SkillId[];
  service?: ServiceId;
  name?: string;
}

export function buildSetup(o: SetupOptions = {}): CleanSetup {
  const archetype = o.archetype ?? 'regular';
  const a = ARCHETYPES[archetype];
  const seed = o.seed ?? 12345;
  const rng = makeRng(seed ^ 0x5eed);
  const missing: number[] = [];
  const nMiss = rng.int(a.missing[0], a.missing[1]);
  while (missing.length < nMiss) {
    const t = rng.int(0, 27);
    if (!missing.includes(t)) missing.push(t);
  }
  const mods = modsFromSkills(o.skills ?? []);
  const dirt = { ...a.dirt };
  if (o.service === 'deep') { dirt.tartarCount = Math.round(dirt.tartarCount * 1.3); }
  const first = o.name ?? a.firstNames[rng.int(0, a.firstNames.length - 1)];
  const setup: CleanSetup = {
    seed,
    patientId: 'p' + seed,
    patient: { name: archetype === 'mannequin' ? 'Dennis the Dummy' : first, archetype, portrait: archetype },
    service: o.service ?? 'cleaning',
    missingTeeth: missing,
    dirt,
    traits: { ...a.traits },
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
