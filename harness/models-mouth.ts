// Model check for the art-mouth set: every mouth and tool GLB in a grid, plus the assembled mouth
// (frame, gums, tongue, 28 teeth from layoutTeeth(), a few tartar lumps and debris bits, a tool).
//
//   /harness/models-mouth.html                     grid of every MOUTH_MODELS + TOOL_MODELS key
//   /harness/models-mouth.html?view=tools          tools only, bigger cells
//   /harness/models-mouth.html?view=mouth&cam=front|left|right|upper|lower|close|top
//        &missing=3,17   leave teeth out      &hide=frame,tongue,dirt   hide parts
//        &tool=tool_scaler   hold a tool at a tooth        &origin=1   show model origins (grid)
//        &case=pirate|candy|braces   place that case's props (barnacles, seaweed, doubloon, gold tooth;
//                                    sugar bugs; brackets and a wire)
//        &jaw=0..1   close the jaw: the lower arch rises 1.62 and the frame's LipLower node follows
//        &jawmode=morph|move|rot   LipLower by its JawClose morph target (default, seamless), by translation
//                                  (y + 0.9 jaw) or by rotation about its hinge pivot (-0.11 jaw about X)
//   /harness/models-mouth.html?only=key1,key2      grid of just those keys (e.g. the case props)
//
// window.__ready is true once everything has loaded (tools/snap.mjs waits on it).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MOUTH_MODELS, TOOL_MODELS } from '../src/data/assets';
import { layoutTeeth, TOOTH_DIMS, UPPER_GUM_Y, LOWER_GUM_Y, type ToothPlacement } from '../src/core/mouth';

declare global { interface Window { __ready?: boolean; __stats?: Record<string, { tris: number; kb: number }> } }

const q = new URLSearchParams(location.search);
const VIEW = q.get('view') || 'grid';
const CAM = q.get('cam') || 'front';
const HIDE = new Set((q.get('hide') || '').split(',').filter(Boolean));
const MISSING = new Set((q.get('missing') || '').split(',').filter(Boolean).map(Number));
const SHOW_ORIGIN = q.get('origin') === '1';
const TOOL = q.get('tool');
const SHADOWS = q.get('shadows') !== '0';
const CASE = q.get('case');
const JAW = Math.max(0, Math.min(1, Number(q.get('jaw') || 0)));
const JAWMODE = q.get('jawmode') || 'morph';

const stage = document.getElementById('stage')!;
const labels = document.getElementById('labels')!;
const info = document.getElementById('info')!;
const bar = document.getElementById('bar')!;

// ------------------------------------------------------------------ nav
const links: [string, string][] = [
  ['Grid', '?view=grid'], ['Tools', '?view=tools'], ['Mouth', '?view=mouth&cam=front'], ['Left', '?view=mouth&cam=left'],
  ['Right', '?view=mouth&cam=right'], ['Upper', '?view=mouth&cam=upper'], ['Lower', '?view=mouth&cam=lower'],
  ['Close', '?view=mouth&cam=close&tool=tool_scaler'],
  ['Cases', '?only=tartar_barnacle,debris_seaweed,doubloon,sugar_bug,bracket,tool_gelbrush,tool_uvlamp'],
  ['Pirate', '?view=mouth&cam=front&case=pirate&missing=4,17,23'], ['Candy', '?view=mouth&cam=front&case=candy'],
  ['Braces', '?view=mouth&cam=front&case=braces'], ['Jaw', '?view=mouth&cam=front&jaw=1'],
];
for (const [name, href] of links) {
  const a = document.createElement('a');
  a.textContent = name;
  a.href = href;
  const hp = new URLSearchParams(href.slice(1));
  if (hp.get('view') === VIEW && (VIEW !== 'mouth' || hp.get('cam') === CAM)) a.className = 'on';
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

const loader = new GLTFLoader();
// &frameurl=/out/some/mouth_frame.glb swaps in another frame build (before/after checks)
const FRAME_URL = q.get('frameurl');
const url = (key: string) => (key === 'mouth_frame' && FRAME_URL ? FRAME_URL : `/models/${key}.glb`);
const cache = new Map<string, Promise<THREE.Group | null>>();
function load(key: string): Promise<THREE.Group | null> {
  let p = cache.get(key);
  if (!p) {
    p = new Promise((res) => loader.load(url(key), (g) => res(g.scene), undefined, () => res(null)));
    cache.set(key, p);
  }
  return p;
}
/** Transfer size of an already loaded model, read from the resource timing entry (no extra request). */
function sizeKb(key: string): number {
  const abs = new URL(url(key), location.href).href;
  const e = performance.getEntriesByName(abs)[0] as PerformanceResourceTiming | undefined;
  return e ? (e.encodedBodySize || e.transferSize || 0) / 1024 : 0;
}
function tris(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return n;
}
function lights(scene: THREE.Scene, shadows = false): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xf2c4cc, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(3, 7, 10);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -9; c.right = 9; c.top = 9; c.bottom = -9; c.near = 1; c.far = 40;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff1e8, 0.6);
  fill.position.set(-6, -2, 6);
  scene.add(fill);
}

