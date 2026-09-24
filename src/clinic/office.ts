// The static part of the diorama: the building shell, floors, street, furniture, operatories and
// equipment. Rebuilt when the office tier or name changes; operatories and equipment are re-synced when
// the clinic buys something (new pieces pop in).
import * as THREE from 'three';
import type { Clinic, ClinicModifier, EquipId, Operatory, OpUpgradeId } from '../core/types';
import { CHAIRS, EQUIPMENT, OP_UPGRADES } from '../data/upgrades';
import { OFFICES } from '../data/offices';
import type { ClinicLayout, OpSlotLayout, Piece, Rect, V2 } from './layout';
import {
  C, mat, glassMat, hitMat, tileTexture, woodTexture, concreteTexture, streetTexture, outlineTexture,
  numberTexture, signTexture, roundRect,
} from './palette';
import { box, cyl, ball, makeProp, doorLeaf, loadedModel } from './props';
import { batchStatic } from './batch';

export interface HitInfo { kind: 'op' | 'slot' | 'desk' | 'patient' | 'staff'; id: string; slot?: number }

interface Popper { obj: THREE.Object3D; t: number; base: number }

function rectW(r: Rect) { return r.x1 - r.x0; }
function rectD(r: Rect) { return r.z1 - r.z0; }
function rectCX(r: Rect) { return (r.x0 + r.x1) / 2; }
function rectCZ(r: Rect) { return (r.z0 + r.z1) / 2; }

/** A floor plane over a rect with world-space UVs (tile meters per texture repeat). */
function floorPlane(r: Rect, tex: THREE.Texture | null, tile: number, y: number, color = '#FFFFFF', rough = 0.85): THREE.Mesh {
  const w = rectW(r), d = rectD(r);
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position'); const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + rectCX(r)) / tile, -(pos.getZ(i) + rectCZ(r)) / tile);
  const m = tex ? floorMat(tex, color, rough) : mat(color, rough);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(rectCX(r), y, rectCZ(r));
  mesh.receiveShadow = true;
  mesh.userData.ownGeo = true;
  return mesh;
}
const floorMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function floorMat(tex: THREE.Texture, color: string, rough: number): THREE.MeshStandardMaterial {
  let m = floorMats.get(tex);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough }); floorMats.set(tex, m); }
  return m;
}

let opMatTex: THREE.Texture | null = null;
function opMatTexture(): THREE.Texture {
  if (!opMatTex) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#E4F7F1'; roundRect(g, 6, 6, 244, 244, 26); g.fill();
    g.strokeStyle = '#A9E3D5'; g.lineWidth = 6; roundRect(g, 10, 10, 236, 236, 24); g.stroke();
    opMatTex = new THREE.CanvasTexture(c); opMatTex.colorSpace = THREE.SRGBColorSpace;
  }
  return opMatTex;
}
let rugTex: THREE.Texture | null = null;
function rugTexture(): THREE.Texture {
  if (!rugTex) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#FFE7B0'; roundRect(g, 4, 4, 248, 248, 40); g.fill();
    g.strokeStyle = '#FFC857'; g.lineWidth = 10; roundRect(g, 18, 18, 220, 220, 30); g.stroke();
    g.fillStyle = 'rgba(255,122,168,0.35)';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(56 + i * 48, 56 + j * 48, 8, 0, Math.PI * 2); g.fill(); }
    rugTex = new THREE.CanvasTexture(c); rugTex.colorSpace = THREE.SRGBColorSpace;
  }
  return rugTex;
}
const decalMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();
function decal(tex: THREE.Texture, w: number, d: number, x: number, y: number, z: number, opacity = 1): THREE.Mesh {
  let m = decalMats.get(tex);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false, opacity }); decalMats.set(tex, m); }
  const geo = new THREE.PlaneGeometry(w, d); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.userData.ownGeo = true;
  return mesh;
}

function place(o: THREE.Object3D, x: number, z: number, yaw: number, y = 0): THREE.Object3D {
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  return o;
}
function propAt(p: Piece): THREE.Object3D {
  return place(makeProp(p.key, p.y), p.x, p.z, p.yaw);
}

