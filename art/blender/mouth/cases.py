# Case props (DESIGN 5): pirate barnacles, seaweed and doubloon, candy-kid sugar bugs, braces brackets.
#
# Contract (docs/ARCHITECTURE.md, Mouth models, plus the round-2 brief):
#   tartar_barnacle  craggy barnacle cluster about 0.4 x 0.3 x 0.25 (X x Z x Y), origin at the base center,
#                    +Y out of the tooth surface. Cream-grey shell plates with dark openings. Barnacle
#                    (vertex colors), BarnacleDark.
#   debris_seaweed   a long wavy kelp strand about 0.8 long (along Y) and 0.12 wide (along X), wavy in Z,
#                    origin at the center, the narrow stalk end at -Y (the end that sits in the gap). Seaweed.
#   doubloon         a gold coin 0.35 across, disc in the XY plane, faces toward +Z and -Z (debris are turned
#                    with lookAt, so +Z faces out of the gap), stamped skull and crossbones on both faces.
#                    Gold (low metalness), GoldDark.
#   sugar_bug        a cute lime germ about 0.35 across, origin at the base center (its feet), +Y out of the
#                    tooth, walking toward +Z. Nodes: Body (mesh, pivot at the base), EyeL and EyeR (children
#                    of Body, pivot at each eye center, so they can blink with a Y scale). Bug (vertex colors),
#                    BugDark, Eye, Pupil, Candy, White.
#   bracket          an orthodontic twin bracket 0.26 x 0.22 x 0.08 (X x Z x Y), origin at the base center, +Y
#                    out of the tooth, the wire slot running along X. Bracket, plus a tintable elastic tie Band.
# Authored in three.js space (see lib.py).
import math
import numpy as np
from mathutils import Matrix, Vector
import lib
import implicit as im
from lib import M, Part

rad = math.radians
S = im.sstep

lib.STD.update({
    'Barnacle':     ('#E8E1CF', 0.8, 0.0),
    'BarnacleDark': ('#3B3431', 0.9, 0.0),
    'Seaweed':      ('#43A047', 0.55, 0.0),
    'Bug':          ('#9BE33C', 0.5, 0.0),
    'BugDark':      ('#5AAE2A', 0.55, 0.0),
    'Eye':          ('#FFFFFF', 0.25, 0.0),
    'Pupil':        ('#16323A', 0.3, 0.0),
    'Bracket':      ('#B9C3CC', 0.28, 0.3),
    'Band':         ('#FF7AA8', 0.45, 0.0),
})


# ------------------------------------------------------------------ barnacle cluster

