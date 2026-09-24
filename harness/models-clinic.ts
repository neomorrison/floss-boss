// Model check for the art-clinic set: every CLINIC_MODELS and PEOPLE_MODELS GLB under an isometric camera,
// with the people rigs animated through their joint nodes, plus small scenes that pose people in the furniture.
//
//   /harness/models-clinic.html                  grid of every clinic model + a walking people row
//   /harness/models-clinic.html?view=people      the five people walking, tinted variants, sitting and lying
//   /harness/models-clinic.html?view=op          an operatory: chair, lamp, cart, counter, monitor, tv, patient
//   /harness/models-clinic.html?view=lobby       reception, waiting area, kids corner, fish tank, door, sign
//   /harness/models-clinic.html?view=thumbs      the shop thumbnails on light, mint and dark cards
//   /harness/models-clinic.html?view=v3          manager-layer equipment, op upgrades and event props through the
//                                                game's diorama camera (&cam=iso for the orthographic grid camera)
//   /harness/models-clinic.html?focus=chair_deluxe   one model, orbit with mouse or touch
//   &origin=1  show model origins     &still=1  freeze the animation (for screenshots)     &t=1.2  animation time
//
// window.__ready is true once everything has loaded (tools/snap.mjs waits on it). window.__clinicModels has
// per-model triangles, KB and size (stats) and the contract problems (empty when every model is fine).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CLINIC_MODELS, PEOPLE_MODELS } from '../src/data/assets';
import { CHAIRS, OP_UPGRADES, EQUIPMENT } from '../src/data/upgrades';

interface ModelStat { tris: number; kb: number; size: [number, number, number] }
declare global {
  interface Window {
    __ready?: boolean;
    __clinicModels?: { stats: Record<string, ModelStat>; problems: string[] };
  }
}

const q = new URLSearchParams(location.search);
const FOCUS = q.get('focus');
const VIEW = FOCUS ? 'focus' : q.get('view') || 'grid';
const SHOW_ORIGIN = q.get('origin') === '1';
const STILL = q.get('still') === '1';
const T0 = Number(q.get('t') || '0');

const stage = document.getElementById('stage')!;
const labels = document.getElementById('labels')!;
const info = document.getElementById('info')!;
const bar = document.getElementById('bar')!;

// ------------------------------------------------------------------ nav
const links: [string, string][] = [
  ['Grid', '?view=grid'], ['People', '?view=people'], ['Operatory', '?view=op'], ['Lobby', '?view=lobby'],
  ['Thumbs', '?view=thumbs'], ['Manager', '?view=v3'], ['Chair', '?focus=chair_deluxe'],
];
for (const [name, href] of links) {
  const a = document.createElement('a');
  a.textContent = name;
  a.href = href;
  const hp = new URLSearchParams(href.slice(1));
  if ((hp.get('view') || (hp.get('focus') ? 'focus' : '')) === VIEW) a.className = 'on';
  bar.appendChild(a);
}

// ------------------------------------------------------------------ renderer (same settings as core/renderer)
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
stage.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9f4f1');
const hemi = new THREE.HemisphereLight('#ffffff', '#cfe6df', 1.6);
scene.add(hemi);
const key = new THREE.DirectionalLight('#fff6e8', 2.2);
key.position.set(6, 12, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
scene.add(key.target);
const fill = new THREE.DirectionalLight('#dff4ff', 0.6);
fill.position.set(-8, 5, -3);
scene.add(fill);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
const ISO_DIR = new THREE.Vector3(1, 0.95, 1.15).normalize();

// ------------------------------------------------------------------ loading
const loader = new GLTFLoader();
const url = (k: string) => `/models/${k}.glb`;
interface Loaded { scene: THREE.Group; kb: number }
const cache = new Map<string, Promise<Loaded | null>>();
const problems: string[] = [];
const stats: Record<string, ModelStat> = {};
window.__clinicModels = { stats, problems };

function load(k: string): Promise<Loaded | null> {
  let p = cache.get(k);
  if (!p) {
    p = fetch(url(k))
      .then(async (r) => {
        const type = r.headers.get('content-type') || '';
        if (!r.ok || type.includes('text/html')) throw new Error(`missing (${r.status})`);
        const buf = await r.arrayBuffer();
        const gltf = await loader.parseAsync(buf, '/models/');
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
        });
        return { scene: gltf.scene, kb: buf.byteLength / 1024 };
      })
      .catch((e: unknown) => {
        problems.push(`${k}: ${String(e)}`);
        return null;
      });
    cache.set(k, p);
  }
  return p;
}

