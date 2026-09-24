// People in the diorama: patients and staff. Uses the char_* GLBs when they loaded (rig nodes Body,
// Head, LegL, LegR, ArmL, ArmR, tintable materials Skin, Hair, Shirt, Pants, Shoes, Scrubs) and a
// procedural cartoon rig otherwise.
//
// Each model is baked ONCE into six vertex-colored part meshes that remember which parts are tintable
// (a per-vertex "tint slot"). A person is a cheap clone of that prototype plus its own small material
// whose shader swaps tint slots for the person's palette (skin, hair, shirt, pants, scrubs, shoes).
// So spawning a patient costs a clone, geometry is shared by everyone, and a person is six draw calls.
//
// Hierarchy:  root (world position + yaw)  >  pose (pivot at the hip: sit, recline, lean)  >  model (rig)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C, hitMat, shadowBlobMat, mat } from './palette';
import { loadedModel } from './props';
import { bakePart } from './batch';

export type PersonKind = 'adult' | 'kid' | 'senior' | 'staff' | 'dentist';
export interface Tint { skin: string; hair: string; shirt: string; pants: string; shoes: string; scrubs: string; hairStyle: number }

export const PERSON_MODEL: Record<PersonKind, string> = {
  adult: 'char_adult', kid: 'char_kid', senior: 'char_senior', staff: 'char_staff', dentist: 'char_dentist',
};

export const SKINS = ['#F7D2B6', '#EDBB94', '#D69B72', '#B87850', '#8C5A3C', '#F2C7A5'];
export const HAIRS = ['#3B2A20', '#6B4526', '#A8683A', '#E0B458', '#1F1B1A', '#C4553A'];
export const SENIOR_HAIRS = ['#E9E6E1', '#CFCBC6', '#B9B4AE'];
export const SHIRTS = ['#5FA8F5', '#FF8F70', '#FFD166', '#9A7CF0', '#4FCB8E', '#F46F9B', '#46C1D9', '#F59E4A', '#7BD66A', '#E86A6A'];
export const PANTS = ['#3D5A80', '#5A6472', '#7A5A44', '#2F4858', '#6C7A89', '#8A6F9E'];

type Part = 'body' | 'head' | 'legL' | 'legR' | 'armL' | 'armR';
const PART_NODES: Record<Part, string> = { body: 'Body', head: 'Head', legL: 'LegL', legR: 'LegR', armL: 'ArmL', armR: 'ArmR' };
const PARTS: Part[] = ['body', 'head', 'legL', 'legR', 'armL', 'armR'];

export interface Person {
  root: THREE.Group;
  pose: THREE.Group;
  model: THREE.Object3D;
  parts: Record<Part, THREE.Object3D | null>;
  rest: Record<Part, THREE.Euler | null>;
  hipY: number;
  height: number;
  hit: THREE.Mesh;
  blob: THREE.Mesh;
  marker: THREE.Object3D | null;
  kind: PersonKind;
  fromGlb: boolean;
  material: THREE.Material | null;   // this person's palette material (disposed with the person)
}

/** Pose inputs, all blends in 0..1 except phase and t. */
export interface PoseState {
  walk: number;     // walking blend
  phase: number;    // walk cycle phase (radians)
  sit: number;      // waiting chair
  recline: number;  // dental chair
  work: number;     // hands busy at the chair
  angry: number;    // stomping out
  t: number;        // seconds, for idle motion
  seed: number;     // per person offset
}

// ------------------------------------------------------------------ tint slots and the palette material

/** Tint slots baked into the "tint" vertex attribute. 0 keeps the baked color. */
export const SLOT = { none: 0, skin: 1, hair: 2, shirt: 3, pants: 4, scrubs: 5, shoes: 6 } as const;
const PALETTE_SIZE = 7;

export function slotForMaterial(name: string): number {
  switch (name) {
    case 'Skin': return SLOT.skin;
    case 'Hair': return SLOT.hair;
    case 'Shirt': return SLOT.shirt;
    case 'Pants': return SLOT.pants;
    case 'Scrubs': return SLOT.scrubs;
    case 'Shoes': return SLOT.shoes;
    default: return SLOT.none;
  }
}

