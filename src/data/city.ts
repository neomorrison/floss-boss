// Smile City: districts and the Smile Index (DESIGN 11.1). The sim may retune numbers and texts (never ids).
import type { DistrictId } from '../core/types';

export interface DistrictDef {
  id: DistrictId;
  name: string;
  blurb: string;
  population: number;     // smile points needed to take this district from 0 to 100%
  start: number;          // starting Smile Index (0..1)
  neighbors: DistrictId[];
  color: string;          // map tint when fully smiling
}

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
  downtown: { id: 'downtown', name: 'Downtown', blurb: 'Office towers and coffee on every corner.', population: 900, start: 0.25, neighbors: ['harbor', 'oldtown', 'uptown'], color: '#3DD6B5' },
  harbor: { id: 'harbor', name: 'Harbor', blurb: 'Fishing boats, salty air, the odd pirate.', population: 700, start: 0.15, neighbors: ['downtown', 'oldtown'], color: '#4C9BE8' },
  maple: { id: 'maple', name: 'Maple Heights', blurb: 'Big yards, minivans, a lot of kids.', population: 800, start: 0.2, neighbors: ['university', 'uptown'], color: '#FFB347' },
  university: { id: 'university', name: 'University Hill', blurb: 'Students living on energy drinks.', population: 750, start: 0.18, neighbors: ['maple', 'oldtown'], color: '#9B6CD6' },
  oldtown: { id: 'oldtown', name: 'Old Town', blurb: 'Cobblestones, retirees, a very old bakery.', population: 650, start: 0.22, neighbors: ['downtown', 'harbor', 'university'], color: '#E9A23B' },
  uptown: { id: 'uptown', name: 'Uptown', blurb: 'Penthouses, galleries, celebrity sightings.', population: 850, start: 0.12, neighbors: ['downtown', 'maple'], color: '#FF7AA8' },
};
export const DISTRICT_ORDER: DistrictId[] = ['downtown', 'harbor', 'maple', 'university', 'oldtown', 'uptown'];
/** Bright Smiles Dental (the employee phase) is in Downtown. */
export const EMPLOYER_DISTRICT: DistrictId = 'downtown';

/** City-wide milestones (percent) and what each one celebrates or unlocks. */
export const CITY_MILESTONES: { pct: number; title: string; text: string }[] = [
  { pct: 30, title: 'Smile City 30%', text: 'People are noticing. The local paper runs a smile column.' },
  { pct: 40, title: 'Smile City 40%', text: 'Kids start flossing without being asked. Mostly.' },
  { pct: 50, title: 'Halfway There', text: 'The mayor declares a Smile Day. The Smile Van is for sale.' },
  { pct: 60, title: 'Smile City 60%', text: 'Billboards everywhere show off new smiles.' },
  { pct: 70, title: 'Golden Molar Nomination', text: 'The Dental Association nominates you for the Golden Molar.' },
  { pct: 80, title: 'Smile City 80%', text: 'Tourists visit just to see the smiles.' },
  { pct: 90, title: 'Smile City 90%', text: 'The Golden Molar Gala is being planned. Almost there.' },
  { pct: 100, title: 'Smile City Smiles', text: 'Every district is smiling. Time for the parade.' },
];
