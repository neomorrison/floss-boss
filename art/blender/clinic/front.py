# Front of house and office dressing: reception_desk, waiting_chair, plant_tall, plant_small, water_cooler,
# magazine_table, fish_tank, kids_corner, espresso_machine, kiosk, break_table, certificate, wall_tv,
# entrance_door, partition, tooth_sign, trash_bin, coat_rack.
# Blender space: front toward -Y, Z up, meters. build.py recenters each model on its footprint.
import math
import random
from mathutils import Vector
from lib import Part, M, material, tooth2d, rrect, ellipse, arc, star_base
from operatory import screen_panel, smile_content, glow, grin2d


def star2d(r_out, r_in, n=5, rot=90.0):
    pts = []
    for i in range(2 * n):
        a = math.radians(rot) + i * math.pi / n
        rr = r_out if i % 2 == 0 else r_in
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return pts


def face_on_plate(p, cx, y, cz, s, eye='Ink', mouth='Mouth', cheek='Cheek', t=0.02):
    """Eyes, cheeks and a grin on a flat surface facing -Y at depth y (s = scale, about the face width)."""
    for k in (-1, 1):
        p.plate(ellipse(0.07 * s, 0.1 * s, 12), t, (cx + k * 0.2 * s, y, cz + 0.08 * s), M(eye), axis='Y')
        p.plate(ellipse(0.025 * s, 0.03 * s, 8), t, (cx + k * 0.2 * s + 0.025 * s, y - t * 0.5, cz + 0.12 * s),
                M('Paper'), axis='Y')
        p.plate(ellipse(0.08 * s, 0.045 * s, 10), t, (cx + k * 0.36 * s, y + 0.002, cz - 0.07 * s), M(cheek),
                axis='Y')
    p.plate(grin2d(0.36 * s, 0.17 * s), t, (cx, y, cz - 0.07 * s), M(mouth), axis='Y')
    p.plate([(-0.13 * s, -0.005 * s), (0.13 * s, -0.005 * s), (0.12 * s, -0.06 * s), (-0.12 * s, -0.06 * s)][::-1],
            t, (cx, y - t * 0.5, cz - 0.07 * s), M('Enamel'), axis='Y')


def leaf(p, base, direction, length, width, m, droop=0.25, thick=0.012):
    """A long pointed leaf from `base` along `direction` (droops toward the tip). Built as a flattened sweep."""
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    n = 6
    pts, widths = [], []
    for i in range(n + 1):
        t = i / n
        pos = Vector(base) + d * length * t + Vector((0, 0, -droop * length * t * t))
        pts.append(pos)
        widths.append(width * math.sin(math.pi * min(0.98, 0.1 + t * 0.9)) + 0.004)
    # build as a lens-shaped strip: two rows of verts offset along `side`, thickened along the normal
    import bmesh
    tmp = bmesh.new()
    top_l, top_r, bot_l, bot_r = [], [], [], []
    for pos, w in zip(pts, widths):
        up = side.cross(d).normalized()
        top_l.append(tmp.verts.new(pos - side * w / 2 + up * thick))
        top_r.append(tmp.verts.new(pos + side * w / 2 + up * thick))
        bot_l.append(tmp.verts.new(pos - side * w / 2))
        bot_r.append(tmp.verts.new(pos + side * w / 2))
    mid_t = [tmp.verts.new(pos + (side.cross(d).normalized()) * thick * 2.2) for pos in pts]
    for i in range(n):
        tmp.faces.new([top_l[i], top_l[i + 1], mid_t[i + 1], mid_t[i]])
        tmp.faces.new([mid_t[i], mid_t[i + 1], top_r[i + 1], top_r[i]])
        tmp.faces.new([bot_l[i + 1], bot_l[i], bot_r[i], bot_r[i + 1]])
        tmp.faces.new([top_l[i + 1], top_l[i], bot_l[i], bot_l[i + 1]])
        tmp.faces.new([top_r[i], top_r[i + 1], bot_r[i + 1], bot_r[i]])
    tmp.faces.new([top_l[0], mid_t[0], top_r[0], bot_r[0], bot_l[0]])
    tmp.faces.new([bot_l[-1], bot_r[-1], top_r[-1], mid_t[-1], top_l[-1]])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    p._emit(tmp, m, False)


def pot(p, x, y, r, h, m, rim_m=None, soil=True, segs=18):
    prof = [(0.0, 0.0), (r * 0.72, 0.0), (r * 0.78, 0.02), (r * 0.95, h * 0.85), (r * 1.0, h * 0.86), (r * 1.0, h),
            (r * 0.9, h), (r * 0.88, h - 0.02), (0.0, h - 0.02)]
    p.lathe(prof, (x, y, 0), m, segs=segs)
    if rim_m:
        p.lathe([(r * 0.97, h * 0.84), (r * 1.03, h * 0.84), (r * 1.03, h * 1.0), (r * 0.97, h * 1.0)], (x, y, 0),
                rim_m, segs=segs)
    if soil:
        p.cyl(r * 0.9, 0.02, (x, y, h - 0.03), M('Soil'), verts=segs)


# ------------------------------------------------------------------ models