/** A person's material: vertex colors, with tint slots replaced by the person's palette. */
export function personMaterial(t: Tint): THREE.MeshStandardMaterial {
  const palette: THREE.Color[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) palette.push(new THREE.Color('#FFFFFF'));
  palette[SLOT.skin].set(t.skin); palette[SLOT.hair].set(t.hair); palette[SLOT.shirt].set(t.shirt);
  palette[SLOT.pants].set(t.pants); palette[SLOT.scrubs].set(t.scrubs); palette[SLOT.shoes].set(t.shoes);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0 });
  m.userData.palette = palette;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPalette = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;\nuniform vec3 uPalette[' + PALETTE_SIZE + '];')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n  if (tint > 0.5) vColor.rgb = uPalette[int(tint + 0.5)];\n#endif');
  };
  m.customProgramCacheKey = () => 'fb-person-palette';
  return m;
}

// ------------------------------------------------------------------ procedural prototype

interface RigDims { hipY: number; torso: number; torsoW: number; headR: number; legR: number; armL: number; armR: number; shoulderX: number; legX: number }
const DIMS: Record<PersonKind, RigDims> = {
  adult: { hipY: 0.7, torso: 0.5, torsoW: 0.23, headR: 0.25, legR: 0.085, armL: 0.48, armR: 0.065, shoulderX: 0.27, legX: 0.1 },
  staff: { hipY: 0.7, torso: 0.5, torsoW: 0.23, headR: 0.25, legR: 0.085, armL: 0.48, armR: 0.065, shoulderX: 0.27, legX: 0.1 },
  dentist: { hipY: 0.72, torso: 0.52, torsoW: 0.24, headR: 0.25, legR: 0.085, armL: 0.49, armR: 0.066, shoulderX: 0.28, legX: 0.1 },
  senior: { hipY: 0.64, torso: 0.5, torsoW: 0.25, headR: 0.25, legR: 0.085, armL: 0.46, armR: 0.066, shoulderX: 0.28, legX: 0.1 },
  kid: { hipY: 0.42, torso: 0.34, torsoW: 0.17, headR: 0.23, legR: 0.07, armL: 0.32, armR: 0.052, shoulderX: 0.2, legX: 0.075 },
};

const tmpColor = new THREE.Color();
/** A primitive with a fixed color (slot 0) or a tint slot, transformed by m. Colors are linear. */
function part(g: THREE.BufferGeometry, color: string | number, m: THREE.Matrix4): THREE.BufferGeometry {
  const gg = g.index ? g.toNonIndexed() : g.clone();
  gg.deleteAttribute('uv');
  gg.applyMatrix4(m);
  const n = gg.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const tint = new Float32Array(n);
  if (typeof color === 'number') { tint.fill(color); tmpColor.set('#FFFFFF'); } else tmpColor.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b; }
  gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  gg.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  return gg;
}
function tr(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}
function merged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list, false)!;
  for (const x of list) x.dispose();
  g.computeBoundingSphere();
  return g;
}

const SPH = new THREE.SphereGeometry(1, 16, 12);
const CAP = new THREE.CapsuleGeometry(1, 1, 4, 12);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);

interface Proto { model: THREE.Object3D; hipY: number; height: number; fromGlb: boolean }

