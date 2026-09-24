# Event props for the diorama (docs/DESIGN.md 10.2): prop_puppy, prop_balloons, prop_jolly_roger, prop_rival_sign,
# prop_red_carpet, prop_generator, prop_camera_crew.
# Blender space: front toward -Y, Z up, meters. build.py recenters each model on its footprint.
# prop_puppy is rigged like the people: one root at the floor with the child node Body (pivot in the torso), and
# Head (pivot at the neck) and Tail (pivot at the tail base) under Body, all with identity rotation, so the view
# can wag the tail (rotate Tail about the vertical axis) and tilt the head.
import math
import bmesh
from mathutils import Vector
from lib import Part, M, material, empty, scale_hierarchy, tooth2d, rrect, ellipse, arc
from operatory import glow, grin2d
from front import star2d

TAU = 2 * math.pi


def fur():
    return material('Fur', '#E99A4E', 0.85, 0.0)


def fur_white():
    return material('FurWhite', '#FFF5E6', 0.85, 0.0)


# ------------------------------------------------------------------ puppy

def prop_puppy():
    """A corgi-like pup standing proud: ginger and cream fur, big ears, a pink tongue, a mint collar with a
    sunny tooth tag, a fluffy tail."""
    root = empty('Puppy', (0, 0, 0))
    ginger, cream, ink = fur(), fur_white(), M('Ink')
    # body: long loaf on short legs, head toward -Y
    body = Part('Body')
    body.sphere(1.0, (0, 0.03, 0.2), ginger, seg=18, rings=12, scale=(0.13, 0.23, 0.12))
    body.sphere(1.0, (0, -0.1, 0.18), cream, seg=14, rings=10, scale=(0.1, 0.12, 0.1))
    body.sphere(1.0, (0, 0.2, 0.2), cream, seg=12, rings=8, scale=(0.1, 0.07, 0.09))
    for sx in (-1, 1):
        for (ly, lr) in ((-0.12, 0.042), (0.15, 0.045)):
            x = sx * 0.07
            body.capsule((x, ly, 0.16), (x, ly - 0.01, 0.05), lr, cream, verts=10)
            body.sphere(1.0, (x, ly - 0.025, 0.027), cream, seg=10, rings=6, scale=(0.045, 0.055, 0.025))
    # collar and tag at the neck
    body.torus(0.075, 0.016, (0, -0.16, 0.3), M('Mint'), segs=18, verts=6, rot=(35, 0, 0))
    body.plate(tooth2d(0.05, 0.05), 0.01, (0, -0.232, 0.222), M('Sunshine'), axis='Y')
    bo = body.finish(origin=(0, 0, 0.2), parent=root)
    # head
    hd = Part('Head')
    hy, hz = -0.21, 0.4
    hd.sphere(1.0, (0, hy, hz), ginger, seg=18, rings=12, scale=(0.115, 0.1, 0.1))
    hd.sphere(1.0, (0, hy - 0.08, hz - 0.035), cream, seg=14, rings=10, scale=(0.075, 0.065, 0.055))
    hd.sphere(1.0, (0, hy - 0.075, hz + 0.03), cream, seg=10, rings=8, scale=(0.028, 0.05, 0.06))
    hd.sphere(0.024, (0, hy - 0.142, hz - 0.02), ink, seg=10, rings=6, scale=(1.2, 0.8, 0.9))
    for s in (-1, 1):
        hd.sphere(0.019, (s * 0.046, hy - 0.085, hz + 0.025), ink, seg=10, rings=6)
        hd.sphere(0.007, (s * 0.046 + 0.006, hy - 0.101, hz + 0.034), M('EyeShine'), seg=6, rings=4)
        hd.sphere(1.0, (s * 0.075, hy - 0.07, hz - 0.03), M('Cheek'), seg=8, rings=5, scale=(0.022, 0.012, 0.014))
        # big pointy ears, pink inside
        mk = hd.mark()
        hd.prism([(-0.045, 0.0), (0.045, 0.0), (0.0, 0.13)], 0.022, ginger, axis='Y', center=0.0, bevel=0.008, seg=1,
                 flat=False)
        hd.prism([(-0.026, 0.012), (0.026, 0.012), (0.0, 0.095)], 0.01, M('Blush'), axis='Y', center=-0.012)
        hd.xform_since(mk, loc=(s * 0.062, hy + 0.01, hz + 0.06), rot=(-12, s * 22, 0))
    hd.sphere(1.0, (0, hy - 0.12, hz - 0.07), M('Bubblegum'), seg=10, rings=6, scale=(0.024, 0.018, 0.032))
    hd.finish(origin=(0, -0.16, 0.3), parent=bo)
    # tail
    tl = Part('Tail')
    tl.capsule((0, 0.25, 0.25), (0, 0.31, 0.35), 0.038, ginger, verts=10, r2=0.034)
    tl.sphere(0.036, (0, 0.315, 0.365), cream, seg=10, rings=6)
    tl.finish(origin=(0, 0.25, 0.25), parent=bo)
    # a cartoon-big pup, so it still reads next to people at diorama zoom
    scale_hierarchy(root, 1.25)