def barnacle(part, center, R, H, tilt=(0.0, 0.0), seed=0, NA=20):
    """One acorn barnacle: a ribbed volcano of six wall plates with a dark opening and two beak plates.
    Built as a ring grid (profile x angle) so it stays closed and smooth. Appends vertex colors."""
    rng = np.random.default_rng(seed)
    # profile: (radius fraction, height fraction, zone) from the base, up the wall, over the rim, down inside
    prof = [(1.0, 0.0, 'w'), (1.0, 0.06, 'w'), (0.93, 0.32, 'w'), (0.8, 0.62, 'w'), (0.62, 0.9, 'w'),
            (0.53, 1.0, 'r'), (0.44, 0.99, 'r'), (0.38, 0.86, 'i'), (0.3, 0.74, 'i')]
    phase = rng.uniform(0, 2 * math.pi)
    rot = Matrix.Rotation(rad(tilt[0]), 3, 'X') @ Matrix.Rotation(rad(tilt[1]), 3, 'Z')
    c = Vector(center)
    V, F, mats, C = [], [], [], []
    rings = []
    for (rf, hf, zone) in prof:
        ring = []
        for k in range(NA):
            a = 2 * math.pi * k / NA
            # six plates: shallow grooves at the sutures, fine growth ribs, a crenelated rim
            suture = abs(math.cos(3 * (a + phase))) ** 10
            rib = math.sin(24 * (a + phase))
            r = R * rf * (1 + 0.06 * math.cos(6 * (a + phase)) - 0.07 * suture * (zone == 'w') +
                          0.02 * rib * (zone == 'w') * (1 - hf))
            y = H * hf
            if zone == 'r':
                y += H * 0.07 * math.cos(6 * (a + phase))            # crenelated rim
            p = rot @ Vector((r * math.sin(a), y, r * math.cos(a))) + c
            ring.append(len(V))
            V.append(tuple(p))
            # colors: warm cream on top, greyer at the base, dark sutures, a little noise
            if zone == 'i':
                C.append((1.0, 1.0, 1.0))
            else:
                t = hf
                base = (0.72 + 0.28 * t, 0.7 + 0.28 * t, 0.66 + 0.3 * t)
                k2 = 1 - 0.35 * suture * (zone == 'w') - 0.06 * rng.random()
                C.append(tuple(max(0.0, min(1.0, v * k2)) for v in base))
        rings.append((ring, zone))
    idx0 = len(V)
    # floor of the opening (dark)
    floor = rot @ Vector((0, H * 0.7, 0)) + c
    V.append(tuple(floor))
    C.append((1.0, 1.0, 1.0))
    for i in range(len(rings) - 1):
        (ra, za), (rb, zb) = rings[i], rings[i + 1]
        m = 'BarnacleDark' if zb == 'i' else 'Barnacle'
        for k in range(NA):
            k2 = (k + 1) % NA
            F.append([ra[k], ra[k2], rb[k2], rb[k]])
            mats.append(m)
    last = rings[-1][0]
    for k in range(NA):
        F.append([last[k], last[(k + 1) % NA], idx0])
        mats.append('BarnacleDark')
    # bottom cap (sits on the tooth)
    first = rings[0][0]
    bot = rot @ Vector((0, 0.0, 0)) + c
    V.append(tuple(bot))
    C.append((0.7, 0.68, 0.64))
    for k in range(NA):
        F.append([first[(k + 1) % NA], first[k], len(V) - 1])
        mats.append('Barnacle')
    return V, F, mats, C, (rot, c)


def build_barnacle():
    part = Part('tartar_barnacle')
    allV, allC = [], []
    groups = {'Barnacle': [], 'BarnacleDark': []}
    # (center x, z), radius, height, tilt (about X, about Z) in degrees
    spec = [((-0.035, -0.005), 0.1, 0.215, (4, 6)),
            ((0.105, 0.04), 0.072, 0.16, (10, -14)),
            ((0.09, -0.075), 0.056, 0.12, (-14, -12)),
            ((-0.13, 0.075), 0.05, 0.1, (12, 14)),
            ((-0.135, -0.07), 0.045, 0.085, (-12, 12)),
            ((0.02, 0.1), 0.04, 0.07, (16, -4))]
    beaks = []
    for n, ((x, z), R, H, tilt) in enumerate(spec):
        V, F, mats, C, (rot, c) = barnacle(part, (x, 0.0, z), R, H, tilt, seed=7 + n * 13, NA=20 if R >= 0.07 else 15)
        off = len(allV)
        allV += V
        allC += C
        for f, m in zip(F, mats):
            groups[m].append([i + off for i in f])
        beaks.append((rot, c, R, H))
    for m, fl in groups.items():
        part.add_mesh([], [], M(m))  # register material order
    # add all rings as one vertex list, faces per material
    import bmesh
    bm = part.bm
    bv = [bm.verts.new(v) for v in allV]
    for m, fl in groups.items():
        mi = part._mi(M(m))
        for f in fl:
            try:
                face = bm.faces.new([bv[i] for i in f])
            except ValueError:
                continue
            face.material_index = mi
            face.smooth = True
    # beak plates (scuta and terga) closing each opening: two little cream lids with a dark slit between
    lid = lib.material('BarnacleLid', '#F4EEDF', 0.7, 0.0)
    for (rot, c, R, H) in beaks:
        for s in (-1, 1):
            p = rot @ Vector((s * R * 0.14, H * 0.8, 0)) + c
            e = rot.to_euler()
            part.sphere(R * 0.2, tuple(p), lid, seg=8, rings=5, scale=(0.75, 0.55, 1.3),
                        rot=tuple(math.degrees(a) for a in e))
    # a crusty pad fusing the cluster to the tooth: a low lumpy dome with a flat underside
    NR, NA = 4, 24
    padV = [(0.0, 0.036, 0.0)]
    for i in range(1, NR + 1):
        f = i / NR
        for k in range(NA):
            a = 2 * math.pi * k / NA
            padV.append((0.205 * f * math.sin(a), 0.036 * (1 - f ** 2.2), 0.15 * f * math.cos(a)))
    Pp = np.array(padV)
    Pp[:, 1] = np.maximum(0.0, Pp[:, 1] + 0.008 * im.fbm(Pp, freq=30.0, octaves=2, seed=5) * (Pp[:, 1] > 1e-6))
    padV = [tuple(p) for p in Pp] + [(0.0, 0.0, 0.0)]
    bc = len(padV) - 1
    ring = lambda i, k: 1 + (i - 1) * NA + (k % NA)
    padF = [[0, ring(1, k + 1), ring(1, k)] for k in range(NA)]
    for i in range(1, NR):
        for k in range(NA):
            padF.append([ring(i, k), ring(i, k + 1), ring(i + 1, k + 1), ring(i + 1, k)])
    padF += [[bc, ring(NR, k), ring(NR, k + 1)] for k in range(NA)]
    allV += padV
    allC += [(0.74, 0.7, 0.62)] * len(padV)
    mi = part._mi(M('Barnacle'))
    pv = [bm.verts.new(v) for v in padV]
    for f in padF:
        try:
            face = bm.faces.new([pv[i] for i in f])
        except ValueError:
            continue
        face.material_index = mi
        face.smooth = True
    lookup_v = allV
    lookup_c = allC
    colfn = lib.color_lookup(lookup_v, lookup_c)
    return part.finish(recalc=True, smooth_angle=70, color_fn=colfn)


