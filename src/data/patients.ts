// Patient archetypes. DESIGN 6. The sim may retune numbers (never ids).
import type { ArchetypeId, DirtProfile, OfficeTierId, PatientTraits } from '../core/types';

export interface Archetype {
  id: ArchetypeId;
  label: string;           // shown on patient cards
  blurb: string;
  dirt: DirtProfile;
  traits: PatientTraits;
  tipRate: number;
  patience: number;        // minutes of waiting before walking out
  difficulty: number;      // NPC clean duration multiplier
  reviewWeight: number;
  whitening: number;       // whitening add-on interest
  missing: [number, number];  // missing teeth range
  deepChance: number;      // chance the visit is a deep cleaning (needs deepCert, else cleaning)
  weight: Record<OfficeTierId, number>;   // arrival mix per office tier
  firstNames: string[];
  lines: string[];         // things they say mid-clean
}

const T = (comfortStart: number, comfortDrain: number, extra: Partial<PatientTraits> = {}): PatientTraits => ({
  comfortStart, comfortDrain, gumSensitivity: 1, gag: false, fidget: 0, chatty: false, ...extra,
});
const D = (plaque: number, stain: number, tartarCount: number, tartarSize: number, debrisCount: number): DirtProfile => ({ plaque, stain, tartarCount, tartarSize, debrisCount });

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  mannequin: {
    id: 'mannequin', label: 'Training dummy', blurb: 'Never flinches. Never tips.',
    dirt: D(0.4, 0.3, 6, 1.0, 1), traits: T(100, 0), tipRate: 0, patience: 999, difficulty: 1, reviewWeight: 0, whitening: 0,
    missing: [0, 0], deepChance: 0, weight: { t1: 0, t2: 0, t3: 0, t4: 0 },
    firstNames: ['Dennis'], lines: ['...', '(The dummy stares at the ceiling.)'],
  },
  regular: {
    id: 'regular', label: 'Regular', blurb: 'Comes in twice a year. Flosses the night before.',
    dirt: D(0.5, 0.3, 10, 1.0, 2), traits: T(80, 1.0), tipRate: 0.1, patience: 45, difficulty: 1, reviewWeight: 1, whitening: 0.08,
    missing: [0, 0], deepChance: 0, weight: { t1: 30, t2: 28, t3: 24, t4: 22 },
    firstNames: ['Pat', 'Sam', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Alex', 'Jamie', 'Taylor', 'Drew'],
    lines: ['Do I really have to floss every day?', 'I brushed extra hard this morning.', 'Is that a lot of tartar?'],
  },
  coffee: {
    id: 'coffee', label: 'Coffee lover', blurb: 'Four cups before noon. It shows.',
    dirt: D(0.4, 0.9, 8, 1.0, 1), traits: T(80, 1.0), tipRate: 0.12, patience: 40, difficulty: 1.05, reviewWeight: 1, whitening: 0.25,
    missing: [0, 0], deepChance: 0, weight: { t1: 14, t2: 14, t3: 12, t4: 12 },
    firstNames: ['Bean', 'Java', 'Mocha', 'Latte', 'Brewster', 'Rosa', 'Theo', 'Ines'],
    lines: ['Can I have my coffee right after?', 'Only three cups today. Promise.', 'Is that stain from the espresso?'],
  },
  kid: {
    id: 'kid', label: 'Candy kid', blurb: 'Brought gummy bears to the appointment.',
    dirt: D(0.8, 0.1, 3, 0.7, 6), traits: T(70, 1.3, { fidget: 0.6 }), tipRate: 0.05, patience: 30, difficulty: 1.1, reviewWeight: 1, whitening: 0,
    missing: [0, 0], deepChance: 0, weight: { t1: 12, t2: 12, t3: 10, t4: 10 },
    firstNames: ['Timmy', 'Lulu', 'Max', 'Ziggy', 'Pip', 'Mia', 'Otto', 'Bea'],
    lines: ['Is there a prize at the end?', 'That tickles!', 'I only ate a little candy.', 'Can I hold the water thingy?'],
  },
  nervous: {
    id: 'nervous', label: 'Nervous', blurb: 'White knuckles on the armrests.',
    dirt: D(0.5, 0.3, 8, 1.0, 1), traits: T(60, 2.0, { gumSensitivity: 1.4 }), tipRate: 0.15, patience: 35, difficulty: 1.15, reviewWeight: 1, whitening: 0.05,
    missing: [0, 0], deepChance: 0, weight: { t1: 10, t2: 10, t3: 9, t4: 8 },
    firstNames: ['Nellie', 'Walter', 'Priya', 'Gus', 'Hazel', 'Ned'],
    lines: ['Is it almost over?', 'Please be gentle.', 'I read about gum disease online.', 'Is that blood? Tell me it is not blood.'],
  },
  gagger: {
    id: 'gagger', label: 'Gag reflex', blurb: 'Keep it quick near the back teeth.',
    dirt: D(0.5, 0.3, 10, 1.0, 2), traits: T(75, 1.0, { gag: true }), tipRate: 0.1, patience: 45, difficulty: 1.15, reviewWeight: 1, whitening: 0.05,
    missing: [0, 0], deepChance: 0, weight: { t1: 8, t2: 8, t3: 8, t4: 8 },
    firstNames: ['Greg', 'Gail', 'Hugo', 'Gwen', 'Glen'],
    lines: ['Not too far back, please.', 'Sorry in advance.', 'I am fine. I am fine.'],
  },
  smoker: {
    id: 'smoker', label: 'Smoker', blurb: 'Twenty years of a pack a day.',
    dirt: D(0.6, 1.0, 18, 1.3, 1), traits: T(80, 1.0), tipRate: 0.1, patience: 45, difficulty: 1.35, reviewWeight: 1, whitening: 0.2,
    missing: [0, 1], deepChance: 0.3, weight: { t1: 8, t2: 9, t3: 11, t4: 11 },
    firstNames: ['Sal', 'Rex', 'Dolores', 'Vic', 'Marge', 'Earl'],
    lines: ['I am quitting next month.', 'Is it bad? Be honest.', 'My wife says my teeth are yellow.'],
  },
  senior: {
    id: 'senior', label: 'Senior', blurb: 'Has stories. Also has a lot of tartar.',
    dirt: D(0.5, 0.5, 22, 1.4, 2), traits: T(85, 0.8), tipRate: 0.18, patience: 60, difficulty: 1.45, reviewWeight: 1, whitening: 0.02,
    missing: [3, 6], deepChance: 0.6, weight: { t1: 8, t2: 9, t3: 12, t4: 13 },
    firstNames: ['Grandpa Joe', 'Mildred', 'Herb', 'Dot', 'Walt', 'Edna', 'Irving', 'Opal'],
    lines: ['Back in my day we used baking soda.', 'These are all my own teeth. Mostly.', 'Take your time, dear.'],
  },
  influencer: {
    id: 'influencer', label: 'Influencer', blurb: 'Posting the review before they reach the car.',
    dirt: D(0.2, 0.5, 4, 0.8, 1), traits: T(75, 1.2), tipRate: 0.2, patience: 30, difficulty: 0.9, reviewWeight: 3, whitening: 0.5,
    missing: [0, 0], deepChance: 0, weight: { t1: 2, t2: 5, t3: 8, t4: 10 },
    firstNames: ['Skye', 'Brooklyn', 'Jax', 'Nova', 'Kendi', 'Zane'],
    lines: ['Can you make them extra sparkly?', 'Hold on, I need a before photo.', 'My followers are going to love this.'],
  },
  athlete: {
    id: 'athlete', label: 'Sports drink fan', blurb: 'Lives on blue energy drinks.',
    dirt: D(0.9, 0.2, 8, 1.0, 2), traits: T(80, 1.0), tipRate: 0.1, patience: 25, difficulty: 1.05, reviewWeight: 1, whitening: 0.1,
    missing: [0, 0], deepChance: 0, weight: { t1: 8, t2: 9, t3: 9, t4: 9 },
    firstNames: ['Chad', 'Brianna', 'Tyrese', 'Kat', 'Dante', 'Shay'],
    lines: ['I have practice in an hour.', 'Is that from the blue drink?', 'Can we speed this up, coach?'],
  },
  chatty: {
    id: 'chatty', label: 'Chatterbox', blurb: 'Talks the whole time. Somehow.',
    dirt: D(0.5, 0.4, 10, 1.0, 3), traits: T(90, 0.6, { chatty: true }), tipRate: 0.12, patience: 50, difficulty: 1.1, reviewWeight: 1, whitening: 0.1,
    missing: [0, 0], deepChance: 0, weight: { t1: 10, t2: 10, t3: 9, t4: 9 },
    firstNames: ['Linda', 'Barb', 'Marty', 'Fran', 'Stu', 'Deb'],
    lines: ['So anyway, my neighbour...', 'Did I tell you about my cruise?', 'Mmhm mm hmm mmm.', 'Wait, one more thing.'],
  },
};

export const PATIENT_ARCHETYPES: ArchetypeId[] = ['regular', 'coffee', 'kid', 'nervous', 'gagger', 'smoker', 'senior', 'influencer', 'athlete', 'chatty'];

export const LAST_NAMES = ['Molar', 'Brushwell', 'Gumm', 'Enamel', 'Crowne', 'Pearl', 'Flossman', 'Bright', 'Canino', 'Plaque', 'Smiley', 'Chompers', 'Toothaker', 'Minty', 'Bicuspid', 'Rinse', 'Nashley', 'Grinwald'];

export const REVIEW_TEXT: Record<number, string[]> = {
  5: ['Best cleaning of my life.', 'My teeth have never felt this smooth.', 'Painless and sparkly. Five stars.', 'I keep licking my teeth. Incredible.'],
  4: ['Great job, a little wait.', 'Teeth feel fresh.', 'Friendly and thorough.'],
  3: ['It was fine.', 'Clean enough, I guess.', 'Took a while.'],
  2: ['Still feel some gunk back there.', 'Kind of rough on the gums.', 'Waited forever.'],
  1: ['Never again.', 'I left with more tartar than I came in with.', 'Walked out. Nobody saw me.'],
};