function proxyBox(r: Rect, h: number, info: HitInfo): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(rectW(r), h, rectD(r)), hitMat());
  m.position.set(rectCX(r), h / 2, rectCZ(r));
  m.userData.hit = info;
  m.userData.ownGeo = true;
  return m;
}

function disposeOwned(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData.ownGeo) m.geometry.dispose();
  });
}

/** The OpSlotLayout fields that hold a Piece (as opposed to a Spot, a Rect or a plain number). */
type PieceKeyOf<T> = { [K in keyof T]: T[K] extends Piece ? K : never }[keyof T];

/** Which OpSlotLayout field holds each op upgrade's spot (DESIGN 10.5: ergoStool, nitrous joined tv,
 * whiteningLamp, intraoralCam this round). */
const OP_UPGRADE_PIECE: Record<OpUpgradeId, PieceKeyOf<OpSlotLayout>> = {
  tv: 'tv', whiteningLamp: 'whiteningLamp', intraoralCam: 'intraoralCam', ergoStool: 'ergoStool', nitrous: 'nitrous',
};

/** A small traffic cone and a taped-off strip: the "this operatory is closed" marker for an event's
 * closedOpId (DESIGN 10.2, e.g. a burst pipe). Built from shared primitives, no model key needed. */
function closedMarker(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(cyl(0.02, 0.1, 0.3, mat('#FF7A3D', 0.55), 0, 0, 0, 12));
  g.add(cyl(0.12, 0.12, 0.03, mat('#FF7A3D', 0.55), 0, 0, 0, 12));
  g.add(box(0.09, 0.05, 0.02, mat(C.white, 0.5), 0, 0.16, 0, 0.01));
  g.add(box(0.6, 0.05, 0.015, mat(C.sunshine, 0.4), 0, 0.42, 0, 0.01));
  return g;
}

// ------------------------------------------------------------------ event and campaign props (DESIGN 10.2)
// Clinic.modifiers ids follow '<source>:<key>:<n>' (DESIGN 10, shared convention); the middle segment
// picks the diorama prop, when one fits. Several event/campaign keys can map to the same prop (a rival
// sign never doubles up just because the modifier renewed), so callers dedupe by prop key.
function propKeyForModifier(m: ClinicModifier): string | null {
  const key = m.id.split(':')[1] ?? '';
  switch (key) {
    case 'puppy': return 'prop_puppy';
    case 'pirateDay': case 'pirateFestival': return 'prop_jolly_roger';
    case 'rival': return 'prop_rival_sign';
    case 'news': return 'prop_camera_crew';
    case 'outage': return 'prop_generator';
    case 'mystery': case 'celebrity': return 'prop_red_carpet';
    default: return m.source === 'campaign' ? 'prop_balloons' : null;
  }
}

/** Where a modifier prop stands and which way it faces. Puppy has no fixed spot: it wanders (Office.update). */
function propSpotFor(key: string, l: ClinicLayout): { x: number; z: number; yaw: number } | null {
  switch (key) {
    case 'prop_balloons': return { x: l.desk.x - 1.1, z: l.desk.z + 0.3, yaw: 0 };
    case 'prop_jolly_roger': return { x: l.sign.x - 0.7, z: l.sign.z - 0.5, yaw: 0.3 };
    case 'prop_rival_sign': return { x: l.zones.street.x1 - 1.6, z: l.zones.street.z1 - 0.3, yaw: Math.PI };
    case 'prop_camera_crew': return { x: l.zones.sidewalk.x0 + 1.6, z: (l.zones.sidewalk.z0 + l.zones.sidewalk.z1) / 2, yaw: 0.4 };
    case 'prop_generator': return { x: l.floor.x1 + 0.9, z: l.floor.z0 + 1.4, yaw: Math.PI / 2 };
    case 'prop_red_carpet': return { x: l.door.x, z: (l.door.inside.z + l.door.outside.z) / 2, yaw: 0 };
    default: return null;
  }
}