function proceduralProto(kind: PersonKind, hairStyle: number): Proto {
  const d = DIMS[kind];
  const isStaff = kind === 'staff';
  const isDoc = kind === 'dentist';
  const top: string | number = isStaff ? SLOT.scrubs : isDoc ? '#FFFFFF' : SLOT.shirt;
  const bottom: string | number = isStaff ? SLOT.scrubs : SLOT.pants;
  const model = new THREE.Group();
  const mk = (name: string, geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, z);
    const m = new THREE.Mesh(geo, bakedPlaceholder);
    m.castShadow = true;
    m.userData.personPart = true;
    pivot.add(m);
    model.add(pivot);
    return pivot;
  };
  const legGeo = merged([
    part(CYL, bottom, tr(0, -d.hipY * 0.45, 0, d.legR, d.hipY * 0.9, d.legR)),
    part(SPH, SLOT.shoes, tr(0, -d.hipY + 0.05, 0.05, d.legR * 1.25, 0.06, d.legR * 1.9)),
  ]);
  mk('LegL', legGeo, d.legX, d.hipY, 0);
  mk('LegR', legGeo, -d.legX, d.hipY, 0);
  const body = [
    part(CAP, top, tr(0, d.torso * 0.5, 0, d.torsoW, d.torso * 0.36, d.torsoW * 0.78)),
    part(CYL, bottom, tr(0, 0.02, 0, d.torsoW * 0.92, 0.12, d.torsoW * 0.7)),
    part(CYL, SLOT.skin, tr(0, d.torso + 0.02, 0, 0.06, 0.1, 0.06)),
  ];
  if (isDoc) {
    body.push(part(CYL, '#FFFFFF', tr(0, -0.12, 0, d.torsoW * 1.04, 0.36, d.torsoW * 0.82)));
    body.push(part(BOX, C.mint, tr(0.1, d.torso * 0.7, d.torsoW * 0.78, 0.07, 0.08, 0.02)));
    body.push(part(BOX, '#6C7A89', tr(-0.07, d.torso * 0.75, d.torsoW * 0.8, 0.03, 0.12, 0.02, 0, 0, 0.3)));
  }
  if (isStaff) body.push(part(BOX, '#FFFFFF', tr(-0.1, d.torso * 0.72, d.torsoW * 0.8, 0.06, 0.08, 0.02)));
  mk('Body', merged(body), 0, d.hipY, 0);
  const hr = d.headR;
  const head = [
    part(SPH, SLOT.skin, tr(0, hr * 0.9, 0, hr, hr * 0.95, hr * 0.95)),
    part(SPH, '#22313A', tr(hr * 0.36, hr * 0.98, hr * 0.86, hr * 0.1, hr * 0.14, hr * 0.06)),
    part(SPH, '#22313A', tr(-hr * 0.36, hr * 0.98, hr * 0.86, hr * 0.1, hr * 0.14, hr * 0.06)),
    part(SPH, '#FF9DB2', tr(hr * 0.6, hr * 0.7, hr * 0.72, hr * 0.14, hr * 0.08, hr * 0.05)),
    part(SPH, '#FF9DB2', tr(-hr * 0.6, hr * 0.7, hr * 0.72, hr * 0.14, hr * 0.08, hr * 0.05)),
    part(SPH, SLOT.skin, tr(0, hr * 0.78, hr * 0.94, hr * 0.12, hr * 0.1, hr * 0.1)),
    part(SPH, SLOT.hair, tr(0, hr * 1.15, -hr * 0.12, hr * 1.04, hr * 0.8, hr * 0.98)),
  ];
  if (hairStyle === 1) head.push(part(SPH, SLOT.hair, tr(0, hr * 1.85, -hr * 0.35, hr * 0.38, hr * 0.38, hr * 0.38)));
  if (hairStyle === 2) head.push(part(SPH, SLOT.hair, tr(0, hr * 0.8, -hr * 0.75, hr * 0.5, hr * 0.7, hr * 0.4)));
  if (kind === 'senior') {
    head.push(part(CYL, '#3A4A52', tr(hr * 0.36, hr * 0.98, hr * 0.9, hr * 0.2, 0.012, hr * 0.2, Math.PI / 2)));
    head.push(part(CYL, '#3A4A52', tr(-hr * 0.36, hr * 0.98, hr * 0.9, hr * 0.2, 0.012, hr * 0.2, Math.PI / 2)));
  }
  if (isStaff || isDoc) head.push(part(CYL, isDoc ? '#E8F7F3' : SLOT.scrubs, tr(0, hr * 1.62, -hr * 0.05, hr * 0.92, hr * 0.28, hr * 0.92)));
  mk('Head', merged(head), 0, d.hipY + d.torso + 0.04, 0);
  const sleeve: string | number = isDoc ? '#FFFFFF' : top;
  const armGeo = merged([
    part(CAP, sleeve, tr(0, -d.armL * 0.4, 0, d.armR, d.armL * 0.35, d.armR)),
    part(SPH, SLOT.skin, tr(0, -d.armL * 0.92, 0, d.armR * 1.15, d.armR * 1.15, d.armR * 1.15)),
  ]);
  const shoulderY = d.hipY + d.torso * 0.82;
  const armL = mk('ArmL', armGeo, d.shoulderX, shoulderY, 0);
  const armR = mk('ArmR', armGeo, -d.shoulderX, shoulderY, 0);
  armL.rotation.z = 0.12; armR.rotation.z = -0.12;
  return { model, hipY: d.hipY, height: d.hipY + d.torso + 0.04 + hr * 2, fromGlb: false };
}

const bakedPlaceholder = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68 });

// ------------------------------------------------------------------ GLB prototype

/**
 * Find the six rig parts. A part that is itself a mesh (single-primitive node) is swapped for a plain
 * pivot group with the same transform, holding the mesh and the part's children, so baking and posing
 * treat every part the same way.
 */
