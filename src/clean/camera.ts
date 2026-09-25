// Orbit camera for the mouth: yaw / pitch / distance around a target, all limited so the view always
// looks into the mouth through the lips. Smoothly eases toward goals; views and tooth focus set goals.
// The camera never enters the lip plane (z of the lips ~3.2): it is pushed back along its view line.
import * as THREE from 'three';

export type ViewId = 'front' | 'left' | 'right' | 'upper' | 'lower';

/**
 * The mini-map focus angle for a tooth (arch position 0..13, outward normal nx/nz), tuned with the GPU
 * reachability audit (out/cleanfu/focusexp.mjs): the back molars are seen from a little to their own side and
 * steeply from below (upper) or above (lower), which shows 250+ of their ~270 face cells instead of ~65 from
 * the old side view that put the cheek in the way.
 */
export function focusAngles(pos: number, upper: boolean, nx: number, nz: number): { yaw: number; pitch: number; dist: number } {
  const up = upper ? -0.22 : 0.24;
  const side = Math.sign(nx) || 1;
  if (pos === 0 || pos === 13) return { yaw: side * 0.15, pitch: up * 1.5, dist: 8.6 };
  if (pos === 1 || pos === 12) return { yaw: side * 0.3, pitch: up * 1.5, dist: 8.6 };
  return { yaw: THREE.MathUtils.clamp(Math.atan2(nx, nz) * 0.6, -0.45, 0.45), pitch: up, dist: 6.4 };
}

export const VIEWS: Record<ViewId, { t: [number, number, number]; yaw: number; pitch: number; dist: number }> = {
  front: { t: [0, -0.1, 0.8], yaw: 0, pitch: 0.13, dist: 12.6 },
  left: { t: [-2.3, 0, 0.4], yaw: -0.24, pitch: 0.02, dist: 9.4 },
  right: { t: [2.3, 0, 0.4], yaw: 0.24, pitch: 0.02, dist: 9.4 },
  upper: { t: [0, 1.15, 0.4], yaw: 0, pitch: -0.4, dist: 10.5 },
  lower: { t: [0, -1.15, 0.4], yaw: 0, pitch: 0.42, dist: 10.5 },
};

const YAW_MAX = 0.6;
const PITCH_MAX = 0.55;
/** The camera stays this far in front of the lips (mouth z). */
export const LIP_Z = 3.95;

export class MouthCamera {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, -0.1, 0.8);
  yaw = 0; pitch = 0.13; dist = 12.6;
  goalTarget = new THREE.Vector3(0, -0.1, 0.8);
  goalYaw = 0; goalPitch = 0.13; goalDist = 12.6;
  minDist = 5; maxDist = 16;
  aspectMult = 1;
  private shakeT = 0; private shakeAmp = 0;
  private joltT = 0;
  private tmp = new THREE.Vector3();
  private off = new THREE.Vector3();
  private w = 1; private h = 1; private sx = 0; private sy = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  }

  resize(w: number, h: number) {
    this.w = w; this.h = h;
    const a = w / h;
    this.camera.aspect = a;
    // keep the mouth width in view on portrait screens without a fisheye fov
    this.aspectMult = Math.min(1.6, Math.max(1, 1.4 / a));
    this.applyShift();
  }

  /** Offset the rendered window by (x, y) CSS pixels: negative x moves the picture right, negative y moves it down. */
  setShift(x: number, y: number) {
    if (Math.abs(x - this.sx) < 0.5 && Math.abs(y - this.sy) < 0.5) return;
    this.sx = x; this.sy = y;
    this.applyShift();
  }

  private applyShift() {
    if (this.sx !== 0 || this.sy !== 0) this.camera.setViewOffset(this.w, this.h, this.sx, this.sy, this.w, this.h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  view(id: ViewId, instant = false) {
    const v = VIEWS[id];
    this.goalTarget.set(v.t[0], v.t[1], v.t[2]);
    this.goalYaw = v.yaw; this.goalPitch = v.pitch; this.goalDist = v.dist;
    if (instant) this.snap();
  }

  /**
   * Look at a world point (a tooth) from a chosen angle (see focusAngles). Goals are clamped like any orbit.
   */
  focus(p: THREE.Vector3, yaw: number, pitch: number, dist: number) {
    this.goalTarget.copy(p);
    this.goalYaw = yaw;
    this.goalPitch = pitch;
    this.goalDist = dist;
    this.clampGoals(true);
  }

  orbit(dx: number, dy: number) {
    this.goalYaw -= dx * 0.0055;
    this.goalPitch += dy * 0.0045;
    this.clampGoals();
  }

  zoom(factor: number) {
    this.goalDist *= factor;
    this.clampGoals();
  }

  clampGoals(focus = false) {
    this.goalYaw = THREE.MathUtils.clamp(this.goalYaw, -YAW_MAX, YAW_MAX);
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch, -PITCH_MAX, PITCH_MAX);
    this.goalDist = THREE.MathUtils.clamp(this.goalDist, this.minDist, this.maxDist);
    const xr = focus ? 4.6 : 3.6;
    this.goalTarget.x = THREE.MathUtils.clamp(this.goalTarget.x, -xr, xr);
    this.goalTarget.y = THREE.MathUtils.clamp(this.goalTarget.y, -1.8, 1.8);
    this.goalTarget.z = THREE.MathUtils.clamp(this.goalTarget.z, -1.5, 2.4);
  }

  snap() {
    this.target.copy(this.goalTarget);
    this.yaw = this.goalYaw; this.pitch = this.goalPitch; this.dist = this.goalDist;
  }

  /** Where the camera will sit once it reaches its goals (for occlusion checks before moving). */
  goalPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.place(out, this.goalTarget, this.goalYaw, this.goalPitch, this.goalDist);
  }

  private place(out: THREE.Vector3, target: THREE.Vector3, yaw: number, pitch: number, dist: number): THREE.Vector3 {
    const d = dist * this.aspectMult;
    this.off.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(d);
    out.copy(target).add(this.off);
    // never inside the lip plane: slide back along the view line
    if (out.z < LIP_Z && this.off.z > 1e-3) {
      const k = (LIP_Z - target.z) / this.off.z;
      out.copy(target).addScaledVector(this.off, k);
    }
    return out;
  }

  shake(amp: number, time = 0.25) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  /** A quick downward nudge (floss snap-through, hiccup jolt). */
  jolt(time = 0.18) { this.joltT = Math.max(this.joltT, time); }

  update(dt: number, reducedMotion: boolean) {
    const k = 1 - Math.exp(-dt * 7);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.dist += (this.goalDist - this.dist) * k;
    this.place(this.camera.position, this.target, this.yaw, this.pitch, this.dist);
    this.tmp.copy(this.target);
    if (!reducedMotion) {
      if (this.shakeT > 0) {
        this.shakeT -= dt;
        const a = this.shakeAmp * Math.max(0, this.shakeT) * 4;
        this.camera.position.x += (Math.random() - 0.5) * a;
        this.camera.position.y += (Math.random() - 0.5) * a;
        if (this.shakeT <= 0) this.shakeAmp = 0;
      }
      if (this.joltT > 0) {
        this.joltT -= dt;
        const j = Math.sin(Math.max(0, this.joltT) * 17) * this.joltT * 0.9;
        this.camera.position.y -= j; this.tmp.y -= j * 0.6;
      }
    } else { this.shakeT = 0; this.joltT = 0; }
    this.camera.lookAt(this.tmp);
  }
}