# ------------------------------------------------------------------ balloons

def balloon(p, tip, lean, color, s=1.0):
    """A shiny balloon whose knot sits at `tip`, leaning by `lean` degrees (x, y rotation)."""
    prof = [(0.0, 0.0), (0.018, 0.0), (0.012, 0.025), (0.06, 0.05), (0.13, 0.13), (0.16, 0.22), (0.165, 0.29),
            (0.145, 0.37), (0.09, 0.425), (0.0, 0.445)]
    prof = [(r * s, z * s) for (r, z) in prof]
    mk = p.mark()
    p.lathe(prof, (0, 0, 0), color, segs=16)
    p.sphere(1.0, (-0.07 * s, -0.1 * s, 0.33 * s), material('Shine', '#FFFFFF', 0.3, 0.0, emit=0.2), seg=8, rings=5,
             scale=(0.028 * s, 0.018 * s, 0.05 * s), rot=(0, -25, 0))
    p.xform_since(mk, loc=tip, rot=(lean[0], lean[1], 0))


def prop_balloons():
    """A bunch of five palette balloons on curly strings, tied to a sunny weight with a pink bow."""
    p = Part('Balloons')
    wm = M('Sunshine')
    p.rbox((0.16, 0.16, 0.13), (0, 0, 0.065), wm, r=0.03, seg=2)
    p.rbox((0.17, 0.03, 0.135), (0, 0, 0.066), M('Bubblegum'), r=0.01, seg=1)
    p.rbox((0.03, 0.17, 0.135), (0, 0, 0.066), M('Bubblegum'), r=0.01, seg=1)
    for s in (-1, 1):
        p.sphere(1.0, (s * 0.04, 0, 0.15), M('Bubblegum'), seg=10, rings=6, scale=(0.045, 0.02, 0.03),
                 rot=(0, s * 20, 0))
    p.sphere(0.018, (0, 0, 0.145), M('Bubblegum'), seg=8, rings=5)
    shiny = {c: material('Balloon' + c, hx, 0.28, 0.0) for c, hx in (
        ('Pink', '#FF7AA8'), ('Mint', '#3DD6B5'), ('Sun', '#FFD166'), ('Sky', '#7CC8F2'), ('Lilac', '#B9A6F2'))}
    knots = [((-0.26, 0.04, 1.38), (4, -18), 'Pink'), ((0.25, -0.02, 1.42), (-3, 16), 'Sky'),
             ((0.0, 0.08, 1.62), (6, 2), 'Sun'), ((-0.14, -0.1, 1.82), (-6, -8), 'Mint'),
             ((0.16, 0.02, 1.86), (3, 10), 'Lilac')]
    for (tip, lean, c) in knots:
        balloon(p, tip, lean, shiny[c])
        x, y, z = tip
        pts = [(0.0, 0.0, 0.15)]
        for i in range(1, 7):
            t = i / 6
            w = math.sin(math.pi * t)
            pts.append((x * t + 0.025 * w * math.sin(t * 9 + x * 5), y * t + 0.02 * w * math.cos(t * 7),
                        0.15 + (z - 0.15) * t))
        p.sweep(pts, 0.005, M('Paper'), verts=4)
    return p.finish()


# ------------------------------------------------------------------ jolly roger