function trisOf(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry as THREE.BufferGeometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(n);
}

const PEOPLE_NODES = ['Body', 'Head', 'LegL', 'LegR', 'ArmL', 'ArmR'];
const TINTABLE = ['Skin', 'Hair', 'Shirt', 'Pants', 'Shoes', 'Scrubs', 'Coat'];
const BUDGET_KB = (k: string) => (k.startsWith('char_') ? 100 : k.startsWith('prop_') ? 90 : 120);

/** Contract checks on a fresh (unposed) instance. Returns short problem strings. */
function check(k: string, root: THREE.Object3D, kb: number): string[] {
  const out: string[] = [];
  const box = new THREE.Box3().setFromObject(root);
  if (box.min.y < -0.003) out.push(`below floor ${box.min.y.toFixed(3)}`);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const tol = k.startsWith('char_') ? 0.12 : 0.06;
  if (Math.abs(cx) > tol || Math.abs(cz) > tol) out.push(`off center ${cx.toFixed(2)},${cz.toFixed(2)}`);
  if (kb > BUDGET_KB(k)) out.push(`${kb.toFixed(0)} KB over budget`);
  const mats = new Set<string>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mats.add(mm.name));
  });
  if (k.startsWith('char_')) {
    for (const n of PEOPLE_NODES) if (!root.getObjectByName(n)) out.push(`no ${n}`);
    if (!TINTABLE.some((t) => mats.has(t))) out.push('no tintable material');
  }
  if (k.startsWith('chair_') && !mats.has('Upholstery')) out.push('no Upholstery');
  return out;
}

// ------------------------------------------------------------------ people rigs
interface Rig {
  root: THREE.Object3D;
  body: THREE.Object3D; head: THREE.Object3D;
  legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D;
  bodyY: number; hipY: number;
  mode: 'walk' | 'idle' | 'sit' | 'lie' | 'work';
  phase: number;
  path?: { from: THREE.Vector3; to: THREE.Vector3; speed: number };
}
const rigs: Rig[] = [];

/** Event-prop pets: the view wags Tail about the vertical axis and tilts Head (prop_puppy contract). */
interface Pet { tail: THREE.Object3D; head: THREE.Object3D; phase: number }
const pets: Pet[] = [];
function makePet(root: THREE.Object3D, phase = 0): void {
  const tail = root.getObjectByName('Tail');
  const head = root.getObjectByName('Head');
  if (!tail || !head || !root.getObjectByName('Body')) { problems.push('prop_puppy: missing Body, Head or Tail'); return; }
  pets.push({ tail, head, phase });
}
function animatePet(pt: Pet, t: number): void {
  pt.tail.rotation.y = Math.sin(t * 14 + pt.phase) * 0.6;
  pt.head.rotation.z = Math.sin(t * 1.7 + pt.phase) * 0.12;
}

function makeRig(root: THREE.Object3D, mode: Rig['mode'], phase = 0): Rig | null {
  const get = (n: string) => root.getObjectByName(n);
  const body = get('Body'), head = get('Head'), legL = get('LegL'), legR = get('LegR'), armL = get('ArmL'), armR = get('ArmR');
  if (!body || !head || !legL || !legR || !armL || !armR) return null;
  const r: Rig = { root, body, head, legL, legR, armL, armR, bodyY: body.position.y, hipY: legL.position.y, mode, phase };
  rigs.push(r);
  return r;
}