// ------------------------------------------------------------------ grid
interface Cell { key: string; scene: THREE.Scene; cam: THREE.PerspectiveCamera; el: HTMLDivElement }

async function grid(keys: string[]): Promise<void> {
  document.body.style.background = '#e9f4f1';
  const cells: Cell[] = [];
  const stats: Record<string, { tris: number; kb: number }> = {};
  await Promise.all(keys.map(async (key) => {
    const obj = await load(key);
    const kb = sizeKb(key);
    const scene = new THREE.Scene();
    lights(scene);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 500);
    const el = document.createElement('div');
    el.className = 'lbl';
    if (!obj) {
      el.classList.add('bad');
      el.innerHTML = `${key}<small>missing</small>`;
    } else {
      const o = obj.clone(true);
      scene.add(o);
      if (SHOW_ORIGIN) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff00aa, depthTest: false }));
        dot.renderOrder = 10;
        scene.add(dot);
        (dot as any).__origin = true;
      }
      const box = new THREE.Box3().setFromObject(o);
      const sph = box.getBoundingSphere(new THREE.Sphere());
      const dir = key === 'mouth_frame' || key.startsWith('gum_') || key === 'tongue'
        ? new THREE.Vector3(0.15, key === 'gum_lower' || key === 'tongue' ? 0.9 : key === 'gum_upper' ? -0.9 : 0.1, 1)
        : key.startsWith('tool_') || key.startsWith('extra_') ? new THREE.Vector3(1, 0.35, 1.2) : new THREE.Vector3(0.9, 0.6, 1.4);
      dir.normalize();
      const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
      cam.position.copy(sph.center).addScaledVector(dir, dist);
      cam.lookAt(sph.center);
      cam.near = dist / 50; cam.far = dist * 4; cam.updateProjectionMatrix();
      scene.traverse((c) => { if ((c as any).__origin) c.scale.setScalar(sph.radius * 0.03); });
      const t = tris(o);
      stats[key] = { tris: t, kb: Math.round(kb * 10) / 10 };
      el.innerHTML = `${key}<small>${t} tris, ${kb.toFixed(1)} KB</small>`;
    }
    labels.appendChild(el);
    cells.push({ key, scene, cam, el });
  }));
  cells.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
  window.__stats = stats;

  const layout = () => {
    const w = window.innerWidth;
    const h = window.innerHeight - 44;
    const n = cells.length;
    let cols = Math.ceil(Math.sqrt(n * w / h));
    let rows = Math.ceil(n / cols);
    while ((cols - 1) * rows >= n && cols > 1) cols--;
    rows = Math.ceil(n / cols);
    const cw = w / cols;
    const ch = h / rows;
    renderer.setSize(w, window.innerHeight);
    renderer.setScissorTest(true);
    renderer.setClearColor(0xe9f4f1, 1);
    renderer.clear();
    cells.forEach((c, i) => {
      const cx = (i % cols) * cw;
      const cy = 44 + Math.floor(i / cols) * ch;
      c.el.style.left = `${cx}px`;
      c.el.style.top = `${cy}px`;
      c.cam.aspect = cw / ch;
      if (c.cam.aspect < 1) c.cam.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(15)) / c.cam.aspect));
      c.cam.updateProjectionMatrix();
      const y = window.innerHeight - cy - ch;
      renderer.setViewport(cx, y, cw, ch);
      renderer.setScissor(cx + 1, y + 1, cw - 2, ch - 2);
      renderer.setClearColor((i + Math.floor(i / cols)) % 2 ? 0xdff0ec : 0xf2faf8, 1);
      renderer.clear();
      renderer.render(c.scene, c.cam);
    });
  };
  layout();
  window.addEventListener('resize', layout);
  const total = Object.values(stats).reduce((a, s) => a + s.kb, 0);
  info.textContent = `${Object.keys(stats).length} of ${keys.length} models, ${total.toFixed(0)} KB total`;
  requestAnimationFrame(() => { layout(); window.__ready = true; });
}

