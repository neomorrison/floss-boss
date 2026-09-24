// The 3D mouth: lights, teeth (per-tooth dirt textures), gums, palate, tongue, cavity, lips, skin,
// throat, tartar deposits, debris, loose bits, water and the tool models. GLBs from the art-mouth
// builder are used when present; every piece has a procedural fallback (geometry.ts).
import * as THREE from 'three';
import type { ToolSlot, ToothKind } from '../core/types';
import { LOWER_GUM_Y, TOOTH_DIMS, UPPER_GUM_Y, type ToothPlacement } from '../core/mouth';
import { makeRng } from '../core/rng';
import { TOOL_SLOTS, toolTier } from '../data/tools';
import type { CleanModel, Debris, LooseBit, TartarDeposit } from './dirt';
import { sideU } from './dirt';
import {
  cavityGeometry, debrisGeometry, skirtGeometry, gumGeometry, lipsGeometry, normalizeToothGeometry, palateGeometry, skinGeometry,
  tartarGeometry, throatGeometry, toolModel, toothGeometry, tongueGeometry, uvulaGeometry, type ToolParts,
} from './geometry';
import {
  cavityMaterial, getEnvironment, gumMaterial, lipsMaterial, makeSharedToothUniforms, makeToothMaterial, makeWaterMaterial,
  skinMaterial, throatMaterial, tongueMaterial, uploadDirt, type SharedToothUniforms, type ToothMat, type WaterMat,
} from './materials';
import { Fx } from './fx';

export type Models = Record<string, THREE.Object3D | null>;

export type HitKind = 'tooth' | 'gum' | 'tongue' | 'water' | 'soft' | 'face' | 'none';
export interface Hit {
  kind: HitKind;
  tooth: number;           // tooth index for 'tooth' hits
  u: number; v: number;
  point: THREE.Vector3;    // world
  normal: THREE.Vector3;   // world
  local: THREE.Vector3;    // mouth-root space
}
export const makeHit = (): Hit => ({ kind: 'none', tooth: -1, u: 0, v: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), local: new THREE.Vector3() });

export interface ToothView {
  index: number;
  p: ToothPlacement;
  group: THREE.Group;      // position + yaw (in its arch group)
  flip: THREE.Group;       // upper teeth rotated pi about Z
  mesh: THREE.Mesh;
  tm: ToothMat;
  h: number;
}

interface DepositView { dep: TartarDeposit; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; base: number; normal: THREE.Vector3; pos: THREE.Vector3; shown: number; color: THREE.Color }
interface DebrisView { deb: Debris; obj: THREE.Object3D; base: THREE.Vector3; wob: number }

const SKINS = ['#F6D3B8', '#EDBE9A', '#D9A37C', '#B77B55', '#8D5A3C', '#F2C8A6'];
const MAX_BITS = 72;

export interface SceneOptions { lowQuality: boolean; headlamp: boolean; procedural: boolean }

export class MouthScene {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly teeth: (ToothView | null)[] = [];
  readonly shared: SharedToothUniforms = makeSharedToothUniforms();
  readonly fx: Fx;
  readonly tools = {} as Record<ToolSlot, { holder: THREE.Group; parts: ToolParts; spinner: THREE.Object3D | null }>;
  readonly toolRoot = new THREE.Group();
  readonly gums: THREE.Mesh[] = [];
  readonly gumMat: THREE.MeshPhysicalMaterial;
  /** Every gum material in use (procedural or cloned from the GLB): flashed red on gum hits. */
  readonly gumMats: THREE.MeshStandardMaterial[] = [];
  readonly water: THREE.Mesh;
  readonly waterMat: WaterMat;
  readonly key: THREE.SpotLight;
  private pickSolid: THREE.Object3D[] = [];
  private pickWater: THREE.Object3D[];
  private deposits = new Map<number, DepositView>();
  private debris = new Map<number, DebrisView>();
  private bitsMesh: THREE.InstancedMesh;
  private bitSlot = new Map<number, number>();
  private freeSlots: number[] = [];
  private bitAnims: { slot: number; from: THREE.Vector3; to: THREE.Vector3; t: number; mode: 'suck' | 'sink'; keep: boolean }[] = [];
  private ndc = new THREE.Vector2();
  private lowerLip: THREE.Object3D | null = null;
  private raycaster = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpN = new THREE.Matrix3();
  private tmpC = new THREE.Color();
  private disposables: { dispose(): void }[] = [];
  waterLevel = 0;
  jaw = 0;