/** Give each person instance its own tint (clones the tintable materials). */
function tint(root: THREE.Object3D, colors: Partial<Record<string, string>>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const next = mats.map((mm) => {
      const c = colors[mm.name];
      if (!c) return mm;
      const cl = (mm as THREE.MeshStandardMaterial).clone();
      cl.color.set(c);
      return cl;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
}

// Walk and sit poses: rotation.x swings a limb forward (+Z) when negative.
function animate(r: Rig, t: number, dt: number): void {
  const ph = t * 7.5 + r.phase;
  const s = Math.sin(ph);
  r.body.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
  r.armL.rotation.set(0, 0, 0);
  r.armR.rotation.set(0, 0, 0);
  r.legL.rotation.set(0, 0, 0);
  r.legR.rotation.set(0, 0, 0);
  r.body.position.y = r.bodyY;
  switch (r.mode) {
    case 'walk': {
      r.legL.rotation.x = s * 0.55;
      r.legR.rotation.x = -s * 0.55;
      r.armL.rotation.x = -s * 0.5;
      r.armR.rotation.x = s * 0.5;
      r.body.position.y = r.bodyY + Math.abs(Math.cos(ph)) * 0.035;
      r.body.rotation.z = s * 0.04;
      r.head.rotation.z = -s * 0.05;
      if (r.path) {
        const { from, to, speed } = r.path;
        const len = from.distanceTo(to);
        const u = ((t * speed + r.phase) % (2 * len)) / len;
        const f = u < 1 ? u : 2 - u;
        r.root.position.lerpVectors(from, to, f);
        const dir = new THREE.Vector3().subVectors(to, from).multiplyScalar(u < 1 ? 1 : -1);
        r.root.rotation.y = Math.atan2(dir.x, dir.z);
      }
      break;
    }
    case 'idle':
      r.body.position.y = r.bodyY + Math.sin(t * 2 + r.phase) * 0.008;
      r.head.rotation.z = Math.sin(t * 1.3 + r.phase) * 0.08;
      r.armL.rotation.z = 0.05;
      r.armR.rotation.z = -0.05;
      break;
    case 'work':
      r.armL.rotation.x = -0.9 + Math.sin(t * 6 + r.phase) * 0.12;
      r.armR.rotation.x = -1.1 + Math.sin(t * 6 + r.phase + 1.4) * 0.15;
      r.body.rotation.x = 0.18;
      r.head.rotation.x = 0.35;
      break;
    case 'sit':
      r.legL.rotation.x = -1.35;
      r.legR.rotation.x = -1.35;
      r.armL.rotation.x = -0.35;
      r.armR.rotation.x = -0.35;
      r.head.rotation.z = Math.sin(t * 1.1 + r.phase) * 0.06;
      break;
    case 'lie':
      // reclined in a dental chair: torso along the 30 degree backrest, legs along the leg rest
      r.body.rotation.x = -1.04;
      r.legL.rotation.x = -1.47;
      r.legR.rotation.x = -1.47;
      r.armL.rotation.x = 0.25;
      r.armR.rotation.x = 0.25;
      r.armL.rotation.z = 0.12;
      r.armR.rotation.z = -0.12;
      r.head.rotation.x = -0.2 + Math.sin(t * 1.4 + r.phase) * 0.03;
      break;
  }
  void dt;
}

/** Root placement for a person lying in a dental chair placed at `chair` (same rotation). */
function seatInChair(r: Rig, chair: THREE.Object3D): void {
  // chair profile (three.js, chair space): hip point on the seat/back junction at y 0.53, z -0.2
  const hip = new THREE.Vector3(0, 0.672, -0.2);
  chair.updateMatrixWorld(true);
  const w = hip.applyMatrix4(chair.matrixWorld);
  r.root.position.set(w.x, w.y - r.hipY, w.z);
  r.root.rotation.y = chair.rotation.y;
}

/** Root placement for a person sitting on a waiting chair / cafe chair seat of height seatY. */
function seatOn(r: Rig, x: number, z: number, rotY: number, seatY: number): void {
  // pelvis bottom sits about 0.1 below the hip joint
  r.root.position.set(x, seatY - (r.hipY - 0.1), z);
  r.root.rotation.y = rotY;
}

// ------------------------------------------------------------------ placement helpers
interface Item { key: string; obj: THREE.Object3D; label?: boolean }
const items: Item[] = [];
const labelEls = new Map<Item, HTMLDivElement>();

async function place(k: string, x: number, z: number, rotY = 0, label = false): Promise<THREE.Object3D | null> {
  const L = await load(k);
  if (!L) return null;
  const obj = L.scene.clone(true);
  const fresh = L.scene.clone(true);
  const bad = check(k, fresh, L.kb);
  const box = new THREE.Box3().setFromObject(fresh);
  const size = box.getSize(new THREE.Vector3());
  stats[k] = { tris: trisOf(fresh), kb: Math.round(L.kb * 10) / 10, size: [+size.x.toFixed(2), +size.z.toFixed(2), +size.y.toFixed(2)] };
  for (const b of bad) if (!problems.includes(`${k}: ${b}`)) problems.push(`${k}: ${b}`);
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY;
  scene.add(obj);
  if (SHOW_ORIGIN) {
    const ax = new THREE.AxesHelper(0.4);
    ax.position.set(x, 0.002, z);
    scene.add(ax);
  }
  const it: Item = { key: k, obj, label };
  items.push(it);
  if (label) {
    const el = document.createElement('div');
    el.className = 'lbl' + (bad.length ? ' bad' : '');
    const st = stats[k];
    const dims = VIEW === 'grid' ? '' : `, ${st.size[0]} x ${st.size[1]} x ${st.size[2]} m`;
    el.innerHTML = `${k}<small>${st.tris} tris, ${st.kb} KB${dims}${bad.length ? '<br>' + bad.join(', ') : ''}</small>`;
    labels.appendChild(el);
    labelEls.set(it, el);
  }
  return obj;
}

async function person(k: string, x: number, z: number, rotY: number, mode: Rig['mode'], phase = 0,
  colors?: Partial<Record<string, string>>, label = false): Promise<Rig | null> {
  const obj = await place(k, x, z, rotY, label);
  if (!obj) return null;
  if (colors) tint(obj, colors);
  return makeRig(obj, mode, phase);
}

// Tint sets the game might roll per person.
const TINTS: Partial<Record<string, string>>[] = [
  { Shirt: '#ffd166', Pants: '#4f6d8f', Hair: '#3b2a22', Skin: '#c98d66' },
  { Shirt: '#ff7aa8', Pants: '#7a8a99', Hair: '#e0b25a', Skin: '#f3c9a6' },
  { Shirt: '#9f8cf0', Pants: '#3e5a4f', Hair: '#1f1a1a', Skin: '#8a5a3c', Scrubs: '#ff9db5' },
  { Shirt: '#7cc8f2', Pants: '#c7a27a', Hair: '#b5552f', Skin: '#e8b48f', Scrubs: '#7cc8f2' },
  { Shirt: '#3dd6b5', Pants: '#5b5f86', Hair: '#6b4a3a', Skin: '#a8714f', Scrubs: '#b9a6f2', Coat: '#f2fbff' },
];

// ------------------------------------------------------------------ views
// Grid cells run along the camera's screen axes projected on the floor, so rows stay horizontal on screen.
const SCREEN_RIGHT = new THREE.Vector3(ISO_DIR.z, 0, -ISO_DIR.x).normalize();
const SCREEN_DOWN = new THREE.Vector3(ISO_DIR.x, 0, ISO_DIR.z).normalize();
const gridPos = (col: number, row: number, cw: number, rh: number) =>
  new THREE.Vector3().addScaledVector(SCREEN_RIGHT, col * cw).addScaledVector(SCREEN_DOWN, row * rh);

async function viewGrid(): Promise<void> {
  const keys = [...CLINIC_MODELS];
  const cols = 8;
  await Promise.all(keys.map((k, i) => {
    const p = gridPos(i % cols - (cols - 1) / 2, Math.floor(i / cols), 2.75, 3.1);
    return place(k, p.x, p.z, 0, true);
  }));
  await Promise.all(PEOPLE_MODELS.map(async (k, i) => {
    const a = gridPos((i - 2) * 2.2 - 0.4, 4.1, 1, 3.1);
    const b = gridPos((i - 2) * 2.2 + 0.4, 4.1, 1, 3.1);
    await person(k, a.x, a.z, 0, 'walk', i * 0.7, undefined, true);
    await person(k, b.x, b.z, 0, 'walk', i * 0.7 + 1.6, TINTS[i]);
  }));
}

async function viewPeople(): Promise<void> {
  for (let i = 0; i < PEOPLE_MODELS.length; i++) {
    const k = PEOPLE_MODELS[i];
    const x = (i - 2) * 1.5;
    await person(k, x, 0, 0, 'walk', i * 0.9, undefined, true);
    await person(k, x, -1.6, 0.4, 'idle', i, TINTS[i]);
    await person(k, x, -3.1, -0.3, 'walk', i * 0.9 + 2, TINTS[(i + 2) % TINTS.length]);
  }
  // sitting on waiting chairs and lying in dental chairs
  const seats = ['char_adult', 'char_senior', 'char_kid'];
  for (let i = 0; i < seats.length; i++) {
    const x = -3 + i * 0.8;
    await place('waiting_chair', x, 2.4, 0);
    const r = await person(seats[i], x, 2.4, 0, 'sit', i, TINTS[i + 1]);
    if (r) seatOn(r, x, 2.4 - 0.06, 0, 0.43);
  }
  const chairs = ['chair_basic', 'chair_comfort', 'chair_deluxe'];
  for (let i = 0; i < chairs.length; i++) {
    const x = 0.6 + i * 1.5;
    const ch = await place(chairs[i], x, 2.6, 0);
    const r = await person(['char_adult', 'char_kid', 'char_senior'][i], x, 2.6, 0, 'lie', i, TINTS[i]);
    if (r && ch) seatInChair(r, ch);
  }
}

async function viewOp(): Promise<void> {
  // one operatory, about 3.2 x 3.4 m, plus a neighbour behind a partition
  const chair = await place('chair_deluxe', 0, 0, 0, true);
  const pat = await person('char_adult', 0, 0, 0, 'lie', 0, TINTS[0]);
  if (pat && chair) seatInChair(pat, chair);
  await person('char_staff', 0.85, -0.75, -Math.PI / 2 - 0.35, 'work', 0, undefined, true);
  await place('op_lamp', -0.95, -0.85, Math.PI / 2, true);
  await place('op_cart', 0.95, 0.35, -Math.PI / 2 + 0.3, true);
  await place('op_counter', 0.2, -1.95, 0, true);
  await place('op_monitor', -0.95, 0.55, Math.PI / 2 - 0.4, true);
  await place('op_tv', 0, 1.3, Math.PI, true);
  await place('intraoral_cam', 1.45, -1.1, -Math.PI / 4, true);
  await place('whitening_lamp', -1.5, -1.3, Math.PI / 3, true);
  await place('trash_bin', 1.35, -1.55, 0);
  await place('partition', -1.75, -0.4, Math.PI / 2);
  await place('partition', -1.75, 1.6, Math.PI / 2);
  // the neighbour operatory
  const ch2 = await place('chair_basic', -3.6, 0, 0, true);
  const p2 = await person('char_kid', -3.6, 0, 0, 'lie', 1, TINTS[1]);
  if (p2 && ch2) seatInChair(p2, ch2);
  await person('char_dentist', -2.8, -0.4, -Math.PI / 2 - 0.3, 'idle', 0, undefined, true);
  await place('op_lamp', -4.55, -0.85, Math.PI / 2);
  await place('ultrasonic_cart', -2.55, 0.5, -Math.PI / 2, true);
  await place('xray_unit', -4.7, 0.9, Math.PI / 2, true);
  await place('sterilizer', -3.4, -1.95, 0, true);
  await place('chair_comfort', 3.6, 0, 0, true);
  await place('op_lamp', 2.65, -0.85, Math.PI / 2);
  await place('partition', 1.8, -0.4, Math.PI / 2);
  await place('partition', 1.8, 1.6, Math.PI / 2);
}

async function viewLobby(): Promise<void> {
  await place('reception_desk', 0, -2.2, 0, true);
  await person('char_staff', 0.4, -2.75, 0, 'idle', 0, TINTS[4]);
  await place('kiosk', 1.8, -1.9, -0.3, true);
  await place('certificate', -0.6, -3.35, 0, true);
  await place('wall_tv', -3.2, -3.35, 0, true);
  await place('coat_rack', 2.9, -2.9, 0, true);
  await place('plant_tall', -1.6, -2.7, 0, true);
  // waiting area
  const waiting: [number, number, number][] = [[-4.1, -1.9, 0], [-3.4, -1.9, 0], [-2.7, -1.9, 0], [-4.8, -0.8, Math.PI / 2], [-4.8, -0.1, Math.PI / 2]];
  const sitters = ['char_senior', null, 'char_adult', 'char_kid', null];
  for (let i = 0; i < waiting.length; i++) {
    const [x, z, ry] = waiting[i];
    await place('waiting_chair', x, z, ry, i === 0);
    const k = sitters[i];
    if (k) {
      const r = await person(k, x, z, ry, 'sit', i, TINTS[i]);
      if (r) seatOn(r, x - Math.sin(ry) * 0.06, z - Math.cos(ry) * 0.06, ry, 0.43);
    }
  }
  await place('magazine_table', -3.4, -0.8, 0, true);
  await place('water_cooler', -2.0, -2.7, 0, true);
  await place('espresso_machine', -5.0, -2.8, Math.PI / 4, true);
  await place('plant_small', -5.0, 0.8, 0, true);
  await place('fish_tank', 3.6, -0.6, -Math.PI / 2, true);
  await place('kids_corner', 3.4, 1.6, 0, true);
  await person('char_kid', 3.1, 1.3, 0.6, 'idle', 2, TINTS[2]);
  await place('break_table', 6.2, -1.6, 0, true);
  await place('entrance_door', -1.2, 2.2, Math.PI, true);
  await place('tooth_sign', 1.0, 3.0, 0, true);
  await place('trash_bin', -2.2, -1.3, 0);
  await place('partition', 5.0, 0.4, Math.PI / 2);
  // someone walking in from the door
  const w = await person('char_adult', -1.2, 1.4, Math.PI, 'walk', 0, TINTS[1]);
  if (w) w.path = { from: new THREE.Vector3(-1.2, 0, 1.6), to: new THREE.Vector3(-0.4, 0, -1.2), speed: 0.9 };
}

/** Place a wall-mounted or against-the-wall model so its back touches the wall plane at z = wallZ. */
async function placeAgainst(k: string, x: number, wallZ: number, label = true): Promise<THREE.Object3D | null> {
  const obj = await place(k, x, 0, 0, label);
  if (!obj) return null;
  const b = new THREE.Box3().setFromObject(obj);
  obj.position.z = wallZ - b.min.z;
  return obj;
}

async function viewV3(): Promise<void> {
  // a back wall like the diorama's (2.7 m, warm white with a mint wainscot)
  const wallZ = -3.2;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(22, 2.7, 0.16), new THREE.MeshStandardMaterial({ color: '#FFF7EC', roughness: 0.85 }));
  wall.position.set(0.5, 1.35, wallZ - 0.08);
  wall.receiveShadow = true;
  scene.add(wall);
  const wain = new THREE.Mesh(new THREE.BoxGeometry(22, 0.9, 0.17), new THREE.MeshStandardMaterial({ color: '#D4F2E9', roughness: 0.85 }));
  wain.position.set(0.5, 0.45, wallZ - 0.08);
  scene.add(wain);
  // along the wall: the wall pieces and the tall cabinets
  await placeAgainst('water_filter', -9.2, wallZ);
  await placeAgainst('digital_xray', -7.6, wallZ);
  await placeAgainst('sound_panel', -5.7, wallZ);
  await placeAgainst('ai_screen', -3.8, wallZ);
  await placeAgainst('staff_lockers', -1.8, wallZ);
  await placeAgainst('loyalty_board', 0.0, wallZ);
  await placeAgainst('cadcam_mill', 1.6, wallZ);
  await placeAgainst('research_desk', 3.4, wallZ);
  await placeAgainst('patient_tablet', 4.8, wallZ);
  await placeAgainst('aroma_diffuser', 5.6, wallZ);
  await placeAgainst('smile_studio', 7.6, wallZ);
  // an operatory with the op upgrades, then the big pieces
  const ch = await place('chair_basic', -8.2, -0.5, 0, false);
  const pat = await person('char_adult', -8.2, -0.5, 0, 'lie', 0, TINTS[0]);
  if (pat && ch) seatInChair(pat, ch);
  await place('ergo_stool', -7.35, -0.9, -Math.PI / 2, true);
  await place('nitrous_tank', -9.3, -0.2, Math.PI / 2, true);
  await place('laser_whitening', -9.3, -1.3, Math.PI / 2 - 0.3, true);
  await place('spa_lounge', -5.0, -0.6, 0, true);
  await person('char_senior', -3.9, -0.3, -0.4, 'idle', 1, TINTS[1]);
  await place('rooftop_planter', -1.4, -0.7, 0, true);
  await place('helipad_sign', 1.3, -0.9, 0, true);
  await place('waiting_chair', 2.6, -0.8, 0, false);
  // event props
  const pup = await place('prop_puppy', -8.0, 2.0, 0.5, true);
  if (pup) makePet(pup, 0);
  await person('char_kid', -8.7, 1.8, 0.6, 'idle', 2, TINTS[2]);
  await place('prop_balloons', -6.6, 1.8, 0, true);
  await place('prop_jolly_roger', -5.0, 1.8, 0, true);
  await place('prop_rival_sign', -2.6, 1.9, 0, true);
  await place('prop_red_carpet', 0.3, 1.9, Math.PI / 2, true);
  await place('prop_generator', 2.6, 1.8, -0.3, true);
  await place('prop_camera_crew', 4.4, 1.8, 0.4, true);
  await person('char_staff', 5.4, 2.0, -0.5, 'idle', 3, TINTS[3]);
  await place('ultrasonic_cart', 6.6, -0.8, 0, false);
  await place('kiosk', 7.8, -0.8, 0, false);
}

async function viewFocus(k: string): Promise<void> {
  if (k.startsWith('char_')) await person(k, 0, 0, 0, 'walk', 0, undefined, true);
  else await place(k, 0, 0, 0, true);
}

function viewThumbs(): void {
  stage.style.display = 'none';
  const box = document.getElementById('thumbs')!;
  box.style.display = 'block';
  const keys = [
    ...Object.values(CHAIRS).map((c) => [c.model, c.name]),
    ...Object.values(OP_UPGRADES).map((c) => [c.model, c.name]),
    ...Object.values(EQUIPMENT).map((c) => [c.model, c.name]),
  ];
  let pending = 0;
  for (const bg of ['light', 'mint', 'dark']) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const [k, name] of keys) {
      const fig = document.createElement('figure');
      const card = document.createElement('div');
      card.className = 'card ' + bg;
      const img = document.createElement('img');
      pending++;
      img.onload = () => {
        if (img.naturalWidth !== 256 && !problems.includes(`${k}: thumb ${img.naturalWidth}px`)) problems.push(`${k}: thumb ${img.naturalWidth}px`);
        if (--pending === 0) window.__ready = true;
      };
      img.onerror = () => {
        if (!problems.includes(`${k}: thumb missing`)) problems.push(`${k}: thumb missing`);
        cap.className = 'bad';
        if (--pending === 0) window.__ready = true;
      };
      img.src = `/img/thumbs/${k}.png`;
      card.appendChild(img);
      const cap = document.createElement('figcaption');
      cap.innerHTML = `${name}<small>${k}</small>`;
      fig.append(card, cap);
      row.appendChild(fig);
    }
    box.appendChild(row);
  }
}

