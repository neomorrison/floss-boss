// PUBLIC CLINIC VIEW API. Owner: clinic builder. The living 3D office diorama (view only, no rules).
// The UI owns the frame loop: every animation frame it calls view.frame(clinic, minute, dtRealSeconds).
// The view derives all positions from the clinic state (patient.state + since/until, op assignments),
// so it never needs to be told about moves; SimEvents are only for one-shot effects (coins, stars, bubbles).
import * as THREE from 'three';
import type { Clinic, SimEvent } from '../core/types';
import { attachRenderer, getRenderer } from '../core/renderer';
import { loadSettings } from '../core/save';
import { bus } from '../core/bus';
import { money } from '../core/format';
import { CLOSE_MIN, PLAYER_ID } from '../core/constants';
import { CLINIC_MODELS, PEOPLE_MODELS } from '../data/assets';
import { OFFICES } from '../data/offices';
import { audio } from '../audio';
import { layoutFor, type ClinicLayout } from './layout';
import { Office, type HitInfo } from './office';
import { Actors } from './actors';
import { CameraRig, attachInput, type TapInfo } from './camera';
import { OverlayLayer, type Mood } from './overlays';
import { requestModel } from './props';
import { cleaningProgress } from './flow';
import { backgroundTexture } from './palette';

export interface ClinicViewHandlers {
  onOpClick(opId: string): void;          // an operatory (chair, cubicle or its hygienist)
  onEmptySlotClick(slot: number): void;   // a slot with no operatory yet ("Add operatory")
  onStaffClick(staffId: string): void;    // receptionist, dentist, manager, assistant
  onPatientClick(patientId: string): void;
  onDeskClick(): void;
}