def flag_decal(p, y, m_white, m_ink):
    """Skull with two crossed toothbrushes on a flag facing -Y at depth y (mirror for the back)."""
    mk = p.mark()
    for a in (35, -35):
        mm = p.mark()
        p.plate(rrect(0.46, 0.035, 0.015, 1), 0.006, (0, 0, 0), m_white, axis='Y')
        p.plate(rrect(0.085, 0.05, 0.012, 1), 0.008, (0.19, 0, 0.04), M('Mint') if a > 0 else M('Bubblegum'), axis='Y')
        p.xform_since(mm, rot=(0, a, 0))
    p.plate(ellipse(0.1, 0.095, 18), 0.008, (0, -0.002, 0.04), m_white, axis='Y')
    p.plate(rrect(0.11, 0.07, 0.02, 2), 0.008, (0, -0.002, -0.03), m_white, axis='Y')
    for s in (-1, 1):
        p.plate(ellipse(0.028, 0.032, 10), 0.006, (s * 0.04, -0.006, 0.045), m_ink, axis='Y')
    p.plate([(-0.012, -0.012), (0.012, -0.012), (0.0, 0.012)], 0.006, (0, -0.006, -0.0), m_ink, axis='Y')
    for k in range(3):
        p.box((0.004, 0.006, 0.04), (-0.025 + k * 0.025, -0.006, -0.035), m_ink)
    return mk


def prop_jolly_roger():
    """Pirate flag: a slate flag with a skull and crossed toothbrushes, waving from a tall pole set in a banded
    barrel."""
    p = Part('JollyRoger')
    wood, dark, steel = M('Wood'), M('WoodDark'), M('Steel')
    prof = [(0.0, 0.0), (0.22, 0.0), (0.25, 0.1), (0.265, 0.3), (0.25, 0.5), (0.22, 0.6), (0.0, 0.6)]
    p.lathe(prof, (0, 0, 0), wood, segs=18)
    for z in (0.08, 0.52):
        r = 0.245 if z < 0.3 else 0.24
        p.lathe([(0.0, z - 0.025), (r + 0.01, z - 0.025), (r + 0.01, z + 0.025), (0.0, z + 0.025)], (0, 0, 0), steel,
                segs=18)
    p.cyl(0.2, 0.02, (0, 0, 0.605), dark, verts=18)
    p.cyl(0.03, 2.2, (0, 0, 0.6 + 1.1), dark, verts=10)
    p.sphere(0.05, (0, 0, 2.83), M('Gold'), seg=10, rings=6)
    # the flag, waving along +X from the pole
    fx0, fx1, fz0, fz1 = 0.03, 0.95, 2.1, 2.72
    ink = material('FlagInk', '#33424C', 0.8, 0.0)
    white = M('Enamel')
    mk = p.mark()
    nx, nz, t = 10, 3, 0.012
    tmp = bmesh.new()
    front, back = [], []
    for i in range(nx + 1):
        row_f, row_b = [], []
        for j in range(nz + 1):
            x = fx0 + (fx1 - fx0) * i / nx
            z = fz0 + (fz1 - fz0) * j / nz
            row_f.append(tmp.verts.new((x, -t / 2, z)))
            row_b.append(tmp.verts.new((x, t / 2, z)))
        front.append(row_f)
        back.append(row_b)
    for i in range(nx):
        for j in range(nz):
            tmp.faces.new([front[i][j], front[i + 1][j], front[i + 1][j + 1], front[i][j + 1]])
            tmp.faces.new([back[i][j + 1], back[i + 1][j + 1], back[i + 1][j], back[i][j]])
    for i in range(nx):
        tmp.faces.new([front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]])
        tmp.faces.new([front[i + 1][nz], back[i + 1][nz], back[i][nz], front[i][nz]])
    for j in range(nz):
        tmp.faces.new([front[0][j + 1], back[0][j + 1], back[0][j], front[0][j]])
        tmp.faces.new([front[nx][j], back[nx][j], back[nx][j + 1], front[nx][j + 1]])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    p._emit(tmp, ink, False)
    cx, cz = (fx0 + fx1) / 2 + 0.02, (fz0 + fz1) / 2
    d = p.mark()
    flag_decal(p, 0, white, ink)
    p.xform_since(d, loc=(cx, -t / 2 - 0.008, cz), scale=(1.45, 1.0, 1.45))
    d = p.mark()
    flag_decal(p, 0, white, ink)
    p.xform_since(d, loc=(cx, t / 2 + 0.008, cz), rot=(0, 0, 180), scale=(1.45, 1.0, 1.45))

    def wave(v):
        # one gentle bow across the middle (the decal stays flat enough to ride it), a flutter at the free end
        u = (v.x - fx0) / (fx1 - fx0)
        e = max(0.0, (u - 0.72) / 0.28)
        v.y += 0.035 * math.sin(math.pi * u) - 0.07 * e * e
        v.z -= 0.05 * u * u
        return v
    p.warp_since(mk, wave)
    # two little lashings holding the flag to the pole
    for z in (fz0 + 0.04, fz1 - 0.04):
        p.torus(0.036, 0.008, (0, 0, z), M('Cream'), segs=12, verts=4)
    return p.finish()