def reception_desk():
    """Front desk: raised transaction ledge toward the patients (-Y), work surface behind with a computer,
    a little bell, a toothbrush jar and a succulent. Tooth logo on the front panel."""
    p = Part('ReceptionDesk')
    w = 2.2
    white, mint, teal, wood = M('Enamel'), M('Mint'), M('Teal'), M('Wood')
    # front body
    p.bx(-w / 2 + 0.04, w / 2 - 0.04, -0.36, 0.0, 0.0, 0.08, teal)
    p.rbox((w, 0.4, 1.0), (0, -0.2, 0.08 + 0.46), white, r=0.03, seg=2)
    # mint front panel with the logo
    p.rbox((w - 0.2, 0.02, 0.62), (0, -0.405, 0.5), mint, r=0.03, seg=2)
    p.prism(tooth2d(0.34, 0.36), 0.03, white, axis='Y', center=-0.43, flat=True, loc=(0, 0, 0.52))
    face_on_plate(p, 0, -0.448, 0.54, 0.34, t=0.012)
    for x in (-0.62, 0.62):
        p.plate(star2d(0.07, 0.03), 0.02, (x, -0.42, 0.62), M('Sunshine'), axis='Y')
    # ledge
    p.rbox((w + 0.06, 0.48, 0.05), (0, -0.2, 1.08), wood, r=0.015, seg=2)
    # work surface behind, on two side panels
    for s in (-1, 1):
        p.rbox((0.05, 0.5, 0.74), (s * (w / 2 - 0.03), 0.25, 0.37), white, r=0.015, seg=2)
    p.rbox((w, 0.52, 0.04), (0, 0.24, 0.76), wood, r=0.012, seg=2)
    # computer (screen faces the receptionist, +Y) with keyboard and mouse
    mk = p.mark()
    screen_panel(p, 0.5, 0.32, 0.035, bezel='Slate', content=None)
    p.box((0.44, 0.004, 0.26), (0, -0.024, 0.0), glow('UiScreen', '#BDEFF2', 0.55))
    p.box((0.2, 0.004, 0.04), (-0.08, -0.028, 0.08), glow('UiMint', '#3DD6B5', 0.7))
    p.box((0.14, 0.004, 0.03), (-0.11, -0.028, 0.02), glow('UiBubblegum', '#FF7AA8', 0.7))
    p.xform_since(mk, loc=(0.35, 0.18, 1.02), rot=(0, 0, 180))
    p.cyl(0.03, 0.1, (0.35, 0.2, 0.83), M('Slate'), verts=10)
    p.rbox((0.2, 0.14, 0.015), (0.35, 0.2, 0.785), M('Slate'), r=0.006, seg=1)
    p.rbox((0.42, 0.14, 0.02), (0.35, 0.4, 0.79), M('Cream'), r=0.008, seg=1)
    p.sphere(0.03, (0.65, 0.4, 0.79), M('Cream'), seg=8, rings=5, scale=(0.8, 1.2, 0.5))
    # little bell on the ledge
    bx, by = -0.55, -0.3
    p.cyl(0.07, 0.02, (bx, by, 1.115), M('Teal'), verts=16, bevel=0.006)
    p.lathe([(0.0, 1.12), (0.06, 1.12), (0.058, 1.15), (0.04, 1.185), (0.0, 1.195)], (bx, by, 0), M('Sunshine'),
            segs=16)
    p.cyl(0.008, 0.03, (bx, by, 1.205), M('Chrome'), verts=6)
    p.sphere(0.014, (bx, by, 1.225), M('Chrome'), seg=8, rings=5)
    # toothbrush jar
    jx, jy = 0.62, -0.28
    p.lathe([(0.0, 1.105), (0.055, 1.105), (0.058, 1.24), (0.0, 1.24)], (jx, jy, 0), M('Glass'), segs=12)
    for k, mm in enumerate(('Bubblegum', 'Mint', 'Sunshine', 'Sky', 'Coral')):
        a = k * 2 * math.pi / 5
        x0, y0 = jx + 0.025 * math.cos(a), jy + 0.025 * math.sin(a)
        p.tube((x0, y0, 1.11), (x0 + 0.02 * math.cos(a), y0 + 0.02 * math.sin(a), 1.32), 0.007, M(mm), verts=5)
        p.rbox((0.012, 0.012, 0.03), (x0 + 0.02 * math.cos(a), y0 + 0.02 * math.sin(a), 1.335), M('Paper'), r=0.004,
               seg=1)
    # succulent in a tiny pot
    pot(p, 0.9, -0.22, 0.06, 0.08, M('Bubblegum'), soil=False, segs=12)
    for k in range(6):
        a = k * math.pi / 3
        p.sphere(0.03, (0.9 + 0.028 * math.cos(a), -0.22 + 0.028 * math.sin(a), 1.2), M('LeafA'), seg=8, rings=5,
                 scale=(1, 1, 0.8))
    p.sphere(0.03, (0.9, -0.22, 1.225), M('LeafC'), seg=8, rings=5)
    # card holder
    p.rbox((0.1, 0.05, 0.03), (-0.2, -0.32, 1.12), M('Steel'), r=0.006, seg=1)
    p.box((0.085, 0.01, 0.05), (-0.2, -0.32, 1.15), M('Paper'), rot=(-15, 0, 0))
    return p.finish()


def waiting_chair():
    """A cushy waiting-room armchair on wooden legs."""
    p = Part('WaitingChair')
    wood, cush = M('Wood'), material('Cushion', '#3DD6B5', 0.7, 0.0)
    white = M('Enamel')
    w, d = 0.64, 0.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - 0.07), sy * (d / 2 - 0.07)
            p.tube((x, y, 0.004), (x * 0.94, y * 0.94, 0.2), 0.022, wood, r2=0.028, verts=8)
    p.rbox((w, d, 0.1), (0, 0, 0.24), white, r=0.04, seg=2)
    p.rbox((w - 0.1, d - 0.08, 0.14), (0, -0.02, 0.36), cush, r=0.06, seg=3)
    # backrest, slightly reclined
    p.rbox((w, 0.14, 0.52), (0, d / 2 - 0.07, 0.52), white, r=0.06, seg=2, rot=(-8, 0, 0))
    p.rbox((w - 0.14, 0.12, 0.42), (0, d / 2 - 0.15, 0.58), cush, r=0.06, seg=3, rot=(-8, 0, 0))
    # armrests
    for s in (-1, 1):
        p.rbox((0.09, d, 0.3), (s * (w / 2 - 0.045), 0, 0.4), white, r=0.04, seg=2)
        p.rbox((0.1, d * 0.9, 0.035), (s * (w / 2 - 0.045), -0.01, 0.56), wood, r=0.015, seg=2)
    return p.finish()