// ------------------------------------------------------------------ assembled mouth
function placeTooth(o: THREE.Object3D, p: ToothPlacement): void {
  o.position.set(p.x, p.y, p.z);
  // upper teeth: flip the crown to -Y with a half turn about Z (labial face stays +Z), then yaw
  o.rotation.set(0, p.yaw, p.dir < 0 ? Math.PI : 0, 'YXZ');
  o.scale.set(p.width / TOOTH_DIMS[p.kind].w, 1, 1);
}

/** Point on a tooth's surface: tooth-local height fraction v (0 gumline, 1 edge) and angle (0 = labial). */
function toothSurface(tooth: THREE.Object3D, p: ToothPlacement, v: number, ang = 0, xOff = 0): { pos: THREE.Vector3; nrm: THREE.Vector3 } | null {
  tooth.updateMatrixWorld(true);
  const h = TOOTH_DIMS[p.kind].h;
  const local = new THREE.Vector3(Math.sin(ang) * 3 + xOff, v * h, Math.cos(ang) * 3);
  const target = new THREE.Vector3(xOff * 0.3, v * h, 0);
  const from = tooth.localToWorld(local.clone());
  const to = tooth.localToWorld(target.clone());
  const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize());
  const hit = ray.intersectObject(tooth, true)[0];
  if (!hit || !hit.face) return null;
  const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  return { pos: hit.point.clone(), nrm };
}

const CASE_KEYS = ['tartar_barnacle', 'debris_seaweed', 'doubloon', 'sugar_bug', 'bracket'];
type AddFn = (k: string, fn?: (o: THREE.Object3D) => void) => THREE.Object3D | null;

/** Case props placed the way the clean scene does it: deposits and bugs with +Y along the surface normal,
 *  brackets with X along the arch and a wire through their slots, debris turned so +Z faces out of the gap. */