# ------------------------------------------------------------------ seaweed

def build_seaweed():
    """A ruffled kelp blade on a short stalk with a float bulb. Length along Y, width along X."""
    NU, NV = 44, 6            # along, across (one side of the midrib)
    L, W = 0.8, 0.12
    y0 = -L / 2

    def center(u):
        y = y0 + L * u
        x = 0.028 * math.sin(u * 7.0 + 0.4) * S(0.08, 0.3, u)
        z = 0.05 * math.sin(u * 9.5) * S(0.05, 0.3, u)
        return x, y, z

    def halfw(u):
        stalk = 0.012
        blade = (W / 2) * math.sin(math.pi * min(1.0, max(0.0, (u - 0.14) / 0.86)) ** 0.7) if u > 0.14 else 0.0
        return max(stalk, blade)

    grid = {}
    V = []
    for i in range(NU + 1):
        u = i / NU
        cx, cy, cz = center(u)
        hw = halfw(u)
        for j in range(-NV, NV + 1):
            v = j / NV
            x = cx + hw * v
            # ruffled edges and a gentle cup across the blade
            ruff = 0.018 * abs(v) ** 2.2 * math.sin(u * 46 + (1 if v > 0 else 2.1)) * S(0.14, 0.3, u)
            cup = -0.012 * v * v * S(0.14, 0.3, u)
            grid[(i, j)] = len(V)
            V.append((x, cy, cz + ruff + cup))
    thick = 0.009
    top = []
    for i in range(NU):
        for j in range(-NV, NV):
            top.append([grid[(i, j)], grid[(i, j + 1)], grid[(i + 1, j + 1)], grid[(i + 1, j)]])
    n = len(V)
    V2 = [(x, y, z - thick) for (x, y, z) in V]
    F = [f[::-1] for f in top] + [[k + n for k in f] for f in top]
    outline = [grid[(0, j)] for j in range(-NV, NV + 1)] + [grid[(i, NV)] for i in range(1, NU + 1)] + \
              [grid[(NU, j)] for j in range(NV - 1, -NV - 1, -1)] + [grid[(i, -NV)] for i in range(NU - 1, 0, -1)]
    for k in range(len(outline)):
        a, b = outline[k], outline[(k + 1) % len(outline)]
        F.append([a, b, b + n, a + n])
    # vertex colors: a paler midrib, darker ruffled edges, a paler stalk
    cols = []
    for (i, j) in sorted(grid, key=lambda t: grid[t]):
        u, v = i / NU, abs(j) / NV
        mid = math.exp(-(v / 0.18) ** 2)
        c = 0.86 + 0.22 * mid - 0.2 * v ** 2
        stalk = 1 - S(0.1, 0.2, u)
        cols.append((min(1, c + 0.25 * stalk), min(1, c + 0.05 * stalk), min(1, c * 0.9)))
    cols = cols + cols
    part = Part('debris_seaweed')
    sw = M('Seaweed')
    part.add_mesh(V + V2, F, sw)
    # a float bulb where the blade meets the stalk
    bx, by, bz = center(0.13)
    part.sphere(0.028, (bx, by, bz - thick / 2), sw, seg=12, rings=8, scale=(1.0, 1.25, 1.0))
    bulb_v = []
    for p in list(part.bm.verts)[len(V) * 2:]:
        bulb_v.append(tuple(p.co))
    colfn = lib.color_lookup([tuple(p) for p in (V + V2)] + bulb_v, cols + [(1.0, 1.05, 0.8)] * len(bulb_v))
    return part.finish(recalc=True, smooth_angle=60, color_fn=lambda co: tuple(min(1.0, c) for c in colfn(co)))