def plant_tall():
    """Big leafy floor plant in a pot (bird-of-paradise style)."""
    p = Part('PlantTall')
    pot(p, 0, 0, 0.22, 0.44, M('Enamel'), rim_m=M('Mint'))
    rng = random.Random(7)
    mats = [M('LeafA'), M('LeafB'), M('LeafC')]
    n = 11
    for i in range(n):
        a = i * 2.39996 + rng.uniform(-0.2, 0.2)
        up = 0.9 + rng.uniform(-0.1, 0.35)
        out = 0.28 + (i / n) * 0.32
        stem_top = Vector((math.cos(a) * out * 0.35, math.sin(a) * out * 0.35, 0.44 + up * (0.55 + 0.45 * (i % 3) / 2)))
        p.tube((0, 0, 0.4), tuple(stem_top), 0.012, M('LeafB'), verts=5)
        d = Vector((math.cos(a) * out, math.sin(a) * out, 0.55 + rng.uniform(0, 0.3)))
        leaf(p, tuple(stem_top), tuple(d), 0.52 + rng.uniform(-0.05, 0.1), 0.2, mats[i % 3], droop=0.35)
    return p.finish()


def plant_small():
    """Small round bush in a bubblegum pot."""
    p = Part('PlantSmall')
    pot(p, 0, 0, 0.14, 0.24, M('Bubblegum'), rim_m=M('Enamel'))
    rng = random.Random(3)
    mats = [M('LeafA'), M('LeafB'), M('LeafC')]
    blobs = [(0, 0, 0.42, 0.15)] + [(0.1 * math.cos(a), 0.1 * math.sin(a), 0.35 + rng.uniform(0, 0.06), 0.1)
                                    for a in [k * 2 * math.pi / 5 for k in range(5)]]
    for k, (x, y, z, r) in enumerate(blobs):
        p.sphere(r, (x, y, z), mats[k % 3], ico=2)
    # a couple of tiny flowers
    for (x, y, z) in ((0.08, -0.1, 0.46), (-0.1, -0.06, 0.42), (0.02, 0.1, 0.52)):
        p.sphere(0.025, (x, y, z), M('Sunshine'), seg=8, rings=5)
    return p.finish()


def water_cooler():
    """Water cooler: cabinet with hot and cold taps, a big see-through bottle, a paper cup tube."""
    p = Part('WaterCooler')
    white = M('Enamel')
    p.rbox((0.34, 0.34, 0.98), (0, 0, 0.49), white, r=0.04, seg=2)
    p.rbox((0.26, 0.02, 0.28), (0, -0.172, 0.7), M('Slate'), r=0.03, seg=2)
    p.rbox((0.22, 0.1, 0.03), (0, -0.2, 0.58), M('Steel'), r=0.01, seg=1)
    for x, mm in ((-0.06, 'Bubblegum'), (0.06, 'Sky')):
        p.rbox((0.05, 0.05, 0.05), (x, -0.2, 0.8), M(mm), r=0.012, seg=2)
        p.cyl(0.01, 0.03, (x, -0.2, 0.765), M('Enamel'), verts=6)
    p.rbox((0.3, 0.3, 0.05), (0, 0, 1.0), M('Mint'), r=0.02, seg=2)
    # bottle
    prof = [(0.0, 1.02), (0.05, 1.02), (0.05, 1.06), (0.14, 1.1), (0.15, 1.2), (0.15, 1.42), (0.14, 1.47),
            (0.0, 1.49)]
    p.lathe(prof, (0, 0, 0), M('Water'), segs=18)
    for z in (1.22, 1.36):
        p.lathe([(0.0, z), (0.152, z), (0.152, z + 0.018), (0.0, z + 0.018)], (0, 0, 0), M('Sky'), segs=18)
    # cup tube on the side
    p.cyl(0.04, 0.3, (0.2, 0.0, 0.62), M('Glass'), verts=12)
    for k in range(6):
        p.lathe([(0.0, 0.48 + k * 0.045), (0.028, 0.48 + k * 0.045), (0.036, 0.52 + k * 0.045),
                 (0.0, 0.52 + k * 0.045)], (0.2, 0, 0), M('Paper'), segs=10)
    p.rbox((0.02, 0.06, 0.34), (0.175, 0, 0.62), white, r=0.008, seg=1)
    return p.finish()


def magazine_table():
    """Low round coffee table with a fan of magazines and a bud vase."""
    p = Part('MagazineTable')
    wood, white = M('Wood'), M('Enamel')
    p.cyl(0.4, 0.05, (0, 0, 0.42), wood, verts=28, bevel=0.015, seg=2)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        p.tube((0.26 * math.cos(a), 0.26 * math.sin(a), 0.004), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.4), 0.022,
               white, r2=0.026, verts=8)
    p.cyl(0.24, 0.02, (0, 0, 0.14), white, verts=20)
    covers = ['Bubblegum', 'Sunshine', 'Sky', 'Mint']
    for k, c in enumerate(covers):
        mk = p.mark()
        p.box((0.2, 0.27, 0.012), (0, 0, 0), M(c))
        p.box((0.16, 0.05, 0.004), (0, -0.07, 0.008), M('Paper'))
        p.box((0.1, 0.1, 0.004), (0.02, 0.05, 0.008), M('Paper'))
        p.xform_since(mk, loc=(-0.1 + k * 0.05, -0.08 + k * 0.02, 0.451 + k * 0.012), rot=(0, 0, -20 + k * 18))
    # vase with a flower
    p.lathe([(0.0, 0.445), (0.04, 0.445), (0.05, 0.5), (0.03, 0.56), (0.025, 0.58), (0.0, 0.58)], (0.2, 0.12, 0),
            M('Teal'), segs=12)
    p.tube((0.2, 0.12, 0.56), (0.21, 0.11, 0.72), 0.006, M('LeafB'), verts=5)
    for k in range(5):
        a = k * 2 * math.pi / 5
        p.sphere(0.022, (0.21 + 0.024 * math.cos(a), 0.11 + 0.024 * math.sin(a), 0.73), M('Bubblegum'), seg=8,
                 rings=5, scale=(1, 1, 0.6))
    p.sphere(0.016, (0.21, 0.11, 0.74), M('Sunshine'), seg=8, rings=5)
    return p.finish()