export interface ClinicView {
  frame(clinic: Clinic, minute: number, dt: number): void;
  events(events: SimEvent[]): void;
  /** Camera glides to an operatory (after a hands-on clean, or when a patient awaits the player). */
  focusOp(opId: string | null): void;
  /** Visual highlight (selected op). */
  select(opId: string | null): void;
  /** true while the view is hidden behind the clean scene (skip rendering, keep state). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

const ALL_KEYS: string[] = [...CLINIC_MODELS, ...PEOPLE_MODELS];
let preloading: Promise<void> | null = null;

/** Load every clinic and people model (missing files resolve too; the view then uses stand-ins). */
export function preloadClinic(): Promise<void> {
  if (!preloading) preloading = Promise.all(ALL_KEYS.map(requestModel)).then(() => undefined);
  return preloading;
}

const TAG_WORKER = 'worker';
const TAG_PATIENT = 'patient';
const SLOT_KEYS = Array.from({ length: 16 }, (_, i) => 's' + i);

const HOST_CSS = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;';

// Day and dusk lighting (late afternoon warms up from 15:00 to closing).
const DAY = { key: new THREE.Color('#FFF3E0'), keyI: 2.35, sky: new THREE.Color('#FFFFFF'), ground: new THREE.Color('#E6D6BF'), hemiI: 1.35, bgTop: '#CFF3EA', bgBot: '#FFF6E8', fill: new THREE.Color('#D9F0FF') };
const DUSK = { key: new THREE.Color('#FFBF80'), keyI: 2.25, sky: new THREE.Color('#FFEEDD'), ground: new THREE.Color('#DEC3A6'), hemiI: 1.28, bgTop: '#FFDDBB', bgBot: '#FFF2E2', fill: new THREE.Color('#FFDCCB') };

export function createClinicView(container: HTMLElement, handlers: Partial<ClinicViewHandlers>): ClinicView {
  preloadClinic();
  const host = document.createElement('div');
  host.className = 'fbc-host';
  host.style.cssText = HOST_CSS;
  const canvasHost = document.createElement('div');
  canvasHost.style.cssText = 'position:absolute;inset:0;';
  host.appendChild(canvasHost);
  container.appendChild(host);
  const overlays = new OverlayLayer(host);

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(DAY.sky, DAY.ground, DAY.hemiI);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(DAY.key, DAY.keyI);
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(DAY.fill, 0.5);
  scene.add(fill, fill.target);
  let bgT = -1;
  let bgTex: THREE.Texture | null = null;

  const rig = new CameraRig();
  const office = new Office();
  const actors = new Actors();
  scene.add(office.group, actors.group);

  // ---------------------------------------------------------------- state
  let layout: ClinicLayout | null = null;
  let clinicId = '';
  let lastClinic: Clinic | null = null;
  let lastMinute = NaN;
  let rate = 5;
  let framesLive = 0;
  let visible = true;
  let disposed = false;
  let modelsDirty = false;
  let modelsDone = false;
  let selectedOp: string | null = null;
  let w = 1, h = 1;
  let needFit = true;
  let hover: { x: number; y: number } | null = null;
  let hoverCursor = '';
  let now = 0;
  const t0 = performance.now();
  let detach: (() => void) | null = null;
  const proxyList: THREE.Object3D[] = [];
  const hits: THREE.Intersection[] = [];

  preloadClinic().then(() => { modelsDirty = true; modelsDone = true; });

  const attach = () => {
    if (detach) return;
    detach = attachRenderer(canvasHost, (ww, hh) => {
      w = ww; h = hh;
      rig.resize(ww, hh);
      if (layout) rig.fit(layout.ground, layout.floor, !needFit && rig.userMoved);
    });
  };
  attach();

  let shadowsOn = true;
  const applyQualitySetting = () => {
    shadowsOn = loadSettings().quality === 'high';
    key.castShadow = shadowsOn;
  };
  applyQualitySetting();
  const offSettings = bus.on('settings:changed', applyQualitySetting);

  // ---------------------------------------------------------------- picking
  function pickHit(x: number, y: number): HitInfo | null {
    proxyList.length = 0;
    for (const p of office.proxies) proxyList.push(p);
    for (const a of actors.all()) proxyList.push(a.person.hit);
    const ray = rig.raycaster(x, y);
    hits.length = 0;
    ray.intersectObjects(proxyList, false, hits);
    for (const hh of hits) {
      const info = hh.object.userData.hit as HitInfo | undefined;
      if (info) return info;
    }
    return null;
  }

  function tap(t: TapInfo): void {
    const el = t.target as HTMLElement | null;
    const opEl = el?.closest?.('[data-op]') as HTMLElement | null;
    if (opEl?.dataset.op) { handlers.onOpClick?.(opEl.dataset.op); return; }
    const slotEl = el?.closest?.('[data-slot]') as HTMLElement | null;
    if (slotEl?.dataset.slot) { handlers.onEmptySlotClick?.(Number(slotEl.dataset.slot)); return; }
    const hit = pickHit(t.x, t.y);
    if (!hit) return;
    switch (hit.kind) {
      case 'op': handlers.onOpClick?.(hit.id); break;
      case 'slot': handlers.onEmptySlotClick?.(hit.slot ?? 0); break;
      case 'desk': handlers.onDeskClick?.(); break;
      case 'patient': handlers.onPatientClick?.(hit.id); break;
      case 'staff': handlers.onStaffClick?.(hit.id); break;
    }
  }
  const offInput = attachInput(host, rig, tap, (x, y) => { hover = { x, y }; });

  // ---------------------------------------------------------------- door
  actors.door = {
    x: 0, z: 0,
    onCross(entering, first) {
      office.openDoor(now);
      if (first && entering) audio.play('door_chime', { volume: 0.7 });
    },
  };

  // ---------------------------------------------------------------- lighting
  function lightFor(l: ClinicLayout, minute: number): void {
    const t = THREE.MathUtils.smoothstep(minute, 900, CLOSE_MIN);
    key.color.copy(DAY.key).lerp(DUSK.key, t);
    key.intensity = DAY.keyI + (DUSK.keyI - DAY.keyI) * t;
    hemi.color.copy(DAY.sky).lerp(DUSK.sky, t);
    hemi.groundColor.copy(DAY.ground).lerp(DUSK.ground, t);
    hemi.intensity = DAY.hemiI + (DUSK.hemiI - DAY.hemiI) * t;
    fill.color.copy(DAY.fill).lerp(DUSK.fill, t);
    const cx = (l.ground.x0 + l.ground.x1) / 2, cz = (l.ground.z0 + l.ground.z1) / 2;
    // sun swings from the front-left toward the west (right) and lowers in the afternoon
    const dx = -9 + 21 * t, dy = 15 - 6 * t, dz = 9 - 2 * t;
    key.position.set(cx + dx, dy, cz + dz);
    key.target.position.set(cx, 0, cz);
    fill.position.set(cx + 12, 8, cz + 12);
    fill.target.position.set(cx, 0, cz);
    const sc = key.shadow.camera;
    const half = Math.max(l.ground.x1 - l.ground.x0, l.ground.z1 - l.ground.z0) * 0.62;
    if (sc.right !== half) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = 80;
      sc.updateProjectionMatrix();
    }
    if (Math.abs(t - bgT) > 0.04 || !bgTex) {
      bgT = t;
      const top = '#' + new THREE.Color(DAY.bgTop).lerp(new THREE.Color(DUSK.bgTop), t).getHexString();
      const bot = '#' + new THREE.Color(DAY.bgBot).lerp(new THREE.Color(DUSK.bgBot), t).getHexString();
      const next = backgroundTexture(top, bot);
      scene.background = next;
      bgTex?.dispose();
      bgTex = next;
    }
  }

