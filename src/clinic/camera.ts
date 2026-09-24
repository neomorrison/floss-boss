// Diorama camera: a perspective camera looking down at about 50 degrees from the front-right (from the
// right side on portrait screens, so the long office runs down the screen).
// Drag (mouse or one finger) pans with the grabbed floor point staying under the pointer, wheel and
// pinch zoom toward the pointer, a released drag coasts to a stop, and focus glides ease in and out.
import * as THREE from 'three';
import type { Rect } from './nav';

const ELEVATION = THREE.MathUtils.degToRad(50);
/** Landscape: from the front-right. Portrait: from the right side, so the long office runs down the screen. */
const AZ_LANDSCAPE = THREE.MathUtils.degToRad(17);
const AZ_PORTRAIT = THREE.MathUtils.degToRad(84);
const FOV = 30;
const TAP_SLOP = 8;

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);
  readonly target = new THREE.Vector3();
  distance = 20;
  minDist = 6.5;
  maxDist = 30;
  homeTarget = new THREE.Vector3();
  homeDist = 20;
  private bounds: Rect = { x0: -10, z0: -6, x1: 10, z1: 6 };
  private velX = 0; private velZ = 0;
  private glideT = 1; private glideDur = 0.7;
  private gFrom = new THREE.Vector3(); private gTo = new THREE.Vector3();
  private gFromD = 20; private gToD = 20;
  private w = 1; private h = 1;
  private ray = new THREE.Raycaster();
  private v2 = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  userMoved = false;
  azimuth = AZ_LANDSCAPE;

  constructor() { this.apply(); }

  get portrait(): boolean { return this.azimuth === AZ_PORTRAIT; }

  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Frame the whole office; people stay readable (the view zooms in on narrow screens and you pan). */
  fit(ground: Rect, floor: Rect, keep: boolean): void {
    const az = this.w / Math.max(1, this.h) < 0.8 ? AZ_PORTRAIT : AZ_LANDSCAPE;
    if (az !== this.azimuth) { this.azimuth = az; keep = false; }
    // frame the building and the sidewalk in front of it (the street is only a strip at the bottom)
    const front = floor.z1 + 2.2;
    this.bounds = { x0: floor.x0, z0: floor.z0, x1: floor.x1, z1: front };
    const cx = (floor.x0 + floor.x1) / 2;
    const cz = (floor.z0 + front) / 2 + 0.35;
    const corners = this.portrait
      ? [[floor.x0, 2.7, floor.z0], [floor.x0, 2.4, floor.z1 + 0.8], [floor.x1 + 0.2, 0.6, floor.z0], [floor.x1 + 0.2, 0, floor.z1 + 0.8]]
      : [[floor.x0 - 0.3, 2.7, floor.z0 - 0.2], [floor.x1 + 0.3, 2.7, floor.z0 - 0.2], [floor.x0 - 0.9, 0, front], [floor.x1 + 0.9, 0, front]];
    const save = { t: this.target.clone(), d: this.distance };
    this.target.set(cx, 0, this.portrait ? (floor.z0 + floor.z1) / 2 + 0.5 : cz);
    const search = () => {
      let lo = 4, hi = 140;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        this.distance = mid; this.apply();
        let ok = true;
        for (const c of corners) {
          this.tmp.set(c[0], c[1], c[2]).project(this.camera);
          if (Math.abs(this.tmp.x) > 0.96 || Math.abs(this.tmp.y) > (this.portrait ? 0.94 : 0.9)) { ok = false; break; }
        }
        if (ok) hi = mid; else lo = mid;
      }
      return hi;
    };
    const fitAll = search();
    // Show the whole office when people stay readable (about 26 px per meter or more); otherwise zoom
    // to a readable distance on the lobby side and let the player pan.
    const pxPerM = (d: number) => this.h / (2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const readable = this.h / (2 * 30 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const zoomed = pxPerM(fitAll) < (this.portrait ? 20 : 26);
    this.homeDist = zoomed ? Math.max(9, readable) : fitAll;
    this.maxDist = Math.max(this.homeDist * 1.2, Math.min(fitAll * 1.05, 70));
    this.minDist = Math.min(6.5, this.homeDist);
    this.homeTarget.set(cx, 0, this.portrait ? (floor.z0 + floor.z1) / 2 + 0.5 : cz);
    if (zoomed && !this.portrait) {
      // start on the lobby side of the operatories, where patients come in
      const span = (floor.x1 - floor.x0);
      this.homeTarget.x = floor.x0 + Math.min(span * 0.36, 7.5);
    }
    if (keep) {
      this.target.copy(save.t); this.distance = Math.min(this.maxDist, Math.max(this.minDist, save.d));
    } else {
      this.target.copy(this.homeTarget); this.distance = this.homeDist;
    }
    this.clamp();
    this.apply();
  }

  apply(): void {
    const d = this.distance;
    const ce = Math.cos(ELEVATION), se = Math.sin(ELEVATION);
    this.camera.position.set(
      this.target.x + d * ce * Math.sin(this.azimuth),
      this.target.y + d * se,
      this.target.z + d * ce * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private clamp(): void {
    const b = this.bounds;
    this.target.x = Math.min(b.x1, Math.max(b.x0, this.target.x));
    this.target.z = Math.min(b.z1, Math.max(b.z0, this.target.z));
    this.distance = Math.min(this.maxDist, Math.max(this.minDist, this.distance));
  }

  /** Floor point under a canvas pixel. Returns false if the ray misses the floor plane. */
  groundAt(px: number, py: number, out: THREE.Vector3): boolean {
    this.v2.set((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1);
    this.ray.setFromCamera(this.v2, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out) !== null;
  }

  raycaster(px: number, py: number): THREE.Raycaster {
    this.v2.set((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1);
    this.ray.setFromCamera(this.v2, this.camera);
    return this.ray;
  }

  /** Pan so the floor point under (ax, ay) moves under (bx, by). */
  panPixels(ax: number, ay: number, bx: number, by: number): void {
    if (!this.groundAt(ax, ay, this.tmp) || !this.groundAt(bx, by, this.tmp2)) return;
    this.target.x += this.tmp.x - this.tmp2.x;
    this.target.z += this.tmp.z - this.tmp2.z;
    this.glideT = 1;
    this.userMoved = true;
    this.clamp(); this.apply();
  }

  /** Zoom by a factor, keeping the floor point under (px, py) fixed. */
  zoomAt(px: number, py: number, factor: number): void {
    const hasA = this.groundAt(px, py, this.tmp);
    this.distance = Math.min(this.maxDist, Math.max(this.minDist, this.distance * factor));
    this.apply();
    if (hasA && this.groundAt(px, py, this.tmp2)) {
      this.target.x += this.tmp.x - this.tmp2.x;
      this.target.z += this.tmp.z - this.tmp2.z;
    }
    this.glideT = 1;
    this.userMoved = true;
    this.clamp(); this.apply();
  }

  setVelocity(vx: number, vz: number): void { this.velX = vx; this.velZ = vz; }
  stop(): void { this.velX = 0; this.velZ = 0; this.glideT = 1; }

  glideTo(x: number, z: number, dist: number, dur = 0.75): void {
    this.gFrom.copy(this.target); this.gFromD = this.distance;
    this.gTo.set(x, 0, z); this.gToD = Math.min(this.maxDist, Math.max(this.minDist, dist));
    this.glideT = 0; this.glideDur = dur;
    this.velX = 0; this.velZ = 0;
  }

  get gliding(): boolean { return this.glideT < 1; }

  update(dt: number): void {
    if (this.glideT < 1) {
      this.glideT = Math.min(1, this.glideT + dt / this.glideDur);
      const t = this.glideT;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.target.lerpVectors(this.gFrom, this.gTo, e);
      this.distance = this.gFromD + (this.gToD - this.gFromD) * e;
      this.clamp(); this.apply();
      return;
    }
    if (this.velX !== 0 || this.velZ !== 0) {
      this.target.x += this.velX * dt; this.target.z += this.velZ * dt;
      const k = Math.exp(-5.5 * dt);
      this.velX *= k; this.velZ *= k;
      if (Math.hypot(this.velX, this.velZ) < 0.05) { this.velX = 0; this.velZ = 0; }
      this.clamp(); this.apply();
    }
  }
}

export interface TapInfo { x: number; y: number; target: EventTarget | null }

/**
 * Pointer input on the view container. One pointer pans, two pinch-zoom and pan, the wheel zooms.
 * A press that barely moves is a tap. Returns a detach function.
 */
export function attachInput(el: HTMLElement, rig: CameraRig, onTap: (t: TapInfo) => void, onHover?: (x: number, y: number) => void): () => void {
  interface Ptr { id: number; x: number; y: number; sx: number; sy: number; t0: number; target: EventTarget | null }
  const ptrs = new Map<number, Ptr>();
  let moved = false;
  let multi = false;
  let lastT = 0;
  let vx = 0, vz = 0;
  const g0 = new THREE.Vector3(), g1 = new THREE.Vector3();
  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    const p = local(e);
    ptrs.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: performance.now(), target: e.target });
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (ptrs.size === 1) { moved = false; multi = false; vx = 0; vz = 0; lastT = performance.now(); }
    else multi = true;
    rig.stop();
  };
  const move = (e: PointerEvent) => {
    const p = local(e);
    const q = ptrs.get(e.pointerId);
    if (!q) { if (e.pointerType === 'mouse' && onHover) onHover(p.x, p.y); return; }
    if (ptrs.size === 1) {
      if (!moved && Math.hypot(p.x - q.sx, p.y - q.sy) > TAP_SLOP) moved = true;
      if (moved) {
        const now = performance.now();
        const dtm = Math.max(1, now - lastT) / 1000;
        rig.groundAt(q.x, q.y, g0); rig.groundAt(p.x, p.y, g1);
        const ix = (g0.x - g1.x) / dtm, iz = (g0.z - g1.z) / dtm;
        vx = vx * 0.6 + ix * 0.4; vz = vz * 0.6 + iz * 0.4;
        lastT = now;
        rig.panPixels(q.x, q.y, p.x, p.y);
      }
      q.x = p.x; q.y = p.y;
    } else if (ptrs.size === 2) {
      moved = true;
      const [a, b] = [...ptrs.values()];
      const oldMidX = (a.x + b.x) / 2, oldMidY = (a.y + b.y) / 2;
      const oldD = Math.hypot(a.x - b.x, a.y - b.y);
      q.x = p.x; q.y = p.y;
      const newMidX = (a.x + b.x) / 2, newMidY = (a.y + b.y) / 2;
      const newD = Math.hypot(a.x - b.x, a.y - b.y);
      if (oldD > 10 && newD > 10) rig.zoomAt(newMidX, newMidY, oldD / newD);
      rig.panPixels(oldMidX, oldMidY, newMidX, newMidY);
      vx = 0; vz = 0;
    } else {
      q.x = p.x; q.y = p.y;
    }
  };
  const up = (e: PointerEvent) => {
    const q = ptrs.get(e.pointerId);
    if (!q) return;
    ptrs.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.type === 'pointerup' && !moved && !multi && ptrs.size === 0 && performance.now() - q.t0 < 700) {
      onTap({ x: q.x, y: q.y, target: q.target });
    } else if (ptrs.size === 0 && moved && !multi && performance.now() - lastT < 80) {
      const sp = Math.hypot(vx, vz);
      const cap = 28;
      const s = sp > cap ? cap / sp : 1;
      if (sp > 1.2) rig.setVelocity(vx * s, vz * s);
    }
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    rig.zoomAt(p.x, p.y, Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.0015))));
  };
  const ctx = (e: Event) => e.preventDefault();
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', ctx);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('contextmenu', ctx);
  };
}