// ------------------------------------------------------------------ camera fit + frame loop
let controls: OrbitControls | null = null;

// The diorama's camera (src/clinic/camera.ts): perspective, FOV 30, 50 degrees down, 17 degrees to the right.
const GAME_CAM = VIEW === 'v3' && q.get('cam') !== 'iso';
const persp = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
function fitGame(w: number, h: number): void {
  persp.aspect = w / h;
  persp.updateProjectionMatrix();
  const box = new THREE.Box3();
  for (const it of items) box.union(new THREE.Box3().setFromObject(it.obj));
  const center = box.getCenter(new THREE.Vector3());
  center.y = 0;
  const el = THREE.MathUtils.degToRad(50), az = THREE.MathUtils.degToRad(17);
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  let lo = 2, hi = 200;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    persp.position.copy(center).addScaledVector(dir, mid);
    persp.lookAt(center);
    persp.updateMatrixWorld(true);
    const ok = corners.every((c) => { const pr = c.clone().project(persp); return Math.abs(pr.x) < 0.97 && Math.abs(pr.y) < 0.93; });
    if (ok) hi = mid; else lo = mid;
  }
  persp.position.copy(center).addScaledVector(dir, hi);
  persp.lookAt(center);
  persp.updateMatrixWorld(true);
  const r = box.getSize(new THREE.Vector3()).length() / 2 + 2;
  key.position.copy(center).add(new THREE.Vector3(6, 12, 8));
  key.target.position.copy(center);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = 60;
  sc.updateProjectionMatrix();
  if (!controls) { controls = new OrbitControls(persp, renderer.domElement); controls.enableDamping = true; }
  controls.target.copy(center);
  controls.update();
}
const viewCam = (): THREE.Camera => (GAME_CAM ? persp : camera);