async function caseProps(kind: string, scene: THREE.Scene, placements: ToothPlacement[], toothObj: Map<number, THREE.Object3D>, add: AddFn): Promise<void> {
  const onTooth = (idx: number, v: number, key: string, spin: number, xOff = 0) => {
    const t = toothObj.get(idx);
    const p = placements[idx];
    if (!t) return null;
    const s = toothSurface(t, p, v, 0, xOff);
    if (!s) return null;
    return add(key, (o) => {
      o.position.copy(s.pos);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.nrm);
      o.rotateY(spin);
      o.userData.arch = p.arch;
    });
  };
  const inGap = (a: number, key: string, v: number) => {
    const pa = placements[a], pb = placements[a + 1];
    const hgt = Math.min(pa.height, pb.height) * v * pa.dir;
    const n = new THREE.Vector3((pa.nx + pb.nx) / 2, 0, (pa.nz + pb.nz) / 2).normalize();
    return add(key, (o) => {
      o.position.set((pa.x + pb.x) / 2, pa.y + hgt, (pa.z + pb.z) / 2).addScaledVector(n, Math.min(pa.depth, pb.depth) * 0.42);
      o.lookAt(o.position.clone().add(n));
      o.userData.arch = pa.arch;
    });
  };
  if (kind === 'pirate') {
    for (const [i, v, sp] of [[2, 0.2, 0.4], [9, 0.18, 2.1], [16, 0.2, 1.2], [21, 0.22, 4.0], [25, 0.2, 5.1]]) onTooth(i, v, 'tartar_barnacle', sp);
    for (const [a, v] of [[7, 0.45], [19, 0.5]]) {
      const o = inGap(a, 'debris_seaweed', v);
      if (o) { o.scale.setScalar(0.8); o.rotateZ(0.25); }
    }
    inGap(25, 'doubloon', 0.45);
    // gold tooth: the clean scene tints the enamel; here a quick stand-in
    const g = toothObj.get(5);
    g?.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: '#F2C14E', metalness: 0.35, roughness: 0.25 });
    });
  } else if (kind === 'candy') {
    for (const [i, v, sp] of [[3, 0.45, 0.6], [8, 0.4, 2.4], [18, 0.45, 4.2], [22, 0.5, 1.1], [11, 0.45, 5.5]]) onTooth(i, v, 'sugar_bug', sp);
  } else if (kind === 'braces') {
    const pts: THREE.Vector3[][] = [[], []];
    for (const p of placements) {
      if (p.pos < 2 || p.pos > 11) continue;
      const t = toothObj.get(p.index);
      if (!t) continue;
      const s = toothSurface(t, p, 0.5, 0);
      if (!s) continue;
      const o = add('bracket', (b) => {
        // basis: Y along the surface normal, X along the arch (the tooth's local X), Z = X x Y
        const y = s.nrm.clone();
        const x = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
        x.addScaledVector(y, -x.dot(y)).normalize();
        const z = new THREE.Vector3().crossVectors(x, y);
        b.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        b.position.copy(s.pos);
        b.userData.arch = p.arch;
      });
      if (o) pts[p.arch === 'upper' ? 0 : 1].push(o.localToWorld(new THREE.Vector3(0, 0.066, 0)));
    }
    for (const arch of pts) {
      if (arch.length < 2) continue;
      arch.sort((a, b) => a.x - b.x);
      const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch), 80, 0.02, 8),
        new THREE.MeshStandardMaterial({ color: '#C9D2DA', metalness: 0.4, roughness: 0.25 }));
      wire.userData.arch = arch === pts[1] ? 'lower' : 'upper';
      scene.add(wire);
    }
  }
}