function normalizeRig(model: THREE.Object3D): Record<Part, THREE.Object3D | null> {
  const parts = { body: null, head: null, legL: null, legR: null, armL: null, armR: null } as Record<Part, THREE.Object3D | null>;
  for (const p of PARTS) {
    const node = model.getObjectByName(PART_NODES[p]);
    if (!node) continue;
    let pivot: THREE.Object3D = node;
    if ((node as THREE.Mesh).isMesh && node.parent) {
      const g = new THREE.Group();
      g.name = node.name;
      g.position.copy(node.position); g.quaternion.copy(node.quaternion); g.scale.copy(node.scale);
      const parent = node.parent;
      parent.add(g);
      parent.remove(node);
      for (const c of [...node.children]) g.add(c);
      node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.set(1, 1, 1);
      node.name = node.name + '_mesh';
      g.add(node);
      pivot = g;
    }
    pivot.userData.rigPart = true;
    parts[p] = pivot;
  }
  return parts;
}

const baseColor = new THREE.Color();
function glbProto(src: THREE.Object3D): Proto | null {
  const model = src.clone(true);
  const parts = normalizeRig(model);
  model.updateMatrixWorld(true);
  let baked = 0;
  for (const p of PARTS) {
    const pv = parts[p];
    if (!pv) continue;
    const mesh = bakePart(pv, (m) => baseColor.copy((m as THREE.MeshStandardMaterial).color ?? baseColor.set('#FFFFFF')), (m) => slotForMaterial(m.name));
    if (mesh) { mesh.material = bakedPlaceholder; mesh.userData.personPart = true; mesh.userData.ownGeo = false; baked++; }
  }
  if (baked < 3) return null;
  // anything not baked (a stray mesh outside the rig) is dropped: it would keep its shared materials
  const stray: THREE.Object3D[] = [];
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.personPart) stray.push(o); });
  for (const o of stray) o.removeFromParent();
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const leg = src.getObjectByName('LegL');
  const hipY = leg ? leg.getWorldPosition(new THREE.Vector3()).y : box.max.y * 0.42;
  return { model, hipY: hipY > 0.05 ? hipY : box.max.y * 0.42, height: box.max.y, fromGlb: true };
}

const protoCache = new Map<string, Proto>();
function protoFor(kind: PersonKind, hairStyle: number, forceFallback: boolean): Proto {
  const src = forceFallback ? null : loadedModel(PERSON_MODEL[kind]);
  const key = src ? `glb|${kind}|${src.uuid}` : `proc|${kind}|${hairStyle}`;
  let p = protoCache.get(key);
  if (!p) {
    p = (src ? glbProto(src) : null) ?? proceduralProto(kind, hairStyle);
    protoCache.set(key, p);
  }
  return p;
}

// ------------------------------------------------------------------ assembly

const blobGeo = new THREE.PlaneGeometry(1, 1);
const hitGeo = new THREE.CylinderGeometry(0.34, 0.34, 1, 10);
let markerRing: THREE.BufferGeometry | null = null;
let markerGem: THREE.BufferGeometry | null = null;

export function createPerson(kind: PersonKind, tint: Tint, withMarker = false, forceFallback = false): Person {
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  const proto = protoFor(kind, tint.hairStyle, forceFallback);
  const model = proto.model.clone(true);
  const material = personMaterial(tint);
  const parts = { body: null, head: null, legL: null, legR: null, armL: null, armR: null } as Record<Part, THREE.Object3D | null>;
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.personPart) {
      (o as THREE.Mesh).material = material;
      // arms are thin: skip them in the shadow pass
      if (o.parent && /Arm/.test(o.parent.name)) (o as THREE.Mesh).castShadow = false;
    }
  });
  for (const p of PARTS) parts[p] = model.getObjectByName(PART_NODES[p]) ?? null;
  const rest = { body: null, head: null, legL: null, legR: null, armL: null, armR: null } as Record<Part, THREE.Euler | null>;
  for (const p of PARTS) rest[p] = parts[p] ? parts[p]!.rotation.clone() : null;
  const { hipY, height } = proto;
  pose.position.y = hipY;
  model.position.y = -hipY;
  pose.add(model);

  const blob = new THREE.Mesh(blobGeo, shadowBlobMat());
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  const bs = kind === 'kid' ? 0.6 : 0.85;
  blob.scale.set(bs, bs, 1);
  blob.renderOrder = 1;
  root.add(blob);

  const hit = new THREE.Mesh(hitGeo, hitMat());
  hit.scale.set(kind === 'kid' ? 0.85 : 1, height, kind === 'kid' ? 0.85 : 1);
  hit.position.y = height / 2;
  root.add(hit);

  let marker: THREE.Object3D | null = null;
  if (withMarker) {
    markerRing ??= new THREE.RingGeometry(0.36, 0.46, 32);
    markerGem ??= new THREE.OctahedronGeometry(0.11, 0);
    marker = new THREE.Group();
    const ring = new THREE.Mesh(markerRing, mat(C.bubblegum, 0.5, 0, C.bubblegum, 0.7));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    marker.add(ring);
    const gem = new THREE.Mesh(markerGem, mat(C.bubblegum, 0.35, 0, C.bubblegum, 0.8));
    gem.scale.y = 1.4;
    gem.name = 'gem';
    gem.position.y = height + 0.32;
    marker.add(gem);
    root.add(marker);
  }
  return { root, pose, model, parts, rest, hipY, height, hit, blob, marker, kind, fromGlb: proto.fromGlb, material };
}

