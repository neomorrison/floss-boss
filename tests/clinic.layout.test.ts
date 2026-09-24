import { describe, expect, it } from 'vitest';
import { anchors, furnitureRects, layoutFor, navFor, requiredCounts, wallRects, type ClinicLayout } from '../src/clinic/layout';
import { rectContains, rectsOverlap, type Rect, type V2 } from '../src/clinic/nav';
import { TIER_ORDER } from '../src/data/offices';
import { EQUIP_ORDER } from '../src/data/upgrades';
import type { OfficeTierId } from '../src/core/types';

const EPS = 1e-6;

function inside(r: Rect, p: V2): boolean { return rectContains(r, p.x, p.z, EPS); }

/** Sample a polyline every 5 cm. */
function samples(path: V2[]): V2[] {
  const out: V2[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * (k / n), z: a.z + (b.z - a.z) * (k / n) });
  }
  return out;
}

function blockedBy(l: ClinicLayout, p: V2): string | null {
  for (const f of furnitureRects(l)) if (rectContains(f.rect, p.x, p.z, -EPS)) return f.what;
  for (const w of wallRects(l)) if (rectContains(w, p.x, p.z, -EPS)) return 'wall';
  return null;
}

function checkRoute(l: ClinicLayout, from: string, to: string, a: Record<string, V2>) {
  const path = navFor(l).route(a[from], a[to]);
  expect(path, `${l.tier} route ${from} -> ${to}`).not.toBeNull();
  for (const p of path!) {
    expect(inside(l.lot, p), `${l.tier} ${from}->${to} point in lot`).toBe(true);
    if (p.z < l.floor.z1 - 0.3) expect(inside(l.floor, p), `${l.tier} ${from}->${to} point in floor`).toBe(true);
  }
  for (const s of samples(path!)) {
    const hit = blockedBy(l, s);
    expect(hit, `${l.tier} ${from}->${to} crosses ${hit} at (${s.x.toFixed(2)}, ${s.z.toFixed(2)})`).toBeNull();
  }
}

describe.each(TIER_ORDER as OfficeTierId[])('clinic layout %s', (tier) => {
  const l = layoutFor(tier);
  const a = anchors(l);

  it('has enough operatory slots and waiting seats', () => {
    const need = requiredCounts(tier);
    expect(l.ops.length).toBeGreaterThanOrEqual(need.ops);
    expect(l.seats.length).toBeGreaterThanOrEqual(need.seats);
    expect(l.ops.map((o) => o.slot)).toEqual(l.ops.map((_, i) => i));
    expect(l.receptionists.length).toBeGreaterThanOrEqual(1);
    expect(l.staffIdle.length).toBeGreaterThanOrEqual(3);
  });

  it('has a spot for every piece of equipment', () => {
    for (const id of EQUIP_ORDER) expect(l.equipment[id], id).toBeDefined();
  });

  it('has an op-upgrade spot for the ergonomic stool and the laughing gas tank in every operatory, inside the building', () => {
    for (const o of l.ops) {
      for (const key of ['ergoStool', 'nitrous'] as const) {
        const p = o[key];
        expect(Number.isFinite(p.x) && Number.isFinite(p.z), `op${o.slot} ${key} position`).toBe(true);
        expect(inside(l.floor, p), `op${o.slot} ${key} on floor`).toBe(true);
      }
      // beside the chair and behind the headrest are two different spots, not aliases of each other
      expect(o.ergoStool.x !== o.nitrous.x || o.ergoStool.z !== o.nitrous.z, `op${o.slot} ergoStool/nitrous distinct`).toBe(true);
    }
  });

  it('keeps every footprint on the floor', () => {
    for (const f of furnitureRects(l)) {
      expect(f.rect.x0 >= l.floor.x0 - EPS && f.rect.x1 <= l.floor.x1 + EPS && f.rect.z0 >= l.floor.z0 - EPS && f.rect.z1 <= l.floor.z1 + EPS, `${f.what} on floor`).toBe(true);
    }
  });

  it('has no overlapping footprints', () => {
    const f = furnitureRects(l).filter((x) => x.what !== 'partition');
    for (let i = 0; i < f.length; i++) {
      for (let j = i + 1; j < f.length; j++) {
        expect(rectsOverlap(f[i].rect, f[j].rect, -EPS), `${f[i].what} overlaps ${f[j].what}`).toBe(false);
      }
    }
    // partitions only touch the cubicles they divide, never furniture
    const parts = furnitureRects(l).filter((x) => x.what === 'partition');
    for (const p of parts) for (const q of f) expect(rectsOverlap(p.rect, q.rect, -EPS), `partition overlaps ${q.what}`).toBe(false);
  });

  it('keeps standing spots clear of furniture', () => {
    for (const [name, p] of Object.entries(a)) {
      if (name.startsWith('street') || name === 'doorOut') { expect(inside(l.lot, p), name).toBe(true); continue; }
      expect(inside(l.floor, p), `${name} on floor`).toBe(true);
      expect(blockedBy(l, p), `${name} blocked`).toBeNull();
    }
    for (let k = 0; k < 4; k++) {
      for (const q of [l.checkin, l.checkout]) {
        const p = { x: q.x + l.queueStep.x * k, z: q.z + l.queueStep.z * k };
        expect(blockedBy(l, p), `queue ${k}`).toBeNull();
      }
    }
  });

  it('routes the patient flow through open floor: door, desk, seat, operatory, desk, door', () => {
    checkRoute(l, 'streetIn', 'doorOut', a);
    checkRoute(l, 'doorOut', 'checkin', a);
    checkRoute(l, 'streetIn', 'checkin', a);
    l.seats.forEach((_, i) => {
      checkRoute(l, 'checkin', 'seat' + i, a);
      checkRoute(l, 'seat' + i, 'streetOut', a);   // walkout from the waiting room
    });
    for (const o of l.ops) {
      for (let i = 0; i < l.seats.length; i += 3) checkRoute(l, 'seat' + i, 'bed' + o.slot, a);
      checkRoute(l, 'bed' + o.slot, 'checkout', a);
      checkRoute(l, 'bed' + o.slot, 'streetOut', a);  // walkout from the chair
    }
    checkRoute(l, 'checkout', 'streetOut', a);
  });

  it('routes staff to their spots', () => {
    for (const o of l.ops) {
      checkRoute(l, 'idle0', 'hyg' + o.slot, a);
      checkRoute(l, 'idle0', 'asst' + o.slot, a);
      checkRoute(l, 'office', 'dent' + o.slot, a);
    }
    l.receptionists.forEach((_, i) => checkRoute(l, 'idle0', 'recep' + i, a));
    checkRoute(l, 'idle0', 'manager', a);
  });
});
