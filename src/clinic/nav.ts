// Walk-path finder for the clinic diorama. Pure TypeScript (no three.js, no DOM) so tests can run it.
//
// The floor is rasterised into a grid of small cells. A cell is blocked when its center lies outside
// the walkable area or closer than `radius` to any obstacle (furniture, walls, partitions). A* over the
// 8-connected grid finds a route; line-of-sight smoothing turns the staircase into a few straight legs,
// so people walk in natural diagonals across the lobby and follow the corridors between operatories.

export interface V2 { x: number; z: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
}

/** Distance from a point to a rectangle (0 inside). */
export function rectDist(r: Rect, x: number, z: number): number {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
  return Math.hypot(dx, dz);
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
}

class MinHeap {
  private idx: Int32Array;
  private key: Float32Array;
  size = 0;
  constructor(cap: number) { this.idx = new Int32Array(cap); this.key = new Float32Array(cap); }
  clear(): void { this.size = 0; }
  push(i: number, k: number): void {
    if (this.size >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2); ni.set(this.idx); this.idx = ni;
      const nk = new Float32Array(this.key.length * 2); nk.set(this.key); this.key = nk;
    }
    let n = this.size++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[n] = this.idx[p]; this.key[n] = this.key[p]; n = p;
    }
    this.idx[n] = i; this.key[n] = k;
  }
  pop(): number {
    const top = this.idx[0];
    const li = this.idx[--this.size]; const lk = this.key[this.size];
    let n = 0;
    for (;;) {
      let c = 2 * n + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lk) break;
      this.idx[n] = this.idx[c]; this.key[n] = this.key[c]; n = c;
    }
    this.idx[n] = li; this.key[n] = lk;
    return top;
  }
}

