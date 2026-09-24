# Soft mouth parts: tongue, mouth_frame (face surround), tartar lumps and food debris.
#
# Contract (docs/ARCHITECTURE.md, Mouth models):
#   tongue       absolute mouth coords, resting inside the lower arch (top near y = -1.7, center z = -0.3). Tongue.
#   mouth_frame  absolute coords. Lips and cheeks around an opening about x in [-5.4, 5.4], y in [-3.4, 3.4],
#                lips around z = 3.2; dark throat backdrop around z = -3.5. Skin (tinted per patient), Lips, Throat.
#   tartar_a|b|c crusty lumps about 0.34 x 0.26 x 0.18, origin at the base center, +Y out of the tooth. Tartar.
#   debris_*     0.15 to 0.4 across, origin at the center, materials named after the item.
import math
import numpy as np
import lib
import implicit as im

S = im.sstep


# ------------------------------------------------------------------ tongue

def tongue_fn(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    cz = -0.3
    dz = z - cz
    rz = np.where(dz > 0, 2.02, 2.7)
    # narrower toward the tip, a soft median groove along the top
    rx = 2.34 * (1.0 - 0.2 * S(0.2, 2.0, dz))
    groove = 0.075 * np.exp(-(x / 0.32) ** 2) * S(-2.2, -0.8, dz) * (1 - S(1.3, 1.95, dz))
    top = -1.7 - groove
    cy = -2.42
    ry_up = top - cy
    ry = np.where(y > cy, ry_up, 0.62)
    q = (np.abs(x) / rx) ** 2.4 + (np.abs(dz) / rz) ** 2.2
    qq = (q + (np.abs(y - cy) / ry) ** 2.0) ** 0.5
    f = (qq - 1.0) * 0.7
    # rests on the floor: flatten the underside
    return im.smax(f, -3.02 - y, 0.18)


def build_tongue():
    P, quads = im.mesh_star(tongue_fn, (0.0, -2.4, -0.35), (2.3, 0.7, 2.3), n=16, relax=6)
    part = lib.Part('tongue')
    part.add_mesh([tuple(p) for p in P], quads, lib.M('Tongue'))
    # vertex colors: a rosy tip, deeper toward the throat and in the middle groove, soft papilla speckles
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    back = S(1.2, -2.6, z)
    groove = np.exp(-(x / 0.35) ** 2) * S(-2.2, -0.6, z) * S(-2.2, -1.75, y)
    speck = S(0.35, 0.75, im.vnoise(P, freq=9.0, seed=31))
    under = S(-2.45, -2.9, y)
    cols = []
    for k in range(len(P)):
        m = 0.94 + 0.06 * speck[k]
        c = [m, m, m]
        for i, v in enumerate((0.8, 0.62, 0.7)):
            c[i] *= 1 + (v - 1) * (0.85 * back[k] + 0.5 * groove[k] + 0.5 * under[k])
        cols.append(tuple(max(0.0, min(1.0, v)) for v in c))
    return part.finish(all_smooth=True, color_fn=lib.color_lookup([tuple(p) for p in P], cols))


# ------------------------------------------------------------------ mouth frame

A_OPEN, B_OPEN = 5.4, 3.4
A_CAV, B_CAV, P_CAV = 6.6, 4.6, 4.5


def superellipse(t, a, b, p_top, p_bot):
    """Point on a superellipse at POLAR angle t (so every ring of the frame lines up radially), and its
    outward normal. p_top / p_bot: exponents for the upper and lower halves."""
    c, s = math.cos(t), math.sin(t)
    p = p_top if s >= 0 else p_bot
    r = ((abs(c) / a) ** p + (abs(s) / b) ** p) ** (-1.0 / p)
    x, y = r * c, r * s
    nx = (abs(x) / a) ** (p - 1) / a * math.copysign(1, x) if abs(x) > 1e-9 else 0.0
    ny = (abs(y) / b) ** (p - 1) / b * math.copysign(1, y) if abs(y) > 1e-9 else 0.0
    l = math.hypot(nx, ny) or 1.0
    return x, y, nx / l, ny / l


def face_z(x, y, a):
    """Skin height field: a rounded face that falls away from the lips, with cheeks, nose and chin."""
    z = 3.25 - 0.03 * a * a - 0.0035 * a ** 3
    z -= 3.4 * S(6.6, 8.6, a) ** 1.4                          # wrap round the side of the head
    # cheeks: two soft round apples beside the mouth corners
    for sx in (-1, 1):
        z += 1.05 * math.exp(-(((x - sx * 7.3) / 2.3) ** 2 + ((y - 0.9) / 2.5) ** 2))
    # nose: a soft rise under the button nose (the button itself is a separate ball, see build_frame)
    z += 0.9 * math.exp(-((x / 1.5) ** 2 + ((y - 6.9) / 1.4) ** 2))
    for sx in (-1, 1):
        z += 0.3 * math.exp(-(((x - sx * 1.05) / 0.6) ** 2 + ((y - 6.5) / 0.55) ** 2))   # nose wings
    # philtrum: two soft ridges and a groove above the upper lip
    fy = S(4.9, 5.3, y) * (1 - S(5.9, 6.3, y))
    z += fy * (0.07 * (math.exp(-((x - 0.42) / 0.16) ** 2) + math.exp(-((x + 0.42) / 0.16) ** 2)) - 0.05 * math.exp(-(x / 0.2) ** 2))
    # chin: a round bump, and the soft crease under the lower lip
    z += 0.75 * math.exp(-((x / 2.1) ** 2 + ((y + 6.6) / 1.3) ** 2))
    z -= 0.14 * math.exp(-((x / 1.8) ** 2 + ((y + 5.35) / 0.35) ** 2))
    # smile dimples just outside the mouth corners
    for sx in (-1, 1):
        z -= 0.12 * math.exp(-(((x - sx * 6.7) / 0.7) ** 2 + ((y - 0.1) / 0.8) ** 2))
    return z


def lip_fullness(t):
    s = math.sin(t)
    if s >= 0:
        return 0.42 + 0.58 * abs(s) ** 1.4
    return 0.42 + 0.7 * abs(s) ** 1.4


def build_frame():
    NT = 128
    # columns: (kind, param) -> position builder
    # (scale of the cavity section, z, superellipse exponent): round at the throat, boxy by the cheeks
    throat = [(0.12, -3.76, 2.0), (0.3, -3.71, 2.0), (0.5, -3.62, 2.0), (0.68, -3.46, 2.0), (0.83, -3.18, 2.1),
              (0.95, -2.7, 2.6), (1.0, -1.8, 3.6), (1.0, -0.4, P_CAV), (0.99, 1.2, P_CAV), (0.93, 2.3, P_CAV)]
    lip = [  # (normal offset in lip units, z offset, lip-scaled?)
        ('in', 0.14, 2.8),
        ('in', 0.0, 3.2),
        ('lip', 0.28, 0.5),
        ('lip', 0.72, 0.58),
        ('lip', 1.12, 0.36),
        ('lip', 1.34, 0.06),
    ]
    skin = [0.28, 0.65, 1.05, 1.5, 2.0, 2.5, 3.0, 3.6, 4.3, 5.1, 6.0, 6.9, 7.7, 8.4, 9.0]
    rows = []
    for i in range(NT):
        t = 2 * math.pi * i / NT
        bx, by, nx, ny = superellipse(t, A_OPEN, B_OPEN, 3.0, 2.2)
        cx, cy, _, _ = superellipse(t, A_CAV, B_CAV, P_CAV, P_CAV)
        L = lip_fullness(t)
        # cupid's bow: the upper lip border peaks either side of the middle
        bow = 0.0
        if by > 0:
            bow = 0.16 * (math.exp(-((bx - 0.75) / 0.45) ** 2) + math.exp(-((bx + 0.75) / 0.45) ** 2)) - 0.08 * math.exp(-(bx / 0.3) ** 2)
        ring = []
        for (k, z, pe) in throat:
            tx, ty, _, _ = superellipse(t, A_CAV, B_CAV, pe, pe)
            ring.append((tx * k, 0.25 * (1 - k) + ty * k, z))
        for (kind, off, zo) in lip:
            if kind == 'in':
                a = off
                ring.append((bx + nx * a + (cx - bx) * 0.18 * (off > 0), by + ny * a + (cy - by) * 0.18 * (off > 0), zo))
            else:
                a = off * L + (bow if off > 1.0 else bow * off)
                ring.append((bx + nx * a, by + ny * a, 3.2 + zo * L))
        a0 = 1.34 * L + bow
        for s_ in skin:
            a = a0 + s_
            x, y = bx + nx * a, by + ny * a
            ring.append((x, y, face_z(x, y, s_)))
        rows.append(ring)
    C = len(rows[0])
    verts = [(0.0, 0.25, -3.78)] + [p for r in rows for p in r]
    vid = lambda i, j: 1 + (i % NT) * C + j
    m_throat, m_lips, m_skin = lib.M('Throat'), lib.M('Lips'), lib.M('Skin')
    n_throat = len(throat)
    n_lip = n_throat + len(lip) - 1
    part = lib.Part('mouth_frame')
    faces = {m_throat: [], m_lips: [], m_skin: []}
    for i in range(NT):
        faces[m_throat].append([0, vid(i, 0), vid(i + 1, 0)])
        for j in range(C - 1):
            m = m_throat if j < n_throat else (m_lips if j < n_lip else m_skin)
            faces[m].append([vid(i, j), vid(i, j + 1), vid(i + 1, j + 1), vid(i + 1, j)])
    # all faces share one vertex list so the shading stays continuous across material borders
    import bmesh
    bm = part.bm
    bv = [bm.verts.new(v) for v in verts]
    for m, fl in faces.items():
        idx = part._mi(m)
        for f in fl:
            face = bm.faces.new([bv[k] for k in f])
            face.material_index = idx
            face.smooth = True
    # vertex colors: the throat darkens toward the back, everything else is left to its material
    ncol = []
    for i in range(NT):
        for j in range(C):
            if j < n_throat:
                zz = rows[i][j][2]
                k = 0.42 + 0.58 * S(-3.8, 2.4, zz) ** 1.3
                ncol.append((k, k * 0.96, k * 0.97))
            else:
                ncol.append((1.0, 1.0, 1.0))
    cols = [(0.42, 0.4, 0.41)] + ncol
    # a round button nose sitting on the face
    nz = face_z(0.0, 7.05, 2.4)
    part.sphere(1.0, (0.0, 7.0, nz + 0.05), m_skin, seg=24, rings=16, scale=(1.3, 1.05, 0.85))
    return part.finish(recalc=False, color_fn=lib.color_lookup(verts, cols), tri='FIXED')


# ------------------------------------------------------------------ tartar

TARTAR_SEEDS = {'tartar_a': 3, 'tartar_b': 11, 'tartar_c': 23}


def tartar_fn(seed):
    """Returns (f, relief): the implicit crust and the relief term used for its colors
    (positive on bumps, negative in cracks)."""
    rng = np.random.default_rng(seed)
    lumps = []
    for k in range(6):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.03, 0.095) if k else 0.0
        lumps.append(((math.cos(a) * r * 1.25, 0.035 + rng.uniform(0, 0.035), math.sin(a) * r * 0.8),
                      (rng.uniform(0.07, 0.105), rng.uniform(0.065, 0.1), rng.uniform(0.055, 0.085))))
    off = np.array([seed * 1.7, seed * 0.37, seed * 2.9])

    def relief(P):
        n = im.fbm(P + off, freq=20.0, octaves=3, seed=seed)
        cracks = np.abs(im.vnoise(P + off * 0.5, freq=13.0, seed=seed + 5))      # 0 on the crack lines
        return 0.022 * n - 0.018 * (1.0 - np.clip(cracks / 0.18, 0, 1)) ** 2

    def f(P):
        d = None
        for c, r in lumps:
            e = im.ellipsoid(P, c, r)
            d = e if d is None else im.smin(d, e, 0.045)
        body = im.ellipsoid(P, (0, 0.02, 0), (0.165, 0.1, 0.125))
        d = im.smin(d, body, 0.04)
        d = d - relief(P)
        return im.smax(d, -0.035 - P[:, 1], 0.02)
    return f, relief


