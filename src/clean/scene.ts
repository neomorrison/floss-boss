// The 3D mouth: lights, teeth (per-tooth dirt textures), gums, palate, tongue, cavity, lips, skin, throat,
// tartar deposits and barnacles, debris, gum pockets, brackets and wire, sugar bugs, loose bits, water,
// floss string and hands, markers, rings and the tool models. GLBs from the art-mouth builder are used
// when present; every piece has a procedural fallback (geometry.ts).
//
// Picking tests the small things first (teeth, deposits, brackets, bugs, pockets), then low-poly invisible
// proxies of the soft tissue, so a pick costs a few thousand triangle tests instead of ~35k.
import * as THREE from 'three';
import type { ToothKind } from '../core/types';
import { LOWER_GUM_Y, TEETH_PER_ARCH, TOOTH_DIMS, UPPER_GUM_Y, type ToothPlacement } from '../core/mouth';
import { makeRng } from '../core/rng';
import type { CleanModel, Debris, LooseBit, Pocket, SugarBug, TartarDeposit } from './dirt';
import { MAX_BITS, sideU } from './dirt';
import {
  barnacleGeometry, bracketGeometry, cavityGeometry, debrisGeometry, flatRingGeometry, gumGeometry, lipsGeometry, normalizeToothGeometry,
  palateGeometry, pocketGeometry, skinGeometry, skirtGeometry, sugarBugModel, tartarGeometry, throatGeometry, toolModel, toothGeometry,
  tongueGeometry, type ToolParts,
} from './geometry';
import {
  cavityMaterial, disposeToothMat, getEnvironment, getGlowTexture, getRingTexture, gumMaterial, lipsMaterial, makeSharedToothUniforms, makeToothMaterial,
  makeWaterMaterial, skinMaterial, throatMaterial, tongueMaterial, uploadDirt, type SharedToothUniforms, type ToothMat, type WaterMat,
} from './materials';
import { Fx } from './fx';
import type { SlotId } from './slots';

export type Models = Record<string, THREE.Object3D | null>;

export type HitKind = 'tooth' | 'gum' | 'tongue' | 'water' | 'soft' | 'face' | 'bracket' | 'pocket' | 'none';
export interface Hit {
  kind: HitKind;
  tooth: number;           // tooth index for 'tooth' and 'bracket' hits
  u: number; v: number;
  pocket: number;          // pocket id for 'pocket' hits
  point: THREE.Vector3;    // world
  normal: THREE.Vector3;   // world
  local: THREE.Vector3;    // mouth-root space
}
export const makeHit = (): Hit => ({ kind: 'none', tooth: -1, u: 0, v: 0, pocket: -1, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), local: new THREE.Vector3() });

export interface ToothView {
  index: number;
  p: ToothPlacement;
  group: THREE.Group;      // position + yaw (in its arch group)
  flip: THREE.Group;       // upper teeth rotated pi about Z
  mesh: THREE.Mesh;
  tm: ToothMat;
  h: number;
  ring: THREE.Mesh | null; // problem-tooth glow ring
  ringFade: number;        // -1 alive; 0..1 snapping out
  sore: THREE.Mesh | null; // sensitive gums: faint red glow
}

interface DepositView {
  dep: TartarDeposit; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; base: number; normal: THREE.Vector3; pos: THREE.Vector3;
  shown: number; color: THREE.Color; crack: { value: number }; reveal: number;
}
interface DebrisView { deb: Debris; obj: THREE.Object3D; base: THREE.Vector3; wob: number }
interface BugView { bug: SugarBug; group: THREE.Group; legs: THREE.Object3D[]; squash: number; last: THREE.Vector3; fwd: THREE.Vector3 }
interface PocketView { pk: Pocket; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; heal: number }
export interface ToolView { holder: THREE.Group; parts: ToolParts; spinner: THREE.Object3D | null }

const SKINS = ['#F6D3B8', '#EDBE9A', '#D9A37C', '#B77B55', '#8D5A3C', '#F2C8A6'];
const RING_COL = new THREE.Color('#1FE0B4');
const EMISSIVE_HIT = new THREE.Color('#FFF1C0');
const EMISSIVE_GLOW = new THREE.Color('#FF5FB0');
const POCKET_RED = new THREE.Color('#FFFFFF');
const POCKET_OPEN = new THREE.Color('#A8404F');
const POCKET_PINK = new THREE.Color('#FFE0E6');
const GLOVE = '#B9A8FF';

export interface SceneOptions { lowQuality: boolean; headlamp: boolean; procedural: boolean; slots: SlotId[]; slotModels: Record<string, string> }

const CRACK_GLSL_V = 'varying vec3 vCrackPos;';
const CRACK_NOISE = /* glsl */`
float ckHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ckNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ckHash(i), ckHash(i + vec3(1,0,0)), f.x), mix(ckHash(i + vec3(0,1,0)), ckHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ckHash(i + vec3(0,0,1)), ckHash(i + vec3(1,0,1)), f.x), mix(ckHash(i + vec3(0,1,1)), ckHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

/** Deposit material with crack veins that grow with the crack stage (0 none, 1 hairline, 2 big cracks). */
function crackable(mat: THREE.MeshStandardMaterial, crack: { value: number }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCrack = crack;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CRACK_GLSL_V}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrackPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CRACK_GLSL_V}\nuniform float uCrack;\n${CRACK_NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uCrack > 0.5) {
  float n1 = ckNoise(vCrackPos * 26.0);
  float n2 = ckNoise(vCrackPos * 13.0 + 5.0);
  float l1 = 1.0 - smoothstep(0.0, 0.035, abs(n1 - 0.5));
  float l2 = (1.0 - smoothstep(0.0, 0.06, abs(n2 - 0.5))) * step(1.5, uCrack);
  diffuseColor.rgb *= 1.0 - 0.8 * max(l1, l2);
}`);
  };
  mat.customProgramCacheKey = () => 'fbCrack1';
}

export class MouthScene {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly teeth: (ToothView | null)[] = [];
  readonly shared: SharedToothUniforms = makeSharedToothUniforms();
  readonly fx: Fx;
  readonly tools = {} as Record<SlotId, ToolView>;
  readonly toolRoot = new THREE.Group();
  readonly gums: THREE.Mesh[] = [];
  readonly gumMat: THREE.MeshPhysicalMaterial;
  /** Every gum material in use (procedural or cloned from the GLB): flashed red on gum hits. */
  readonly gumMats: THREE.MeshStandardMaterial[] = [];
  readonly water: THREE.Mesh;
  readonly waterMat: WaterMat;
  readonly key: THREE.SpotLight;
  private pickSmall: THREE.Object3D[] = [];
  private pickSoft: THREE.Object3D[] = [];
  private floorProxies: THREE.Object3D[] = [];
  private deposits = new Map<number, DepositView>();
  private debris = new Map<number, DebrisView>();
  private bugViews = new Map<number, BugView>();
  private pocketViews = new Map<number, PocketView>();
  private brackets: THREE.InstancedMesh[] = [];
  private bitsMesh: THREE.InstancedMesh;
  private bitSlot = new Map<number, number>();
  private bitById = new Map<number, LooseBit>();
  private freeSlots: number[] = [];
  private bitAnims: { slot: number; bit: LooseBit | null; from: THREE.Vector3; to: THREE.Vector3; t: number; mode: 'suck' | 'float' }[] = [];
  private ndc = new THREE.Vector2();
  private lowerLip: THREE.Object3D | null = null;
  private lowerLipY = 0;
  private raycaster = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpN = new THREE.Matrix3();
  private tmpC = new THREE.Color();
  private owned = new Set<{ dispose(): void }>();
  private shared3 = new Set<unknown>();   // GLB geometry / materials shared with the loader cache
  // case visuals
  private wrapRing: THREE.Mesh;
  private wrapMat: THREE.MeshBasicMaterial;
  private markers: THREE.Sprite[] = [];
  private markerMat: THREE.SpriteMaterial;
  private string: THREE.Mesh;
  private stringGeo: THREE.BufferGeometry;
  private stringMat: THREE.MeshStandardMaterial;
  private hands: THREE.Mesh[] = [];
  private lampLight: THREE.PointLight | null = null;
  private lampCone: THREE.Mesh | null = null;
  private lampOn = 0;
  private splats: { mesh: THREE.Mesh; t: number }[] = [];
  private splatGeo: THREE.BufferGeometry;
  private coinSpin: THREE.Object3D | null = null;
  waterLevel = 0;
  jaw = 0;

