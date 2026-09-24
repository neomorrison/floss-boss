// Hygienist tools the player buys and carries. DESIGN 4.4. The sim may retune prices and stats (never ids or keys).
import type { ExtraId, ToolSlot } from '../core/types';

export interface ToolTier {
  slot: ToolSlot;
  tier: number;
  name: string;
  price: number;
  model: string;        // model key (public/models/<model>.glb)
  blurb: string;
  // stats (unused ones are 0)
  tartar: number;       // damage multiplier
  plaque: number;
  stain: number;
  polish: number;
  radius: number;       // brush radius multiplier
  gumRisk: number;
  water: number;        // water added per second while in use
  timeBased: boolean;   // true: acts while touching (ultrasonic, polisher, suction); false: acts on stroke distance
  drain: number;        // suction: water drained per second
  bits: number;         // suction: loose-bit pickup multiplier
  floss: number;        // floss power (debris hp per swipe)
}

const base = { tartar: 0, plaque: 0, stain: 0, polish: 0, radius: 1, gumRisk: 0, water: 0, timeBased: false, drain: 0, bits: 0, floss: 0 };

export const TOOLS: Record<ToolSlot, ToolTier[]> = {
  scaler: [
    { ...base, slot: 'scaler', tier: 1, name: 'Sickle Scaler', price: 0, model: 'tool_scaler', blurb: 'Hand scaler. Scrape to crack tartar loose.', tartar: 1.0, plaque: 0.8, radius: 1.0, gumRisk: 1.0 },
    { ...base, slot: 'scaler', tier: 2, name: 'Gracey Curette', price: 300, model: 'tool_curette', blurb: 'Sharper edge, gentler on gums.', tartar: 1.4, plaque: 0.9, radius: 1.1, gumRisk: 0.9 },
    { ...base, slot: 'scaler', tier: 3, name: 'Titanium Scaler', price: 1100, model: 'tool_titanium', blurb: 'Light, stiff and fast.', tartar: 1.9, plaque: 1.0, radius: 1.15, gumRisk: 0.75 },
    { ...base, slot: 'scaler', tier: 4, name: 'Ultrasonic Scaler', price: 2400, model: 'tool_ultrasonic', blurb: 'Vibrates tartar off. Hold it on a deposit. Adds water.', tartar: 3.2, plaque: 1.6, radius: 1.2, gumRisk: 0.7, water: 0.05, timeBased: true },
    { ...base, slot: 'scaler', tier: 5, name: 'Piezo Pro', price: 7000, model: 'tool_piezo', blurb: 'The top ultrasonic. Less spray, more power.', tartar: 4.6, plaque: 2.0, radius: 1.3, gumRisk: 0.55, water: 0.03, timeBased: true },
  ],
  polisher: [
    { ...base, slot: 'polisher', tier: 1, name: 'Prophy Angle', price: 0, model: 'tool_polisher', blurb: 'Spinning cup with paste. Lifts plaque and stains, then shines.', plaque: 2.2, stain: 1.3, polish: 1.4, radius: 1.0, timeBased: true },
    { ...base, slot: 'polisher', tier: 2, name: 'Cordless Polisher', price: 550, model: 'tool_cordless', blurb: 'Bigger cup, faster spin.', plaque: 2.6, stain: 1.8, polish: 1.8, radius: 1.25, timeBased: true },
    { ...base, slot: 'polisher', tier: 3, name: 'Air Polisher', price: 3800, model: 'tool_airpolisher', blurb: 'Powder jet. Blasts stains in a wide spray. Adds water.', plaque: 3.2, stain: 3.6, polish: 1.2, radius: 1.7, water: 0.04, timeBased: true },
  ],
  floss: [
    { ...base, slot: 'floss', tier: 1, name: 'String Floss', price: 0, model: 'tool_floss', blurb: 'Swipe across a gap to pop food out.', floss: 1.0 },
    { ...base, slot: 'floss', tier: 2, name: 'Floss Picks', price: 150, model: 'tool_flosspick', blurb: 'Stiffer. Fewer swipes per bit.', floss: 1.8 },
    { ...base, slot: 'floss', tier: 3, name: 'Water Flosser', price: 1700, model: 'tool_waterflosser', blurb: 'Point and hold at a gap. Adds water.', floss: 3.0, water: 0.04, timeBased: true },
  ],
  suction: [
    { ...base, slot: 'suction', tier: 1, name: 'Saliva Ejector', price: 0, model: 'tool_suction', blurb: 'Hold to drain water and pick up loose bits.', drain: 0.25, bits: 1.0, timeBased: true },
    { ...base, slot: 'suction', tier: 2, name: 'High-Volume Evacuator', price: 850, model: 'tool_hve', blurb: 'Much stronger suction, wider tip.', drain: 0.7, bits: 2.5, radius: 1.6, timeBased: true },
  ],
  rinse: [
    { ...base, slot: 'rinse', tier: 1, name: 'Air-Water Syringe', price: 0, model: 'tool_syringe', blurb: 'Hold to rinse loose bits into the water.', water: 0.12, timeBased: true },
  ],
};

export const TOOL_SLOTS: ToolSlot[] = ['scaler', 'polisher', 'floss', 'suction', 'rinse'];
export const TOOL_SLOT_NAMES: Record<ToolSlot, string> = { scaler: 'Scaler', polisher: 'Polisher', floss: 'Floss', suction: 'Suction', rinse: 'Rinse' };

export function toolTier(slot: ToolSlot, tier: number): ToolTier {
  const list = TOOLS[slot];
  return list[Math.max(0, Math.min(list.length - 1, tier - 1))];
}

export interface Extra { id: ExtraId; name: string; price: number; blurb: string; model: string }
export const EXTRAS: Extra[] = [
  { id: 'headlamp', name: 'LED Headlamp', price: 400, blurb: 'Brighter light. Plaque is easier to spot.', model: 'extra_headlamp' },
  { id: 'disclosing', name: 'Disclosing Solution', price: 250, blurb: 'Dyes plaque bright magenta. Toggle in the clean.', model: 'extra_disclosing' },
  { id: 'headphones', name: 'Patient Headphones', price: 500, blurb: 'Patients relax. Comfort drains 25% slower.', model: 'extra_headphones' },
  { id: 'loupes', name: 'Magnifying Loupes', price: 800, blurb: 'Closer zoom. Dirt outlines under the tool.', model: 'extra_loupes' },
];

export const NUMBING_GEL_PRICE = 15;