  // ---------------------------------------------------------------- overlays
  function drawOverlays(c: Clinic, minute: number): void {
    overlays.begin(rig.camera, w, h, now);
    const l = layout!;
    const byId = actors.patients;
    for (const o of c.ops) {
      const L = l.ops[o.slot];
      if (!L) continue;
      if (o.patientId) {
        let p = null;
        for (const q of c.patients) if (q.id === o.patientId) { p = q; break; }
        const a = byId.get(o.patientId);
        const seated = a ? a.settlePose === 'recline' && a.settle > 0.6 : false;
        // the "!" shows as soon as your patient is assigned; the ring once they are in the chair
        if (p && p.awaitingPlayer) overlays.alert(o.id, L.chair.x, 2.75, L.chair.z, o.id);
        else if (p && seated) {
          const prog = cleaningProgress(p, minute);
          if (prog !== null) overlays.ring(o.id, L.chair.x, 2.3, L.chair.z, prog, o.staffId === PLAYER_ID);
        }
      }
    }
    for (const a of byId.values()) {
      const p = a.patient;
      if (!p || a.scale < 0.5) continue;
      const y = a.headY + 0.22;
      if (p.state === 'waiting' && a.settle > 0.6) {
        overlays.bar(p.id, a.x, y, a.z, 1 - p.waitedMin / Math.max(1, p.patience));
      } else if (p.state === 'inChair' && p.awaitingPlayer && a.settle > 0.6) {
        overlays.bar(p.id, a.x, y, a.z, 1 - p.waitedMin / Math.max(1, p.patience * 1.5));
      } else if (p.state === 'walkout') {
        overlays.mood(p.id, a.x, y + 0.05, a.z, 'angry');
      } else if ((p.state === 'toDesk' || p.state === 'checkout' || p.state === 'exiting') && p.quality !== null) {
        overlays.mood(p.id, a.x, y + 0.05, a.z, (p.mood ?? 'ok') as Mood);
      }
    }
    // name tags for the selected operatory
    if (selectedOp) {
      let o = null;
      for (const x of c.ops) if (x.id === selectedOp) { o = x; break; }
      if (o) {
        const worker = o.staffId ? actors.staff.get(o.staffId) : undefined;
        if (worker) {
          const name = o.staffId === PLAYER_ID ? 'You' : worker.staff?.name ?? '';
          if (name) overlays.tag(TAG_WORKER, worker.x, worker.headY + 0.3, worker.z, name, o.staffId === PLAYER_ID);
        }
        const pa = o.patientId ? byId.get(o.patientId) : undefined;
        if (pa?.patient) {
          // in the chair: tag at the foot of the chair, clear of the hygienist's tag
          const L = l.ops[o.slot];
          if (L && pa.settlePose === 'recline') overlays.tag(TAG_PATIENT, L.bedside.x, 1.25, L.bedside.z, pa.patient.name);
          else overlays.tag(TAG_PATIENT, pa.x, pa.headY + 0.35, pa.z, pa.patient.name);
        }
      }
    }
    // "+" on empty slots of your own clinic
    if (c.ownedByPlayer) {
      const slots = Math.min(l.ops.length, OFFICES[l.tier].opSlots);
      for (let i = 0; i < slots; i++) {
        let built = false;
        for (const o of c.ops) if (o.slot === i) { built = true; break; }
        if (!built) overlays.plus(SLOT_KEYS[i] ?? String(i), l.ops[i].center.x, 0.5, l.ops[i].center.z, i);
      }
    }
    overlays.end();
  }