TARTAR_TOP = (1.0, 0.97, 0.9)          # sunny crust tops
TARTAR_CRACK = (0.46, 0.3, 0.16)       # dark brown cracks
TARTAR_PATCH = (0.78, 0.6, 0.38)       # older, darker crust patches


def build_tartar(key):
    seed = TARTAR_SEEDS[key]
    f, relief = tartar_fn(seed)
    P, quads = im.mesh_star(f, (0.0, 0.05, 0.0), (0.17, 0.1, 0.13), n=11, relax=2)
    rel = relief(P)
    off = np.array([seed * 0.53, seed * 1.1, seed * 0.21])
    patch = im.fbm(P + off, freq=9.0, octaves=2, seed=seed + 9)
    # normalize to the contract footprint (0.34 x 0.26, 0.18 tall above the base)
    mn, mx = P.min(axis=0), P.max(axis=0)
    P[:, 0] *= 0.34 / (mx[0] - mn[0])
    P[:, 2] *= 0.26 / (mx[2] - mn[2])
    P[:, 1] = P[:, 1] * 0.18 / mx[1]
    part = lib.Part(key)
    part.add_mesh([tuple(p) for p in P], quads, lib.material('Tartar', '#E4BE52'))
    cols = []
    for k in range(len(P)):
        hgt = max(0.0, min(1.0, P[k, 1] / 0.18))
        bump = max(0.0, min(1.0, 0.45 + rel[k] / 0.022))
        c = tuple(TARTAR_CRACK[i] + (TARTAR_TOP[i] - TARTAR_CRACK[i]) * bump ** 0.8 for i in range(3))
        pk = im.sstep(0.05, 0.35, patch[k]) * 0.8
        c = tuple(c[i] + (TARTAR_PATCH[i] * c[i] - c[i]) * pk for i in range(3))
        shade = 0.72 + 0.28 * hgt                      # darker where it meets the tooth
        cols.append(tuple(max(0.0, min(1.0, v * shade)) for v in c))
    return part.finish(all_smooth=True, color_fn=lib.color_lookup([tuple(p) for p in P], cols))