/** Free what belongs to this person alone (its palette material). Geometry is shared. */
export function disposePerson(p: Person): void {
  p.material?.dispose();
  p.material = null;
}

// ------------------------------------------------------------------ posing

const SEAT_Y = 0.46;
const CHAIR_HIP_Y = 0.66;

function setRot(p: Person, part: Part, x: number, y = 0, z = 0): void {
  const o = p.parts[part]; const r = p.rest[part];
  if (!o || !r) return;
  o.rotation.set(r.x + x, r.y + y, r.z + z);
}

/** Apply a blended pose. No allocations. */
export function applyPose(p: Person, s: PoseState): void {
  const w = s.walk, sit = s.sit, rec = s.recline, work = s.work, ang = s.angry;
  const sw = Math.sin(s.phase);
  const idle = Math.sin(s.t * 1.7 + s.seed * 6.28);
  const legSwing = 0.62 * sw * w;
  // sitting: thighs forward; reclined: legs lie along the leg rest (the pose group tilts back 1.2 rad)
  const legSit = -1.35 * sit + -0.5 * rec;
  setRot(p, 'legL', legSwing + legSit + 0.05 * rec);
  setRot(p, 'legR', -legSwing + legSit - 0.03 * rec);
  const armSwing = 0.5 * sw * w * (1 - ang);
  const workArm = work * (-1.05 + 0.16 * Math.sin(s.t * 9 + s.seed * 4));
  const workArm2 = work * (-0.85 + 0.1 * Math.sin(s.t * 7.3 + s.seed * 3));
  const angryArm = ang * (-2.6 + 0.35 * Math.sin(s.t * 14));
  const sitArm = sit * -0.35 + rec * -0.2;
  setRot(p, 'armL', -armSwing + workArm + angryArm + sitArm + 0.03 * idle * (1 - w), 0, work * -0.25);
  setRot(p, 'armR', armSwing + workArm2 + angryArm + sitArm - 0.03 * idle * (1 - w), 0, work * 0.25);
  setRot(p, 'head', -0.1 * rec + 0.18 * work + 0.05 * idle * (1 - w) * (1 - rec), 0.25 * Math.sin(s.t * 0.37 + s.seed * 9) * (1 - w) * (1 - work) * (1 - rec));
  setRot(p, 'body', 0);
  // pose group: hip height, lean, recline
  const bob = Math.abs(Math.cos(s.phase)) * 0.045 * w;
  const hipSit = SEAT_Y + 0.06;
  const hip = p.hipY * (1 - sit - rec) + hipSit * sit + CHAIR_HIP_Y * rec;
  p.pose.position.y = hip + bob + (work > 0 ? 0.012 * Math.sin(s.t * 9 + s.seed) * work : 0);
  p.pose.position.z = -0.12 * sit + 0.02 * rec;
  p.pose.rotation.x = -1.2 * rec + 0.2 * work + 0.05 * w - 0.08 * sit;
  p.pose.rotation.z = ang * 0.06 * Math.sin(s.t * 18);
  if (p.marker) {
    const gem = p.marker.children[1];
    if (gem) { gem.position.y = p.height + 0.32 + Math.sin(s.t * 3) * 0.06 - (1 - (hip / p.hipY)) * 0.3; gem.rotation.y = s.t * 2; }
  }
}
