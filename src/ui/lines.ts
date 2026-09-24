// Character copy for result screens (COPY.md: characters carry the jokes; Dr. Ruth Canal loves a pun).
// No em dashes. Exclamation marks are fine here.
import type { ArchetypeId } from '../core/types';
import { hashStr } from './portrait';

const CANAL: Record<number, string[]> = {
  5: [
    'Now that is what I call a clean sweep!',
    'Brilliant! You really know the drill.',
    'Sparkling! I am positively beaming.',
    'Flawless. I may need sunglasses for that smile.',
  ],
  4: [
    'Lovely work. That smile is going places.',
    'Very nice. You are really filling a gap around here.',
    'Great job. Our patients are in good hands.',
  ],
  3: [
    'Not bad at all. Practice makes plaque-free.',
    'A decent clean. Keep brushing up on those molars.',
    'Solid work, dear. A little more polish next time.',
  ],
  2: [
    'Hmm. We will floss over this one.',
    'A bit rough around the gums, dear. Slow and steady.',
  ],
  1: [
    'Oh dear. That was tooth hurty.',
    'Let us call that one a learning experience.',
  ],
};

const PATIENT: Record<number, string[]> = {
  5: ['My teeth have never felt this smooth!', 'I keep licking my teeth. Incredible!', 'Is it weird that I want to come back tomorrow?'],
  4: ['So fresh. Thank you!', 'That was actually kind of nice.', 'My tongue does not recognise my teeth.'],
  3: ['Not bad. A bit scrapey in places.', 'Feels cleaner, I think?', 'Okay. I have had worse.'],
  2: ['Ow. My gums have notes.', 'I still feel something back there.', 'That was a lot of poking.'],
  1: ['I will be writing a review about this.', 'Was that supposed to hurt?', 'Never again.'],
};

const ARCH_EXTRA: Partial<Record<ArchetypeId, Record<number, string>>> = {
  influencer: { 5: 'Hold still, I need a selfie with this smile!', 4: 'Posting this. Tagging you.', 1: 'My followers will hear about this.' },
  kid: { 5: 'Do I get a sticker? I deserve TWO stickers!', 4: 'That tickled!', 1: 'I want my mom!' },
  senior: { 5: 'Why, I have not felt this young since 1972!', 4: 'Lovely work, dear. Lovely.' },
  coffee: { 5: 'Great. Now I need a coffee to celebrate.', 4: 'Can I have my coffee now?' },
  chatty: { 5: 'Mmhm mm! I mean, wow! Where was I?', 4: 'So anyway, as I was saying...' },
  nervous: { 5: 'That was... actually fine? Wow.', 4: 'I survived! Thank you!' },
  athlete: { 5: 'Personal best! High five!', 4: 'Clean and fast. Respect.' },
};

const WALKOUT_CANAL = ['They walked out! Gentle hands, dear. Gentle hands.', 'A walkout? Oh my stars. Let us not make that a habit.'];
const WALKOUT_PATIENT = ['Nope. I am out of here!', 'I am leaving. My gums have suffered enough.'];

function pickFrom(list: string[], seed: string): string {
  return list[hashStr(seed) % list.length];
}

export function canalLine(stars: number, walkout: boolean, seed: string): string {
  if (walkout) return pickFrom(WALKOUT_CANAL, seed);
  return pickFrom(CANAL[Math.max(1, Math.min(5, Math.round(stars)))], seed);
}

export function patientLine(archetype: ArchetypeId, stars: number, walkout: boolean, seed: string): string {
  if (walkout) return pickFrom(WALKOUT_PATIENT, seed);
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  const extra = ARCH_EXTRA[archetype]?.[s];
  if (extra && hashStr(seed + 'x') % 2 === 0) return extra;
  return pickFrom(PATIENT[s], seed);
}