  constructor(renderer: THREE.WebGLRenderer, private model: CleanModel, models: Models, private opts: SceneOptions) {
    const s = this.scene;
    s.background = new THREE.Color('#F3D2BE');
    s.environment = getEnvironment(renderer);
    s.environmentIntensity = 0.55;
    s.add(this.root, this.toolRoot);
    this.root.add(this.upper, this.lower);

    // --- lights: soft ambient plus the dental lamp
    const hemi = new THREE.HemisphereLight('#FFF6EE', '#F7A8B6', 1.1);
    s.add(hemi);
    this.key = new THREE.SpotLight('#FFF8EC', opts.headlamp ? 3.3 : 2.6, 0, 0.62, 0.75, 0);
    this.key.position.set(1.2, 6.5, 15);
    this.key.target.position.set(0, -0.3, 0);
    s.add(this.key, this.key.target);
    if (!opts.lowQuality) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(1024, 1024);
      this.key.shadow.bias = -0.0004;
      this.key.shadow.normalBias = 0.02;
      this.key.shadow.camera.near = 6;
      this.key.shadow.camera.far = 30;
    }
    const fill = new THREE.DirectionalLight('#FFE4EA', 0.55);
    fill.position.set(-6, -3, 8);
    s.add(fill);
    const inner = new THREE.PointLight('#FFD9D2', 3.5, 9, 1.6);
    inner.position.set(0, 0, 1.5);
    this.root.add(inner);