def fish(p_name, loc, color, scale=1.0, flip=False):
    """One cartoon fish as its own node (so the game can bob it). Faces -X, or +X with flip."""
    p = Part(p_name)
    s = scale
    x, y, z = loc
    d = 1 if flip else -1
    p.sphere(1.0, (x, y, z), M(color), seg=12, rings=8, scale=(0.07 * s, 0.03 * s, 0.05 * s))
    tail = [(0.0, 0.0), (-0.06 * s, 0.045 * s), (-0.05 * s, 0.0), (-0.06 * s, -0.045 * s)]
    p.plate([(-d * tx, tz) for (tx, tz) in tail], 0.012 * s, (x - d * 0.055 * s, y, z), M(color), axis='Y')
    p.plate([(0, 0), (0.05 * s, 0), (0.02 * s, 0.035 * s)], 0.01 * s, (x - 0.02 * s, y, z + 0.035 * s), M(color),
            axis='Y')
    for k in (-1, 1):
        p.sphere(0.011 * s, (x + d * 0.04 * s, y + k * 0.024 * s, z + 0.012 * s), M('Paper'), seg=8, rings=5)
        p.sphere(0.006 * s, (x + d * 0.045 * s, y + k * 0.031 * s, z + 0.013 * s), M('Ink'), seg=6, rings=4)
    return p.finish(origin=loc)


def fish_tank():
    """Aquarium on a teal stand: see-through water, gravel, seaweed, a tooth castle, bubbles and three fish
    (separate nodes Fish1..Fish3)."""
    p = Part('FishTank')
    w, d = 1.1, 0.42
    teal, white, mint = M('Teal'), M('Enamel'), M('Mint')
    # stand
    p.rbox((w, d, 0.72), (0, 0, 0.36), teal, r=0.02, seg=2)
    for s in (-1, 1):
        p.rbox((w / 2 - 0.06, 0.02, 0.56), (s * w / 4, -d / 2 - 0.004, 0.38), M('TealDark'), r=0.012, seg=2)
        p.sphere(0.018, (s * 0.06, -d / 2 - 0.02, 0.45), M('Chrome'), seg=8, rings=5)
    zb, zt = 0.72, 1.3
    # frame: bottom tray and lid
    p.rbox((w + 0.02, d + 0.02, 0.05), (0, 0, zb + 0.025), white, r=0.015, seg=2)
    p.rbox((w + 0.03, d + 0.03, 0.06), (0, 0, zt + 0.03), white, r=0.02, seg=2)
    p.box((w * 0.7, 0.02, 0.012), (0, -d / 2 - 0.006, zt + 0.02), glow('LampGlow', '#DDF7FF', 1.0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.02, 0.02, zt - zb), (sx * (w / 2 - 0.005), sy * (d / 2 - 0.005), (zb + zt) / 2), white)
    # water volume (the only see-through part, so sorting stays simple)
    p.box((w - 0.03, d - 0.03, zt - zb - 0.08), (0, 0, zb + 0.05 + (zt - zb - 0.08) / 2), M('Water'))
    # gravel bed
    rng = random.Random(11)
    p.box((w - 0.04, d - 0.04, 0.03), (0, 0, zb + 0.065), M('Cream'))
    for k in range(26):
        x = rng.uniform(-w / 2 + 0.05, w / 2 - 0.05)
        y = rng.uniform(-d / 2 + 0.05, d / 2 - 0.05)
        p.sphere(0.022, (x, y, zb + 0.08), M(('Sunshine', 'Coral', 'Cream', 'Blush')[k % 4]), seg=6, rings=4,
                 scale=(1.2, 1, 0.6))
    # seaweed
    for (x, y, h, mm) in ((-0.42, 0.08, 0.36, 'LeafB'), (-0.34, 0.1, 0.28, 'LeafA'), (0.4, 0.06, 0.4, 'LeafA'),
                          (0.3, 0.1, 0.24, 'LeafC'), (0.46, -0.05, 0.3, 'LeafB')):
        pts = [(x + 0.025 * math.sin(i * 1.4), y, zb + 0.08 + h * i / 6) for i in range(7)]
        p.sweep(pts, 0.016, M(mm), verts=5, rscale=(1.6, 0.5))
    # tooth castle
    p.prism(tooth2d(0.2, 0.22), 0.1, M('Enamel'), axis='Y', center=0.05, bevel=0.015, seg=1, flat=False,
            loc=(-0.1, 0, zb + 0.19))
    p.plate(rrect(0.05, 0.06, 0.02), 0.02, (-0.1, -0.005, zb + 0.13), M('Slate'), axis='Y')
    # bubbles
    for k in range(6):
        p.sphere(0.012 + 0.004 * (k % 2), (0.16 + 0.01 * math.sin(k), -0.02, zb + 0.18 + k * 0.06), M('Paper'), seg=8,
                 rings=5)
    p.finish()
    fish('Fish1', (0.18, -0.06, zb + 0.34), 'Coral', 1.0)
    fish('Fish2', (-0.28, 0.02, zb + 0.44), 'Sunshine', 0.85, flip=True)
    fish('Fish3', (0.36, 0.05, zb + 0.24), 'Bubblegum', 0.75, flip=True)


def toy_tooth(p, x, y, s, m):
    """A plush cartoon tooth sitting on the floor."""
    p.sphere(1.0, (x, y, 0.2 * s), m, seg=16, rings=10, scale=(0.19 * s, 0.14 * s, 0.17 * s))
    for k in (-1, 1):
        p.sphere(1.0, (x + k * 0.08 * s, y, 0.3 * s), m, seg=12, rings=8, scale=(0.1 * s, 0.12 * s, 0.1 * s))
        p.capsule((x + k * 0.075 * s, y, 0.14 * s), (x + k * 0.1 * s, y, 0.058 * s), 0.055 * s, m, verts=10)
    fy = y - 0.135 * s
    for k in (-1, 1):
        p.sphere(0.022 * s, (x + k * 0.06 * s, fy + 0.005, 0.24 * s), M('Ink'), seg=8, rings=6,
                 scale=(0.8, 0.5, 1.2))
        p.sphere(0.025 * s, (x + k * 0.12 * s, fy + 0.02, 0.19 * s), M('Cheek'), seg=8, rings=5,
                 scale=(1.2, 0.4, 0.8))
    p.plate(grin2d(0.08 * s, 0.04 * s), 0.02 * s, (x, fy + 0.01 * s, 0.19 * s), M('Mouth'), axis='Y')


