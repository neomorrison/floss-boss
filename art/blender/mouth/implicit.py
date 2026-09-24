# Implicit-surface mesher for the soft, rounded mouth shapes (teeth, tongue, tartar, candy).
#
# A shape is a vectorized function f(P) -> values, P an (N, 3) numpy array in three.js space, f < 0 inside.
# mesh_star() shoots rays from a center through the vertices of a cube-sphere (quad topology, closed
# shell, no pole pinching), finds the first surface crossing, then relaxes the vertices tangentially and
# re-projects so the triangles come out even. The shape must be (roughly) star-shaped from the center.
import math
import numpy as np


# ------------------------------------------------------------------ smooth operators

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ellipsoid(P, c, r):
    """Approximate distance to an axis-aligned ellipsoid (negative inside)."""
    q = (P - np.asarray(c)) / np.asarray(r)
    k = np.linalg.norm(q, axis=1)
    return (k - 1.0) * float(np.min(r))


def capsule(P, a, b, r):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    pa = P - a
    ba = b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
    return np.linalg.norm(pa - np.outer(h, ba), axis=1) - r


# ------------------------------------------------------------------ value noise (deterministic)

def _hash3(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF) / 65535.0


def vnoise(P, freq=1.0, seed=0):
    """Smooth value noise in [-1, 1] at points P (N, 3)."""
    Q = P * freq
    i = np.floor(Q).astype(np.int64)
    f = Q - i
    u = f * f * (3 - 2 * f)
    out = np.zeros(len(P))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                h = _hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out += w * h
    return out * 2 - 1


def fbm(P, freq=1.0, octaves=4, seed=0, gain=0.5):
    tot = np.zeros(len(P))
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        tot += amp * vnoise(P, freq * (2.03 ** o), seed + o * 17)
        norm += amp
        amp *= gain
    return tot / norm


# ------------------------------------------------------------------ cube sphere

def cube_sphere(n):
    """Unit-sphere quad mesh from a cube with n x n quads per face (equal-angle mapping).
    Returns (dirs (V, 3), quads [(a, b, c, d)]) with outward winding."""
    keyed = {}
    verts = []
    quads = []

    def vid(p):
        k = (round(p[0], 9), round(p[1], 9), round(p[2], 9))
        if k not in keyed:
            keyed[k] = len(verts)
            verts.append(p)
        return keyed[k]

    faces = [  # (normal axis, u axis, v axis): u x v = normal
        ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
        ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
        ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
        ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
        ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
        ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    ]
    for nrm, ua, va in faces:
        nrm, ua, va = np.array(nrm, float), np.array(ua, float), np.array(va, float)
        grid = [[0] * (n + 1) for _ in range(n + 1)]
        for i in range(n + 1):
            for j in range(n + 1):
                a = math.tan((-1 + 2 * i / n) * math.pi / 4)
                b = math.tan((-1 + 2 * j / n) * math.pi / 4)
                p = nrm + ua * a + va * b
                p = p / np.linalg.norm(p)
                grid[i][j] = vid(tuple(float(c) for c in p))
        for i in range(n):
            for j in range(n):
                quads.append((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    return np.array(verts), quads


def _neighbors(nv, quads):
    nb = [set() for _ in range(nv)]
    for q in quads:
        for k in range(4):
            a, b = q[k], q[(k + 1) % 4]
            nb[a].add(b)
            nb[b].add(a)
    return [list(s) for s in nb]


def _raycast(f, C, D, tmax, steps=64, iters=34):
    """First crossing of f from inside (at C) to outside along each ray C + t D (D unit)."""
    V = len(D)
    ts = np.linspace(0, tmax, steps + 1)[1:]
    lo = np.zeros(V)
    hi = np.full(V, tmax)
    found = np.zeros(V, dtype=bool)
    prev = np.zeros(V)
    for t in ts:
        vals = f(C + D * t)
        hit = (vals > 0) & ~found
        lo[hit] = prev[hit]
        hi[hit] = t
        found |= hit
        prev = np.full(V, t)
        if found.all():
            break
    for _ in range(iters):
        mid = (lo + hi) / 2
        out = f(C + D * mid[:, None]) > 0
        hi = np.where(out, mid, hi)
        lo = np.where(out, lo, mid)
    return (lo + hi) / 2


def mesh_star(f, center, radii, n=12, relax=6, lam=0.5, tmax=None, keep_x0=True):
    """Mesh the zero set of f by casting rays from `center`. radii shapes the ray distribution
    (roughly the shape's half extents). Returns (verts (V, 3), quads)."""
    dirs, quads = cube_sphere(n)
    C = np.asarray(center, dtype=float)
    Rr = np.asarray(radii, dtype=float)
    tmax = tmax or float(np.max(Rr)) * 3.0
    D = dirs * Rr
    D /= np.linalg.norm(D, axis=1)[:, None]
    x0 = np.abs(dirs[:, 0]) < 1e-9
    t = _raycast(f, C, D, tmax)
    P = C + D * t[:, None]
    nb = _neighbors(len(P), quads)
    for _ in range(relax):
        cen = np.array([P[l].mean(axis=0) for l in nb])
        Q = P + (cen - P) * lam
        if keep_x0:
            Q[x0, 0] = 0.0
        D2 = Q - C
        D2 /= np.linalg.norm(D2, axis=1)[:, None]
        t = _raycast(f, C, D2, tmax)
        P = C + D2 * t[:, None]
    if keep_x0:
        P[x0, 0] = 0.0
    return P, quads


def grid_normals(P, quads):
    """Area-weighted vertex normals for a quad mesh (for displacement along the normal)."""
    N = np.zeros_like(P)
    for q in quads:
        a, b, c, d = (P[i] for i in q)
        n = np.cross(c - a, d - b)
        for i in q:
            N[i] += n
    N /= np.maximum(np.linalg.norm(N, axis=1)[:, None], 1e-12)
    return N