  // ---------------------------------------------------------------- frame
  // per-section CPU timing over the last 120 frames (debug stats only)
  const PN = 120;
  const prof = { total: new Float32Array(PN), actors: new Float32Array(PN), overlays: new Float32Array(PN), office: new Float32Array(PN), i: 0, n: 0 };
  const pstat = (a: Float32Array) => {
    const s = Array.from(a.subarray(0, Math.max(1, prof.n))).sort((x, y) => x - y);
    const q = (f: number) => +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(2);
    return { p50: q(0.5), p90: q(0.9), max: q(1) };
  };
  function frame(c: Clinic, minute: number, dt: number): void {
    if (disposed) return;
    const tStart = performance.now();
    now = (performance.now() - t0) / 1000;
    lastClinic = c;
    const l = layoutFor(c.tier);
    const switched = c.id !== clinicId || l !== layout;
    if (switched) {
      const layoutChanged = l !== layout;
      clinicId = c.id;
      layout = l;
      framesLive = 0;
      actors.door!.x = l.door.x; actors.door!.z = l.door.z;
      if (layoutChanged) needFit = true;
    }
    const tS = performance.now();
    if (modelsDirty) {
      modelsDirty = false;
      office.sync(l, c, true);
      actors.rebuildPeople();
    } else {
      office.sync(l, c);
    }
    prof.office[prof.i] = performance.now() - tS;
    if (needFit && w > 1) { rig.fit(l.ground, l.floor, false); needFit = false; rig.userMoved = false; }
    office.setSignTurn(rig.portrait ? 1.2 : 0);
    const dMin = Number.isFinite(lastMinute) ? minute - lastMinute : 0;
    lastMinute = minute;
    if (dt > 0) {
      const inst = Math.min(120, Math.max(0, dMin / dt));
      rate += (inst - rate) * Math.min(1, dt * 3);
    }
    const live = framesLive > 1 && Math.abs(dMin) < 12;
    framesLive++;
    const tA = performance.now();
    actors.sync(c, l, minute, dt, live, rate);
    actors.setBlobs(!shadowsOn);
    prof.actors[prof.i] = performance.now() - tA;
    office.update(Math.min(dt, 0.1), now);
    rig.update(Math.min(dt, 0.1));
    lightFor(l, minute);
    if (!visible) return;
    const r = getRenderer();
    if (r.domElement.parentElement !== canvasHost) { detach?.(); detach = null; attach(); }
    // the clean scene shares this renderer: pin the look the diorama is tuned for
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    if (hover) {
      const hi = pickHit(hover.x, hover.y);
      const cur = hi && hi.kind !== 'patient' ? 'pointer' : hi ? 'pointer' : '';
      if (cur !== hoverCursor) { host.style.cursor = cur; hoverCursor = cur; }
      hover = null;
    }
    const tO = performance.now();
    drawOverlays(c, minute);
    drainEffects();
    prof.overlays[prof.i] = performance.now() - tO;
    prof.total[prof.i] = performance.now() - tStart;
    prof.i = (prof.i + 1) % PN;
    prof.n = Math.min(PN, prof.n + 1);
    r.render(scene, rig.camera);
  }

  // ---------------------------------------------------------------- events
  function events(evts: SimEvent[]): void {
    if (disposed || !layout) return;
    const l = layout;
    for (const e of evts) {
      if ('clinicId' in e && e.clinicId !== clinicId) continue;
      switch (e.type) {
        case 'arrive':
          // the door swings and chimes when the patient reaches it (actors.senseDoor)
          break;
        case 'paid':
          // coins pop when the patient actually reaches the pay desk (now, if they are already past it)
          if (!actors.deferPaid(e.patientId, e.amount)) popCash(e.amount);
          break;
        case 'review': {
          const a = actors.deferReview(e.name, e.stars);
          if (a) overlays.stars(a.x, a.headY + (a.angry ? 1.25 : 0.7), a.z, e.stars);
          else if (!hasPatientNamed(e.name)) overlays.stars(l.door.inside.x, 2.2, l.door.inside.z, e.stars);
          break;
        }
        case 'walkout': {
          const a = actors.patients.get(e.patientId);
          if (a) overlays.puff(a.x, a.headY + 0.25, a.z);
          break;
        }
        case 'cleaned': {
          const c = lastClinic;
          const o = c?.ops.find((x) => x.patientId === e.patientId) ?? null;
          const a = actors.patients.get(e.patientId);
          if (o && l.ops[o.slot]) overlays.sparkle(l.ops[o.slot].chair.x, 1.6, l.ops[o.slot].chair.z);
          else if (a) overlays.sparkle(a.x, a.headY, a.z);
          break;
        }
        default: break;
      }
    }
  }