  constructor(renderer: THREE.WebGLRenderer, private model: CleanModel, models: Models, private opts: SceneOptions) {
    const s = this.scene;
    s.background = new THREE.Color('#F3D2BE');
    s.environment = getEnvironment(renderer);
    s.environmentIntensity = 0.55;
    s.add(this.root, this.toolRoot);
    this.root.add(this.upper, this.lower);
    const own = <T extends { dispose(): void }>(x: T): T => { this.owned.add(x); return x; };

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

    // --- soft tissue (visible)
    const rng = makeRng(model.setup.seed ^ 0xface);
    const skinCol = model.setup.patient.archetype === 'mannequin' ? '#F0D9C8' : model.setup.patient.archetype === 'pirate' ? '#D9A37C' : SKINS[rng.int(0, SKINS.length - 1)];
    const frame = opts.procedural ? null : models.mouth_frame;
    if (frame) {
      const f = frame.clone(true);
      this.markShared(f);
      f.traverse((o) => {
        const m = o as THREE.Mesh;
        if (/lip.?lower|lower.?lip/i.test(o.name) && !this.lowerLip) { this.lowerLip = o; this.lowerLipY = o.position.y; }
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && /skin/i.test(mat.name)) { m.material = own(mat.clone()); (m.material as THREE.MeshStandardMaterial).color.set(skinCol); }
        m.castShadow = false;
        m.receiveShadow = false;
        if (/throat/i.test(mat?.name || '')) { m.visible = false; return; }
      });
      this.root.add(f);
      const throat = this.mesh(throatGeometry(), own(throatMaterial()));
      throat.name = 'throat';
      this.root.add(throat);
    } else {
      const lipsM = own(lipsMaterial());
      const up = this.mesh(lipsGeometry('upper'), lipsM);
      const lo = this.mesh(lipsGeometry('lower'), lipsM);
      this.lowerLip = lo;
      const skin = this.mesh(skinGeometry(), own(skinMaterial(skinCol)));
      skin.receiveShadow = true;
      const throat = this.mesh(throatGeometry(), own(throatMaterial()));
      up.name = 'lipsUpper'; lo.name = 'lipsLower'; skin.name = 'skin'; throat.name = 'throat';
      this.root.add(up, lo, skin, throat);
    }
    const cav = this.mesh(cavityGeometry(), own(cavityMaterial()));
    cav.name = 'cavity';
    this.root.add(cav);

    const tongueSrc = opts.procedural ? null : models.tongue;
    const tongue = tongueSrc ? this.adopt(tongueSrc) : this.mesh(tongueGeometry(), own(tongueMaterial()));
    this.lower.add(tongue);