async function mouth(): Promise<void> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfeee7);
  lights(scene, SHADOWS);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const presets: Record<string, [number[], number[]]> = {
    front: [[0, 0.3, 15.5], [0, 0, 0]],
    left: [[-7.5, 0.5, 12.5], [-1.2, 0, 0]],
    right: [[7.5, 0.5, 12.5], [1.2, 0, 0]],
    upper: [[0, -5.5, 12.5], [0, 1.2, 0]],
    lower: [[0, 6, 12.5], [0, -1.2, 0]],
    close: [[3.5, -0.6, 7.2], [0.9, -1.4, 1.6]],
    top: [[0, 18, 2], [0, 0, 0]],
    far: [[0, 0.5, 30], [0, 0, 0]],
    corner: [[9, 1.5, 11], [5.2, 0.3, 3]],
    side: [[16, 2, 10], [0, 0, 0]],
  };
  const [pos, look] = presets[CAM] || presets.front;
  cam.position.set(pos[0], pos[1], pos[2]);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.target.set(look[0], look[1], look[2]);
  controls.update();

  const keys = ['mouth_frame', 'gum_upper', 'gum_lower', 'tongue', 'tooth_incisor', 'tooth_canine', 'tooth_premolar', 'tooth_molar',
    'tartar_a', 'tartar_b', 'tartar_c', 'debris_popcorn', 'debris_spinach', 'debris_seed', 'debris_candy',
    ...(CASE ? CASE_KEYS : [])];
  const M: Record<string, THREE.Group | null> = {};
  await Promise.all(keys.map(async (k) => { M[k] = await load(k); }));
  const add = (k: string, fn?: (o: THREE.Object3D) => void) => {
    const src = M[k];
    if (!src) return null;
    const o = src.clone(true);
    o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    fn?.(o);
    scene.add(o);
    return o;
  };
  // the lower arch lives in its own group so ?jaw= can close it like the clean scene does
  const lower = new THREE.Group();
  scene.add(lower);
  const addLower = (k: string, fn?: (o: THREE.Object3D) => void) => {
    const o = add(k, fn);
    if (o) lower.attach(o);
    return o;
  };
  if (!HIDE.has('frame')) {
    const f = add('mouth_frame');
    const lip = f?.getObjectByName('LipLower');
    if (lip) {
      if (JAWMODE === 'rot') lip.rotation.x = -JAW * 0.11;
      else if (JAWMODE === 'move') lip.position.y += JAW * 0.9;
      else lip.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && m.morphTargetInfluences) m.morphTargetInfluences[0] = JAW; });
    }
    info.dataset.lip = lip ? `LipLower at ${lip.position.toArray().map((v) => v.toFixed(2)).join(', ')}` : 'no LipLower node';
  }
  if (!HIDE.has('gums')) {
    add('gum_upper', (o) => { o.position.y = UPPER_GUM_Y; });
    addLower('gum_lower', (o) => { o.position.y = LOWER_GUM_Y; });
  }
  if (!HIDE.has('tongue')) addLower('tongue');
  const placements = layoutTeeth();
  const toothObj = new Map<number, THREE.Object3D>();
  if (!HIDE.has('teeth')) {
    for (const p of placements) {
      if (MISSING.has(p.index)) continue;
      const o = add('tooth_' + p.kind, (t) => placeTooth(t, p));
      if (o) toothObj.set(p.index, o);
      if (o && p.arch === 'lower') lower.attach(o);
    }
  }
  scene.updateMatrixWorld(true);
  // a few tartar lumps at the gumline and debris in the gaps, for scale and fit
  if (!HIDE.has('dirt')) {
    const tartar: [number, number, string, number][] = [[20, 0.12, 'tartar_a', 0], [21, 0.1, 'tartar_b', 0.1], [22, 0.14, 'tartar_c', -0.1],
      [12, 0.13, 'tartar_b', 0], [3, 0.12, 'tartar_a', 0], [26, 0.12, 'tartar_c', 0], [6, 0.12, 'tartar_c', 0.1]];
    for (const [idx, v, k, xo] of tartar) {
      const t = toothObj.get(idx);
      const p = placements[idx];
      if (!t) continue;
      const s = toothSurface(t, p, v, 0, xo);
      if (!s) continue;
      add(k, (o) => {
        o.position.copy(s.pos);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.nrm);
        o.rotateY(idx * 1.3);
        o.userData.arch = p.arch;
      });
    }
    const debris: [number, string][] = [[19, 'debris_spinach'], [7, 'debris_popcorn'], [24, 'debris_seed'], [10, 'debris_candy']];
    for (const [idx, k] of debris) {
      const a = placements[idx];
      const b = placements[idx + 1];
      const hgt = Math.min(a.height, b.height) * 0.45 * a.dir;
      const n = new THREE.Vector3((a.nx + b.nx) / 2, 0, (a.nz + b.nz) / 2).normalize();
      add(k, (o) => {
        o.position.set((a.x + b.x) / 2, a.y + hgt, (a.z + b.z) / 2).addScaledVector(n, Math.min(a.depth, b.depth) * 0.42);
        o.rotation.y = Math.atan2(n.x, n.z);
        o.userData.arch = a.arch;
      });
    }
  }
  if (CASE) await caseProps(CASE, scene, placements, toothObj, add);
  scene.updateMatrixWorld(true);
  for (const o of [...scene.children]) {
    // dirt and props placed on lower teeth ride with the lower arch
    if (o === lower || o.userData.arch !== 'lower') continue;
    lower.attach(o);
  }
  lower.position.y = JAW * 1.62;
  if (TOOL) {
    const src = await load(TOOL);
    const p = placements[21];
    const t = toothObj.get(21);
    if (src && t) {
      const s = toothSurface(t, p, 0.25, 0.25);
      if (s) {
        const o = src.clone(true);
        o.position.copy(s.pos);
        // handle out of the mouth toward the viewer, up and to the right
        const handle = new THREE.Vector3(0.45, 0.62, 0.65).normalize();
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), handle);
        scene.add(o);
      }
    }
  }
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  let frames = 0;
  const loop = () => {
    controls.update();
    renderer.render(scene, cam);
    if (++frames === 3) window.__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
  const missing = keys.filter((k) => !M[k]);
  info.textContent = missing.length ? `Missing: ${missing.join(', ')}` : `cam ${CAM}`;
}

if (VIEW === 'mouth') void mouth();
else if (VIEW === 'tools') void grid([...TOOL_MODELS]);
else {
  const only = q.get('only');
  void grid(only ? only.split(',') : [...MOUTH_MODELS, ...TOOL_MODELS]);
}