const SQ2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class NavGrid {
  readonly x0: number; readonly z0: number; readonly cell: number;
  readonly nx: number; readonly nz: number;
  readonly blocked: Uint8Array;
  private g: Float32Array; private from: Int32Array; private stamp: Uint32Array; private closed: Uint32Array;
  private gen = 0;
  private heap: MinHeap;

  /** 1 where the cell center is inside an obstacle or off the walkable area (no clearance margin). */
  readonly solid: Uint8Array;

  constructor(bounds: Rect, walkable: Rect[], obstacles: Rect[], readonly radius: number, cell = 0.125) {
    this.cell = cell;
    this.x0 = bounds.x0; this.z0 = bounds.z0;
    this.nx = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell));
    this.nz = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cell));
    const n = this.nx * this.nz;
    this.blocked = new Uint8Array(n).fill(1);
    this.solid = new Uint8Array(n).fill(1);
    for (const w of walkable) {
      const [i0, i1, j0, j1] = this.span(w, 0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.cx(i), z = this.cz(j);
        if (rectContains(w, x, z)) { this.blocked[j * this.nx + i] = 0; this.solid[j * this.nx + i] = 0; }
      }
    }
    const pad = cell * 0.75;   // keep escape legs from grazing corners
    for (const o of obstacles) {
      const [i0, i1, j0, j1] = this.span(o, radius);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = rectDist(o, this.cx(i), this.cz(j));
        if (d < radius) this.blocked[j * this.nx + i] = 1;
        if (d < pad) this.solid[j * this.nx + i] = 1;
      }
    }
    this.g = new Float32Array(n); this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n); this.closed = new Uint32Array(n);
    this.heap = new MinHeap(1024);
  }

  private span(r: Rect, pad: number): [number, number, number, number] {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((r.x0 - pad - this.x0) / c));
    const i1 = Math.min(this.nx - 1, Math.ceil((r.x1 + pad - this.x0) / c));
    const j0 = Math.max(0, Math.floor((r.z0 - pad - this.z0) / c));
    const j1 = Math.min(this.nz - 1, Math.ceil((r.z1 + pad - this.z0) / c));
    return [i0, i1, j0, j1];
  }
  cx(i: number): number { return this.x0 + (i + 0.5) * this.cell; }
  cz(j: number): number { return this.z0 + (j + 0.5) * this.cell; }
  ci(x: number): number { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cell))); }
  cj(z: number): number { return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) / this.cell))); }

  isFree(x: number, z: number): boolean { return this.blocked[this.cj(z) * this.nx + this.ci(x)] === 0; }

  /** Index of the free cell nearest to (x, z), or -1. */
  nearestFree(x: number, z: number, maxRing = 40): number {
    const i = this.ci(x), j = this.cj(z);
    if (this.blocked[j * this.nx + i] === 0) return j * this.nx + i;
    let best = -1; let bestD = Infinity;
    for (let r = 1; r <= maxRing; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
        const k = jj * this.nx + ii;
        if (this.blocked[k]) continue;
        const d = Math.hypot(this.cx(ii) - x, this.cz(jj) - z);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** True when the straight segment between two points only crosses free cells. */
  lineFree(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** Straight segment that stays out of obstacles themselves (ignores the clearance margin). */
  solidLineFree(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.4)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.solid[this.cj(az + (bz - az) * t) * this.nx + this.ci(ax + (bx - ax) * t)]) return false;
    }
    return true;
  }

  private queue: Int32Array | null = null;

  /**
   * A point inside the clearance margin (a seat front, a spot between counter and chair) walks out to
   * the nearest free cell through cells that are not inside furniture, never through a wall or partition.
   * Returns that cell and the escape points (cell centers, simplified, ending at the free cell).
   */
  private escape(x: number, z: number): { cell: number; tail: V2[] } | null {
    const nx = this.nx;
    const k0 = this.cj(z) * nx + this.ci(x);
    if (this.blocked[k0] === 0) return { cell: k0, tail: [] };
    const n = nx * this.nz;
    if (!this.queue || this.queue.length < n) this.queue = new Int32Array(n);
    const q = this.queue;
    const gen = ++this.gen;
    let head = 0, tail = 0;
    q[tail++] = k0; this.stamp[k0] = gen; this.from[k0] = -1;
    let found = -1;
    while (head < tail) {
      const k = q[head++];
      if (this.blocked[k] === 0) { found = k; break; }
      const ki = k % nx, kj = (k / nx) | 0;
      for (let d = 0; d < 8; d++) {
        const ii = ki + DX[d], jj = kj + DZ[d];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= this.nz) continue;
        const k2 = jj * nx + ii;
        if (this.stamp[k2] === gen || this.solid[k2]) continue;
        if (d >= 4 && (this.solid[kj * nx + ii] || this.solid[jj * nx + ki])) continue;
        this.stamp[k2] = gen; this.from[k2] = k; q[tail++] = k2;
      }
    }
    if (found < 0) {
      const f = this.nearestFree(x, z);
      return f < 0 ? null : { cell: f, tail: [{ x: this.cx(f % nx), z: this.cz((f / nx) | 0) }] };
    }
    const chain: V2[] = [];
    for (let k = found; k !== -1; k = this.from[k]) chain.push({ x: this.cx(k % nx), z: this.cz((k / nx) | 0) });
    chain.reverse();           // start cell ... free cell
    chain.shift();             // the exact point replaces the start cell
    if (chain.length === 0) chain.push({ x: this.cx(found % nx), z: this.cz((found / nx) | 0) });
    // string-pull from the exact point along the chain (obstacle-only line of sight)
    const out: V2[] = [];
    let cx = x, cz = z, i = 0;
    while (i < chain.length) {
      let j = chain.length - 1;
      while (j > i && !this.solidLineFree(cx, cz, chain[j].x, chain[j].z)) j--;
      out.push(chain[j]);
      cx = chain[j].x; cz = chain[j].z; i = j + 1;
    }
    return { cell: found, tail: out };
  }

  /**
   * Route from a to b. Returns the waypoint list starting at a and ending at b (both exact), or null
   * when b cannot be reached. Endpoints inside the clearance margin escape to open floor first.
   */
  route(a: V2, b: V2): V2[] | null {
    const ea = this.escape(a.x, a.z);
    const eb = this.escape(b.x, b.z);
    if (!ea || !eb) return null;
    const s = ea.cell, t = eb.cell;
    const nx = this.nx;
    if (s === t) {
      const pts: V2[] = [{ x: a.x, z: a.z }, ...ea.tail.slice(0, -1), ...eb.tail.slice(0, -1).reverse(), { x: b.x, z: b.z }];
      return dedupe(pts);
    }
    const gen = ++this.gen;
    const heap = this.heap; heap.clear();
    const tx = t % nx, tz = (t / nx) | 0;
    const h = (k: number) => {
      const dx = Math.abs((k % nx) - tx), dz = Math.abs(((k / nx) | 0) - tz);
      return (dx + dz + (SQ2 - 2) * Math.min(dx, dz));
    };
    this.stamp[s] = gen; this.g[s] = 0; this.from[s] = -1;
    heap.push(s, h(s));
    let found = false;
    while (heap.size > 0) {
      const k = heap.pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === t) { found = true; break; }
      const ki = k % nx, kj = (k / nx) | 0;
      for (let d = 0; d < 8; d++) {
        const ii = ki + DX[d], jj = kj + DZ[d];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= this.nz) continue;
        const n2 = jj * nx + ii;
        if (this.blocked[n2] || this.closed[n2] === gen) continue;
        if (d >= 4 && (this.blocked[kj * nx + ii] || this.blocked[jj * nx + ki])) continue;  // no corner cutting
        const ng = this.g[k] + (d >= 4 ? SQ2 : 1);
        if (this.stamp[n2] !== gen || ng < this.g[n2]) {
          this.stamp[n2] = gen; this.g[n2] = ng; this.from[n2] = k;
          heap.push(n2, ng + h(n2));
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = t; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    // Line-of-sight smoothing over the free-cell chain.
    const px = (k: number) => this.cx(k % nx), pz = (k: number) => this.cz((k / nx) | 0);
    const mid: V2[] = [{ x: px(cells[0]), z: pz(cells[0]) }];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.lineFree(px(cells[i]), pz(cells[i]), px(cells[j]), pz(cells[j]))) j--;
      mid.push({ x: px(cells[j]), z: pz(cells[j]) });
      i = j;
    }
    const pts: V2[] = [{ x: a.x, z: a.z }, ...ea.tail.slice(0, -1), ...mid, ...eb.tail.slice(0, -1).reverse(), { x: b.x, z: b.z }];
    // Drop snapped cell centers right next to an exact endpoint when the endpoint sees past them.
    if (pts.length > 2 && dist(pts[0], pts[1]) < 0.6 && this.lineFree(pts[0].x, pts[0].z, pts[2].x, pts[2].z)) pts.splice(1, 1);
    const L = pts.length;
    if (L > 2 && dist(pts[L - 1], pts[L - 2]) < 0.6 && this.lineFree(pts[L - 3].x, pts[L - 3].z, pts[L - 1].x, pts[L - 1].z)) pts.splice(L - 2, 1);
    return dedupe(pts);
  }
}

function dist(a: V2, b: V2): number { return Math.hypot(a.x - b.x, a.z - b.z); }

function dedupe(pts: V2[]): V2[] {
  const out: V2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(pts[i].x - p.x, pts[i].z - p.z) > 0.02) out.push(pts[i]);
  }
  if (out.length === 1) out.push(pts[pts.length - 1]);
  return out;
}

export function pathLength(p: V2[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return l;
}

/** Point at distance d along the path (clamped), written into out. Returns the segment index. */
export function pointAt(p: V2[], d: number, out: { x: number; z: number; dx: number; dz: number }): number {
  let rem = Math.max(0, d);
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1].x, az = p[i - 1].z;
    const sx = p[i].x - ax, sz = p[i].z - az;
    const L = Math.hypot(sx, sz);
    if (rem <= L || i === p.length - 1) {
      const t = L > 1e-6 ? Math.min(1, rem / L) : 1;
      out.x = ax + sx * t; out.z = az + sz * t;
      if (L > 1e-6) { out.dx = sx / L; out.dz = sz / L; }
      return i;
    }
    rem -= L;
  }
  const last = p[p.length - 1];
  out.x = last.x; out.z = last.z;
  return p.length - 1;
}