def kids_corner():
    """Round play rug with toy blocks, a ball, a toy box and a big plush tooth."""
    p = Part('KidsCorner')
    rings = [(0.9, 'Sky'), (0.72, 'Sunshine'), (0.52, 'Bubblegum'), (0.3, 'MintLight')]
    for k, (r, mm) in enumerate(rings):
        p.cyl(r, 0.012, (0, 0, 0.006 + k * 0.004), M(mm), verts=32 if r > 0.5 else 24)
    # blocks
    blocks = [((-0.35, -0.25, 0.08), 'Bubblegum', 12), ((-0.2, -0.3, 0.08), 'Sunshine', -8),
              ((-0.28, -0.27, 0.23), 'Mint', 20), ((0.3, -0.35, 0.08), 'Sky', 35), ((0.45, -0.15, 0.08), 'Coral', 5),
              ((0.38, -0.25, 0.23), 'Lilac', -15)]
    for (loc, mm, rz) in blocks:
        p.rbox((0.14, 0.14, 0.14), (loc[0], loc[1], loc[2] + 0.01), M(mm), r=0.02, seg=2, rot=(0, 0, rz))
    # ball
    p.sphere(0.12, (0.5, 0.25, 0.14), M('Coral'), seg=16, rings=10)
    p.torus(0.12, 0.012, (0.5, 0.25, 0.14), M('Paper'), segs=20, verts=5, rot=(70, 0, 20))
    # toy box
    p.rbox((0.5, 0.3, 0.3), (-0.4, 0.45, 0.16), M('Sunshine'), r=0.03, seg=2)
    p.rbox((0.53, 0.33, 0.05), (-0.4, 0.45, 0.33), M('Coral'), r=0.02, seg=2)
    p.plate(star2d(0.07, 0.03), 0.02, (-0.4, 0.29, 0.16), M('Paper'), axis='Y')
    # plush toy tooth
    toy_tooth(p, 0.1, 0.25, 1.4, M('Enamel'))
    return p.finish()


def espresso_machine():
    """Coffee station: a little cabinet with a retro espresso machine, cups and a sugar jar."""
    p = Part('EspressoMachine')
    w, d, h = 0.8, 0.5, 0.86
    white, wood, chrome, pink = M('Enamel'), M('Wood'), M('Chrome'), M('Bubblegum')
    p.bx(-w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.05, d / 2, 0, 0.08, M('Teal'))
    p.rbox((w, d, h - 0.1), (0, 0, 0.08 + (h - 0.1) / 2), white, r=0.015, seg=2)
    for s in (-1, 1):
        p.rbox((w / 2 - 0.04, 0.02, h - 0.2), (s * w / 4, -d / 2 - 0.004, 0.08 + (h - 0.1) / 2), M('Mint'), r=0.012,
               seg=2)
        p.sphere(0.018, (s * 0.05, -d / 2 - 0.02, 0.62), chrome, seg=8, rings=5)
    p.rbox((w + 0.03, d + 0.03, 0.04), (0, 0, h), wood, r=0.012, seg=2)
    # machine body
    mx = -0.08
    top = h + 0.02
    p.rbox((0.4, 0.34, 0.36), (mx, 0.02, top + 0.18), pink, r=0.07, seg=3)
    p.rbox((0.42, 0.36, 0.03), (mx, 0.02, top + 0.37), chrome, r=0.012, seg=2)
    # gauge
    p.cyl(0.05, 0.02, (mx + 0.1, -0.155, top + 0.26), chrome, axis='Y', verts=16)
    p.cyl(0.04, 0.02, (mx + 0.1, -0.162, top + 0.26), M('Paper'), axis='Y', verts=16)
    p.box((0.004, 0.004, 0.03), (mx + 0.1, -0.174, top + 0.27), M('Ink'), rot=(0, 30, 0))
    # group head, portafilter, drip tray
    p.cyl(0.045, 0.05, (mx - 0.05, -0.17, top + 0.2), chrome, verts=14)
    p.cyl(0.04, 0.03, (mx - 0.05, -0.17, top + 0.16), chrome, verts=14)
    p.tube((mx - 0.05, -0.2, top + 0.16), (mx - 0.05, -0.32, top + 0.15), 0.014, M('WoodDark'), verts=8)
    p.rbox((0.22, 0.14, 0.03), (mx - 0.05, -0.2, top + 0.02), M('Steel'), r=0.01, seg=1)
    # cup under the spout
    p.lathe([(0.0, top + 0.035), (0.03, top + 0.035), (0.038, top + 0.1), (0.0, top + 0.1)], (mx - 0.05, -0.19, 0),
            white, segs=12)
    p.cyl(0.032, 0.004, (mx - 0.05, -0.19, top + 0.098), M('Coffee'), verts=12)
    # steam wand
    p.sweep([(mx + 0.2, -0.05, top + 0.28), (mx + 0.24, -0.08, top + 0.26), (mx + 0.24, -0.1, top + 0.12)], 0.009,
            chrome, verts=6)
    # cups stacked on top
    for k in range(3):
        p.lathe([(0.0, top + 0.385 + k * 0.05), (0.028, top + 0.385 + k * 0.05), (0.034, top + 0.43 + k * 0.05),
                 (0.0, top + 0.43 + k * 0.05)], (mx + (k - 1) * 0.1, 0.05, 0), white, segs=10)
    # sugar jar and a little plate of biscuits
    p.lathe([(0.0, top), (0.05, top), (0.055, top + 0.12), (0.0, top + 0.12)], (0.26, 0.05, 0), M('Glass'), segs=12)
    p.cyl(0.056, 0.02, (0.26, 0.05, top + 0.13), M('Sunshine'), verts=12)
    p.cyl(0.08, 0.01, (0.24, -0.14, top + 0.005), white, verts=16)
    for k in range(3):
        p.cyl(0.025, 0.012, (0.22 + 0.03 * k, -0.14 + 0.01 * (k % 2), top + 0.017), M('WoodDark'), verts=10)
    return p.finish()