    // --- gums
    this.gumMat = own(gumMaterial());
    this.gumMats.push(this.gumMat);
    const missing = new Set(model.setup.missingTeeth);
    for (const arch of ['upper', 'lower'] as const) {
      const src = opts.procedural ? null : models[`gum_${arch}`];
      let g: THREE.Object3D;
      if (src && missing.size === 0) {
        g = this.adopt(src);
        g.position.y = arch === 'upper' ? UPPER_GUM_Y : LOWER_GUM_Y;
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mat = own((m.material as THREE.MeshStandardMaterial).clone());
          mat.emissive = new THREE.Color('#ff0000');
          mat.emissiveIntensity = 0;
          m.material = mat;
          this.gumMats.push(mat);
          this.gums.push(m);
        });
      } else {
        const m = this.mesh(gumGeometry({ arch, placements: model.placements, missing }), this.gumMat);
        m.receiveShadow = true;
        this.gums.push(m);
        g = m;
      }
      (arch === 'upper' ? this.upper : this.lower).add(g);
      if (arch === 'upper' && !(src && missing.size === 0)) {
        const palate = this.mesh(palateGeometry(), own(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.3, side: THREE.BackSide })));
        palate.name = 'palate';
        this.upper.add(palate);
      }
    }
    const skirt = this.mesh(skirtGeometry(), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide })));
    skirt.name = 'skirt';
    this.lower.add(skirt);

    // --- pick proxies: low-poly, invisible, moving with their arch
    this.buildProxies(missing);

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
        own(g);
      }
      return g;
    };
    const ringGeo = own(flatRingGeometry(0.075));
    const sensitive = model.tw.sensitive;
    const gelCol = model.caseType === 'whitening' ? '#8FE3FF' : '#F4FBFF';
    for (const p of model.placements) {
      const td = model.teeth[p.index];
      if (!td.present) { this.teeth.push(null); continue; }
      const dims = TOOTH_DIMS[p.kind];
      const tm = makeToothMaterial(dims.h, this.shared, p.kind === 'incisor' || p.kind === 'canine' ? 1 : 0.4);
      tm.gold.value = td.gold ? 1 : 0;
      tm.gelCol.value.set(gelCol);
      tm.shade.value = shadeTint(td.shade);
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
      this.pickSmall.push(mesh);
      uploadDirt(tm, td.plaque, td.stain, td.polish, td.paste, td.gel);
      td.changed = false;
      let ring: THREE.Mesh | null = null, sore: THREE.Mesh | null = null;
      if (td.problem && !td.snapped) {
        ring = new THREE.Mesh(ringGeo, own(new THREE.MeshBasicMaterial({ color: RING_COL, transparent: true, opacity: 0.7, depthWrite: false })));
        ring.scale.set(p.width * 0.62, 1, p.depth * 0.66);
        ring.position.y = 0.1;
        ring.renderOrder = 4;
        flip.add(ring);
        if (sensitive) {
          // a soft red glow on the gum just outside the tooth's neck
          const sm = own(new THREE.SpriteMaterial({ map: getGlowTexture(), color: "#FF2D55", transparent: true, opacity: 0.3, depthWrite: false }));
          const sp = new THREE.Sprite(sm);
          sp.position.set(0, -0.16, p.depth * 0.5 + 0.34);
          sp.scale.set(p.width * 1.3, 0.5, 1);
          flip.add(sp);
          sore = sp as unknown as THREE.Mesh;
        }
      }
      this.teeth.push({ index: p.index, p, group, flip, mesh, tm, h: dims.h, ring, ringFade: -1, sore });
    }
    this.scene.updateMatrixWorld(true);

    // --- tartar deposits and barnacles
    const tartarGeo: THREE.BufferGeometry[] = [];
    const tartarSrcMat: (THREE.MeshStandardMaterial | null)[] = [];
    for (let v = 0; v < 4; v++) {
      const key = v < 3 ? `tartar_${'abc'[v]}` : 'tartar_barnacle';
      const src = opts.procedural ? null : models[key];
      const m = src ? firstMesh(src) : null;
      if (m) {
        m.updateWorldMatrix(true, false);
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const sc = 0.34 / Math.max(1e-3, Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z));
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        g.scale(sc, sc, sc);
        tartarGeo.push(own(g));
        tartarSrcMat.push(m.material as THREE.MeshStandardMaterial);
      } else {
        tartarGeo.push(own(v < 3 ? tartarGeometry(v) : barnacleGeometry(0)));
        tartarSrcMat.push(null);
      }
    }
    const drng = makeRng(model.setup.seed ^ 0x7a57);
    for (const dep of model.tartar) {
      const tv = this.teeth[dep.tooth];
      if (!tv) continue;
      const hit = this.surfacePoint(tv, dep.u, Math.max(0.03, dep.v));
      const vi = dep.kind === 'barnacle' ? 3 : dep.variant;
      const src = tartarSrcMat[vi];
      const mat = own(src ? (src.clone() as THREE.MeshStandardMaterial) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: dep.kind === 'barnacle' ? 0.7 : 0.95, metalness: 0, envMapIntensity: 0.3 }));
      mat.emissive = new THREE.Color('#FF5FB0');
      mat.emissiveIntensity = 0;
      const crack = { value: 0 };
      crackable(mat, crack);
      const mesh = new THREE.Mesh(tartarGeo[vi], mat);
      mesh.castShadow = true;
      const lp = tv.flip.worldToLocal(hit.point.clone());
      const ln = hit.normal.clone().transformDirection(this.tmpM.copy(tv.flip.matrixWorld).invert()).normalize();
      mesh.position.copy(lp).addScaledVector(ln, -0.02);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ln);
      mesh.rotateY(drng.range(0, Math.PI * 2));
      const base = Math.sqrt(dep.size) * drng.range(1.0, 1.2) * (dep.kind === 'barnacle' ? 1.05 : 1);
      mesh.scale.setScalar(base);
      mesh.userData = { kind: 'tooth', index: dep.tooth, dep: dep.id };
      tv.flip.add(mesh);
      if (dep.hidden) mesh.visible = false;
      else this.pickSmall.push(mesh);
      this.deposits.set(dep.id, { dep, mesh, mat, base, normal: ln, pos: mesh.position.clone(), shown: 1, color: mat.color.clone(), crack, reveal: dep.hidden ? 0 : 1 });
    }

    // --- gum pockets (deep cleaning)
    if (model.pockets.length) {
      const pg = own(pocketGeometry());
      for (const pk of model.pockets) {
        const tv = this.teeth[pk.tooth];
        if (!tv) continue;
        const mat = own(new THREE.MeshStandardMaterial({ color: POCKET_RED.clone(), vertexColors: true, roughness: 0.3, emissive: '#FF2040', emissiveIntensity: 0.2 }));
        const mesh = new THREE.Mesh(pg, mat);
        const group = tv.p.arch === 'upper' ? this.upper : this.lower;
        // on the outer gum surface just past the tooth's neck (arch-group space, rest pose)
        const p = tv.p, nx = p.nx, nz = p.nz;
        const a = p.depth / 2 + 0.1;
        const du = (pk.u - 0.5) * Math.PI * (p.width + p.depth) * 0.5 * (p.arch === 'upper' ? -1 : 1);
        mesh.position.set(p.x + nx * a + nz * du, (p.arch === 'upper' ? 0.07 : -0.07), p.z + nz * a - nx * du);
        mesh.position.y += group === this.upper ? UPPER_GUM_Y - this.upper.position.y : LOWER_GUM_Y - this.lower.position.y;
        this.tmpM.makeBasis(this.tmpV.set(nz, 0, -nx), this.tmpV2.set(0, 1, 0), this.tmpV3.set(nx, 0, nz));
        mesh.quaternion.setFromRotationMatrix(this.tmpM);
        mesh.scale.set(tv.p.width * 1.3, 1.6, 1.6);
        mesh.userData = { kind: 'pocket', pocket: pk.id, index: pk.tooth, base: 1.3 };
        group.add(mesh);
        this.pickSmall.push(mesh);
        this.pocketViews.set(pk.id, { pk, mesh, mat, heal: 0 });
      }
    }

    // --- braces: brackets on the outward faces of arch positions 2..11 and a wire per arch
    if (model.setup.special?.braces) {
      const bsrc = opts.procedural ? null : models.bracket;
      const bm = bsrc ? firstMesh(bsrc) : null;
      let bgeo: THREE.BufferGeometry;
      if (bm) {
        bm.updateWorldMatrix(true, false);
        bgeo = bm.geometry.clone().applyMatrix4(bm.matrixWorld);
        bgeo.computeBoundingBox();
        const bb = bgeo.boundingBox!;
        const sc = 0.27 / Math.max(1e-3, bb.max.x - bb.min.x);
        bgeo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
        bgeo.scale(sc, sc, sc);
      } else bgeo = bracketGeometry();
      own(bgeo);
      const bmat = own(new THREE.MeshStandardMaterial({ color: '#DCE4EA', metalness: 0.9, roughness: 0.22 }));
      const wireMat = own(new THREE.MeshStandardMaterial({ color: '#C9D3DA', metalness: 0.95, roughness: 0.18 }));
      for (const arch of [0, 1]) {
        const archGroup = arch === 0 ? this.upper : this.lower;
        const pts: THREE.Vector3[] = [];
        const mats: THREE.Matrix4[] = [];
        const owners: number[] = [];
        for (let pos = 2; pos <= 11; pos++) {
          const tv = this.teeth[arch * TEETH_PER_ARCH + pos];
          if (!tv || !this.model.teeth[tv.index].bracket) continue;
          const sp = this.surfacePoint(tv, 0.5, 0.5);
          // one instance per bracket, in arch space so it rides the jaw
          const lp = archGroup.worldToLocal(sp.point.clone());
          const ln = sp.normal.clone().transformDirection(this.tmpM.copy(archGroup.matrixWorld).invert()).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ln);
          mats.push(new THREE.Matrix4().compose(lp, q, new THREE.Vector3(1.2, 1.2, 1.2)));
          owners.push(tv.index);
          pts.push(archGroup.worldToLocal(sp.point.clone().addScaledVector(sp.normal, 0.1)));
        }
        if (mats.length) {
          const inst = new THREE.InstancedMesh(bgeo, bmat, mats.length);
          mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.castShadow = true;
          inst.userData = { kind: 'bracket', owners };
          archGroup.add(inst);
          this.brackets.push(inst);
          this.pickSmall.push(inst);
        }
        if (pts.length >= 2) {
          // run a little past the end brackets
          const a = pts[0].clone().sub(pts[1]).normalize().multiplyScalar(0.25).add(pts[0]);
          const b = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize().multiplyScalar(0.25).add(pts[pts.length - 1]);
          const curve = new THREE.CatmullRomCurve3([a, ...pts, b]);
          const wire = new THREE.Mesh(own(new THREE.TubeGeometry(curve, pts.length * 8, 0.026, 6, false)), wireMat);
          wire.castShadow = true;
          archGroup.add(wire);
        }
      }
    }

    // --- debris wedged in gaps (or under the wire at a bracket)
    for (const deb of model.debris) {
      const a = this.teeth[deb.a], b = this.teeth[deb.b];
      if (!a || !b) continue;
      const group = a.p.arch === 'upper' ? this.upper : this.lower;
      const mid = new THREE.Vector3();
      let nx = a.p.nx, nz = a.p.nz;
      if (deb.bracket) {
        const sp = this.surfacePoint(a, 0.5, 0.33);
        mid.copy(sp.point).addScaledVector(sp.normal, 0.1);
      } else {
        const pa = this.surfacePoint(a, sideU(a.p, deb.b), deb.v).point.clone();
        const pb = this.surfacePoint(b, sideU(b.p, deb.a), deb.v).point.clone();
        mid.copy(pa.add(pb).multiplyScalar(0.5));
        nx = (a.p.nx + b.p.nx) / 2; nz = (a.p.nz + b.p.nz) / 2;
        mid.x += nx * (deb.kind === 'doubloon' ? 0.26 : 0.1); mid.z += nz * (deb.kind === 'doubloon' ? 0.26 : 0.1);
      }
      const key = deb.kind === 'doubloon' ? 'doubloon' : `debris_${deb.kind}`;
      const src = opts.procedural ? null : models[key];
      let obj: THREE.Object3D;
      const target = deb.kind === 'doubloon' ? 0.5 : deb.kind === 'seaweed' ? 0.5 : 0.34;
      if (src) {
        const inner = src.clone(true);
        this.markShared(inner);
        const bb = new THREE.Box3().setFromObject(inner);
        const sz = bb.getSize(this.tmpV);
        inner.scale.multiplyScalar(target / Math.max(0.01, sz.length()));
        if (deb.kind === 'doubloon') {
          // turn the coin so its face (thinnest axis) looks out of the gap
          if (sz.y <= sz.x && sz.y <= sz.z) inner.rotation.x = Math.PI / 2;
          else if (sz.x <= sz.y && sz.x <= sz.z) inner.rotation.y = Math.PI / 2;
        }
        obj = new THREE.Group();
        obj.add(inner);
      } else {
        const dg = debrisGeometry(deb.kind);
        own(dg.geo);
        obj = new THREE.Mesh(dg.geo, own(new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: dg.rough, metalness: dg.metal ?? 0,
          side: deb.kind === 'spinach' || deb.kind === 'seaweed' ? THREE.DoubleSide : THREE.FrontSide,
        })));
        obj.scale.setScalar(deb.kind === 'doubloon' ? 1.1 : 1.35);
      }
      obj.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      group.worldToLocal(mid);
      obj.position.copy(mid);
      obj.lookAt(this.tmpV.set(mid.x + nx, mid.y, mid.z + nz));
      if (deb.kind === 'doubloon') obj.rotateX(0.35 * (a.p.arch === 'upper' ? -1 : 1));
      else if (deb.kind === 'seaweed') { if (a.p.arch === 'upper') obj.rotateZ(Math.PI); }
      else obj.rotateZ(drng.range(-0.6, 0.6));
      group.add(obj);
      this.debris.set(deb.id, { deb, obj, base: obj.position.clone(), wob: 0 });
    }

    // --- sugar bugs
    if (model.bugs.length) {
      const src = opts.procedural ? null : models.sugar_bug;
      for (const bug of model.bugs) {
        let group: THREE.Group;
        let legs: THREE.Object3D[] = [];
        if (src) {
          group = new THREE.Group();
          const o = src.clone(true);
          this.markShared(o);
          const bb = new THREE.Box3().setFromObject(o);
          const size = bb.getSize(this.tmpV);
          o.scale.multiplyScalar(0.34 / Math.max(0.01, Math.max(size.x, size.z)));
          o.position.y = -bb.min.y * o.scale.y;
          group.add(o);
        } else {
          const bm = sugarBugModel();
          for (const m of bm.mats) own(m);
          for (const g of bm.geos) own(g);
          group = bm.group;
          legs = bm.legs;
        }
        group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData = { kind: 'tooth', index: bug.tooth, bug: bug.id }; this.pickSmall.push(o); } });
        this.root.add(group);
        this.bugViews.set(bug.id, { bug, group, legs, squash: 0, last: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) });
      }
    }
    this.splatGeo = own(new THREE.CircleGeometry(0.16, 16));

    // --- loose bits (instanced crumbs on the tongue, floating in the water)
    const bg = own(new THREE.DodecahedronGeometry(0.1, 0));
    bg.scale(1, 0.7, 1.1);
    this.bitsMesh = new THREE.InstancedMesh(bg, own(new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.85, flatShading: true })), MAX_BITS);
    this.bitsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bitsMesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_BITS; i++) { this.bitsMesh.setMatrixAt(i, zero); this.bitsMesh.setColorAt(i, this.tmpC.set('#D2A945')); this.freeSlots.push(MAX_BITS - 1 - i); }
    this.lower.add(this.bitsMesh);

    // --- water pooling in the lower mouth
    this.waterMat = makeWaterMaterial();
    own(this.waterMat.material);
    this.water = new THREE.Mesh(own(waterGeometry()), this.waterMat.material);
    this.water.userData.kind = 'water';
    this.water.visible = false;
    this.water.renderOrder = 3;
    this.root.add(this.water);

    // --- fx
    this.fx = new Fx(opts.lowQuality);
    this.root.add(this.fx.group);

    // --- wrap ring (polisher / gel brush), floss markers, string and hands
    this.wrapMat = own(new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.wrapRing = new THREE.Mesh(own(flatRingGeometry(0.05)), this.wrapMat);
    this.wrapRing.visible = false;
    this.wrapRing.renderOrder = 6;
    this.markerMat = own(new THREE.SpriteMaterial({ map: getRingTexture(), color: '#6FFFE0', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(this.markerMat);
      sp.visible = false;
      sp.renderOrder = 7;
      sp.scale.setScalar(0.5);
      this.root.add(sp);
      this.markers.push(sp);
    }
    const SEG = 28;
    this.stringGeo = own(new THREE.BufferGeometry());
    this.stringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const sidx: number[] = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; sidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.stringGeo.setIndex(sidx);
    this.stringGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.stringMat = own(new THREE.MeshStandardMaterial({ color: '#F4FFFB', emissive: '#CFFFF0', emissiveIntensity: 0.35, roughness: 0.5, side: THREE.DoubleSide }));
    this.string = new THREE.Mesh(this.stringGeo, this.stringMat);
    this.string.visible = false;
    this.string.frustumCulled = false;
    this.string.renderOrder = 6;
    this.toolRoot.add(this.string);
    const handGeo = own(new THREE.CapsuleGeometry(0.075, 0.2, 6, 12));
    handGeo.rotateX(Math.PI / 2);
    const handMat = own(new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.55 }));
    for (let i = 0; i < 2; i++) {
      const h = new THREE.Mesh(handGeo, handMat);
      h.visible = false;
      h.castShadow = true;
      this.toolRoot.add(h);
      this.hands.push(h);
    }

    // --- UV lamp glow (whitening)
    if (opts.slots.includes('lamp')) {
      this.lampLight = new THREE.PointLight('#8C6BFF', 0, 3.2, 1.4);
      this.root.add(this.lampLight);
      const cg = own(new THREE.ConeGeometry(0.75, 1, 24, 1, true));
      cg.translate(0, -0.5, 0);
      this.lampCone = new THREE.Mesh(cg, own(new THREE.MeshBasicMaterial({ color: '#9C86FF', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
      this.lampCone.visible = false;
      this.lampCone.renderOrder = 6;
      this.toolRoot.add(this.lampCone);
    }

    // --- tools
    for (const slot of opts.slots) {
      const key = opts.slotModels[slot];
      const src = opts.procedural ? null : models[key];
      let parts: ToolParts;
      if (src) {
        const g = new THREE.Group();
        const obj = src.clone(true);
        this.markShared(obj);
        const bb = new THREE.Box3().setFromObject(obj);
        const len = Math.max(0.01, bb.max.y - Math.min(0, bb.min.y));
        obj.scale.multiplyScalar(7 / len);
        g.add(obj);
        let spinner: THREE.Object3D | null = null;
        obj.traverse((o) => { if (!spinner && /cup|spin|head/i.test(o.name)) spinner = o; });
        parts = { group: g, spinner, spinAxis: 'y', nozzle: new THREE.Vector3(0, 0.05, 0), string: null };
      } else {
        parts = toolModel(key);
        parts.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { own(m.geometry); const mm = m.material; if (Array.isArray(mm)) mm.forEach((x) => own(x)); else own(mm); } });
      }
      const holder = new THREE.Group();
      parts.group.scale.setScalar(0.72);
      holder.add(parts.group);
      holder.visible = false;
      this.toolRoot.add(holder);
      this.tools[slot] = { holder, parts, spinner: parts.spinner };
    }
  }

  // ---------------------------------------------------------------- building helpers

  /** Remember a GLB clone's geometry and materials: they belong to the loader cache and are never disposed here. */
  private markShared(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      this.shared3.add(m.geometry);
      const mm = m.material;
      if (Array.isArray(mm)) mm.forEach((x) => this.shared3.add(x)); else this.shared3.add(mm);
    });
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    this.owned.add(g);
    return mesh;
  }

  private adopt(src: THREE.Object3D): THREE.Object3D {
    const o = src.clone(true);
    this.markShared(o);
    o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) m.receiveShadow = true; });
    return o;
  }

  /** Invisible low-poly stand-ins for the soft tissue, used only for picking. */
  private buildProxies(missing: Set<number>) {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.owned.add(mat);
    const add = (g: THREE.BufferGeometry, kind: string, parent: THREE.Object3D, arch?: string, floor = false) => {
      const m = new THREE.Mesh(g, mat);
      this.owned.add(g);
      m.visible = false;
      m.userData = { kind, arch };
      parent.add(m);
      this.pickSoft.push(m);
      if (floor) this.floorProxies.push(m);
      return m;
    };
    add(gumGeometry({ arch: 'upper', placements: this.model.placements, missing, segments: 44 }), 'gum', this.upper, 'upper');
    add(gumGeometry({ arch: 'lower', placements: this.model.placements, missing, segments: 44 }), 'gum', this.lower, 'lower', true);
    add(skirtGeometry(), 'gum', this.lower, 'lower');
    add(palateGeometry(), 'soft', this.upper);
    add(tongueGeometry(18, 10), 'tongue', this.lower, undefined, true);
    add(lipsGeometry('upper', 36, 7), 'face', this.root);
    const lo = add(lipsGeometry('lower', 36, 7), 'face', this.root);
    lo.name = 'lipsLowerProxy';
    add(skinGeometry(40), 'face', this.root);
    add(cavityGeometry(), 'soft', this.root);
    add(throatGeometry(), 'soft', this.root);
    this.lowerLipProxy = lo;
  }
  private lowerLipProxy: THREE.Object3D | null = null;

  /** Point on a tooth surface at (u, v), found by casting from outside toward the tooth axis. */
  surfacePoint(tv: ToothView, u: number, v: number, out?: { point: THREE.Vector3; normal: THREE.Vector3 }): { point: THREE.Vector3; normal: THREE.Vector3 } {
    const th = (u - 0.5) * Math.PI * 2;
    const y = v * tv.h;
    const o = this.tmpV.set(Math.sin(th) * 2, y, Math.cos(th) * 2);
    const d = this.tmpV2.set(-Math.sin(th), 0, -Math.cos(th));
    tv.mesh.updateWorldMatrix(true, false);
    const mw = tv.mesh.matrixWorld;
    o.applyMatrix4(mw);
    d.transformDirection(mw);
    this.raycaster.set(o, d);
    this.raycaster.far = 10;
    this.hits.length = 0;
    tv.mesh.raycast(this.raycaster, this.hits);
    const res = out ?? { point: new THREE.Vector3(), normal: new THREE.Vector3() };
    let h = this.hits[0];
    for (const x of this.hits) if (x.distance < h.distance) h = x;
    if (h) {
      res.point.copy(h.point);
      if (h.face) res.normal.copy(h.face.normal).applyNormalMatrix(this.tmpN.getNormalMatrix(mw)).normalize();
      else res.normal.copy(d).negate();
      return res;
    }
    const dims = TOOTH_DIMS[tv.p.kind];
    res.point.set(Math.sin(th) * dims.w / 2, y, Math.cos(th) * dims.d / 2).applyMatrix4(mw);
    res.normal.copy(d).negate();
    return res;
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

  /** Aim assist: the unpopped, visible deposit whose lump centre is within `radius` of `p`, or null. */
  nearestDeposit(p: THREE.Vector3, radius: number): TartarDeposit | null {
    let best: TartarDeposit | null = null, bd = radius * radius;
    for (const dv of this.deposits.values()) {
      if (dv.dep.popped || dv.dep.hidden) continue;
      this.depositCenter(dv.dep.id, this.tmpV3);
      const d = this.tmpV3.distanceToSquared(p);
      if (d < bd) { bd = d; best = dv.dep; }
    }
    return best;
  }

  /**
   * QA (reachability audit): the world point of dirt cell (u, v) on tooth `i`. Side cells cast inward at
   * height v; biting-surface cells (v >= 0.86) cast down onto the crown at the idealized radius.
   */
  cellWorld(i: number, u: number, v: number, out: THREE.Vector3): THREE.Vector3 | null {
    const tv = this.teeth[i];
    if (!tv) return null;
    if (v < 0.86) return out.copy(this.surfacePoint(tv, u, v).point);
    const th = (u - 0.5) * Math.PI * 2;
    const dims = TOOTH_DIMS[tv.p.kind];
    const k = Math.max(0, (1 - v) / 0.14);
    const o = this.tmpV.set(Math.sin(th) * dims.w * 0.5 * k, tv.h * 2, Math.cos(th) * dims.d * 0.5 * k);
    const d = this.tmpV2.set(0, -1, 0);
    tv.mesh.updateWorldMatrix(true, false);
    o.applyMatrix4(tv.mesh.matrixWorld);
    d.transformDirection(tv.mesh.matrixWorld);
    this.raycaster.set(o, d);
    this.raycaster.far = 10;
    this.hits.length = 0;
    tv.mesh.raycast(this.raycaster, this.hits);
    this.raycaster.far = 100;
    let h = this.hits[0];
    for (const x of this.hits) if (x.distance < h.distance) h = x;
    return h ? out.copy(h.point) : null;
  }

  /** QA: is the rendered gum (GLB or procedural) in front of world point `to` seen from `from`? */
  gumCovers(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = this.tmpV.subVectors(to, from);
    const len = d.length();
    this.raycaster.set(from, d.normalize());
    this.raycaster.far = Math.max(0, len - 0.02);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.gums, false, this.hits);
    this.raycaster.far = 100;
    return this.hits.length > 0;
  }

  /** QA: pick only teeth and soft tissue (deposits, debris, bugs and brackets out of the way) while `on`. */
  teethOnlyPick(on: boolean) {
    if (on && !this.pickStash) {
      this.pickStash = this.pickSmall;
      this.pickSmall = this.pickStash.filter((o) => this.teeth.some((tv) => tv?.mesh === o));
    } else if (!on && this.pickStash) {
      this.pickSmall = this.pickStash;
      this.pickStash = null;
    }
  }
  private pickStash: THREE.Object3D[] | null = null;

  /**
   * Gum-edge assist: a gum hit just outside a tooth's neck belongs to that tooth at the gumline (v = 0), so the
   * polisher reaches plaque at the gum edge. Returns the tooth and the u around it, or null.
   */
  gumEdgeTooth(p: THREE.Vector3, reach = 0.24): { tooth: number; u: number } | null {
    let best: { tooth: number; u: number } | null = null, bd = reach;
    for (const tv of this.teeth) {
      if (!tv) continue;
      const lp = tv.mesh.worldToLocal(this.tmpV3.copy(p));
      if (lp.y < -0.35 || lp.y > tv.h * 0.2) continue;
      const dims = TOOTH_DIMS[tv.p.kind];
      const th = Math.atan2(lp.x, lp.z);
      const ex = Math.sin(th) * dims.w * 0.45, ez = Math.cos(th) * dims.d * 0.45;
      const d = Math.hypot(lp.x, lp.z) - Math.hypot(ex, ez);
      // outside the crown (the gum collar), within reach of the neck
      const dist = Math.hypot(Math.max(0, d), Math.min(0, lp.y) * 0.5);
      if (d > -0.05 && dist < bd) { bd = dist; best = { tooth: tv.index, u: th / (Math.PI * 2) + 0.5 }; }
    }
    return best;
  }

  /** A closed gum pocket within `radius` of world point `p`, or null. */
  pocketNear(p: THREE.Vector3, radius: number): Pocket | null {
    let best: Pocket | null = null, bd = radius * radius;
    for (const pv of this.pocketViews.values()) {
      if (pv.pk.opened) continue;
      const d = pv.mesh.getWorldPosition(this.tmpV3).distanceToSquared(p);
      if (d < bd) { bd = d; best = pv.pk; }
    }
    return best;
  }

  pocketWorld(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const pv = this.pocketViews.get(id);
    return pv ? pv.mesh.getWorldPosition(out) : null;
  }

  debrisWorld(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.debris.get(id);
    if (!d) return null;
    return d.obj.getWorldPosition(out);
  }

  bugWorld(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.bugViews.get(id);
    return b ? b.group.getWorldPosition(out) : null;
  }

  /** Raycast from the camera through NDC; fills `hit`. `water` includes the water surface. */
  pick(ndcX: number, ndcY: number, camera: THREE.Camera, hit: Hit, water: boolean): Hit {
    this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), camera);
    this.raycaster.far = 100;
    hit.kind = 'none';
    hit.tooth = -1;
    hit.pocket = -1;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.pickSmall, false, this.hits);
    let best: THREE.Intersection | undefined;
    for (const h of this.hits) if (!best || h.distance < best.distance) best = h;
    // soft tissue in front of the teeth (lips, cheeks) still wins
    this.raycaster.far = best ? best.distance : 100;
    const n0 = this.hits.length;
    this.raycaster.intersectObjects(this.pickSoft, false, this.hits);
    for (let i = n0; i < this.hits.length; i++) if (!best || this.hits[i].distance < best.distance) best = this.hits[i];
    if (water && this.water.visible) {
      const n = this.hits.length;
      this.raycaster.far = best ? best.distance : 100;
      this.raycaster.intersectObject(this.water, false, this.hits);
      for (let i = n; i < this.hits.length; i++) if (!best || this.hits[i].distance < best.distance) best = this.hits[i];
    }
    this.raycaster.far = 100;
    if (!best) return hit;
    const obj = best.object as THREE.Mesh;
    hit.point.copy(best.point);
    if (best.face) hit.normal.copy(best.face.normal).applyNormalMatrix(this.tmpN.getNormalMatrix(obj.matrixWorld)).normalize();
    else hit.normal.set(0, 0, 1);
    hit.local.copy(best.point);
    this.root.worldToLocal(hit.local);
    const kind = (obj.userData.kind || 'soft') as HitKind;
    hit.kind = kind;
    if (kind === 'pocket') { hit.pocket = obj.userData.pocket as number; hit.tooth = obj.userData.index as number; return hit; }
    if (kind === 'bracket') {
      const owners = obj.userData.owners as number[] | undefined;
      hit.tooth = owners && best.instanceId !== undefined ? owners[best.instanceId] ?? -1 : (obj.userData.index as number);
      hit.u = 0.5; hit.v = 0.5;
      return hit;
    }
    if (kind === 'tooth') {
      const tv = this.teeth[obj.userData.index as number];
      if (!tv) { hit.kind = 'soft'; return hit; }
      hit.tooth = tv.index;
      const lp = tv.mesh.worldToLocal(this.tmpV.copy(best.point));
      hit.u = Math.atan2(lp.x, lp.z) / (Math.PI * 2) + 0.5;
      hit.v = Math.min(1, lp.y / tv.h);
      if (obj !== tv.mesh) {
        // a tartar lump or a sugar bug: use its own coordinates so the brush lands on it
        const dv = obj.userData.dep !== undefined ? this.deposits.get(obj.userData.dep as number) : undefined;
        if (dv) { hit.u = dv.dep.u; hit.v = dv.dep.v; }
        const bv = obj.userData.bug !== undefined ? this.bugViews.get(obj.userData.bug as number) : undefined;
        if (bv) { hit.tooth = bv.bug.tooth; hit.u = bv.bug.u; hit.v = bv.bug.v; }
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
      uploadDirt(tv.tm, td.plaque, td.stain, td.polish, td.paste, td.gel);
      tv.tm.shade.value = shadeTint(td.shade);
      td.changed = false;
    }
  }

  update(dt: number, time: number, buzz: number, tutorialDep: number, eagle: number) {
    this.shared.uTime.value = time;
    const m = this.model;
    // deposits shrink and crack as they lose hp, wobble when hit, buzz under the ultrasonic
    for (const dv of this.deposits.values()) {
      const d = dv.dep;
      if (d.popped) continue;
      if (d.hidden) continue;
      if (dv.reveal < 1) {
        // hidden tartar slides up out of the opened pocket
        if (dv.reveal === 0) { dv.mesh.visible = true; this.pickSmall.push(dv.mesh); }
        dv.reveal = Math.min(1, dv.reveal + dt * 1.8);
      }
      const frac = d.hp / d.hp0;
      dv.mat.color.copy(dv.color).multiply(this.tmpC.setRGB(0.66 + 0.34 * frac, 0.58 + 0.42 * frac, 0.48 + 0.52 * frac));
      dv.crack.value = d.stage;
      const target = dv.base * (0.5 + 0.5 * Math.pow(frac, 0.8));
      dv.shown += (target - dv.shown) * Math.min(1, dt * 14);
      const since = m.time - d.lastHit;
      let jig = 0;
      if (since < 0.18) jig = (0.18 - since) * 0.35;
      const rv = easeOut(dv.reveal);
      const s = dv.shown * (1 + jig * Math.sin(time * 70)) * (0.4 + 0.6 * rv);
      dv.mesh.scale.set(s, s * (0.75 + 0.25 * frac), s);
      dv.mesh.position.copy(dv.pos);
      if (rv < 1) dv.mesh.position.y -= (1 - rv) * 0.35;
      const b = since < 0.1 ? buzz : 0;
      if (b > 0) dv.mesh.position.x += Math.sin(time * 190) * 0.012 * b;
      let glow = d.id === tutorialDep ? 0.35 + 0.3 * Math.sin(time * 6) : 0;
      // last bits: a lump left on a nearly done tooth pulses with its specks
      const lb = this.teeth[d.tooth]?.tm.last.value ?? 0;
      if (lb > 0) glow = Math.max(glow, lb * (0.22 + 0.18 * Math.sin(time * 4.2)));
      const hot = since < 0.08;
      dv.mat.emissiveIntensity = Math.max(glow, eagle * 0.6, hot ? 0.25 : 0, rv < 1 ? 0.5 * (1 - rv) : 0);
      dv.mat.emissive.copy(hot && glow === 0 && eagle === 0 ? EMISSIVE_HIT : EMISSIVE_GLOW);
    }
    for (const dv of this.debris.values()) {
      if (dv.deb.popped) continue;
      const since = m.time - dv.deb.lastHit;
      const w = since < 0.35 ? (0.35 - since) * 0.25 : 0;
      dv.obj.position.copy(dv.base);
      dv.obj.position.x += Math.sin(time * 45) * w;
      dv.obj.position.y += Math.cos(time * 38) * w * 0.5;
      if (dv.deb.kind === 'seaweed') dv.obj.rotation.z += Math.sin(time * 1.7 + dv.deb.id) * 0.002;
    }
    // gum pockets: puffy red, darker once opened, heal to pink
    for (const pv of this.pocketViews.values()) {
      const pk = pv.pk;
      if (pk.healed) {
        pv.heal = Math.min(1, pv.heal + dt * 1.2);
        pv.mat.color.copy(POCKET_OPEN).lerp(POCKET_PINK, pv.heal);
        pv.mat.emissiveIntensity = 0.25 * (1 - pv.heal);
        pv.mesh.scale.y = pv.mesh.scale.z = 1.6 * (1 - 0.55 * pv.heal);
        if (pv.heal >= 1 && pv.mesh.visible) { pv.mesh.visible = false; const i = this.pickSmall.indexOf(pv.mesh); if (i >= 0) this.pickSmall.splice(i, 1); }
      } else if (pk.opened) {
        const pi = this.pickSmall.indexOf(pv.mesh);
        if (pi >= 0) this.pickSmall.splice(pi, 1);
        pv.mat.color.lerp(POCKET_OPEN, Math.min(1, dt * 4));
        pv.mesh.scale.y = pv.mesh.scale.z = 1.25;
      } else {
        const puff = 1 + 0.06 * Math.sin(time * 3 + pk.id) + pk.open * 0.25 * Math.abs(Math.sin(time * 30));
        pv.mesh.scale.y = pv.mesh.scale.z = 1.6 * puff;
        pv.mat.emissiveIntensity = 0.25 + pk.open * 0.6;
      }
    }
    // bugs crawl on the teeth
    for (const bv of this.bugViews.values()) this.updateBug(bv, dt, time);
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const sp = this.splats[i];
      sp.t += dt;
      (sp.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - sp.t / 1.6));
      if (sp.t > 1.6) { sp.mesh.removeFromParent(); (sp.mesh.material as THREE.Material).dispose(); this.splats.splice(i, 1); }
    }
    // problem rings: pulse, then snap out
    for (const tv of this.teeth) {
      if (!tv) continue;
      if (tv.ring) {
        const mat = tv.ring.material as THREE.MeshBasicMaterial;
        if (tv.ringFade >= 0) {
          tv.ringFade += dt * 1.8;
          const k = Math.min(1, tv.ringFade);
          tv.ring.scale.set(tv.p.width * 0.62 * (1 + k * 0.9), 1, tv.p.depth * 0.66 * (1 + k * 0.9));
          mat.opacity = 0.9 * (1 - k);
          mat.color.set('#FFFFFF');
          if (k >= 1) { tv.ring.visible = false; tv.ring = null; if (tv.sore) tv.sore.visible = false; }
        } else mat.opacity = 0.5 + 0.3 * Math.sin(time * 3.2 + tv.index * 0.7);
      }
      if (tv.sore && tv.sore.visible) (tv.sore.material as THREE.SpriteMaterial).opacity = 0.26 + 0.12 * Math.sin(time * 2.2 + tv.index);
    }
    // loose bits: floating ones bob on the water and drift toward the suction
    const lowerY = this.lower.position.y;
    const surf = -2.62 + this.waterLevel * 2.1 + this.jaw * 1.6 - lowerY + 0.03;
    let dirty = false;
    for (const [id, slot] of this.bitSlot) {
      const b = this.bitById.get(id);
      if (!b || b.state !== 'floating') continue;
      if (this.bitAnims.some((a) => a.slot === slot)) continue;
      const y = Math.max(-2.2, surf) + Math.sin(time * 3 + id) * 0.02;
      this.tmpQ.setFromAxisAngle(this.tmpV2.set(0, 1, 0), time * 0.6 + id);
      this.tmpM.compose(this.tmpV.set(b.x, y, b.z), this.tmpQ, this.tmpV2.setScalar(0.9));
      this.bitsMesh.setMatrixAt(slot, this.tmpM);
      dirty = true;
    }
    for (let i = this.bitAnims.length - 1; i >= 0; i--) {
      const a = this.bitAnims[i];
      a.t += dt * (a.mode === 'suck' ? 5 : 2.2);
      const k = Math.min(1, a.t);
      if (a.mode === 'float' && a.bit) a.to.set(a.bit.x, Math.max(-2.2, surf), a.bit.z);
      this.tmpV.lerpVectors(a.from, a.to, a.mode === 'suck' ? k * k : easeOut(k));
      if (a.mode === 'float') this.tmpV.y += Math.sin(k * Math.PI) * 0.25;
      const sc = a.mode === 'suck' ? 1 - k * 0.8 : 0.9;
      this.tmpM.compose(this.tmpV, this.tmpQ.identity(), this.tmpV2.set(sc, sc, sc));
      this.bitsMesh.setMatrixAt(a.slot, this.tmpM);
      if (k >= 1) {
        if (a.mode === 'suck') {
          this.bitsMesh.setMatrixAt(a.slot, this.tmpM.makeScale(0, 0, 0));
          this.freeSlots.push(a.slot);
        }
        this.bitAnims.splice(i, 1);
      }
      dirty = true;
    }
    if (dirty) this.bitsMesh.instanceMatrix.needsUpdate = true;
    // water
    const wl = m.water;
    this.waterLevel += (wl - this.waterLevel) * Math.min(1, dt * 4);
    this.water.visible = this.waterLevel > 0.012;
    this.water.position.y = -2.62 + this.waterLevel * 2.1;
    this.water.position.y += this.jaw * 1.6;
    this.waterMat.time.value = time;
    // jaw
    this.lower.position.y = this.jaw * 1.62;
    if (this.lowerLip) this.lowerLip.position.y = this.lowerLipY + this.jaw * 0.9;
    if (this.lowerLipProxy) this.lowerLipProxy.position.y = this.jaw * 0.9;
    // decays
    for (const tv of this.teeth) {
      if (!tv) continue;
      if (tv.tm.flash.value > 0) tv.tm.flash.value = Math.max(0, tv.tm.flash.value - dt * 1.6);
      if (tv.tm.wet.value > 0) tv.tm.wet.value = Math.max(0, tv.tm.wet.value - dt * 0.4);
      if (tv.tm.lamp.value > 0) tv.tm.lamp.value = Math.max(0, tv.tm.lamp.value - dt * 3);
      const lg = this.lastGoal[tv.index] ?? 0;
      if (tv.tm.last.value !== lg) tv.tm.last.value = lg > tv.tm.last.value ? Math.min(lg, tv.tm.last.value + dt * 2.5) : Math.max(lg, tv.tm.last.value - dt * 4);
    }
    // lamp
    if (this.lampLight && this.lampCone) {
      this.lampOn = Math.max(0, this.lampOn - dt * 4);
      this.lampLight.intensity = 7 * this.lampOn;
      (this.lampCone.material as THREE.MeshBasicMaterial).opacity = 0.16 * this.lampOn;
      this.lampCone.visible = this.lampOn > 0.01;
    }
    if (this.coinSpin) this.coinSpin.rotation.y += dt * 22;
    this.fx.update(dt);
  }

  private updateBug(bv: BugView, dt: number, time: number) {
    const b = bv.bug;
    if (!b.alive) {
      if (bv.squash >= 0 && bv.group.visible) {
        bv.squash += dt;
        const k = Math.min(1, bv.squash / 0.14);
        bv.group.scale.set(1 + 0.5 * k, 1 - 0.8 * k, 1 + 0.5 * k);
        if (bv.squash > 0.5) {
          bv.group.visible = false;
          bv.group.traverse((o) => { const i = this.pickSmall.indexOf(o); if (i >= 0) this.pickSmall.splice(i, 1); });
        }
      }
      return;
    }
    const tv = this.teeth[b.tooth];
    if (!tv) { bv.group.visible = false; return; }
    const sp = this.surfacePoint(tv, b.u, b.v, BUG_SP);
    this.root.worldToLocal(this.tmpV.copy(sp.point));
    const nrm = this.tmpV2.copy(sp.normal).transformDirection(this.tmpM.copy(this.root.matrixWorld).invert()).normalize();
    // forward: the direction it moved, projected on the surface
    const mv = this.tmpV3.copy(this.tmpV).sub(bv.last);
    if (mv.lengthSq() > 1e-7 && mv.lengthSq() < 0.25) bv.fwd.lerp(mv.normalize(), Math.min(1, dt * 8));
    bv.last.copy(this.tmpV);
    const fwd = this.tmpV3.copy(bv.fwd).addScaledVector(nrm, -bv.fwd.dot(nrm));
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0).addScaledVector(nrm, -nrm.y);
    fwd.normalize();
    const side = new THREE.Vector3().crossVectors(nrm, fwd).normalize();
    this.tmpM.makeBasis(side, nrm, fwd);
    bv.group.quaternion.setFromRotationMatrix(this.tmpM);
    bv.group.position.copy(this.tmpV).addScaledVector(nrm, 0.005 + Math.abs(Math.sin(time * 14 + b.id)) * 0.012);
    const scared = b.fleeing > 0;
    for (let i = 0; i < bv.legs.length; i++) bv.legs[i].rotation.x = Math.sin(time * (scared ? 34 : 18) + i * 1.7) * 0.5;
    // a little puff of plaque right after spreading
    if (time - b.lastSpread < 0.05) this.fx.flakes(this.root.worldToLocal(sp.point.clone()), sp.normal, 4, '#F2DE8A', 0.8, 0.5);
  }

  // ---------------------------------------------------------------- events

  popDeposit(d: TartarDeposit, out: THREE.Vector3): THREE.Vector3 {
    const dv = this.deposits.get(d.id);
    if (!dv) return out.set(0, 0, 0);
    this.deposits.delete(d.id);
    const i = this.pickSmall.indexOf(dv.mesh);
    if (i >= 0) this.pickSmall.splice(i, 1);
    dv.mesh.getWorldPosition(out);
    const n = this.tmpV.copy(dv.normal).transformDirection(dv.mesh.parent!.matrixWorld);
    this.fx.group.attach(dv.mesh);
    dv.mat.emissiveIntensity = 0;
    const sp = 2.5 + Math.random() * 1.5;
    this.fx.fly(dv.mesh, n.x * sp + (Math.random() - 0.5), n.y * sp + 3.2, n.z * sp + 1.2, 1.5, () => {
      dv.mesh.removeFromParent();
      dv.mat.dispose();
      this.owned.delete(dv.mat);
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
    if (d.kind === 'doubloon') {
      // the coin pops out spinning and hangs in the air a moment
      this.coinSpin = dv.obj;
      this.fx.fly(dv.obj, nx * 1.2, 5.5, nz * 1.2 + 1.5, 2.2, () => { dv.obj.removeFromParent(); if (this.coinSpin === dv.obj) this.coinSpin = null; }, [0, 0, 0]);
    } else {
      this.fx.fly(dv.obj, nx * 3 + (Math.random() - 0.5), 4.2, nz * 3 + 1.5, 1.6, () => { dv.obj.removeFromParent(); });
    }
    return out;
  }

  addBit(b: LooseBit) {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return;
    this.bitSlot.set(b.id, slot);
    this.bitById.set(b.id, b);
    // settle on whatever is below (tongue or gum)
    this.raycaster.set(this.tmpV.set(b.x, 1.5, b.z).applyMatrix4(this.lower.matrixWorld), this.tmpV2.set(0, -1, 0));
    this.raycaster.far = 6;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.floorProxies, false, this.hits);
    let h: THREE.Intersection | undefined;
    for (const x of this.hits) if (!h || x.distance < h.distance) h = x;
    if (h) b.y = this.lower.worldToLocal(h.point.clone()).y + 0.03;
    const q = this.tmpQ.setFromAxisAngle(this.tmpV2.set(0, 1, 0), Math.random() * 6);
    this.tmpM.compose(this.tmpV.set(b.x, b.y, b.z), q, this.tmpV2.setScalar(0.8 + Math.random() * 0.5));
    this.bitsMesh.setMatrixAt(slot, this.tmpM);
    this.bitsMesh.setColorAt(slot, this.tmpC.setHex(b.color));
    this.bitsMesh.instanceMatrix.needsUpdate = true;
    if (this.bitsMesh.instanceColor) this.bitsMesh.instanceColor.needsUpdate = true;
  }

  /** A rinsed bit floats up into the water (suction can take it now). */
  floatBit(b: LooseBit) {
    const slot = this.bitSlot.get(b.id);
    if (slot === undefined) return;
    for (let i = this.bitAnims.length - 1; i >= 0; i--) if (this.bitAnims[i].slot === slot) this.bitAnims.splice(i, 1);
    this.bitAnims.push({ slot, bit: b, from: new THREE.Vector3(b.x, b.y, b.z), to: new THREE.Vector3(b.x, b.y, b.z), t: 0, mode: 'float' });
  }

  suckBit(b: LooseBit, tipWorld: THREE.Vector3) {
    const slot = this.bitSlot.get(b.id);
    if (slot === undefined) return;
    this.bitSlot.delete(b.id);
    this.bitById.delete(b.id);
    // cancel a running float so it cannot put the bit back
    for (let i = this.bitAnims.length - 1; i >= 0; i--) if (this.bitAnims[i].slot === slot) this.bitAnims.splice(i, 1);
    const to = this.lower.worldToLocal(tipWorld.clone());
    const from = new THREE.Vector3();
    this.bitsMesh.getMatrixAt(slot, this.tmpM);
    from.setFromMatrixPosition(this.tmpM);
    this.bitAnims.push({ slot, bit: null, from, to, t: 0, mode: 'suck' });
  }

  removeBitNow(b: LooseBit) {
    const slot = this.bitSlot.get(b.id);
    if (slot === undefined) return;
    this.bitSlot.delete(b.id);
    this.bitById.delete(b.id);
    for (let i = this.bitAnims.length - 1; i >= 0; i--) if (this.bitAnims[i].slot === slot) this.bitAnims.splice(i, 1);
    this.bitsMesh.setMatrixAt(slot, this.tmpM.makeScale(0, 0, 0));
    this.bitsMesh.instanceMatrix.needsUpdate = true;
    this.freeSlots.push(slot);
  }

  /** A sugar bug got squashed: flatten it and leave a goo splat on the tooth. */
  squashBug(bug: SugarBug, out: THREE.Vector3): THREE.Vector3 {
    const bv = this.bugViews.get(bug.id);
    if (!bv) return out.set(0, 0, 0);
    bv.squash = 0;
    bv.group.getWorldPosition(out);
    const tv = this.teeth[bug.tooth];
    if (tv) {
      const sp = this.surfacePoint(tv, bug.u, bug.v);
      const mat = new THREE.MeshBasicMaterial({ color: '#C77DFF', transparent: true, opacity: 0.85, depthWrite: false });
      const splat = new THREE.Mesh(this.splatGeo, mat);
      splat.position.copy(this.root.worldToLocal(sp.point.clone()).addScaledVector(this.tmpV.copy(sp.normal).transformDirection(this.tmpM.copy(this.root.matrixWorld).invert()), 0.01));
      splat.lookAt(this.tmpV2.copy(splat.position).add(this.tmpV));
      splat.scale.setScalar(0.8 + Math.random() * 0.4);
      splat.renderOrder = 5;
      this.root.add(splat);
      this.splats.push({ mesh: splat, t: 0 });
    }
    return out;
  }

  /** "Last bits" glow on a nearly done problem tooth (fades in and out). */
  setLastBits(i: number, on: boolean) { this.lastGoal[i] = on ? 1 : 0; }
  private lastGoal: number[] = [];

  /** Problem tooth snapped: flash, and the ring bursts outward. */
  snapTooth(i: number) {
    const tv = this.teeth[i];
    if (!tv) return;
    tv.tm.flash.value = 1;
    this.lastGoal[i] = 0;
    tv.tm.last.value = 0;
    if (tv.ring && tv.ringFade < 0) tv.ringFade = 0;
  }

  rinseReveal(i: number) {
    const tv = this.teeth[i];
    if (tv) tv.tm.wet.value = 1;
  }

  /** Wrap-assist ring around `tooth` at height v, opacity by strength (0 hides it). */
  setWrap(tooth: number, v: number, strength: number, color: string) {
    const tv = tooth >= 0 ? this.teeth[tooth] : null;
    if (!tv || strength <= 0.01) { this.wrapRing.visible = false; return; }
    if (this.wrapRing.parent !== tv.flip) tv.flip.add(this.wrapRing);
    this.wrapRing.visible = true;
    this.wrapRing.position.y = Math.min(0.97, Math.max(0.05, v)) * tv.h;
    const top = v > 0.82;
    const k = top ? 0.52 : 0.6;
    this.wrapRing.scale.set(tv.p.width * k, 1, tv.p.depth * (k + 0.04));
    this.wrapMat.color.set(color);
    this.wrapMat.opacity = 0.18 + 0.5 * strength;
  }

  /** Floss gap markers at world points (null hides the rest). */
  setMarkers(points: THREE.Vector3[], time: number, focus = -1) {
    for (let i = 0; i < this.markers.length; i++) {
      const sp = this.markers[i];
      const p = points[i];
      if (!p) { sp.visible = false; continue; }
      sp.visible = true;
      this.root.worldToLocal(sp.position.copy(p));
      const pulse = 1 + 0.18 * Math.sin(time * 5 + i);
      sp.scale.setScalar((i === focus ? 0.62 : 0.46) * pulse);
    }
    this.markerMat.opacity = 0.75 + 0.2 * Math.sin(time * 5);
  }

  /**
   * Floss string as a bowed ribbon from hand L through the gap point to hand R (world points).
   * `bow` pulls the middle toward `pull` (the string pressing against a tooth). null hides it.
   */
  setFloss(l: THREE.Vector3 | null, mid?: THREE.Vector3, r?: THREE.Vector3, camera?: THREE.Camera, tension = 0, showHands = true) {
    if (!l || !mid || !r || !camera) {
      this.string.visible = false;
      for (const h of this.hands) h.visible = false;
      return;
    }
    const pos = this.stringGeo.getAttribute('position') as THREE.BufferAttribute;
    const SEG = pos.count / 2 - 1;
    const width = 0.035 + 0.01 * (1 - tension);
    const camPos = camera.getWorldPosition(this.tmpV3);
    const pt = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
    // two quadratic halves meeting at the gap point: a tight V under tension, a soft U when slack
    const sag = (1 - tension) * 0.25;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const half = t < 0.5;
      const a = half ? l : mid, b = half ? mid : r;
      const k = half ? t * 2 : (t - 0.5) * 2;
      const c = this.tmpV.lerpVectors(a, b, 0.5);
      c.y -= sag * (1 - Math.abs(k - 0.5) * 2) * 0.3;
      // quadratic Bezier a -> c -> b, flattened near the gap
      const u = 1 - k;
      pt.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(c, 2 * u * k).addScaledVector(b, k * k);
      this.toolRoot.worldToLocal(pt);
      tan.copy(i < SEG ? b : a).sub(i < SEG ? a : b).normalize();
      toCam.copy(camPos).sub(pt).normalize();
      side.crossVectors(tan, toCam).normalize().multiplyScalar(width / 2);
      pos.setXYZ(i * 2, pt.x + side.x, pt.y + side.y, pt.z + side.z);
      pos.setXYZ(i * 2 + 1, pt.x - side.x, pt.y - side.y, pt.z - side.z);
    }
    pos.needsUpdate = true;
    this.stringGeo.computeVertexNormals();
    this.string.visible = true;
    this.stringMat.emissiveIntensity = 0.35 + 0.5 * tension;
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      h.visible = showHands;
      this.toolRoot.worldToLocal(h.position.copy(i === 0 ? l : r));
    }
  }

  /** UV lamp: glow at a world point on `tooth` and its neighbours. */
  setLamp(point: THREE.Vector3, tooth: number, tip: THREE.Vector3) {
    if (!this.lampLight || !this.lampCone) return;
    this.lampOn = 1;
    this.root.worldToLocal(this.lampLight.position.copy(point));
    this.lampLight.position.z += 0.4;
    // cone from the lens to the tooth
    const from = this.toolRoot.worldToLocal(tip.clone());
    const to = this.toolRoot.worldToLocal(point.clone());
    const d = from.distanceTo(to);
    this.lampCone.position.copy(from);
    this.lampCone.scale.set(0.9, Math.max(0.1, d), 0.9);
    this.lampCone.quaternion.setFromUnitVectors(this.tmpV.set(0, -1, 0), this.tmpV2.copy(to).sub(from).normalize());
    const arch = Math.floor(tooth / TEETH_PER_ARCH);
    for (let n = tooth - 1; n <= tooth + 1; n++) {
      if (n < 0 || n >= 28 || Math.floor(n / TEETH_PER_ARCH) !== arch) continue;
      const tv = this.teeth[n];
      if (tv) tv.tm.lamp.value = Math.max(tv.tm.lamp.value, n === tooth ? 1 : 0.6);
    }
  }

  /** Gap line for floss: gumline point and biting-edge point on the outward side (world). */
  gapPoints(a: number, b: number, gum: THREE.Vector3, tip: THREE.Vector3): boolean {
    const ta = this.teeth[a], tb = this.teeth[b];
    if (!ta || !tb) return false;
    const pa = ta.p;
    if (a === b) {
      // bracket: along the tooth axis through the bracket
      const sp = this.surfacePoint(ta, 0.5, 0.05);
      gum.copy(sp.point).addScaledVector(sp.normal, 0.12);
      const sp2 = this.surfacePoint(ta, 0.5, 0.95);
      tip.copy(sp2.point).addScaledVector(sp2.normal, 0.12);
      return true;
    }
    const nx = (pa.nx + tb.p.nx) / 2, nz = (pa.nz + tb.p.nz) / 2;
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

  /** Kind of the first thing a ray from `from` toward `to` (world) hits: 'face' means the cheek is in the way. */
  firstHitKind(from: THREE.Vector3, to: THREE.Vector3): HitKind {
    const d = this.tmpV.subVectors(to, from);
    const len = d.length();
    this.raycaster.set(from, d.normalize());
    this.raycaster.far = len + 0.2;
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.pickSmall, false, this.hits);
    this.raycaster.intersectObjects(this.pickSoft, false, this.hits);
    this.raycaster.far = 100;
    let best: THREE.Intersection | undefined;
    for (const h of this.hits) if (!best || h.distance < best.distance) best = h;
    return best ? ((best.object.userData.kind || 'soft') as HitKind) : 'none';
  }

  /** Is something solid between `from` and the point `to` (world)? */
  occluded(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = this.tmpV.subVectors(to, from);
    const len = d.length();
    this.raycaster.set(from, d.normalize());
    this.raycaster.far = Math.max(0, len - 0.35);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.pickSmall, false, this.hits);
    let hit = this.hits.length > 0;
    if (!hit) { this.raycaster.intersectObjects(this.pickSoft, false, this.hits); hit = this.hits.some((h) => h.object.userData.kind === 'face' || h.object.userData.kind === 'gum'); }
    this.raycaster.far = 100;
    return hit;
  }

  /** Render the current state with `camera` and return a small JPEG (in the same task, since the buffer is not preserved). */
  snapshot(renderer: THREE.WebGLRenderer, camera: THREE.Camera, width = 480): string | null {
    const hide: THREE.Object3D[] = [this.toolRoot, this.fx.group, this.wrapRing, ...this.markers];
    for (const tv of this.teeth) if (tv?.ring) hide.push(tv.ring);
    const was = hide.map((o) => o.visible);
    try {
      for (const o of hide) o.visible = false;
      renderer.render(this.scene, camera);
      const src = renderer.domElement;
      if (!src.width || !src.height) return null;
      // a centred 4:3 crop, so before and after have the same shape on every screen
      const aspect = 4 / 3;
      let sw = src.width, sh = src.height;
      if (sw / sh > aspect) sw = sh * aspect; else sh = sw / aspect;
      const h = Math.round(width / aspect);
      const c = document.createElement('canvas');
      c.width = width; c.height = h;
      const g = c.getContext('2d');
      if (!g) return null;
      g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, h);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    } finally {
      hide.forEach((o, i) => { o.visible = was[i]; });
    }
  }

  dispose() {
    this.fx.dispose();
    for (const sp of this.splats) (sp.mesh.material as THREE.Material).dispose();
    this.splats.length = 0;
    // the key light's shadow map (a render target and its depth texture)
    this.key.dispose();
    this.lampLight?.dispose();
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Sprite).isSprite) return;
      if (m.geometry && !this.shared3.has(m.geometry) && !(o as THREE.Sprite).isSprite) geos.add(m.geometry);
      const mm = m.material;
      if (Array.isArray(mm)) mm.forEach((x) => { if (!this.shared3.has(x)) mats.add(x); });
      else if (mm && !this.shared3.has(mm)) mats.add(mm);
    });
    for (const d of this.owned) d.dispose();
    for (const g of geos) g.dispose();
    for (const tv of this.teeth) if (tv) disposeToothMat(tv.tm);
    for (const m of mats) m.dispose();
    this.bitsMesh.dispose();
    for (const b of this.brackets) b.dispose();
    this.scene.clear();
    this.owned.clear();
  }
}

const BUG_SP = { point: new THREE.Vector3(), normal: new THREE.Vector3() };

function shadeTint(shade: number): number {
  return Math.max(0, Math.min(1, (shade - 1) / 15)) * 0.95;
}
function easeOut(k: number) { return 1 - (1 - k) * (1 - k); }

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
  const n = g.getAttribute('normal');
  if (n.getY(0) < 0) {
    const arr = g.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}