# ------------------------------------------------------------------ rival billboard

def prop_rival_sign():
    """A tacky SmileCo billboard on orange legs: loud orange with a purple stripe, marquee bulbs, a winking tooth in
    sunglasses and a lime price burst."""
    p = Part('RivalSign')
    orange = material('RivalOrange', '#FF7A1A', 0.5, 0.0)
    purple = material('RivalPurple', '#7B3FE4', 0.5, 0.0)
    lime = material('RivalLime', '#B8E62E', 0.5, 0.0)
    white = M('Paper')
    W, H, zc = 2.4, 1.1, 2.05
    for s in (-1, 1):
        x = s * 0.75
        p.rbox((0.26, 0.26, 0.12), (x, 0.05, 0.06), M('Cream'), r=0.02, seg=1)
        p.rbox((0.1, 0.1, zc - H / 2 + 0.05), (x, 0.05, (zc - H / 2 + 0.05) / 2 + 0.06), orange, r=0.015, seg=1)
        p.tube((x, 0.05, 0.3), (x - s * 0.5, 0.05, zc - H / 2 - 0.02), 0.022, M('Steel'), verts=6)
    # board: purple back, orange face, purple stripe
    p.rbox((W + 0.1, 0.12, H + 0.1), (0, 0.06, zc), purple, r=0.03, seg=2)
    p.box((W - 0.04, 0.02, H - 0.06), (0, -0.005, zc), orange)
    p.box((W - 0.04, 0.024, 0.2), (0, -0.008, zc - H / 2 + 0.13), purple)
    # marquee bulbs around the face
    bulb = M('Light')
    n_w, n_h = 13, 6
    for i in range(n_w):
        x = -W / 2 + 0.04 + (W - 0.08) * i / (n_w - 1)
        for z in (zc - H / 2 - 0.0, zc + H / 2 + 0.0):
            p.sphere(0.024, (x, -0.02, z), bulb, seg=6, rings=3)
    for j in range(1, n_h - 1):
        z = zc - H / 2 + H * j / (n_h - 1)
        for x in (-W / 2 - 0.0, W / 2 + 0.0):
            p.sphere(0.024, (x, -0.02, z), bulb, seg=6, rings=3)
    # the name
    p.text('SmileCo', 0.36, (0.28, -0.03, zc + 0.02), white, depth=0.03)
    # winking tooth in sunglasses on the left
    tx, tz = -0.82, zc + 0.04
    p.prism(tooth2d(0.46, 0.52), 0.05, white, axis='Y', center=-0.035, bevel=0.012, seg=1, flat=False, loc=(tx, 0, tz))
    glasses = M('Ink')
    for s in (-1, 1):
        p.plate(rrect(0.12, 0.07, 0.025, 2), 0.012, (tx + s * 0.07, -0.068, tz + 0.06), glasses, axis='Y')
    p.box((0.05, 0.012, 0.012), (tx, -0.068, tz + 0.075), glasses)
    p.plate(grin2d(0.18, 0.09), 0.012, (tx, -0.066, tz - 0.05), M('Mouth'), axis='Y')
    p.plate([(-0.07, -0.004), (0.07, -0.004), (0.065, -0.03), (-0.065, -0.03)][::-1], 0.012,
            (tx, -0.07, tz - 0.05), white, axis='Y')
    # lime price burst on the stripe side
    bx, bz = 0.95, zc - 0.33
    p.plate(star2d(0.2, 0.14, 12), 0.03, (bx, -0.035, bz), lime, axis='Y')
    p.text('$19', 0.13, (bx, -0.055, bz - 0.045), purple, depth=0.012)
    for (x, z) in ((-0.45, zc + 0.35), (0.98, zc + 0.36)):
        p.plate(star2d(0.06, 0.02, 4), 0.02, (x, -0.03, z), lime, axis='Y')
    return p.finish()