def kiosk():
    """Check-in kiosk: slim pedestal, tilted touch screen, card slot and a tooth logo."""
    p = Part('Kiosk')
    white, mint = M('Enamel'), M('Mint')
    p.rbox((0.5, 0.42, 0.05), (0, 0.02, 0.025), white, r=0.02, seg=2)
    p.box((0.26, 0.2, 1.0), (0, 0.04, 0.05 + 0.5), mint, bevel=0.05, seg=3, flat=False, taper=(0.85, 1.0))
    p.plate(tooth2d(0.14, 0.15), 0.02, (0, -0.07, 0.62), white, axis='Y')
    # head with the tilted screen
    mk = p.mark()
    p.rbox((0.5, 0.1, 0.38), (0, 0.02, 0), white, r=0.04, seg=2)
    p.box((0.44, 0.006, 0.32), (0, -0.032, 0), M('Screen'))
    p.box((0.4, 0.004, 0.28), (0, -0.036, 0), glow('UiScreen', '#BDEFF2', 0.6))
    p.plate(tooth2d(0.12, 0.13), 0.004, (0, -0.04, 0.04), glow('UiMint', '#3DD6B5', 0.7), axis='Y')
    for k, mm in enumerate(('UiBubblegum', 'UiSunshine')):
        col = '#FF7AA8' if k == 0 else '#FFD166'
        p.box((0.14, 0.004, 0.04), (-0.08 + k * 0.16, -0.04, -0.08), glow(mm, col, 0.7))
    p.xform_since(mk, loc=(0, 0.0, 1.2), rot=(-30, 0, 0))
    # card reader ledge
    p.rbox((0.2, 0.1, 0.05), (0, -0.1, 0.98), white, r=0.015, seg=2, rot=(-10, 0, 0))
    p.box((0.12, 0.01, 0.008), (0, -0.152, 0.99), M('Slate'), rot=(-10, 0, 0))
    return p.finish()


def cafe_chair(p, x, y, facing, seat_m):
    """Simple cafe chair at (x, y) whose seat faces `facing` degrees (0 = toward -Y)."""
    mk = p.mark()
    wood = M('Wood')
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.tube((sx * 0.16, sy * 0.16, 0.003), (sx * 0.15, sy * 0.15, 0.44), 0.017, wood, verts=6)
    p.rbox((0.42, 0.42, 0.06), (0, 0, 0.46), seat_m, r=0.025, seg=2)
    p.tube((-0.15, 0.17, 0.46), (-0.15, 0.19, 0.84), 0.017, wood, verts=6)
    p.tube((0.15, 0.17, 0.46), (0.15, 0.19, 0.84), 0.017, wood, verts=6)
    p.rbox((0.4, 0.05, 0.16), (0, 0.19, 0.8), seat_m, r=0.02, seg=2)
    p.xform_since(mk, loc=(x, y, 0), rot=(0, 0, facing))


def break_table():
    """Staff break table: round table, three cafe chairs, a box of donuts and two mugs."""
    p = Part('BreakTable')
    wood, white = M('Wood'), M('Enamel')
    p.cyl(0.45, 0.04, (0, 0, 0.74), wood, verts=28, bevel=0.012, seg=2)
    p.cyl(0.05, 0.7, (0, 0, 0.37), white, verts=12)
    p.cyl(0.25, 0.04, (0, 0, 0.02), white, verts=20, bevel=0.012, seg=1)
    for k, mm in enumerate(('Mint', 'Sunshine', 'Bubblegum')):
        a = math.radians(-90 + k * 120)
        r = 0.66
        cafe_chair(p, r * math.cos(a), r * math.sin(a), math.degrees(a) + 90 + 180, M(mm))
    # donut box
    mk = p.mark()
    p.rbox((0.34, 0.24, 0.05), (0, 0, 0.025), M('Paper'), r=0.01, seg=1)
    for i in range(3):
        for j in range(2):
            x, y = -0.1 + i * 0.1, -0.05 + j * 0.1
            p.torus(0.03, 0.017, (x, y, 0.062), M('Wood'), segs=12, verts=6)
            p.torus(0.03, 0.013, (x, y, 0.07), M(('Bubblegum', 'Sunshine', 'Coffee')[(i + j) % 3]), segs=12, verts=5)
    p.xform_since(mk, loc=(-0.06, 0.02, 0.76), rot=(0, 0, 15))
    for (x, y, mm) in ((0.26, -0.12, 'Teal'), (0.2, 0.2, 'Coral')):
        p.lathe([(0.0, 0.76), (0.038, 0.76), (0.04, 0.86), (0.0, 0.86)], (x, y, 0), M(mm), segs=12)
        p.torus(0.025, 0.007, (x + 0.045, y, 0.81), M(mm), segs=10, verts=4, rot=(90, 0, 0))
    return p.finish()


def certificate():
    """Framed certificate for the wall (hangs about 1.5 m up, front toward -Y)."""
    p = Part('Certificate')
    zc = 1.55
    gold, paper = M('Gold'), material('Parchment', '#FFF6E0', 0.8, 0.0)
    fw, fh = 0.52, 0.4
    p.plate(rrect(fw, fh, 0.015, 2), 0.035, (0, 0, zc), M('WoodDark'), axis='Y', bevel=0.01, seg=1)
    p.plate(rrect(fw - 0.04, fh - 0.04, 0.01, 2), 0.035, (0, -0.004, zc), gold, axis='Y')
    p.plate(rrect(fw - 0.07, fh - 0.07, 0.005, 1), 0.035, (0, -0.008, zc), paper, axis='Y')
    ink = M('Ink')
    # tooth crest, title bar, text lines, signature and a gold seal with ribbons
    p.plate(tooth2d(0.06, 0.06), 0.004, (0, -0.027, zc + 0.11), M('Teal'), axis='Y')
    p.box((0.26, 0.004, 0.022), (0, -0.027, zc + 0.055), M('Teal'))
    for k, wl in enumerate((0.34, 0.3, 0.32)):
        p.box((wl, 0.004, 0.008), (0, -0.027, zc + 0.01 - k * 0.03), ink)
    p.sweep([(0.04, -0.028, zc - 0.12), (0.07, -0.028, zc - 0.1), (0.1, -0.028, zc - 0.125), (0.14, -0.028, zc - 0.1)],
            0.004, ink, verts=4)
    p.plate([(-0.03, 0.0), (-0.05, -0.08), (-0.035, -0.07), (-0.02, -0.08), (-0.005, 0.0)], 0.004,
            (-0.12, -0.03, zc - 0.07), M('Bubblegum'), axis='Y')
    p.plate([(0.005, 0.0), (0.02, -0.08), (0.035, -0.07), (0.05, -0.08), (0.03, 0.0)], 0.004,
            (-0.12, -0.03, zc - 0.07), M('Bubblegum'), axis='Y')
    p.plate(star2d(0.05, 0.04, 12), 0.006, (-0.12, -0.032, zc - 0.08), gold, axis='Y')
    # hanging wire and nail
    p.sweep([(-0.15, 0.0, zc + fh / 2 - 0.02), (0.0, 0.0, zc + fh / 2 + 0.09), (0.15, 0.0, zc + fh / 2 - 0.02)],
            0.003, M('Steel'), verts=4)
    p.sphere(0.012, (0, -0.005, zc + fh / 2 + 0.09), M('Steel'), seg=8, rings=5)
    return p.finish()


