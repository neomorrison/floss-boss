// Office layouts for the clinic diorama. PURE: no three.js, no DOM (tests import this directly).
//
// Clinic space: meters, +Y up, floor in the XZ plane centered on the origin. The back wall is at -Z,
// the storefront (door, sidewalk, name sign) at +Z, the lobby on the left (-X), the operatory wing in the
// middle and a small staff zone (dentist office, break table, lab equipment) on the right (+X).
//
//   back wall  ───────────────────────────────────────────────────────────
//   | plant  seats  fish   [ DESK ]  | op 0 | op 1 | ... | office  xray   |
//   | seats          (in) (out)     |------ corridor ------  sterilizer  |
//   | seats   table                  | op n | op n+1| ... | break table   |
//   | kids corner  coat [door] kiosk |      |       |     |               |
//   front ─────────── glass ──  ──────────────────────────────────────────
//                     sidewalk              [ SIGN ]
//
// Operatory slots are numbered back row left to right, then front row left to right. A cubicle is
// described in its local frame (yaw 0: opening toward +Z, back wall at -Z) and rotated for the front row.
import type { EquipId, OfficeTierId } from '../core/types';
import { OFFICES } from '../data/offices';
import { NavGrid, type Rect, type V2 } from './nav';

export type { Rect, V2 } from './nav';

export interface Spot { x: number; z: number; yaw: number }

export interface Piece {
  key: string;          // model key (data/assets CLINIC_MODELS) or a procedural key ('office_desk', 'rug_*')
  x: number; z: number; yaw: number;
  y: number;            // elevation (wall-mounted pieces, things on counters)
  foot: Rect | null;    // floor footprint in world space; null for wall-mounted / on-counter pieces
}

export interface OpSlotLayout {
  slot: number;
  row: 'back' | 'front';
  yaw: number;
  rect: Rect;           // cubicle floor
  center: V2;
  chair: Spot;
  bedside: V2;          // where the patient steps up into the chair
  hygienist: Spot;
  assistant: Spot;
  dentist: Spot;
  entry: V2;            // corridor point in front of the opening
  lamp: Piece; cart: Piece; counter: Piece; monitor: Piece;
  tv: Piece; whiteningLamp: Piece; intraoralCam: Piece;
}

export interface SeatLayout extends Spot {
  approach: V2;         // standing point in front of the seat
  foot: Rect;
}

export interface WallLayout { rect: Rect; height: number; kind: 'solid' | 'low' | 'glass' }

export interface ClinicLayout {
  tier: OfficeTierId;
  width: number;
  depth: number;
  wallT: number;
  floor: Rect;          // interior floor
  lot: Rect;            // everything people may walk on: interior + sidewalk
  ground: Rect;         // the diorama base (lot plus a strip of street)
  zones: { lobby: Rect; wing: Rect; staff: Rect; corridor: Rect; sidewalk: Rect; street: Rect };
  door: { x: number; z: number; width: number; inside: V2; outside: V2 };
  streetIn: V2;         // where arriving patients appear
  streetOut: V2;        // where leaving patients disappear
  desk: Piece;
  checkin: Spot;        // first place in the check-in line
  checkout: Spot;       // first place in the pay line
  queueStep: V2;        // offset between people in a line
  receptionists: Spot[];
  seats: SeatLayout[];
  ops: OpSlotLayout[];
  office: Spot;         // where an idle dentist stands
  manager: Spot;
  staffIdle: Spot[];    // unassigned staff hang out here
  equipment: Record<EquipId, Piece>;
  decor: Piece[];
  outdoor: Piece[];     // outside the building (the tooth pylon on the lawn)
  rugs: Rect[];         // floor rugs (walkable, drawn only)
  partitions: Rect[];   // half walls between operatories (also obstacles)
  walls: WallLayout[];
  sign: Spot;           // sidewalk sign with the clinic name
  deskHit: Rect;        // click target for the front desk
}