# ------------------------------------------------------------------ doubloon

def build_doubloon():
    part = Part('doubloon')
    gold, dark = M('Gold'), M('GoldDark')
    R, T = 0.175, 0.036
    # coin body: a lathe about Z with a raised rim and a slightly sunken field on both faces
    prof = [(0.0, -0.0115), (0.128, -0.0115), (0.136, -0.0145), (0.15, -0.018), (0.168, -0.0165), (0.175, -0.012),
            (0.175, 0.012), (0.168, 0.0165), (0.15, 0.018), (0.136, 0.0145), (0.128, 0.0115), (0.0, 0.0115)]
    part.lathe(prof, gold, verts=36, axis='Z')
    # a ring of little beads inside the rim
    for side in (-1, 1):
        for k in range(14):
            a = 2 * math.pi * (k + 0.5) / 14
            part.sphere(0.0075, (0.117 * math.cos(a), 0.117 * math.sin(a), side * 0.0118), gold, seg=6, rings=3,
                        scale=(1, 1, 0.55))
    # stamped skull and crossbones, on both faces
    for side in (-1, 1):
        zf = side * 0.0115

        def P(x, y, dz=0.0):
            return (x * side, y, zf + side * dz)
        # crossbones behind the skull
        for s in (-1, 1):
            a = rad(38) * s
            d = (math.cos(a) * 0.075, math.sin(a) * 0.075)
            p1, p2 = P(-d[0], -d[1] - 0.01, 0.004), P(d[0], d[1] - 0.01, 0.004)
            part.tube(p1, p2, 0.0075, gold, verts=8)
            for (px, py) in ((-d[0], -d[1] - 0.01), (d[0], d[1] - 0.01)):
                nx, ny = -math.sin(a), math.cos(a)
                for kk in (-1, 1):
                    part.sphere(0.0085, P(px + nx * kk * 0.007, py + ny * kk * 0.007, 0.004), gold, seg=6, rings=4,
                                scale=(1, 1, 0.8))
        # cranium, cheek bones and jaw
        part.sphere(0.052, P(0.0, 0.018, 0.0), gold, seg=16, rings=8, scale=(1.0, 0.95, 0.3))
        part.box((0.058, 0.03, 0.014), P(0.0, -0.028, 0.004), gold, bevel=0.006, seg=2)
        # teeth grooves
        for tx in (-0.013, 0.0, 0.013):
            part.box((0.0035, 0.022, 0.006), P(tx, -0.03, 0.0105), dark)
        # eye sockets and nose
        for sx in (-1, 1):
            part.sphere(0.0145, P(sx * 0.02, 0.013, 0.0125), dark, seg=10, rings=5, scale=(1.0, 1.05, 0.28))
        part.sphere(0.0075, P(0.0, -0.007, 0.0135), dark, seg=6, rings=4, scale=(0.8, 1.1, 0.3))
    return part.finish(smooth_angle=45)


# ------------------------------------------------------------------ sugar bug

BUG_EYES = [(-0.062, 0.205, 0.07), (0.062, 0.205, 0.07)]   # EyeR (bug's right, -X), EyeL (+X)
BUG_EYE_R = 0.056