def wall_tv():
    """Wall-mounted TV (about 1.7 m up) playing the tooth mascot show."""
    p = Part('WallTv')
    zc = 1.75
    p.rbox((0.36, 0.05, 0.26), (0, 0.035, zc), M('Slate'), r=0.015, seg=1)
    mk = p.mark()
    screen_panel(p, 1.1, 0.64, 0.05, bezel='Slate', content=smile_content, r=0.02)
    p.xform_since(mk, loc=(0, -0.02, zc))
    # soundbar under it
    p.rbox((0.7, 0.07, 0.06), (0, -0.01, zc - 0.4), M('Slate'), r=0.025, seg=2)
    p.sphere(0.008, (0.3, -0.046, zc - 0.4), glow('UiMint', '#3DD6B5', 0.9), seg=6, rings=4)
    return p.finish()


def entrance_door():
    """Glass entrance door in a teal frame, with a push bar, a tooth decal, a bell and a door mat."""
    p = Part('EntranceDoor')
    teal, white, chrome = M('Teal'), M('Enamel'), M('Chrome')
    W, H, D = 1.3, 2.35, 0.14
    # outer frame
    p.bx(-W / 2, -W / 2 + 0.1, -D / 2, D / 2, 0, H, teal)
    p.bx(W / 2 - 0.1, W / 2, -D / 2, D / 2, 0, H, teal)
    p.bx(-W / 2, W / 2, -D / 2, D / 2, H - 0.12, H, teal)
    p.bx(-W / 2 + 0.1, W / 2 - 0.1, -D / 2 + 0.02, D / 2 - 0.02, 0.0, 0.02, M('Slate'))
    # door leaf frame
    lw, lh = W - 0.24, H - 0.16
    x0, x1, z0, z1 = -lw / 2, lw / 2, 0.02, 0.02 + lh
    p.bx(x0, x0 + 0.07, -0.03, 0.03, z0, z1, white)
    p.bx(x1 - 0.07, x1, -0.03, 0.03, z0, z1, white)
    p.bx(x0, x1, -0.03, 0.03, z1 - 0.07, z1, white)
    p.bx(x0, x1, -0.03, 0.03, z0, z0 + 0.16, white)
    # glass
    p.bx(x0 + 0.07, x1 - 0.07, -0.01, 0.01, z0 + 0.16, z1 - 0.07, M('Glass'))
    # tooth decal and the hours stripe on the glass
    p.plate(tooth2d(0.3, 0.32), 0.006, (0, -0.014, 1.5), M('Paper'), axis='Y')
    p.plate(grin2d(0.1, 0.05), 0.004, (0, -0.018, 1.48), M('Mint'), axis='Y')
    p.box((lw - 0.2, 0.006, 0.05), (0, -0.014, 1.2), M('Mint'))
    # push bar and pull handle
    p.tube((x0 + 0.12, -0.08, 1.0), (x1 - 0.12, -0.08, 1.0), 0.02, chrome, verts=10)
    for x in (x0 + 0.14, x1 - 0.14):
        p.tube((x, -0.03, 1.0), (x, -0.08, 1.0), 0.015, chrome, verts=8)
    p.tube((x1 - 0.12, 0.08, 0.85), (x1 - 0.12, 0.08, 1.2), 0.016, chrome, verts=8)
    # little bell above the door and the mat in front
    p.lathe([(0.0, H - 0.05), (0.05, H - 0.2), (0.055, H - 0.22), (0.0, H - 0.22)], (0.3, -0.12, 0), M('Sunshine'),
            segs=12)
    p.tube((0.3, -0.12, H - 0.05), (0.3, -0.07, H - 0.05), 0.008, M('Gold'), verts=5)
    p.rbox((1.0, 0.6, 0.02), (0, -0.42, 0.01), M('Mint'), r=0.008, seg=1)
    p.rbox((0.8, 0.44, 0.024), (0, -0.42, 0.012), M('MintLight'), r=0.008, seg=1)
    return p.finish()


def partition():
    """Half-wall partition between operatories, exactly 2.0 m long (tiles end to end along X)."""
    p = Part('Partition')
    L, T, H = 2.0, 0.12, 1.2
    p.bx(-L / 2, L / 2, -T / 2, T / 2, 0.1, H - 0.05, M('Enamel'))
    p.bx(-L / 2, L / 2, -T / 2 - 0.006, T / 2 + 0.006, 0.0, 0.1, M('Teal'))
    p.rbox((L, T + 0.04, 0.06), (0, 0, H - 0.03), M('Mint'), r=0.025, seg=2)
    # a friendly stripe
    for s in (-1, 1):
        p.bx(-L / 2, L / 2, s * (T / 2) - 0.003, s * (T / 2) + 0.003, 0.72, 0.76, M('MintLight'))
    return p.finish()