# ------------------------------------------------------------------ debris

def build_popcorn():
    rng = np.random.default_rng(7)
    blobs = [((0, 0, 0), (0.11, 0.1, 0.1))]
    for k in range(8):
        a = 2 * math.pi * k / 8 + rng.uniform(-0.3, 0.3)
        el = rng.uniform(-0.7, 0.9)
        r = rng.uniform(0.09, 0.12)
        blobs.append(((math.cos(a) * math.cos(el) * r, math.sin(el) * r * 0.9, math.sin(a) * math.cos(el) * r),
                      tuple(rng.uniform(0.055, 0.08, 3))))

    def f(P):
        d = None
        for c, r in blobs:
            e = im.ellipsoid(P, c, r)
            d = e if d is None else im.smin(d, e, 0.022)
        return d - 0.01 * im.fbm(P, freq=34.0, octaves=2, seed=4)
    P, quads = im.mesh_star(f, (0, 0, 0), (0.17, 0.15, 0.17), n=10, relax=3)
    part = lib.Part('debris_popcorn')
    part.add_mesh([tuple(p) for p in P], quads, lib.M('Popcorn'))
    # the hull: a curled golden shell hugging one side
    hull = []
    NU, NV = 10, 6
    for i in range(NU + 1):
        for j in range(NV + 1):
            a = -1.1 + 2.2 * i / NU
            b = 0.15 + 1.0 * j / NV
            r = 0.135 + 0.01 * math.sin(i * 1.7 + j)
            hull.append((math.sin(b) * math.cos(a) * r, math.cos(b) * r * 0.9 - 0.02, math.sin(b) * math.sin(a) * r * 1.05 + 0.02))
    q = []
    for i in range(NU):
        for j in range(NV):
            q.append([i * (NV + 1) + j, (i + 1) * (NV + 1) + j, (i + 1) * (NV + 1) + j + 1, i * (NV + 1) + j + 1])
    hull_np = np.array(hull)
    hull_out = hull_np * 1.0
    # give the hull thickness: outer and inner sheets joined at the rim
    nrm = hull_np / np.linalg.norm(hull_np, axis=1)[:, None]
    outer = hull_out + nrm * 0.012
    inner = hull_out - nrm * 0.004
    V = [tuple(p) for p in outer] + [tuple(p) for p in inner]
    off = len(outer)
    F = [f_[::-1] for f_ in q] + [[k + off for k in f_] for f_ in q]
    W = NV + 1
    rim = [(i, 0) for i in range(NU)] + [(NU, j) for j in range(NV)] + [(i, NV) for i in range(NU, 0, -1)] + [(0, j) for j in range(NV, 0, -1)]
    for k in range(len(rim)):
        a = rim[k][0] * W + rim[k][1]
        b = rim[(k + 1) % len(rim)][0] * W + rim[(k + 1) % len(rim)][1]
        F.append([a, b, b + off, a + off])
    part.add_mesh(V, F, lib.M('PopcornHull'), matrix=lib._mat4((0.02, 0.0, 0.0), (15, 30, -20)))
    return part.finish(recalc=True, smooth_angle=60)


