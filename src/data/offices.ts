// Office tiers. DESIGN 8.6. Positions of furniture live in src/clinic/layout.ts (view only);
// the sim only needs slot and seat counts.
import type { OfficeTierId } from '../core/types';

export interface OfficeTier {
  id: OfficeTierId;
  name: string;
  blurb: string;
  opSlots: number;
  seats: number;
  rent: number;         // per working day
  price: number;
  baseDemand: number;   // patients per day at full awareness and a 3.5 rating
  appeal: number;
  tierScale: number;    // marketing cost scale
  candidateQuality: number;  // added to candidate stat mean
}

export const OFFICES: Record<OfficeTierId, OfficeTier> = {
  t1: { id: 't1', name: 'Strip Mall Suite', blurb: 'Two chairs between a nail salon and a vape shop.', opSlots: 2, seats: 4, rent: 180, price: 5000, baseDemand: 15, appeal: 1.0, tierScale: 1, candidateQuality: 0 },
  t2: { id: 't2', name: 'Main Street Office', blurb: 'Four operatories, a real waiting room, a sign out front.', opSlots: 4, seats: 8, rent: 700, price: 28000, baseDemand: 28, appeal: 1.25, tierScale: 1.8, candidateQuality: 5 },
  t3: { id: 't3', name: 'Medical Plaza', blurb: 'Six operatories in a glass building with valet parking.', opSlots: 6, seats: 12, rent: 1800, price: 120000, baseDemand: 36, appeal: 1.5, tierScale: 3, candidateQuality: 10 },
  t4: { id: 't4', name: 'Smile Tower', blurb: 'The flagship. Eight operatories and a view.', opSlots: 8, seats: 16, rent: 3600, price: 400000, baseDemand: 50, appeal: 1.8, tierScale: 5, candidateQuality: 15 },
};

export const TIER_ORDER: OfficeTierId[] = ['t1', 't2', 't3', 't4'];

export const MARKETING_LEVELS = [
  { level: 0, name: 'None', mult: 1, cost: 0 },
  { level: 1, name: 'Flyers', mult: 1.2, cost: 60 },
  { level: 2, name: 'Local ads', mult: 1.45, cost: 180 },
  { level: 3, name: 'Billboards', mult: 1.75, cost: 420 },
] as const;