// ------------------------------------------------------------------ footprints (meters, at yaw 0: w along X, d along Z)
// Floor bases measured from the GLBs in public/models (arms and leaves may overhang a little).

export const FOOTPRINTS: Record<string, [number, number]> = {
  chair_basic: [1.2, 2.0], chair_comfort: [1.2, 2.0], chair_deluxe: [1.2, 2.0],
  op_lamp: [0.5, 0.5], op_cart: [0.6, 0.54], op_counter: [1.84, 0.66], whitening_lamp: [0.6, 0.6], intraoral_cam: [0.5, 0.5],
  reception_desk: [2.3, 0.96], waiting_chair: [0.66, 0.64], plant_tall: [0.6, 0.6], plant_small: [0.4, 0.4],
  water_cooler: [0.42, 0.42], magazine_table: [0.8, 0.8], fish_tank: [1.15, 0.48], kids_corner: [1.8, 1.8],
  espresso_machine: [0.84, 0.6], sterilizer: [0.95, 0.62], kiosk: [0.5, 0.45], ultrasonic_cart: [0.68, 0.46],
  xray_unit: [0.6, 1.0], break_table: [1.7, 1.5], trash_bin: [0.36, 0.38], coat_rack: [0.55, 0.55],
  office_desk: [1.4, 0.7], tooth_sign: [1.06, 0.64],
};

// ------------------------------------------------------------------ tier parameters

export const OP_W = 3.2;        // cubicle width
export const OP_D = 3.8;        // cubicle depth
export const CORRIDOR = 2.6;
export const WALL_T = 0.16;
export const SIDEWALK = 2.6;
export const STREET = 2.2;
export const PARTITION_T = 0.1;
export const SEAT_STEP = 0.7;

interface TierParams { nA: number; nB: number; L: number; S: number; front: number; left: number; back: number; island: number }
const TIER: Record<OfficeTierId, TierParams> = {
  t1: { nA: 2, nB: 0, L: 6.0, S: 3.0, front: 1.4, left: 4, back: 0, island: 0 },
  t2: { nA: 2, nB: 2, L: 6.4, S: 3.2, front: 0, left: 5, back: 3, island: 0 },
  t3: { nA: 3, nB: 3, L: 7.6, S: 3.4, front: 0, left: 5, back: 3, island: 4 },
  t4: { nA: 4, nB: 4, L: 8.6, S: 3.6, front: 0, left: 6, back: 4, island: 6 },
};

// ------------------------------------------------------------------ helpers

const HALF_PI = Math.PI / 2;

/** Rotate a local offset by yaw (three.js rotation.y convention: local +Z maps to (sin yaw, cos yaw)). */
function rot(lx: number, lz: number, yaw: number): V2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