# ------------------------------------------------------------------ red carpet

def stanchion(p, x, y, brass):
    p.cyl(0.13, 0.035, (x, y, 0.0175), brass, verts=18, bevel=0.012, seg=1)
    p.lathe([(0.0, 0.03), (0.05, 0.03), (0.024, 0.08), (0.022, 0.86), (0.035, 0.9), (0.0, 0.9)], (x, y, 0), brass,
            segs=12)
    p.sphere(0.045, (x, y, 0.93), brass, seg=12, rings=8)


def prop_red_carpet():
    """A red runner (still rolled up a little at the far end) with gold edging, between two pairs of brass
    stanchions with velvet ropes."""
    p = Part('RedCarpet')
    carpet = material('Carpet', '#DB3A4E', 0.9, 0.0)
    brass = material('Brass', '#E9B84C', 0.3, 0.25)
    rope = material('Rope', '#A8233F', 0.75, 0.0)
    L, Wd = 2.6, 0.9
    p.rbox((Wd, L, 0.018), (0, 0, 0.009), carpet, r=0.006, seg=1)
    for s in (-1, 1):
        p.box((0.035, L, 0.02), (s * (Wd / 2 - 0.05), 0, 0.01), brass)
    p.cyl(0.075, Wd, (0, L / 2 + 0.06, 0.075), carpet, axis='X', verts=16)
    p.cyl(0.03, Wd + 0.004, (0, L / 2 + 0.06, 0.075), M('Cream'), axis='X', verts=10)
    ys = (-0.72, 0.72)
    for s in (-1, 1):
        x = s * (Wd / 2 + 0.2)
        for y in ys:
            stanchion(p, x, y, brass)
        pts = []
        for i in range(9):
            t = i / 8
            yy = ys[0] + 0.05 + (ys[1] - ys[0] - 0.1) * t
            pts.append((x, yy, 0.86 - 0.24 * math.sin(math.pi * t)))
        p.sweep(pts, 0.022, rope, verts=8)
        for y in (ys[0] + 0.05, ys[1] - 0.05):
            p.cyl(0.028, 0.05, (x, y, 0.86), brass, axis='Y', verts=10)
    return p.finish()


# ------------------------------------------------------------------ generator