export class Office {
  readonly group = new THREE.Group();
  readonly proxies: THREE.Object3D[] = [];
  private env = new THREE.Group();
  private ops = new THREE.Group();
  private equip = new THREE.Group();
  private modProps = new THREE.Group();
  private modKey = '';
  private puppy: THREE.Object3D | null = null;
  private puppyBase: V2 = { x: 0, z: 0 };
  private puppyRadius = 1;
  private selection: THREE.Mesh;
  private doorPivot: THREE.Object3D | null = null;
  private doorRest = 0;
  private doorT = 0;
  private doorOpenUntil = -1;
  private signTex: THREE.CanvasTexture | null = null;
  private envTier = '';
  private envName = '';
  private opsKey = -1;
  private had = new Set<string>();
  private poppers: Popper[] = [];
  private opProxies: THREE.Object3D[] = [];
  private envProxies: THREE.Object3D[] = [];
  layout: ClinicLayout | null = null;
  private sign: THREE.Object3D | null = null;
  private signTurn = 0;

  /** Turn the sidewalk sign toward the camera (portrait screens look at the office from the side). */
  setSignTurn(yaw: number): void {
    this.signTurn = yaw;
    if (this.sign && this.layout) this.sign.rotation.y = this.layout.sign.yaw + yaw;
  }