def tooth_sign():
    """Big smiling tooth sign on a post, with a sparkle."""
    p = Part('ToothSign')
    white, teal, mint = M('Enamel'), M('Teal'), M('Mint')
    p.cyl(0.32, 0.12, (0, 0, 0.06), white, verts=24, bevel=0.03, seg=2)
    p.cyl(0.28, 0.03, (0, 0, 0.13), mint, verts=24)
    p.cyl(0.05, 1.3, (0, 0, 0.12 + 0.65), teal, verts=12)
    zc = 1.72
    p.prism(tooth2d(0.95, 0.95, n=6), 0.2, white, axis='Y', center=0.0, bevel=0.05, seg=3, flat=False,
            loc=(0, 0, zc))
    face_on_plate(p, 0.0, -0.105, zc + 0.08, 0.9, t=0.02)
    # sparkle
    p.plate(star2d(0.13, 0.04, 4, 90), 0.04, (0.42, -0.02, zc + 0.46), M('Sunshine'), axis='Y')
    p.plate(star2d(0.07, 0.022, 4, 90), 0.04, (0.56, -0.02, zc + 0.3), M('Sunshine'), axis='Y')
    return p.finish()


def trash_bin():
    """Pedal bin with a domed lid."""
    p = Part('TrashBin')
    prof = [(0.0, 0.0), (0.13, 0.0), (0.135, 0.02), (0.16, 0.42), (0.0, 0.42)]
    p.lathe(prof, (0, 0, 0), M('Mint'), segs=20)
    p.lathe([(0.0, 0.42), (0.168, 0.42), (0.17, 0.44), (0.12, 0.49), (0.0, 0.5)], (0, 0, 0), M('Enamel'), segs=20)
    p.rbox((0.1, 0.1, 0.03), (0, -0.16, 0.02), M('Slate'), r=0.012, seg=2)
    p.lathe([(0.0, 0.3), (0.162, 0.3), (0.162, 0.33), (0.0, 0.33)], (0, 0, 0), M('MintLight'), segs=20)
    return p.finish()


def coat_rack():
    """Standing coat rack with a coat, a hat and a scarf."""
    p = Part('CoatRack')
    wood, dark = M('Wood'), M('WoodDark')
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 2
        p.tube((0, 0, 0.18), (0.26 * math.cos(a), 0.26 * math.sin(a), 0.03), 0.025, dark, verts=8)
        p.sphere(0.03, (0.26 * math.cos(a), 0.26 * math.sin(a), 0.03), dark, seg=8, rings=5)
    p.cyl(0.028, 1.75, (0, 0, 0.875), wood, verts=10)
    p.sphere(0.05, (0, 0, 1.77), dark, seg=12, rings=8)
    hooks = []
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        hx, hy = 0.14 * math.cos(a), 0.14 * math.sin(a)
        p.sweep([(0, 0, 1.6), (hx * 0.6, hy * 0.6, 1.62), (hx, hy, 1.7)], 0.014, dark, verts=6)
        p.sphere(0.024, (hx, hy, 1.7), wood, seg=8, rings=5)
        hooks.append((hx, hy))
    # coat hanging from the front hook
    hx, hy = hooks[3]
    coat = M('Coral')
    p.lathe([(0.0, 0.85), (0.16, 0.85), (0.17, 0.95), (0.15, 1.3), (0.12, 1.5), (0.05, 1.64), (0.0, 1.66)],
            (hx * 1.3, hy * 1.3 - 0.04, 0), coat, segs=14, scale=(1.0, 0.55, 1.0))
    for s in (-1, 1):
        p.capsule((hx * 1.3 + s * 0.12, hy * 1.3 - 0.04, 1.45), (hx * 1.3 + s * 0.16, hy * 1.3 - 0.04, 1.0), 0.045,
                  coat, verts=8)
    p.box((0.004, 0.02, 0.5), (hx * 1.3, hy * 1.3 - 0.13, 1.2), M('TealDark'))
    # hat on the back hook
    hx, hy = hooks[1]
    p.lathe([(0.0, 1.7), (0.16, 1.7), (0.16, 1.715), (0.09, 1.72), (0.085, 1.82), (0.0, 1.83)], (hx, hy, 0),
            M('Sunshine'), segs=16)
    p.lathe([(0.087, 1.73), (0.092, 1.73), (0.092, 1.76), (0.087, 1.76)], (hx, hy, 0), M('Bubblegum'), segs=16)
    # scarf draped over the side hook
    hx, hy = hooks[0]
    p.sweep([(hx + 0.04, hy - 0.06, 1.3), (hx + 0.03, hy - 0.04, 1.6), (hx, hy, 1.73), (hx - 0.03, hy + 0.04, 1.6),
             (hx - 0.04, hy + 0.06, 1.35)], 0.03, M('Mint'), verts=8, rscale=(1.6, 0.5))
    return p.finish()


MODELS = {
    'reception_desk': dict(fn=reception_desk, budget=150),
    'waiting_chair': dict(fn=waiting_chair, budget=150),
    'plant_tall': dict(fn=plant_tall, budget=150),
    'plant_small': dict(fn=plant_small, budget=150),
    'water_cooler': dict(fn=water_cooler, budget=150),
    'magazine_table': dict(fn=magazine_table, budget=150),
    'fish_tank': dict(fn=fish_tank, budget=150),
    'kids_corner': dict(fn=kids_corner, budget=150),
    'espresso_machine': dict(fn=espresso_machine, budget=150),
    'kiosk': dict(fn=kiosk, budget=150),
    'break_table': dict(fn=break_table, budget=150),
    'certificate': dict(fn=certificate, budget=150, preview_dir=(0.55, -1.4, 0.35)),
    'wall_tv': dict(fn=wall_tv, budget=150, preview_dir=(0.6, -1.4, 0.3)),
    'entrance_door': dict(fn=entrance_door, budget=150, preview_dir=(0.8, -1.4, 0.5)),
    'partition': dict(fn=partition, budget=150),
    'tooth_sign': dict(fn=tooth_sign, budget=150, preview_dir=(0.6, -1.4, 0.4)),
    'trash_bin': dict(fn=trash_bin, budget=150),
    'coat_rack': dict(fn=coat_rack, budget=150),
}