def build_spinach():
    """A crinkled leaf folded along its midrib, with a pale vein."""
    NU, NV = 14, 7          # along the leaf, across one half
    L, Wd = 0.37, 0.19

    def pt(u, v, side):
        # u 0..1 base to tip, v 0..1 midrib to edge, side +-1
        width = Wd * math.sin(math.pi * min(1.0, u * 1.05)) ** 0.8 * (1 - 0.25 * u)
        x = -L / 2 + L * u
        zz = side * width * v
        fold = 0.09 * (v ** 1.4) * width / Wd          # halves fold up along the midrib
        wave = (0.018 * math.sin(u * 17 + side * 1.3) * v ** 1.5 + 0.01 * math.sin(v * 9 + u * 7)) * width / Wd
        curl = -0.08 * (u - 0.5) ** 2
        return (x, fold + wave + curl, zz)
    V, F = [], []
    grid = {}
    for side in (-1, 1):
        for i in range(NU + 1):
            for j in range(NV + 1):
                if j == 0 and side == 1:
                    grid[(side, i, j)] = grid[(-1, i, 0)]
                    continue
                grid[(side, i, j)] = len(V)
                V.append(pt(i / NU, j / NV, side))
    top = []
    for side in (-1, 1):
        for i in range(NU):
            for j in range(NV):
                q = [grid[(side, i, j)], grid[(side, i + 1, j)], grid[(side, i + 1, j + 1)], grid[(side, i, j + 1)]]
                q = [k for n_, k in enumerate(q) if k not in q[:n_]]
                if len(q) < 3:
                    continue
                top.append(q if side < 0 else q[::-1])
    # thickness: an offset copy below
    Vn = np.array(V)
    thick = 0.012
    V2 = [(p[0], p[1] - thick, p[2]) for p in Vn]
    off = len(V)
    F = top + [[k + off for k in f_][::-1] for f_ in top]
    # stitch the outline
    edge_ids = [grid[(-1, i, NV)] for i in range(NU + 1)] + [grid[(1, i, NV)] for i in range(NU, -1, -1)]
    edge_ids = [e for n_, e in enumerate(edge_ids) if n_ == 0 or e != edge_ids[n_ - 1]]
    for k in range(len(edge_ids)):
        a, b = edge_ids[k], edge_ids[(k + 1) % len(edge_ids)]
        if a == b:
            continue
        F.append([a, b, b + off, a + off])
    part = lib.Part('debris_spinach')
    part.add_mesh([tuple(p) for p in V] + V2, F, lib.M('Spinach'))
    # midrib and two side veins
    rib = [pt(u / 8, 0.0, 1) for u in range(0, 8)]
    part.sweep([(p[0], p[1] + 0.006, p[2]) for p in rib], 0.009, lib.M('SpinachVein'), verts=6,
               radii=[0.011 - 0.001 * k for k in range(8)], cap_round=1)
    for side in (-1, 1):
        for u0 in (0.3, 0.55):
            vein = [pt(u0 + 0.12 * k / 4, 0.75 * k / 4, side) for k in range(5)]
            part.sweep([(p[0], p[1] + 0.005, p[2]) for p in vein], 0.005, lib.M('SpinachVein'), verts=5, cap_round=0)
    return part.finish(recalc=True, smooth_angle=50, weld=1e-5)