function fit(): void {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  if (GAME_CAM) { fitGame(w, h); return; }
  const box = new THREE.Box3();
  const boxes = items.map((it) => new THREE.Box3().setFromObject(it.obj));
  for (const b of boxes) box.union(b);
  if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2, 2));
  const center = box.getCenter(new THREE.Vector3());
  const dist = 60;
  camera.position.copy(center).addScaledVector(ISO_DIR, dist);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const inv = camera.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const b of boxes) {
    for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
      const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
  }
  const pad = VIEW === 'focus' ? 1.25 : 1.06;
  let hw = ((x1 - x0) / 2) * pad;
  let hh = ((y1 - y0) / 2) * pad + (VIEW === 'grid' ? 0.35 : 0.1);
  if (hw / hh > w / h) hh = hw / (w / h); else hw = hh * (w / h);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - (VIEW === 'grid' ? 0.2 : 0);
  camera.left = mx - hw; camera.right = mx + hw; camera.top = my + hh; camera.bottom = my - hh;
  camera.near = 1; camera.far = dist * 3;
  camera.updateProjectionMatrix();
  // shadows cover the content
  const r = box.getSize(new THREE.Vector3()).length() / 2 + 2;
  key.position.copy(center).add(new THREE.Vector3(6, 12, 8));
  key.target.position.copy(center);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = 60;
  sc.updateProjectionMatrix();
  if (!controls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
  }
  controls.target.copy(center);
  controls.update();
}