def prop_generator():
    """A sunny yellow portable generator in a slate roll cage: fuel tank, pull start, outlets, muffler with a puff
    of exhaust and an orange extension cord."""
    p = Part('Generator')
    slate, sun, steel = M('Slate'), M('Sunshine'), M('Steel')
    X, Y = 0.34, 0.22
    for sx in (-1, 1):
        p.sweep([(sx * X, -Y, 0.03), (sx * X, -Y, 0.5), (sx * X, -Y + 0.05, 0.57), (sx * X, Y - 0.05, 0.57),
                 (sx * X, Y, 0.5), (sx * X, Y, 0.03)], 0.02, slate, verts=8)
        for sy in (-1, 1):
            p.cyl(0.03, 0.03, (sx * X, sy * Y, 0.015), M('Rubber'), verts=10)
    for sy in (-1, 1):
        p.tube((-X, sy * Y, 0.05), (X, sy * Y, 0.05), 0.018, slate, verts=8)
        p.tube((-X, sy * (Y - 0.05), 0.57), (X, sy * (Y - 0.05), 0.57), 0.02, slate, verts=8)
    # engine block and recoil starter
    p.rbox((0.4, 0.34, 0.26), (-0.06, 0.02, 0.2), steel, r=0.04, seg=2)
    p.cyl(0.11, 0.06, (0.18, 0.02, 0.22), sun, axis='X', verts=18, bevel=0.015)
    p.tube((0.215, 0.02, 0.26), (0.27, 0.02, 0.28), 0.006, M('Ink'), verts=4)
    p.rbox((0.03, 0.09, 0.025), (0.28, 0.02, 0.28), M('Rubber'), r=0.008, seg=1)
    # fuel tank with a cap and gauge
    p.rbox((0.54, 0.36, 0.16), (0, 0, 0.44), sun, r=0.06, seg=3)
    p.cyl(0.04, 0.03, (-0.14, 0.05, 0.53), M('Rubber'), verts=12, bevel=0.008)
    p.cyl(0.03, 0.008, (0.1, -0.04, 0.522), M('Paper'), verts=12)
    p.box((0.004, 0.02, 0.004), (0.105, -0.04, 0.527), M('Coral'), rot=(0, 0, 30))
    # control panel on the front
    p.rbox((0.34, 0.03, 0.16), (-0.02, -0.18, 0.2), M('Cream'), r=0.015, seg=1)
    for k in range(2):
        x = -0.12 + k * 0.1
        p.rbox((0.07, 0.012, 0.07), (x, -0.198, 0.2), slate, r=0.012, seg=1)
        for s in (-1, 1):
            p.box((0.008, 0.006, 0.022), (x + s * 0.014, -0.205, 0.205), M('Ink'))
    p.rbox((0.03, 0.02, 0.05), (0.08, -0.2, 0.22), M('Mint'), r=0.008, seg=1)
    p.sphere(0.012, (0.08, -0.205, 0.16), glow('UiMint', '#3DD6B5', 0.9), seg=6, rings=4)
    # muffler and exhaust puffs
    p.cyl(0.045, 0.16, (-0.2, 0.15, 0.38), M('Chrome'), axis='X', verts=12)
    p.rbox((0.18, 0.012, 0.08), (-0.2, 0.2, 0.38), slate, r=0.01, seg=1)
    puff = material('Puff', '#EEF1F1', 0.9, 0.0)
    for (x, z, r) in ((-0.3, 0.44, 0.04), (-0.34, 0.54, 0.055), (-0.3, 0.66, 0.07)):
        p.sphere(r, (x, 0.18, z), puff, ico=1)
    # extension cord snaking away
    cord = material('Cord', '#FF9B3A', 0.6, 0.0)
    pts = [(-0.12, -0.205, 0.2), (-0.12, -0.25, 0.18), (-0.1, -0.3, 0.02), (0.0, -0.42, 0.012), (0.2, -0.46, 0.012),
           (0.32, -0.38, 0.012), (0.42, -0.5, 0.012)]
    p.sweep(pts, 0.012, cord, verts=6)
    p.rbox((0.06, 0.04, 0.035), (0.45, -0.52, 0.018), cord, r=0.01, seg=1, rot=(0, 0, 40))
    return p.finish()


# ------------------------------------------------------------------ camera crew

