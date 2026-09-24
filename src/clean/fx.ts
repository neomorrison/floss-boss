// Pooled particle effects for the clean scene: tartar flakes (instanced), sparkles and water drops
// (points), and flyers (existing meshes launched with spin and gravity). No allocations per frame.
import * as THREE from 'three';
import { getDropTexture, getStarTexture } from './materials';

const GRAVITY = -14;

const POINT_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
uniform float uMaxPx;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(uMaxPx, aSize * uScale / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FRAG = /* glsl */`
uniform sampler2D uTex;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class PointPool {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array;
  private size: Float32Array; private size0: Float32Array; private alpha: Float32Array;
  private life: Float32Array; private max: Float32Array; private grav: Float32Array; private drag: Float32Array;
  private geo: THREE.BufferGeometry;
  private attrs: THREE.BufferAttribute[];
  private next = 0;
  private alive = 0;
  readonly mat: THREE.ShaderMaterial;
  constructor(readonly n: number, tex: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.size0 = new Float32Array(n); this.alpha = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.attrs = ['position', 'aColor', 'aSize', 'aAlpha'].map((k) => this.geo.getAttribute(k) as THREE.BufferAttribute);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: { uTex: { value: tex }, uScale: { value: 400 }, uMaxPx: { value: 48 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number, grav: number, drag: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size0[i] = size; this.size[i] = size; this.alpha[i] = 1;
    this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag;
    this.alive = this.n;
  }
  update(dt: number, twinkle: number) {
    if (!this.alive) return;
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      any++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const tw = twinkle > 0 ? 0.65 + 0.35 * Math.sin(this.life[i] * 30 + i) : 1;
      this.alpha[i] = Math.min(1, k * 2.2) * tw;
      this.size[i] = this.size0[i] * (twinkle > 0 ? 0.4 + 0.9 * Math.sin(Math.PI * Math.min(1, (1 - k) * 1.4 + 0.1)) : 0.6 + 0.4 * k);
    }
    if (!any) this.alive = 0;
    for (let a = 0; a < this.attrs.length; a++) this.attrs[a].needsUpdate = true;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.size.fill(0); this.alive = 1; }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

interface Flyer { obj: THREE.Object3D; vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; life: number; max: number; s0: number; floor: number; done?: () => void }

export class Fx {
  readonly group = new THREE.Group();
  private sparkles: PointPool;
  private drops: PointPool;
  // flakes
  private flakeMesh: THREE.InstancedMesh;
  private nF: number;
  private fPos: Float32Array; private fVel: Float32Array; private fRot: Float32Array; private fSpin: Float32Array;
  private fLife: Float32Array; private fMax: Float32Array; private fScale: Float32Array;
  private fNext = 0;
  private fAlive = false;
  private flyers: Flyer[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  floorY = -1.78;

  constructor(lowQuality: boolean) {
    this.nF = lowQuality ? 90 : 180;
    this.sparkles = new PointPool(lowQuality ? 140 : 260, getStarTexture(), true);
    this.drops = new PointPool(lowQuality ? 120 : 220, getDropTexture(), false);
    this.group.add(this.sparkles.points, this.drops.points);
    const fg = new THREE.IcosahedronGeometry(0.045, 0);
    const fm = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    this.flakeMesh = new THREE.InstancedMesh(fg, fm, this.nF);
    this.flakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flakeMesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.nF; i++) { this.flakeMesh.setMatrixAt(i, zero); this.flakeMesh.setColorAt(i, this.c.set('#D8B04A')); }
    this.group.add(this.flakeMesh);
    this.fPos = new Float32Array(this.nF * 3); this.fVel = new Float32Array(this.nF * 3);
    this.fRot = new Float32Array(this.nF * 3); this.fSpin = new Float32Array(this.nF * 3);
    this.fLife = new Float32Array(this.nF); this.fMax = new Float32Array(this.nF); this.fScale = new Float32Array(this.nF);
  }

  setPointScale(px: number) { this.sparkles.mat.uniforms.uScale.value = px; this.drops.mat.uniforms.uScale.value = px; }

  /** Tartar flakes bursting off a surface point along its normal. */
  flakes(p: THREE.Vector3, n: THREE.Vector3, count: number, color: THREE.ColorRepresentation = '#D8B04A', speed = 2.2, size = 1) {
    const base = this.c.set(color);
    const br = base.r, bg = base.g, bb = base.b;
    for (let k = 0; k < count; k++) {
      const i = this.fNext;
      this.fNext = (this.fNext + 1) % this.nF;
      const sp = speed * (0.5 + Math.random());
      this.fPos[i * 3] = p.x + n.x * 0.05; this.fPos[i * 3 + 1] = p.y + n.y * 0.05; this.fPos[i * 3 + 2] = p.z + n.z * 0.05;
      this.fVel[i * 3] = (n.x + (Math.random() - 0.5) * 1.4) * sp;
      this.fVel[i * 3 + 1] = (n.y + (Math.random() - 0.2) * 1.2) * sp + 1.2;
      this.fVel[i * 3 + 2] = (n.z + (Math.random() - 0.5) * 1.4) * sp;
      this.fRot[i * 3] = Math.random() * 6; this.fRot[i * 3 + 1] = Math.random() * 6; this.fRot[i * 3 + 2] = Math.random() * 6;
      this.fSpin[i * 3] = (Math.random() - 0.5) * 20; this.fSpin[i * 3 + 1] = (Math.random() - 0.5) * 20; this.fSpin[i * 3 + 2] = (Math.random() - 0.5) * 20;
      this.fLife[i] = this.fMax[i] = 0.9 + Math.random() * 0.8;
      this.fScale[i] = size * (0.5 + Math.random() * 0.9);
      const j = 0.75 + Math.random() * 0.45;
      this.flakeMesh.setColorAt(i, this.c.setRGB(br * j, bg * j, bb * j));
    }
    if (this.flakeMesh.instanceColor) this.flakeMesh.instanceColor.needsUpdate = true;
    this.fAlive = true;
  }

  sparkle(p: THREE.Vector3, count: number, spread = 0.3, size = 0.35, color: THREE.ColorRepresentation = '#FFFFFF', up = 0.8) {
    const c = this.c.set(color);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
      this.sparkles.emit(
        p.x + Math.cos(a) * r, p.y + (Math.random() - 0.5) * spread, p.z + Math.sin(a) * r * 0.6 + 0.05,
        Math.cos(a) * up * 0.8, up * (0.4 + Math.random()), Math.sin(a) * up * 0.3,
        size * (0.6 + Math.random() * 0.8), 0.45 + Math.random() * 0.5, c.r, c.g, c.b, -0.6, 2.5,
      );
    }
  }

  /** Water drops (spray, splashes). */
  drop(p: THREE.Vector3, vx: number, vy: number, vz: number, size = 0.12, life = 0.6) {
    this.drops.emit(p.x, p.y, p.z, vx, vy, vz, size, life, 1, 1, 1, GRAVITY * 0.6, 0.6);
  }

  splash(p: THREE.Vector3, count: number, speed = 1.6) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      this.drop(p, Math.cos(a) * speed * Math.random(), 1 + Math.random() * speed, Math.sin(a) * speed * Math.random(), 0.08 + Math.random() * 0.08, 0.35 + Math.random() * 0.3);
    }
  }

  /** Launch an existing object (already in this.group's space). `done` fires when it expires. */
  fly(obj: THREE.Object3D, vx: number, vy: number, vz: number, life = 1.4, done?: () => void) {
    this.flyers.push({
      obj, vx, vy, vz, sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 18, sz: (Math.random() - 0.5) * 18,
      life, max: life, s0: obj.scale.x, floor: this.floorY, done,
    });
  }

  update(dt: number) {
    this.sparkles.update(dt, 1);
    this.drops.update(dt, 0);
    if (this.fAlive) {
      let any = false;
      for (let i = 0; i < this.nF; i++) {
        if (this.fLife[i] <= 0) continue;
        any = true;
        this.fLife[i] -= dt;
        const o = i * 3;
        this.fVel[o + 1] += GRAVITY * dt;
        this.fPos[o] += this.fVel[o] * dt; this.fPos[o + 1] += this.fVel[o + 1] * dt; this.fPos[o + 2] += this.fVel[o + 2] * dt;
        if (this.fPos[o + 1] < this.floorY && this.fVel[o + 1] < 0) {
          this.fPos[o + 1] = this.floorY; this.fVel[o + 1] *= -0.35; this.fVel[o] *= 0.5; this.fVel[o + 2] *= 0.5;
          this.fSpin[o] *= 0.5; this.fSpin[o + 1] *= 0.5; this.fSpin[o + 2] *= 0.5;
        }
        this.fRot[o] += this.fSpin[o] * dt; this.fRot[o + 1] += this.fSpin[o + 1] * dt; this.fRot[o + 2] += this.fSpin[o + 2] * dt;
        const k = this.fLife[i] / this.fMax[i];
        const sc = this.fLife[i] <= 0 ? 0 : this.fScale[i] * Math.min(1, k * 3);
        this.q.setFromEuler(this.e.set(this.fRot[o], this.fRot[o + 1], this.fRot[o + 2]));
        this.m4.compose(this.v.set(this.fPos[o], this.fPos[o + 1], this.fPos[o + 2]), this.q, this.s.set(sc, sc * 0.6, sc));
        this.flakeMesh.setMatrixAt(i, this.m4);
      }
      this.flakeMesh.instanceMatrix.needsUpdate = true;
      if (!any) this.fAlive = false;
    }
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.life -= dt;
      f.vy += GRAVITY * dt;
      const o = f.obj;
      o.position.x += f.vx * dt; o.position.y += f.vy * dt; o.position.z += f.vz * dt;
      if (o.position.y < f.floor && f.vy < 0) { o.position.y = f.floor; f.vy *= -0.3; f.vx *= 0.5; f.vz *= 0.5; f.sx *= 0.4; f.sy *= 0.4; f.sz *= 0.4; }
      o.rotation.x += f.sx * dt; o.rotation.y += f.sy * dt; o.rotation.z += f.sz * dt;
      const k = f.life / f.max;
      if (k < 0.3) o.scale.setScalar(f.s0 * Math.max(0.001, k / 0.3));
      if (f.life <= 0) { this.flyers.splice(i, 1); f.done?.(); }
    }
  }

  clear() {
    this.sparkles.clear(); this.drops.clear();
    this.fLife.fill(0); this.fAlive = true;
  }

  dispose() {
    this.sparkles.dispose(); this.drops.dispose();
    this.flakeMesh.geometry.dispose(); (this.flakeMesh.material as THREE.Material).dispose();
    this.flakeMesh.dispose();
    for (const f of this.flyers) f.done?.();
    this.flyers.length = 0;
  }
}