const tmp = new THREE.Vector3();
function placeLabels(): void {
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  for (const [it, el] of labelEls) {
    const box = new THREE.Box3().setFromObject(it.obj);
    tmp.set((box.min.x + box.max.x) / 2, 0, box.max.z);
    tmp.project(viewCam());
    el.style.left = `${((tmp.x + 1) / 2) * w}px`;
    el.style.top = `${((1 - tmp.y) / 2) * h + 4}px`;
  }
}

async function main(): Promise<void> {
  if (VIEW === 'thumbs') { viewThumbs(); return; }
  if (VIEW === 'people') await viewPeople();
  else if (VIEW === 'op') await viewOp();
  else if (VIEW === 'lobby') await viewLobby();
  else if (VIEW === 'v3') await viewV3();
  else if (VIEW === 'focus' && FOCUS) await viewFocus(FOCUS);
  else await viewGrid();
  for (const r of rigs) animate(r, T0, 0);
  fit();
  window.addEventListener('resize', fit);
  const clock = new THREE.Clock();
  let t = T0;
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!STILL) t += dt;
    for (const r of rigs) animate(r, t, dt);
    for (const pt of pets) animatePet(pt, t);
    controls?.update();
    renderer.render(scene, viewCam());
    placeLabels();
    requestAnimationFrame(loop);
  };
  loop();
  const total = Object.keys(stats).length;
  info.textContent = `${total} models, ${rigs.length} rigs, ${problems.length ? problems.length + ' problems: ' + problems.join('; ') : 'no problems'}`;
  window.__ready = true;
}

main().catch((e) => {
  info.textContent = String(e);
  console.error(e);
});