def prop_camera_crew():
    """Local news camera: a slate TV camera with a sunny channel 6 badge, a red tally light and a little LED on
    top, on a tripod with a pan handle; a small softbox light on a stand beside it."""
    p = Part('CameraCrew')
    slate, rubber = M('Slate'), M('Rubber')
    cx, cy, top = 0.0, 0.0, 1.18
    for k in range(3):
        a = TAU * k / 3 + math.pi / 2
        fx, fy = cx + 0.42 * math.cos(a), cy + 0.42 * math.sin(a)
        p.tube((cx, cy, top), (fx, fy, 0.02), 0.018, slate, verts=6)
        p.sphere(0.026, (fx, fy, 0.026), rubber, seg=6, rings=4)
        p.tube((cx, cy, 0.45), (cx + 0.2 * math.cos(a), cy + 0.2 * math.sin(a), 0.62), 0.01, M('Steel'), verts=5)
    p.cyl(0.05, 0.08, (cx, cy, top + 0.02), slate, verts=12)
    p.rbox((0.14, 0.14, 0.07), (cx, cy, top + 0.09), slate, r=0.02, seg=1)
    p.tube((cx, cy + 0.05, top + 0.09), (cx + 0.1, cy + 0.42, top + 0.02), 0.013, M('Steel'), verts=6)
    p.cyl(0.02, 0.1, (cx + 0.1, cy + 0.44, top + 0.02), rubber, axis='Y', verts=8, rot=(0, 0, 13))
    # camera body, lens toward -Y
    bz = top + 0.24
    p.rbox((0.2, 0.5, 0.24), (cx, cy + 0.02, bz), slate, r=0.04, seg=2)
    p.rbox((0.012, 0.34, 0.14), (cx + 0.103, cy + 0.04, bz - 0.01), M('Enamel'), r=0.01, seg=1)
    p.box((0.014, 0.34, 0.025), (cx + 0.104, cy + 0.04, bz + 0.075), M('Teal'))
    p.cyl(0.055, 0.016, (cx + 0.11, cy + 0.08, bz - 0.01), M('Sunshine'), axis='X', verts=18)
    p.text('6', 0.08, (cx + 0.118, cy + 0.08, bz - 0.038), M('Ink'), depth=0.008, rot=(90, 0, 90))
    p.cyl(0.075, 0.2, (cx, cy - 0.3, bz - 0.01), rubber, axis='Y', verts=16)
    p.cyl(0.085, 0.03, (cx, cy - 0.37, bz - 0.01), slate, axis='Y', verts=16)
    p.cyl(0.062, 0.012, (cx, cy - 0.385, bz - 0.01), M('Glass'), axis='Y', verts=16)
    p.rbox((0.2, 0.05, 0.16), (cx, cy - 0.43, bz - 0.01), slate, r=0.015, seg=1)
    p.sphere(0.018, (cx + 0.07, cy - 0.21, bz + 0.1), glow('Tally', '#FF4D6D', 1.4), seg=8, rings=5)
    # top handle, viewfinder and a small LED light
    p.sweep([(cx, cy + 0.2, bz + 0.12), (cx, cy + 0.17, bz + 0.2), (cx, cy - 0.1, bz + 0.2), (cx, cy - 0.13, bz + 0.12)],
            0.016, slate, verts=6)
    p.rbox((0.08, 0.14, 0.08), (cx - 0.14, cy - 0.12, bz + 0.07), slate, r=0.015, seg=1)
    p.box((0.004, 0.1, 0.06), (cx - 0.182, cy - 0.12, bz + 0.07), M('Screen'))
    p.rbox((0.12, 0.05, 0.07), (cx, cy - 0.05, bz + 0.24), M('Enamel'), r=0.012, seg=1)
    p.box((0.1, 0.006, 0.05), (cx, cy - 0.077, bz + 0.24), M('Light'))
    # softbox light on a stand, off to the side
    lx, ly = 0.62, 0.22
    for k in range(3):
        a = TAU * k / 3 + math.pi / 6
        p.tube((lx, ly, 0.4), (lx + 0.26 * math.cos(a), ly + 0.26 * math.sin(a), 0.015), 0.011, slate, verts=5)
    p.cyl(0.015, 1.3, (lx, ly, 0.02 + 0.65), slate, verts=8)
    mk = p.mark()
    p.box((0.34, 0.26, 0.2), (0, 0, 0.1), M('Slate'), taper=(0.45, 0.45))
    p.rbox((0.36, 0.28, 0.03), (0, 0, -0.005), M('Enamel'), r=0.012, seg=1)
    p.box((0.32, 0.24, 0.006), (0, 0, -0.022), M('Light'))
    p.xform_since(mk, loc=(lx, ly, 1.48), rot=(-70, 0, -25))
    # a coil of cable on the floor
    coil = [(0.25 + 0.1 * math.cos(i * 0.6), 0.3 + 0.08 * math.sin(i * 0.6), 0.012 + 0.0012 * i) for i in range(22)]
    p.sweep(coil, 0.01, rubber, verts=5)
    return p.finish()


MODELS = {
    'prop_puppy': dict(fn=prop_puppy, budget=90, preview_dir=(1.0, -1.1, 0.6)),
    'prop_balloons': dict(fn=prop_balloons, budget=90),
    'prop_jolly_roger': dict(fn=prop_jolly_roger, budget=90, preview_dir=(0.6, -1.4, 0.45)),
    'prop_rival_sign': dict(fn=prop_rival_sign, budget=90, preview_dir=(0.5, -1.4, 0.4)),
    'prop_red_carpet': dict(fn=prop_red_carpet, budget=90),
    'prop_generator': dict(fn=prop_generator, budget=90),
    'prop_camera_crew': dict(fn=prop_camera_crew, budget=90),
}