    // --- soft tissue
    const rng = makeRng(model.setup.seed ^ 0xface);
    const skinCol = model.setup.patient.archetype === 'mannequin' ? '#F0D9C8' : SKINS[rng.int(0, SKINS.length - 1)];
    const frame = opts.procedural ? null : models.mouth_frame;
    if (frame) {
      const f = frame.clone(true);
      f.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && /skin/i.test(mat.name)) { m.material = mat.clone(); (m.material as THREE.MeshStandardMaterial).color.set(skinCol); }
        m.castShadow = false;
        m.receiveShadow = false;
        // the procedural throat has a deeper gradient than a flat backdrop
        if (/throat/i.test(mat?.name || '')) { m.visible = false; return; }
        m.userData.kind = 'face';
        this.pickSolid.push(m);
      });
      this.root.add(f);
      const throat = this.mesh(throatGeometry(), throatMaterial(), 'soft');
      throat.name = 'throat';
      this.root.add(throat);
    } else {
      const lipsM = lipsMaterial();
      const up = this.mesh(lipsGeometry('upper'), lipsM, 'face');
      const lo = this.mesh(lipsGeometry('lower'), lipsM, 'face');
      this.lowerLip = lo;
      const skin = this.mesh(skinGeometry(), skinMaterial(skinCol), 'face');
      skin.receiveShadow = true;
      const throat = this.mesh(throatGeometry(), throatMaterial(), 'soft');
      up.name = 'lipsUpper'; lo.name = 'lipsLower'; skin.name = 'skin'; throat.name = 'throat';
      this.root.add(up, lo, skin, throat);
    }
    const cav = this.mesh(cavityGeometry(), cavityMaterial(), 'soft');
    cav.name = 'cavity';
    this.root.add(cav);
    const uvula = this.mesh(uvulaGeometry(), new THREE.MeshPhysicalMaterial({ color: '#E77586', roughness: 0.4, clearcoat: 0.4 }), 'soft');
    this.upper.add(uvula);
    const palate = this.mesh(palateGeometry(), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.3, side: THREE.BackSide }), 'soft');
    palate.name = 'palate'; uvula.name = 'uvula';
    this.upper.add(palate);

    const tongueSrc = opts.procedural ? null : models.tongue;
    const tongue = tongueSrc ? this.adopt(tongueSrc, 'tongue') : this.mesh(tongueGeometry(), tongueMaterial(), 'tongue');
    this.lower.add(tongue);

    // --- gums
    this.gumMat = gumMaterial();
    this.gumMats.push(this.gumMat);
    const missing = new Set(model.setup.missingTeeth);
    for (const arch of ['upper', 'lower'] as const) {
      const src = opts.procedural ? null : models[`gum_${arch}`];
      let g: THREE.Object3D;
      if (src && missing.size === 0) {
        g = this.adopt(src, 'gum');
        g.position.y = arch === 'upper' ? UPPER_GUM_Y : LOWER_GUM_Y;
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.userData.arch = arch;
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.emissive = new THREE.Color('#ff0000');
          mat.emissiveIntensity = 0;
          m.material = mat;
          this.gumMats.push(mat);
          this.gums.push(m);
        });
      } else {
        const m = this.mesh(gumGeometry({ arch, placements: model.placements, missing }), this.gumMat, 'gum');
        m.userData.arch = arch;
        m.receiveShadow = true;
        this.gums.push(m);
        g = m;
      }
      (arch === 'upper' ? this.upper : this.lower).add(g);
    }

    const skirt = this.mesh(skirtGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }), 'gum');
    skirt.name = 'skirt';
    this.lower.add(skirt);

    // --- teeth
    const geoCache = new Map<ToothKind, THREE.BufferGeometry>();
    const toothGeo = (kind: ToothKind) => {
      let g = geoCache.get(kind);
      if (!g) {
        const src = opts.procedural ? null : models[`tooth_${kind}`];
        const mesh = src ? firstMesh(src) : null;
        if (mesh) {
          mesh.updateWorldMatrix(true, false);
          const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          g = normalizeToothGeometry(baked, kind);
          baked.dispose();
        } else g = toothGeometry(kind);
        geoCache.set(kind, g);
        this.disposables.push(g);
      }
      return g;
    };
    for (const p of model.placements) {
      const td = model.teeth[p.index];
      if (!td.present) { this.teeth.push(null); continue; }
      const dims = TOOTH_DIMS[p.kind];
      const tm = makeToothMaterial(dims.h, this.shared, p.kind === 'incisor' || p.kind === 'canine' ? 1 : 0.4);
      const mesh = new THREE.Mesh(toothGeo(p.kind), tm.material);
      mesh.scale.x = p.width / dims.w;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'tooth', index: p.index };
      const flip = new THREE.Group();
      if (p.arch === 'upper') flip.rotation.z = Math.PI;
      flip.add(mesh);
      const group = new THREE.Group();
      group.position.set(p.x, p.y, p.z);
      group.rotation.y = p.yaw;
      group.add(flip);
      (p.arch === 'upper' ? this.upper : this.lower).add(group);
      this.pickSolid.push(mesh);
      uploadDirt(tm, td.plaque, td.stain, td.polish);
      td.changed = false;
      this.teeth.push({ index: p.index, p, group, flip, mesh, tm, h: dims.h });
    }
    this.scene.updateMatrixWorld(true);

    // --- tartar deposits
    const tartarGeo: THREE.BufferGeometry[] = [];
    const tartarSrcMat: (THREE.MeshStandardMaterial | null)[] = [];
    for (let v = 0; v < 3; v++) {
      const src = opts.procedural ? null : models[`tartar_${'abc'[v]}`];
      const m = src ? firstMesh(src) : null;
      if (m) {
        m.updateWorldMatrix(true, false);
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const sc = 0.34 / Math.max(1e-3, bb.max.x - bb.min.x);
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        g.scale(sc, sc, sc);
        tartarGeo.push(g);
        tartarSrcMat.push(m.material as THREE.MeshStandardMaterial);
      } else {
        tartarGeo.push(tartarGeometry(v));
        tartarSrcMat.push(null);
      }
      this.disposables.push(tartarGeo[v]);
    }
    const drng = makeRng(model.setup.seed ^ 0x7a57);
    for (const dep of model.tartar) {
      const tv = this.teeth[dep.tooth];
      if (!tv) continue;
      const hit = this.surfacePoint(tv, dep.u, dep.v);
      const src = tartarSrcMat[dep.variant];
      const mat = src ? (src.clone() as THREE.MeshStandardMaterial) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });
      mat.emissive = new THREE.Color('#FF5FB0');
      mat.emissiveIntensity = 0;
      const mesh = new THREE.Mesh(tartarGeo[dep.variant], mat);
      mesh.castShadow = true;
      // into flip-group space
      const lp = tv.flip.worldToLocal(hit.point.clone());
      const ln = hit.normal.clone().transformDirection(this.tmpM.copy(tv.flip.matrixWorld).invert()).normalize();
      mesh.position.copy(lp).addScaledVector(ln, -0.02);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ln);
      mesh.rotateY(drng.range(0, Math.PI * 2));
      const base = Math.sqrt(dep.size) * drng.range(1.0, 1.25);
      mesh.scale.setScalar(base);
      mesh.userData = { kind: 'tooth', index: dep.tooth, dep: dep.id };
      tv.flip.add(mesh);
      this.pickSolid.push(mesh);
      this.deposits.set(dep.id, { dep, mesh, mat, base, normal: ln, pos: mesh.position.clone(), shown: 1, color: mat.color.clone() });
    }

    // --- debris wedged in gaps
    for (const deb of model.debris) {
      const a = this.teeth[deb.a], b = this.teeth[deb.b];
      if (!a || !b) continue;
      const pa = this.surfacePoint(a, sideU(a.p, deb.b), deb.v).point.clone();
      const pb = this.surfacePoint(b, sideU(b.p, deb.a), deb.v).point.clone();
      const mid = pa.add(pb).multiplyScalar(0.5);
      const nx = (a.p.nx + b.p.nx) / 2, nz = (a.p.nz + b.p.nz) / 2;
      mid.x += nx * 0.1; mid.z += nz * 0.1;
      const src = opts.procedural ? null : models[`debris_${deb.kind}`];
      let obj: THREE.Object3D;
      if (src) {
        obj = src.clone(true);
        const bb = new THREE.Box3().setFromObject(obj);
        const size = bb.getSize(this.tmpV).length();
        obj.scale.multiplyScalar(0.34 / Math.max(0.01, size));
      } else {
        const dg = debrisGeometry(deb.kind);
        this.disposables.push(dg.geo);
        obj = new THREE.Mesh(dg.geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: dg.rough, side: deb.kind === 'spinach' ? THREE.DoubleSide : THREE.FrontSide }));
        obj.scale.setScalar(1.35);
      }
      obj.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      const group = a.p.arch === 'upper' ? this.upper : this.lower;
      group.worldToLocal(mid);
      obj.position.copy(mid);
      obj.lookAt(this.tmpV.set(mid.x + nx, mid.y, mid.z + nz));
      obj.rotateZ(drng.range(-0.6, 0.6));
      group.add(obj);
      this.debris.set(deb.id, { deb, obj, base: obj.position.clone(), wob: 0 });
    }

    // --- loose bits (instanced crumbs on the tongue)
    const bg = new THREE.DodecahedronGeometry(0.1, 0);
    bg.scale(1, 0.7, 1.1);
    this.disposables.push(bg);
    this.bitsMesh = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: '#D2A945', roughness: 0.85, flatShading: true }), MAX_BITS);
    this.bitsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bitsMesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_BITS; i++) { this.bitsMesh.setMatrixAt(i, zero); this.freeSlots.push(MAX_BITS - 1 - i); }
    this.lower.add(this.bitsMesh);

    // --- water pooling in the lower mouth
    this.waterMat = makeWaterMaterial();
    this.water = new THREE.Mesh(waterGeometry(), this.waterMat.material);
    this.water.userData.kind = 'water';
    this.water.visible = false;
    this.water.renderOrder = 3;
    this.root.add(this.water);
    this.pickWater = [this.water];

    // --- fx
    this.fx = new Fx(opts.lowQuality);
    this.root.add(this.fx.group);

    // --- tools
    for (const slot of TOOL_SLOTS) {
      const key = toolTier(slot, model.setup.tools[slot]).model;
      const src = opts.procedural ? null : models[key];
      let parts: ToolParts;
      if (src) {
        const g = new THREE.Group();
        const obj = src.clone(true);
        const bb = new THREE.Box3().setFromObject(obj);
        const len = Math.max(0.01, bb.max.y - Math.min(0, bb.min.y));
        obj.scale.multiplyScalar(7 / len);
        g.add(obj);
        let spinner: THREE.Object3D | null = null;
        obj.traverse((o) => { if (!spinner && /cup|spin|head/i.test(o.name)) spinner = o; });
        parts = { group: g, spinner, spinAxis: 'y', nozzle: new THREE.Vector3(0, 0.05, 0), string: null };
      } else parts = toolModel(key);
      const holder = new THREE.Group();
      parts.group.scale.setScalar(0.72);
      holder.add(parts.group);
      holder.visible = false;
      this.toolRoot.add(holder);
      this.tools[slot] = { holder, parts, spinner: parts.spinner };
    }
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, kind: HitKind): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.kind = kind;
    this.disposables.push(g);
    this.pickSolid.push(mesh);
    return mesh;
  }

  private adopt(src: THREE.Object3D, kind: HitKind): THREE.Object3D {
    const o = src.clone(true);
    o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.userData.kind = kind; m.receiveShadow = true; this.pickSolid.push(m); } });
    return o;
  }

  /** Point on a tooth surface at (u, v), found by casting from outside toward the tooth axis. */
  surfacePoint(tv: ToothView, u: number, v: number): { point: THREE.Vector3; normal: THREE.Vector3 } {
    const th = (u - 0.5) * Math.PI * 2;
    const y = v * tv.h;
    const o = new THREE.Vector3(Math.sin(th) * 2, y, Math.cos(th) * 2);
    const d = new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th));
    tv.mesh.updateWorldMatrix(true, false);
    const mw = tv.mesh.matrixWorld;
    o.applyMatrix4(mw);
    d.transformDirection(mw);
    this.raycaster.set(o, d);
    this.raycaster.far = 10;
    this.hits.length = 0;
    tv.mesh.raycast(this.raycaster, this.hits);
    this.hits.sort((a, b) => a.distance - b.distance);
    const h = this.hits[0];
    if (h) {
      const n = h.face ? h.face.normal.clone().applyNormalMatrix(this.tmpN.getNormalMatrix(mw)).normalize() : d.clone().negate();
      return { point: h.point.clone(), normal: n };
    }
    // fallback: the idealized crown
    const dims = TOOTH_DIMS[tv.p.kind];
    const p = new THREE.Vector3(Math.sin(th) * dims.w / 2, y, Math.cos(th) * dims.d / 2).applyMatrix4(mw);
    return { point: p, normal: d.negate() };
  }

  /** Tooth crown centre in world space (for camera focus and labels). */
  toothCenter(i: number, out: THREE.Vector3): THREE.Vector3 {
    const tv = this.teeth[i];
    if (!tv) return out.set(0, 0, 0);
    out.set(0, tv.h * 0.55, 0);
    return tv.mesh.localToWorld(out);
  }

  depositWorld(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.deposits.get(id);
    if (!d) return null;
    return d.mesh.getWorldPosition(out);
  }

  /** Centre of a deposit's lump (for aiming), world space. */
  depositCenter(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.deposits.get(id);
    if (!d) return null;
    const g = d.mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    g.boundingBox!.getCenter(out);
    return d.mesh.localToWorld(out);
  }

  /**
   * Aim assist: the unpopped deposit whose lump centre is within `radius` (world units) of `p`, or null.
   * A scrape that slips just off a gumline lump onto the gum still scrapes the lump.
   */
  nearestDeposit(p: THREE.Vector3, radius: number): TartarDeposit | null {
    let best: TartarDeposit | null = null, bd = radius * radius;
    for (const dv of this.deposits.values()) {
      if (dv.dep.popped) continue;
      this.depositCenter(dv.dep.id, this.tmpV);
      const d = this.tmpV.distanceToSquared(p);
      if (d < bd) { bd = d; best = dv.dep; }
    }
    return best;
  }

  debrisWorld(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.debris.get(id);
    if (!d) return null;
    return d.obj.getWorldPosition(out);
  }

  /** Raycast from the camera through NDC; fills `hit`. `water` includes the water surface. */
  pick(ndcX: number, ndcY: number, camera: THREE.Camera, hit: Hit, water: boolean): Hit {
    this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), camera);
    this.raycaster.far = 100;
    hit.kind = 'none';
    hit.tooth = -1;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.pickSolid, false, this.hits);
    let best = this.hits[0];
    if (water && this.water.visible) {
      const n = this.hits.length;
      this.raycaster.intersectObject(this.water, false, this.hits);
      for (let i = n; i < this.hits.length; i++) if (!best || this.hits[i].distance < best.distance) best = this.hits[i];
    }
    if (!best) return hit;
    const obj = best.object as THREE.Mesh;
    hit.point.copy(best.point);
    if (best.face) hit.normal.copy(best.face.normal).applyNormalMatrix(this.tmpN.getNormalMatrix(obj.matrixWorld)).normalize();
    else hit.normal.set(0, 0, 1);
    hit.local.copy(best.point);
    this.root.worldToLocal(hit.local);
    const kind = (obj.userData.kind || 'soft') as HitKind;
    hit.kind = kind;
    if (kind === 'tooth') {
      const tv = this.teeth[obj.userData.index as number];
      if (!tv) { hit.kind = 'soft'; return hit; }
      hit.tooth = tv.index;
      const lp = tv.mesh.worldToLocal(this.tmpV.copy(best.point));
      hit.u = Math.atan2(lp.x, lp.z) / (Math.PI * 2) + 0.5;
      hit.v = Math.min(1, lp.y / tv.h);
      if (obj !== tv.mesh) {
        // a tartar lump: use the deposit's own coordinates so the brush lands on it
        const dv = this.deposits.get(obj.userData.dep as number);
        if (dv) { hit.u = dv.dep.u; hit.v = dv.dep.v; }
      }
    }
    return hit;
  }

  // ---------------------------------------------------------------- per-frame visuals

  uploadDirty() {
    for (const tv of this.teeth) {
      if (!tv) continue;
      const td = this.model.teeth[tv.index];
      if (!td.changed) continue;
      uploadDirt(tv.tm, td.plaque, td.stain, td.polish);
      td.changed = false;
    }
  }

  update(dt: number, time: number, buzz: number, tutorialDep: number, eagle: number) {
    this.shared.uTime.value = time;
    // deposits shrink and crack as they lose hp, wobble when hit, buzz under the ultrasonic
    for (const dv of this.deposits.values()) {
      const d = dv.dep;
      if (d.popped) continue;
      const frac = d.hp / d.hp0;
      // weakened deposits shrink and darken as they crack
      dv.mat.color.copy(dv.color).multiply(this.tmpC.setRGB(0.62 + 0.38 * frac, 0.52 + 0.48 * frac, 0.4 + 0.6 * frac));
      const target = dv.base * (0.42 + 0.58 * Math.pow(frac, 0.8));
      dv.shown += (target - dv.shown) * Math.min(1, dt * 14);
      const since = this.model.time - d.lastHit;
      let jig = 0;
      if (since < 0.18) jig = (0.18 - since) * 0.35;
      const s = dv.shown * (1 + jig * Math.sin(time * 70));
      dv.mesh.scale.set(s, s * (0.75 + 0.25 * frac), s);
      const b = since < 0.1 ? buzz : 0;
      dv.mesh.position.copy(dv.pos);
      if (b > 0) dv.mesh.position.x += Math.sin(time * 190) * 0.012 * b;
      const glow = d.id === tutorialDep ? 0.35 + 0.3 * Math.sin(time * 6) : 0;
      dv.mat.emissiveIntensity = Math.max(glow, eagle * 0.6, since < 0.08 ? 0.25 : 0);
      dv.mat.emissive.set(since < 0.08 && glow === 0 && eagle === 0 ? '#FFF1C0' : '#FF5FB0');
    }
    for (const dv of this.debris.values()) {
      if (dv.deb.popped) continue;
      const since = this.model.time - dv.deb.lastHit;
      const w = since < 0.35 ? (0.35 - since) * 0.25 : 0;
      dv.obj.position.copy(dv.base);
      dv.obj.position.x += Math.sin(time * 45) * w;
      dv.obj.position.y += Math.cos(time * 38) * w * 0.5;
    }
    // bits being sucked or sinking
    for (let i = this.bitAnims.length - 1; i >= 0; i--) {
      const a = this.bitAnims[i];
      a.t += dt * (a.mode === 'suck' ? 5 : 1.6);
      const k = Math.min(1, a.t);
      this.tmpV.lerpVectors(a.from, a.to, a.mode === 'suck' ? k * k : k);
      const sc = a.mode === 'suck' ? 1 - k * 0.8 : 1 - k * 0.3;
      this.tmpM.compose(this.tmpV, this.tmpQ.identity(), this.tmpV2.set(sc, sc, sc));
      this.bitsMesh.setMatrixAt(a.slot, this.tmpM);
      if (k >= 1) {
        if (!a.keep) {
          this.bitsMesh.setMatrixAt(a.slot, this.tmpM.makeScale(0, 0, 0));
          this.freeSlots.push(a.slot);
        }
        this.bitAnims.splice(i, 1);
      }
      this.bitsMesh.instanceMatrix.needsUpdate = true;
    }
    // water
    const wl = this.model.water;
    this.waterLevel += (wl - this.waterLevel) * Math.min(1, dt * 4);
    this.water.visible = this.waterLevel > 0.012;
    this.water.position.y = -2.62 + this.waterLevel * 2.1;
    this.water.position.y += this.jaw * 1.6;
    this.waterMat.time.value = time;
    // jaw
    this.lower.position.y = this.jaw * 1.62;
    if (this.lowerLip) this.lowerLip.position.y = this.jaw * 0.9;
    // decays
    for (const tv of this.teeth) {
      if (!tv) continue;
      if (tv.tm.flash.value > 0) tv.tm.flash.value = Math.max(0, tv.tm.flash.value - dt * 1.6);
      if (tv.tm.wet.value > 0) tv.tm.wet.value = Math.max(0, tv.tm.wet.value - dt * 0.35);
    }
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- events

  popDeposit(d: TartarDeposit, out: THREE.Vector3): THREE.Vector3 {
    const dv = this.deposits.get(d.id);
    if (!dv) return out.set(0, 0, 0);
    this.deposits.delete(d.id);
    const i = this.pickSolid.indexOf(dv.mesh);
    if (i >= 0) this.pickSolid.splice(i, 1);
    dv.mesh.getWorldPosition(out);
    const n = this.tmpV.copy(dv.normal).transformDirection(dv.mesh.parent!.matrixWorld);
    this.fx.group.attach(dv.mesh);
    dv.mat.emissiveIntensity = 0;
    const sp = 2.5 + Math.random() * 1.5;
    this.fx.fly(dv.mesh, n.x * sp + (Math.random() - 0.5), n.y * sp + 3.2, n.z * sp + 1.2, 1.5, () => {
      dv.mesh.removeFromParent();
      dv.mat.dispose();
    });
    return out;
  }

  popDebris(d: Debris, out: THREE.Vector3): THREE.Vector3 {
    const dv = this.debris.get(d.id);
    if (!dv) return out.set(0, 0, 0);
    this.debris.delete(d.id);
    dv.obj.getWorldPosition(out);
    const a = this.teeth[d.a];
    const nx = a ? a.p.nx : 0, nz = a ? a.p.nz : 1;
    this.fx.group.attach(dv.obj);
    this.fx.fly(dv.obj, nx * 3 + (Math.random() - 0.5), 4.2, nz * 3 + 1.5, 1.6, () => { dv.obj.removeFromParent(); });
    return out;
  }

  addBit(b: LooseBit) {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return;
    this.bitSlot.set(b.id, slot);
    // settle on whatever is below (tongue or gum)
    this.raycaster.set(this.tmpV.set(b.x, 1.5, b.z).applyMatrix4(this.lower.matrixWorld), this.tmpV2.set(0, -1, 0));
    this.raycaster.far = 6;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.pickSolid, false, this.hits);
    const h = this.hits.find((x) => x.object.userData.kind === 'tongue' || x.object.userData.kind === 'gum');
    if (h) b.y = this.lower.worldToLocal(h.point.clone()).y + 0.03;
    const q = this.tmpQ.setFromAxisAngle(this.tmpV2.set(0, 1, 0), Math.random() * 6);
    this.tmpM.compose(this.tmpV.set(b.x, b.y, b.z), q, this.tmpV2.setScalar(0.8 + Math.random() * 0.5));
    this.bitsMesh.setMatrixAt(slot, this.tmpM);
    this.bitsMesh.instanceMatrix.needsUpdate = true;
  }

  suckBit(b: LooseBit, tipWorld: THREE.Vector3) {
    const slot = this.bitSlot.get(b.id);
    if (slot === undefined) return;
    this.bitSlot.delete(b.id);
    const to = this.lower.worldToLocal(tipWorld.clone());
    this.bitAnims.push({ slot, from: new THREE.Vector3(b.x, b.y, b.z), to, t: 0, mode: 'suck', keep: false });
  }

  /** A rinsed bit drifts down into the puddle (it still counts as mess until suctioned). */
  sinkBit(b: LooseBit) {
    const slot = this.bitSlot.get(b.id);
    if (slot === undefined) return;
    const from = new THREE.Vector3(b.x, b.y, b.z);
    b.x *= 0.85; b.z = b.z * 0.85 - 0.15; b.y = -2.2;
    this.bitAnims.push({ slot, from, to: new THREE.Vector3(b.x, b.y, b.z), t: 0, mode: 'sink', keep: true });
  }

  removeBitNow(b: LooseBit) {
    const slot = this.bitSlot.get(b.id);
    if (slot === undefined) return;
    this.bitSlot.delete(b.id);
    for (let i = this.bitAnims.length - 1; i >= 0; i--) if (this.bitAnims[i].slot === slot) this.bitAnims.splice(i, 1);
    this.bitsMesh.setMatrixAt(slot, this.tmpM.makeScale(0, 0, 0));
    this.bitsMesh.instanceMatrix.needsUpdate = true;
    this.freeSlots.push(slot);
  }

  /** Gap line on screen for floss swipes: gumline point and crown tip point in world space. */
  gapPoints(a: number, b: number, gum: THREE.Vector3, tip: THREE.Vector3): boolean {
    const ta = this.teeth[a], tb = this.teeth[b];
    if (!ta || !tb) return false;
    const pa = ta.p, pb = tb.p;
    const nx = (pa.nx + pb.nx) / 2, nz = (pa.nz + pb.nz) / 2;
    const h = Math.min(ta.h, tb.h);
    const ga = ta.group.getWorldPosition(this.tmpV);
    const gb = tb.group.getWorldPosition(this.tmpV2);
    gum.addVectors(ga, gb).multiplyScalar(0.5);
    gum.x += nx * 0.3; gum.z += nz * 0.3;
    tip.copy(gum);
    tip.y += pa.dir * h * 0.95;
    gum.y -= pa.dir * 0.1;
    return true;
  }

  setJaw(v: number) { this.jaw = v; }

  dispose() {
    this.fx.dispose();
    const mats = new Set<THREE.Material>();
    const geos = new Set<THREE.BufferGeometry>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      if (m.geometry) geos.add(m.geometry);
      const mm = m.material;
      if (Array.isArray(mm)) mm.forEach((x) => mats.add(x)); else if (mm) mats.add(mm);
    });
    // GLB source geometry/materials are shared with the loader cache: only dispose clones we own
    for (const d of this.disposables) d.dispose();
    for (const tv of this.teeth) if (tv) { tv.tm.texture.dispose(); tv.tm.material.dispose(); }
    for (const m of mats) if ((m as any).__fbOwned !== false) m.dispose();
    this.bitsMesh.dispose();
    this.scene.clear();
    void geos;
  }
}

function firstMesh(o: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  o.traverse((c) => { if (!found && (c as THREE.Mesh).isMesh) found = c as THREE.Mesh; });
  return found;
}

/** A polar grid disc for the water (vertex waves need interior vertices). */
function waterGeometry(): THREE.BufferGeometry {
  const R = 14, S = 64;
  const pos: number[] = [0, 0, 0];
  for (let r = 1; r <= R; r++) {
    for (let s = 0; s < S; s++) {
      const a = (s / S) * Math.PI * 2;
      const k = r / R;
      pos.push(Math.cos(a) * 5.4 * k, 0, Math.sin(a) * 3.3 * k - 0.35);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < S; s++) idx.push(0, 1 + ((s + 1) % S), 1 + s);
  for (let r = 1; r < R; r++) {
    for (let s = 0; s < S; s++) {
      const a = 1 + (r - 1) * S + s, b = 1 + (r - 1) * S + ((s + 1) % S);
      const c = 1 + r * S + s, d = 1 + r * S + ((s + 1) % S);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the surface faces up
  const n = g.getAttribute('normal');
  if (n.getY(0) < 0) {
    const arr = g.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}