def build_seed():
    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # teardrop: wider at -x, pointed at +x
        wz = 0.056 * (1 - 0.55 * S(-0.09, 0.1, x))
        q = (x / 0.095) ** 2 + (y / 0.026) ** 2 + (z / wz) ** 2
        return (np.sqrt(q) - 1) * 0.026
    P, quads = im.mesh_star(f, (0, 0, 0), (0.095, 0.026, 0.05), n=7, relax=3)
    part = lib.Part('debris_seed')
    part.add_mesh([tuple(p) for p in P], quads, lib.M('Seed'))
    return part.finish(all_smooth=True)


def build_candy():
    """A red gummy bear head, bitten off at the neck."""
    def f(P):
        head = im.ellipsoid(P, (0, 0.0, 0), (0.12, 0.105, 0.095))
        snout = im.ellipsoid(P, (0, -0.03, 0.07), (0.06, 0.045, 0.045))
        d = im.smin(head, snout, 0.03)
        for sx in (-1, 1):
            ear = im.ellipsoid(P, (sx * 0.085, 0.085, -0.01), (0.045, 0.045, 0.035))
            d = im.smin(d, ear, 0.02)
        bite = -0.07 - P[:, 1] + 0.012 * im.vnoise(P, freq=40.0, seed=2)
        return im.smax(d, bite, 0.025)
    P, quads = im.mesh_star(f, (0, 0.01, 0), (0.13, 0.11, 0.1), n=10, relax=4)
    P[:, 1] -= 0.02
    part = lib.Part('debris_candy')
    part.add_mesh([tuple(p) for p in P], quads, lib.M('Candy'))
    return part.finish(all_smooth=True)


def builders():
    """key -> (build function, exports vertex colors)"""
    b = {
        'tongue': (build_tongue, True),
        'mouth_frame': (build_frame, True),
    }
    for k in TARTAR_SEEDS:
        b[k] = ((lambda k=k: build_tartar(k)), True)
    b['debris_popcorn'] = (build_popcorn, False)
    b['debris_spinach'] = (build_spinach, False)
    b['debris_seed'] = (build_seed, False)
    b['debris_candy'] = (build_candy, False)
    return b