  constructor() {
    this.group.add(this.env, this.ops, this.equip, this.modProps);
    const selGeo = new THREE.PlaneGeometry(1, 1); selGeo.rotateX(-Math.PI / 2);
    this.selection = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({ map: outlineTexture(C.bubblegum, false), transparent: true, depthWrite: false }));
    this.selection.visible = false;
    this.selection.renderOrder = 2;
    this.group.add(this.selection);
  }

  /** Rebuild what changed. Returns true when the building itself was rebuilt. */
  sync(l: ClinicLayout, c: Clinic, force = false): boolean {
    let rebuilt = false;
    if (force || l.tier !== this.envTier || c.name !== this.envName || l !== this.layout) {
      this.buildEnv(l, c);
      this.envTier = l.tier; this.envName = c.name; this.layout = l;
      this.opsKey = -1;
      this.had.clear();
      rebuilt = true;
    }
    const ok = opsSignature(c);
    if (force || ok !== this.opsKey) {
      const first = this.opsKey === -1;
      this.buildOps(l, c, !first && !rebuilt);
      this.opsKey = ok;
    }
    this.syncModifiers(l, c, rebuilt);
    return rebuilt;
  }

  // ---------------------------------------------------------------- event and campaign props

  /** Rebuild the modifier-driven props (puppy, balloons, Jolly Roger, ...) when the active set changes. */
  private syncModifiers(l: ClinicLayout, c: Clinic, force: boolean): void {
    const seen = new Set<string>();
    for (const m of c.modifiers) { const k = propKeyForModifier(m); if (k) seen.add(k); }
    const key = [...seen].sort().join(',');
    if (!force && key === this.modKey) return;
    this.modKey = key;
    disposeOwned(this.modProps);
    this.modProps.clear();
    this.puppy = null;
    for (const k of seen) {
      if (k === 'prop_puppy') {
        this.puppyBase = { x: (l.zones.lobby.x0 + l.zones.lobby.x1) / 2, z: (l.zones.lobby.z0 + l.zones.lobby.z1) / 2 };
        this.puppyRadius = Math.min(1.6, (l.zones.lobby.x1 - l.zones.lobby.x0) / 4);
        this.puppy = place(makeProp('prop_puppy'), this.puppyBase.x, this.puppyBase.z, 0);
        // wanders every frame (Office.update): excluded from the static batch, unlike the props below
        this.puppy.userData.noBatch = true;
        this.puppy.traverse((o) => { o.userData.noBatch = true; });
        this.modProps.add(this.puppy);
        continue;
      }
      const spot = propSpotFor(k, l);
      if (!spot) continue;
      this.modProps.add(place(makeProp(k), spot.x, spot.z, spot.yaw));
    }
    batchStatic(this.modProps);
  }

  // ---------------------------------------------------------------- building shell

  private buildEnv(l: ClinicLayout, c: Clinic): void {
    disposeOwned(this.env);
    this.env.clear();
    this.envProxies.length = 0;
    if (this.signTex) { this.signTex.dispose(); this.signTex = null; }
    const E = this.env;
    const T = l.wallT;
    const f = l.floor;
    const z = l.zones;

    // base slab (lawn on top, warm cream sides)
    const g = l.ground;
    const slab = box(rectW(g), 0.5, rectD(g), mat('#A5DC8C', 0.95), rectCX(g), -0.5, rectCZ(g), 0.25);
    slab.receiveShadow = true; slab.castShadow = false;
    E.add(slab);
    const skirt = box(rectW(g) + 0.1, 0.36, rectD(g) + 0.1, mat(C.baseSide, 0.9), rectCX(g), -0.9, rectCZ(g), 0.22);
    skirt.castShadow = false;
    E.add(skirt);
    // street and sidewalk
    const st = floorPlane(z.street, streetTexture(), 4, 0.004);
    { // one dash line down the middle of the lane: v spans the street depth once
      const uv = (st.geometry as THREE.BufferGeometry).getAttribute('uv');
      const pos = (st.geometry as THREE.BufferGeometry).getAttribute('position');
      const d = rectD(z.street);
      for (let i = 0; i < pos.count; i++) uv.setY(i, 0.5 - pos.getZ(i) / d * 0.9);
    }
    E.add(st);
    E.add(floorPlane(z.sidewalk, concreteTexture(), 1.5, 0.03, '#FFFFFF', 0.95));
    E.add(box(rectW(z.sidewalk), 0.08, 0.16, mat(C.curb, 0.9), rectCX(z.sidewalk), -0.02, z.sidewalk.z1, 0.02));
    // strip under the storefront between floor and sidewalk
    E.add(floorPlane({ x0: f.x0 - T, z0: f.z1, x1: f.x1 + T, z1: z.sidewalk.z0 + 0.01 }, concreteTexture(), 1.5, 0.028));

    // floors
    E.add(floorPlane(z.lobby, woodTexture(), 1.6, 0.01, '#FFFFFF', 0.8));
    E.add(floorPlane(z.wing, tileTexture(C.tileA, C.tileB, C.grout), 1.2, 0.01, '#FFFFFF', 0.6));
    E.add(floorPlane(z.staff, tileTexture(C.staffA, C.staffB, '#D5DDE6'), 1.2, 0.01, '#FFFFFF', 0.7));
    // waiting room rug and doormat
    for (const r of l.rugs) E.add(decal(rugTexture(), rectW(r), rectD(r), rectCX(r), 0.016, rectCZ(r)));
    E.add(box(1.2, 0.02, 0.62, mat('#5E7A7A', 0.95), l.door.x, 0.01, f.z1 - 0.42, 0.01));
    // operatory floor mats
    for (const o of l.ops) E.add(decal(opMatTexture(), rectW(o.rect) - 0.2, rectD(o.rect) - 0.2, o.center.x, 0.014, o.center.z));

    // walls
    for (const w of l.walls) this.addWall(E, w.rect, w.height, w.kind, l);
    for (const p of l.partitions) {
      const h = 1.25;
      E.add(box(rectW(p), h, rectD(p), mat(C.wall, 0.8), rectCX(p), 0, rectCZ(p), 0.04));
      E.add(box(rectW(p) + 0.04, 0.05, rectD(p) + 0.04, mat(C.cap, 0.6), rectCX(p), h, rectCZ(p), 0.02));
      E.add(box(rectW(p) + 0.02, 0.1, rectD(p) + 0.02, mat(C.teal, 0.7), rectCX(p), 0, rectCZ(p), 0.01));
    }

    // door: a GLB with a hinged "Leaf" node swings that leaf; otherwise a procedural frame and glass leaf
    const doorSrc = loadedModel('entrance_door');
    const leafName = doorSrc ? findLeafName(doorSrc) : null;
    if (doorSrc && leafName) {
      const d = place(makeProp('entrance_door'), l.door.x, f.z1 + T / 2, 0);
      d.userData.noBatch = true;
      E.add(d);
      this.doorPivot = d.getObjectByName(leafName) ?? null;
      this.doorRest = this.doorPivot ? this.doorPivot.rotation.y : 0;
    } else {
      const frame = new THREE.Group();
      frame.add(box(0.1, 2.36, 0.22, mat(C.teal, 0.5), -l.door.width / 2 - 0.03, 0, 0, 0.03));
      frame.add(box(0.1, 2.36, 0.22, mat(C.teal, 0.5), l.door.width / 2 + 0.03, 0, 0, 0.03));
      frame.add(box(l.door.width + 0.16, 0.14, 0.24, mat(C.teal, 0.5), 0, 2.3, 0, 0.03));
      frame.add(box(l.door.width, 0.03, 0.2, mat(C.steel, 0.5), 0, 0, 0, 0.01));
      E.add(place(frame, l.door.x, f.z1 + T / 2, 0));
      const pivot = new THREE.Group();
      pivot.position.set(l.door.x - l.door.width / 2 + 0.02, 0, f.z1 + T / 2);
      const leaf = doorLeaf(l.door.width - 0.04);
      leaf.traverse((o) => { o.userData.noBatch = true; });
      pivot.add(leaf);
      pivot.userData.noBatch = true;
      E.add(pivot);
      this.doorPivot = pivot;
      this.doorRest = 0;
    }
    this.doorT = 0;

    // storefront sign on the sidewalk
    this.signTex = signTexture(c.name);
    const s = l.sign;
    const sign = new THREE.Group();
    sign.add(box(0.12, 0.5, 0.12, mat(C.teal), -1.05, 0, 0, 0.03), box(0.12, 0.5, 0.12, mat(C.teal), 1.05, 0, 0, 0.03));
    sign.add(box(2.7, 0.78, 0.16, mat(C.teal, 0.6), 0, 0.42, 0, 0.06));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: this.signTex, roughness: 0.55 }));
    face.position.set(0, 0.81, 0.085); face.userData.ownGeo = true; face.userData.ownMat = true;
    sign.add(face);
    sign.add(box(2.9, 0.14, 0.5, mat(C.pot, 0.8), 0, 0, 0.02, 0.05));
    sign.add(ball(0.16, mat(C.leaf), -0.9, 0.2, 0.12, 1), ball(0.14, mat(C.leafDark), -0.6, 0.18, 0.1, 1), ball(0.15, mat(C.leaf), 0.8, 0.2, 0.12, 1), ball(0.12, mat(C.bubblegum), 1.05, 0.2, 0.14, 1));
    place(sign, s.x, s.z, s.yaw + this.signTurn);
    sign.userData.noBatch = true;
    sign.traverse((o) => { o.userData.noBatch = true; });
    this.sign = sign;
    E.add(sign);

    // outdoor greenery on the side lawns
    const tree = (x: number, zz: number, sc: number) => {
      const t = new THREE.Group();
      t.add(cyl(0.09, 0.12, 1.1, mat('#9A6B45')));
      t.add(ball(0.62, mat(C.leaf, 0.9), 0, 1.45, 0, 1), ball(0.45, mat(C.leafDark, 0.9), 0.3, 1.85, 0.1, 1), ball(0.38, mat('#7ED99A', 0.9), -0.28, 1.8, -0.1, 1));
      t.scale.setScalar(sc);
      return place(t, x, zz, 0);
    };
    for (const p of l.outdoor) E.add(propAt(p));
    E.add(tree(f.x0 - 0.85, f.z1 - 2.5, 0.9));
    E.add(tree(f.x1 + 0.85, f.z1 - 2.4, 1));
    E.add(tree(f.x1 + 0.8, f.z0 + 1.2, 0.8));
    E.add(tree(f.x0 - 0.8, f.z0 + 1.6, 0.75));
    const bush = (x: number, zz: number) => place(new THREE.Group().add(ball(0.32, mat(C.leafDark, 0.9), 0, 0.22, 0, 1), ball(0.24, mat(C.leaf, 0.9), 0.25, 0.2, 0.05, 1)), x, zz, 0);
    E.add(bush(f.x0 - 0.75, f.z0 + 3.6), bush(f.x1 + 0.75, f.z0 + 4.2));
    // bench and hydrant on the sidewalk, right of the sign
    const bench = new THREE.Group();
    bench.add(box(1.4, 0.06, 0.42, mat(C.woodDark), 0, 0.42, 0, 0.02), box(1.4, 0.32, 0.06, mat(C.woodDark), 0, 0.5, -0.2, 0.02));
    bench.add(box(0.06, 0.42, 0.4, mat(C.dark), -0.6, 0, 0, 0.01), box(0.06, 0.42, 0.4, mat(C.dark), 0.6, 0, 0, 0.01));
    E.add(place(bench, s.x + 3.1, s.z + 0.05, 0));
    const hyd = new THREE.Group();
    hyd.add(cyl(0.12, 0.14, 0.5, mat('#E8505B', 0.6)), ball(0.12, mat('#E8505B', 0.6), 0, 0.52, 0, 1), cyl(0.05, 0.05, 0.12, mat('#E8505B'), 0.14, 0.3, 0).rotateZ(Math.PI / 2));
    E.add(place(hyd, z.sidewalk.x1 - 0.7, z.sidewalk.z1 - 0.4, 0));

    // furniture
    E.add(propAt(l.desk));
    for (const d of l.decor) E.add(propAt(d));
    for (const st of l.seats) E.add(place(makeProp('waiting_chair'), st.x, st.z, st.yaw));

    batchStatic(E);

    // front desk click target
    const dp = proxyBox(l.deskHit, 1.3, { kind: 'desk', id: 'desk' });
    E.add(dp);
    this.envProxies.push(dp);
    this.refreshProxies();
  }

  private addWall(E: THREE.Group, r: Rect, h: number, kind: 'solid' | 'low' | 'glass', l: ClinicLayout): void {
    const w = rectW(r), d = rectD(r), cx = rectCX(r), cz = rectCZ(r);
    if (w < 0.01 || d < 0.01) return;
    const wallM = mat(C.wall, 0.85);
    if (kind === 'glass') {
      const sill = 0.42;
      E.add(box(w, sill, d, wallM, cx, 0, cz, 0.02));
      E.add(box(w + 0.02, 0.05, d + 0.06, mat(C.cap, 0.6), cx, sill, cz, 0.02));
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h - sill - 0.1, 0.03), glassMat());
      pane.position.set(cx, sill + (h - sill - 0.1) / 2 + 0.05, cz);
      pane.userData.ownGeo = true;
      pane.renderOrder = 3;
      E.add(pane);
      const n = Math.max(1, Math.round(w / 1.4));
      for (let i = 0; i <= n; i++) E.add(box(0.07, h - sill, 0.08, mat(C.teal, 0.5), r.x0 + (w * i) / n, sill, cz, 0.02));
      E.add(box(w, 0.1, 0.1, mat(C.teal, 0.5), cx, h - 0.1, cz, 0.02));
      return;
    }
    E.add(box(w, h, d, wallM, cx, 0, cz, 0.02));
    E.add(box(w + 0.01, 0.05, d + 0.01, mat(C.cap, 0.6), cx, h, cz, 0.015));
    if (kind === 'solid') {
      // interior trim: mint wainscot and a teal baseboard on the face that looks into the room
      const f = l.floor;
      const along = w > d;
      const inward = along ? (cz < 0 ? 1 : -1) : (cx < 0 ? 1 : -1);
      const faceX = along ? cx : (inward > 0 ? r.x1 : r.x0);
      const faceZ = along ? (inward > 0 ? r.z1 : r.z0) : cz;
      const len = along ? Math.min(w, rectW(f)) : Math.min(d, rectD(f));
      const ccx = along ? rectCX(f) : faceX + inward * 0.012;
      const ccz = along ? faceZ + inward * 0.012 : rectCZ(f);
      const bw = along ? len : 0.024, bd = along ? 0.024 : len;
      E.add(box(bw, 1.05, bd, mat(C.wainscot, 0.85), ccx, 0, ccz, 0.005));
      E.add(box(bw + (along ? 0 : 0.01), 0.05, bd + (along ? 0.01 : 0), mat('#A7E3D4', 0.7), ccx, 1.05, ccz, 0.005));
      E.add(box(bw + (along ? 0 : 0.02), 0.12, bd + (along ? 0.02 : 0), mat(C.teal, 0.7), ccx, 0, ccz, 0.005));
    }
  }

  // ---------------------------------------------------------------- operatories and equipment

  private buildOps(l: ClinicLayout, c: Clinic, animate: boolean): void {
    disposeOwned(this.ops); disposeOwned(this.equip);
    this.ops.clear(); this.equip.clear();
    this.opProxies.length = 0;
    const now = new Set<string>();
    const pop = (key: string, o: THREE.Object3D) => {
      now.add(key);
      if (animate && !this.had.has(key)) { o.scale.setScalar(0.01); o.userData.noBatch = true; this.poppers.push({ obj: o, t: 0, base: 1 }); }
    };
    const bySlot = new Map<number, Operatory>();
    for (const o of c.ops) bySlot.set(o.slot, o);
    const slots = Math.min(l.ops.length, OFFICES[l.tier].opSlots);
    const closedOpIds = new Set<string>();
    for (const m of c.modifiers) if (m.closedOpId) closedOpIds.add(m.closedOpId);
    for (let i = 0; i < l.ops.length; i++) {
      const L = l.ops[i];
      const op = bySlot.get(L.slot);
      if (op) {
        const g = new THREE.Group();
        g.add(place(makeProp(CHAIRS[op.chair]?.model ?? 'chair_basic'), L.chair.x, L.chair.z, L.chair.yaw));
        for (const p of [L.counter, L.lamp, L.cart]) g.add(propAt(p));
        for (const u of op.upgrades) {
          const piece = L[OP_UPGRADE_PIECE[u]];
          const obj = propAt({ ...piece, key: OP_UPGRADES[u]?.model ?? piece.key });
          g.add(obj);
          pop(`${op.id}|${u}`, obj);
        }
        const num = decal(numberTexture(L.slot + 1), 0.5, 0.5, L.entry.x, 0.02, L.entry.z - (L.row === 'back' ? 0.95 : -0.95));
        g.add(num);
        if (closedOpIds.has(op.id)) {
          const marker = place(closedMarker(), L.entry.x, L.entry.z, L.yaw);
          g.add(marker);
          pop(`${op.id}|closed`, marker);
        }
        this.ops.add(g);
        pop(`${op.id}|${op.chair}`, g.children[0]);
        pop(`op|${op.id}`, g);
        if (g.userData.noBatch) g.traverse((o) => { o.userData.noBatch = true; });
        const px = proxyBox(L.rect, 1.0, { kind: 'op', id: op.id, slot: L.slot });
        this.ops.add(px);
        this.opProxies.push(px);
      } else if (c.ownedByPlayer && i < slots) {
        const ghost = decal(outlineTexture(C.teal, true), rectW(L.rect) - 0.3, rectD(L.rect) - 0.3, L.center.x, 0.022, L.center.z, 0.8);
        this.ops.add(ghost);
        const px = proxyBox(L.rect, 0.6, { kind: 'slot', id: 'slot' + L.slot, slot: L.slot });
        this.ops.add(px);
        this.opProxies.push(px);
      }
    }
    for (const id of c.equipment) {
      const piece = l.equipment[id as EquipId];
      const def = EQUIPMENT[id as EquipId];
      if (!piece || !def) continue;
      const obj = propAt({ ...piece, key: def.model });
      this.equip.add(obj);
      pop('eq|' + id, obj);
    }
    this.had = now;
    batchStatic(this.ops);
    batchStatic(this.equip);
    this.refreshProxies();
  }

  private refreshProxies(): void {
    this.proxies.length = 0;
    this.proxies.push(...this.envProxies, ...this.opProxies);
  }

  // ---------------------------------------------------------------- per frame

  select(slot: number | null): void {
    const l = this.layout;
    if (!l || slot === null || !l.ops[slot]) { this.selection.visible = false; return; }
    const r = l.ops[slot].rect;
    this.selection.visible = true;
    this.selection.position.set(rectCX(r), 0.03, rectCZ(r));
    this.selection.scale.set(rectW(r) - 0.02, 1, rectD(r) - 0.02);
  }

  openDoor(nowSec: number): void { this.doorOpenUntil = nowSec + 1.1; }

  update(dt: number, nowSec: number): void {
    // door swings open fast and closes slowly
    const want = nowSec < this.doorOpenUntil ? 1 : 0;
    const speed = want ? 4.5 : 1.8;
    this.doorT += Math.sign(want - this.doorT) * Math.min(Math.abs(want - this.doorT), dt * speed);
    if (this.doorPivot) {
      const t = this.doorT;
      const e = t * t * (3 - 2 * t);
      this.doorPivot.rotation.y = this.doorRest + 1.35 * e;
    }
    if (this.selection.visible) {
      (this.selection.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * Math.sin(nowSec * 4);
    }
    for (let i = this.poppers.length - 1; i >= 0; i--) {
      const p = this.poppers[i];
      p.t = Math.min(1, p.t + dt / 0.55);
      const t = p.t;
      const s = t >= 1 ? 1 : 1 + Math.sin(t * Math.PI * 1.5) * (1 - t) * 0.5 - (1 - t) * (1 - t) * (1 - t);
      p.obj.scale.setScalar(Math.max(0.01, s * p.base));
      if (t >= 1) this.poppers.splice(i, 1);
    }
    // the office puppy (DESIGN 10.2) wanders a slow loop around the middle of the lobby
    if (this.puppy) {
      const r = this.puppyRadius;
      const x = this.puppyBase.x + Math.sin(nowSec * 0.22) * r;
      const z = this.puppyBase.z + Math.sin(nowSec * 0.15 + 1.7) * r * 0.6;
      const ahead = nowSec + 0.05;
      const nx = this.puppyBase.x + Math.sin(ahead * 0.22) * r;
      const nz = this.puppyBase.z + Math.sin(ahead * 0.15 + 1.7) * r * 0.6;
      this.puppy.position.set(x, 0, z);
      this.puppy.rotation.y = Math.atan2(nx - x, nz - z);
    }
  }

  dispose(): void {
    disposeOwned(this.group);
    if (this.signTex) this.signTex.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.ownMat) (m.material as THREE.Material).dispose();
    });
    this.group.clear();
  }
}

