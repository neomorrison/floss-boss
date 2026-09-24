// Orbit camera for the mouth: yaw / pitch / distance around a target, all limited so the view always
// looks into the mouth through the lips. Smoothly eases toward goals; views and tooth focus set goals.
import * as THREE from 'three';

export type ViewId = 'front' | 'left' | 'right' | 'upper' | 'lower';

export const VIEWS: Record<ViewId, { t: [number, number, number]; yaw: number; pitch: number; dist: number }> = {
  front: { t: [0, -0.1, 0.8], yaw: 0, pitch: 0.13, dist: 12.6 },
  left: { t: [-2.3, 0, 0.4], yaw: -0.24, pitch: 0.02, dist: 9.4 },
  right: { t: [2.3, 0, 0.4], yaw: 0.24, pitch: 0.02, dist: 9.4 },
  upper: { t: [0, 1.15, 0.4], yaw: 0, pitch: -0.4, dist: 10.5 },
  lower: { t: [0, -1.15, 0.4], yaw: 0, pitch: 0.42, dist: 10.5 },
};

const YAW_MAX = 0.6;
const PITCH_MAX = 0.55;

export class MouthCamera {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, -0.1, 0.8);
  yaw = 0; pitch = 0.13; dist = 12.6;
  goalTarget = new THREE.Vector3(0, -0.1, 0.8);
  goalYaw = 0; goalPitch = 0.13; goalDist = 12.6;
  minDist = 5; maxDist = 16;
  aspectMult = 1;
  private shakeT = 0; private shakeAmp = 0;
  private tmp = new THREE.Vector3();
  private off = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  }

  resize(w: number, h: number) {
    const a = w / h;
    this.camera.aspect = a;
    // keep the mouth width in view on portrait screens without a fisheye fov
    this.aspectMult = Math.min(1.6, Math.max(1, 1.4 / a));
    this.camera.updateProjectionMatrix();
  }

  view(id: ViewId, instant = false) {
    const v = VIEWS[id];
    this.goalTarget.set(v.t[0], v.t[1], v.t[2]);
    this.goalYaw = v.yaw; this.goalPitch = v.pitch; this.goalDist = v.dist;
    if (instant) this.snap();
  }

  /** Look at a world point (a tooth), from roughly its outward direction. */
  focus(p: THREE.Vector3, nx: number, nz: number, up: number) {
    this.goalTarget.copy(p);
    this.goalYaw = THREE.MathUtils.clamp(Math.atan2(nx, nz) * 0.45, -0.42, 0.42);
    this.goalPitch = up;
    this.goalDist = 6.2;
    this.clampGoals();
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

  pan(dx: number, dy: number) {
    const s = this.dist * this.aspectMult * 0.0011;
    this.goalTarget.x -= dx * s;
    this.goalTarget.y += dy * s;
    this.clampGoals();
  }

  clampGoals() {
    this.goalYaw = THREE.MathUtils.clamp(this.goalYaw, -YAW_MAX, YAW_MAX);
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch, -PITCH_MAX, PITCH_MAX);
    this.goalDist = THREE.MathUtils.clamp(this.goalDist, this.minDist, this.maxDist);
    this.goalTarget.x = THREE.MathUtils.clamp(this.goalTarget.x, -3.6, 3.6);
    this.goalTarget.y = THREE.MathUtils.clamp(this.goalTarget.y, -1.8, 1.8);
    this.goalTarget.z = THREE.MathUtils.clamp(this.goalTarget.z, -1.5, 2.4);
  }

  snap() {
    this.target.copy(this.goalTarget);
    this.yaw = this.goalYaw; this.pitch = this.goalPitch; this.dist = this.goalDist;
  }

  shake(amp: number, time = 0.25) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  update(dt: number, reducedMotion: boolean) {
    const k = 1 - Math.exp(-dt * 7);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.dist += (this.goalDist - this.dist) * k;
    const d = this.dist * this.aspectMult;
    this.off.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(d);
    this.camera.position.copy(this.target).add(this.off);
    this.tmp.copy(this.target);
    if (this.shakeT > 0 && !reducedMotion) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 4;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.camera.lookAt(this.tmp);
  }
}
