// Seeded PRNG (mulberry32). Deterministic so saves, world generation and tests reproduce exactly.
export interface Rng {
  next(): number;                 // [0, 1)
  int(lo: number, hi: number): number;   // inclusive
  range(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  normal(mu?: number, sigma?: number): number;
  logNormal(mu: number, sigma: number): number;
  poisson(lambda: number): number;
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
  state(): number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  const fn = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  (fn as any).getState = () => a;
  return fn;
}

export function makeRng(seed: number): Rng {
  const base = mulberry32(seed);
  const next = () => base();
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: (mu = 0, sigma = 1) => {
      const u = Math.max(1e-12, next());
      const v = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    logNormal: (mu, sigma) => Math.exp(rng.normal(mu, sigma)),
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k++; p *= next(); } while (p > L && k < 1000);
      return k - 1;
    },
    weighted: (items, weight) => {
      const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0);
      let r = next() * total;
      for (const t of items) { r -= Math.max(0, weight(t)); if (r <= 0) return t; }
      return items[items.length - 1];
    },
    state: () => (base as any).getState(),
  };
  return rng;
}

// Stable 32-bit hash for deriving sub-seeds: hashSeed(worldSeed, 'maple', 12)
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