function footAt(key: string, x: number, z: number, yaw: number): Rect {
  const fp = FOOTPRINTS[key] ?? [0.5, 0.5];
  const quarter = Math.round(yaw / HALF_PI);
  const swap = Math.abs(quarter) % 2 === 1;
  const w = swap ? fp[1] : fp[0];
  const d = swap ? fp[0] : fp[1];
  return { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
}

function piece(key: string, x: number, z: number, yaw = 0, onFloor = true, y = 0): Piece {
  return { key, x, z, yaw, y, foot: onFloor ? footAt(key, x, z, yaw) : null };
}

function round3(v: number): number { return Math.round(v * 1000) / 1000; }

// ------------------------------------------------------------------ builder

const cache = new Map<OfficeTierId, ClinicLayout>();

/** The office layout for a tier (the employer clinic, Bright Smiles Dental, is a t2). Cached. */
export function layoutFor(tier: OfficeTierId): ClinicLayout {
  let l = cache.get(tier);
  if (!l) { l = buildLayout(tier); cache.set(tier, l); }
  return l;
}

function buildLayout(tier: OfficeTierId): ClinicLayout {
  const P = TIER[tier];
  const nCols = Math.max(P.nA, P.nB);
  const W = round3(P.L + nCols * OP_W + P.S);
  const D = round3(P.nB > 0 ? 2 * OP_D + CORRIDOR : OP_D + CORRIDOR + P.front);
  const X0 = -W / 2, Z0 = -D / 2, X1 = W / 2, Z1 = D / 2;
  // lobby-local coordinates: u from the left wall, v from the back wall
  const at = (u: number, v: number): V2 => ({ x: X0 + u, z: Z0 + v });
  const L = P.L;
  const wingX0 = X0 + L;
  const wingX1 = wingX0 + nCols * OP_W;

  const floor: Rect = { x0: X0, z0: Z0, x1: X1, z1: Z1 };
  const sidewalk: Rect = { x0: X0 - 1.6, z0: Z1 + WALL_T, x1: X1 + 1.6, z1: Z1 + WALL_T + SIDEWALK };
  const street: Rect = { x0: sidewalk.x0, z0: sidewalk.z1, x1: sidewalk.x1, z1: sidewalk.z1 + STREET };
  const lot: Rect = { x0: sidewalk.x0, z0: Z0 - WALL_T, x1: sidewalk.x1, z1: sidewalk.z1 };
  const ground: Rect = { x0: lot.x0 - 0.4, z0: lot.z0 - 0.8, x1: lot.x1 + 0.4, z1: street.z1 };

  const decor: Piece[] = [];
  const outdoor: Piece[] = [];
  const seats: SeatLayout[] = [];
  const rugs: Rect[] = [];

  // ---------------------------------------------------------------- front desk
  const deskU = L - 2.1;
  const deskP = at(deskU, 1.4);
  const desk = piece('reception_desk', deskP.x, deskP.z, 0);
  const receptionists: Spot[] = [
    { ...at(deskU - 0.55, 0.5), yaw: 0 },
    { ...at(deskU + 0.55, 0.5), yaw: 0 },
  ];
  const checkin: Spot = { ...at(deskU - 0.6, 2.45), yaw: Math.PI };
  const checkout: Spot = { ...at(deskU + 0.65, 2.45), yaw: Math.PI };
  const queueStep: V2 = { x: 0, z: 0.72 };

  // ---------------------------------------------------------------- door and street
  const doorU = L - 2.0;
  const door = {
    x: X0 + doorU, z: Z1, width: 1.3,
    inside: at(doorU, D - 0.8), outside: { x: X0 + doorU, z: Z1 + WALL_T + 0.8 },
  };
  const laneZ = Z1 + WALL_T + SIDEWALK * 0.55;
  const streetIn: V2 = { x: sidewalk.x0 + 0.35, z: laneZ };
  const streetOut: V2 = { x: sidewalk.x0 + 0.35, z: laneZ + 0.55 };
  const sign: Spot = { x: door.x + 2.7, z: Z1 + WALL_T + 0.75, yaw: 0 };
  outdoor.push(piece('tooth_sign', X0 - 0.82, Z1 - 0.55, 0));

  // ---------------------------------------------------------------- waiting room
  const addSeat = (u: number, v: number, yaw: number) => {
    const p = at(u, v);
    const f = rot(0, 0.64, yaw);
    seats.push({ x: p.x, z: p.z, yaw, approach: { x: p.x + f.x, z: p.z + f.z }, foot: footAt('waiting_chair', p.x, p.z, yaw) });
  };
  const SEAT_IN = 0.36;           // seat center distance from its wall
  // back wall row, facing the room (+Z)
  const backStart = 1.05;
  for (let i = 0; i < P.back; i++) addSeat(backStart + i * SEAT_STEP, SEAT_IN, 0);
  const backEnd = P.back > 0 ? backStart + (P.back - 1) * SEAT_STEP + 0.33 : 0.7;
  // left wall row, facing +X
  const leftStart = 1.3;
  for (let i = 0; i < P.left; i++) addSeat(SEAT_IN, leftStart + i * SEAT_STEP, HALF_PI);
  const leftEnd = leftStart + (P.left - 1) * SEAT_STEP + 0.33;
  const leftMid = leftStart + (P.left - 1) * SEAT_STEP * 0.5;
  // island: back-to-back rows, one facing the front and one facing the back (t3, t4)
  const half = Math.ceil(P.island / 2);
  const islandU = 3.25;
  const islandV = leftMid + 0.2;
  for (let i = 0; i < P.island; i++) {
    const side = i < half ? 0 : 1;
    const k = side === 0 ? i : i - half;
    addSeat(islandU + k * SEAT_STEP, islandV + (side === 0 ? 0.33 : -0.33), side === 0 ? 0 : Math.PI);
  }
  if (P.island > 0) {
    const endU = islandU + (half - 1) * SEAT_STEP;
    decor.push(piece('plant_small', X0 + islandU - 0.58, Z0 + islandV, 0));
    decor.push(piece('plant_small', X0 + endU + 0.58, Z0 + islandV, 0));
  }
  // decor around the seats
  decor.push(piece('plant_tall', ...xz(at(0.4, 0.4)), 0));
  decor.push(piece('magazine_table', ...xz(at(1.85, leftMid)), 0));
  decor.push(piece('wall_tv', ...xz(at(0.03, leftMid)), HALF_PI, false, 1.75));
  if (P.back > 0 && P.island === 0) decor.push(piece('magazine_table', ...xz(at(backStart + (P.back - 1) * SEAT_STEP * 0.5, 1.75)), 0));
  rugs.push(rectAt(at(0.75, 0.75), at(Math.max(3.2, P.island > 0 ? islandU + half * SEAT_STEP + 0.3 : backEnd + 0.9), leftEnd + 0.25)));
  // left wall, toward the front: water cooler, espresso, fish tank, kids corner
  let v = leftEnd + 0.1;
  const wc = at(0.3, v + 0.25); v += 0.6;
  decor.push(piece('water_cooler', wc.x, wc.z, HALF_PI));
  const esp = at(0.32, v + 0.45); v += 1.0;
  const espresso = piece('espresso_machine', esp.x, esp.z, HALF_PI);
  let fishTank: Piece;
  if (P.back === 0) fishTank = piece('fish_tank', ...xz(at(1.45, 0.3)), 0);
  else { const ft = at(0.3, v + 0.62); v += 1.3; fishTank = piece('fish_tank', ft.x, ft.z, HALF_PI); }
  // near the door
  decor.push(piece('coat_rack', ...xz(at(doorU - 1.1, D - 0.4)), 0));
  decor.push(piece('plant_tall', ...xz(at(L - 0.36, D - 0.36)), 0));
  decor.push(piece('trash_bin', ...xz(at(L - 0.32, D - 1.2)), 0));
  if (tier !== 't1') decor.push(piece('plant_small', ...xz(at(L - 0.3, 2.6)), 0));

  // ---------------------------------------------------------------- operatories
  // Cubicle (local, yaw 0): back wall at -Z, opening at +Z. The counter runs along the -X partition, the
  // chair sits near the back wall, the hygienist works from the +X side under the lamp, the assistant
  // squeezes in between counter and chair, and the patient climbs in from the foot of the chair.
  const ops: OpSlotLayout[] = [];
  const partitions: Rect[] = [];
  const addRow = (count: number, row: 'back' | 'front', slot0: number) => {
    const yaw = row === 'back' ? 0 : Math.PI;
    const cz = row === 'back' ? Z0 + OP_D / 2 : Z1 - OP_D / 2;
    for (let i = 0; i < count; i++) {
      const cx = wingX0 + (i + 0.5) * OP_W;
      const L2W = (lx: number, lz: number): V2 => { const r = rot(lx, lz, yaw); return { x: cx + r.x, z: cz + r.z }; };
      const S = (lx: number, lz: number, lyaw: number): Spot => ({ ...L2W(lx, lz), yaw: lyaw + yaw });
      const Pc = (key: string, lx: number, lz: number, lyaw = 0, onFloor = true, y = 0): Piece => {
        const p = L2W(lx, lz);
        return piece(key, p.x, p.z, lyaw + yaw, onFloor, y);
      };
      ops.push({
        slot: slot0 + i, row, yaw,
        rect: { x0: cx - OP_W / 2, x1: cx + OP_W / 2, z0: cz - OP_D / 2, z1: cz + OP_D / 2 },
        center: { x: cx, z: cz },
        chair: S(0.2, -0.82, 0),
        bedside: L2W(0.2, 0.62),
        hygienist: S(1.1, -0.95, -HALF_PI - 0.45),
        assistant: S(-0.64, -1.15, HALF_PI + 0.25),
        dentist: S(1.08, 0.5, -HALF_PI - 0.55),
        entry: L2W(0, OP_D / 2 + 0.7),
        counter: Pc('op_counter', -1.2, -0.72, HALF_PI),
        lamp: Pc('op_lamp', 1.15, -1.55, Math.PI),
        cart: Pc('op_cart', -1.2, 0.62, HALF_PI),
        monitor: Pc('op_monitor', -1.2, 0.62, HALF_PI, false),
        intraoralCam: Pc('intraoral_cam', -1.22, 1.35, HALF_PI),
        whiteningLamp: Pc('whitening_lamp', 1.18, 1.35, Math.PI),
        tv: Pc('op_tv', -0.95, 0.9, 2.67, false),
      });
    }
    // half walls: one at every cubicle boundary, from the row's wall to just short of the opening
    const zA = row === 'back' ? Z0 : Z1 - OP_D + 0.35;
    const zB = row === 'back' ? Z0 + OP_D - 0.35 : Z1;
    for (let i = 0; i <= count; i++) {
      const x = wingX0 + i * OP_W;
      partitions.push({ x0: x - PARTITION_T / 2, x1: x + PARTITION_T / 2, z0: zA, z1: zB });
    }
  };
  addRow(P.nA, 'back', 0);
  if (P.nB > 0) addRow(P.nB, 'front', P.nA);

  // wing front strip (t1 has no front row): decor along the storefront
  if (P.nB === 0) {
    const fz = Z1 - 0.45;
    decor.push(piece('plant_tall', wingX0 + 0.5, fz, 0));
    decor.push(piece('water_cooler', wingX0 + 1.35, fz + 0.1, 0));
    decor.push(piece('plant_small', wingX1 - 0.4, fz + 0.1, 0));
  }

  // ---------------------------------------------------------------- staff zone (office, lab, break area)
  const S = P.S;
  const sx = (a: number) => wingX1 + a;
  const sz = (vv: number) => Z0 + vv;
  decor.push(piece('office_desk', sx(S - 1.25), sz(1.2), 0));
  decor.push(piece('certificate', sx(S - 1.25), Z0 + 0.04, 0, false, 1.55));
  decor.push(piece('plant_small', sx(S - 0.3), sz(0.3), 0));
  const office: Spot = { x: sx(S - 1.25), z: sz(0.48), yaw: 0 };
  const manager: Spot = { x: sx(0.6), z: sz(2.3), yaw: HALF_PI };
  const corrV0 = OP_D, corrV1 = OP_D + CORRIDOR;
  const breakV = D - 1.3;
  const staffIdle: Spot[] = [
    { x: sx(S / 2 - 1.12), z: sz(breakV), yaw: HALF_PI },
    { x: sx(S / 2 + 1.12), z: sz(breakV), yaw: -HALF_PI },
    { x: sx(S / 2), z: sz(breakV - 1.2), yaw: 0 },
    { x: sx(S / 2 - 0.66), z: sz(breakV - 1.15), yaw: 0.5 },
    { x: sx(S / 2 + 0.66), z: sz(breakV - 1.15), yaw: -0.5 },
  ];

  // ---------------------------------------------------------------- equipment spots
  const equipment: Record<EquipId, Piece> = {
    deepCert: piece('certificate', X0 + deskU + 1.7, Z0 + 0.04, 0, false, 1.5),
    fishTank,
    espresso,
    kidsCorner: piece('kids_corner', ...xz(at(1.05, D - 1.05)), 0),
    onlineBooking: piece('kiosk', ...xz(at(doorU + 1.0, D - 0.4)), Math.PI),
    // small offices keep the lab gear along the storefront; bigger ones in the staff zone
    xray: P.nB === 0 ? piece('xray_unit', wingX0 + 5.0, Z1 - 0.6, Math.PI) : piece('xray_unit', sx(S - 0.55), sz(2.45), -HALF_PI),
    sterilizer: P.nB === 0 ? piece('sterilizer', wingX0 + 2.55, Z1 - 0.34, Math.PI) : piece('sterilizer', sx(S - 0.33), sz(corrV0 + 0.75), -HALF_PI),
    ultrasonicKits: P.nB === 0 ? piece('ultrasonic_cart', wingX0 + 3.7, Z1 - 0.26, Math.PI) : piece('ultrasonic_cart', sx(S - 0.26), sz(corrV0 + 1.75), -HALF_PI),
    breakRoom: piece('break_table', sx(S / 2), sz(breakV), 0),
  };

  // ---------------------------------------------------------------- walls
  const T = WALL_T;
  const walls: WallLayout[] = [
    { rect: { x0: X0 - T, z0: Z0 - T, x1: X1 + T, z1: Z0 }, height: 2.7, kind: 'solid' },
    { rect: { x0: X0 - T, z0: Z0, x1: X0, z1: Z1 + T }, height: 2.7, kind: 'solid' },
    { rect: { x0: X1, z0: Z0, x1: X1 + T, z1: Z1 + T }, height: 0.62, kind: 'low' },
    { rect: { x0: X0, z0: Z1, x1: door.x - door.width / 2 - 0.06, z1: Z1 + T }, height: 2.45, kind: 'glass' },
    { rect: { x0: door.x + door.width / 2 + 0.06, z0: Z1, x1: wingX0, z1: Z1 + T }, height: 2.45, kind: 'glass' },
    { rect: { x0: wingX0, z0: Z1, x1: X1, z1: Z1 + T }, height: 0.62, kind: 'low' },
  ];

  const zones = {
    lobby: { x0: X0, z0: Z0, x1: wingX0, z1: Z1 },
    wing: { x0: wingX0, z0: Z0, x1: wingX1, z1: Z1 },
    staff: { x0: wingX1, z0: Z0, x1: X1, z1: Z1 },
    corridor: { x0: wingX0, z0: Z0 + corrV0, x1: X1, z1: Z0 + corrV1 },
    sidewalk, street,
  };

  const deskFoot = desk.foot!;
  return {
    tier, width: W, depth: D, wallT: T, floor, lot, ground, zones, door, streetIn, streetOut,
    desk, checkin, checkout, queueStep, receptionists, seats, ops, office, manager, staffIdle,
    equipment, decor, outdoor, rugs, partitions, walls, sign,
    deskHit: { x0: deskFoot.x0 - 0.1, z0: deskFoot.z0 - 0.5, x1: deskFoot.x1 + 0.1, z1: deskFoot.z1 + 0.25 },
  };
}

function rectAt(a: V2, b: V2): Rect {
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
}

function xz(p: V2): [number, number] { return [p.x, p.z]; }

// ------------------------------------------------------------------ obstacles and navigation

/** Every floor footprint that people must walk around (furniture, equipment spots, seats, partitions). */
export function furnitureRects(l: ClinicLayout): { rect: Rect; what: string }[] {
  const out: { rect: Rect; what: string }[] = [];
  const add = (p: Piece, what: string) => { if (p.foot) out.push({ rect: p.foot, what }); };
  add(l.desk, 'desk');
  for (const s of l.seats) out.push({ rect: s.foot, what: 'seat' });
  for (const d of l.decor) add(d, d.key);
  for (const k of Object.keys(l.equipment) as EquipId[]) add(l.equipment[k], 'equip:' + k);
  for (const o of l.ops) {
    out.push({ rect: footAt('chair_basic', o.chair.x, o.chair.z, o.chair.yaw), what: `op${o.slot}:chair` });
    add(o.counter, `op${o.slot}:counter`);
    add(o.lamp, `op${o.slot}:lamp`);
    add(o.cart, `op${o.slot}:cart`);
    add(o.whiteningLamp, `op${o.slot}:whitening`);
    add(o.intraoralCam, `op${o.slot}:cam`);
    add(o.tv, `op${o.slot}:tv`);
  }
  for (const p of l.partitions) out.push({ rect: p, what: 'partition' });
  return out;
}

/** Wall rectangles minus the door opening. */
export function wallRects(l: ClinicLayout): Rect[] { return l.walls.map((w) => w.rect); }

export const WALK_RADIUS = 0.27;
const navCache = new Map<OfficeTierId, NavGrid>();

/** The walk grid for a layout (cached per tier). */
export function navFor(l: ClinicLayout): NavGrid {
  let g = navCache.get(l.tier);
  if (!g) {
    const obstacles = [...furnitureRects(l).map((f) => f.rect), ...wallRects(l), ...l.outdoor.flatMap((p) => (p.foot ? [p.foot] : []))];
    g = new NavGrid(l.lot, [l.lot], obstacles, WALK_RADIUS, 0.1);
    navCache.set(l.tier, g);
  }
  return g;
}

const routeCache = new Map<string, V2[]>();
const q5 = (v: number) => Math.round(v * 20);
/**
 * A walk route between two floor points (both included), or a straight line if none exists.
 * Routes between the usual stops repeat all day, so they are cached (read-only arrays).
 */
export function route(l: ClinicLayout, a: V2, b: V2): V2[] {
  const key = `${l.tier}|${q5(a.x)},${q5(a.z)}|${q5(b.x)},${q5(b.z)}`;
  let r = routeCache.get(key);
  if (!r) {
    r = navFor(l).route(a, b) ?? [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
    if (routeCache.size > 600) routeCache.clear();
    routeCache.set(key, r);
  }
  return r;
}

/** Named anchor points of the patient and staff flow (used by tests and the harness). */
export function anchors(l: ClinicLayout): Record<string, V2> {
  const a: Record<string, V2> = {
    streetIn: l.streetIn, streetOut: l.streetOut, doorOut: l.door.outside, doorIn: l.door.inside,
    checkin: l.checkin, checkout: l.checkout, office: l.office, manager: l.manager,
  };
  l.receptionists.forEach((r, i) => { a['recep' + i] = r; });
  l.seats.forEach((s, i) => { a['seat' + i] = s.approach; });
  l.ops.forEach((o) => {
    a[`bed${o.slot}`] = o.bedside; a[`hyg${o.slot}`] = o.hygienist;
    a[`asst${o.slot}`] = o.assistant; a[`dent${o.slot}`] = o.dentist;
  });
  l.staffIdle.forEach((s, i) => { a['idle' + i] = s; });
  return a;
}

/** Tier op-slot and seat counts the layout must provide (data/offices). */
export function requiredCounts(tier: OfficeTierId): { ops: number; seats: number } {
  return { ops: OFFICES[tier].opSlots, seats: OFFICES[tier].seats };
}