def bug_fn():
    lumps = [((0.0, 0.11, 0.0), (0.15, 0.115, 0.14)),
             ((0.0, 0.16, 0.05), (0.11, 0.08, 0.1)),
             ((-0.08, 0.1, -0.05), (0.07, 0.06, 0.07)),
             ((0.085, 0.09, -0.03), (0.065, 0.06, 0.07)),
             ((0.0, 0.13, -0.08), (0.08, 0.07, 0.07)),
             ((-0.06, 0.07, 0.08), (0.06, 0.05, 0.05)),
             ((0.07, 0.075, 0.075), (0.055, 0.05, 0.05))]

    def f(P):
        d = None
        for c, r in lumps:
            e = im.ellipsoid(P, c, r)
            d = e if d is None else im.smin(d, e, 0.045)
        d = d - 0.006 * im.fbm(P, freq=14.0, octaves=2, seed=17)
        return im.smax(d, 0.022 - P[:, 1], 0.03)       # flat belly just above the tooth
    return f


def build_sugar_bug():
    import bpy
    f = bug_fn()
    P, quads = im.mesh_star(f, (0.0, 0.11, 0.0), (0.15, 0.11, 0.14), n=10, relax=4)
    body = Part('Body')
    bug, bugd = M('Bug'), M('BugDark')
    body.add_mesh([tuple(p) for p in P], quads, bug)
    spots = im.fbm(P, freq=9.0, octaves=2, seed=3)
    cols = []
    for k in range(len(P)):
        top = S(0.03, 0.22, P[k, 1])
        spot = S(0.25, 0.45, spots[k])
        c = 0.78 + 0.26 * top
        cols.append((max(0, min(1, c * (1 - 0.28 * spot))), max(0, min(1, c * (1 - 0.12 * spot))),
                     max(0, min(1, c * (1 - 0.3 * spot)))))
    # six stubby legs
    for s in (-1, 1):
        for ang, ln in ((40, 0.07), (90, 0.075), (140, 0.07)):
            a = rad(ang)
            ox, oz = s * math.sin(a), math.cos(a)
            hip = (ox * 0.1, 0.05, oz * 0.095)
            knee = (ox * 0.15, 0.035, oz * 0.14)
            foot = (ox * (0.1 + ln), 0.012, oz * (0.095 + ln))
            body.sweep([hip, knee, foot], 0.016, bugd, verts=8, radii=[0.018, 0.016, 0.015], cap_round=1)
            body.sphere(0.02, foot, bugd, seg=8, rings=5, scale=(1.1, 0.6, 1.2))
    # candy-striped antenna with a candy ball
    ant = [(0.0, 0.2, -0.05), (0.005, 0.26, -0.065), (0.02, 0.31, -0.07), (0.045, 0.345, -0.06), (0.07, 0.36, -0.035)]
    pts = []
    for i in range(len(ant) - 1):
        for t in np.linspace(0, 1, 2, endpoint=False):
            a, b = np.array(ant[i]), np.array(ant[i + 1])
            pts.append(tuple(a + (b - a) * t))
    pts.append(ant[-1])
    candy, white = M('Candy'), M('White')
    for i in range(len(pts) - 1):
        body.tube(pts[i], pts[i + 1], 0.011, candy if i % 2 == 0 else white, verts=8)
        body.sphere(0.011, pts[i + 1], candy if i % 2 == 0 else white, seg=8, rings=3)
    body.sphere(0.03, (0.078, 0.368, -0.028), candy, seg=12, rings=7)
    body.sphere(0.009, (0.07, 0.384, -0.012), white, seg=8, rings=4)
    # cheeky grin with one little fang, and two mischievous brows, laid on the body surface
    pupil = M('Pupil')
    C0 = np.array([0.0, 0.11, 0.0])

    def on_body(dirs, lift):
        D = np.array(dirs, dtype=float)
        D /= np.linalg.norm(D, axis=1)[:, None]
        t = im._raycast(f, C0, D, 0.4)
        return [tuple(C0 + D[k] * (t[k] + lift)) for k in range(len(D))]
    xs = np.linspace(-0.42, 0.42, 7)
    grin = on_body([(x, 0.28 + 0.35 * (x / 0.42) ** 2, 1.0) for x in xs], 0.002)
    body.sweep(grin, 0.0095, pupil, verts=8, cap_round=2)
    fang = grin[4]
    body.sphere(0.012, (fang[0], fang[1] - 0.01, fang[2] + 0.003), M('Eye'), seg=8, rings=5, scale=(0.9, 1.3, 0.7))
    for s_ in (-1, 1):
        brow = on_body([(s_ * 0.85, 1.0, -0.05), (s_ * 0.5, 1.0, 0.05), (s_ * 0.18, 1.0, 0.22)], 0.004)
        body.sweep(brow, 0.011, pupil, verts=8, cap_round=2)
    ob = body.finish(all_smooth=True, color_fn=lib.color_lookup([tuple(p) for p in P], cols))
    # eyes: separate nodes, pivot at the eye center, looking up and a little forward
    look = Vector((0.0, 0.8, 0.6)).normalized()
    for name, c in (('EyeR', BUG_EYES[0]), ('EyeL', BUG_EYES[1])):
        e = Part(name)
        e.sphere(BUG_EYE_R, (0, 0, 0), M('Eye'), seg=16, rings=10)
        side = Vector((math.copysign(0.18, c[0]), 0, 0))
        d = (look + side * 0.4).normalized()
        pc = d * BUG_EYE_R * 0.78
        q = Vector((0, 0, 1)).rotation_difference(d)
        eul = q.to_euler()
        e.sphere(BUG_EYE_R * 0.52, tuple(pc), pupil, seg=12, rings=6, scale=(1.0, 1.0, 0.5),
                 rot=tuple(math.degrees(a) for a in eul))
        hl = (d * BUG_EYE_R * 0.96) + Vector((-0.012, 0.012, 0.006))
        e.sphere(BUG_EYE_R * 0.17, tuple(hl), M('Eye'), seg=6, rings=4)
        eo = e.finish(all_smooth=True)
        eo.location = lib.TO_BLENDER @ Vector(c)
        eo.parent = ob
        eo.matrix_parent_inverse.identity()
    bpy.context.view_layer.update()
    return ob