  // payments close together pop one after another instead of on top of each other
  const cashQueue: { amount: number; stars: number }[] = [];
  let nextCashAt = 0;
  function popCash(amount: number, stars = 0): void {
    cashQueue.push({ amount, stars });
  }
  function flushCash(): void {
    const l = layout;
    if (!l || !cashQueue.length || now < nextCashAt) return;
    const c = cashQueue.shift()!;
    if (c.amount > 0) {
      overlays.cash(l.checkout.x, 2.05, l.checkout.z - 0.4, '+' + money(c.amount));
      audio.play('coins', { volume: 0.8 });
    }
    if (c.stars > 0) overlays.stars(l.checkout.x, 2.75, l.checkout.z - 0.4, c.stars);
    nextCashAt = now + 0.6;
  }
  function hasPatientNamed(name: string): boolean {
    for (const a of actors.patients.values()) if (a.patient?.name === name) return true;
    return false;
  }
  function drainEffects(): void {
    for (const fx of actors.effects) popCash(fx.paid, fx.stars);
    actors.effects.length = 0;
    flushCash();
  }

  // ---------------------------------------------------------------- api
  const api: ClinicView = {
    frame,
    events,
    focusOp(opId) {
      if (!layout) return;
      if (!opId) { rig.glideTo(rig.homeTarget.x, rig.homeTarget.z, rig.homeDist); return; }
      const o = lastClinic?.ops.find((x) => x.id === opId);
      const L = o ? layout.ops[o.slot] : undefined;
      if (!L) return;
      const off = L.row === 'back' ? 0.9 : -0.6;
      rig.glideTo(L.center.x, L.center.z + off, Math.min(rig.distance, 11));
    },
    select(opId) {
      selectedOp = opId;
      const o = opId ? lastClinic?.ops.find((x) => x.id === opId) : undefined;
      office.select(o ? o.slot : null);
    },
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      overlays.root.style.display = v ? '' : 'none';
      if (!v) { detach?.(); detach = null; } else { attach(); lastMinute = NaN; framesLive = 0; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offInput(); offSettings();
      detach?.(); detach = null;
      actors.clear();
      office.dispose();
      overlays.dispose();
      bgTex?.dispose();
      host.remove();
      const w = window as any;
      if (w.__fbClinic === debug) delete w.__fbClinic;
    },
  };

  const debug = {
    camera: rig.camera,
    scene,
    rig,
    pick(x: number, y: number) { const hh = pickHit(x, y); return hh ? { kind: hh.kind, id: hh.id, slot: hh.slot } : null; },
    /** Screen position of a world point (for tests). */
    project(x: number, y: number, z: number) {
      const v = new THREE.Vector3(x, y, z).project(rig.camera);
      return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
    },
    layout: () => layout,
    actors: () => [...actors.all()].map((a) => ({ id: a.id, role: a.role, x: +a.x.toFixed(2), z: +a.z.toFixed(2), dest: a.destKey, settle: +a.settle.toFixed(2), glb: a.glb })),
    stats: () => ({ frames: prof.n, update: pstat(prof.total), actors: pstat(prof.actors), overlays: pstat(prof.overlays), office: pstat(prof.office), people: actors.patients.size + actors.staff.size, calls: getRenderer().info.render.calls, triangles: getRenderer().info.render.triangles, geometries: getRenderer().info.memory.geometries, textures: getRenderer().info.memory.textures, modelsDone }),
  };
  (window as any).__fbClinic = debug;
  return api;
}