function mix(h: number, v: number): number { return Math.imul(h ^ v, 16777619) >>> 0; }
function mixStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return mix(h, 124);
}
/** Cheap identity (a hash, no allocation) of what is built: operatory slots, chairs, upgrades, equipment,
 * and which operatory (if any) an event has closed (DESIGN 10.2, closedOpId), so a burst pipe closing or
 * reopening an operatory pops the "Closed" marker in or out without waiting on some other change. */
export function opsSignature(c: Clinic): number {
  let h = c.ownedByPlayer ? 2166136261 : 1234567;
  for (const o of c.ops) {
    h = mix(h, o.slot + 1); h = mixStr(h, o.id); h = mixStr(h, o.chair);
    for (const u of o.upgrades) h = mixStr(h, u);
  }
  h = mix(h, 35);
  for (const e of c.equipment) h = mixStr(h, e);
  h = mix(h, 71);
  for (const m of c.modifiers) if (m.closedOpId) h = mixStr(h, m.closedOpId);
  return h;
}

/** Name of a hinged door leaf node in the entrance door GLB, if the art has one. */
function findLeafName(src: THREE.Object3D): string | null {
  let name: string | null = null;
  src.traverse((o) => { if (!name && /leaf/i.test(o.name)) name = o.name; });
  return name;
}