# ------------------------------------------------------------------ bracket

def build_bracket():
    part = Part('bracket')
    steel, band = M('Bracket'), M('Band')
    # base pad (bonded to the enamel), curved a touch to hug the tooth
    part.box((0.25, 0.018, 0.21), (0, 0.009, 0), steel, bevel=0.008, seg=2)
    # body
    part.box((0.13, 0.04, 0.15), (0, 0.035, 0), steel, bevel=0.01, seg=2)
    # slot walls along X (the wire runs between them)
    for s in (-1, 1):
        part.box((0.2, 0.03, 0.022), (0, 0.062, s * 0.024), steel, bevel=0.006, seg=2)
    # four tie wings, overhanging outward in Z so the elastic can hook under them
    for sx in (-1, 1):
        for sz in (-1, 1):
            part.box((0.07, 0.022, 0.06), (sx * 0.062, 0.069, sz * 0.068), steel, bevel=0.009, seg=2)
            part.box((0.05, 0.03, 0.03), (sx * 0.062, 0.045, sz * 0.058), steel, bevel=0.006, seg=1)
    # a little color-coded dot (orientation mark) on one wing, like the real thing
    part.sphere(0.008, (-0.075, 0.081, -0.078), M('Mint'), seg=8, rings=5, scale=(1, 0.5, 1))
    # elastic tie: a rounded square loop under the wings, arching over the slot at both ends
    pts = []
    N = 48
    for k in range(N):
        a = 2 * math.pi * k / N
        c, s = math.cos(a), math.sin(a)
        # superellipse loop around the wing necks
        x = 0.092 * math.copysign(abs(c) ** 0.35, c)
        z = 0.082 * math.copysign(abs(s) ** 0.35, s)
        y = 0.05 + 0.03 * math.exp(-(z / 0.03) ** 2)        # rises over the wire at the slot
        pts.append((x, y, z))
    part.sweep(pts, 0.009, band, verts=8, closed=True)
    return part.finish(smooth_angle=40)


def builders():
    """key -> (build function, exports vertex colors)"""
    return {
        'tartar_barnacle': (build_barnacle, True),
        'debris_seaweed': (build_seaweed, True),
        'doubloon': (build_doubloon, False),
        'sugar_bug': (build_sugar_bug, True),
        'bracket': (build_bracket, False),
    }
