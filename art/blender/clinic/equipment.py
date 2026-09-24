# v3 equipment and operatory upgrades (docs/DESIGN.md 10.5): water_filter, aroma_diffuser, loyalty_board,
# staff_lockers, digital_xray, sound_panel, patient_tablet, nitrous_tank, laser_whitening, spa_lounge,
# cadcam_mill, rooftop_planter, smile_studio, research_desk, helipad_sign, ai_screen, ergo_stool.
# Blender space: front toward -Y, Z up, meters. build.py recenters each model on its footprint.
# Wall-mounted pieces (water_filter's filter bank, digital_xray, sound_panel, ai_screen) are authored at their
# mounting height with the wall side toward +Y, so the clinic view does not lift them again.
import math
import random
from mathutils import Vector
from lib import Part, M, material, star_base, caster, tooth2d, rrect, ellipse, arc
from operatory import glow, screen_panel, xray_content, grin2d
from front import star2d, pot, leaf

TAU = 2 * math.pi


def drop2d(r, n=10):
    """A water drop (round bottom, point on top), counterclockwise, centered on the round part."""
    pts = [(r * math.cos(math.radians(a)), r * math.sin(math.radians(a))) for a in
           [150 + 240 * i / n for i in range(n + 1)]]
    return pts + [(0.0, r * 2.0)]


def hexagon(r):
    return [(r * math.cos(math.radians(60 * k)), r * math.sin(math.radians(60 * k))) for k in range(6)]


def tripod(p, x, y, top, spread, m, r=0.014):
    """Three splayed legs meeting at (x, y, top), feet on the floor `spread` out, with little rubber feet."""
    for k in range(3):
        a = TAU * k / 3 + math.pi / 2
        fx, fy = x + spread * math.cos(a), y + spread * math.sin(a)
        p.tube((x, y, top), (fx, fy, 0.012), r, m, verts=6)
        p.sphere(r * 1.6, (fx, fy, r * 1.6), M('Rubber'), seg=6, rings=4)


# ------------------------------------------------------------------ small office equipment

def water_filter():
    """Wall-mounted three-stage filter (clear housings showing white, slate and mint cartridges) with a gauge,
    piped down to a blue pressure tank standing on the floor."""
    p = Part('WaterFilter')
    white, mint, chrome = M('Enamel'), M('Mint'), M('Chrome')
    wy = 0.13                                   # the wall is just behind this
    p.rbox((0.8, 0.03, 0.56), (0, wy, 1.3), white, r=0.02, seg=2)
    p.rbox((0.8, 0.036, 0.05), (0, wy - 0.003, 1.56), mint, r=0.012, seg=1)
    p.rbox((0.58, 0.1, 0.08), (-0.05, 0.07, 1.47), white, r=0.025, seg=2)       # manifold
    housing = material('FilterGlass', '#A8DDF7', 0.08, 0.0, alpha=0.45)
    carts = ('Paper', 'Slate', 'MintLight')
    for i, x in enumerate((-0.23, -0.05, 0.13)):
        p.cyl(0.066, 0.055, (x, 0.06, 1.405), M('Sky'), verts=16, bevel=0.012, seg=1)
        p.lathe([(0.0, 1.06), (0.042, 1.06), (0.058, 1.09), (0.06, 1.38), (0.0, 1.38)], (x, 0.06, 0), housing,
                segs=16)
        p.cyl(0.036, 0.25, (x, 0.06, 1.225), M(carts[i]), verts=12)
        p.cyl(0.014, 0.03, (x, 0.06, 1.05), M('Sky'), verts=8)
    # pressure gauge and a status light on the right of the board
    gx = 0.3
    p.cyl(0.055, 0.03, (gx, wy - 0.03, 1.36), chrome, axis='Y', verts=18, bevel=0.008)
    p.cyl(0.045, 0.03, (gx, wy - 0.038, 1.36), M('Paper'), axis='Y', verts=18)
    p.box((0.006, 0.004, 0.04), (gx + 0.01, wy - 0.055, 1.37), M('Ink'), rot=(0, -35, 0))
    p.sphere(0.018, (gx, wy - 0.03, 1.2), glow('UiMint', '#3DD6B5', 0.8), seg=8, rings=5)
    p.plate(drop2d(0.035), 0.012, (gx, wy - 0.02, 1.1), M('Sky'), axis='Y')
    # blue pressure tank on the floor
    tx, ty = 0.1, 0.0
    p.cyl(0.11, 0.04, (tx, ty, 0.02), M('Slate'), verts=18, bevel=0.01)
    tank = material('TankBlue', '#3F9FE0', 0.4, 0.0)
    p.lathe([(0.0, 0.04), (0.1, 0.04), (0.135, 0.08), (0.145, 0.14), (0.145, 0.52), (0.13, 0.6), (0.08, 0.65),
             (0.0, 0.665)], (tx, ty, 0), tank, segs=22)
    p.lathe([(0.0, 0.3), (0.148, 0.3), (0.148, 0.4), (0.0, 0.4)], (tx, ty, 0), white, segs=22)
    p.plate(drop2d(0.03), 0.012, (tx, ty - 0.15, 0.335), M('Sky'), axis='Y')
    p.cyl(0.022, 0.05, (tx, ty, 0.685), chrome, verts=10)
    # pipes: cold feed from the wall into the manifold, filtered line down to the tank
    p.sweep([(-0.36, wy - 0.02, 0.9), (-0.36, 0.07, 0.95), (-0.36, 0.07, 1.47), (-0.34, 0.07, 1.47)], 0.014,
            M('Sky'), verts=8)
    p.sweep([(0.24, 0.07, 1.47), (0.26, 0.07, 1.47), (0.26, 0.06, 0.95), (0.18, 0.03, 0.78), (tx, ty, 0.72),
             (tx, ty, 0.7)], 0.014, white, verts=8)
    return p.finish()


def aroma_diffuser():
    """A cream ceramic diffuser with a mint band and a glowing base ring, puffing a curl of mint mist, on a little
    round wooden side table with a bottle of oil and a sprig of mint."""
    p = Part('AromaDiffuser')
    wood, dark, white = M('Wood'), M('WoodDark'), M('Enamel')
    p.cyl(0.23, 0.04, (0, 0, 0.66), wood, verts=26, bevel=0.012, seg=2)
    for k in range(3):
        a = TAU * k / 3 + math.pi / 2
        p.tube((0.2 * math.cos(a), 0.2 * math.sin(a), 0.004), (0.12 * math.cos(a), 0.12 * math.sin(a), 0.645),
               0.018, dark, r2=0.022, verts=8)
    p.cyl(0.155, 0.022, (0, 0, 0.26), white, verts=20)
    p.cyl(0.17, 0.012, (0, 0, 0.68), M('MintLight'), verts=26)
    # the diffuser
    z0 = 0.686
    ceramic = material('Ceramic', '#F6EFE4', 0.35, 0.0)
    p.cyl(0.1, 0.035, (0, 0, z0 + 0.0175), wood, verts=20, bevel=0.008, seg=1)
    p.lathe([(0.0, z0 + 0.035), (0.092, z0 + 0.035), (0.104, z0 + 0.08), (0.098, z0 + 0.15), (0.068, z0 + 0.215),
             (0.03, z0 + 0.25), (0.0, z0 + 0.255)], (0, 0, 0), ceramic, segs=22)
    p.lathe([(0.0, z0 + 0.075), (0.106, z0 + 0.075), (0.106, z0 + 0.1), (0.0, z0 + 0.1)], (0, 0, 0), M('Mint'), segs=22)
    p.torus(0.098, 0.009, (0, 0, z0 + 0.04), glow('MintGlow', '#8CF0DB', 1.0), segs=22, verts=5)
    p.cyl(0.02, 0.012, (0, 0, z0 + 0.256), M('Teal'), verts=10)
    # mist: soft puffs that rise and curl
    mist = material('Mist', '#C4F4E5', 0.9, 0.0, emit=0.35)
    puffs = [(0.0, 0.0, 0.29, 0.03), (0.01, 0.0, 0.33, 0.045), (0.035, -0.01, 0.39, 0.06), (0.0, -0.01, 0.46, 0.075),
             (0.07, 0.0, 0.52, 0.07), (-0.06, 0.0, 0.54, 0.07), (0.01, 0.0, 0.6, 0.085), (0.09, 0.01, 0.62, 0.05),
             (-0.08, 0.01, 0.64, 0.045)]
    for (x, y, z, r) in puffs:
        p.sphere(r, (x, y, z0 + z), mist, ico=2)
    # two little mint leaves riding the mist
    for (x, z, a) in ((0.1, 0.5, 20), (-0.1, 0.6, 160)):
        d = (math.cos(math.radians(a)), -0.3, 0.25)
        leaf(p, (x, -0.04, z0 + z), d, 0.07, 0.04, M('LeafA'), droop=0.1, thick=0.006)
    # oil bottle and a mint sprig on the table
    p.lathe([(0.0, 0.68), (0.03, 0.68), (0.032, 0.76), (0.014, 0.785), (0.0, 0.785)], (0.14, -0.08, 0),
            M('Coffee'), segs=10)
    p.cyl(0.016, 0.03, (0.14, -0.08, 0.795), white, verts=8)
    p.tube((-0.18, -0.06, 0.69), (-0.1, -0.12, 0.69), 0.005, M('LeafB'), verts=4)
    for k in range(3):
        leaf(p, (-0.16 + k * 0.03, -0.075 - k * 0.02, 0.69), (0.3, -0.6 + k * 0.3, 0.2), 0.05, 0.03, M('LeafA'),
             droop=0.05, thick=0.005)
    return p.finish()


def loyalty_board():
    """Cork board on two wooden posts: a teal header with a tooth and stars, nine pinned punch cards (sunny
    stamps, some still empty) and a little shelf with blank cards and a pink hole punch."""
    p = Part('LoyaltyBoard')
    wood, dark = M('Wood'), M('WoodDark')
    cork = material('Cork', '#D9A96F', 0.95, 0.0)
    W, H, zc = 0.92, 0.66, 1.08
    for s in (-1, 1):
        x = s * (W / 2 + 0.06)
        p.rbox((0.055, 0.055, 1.62), (x, 0.03, 0.81), wood, r=0.014, seg=1)
        p.rbox((0.09, 0.44, 0.05), (x, 0.03, 0.025), dark, r=0.018, seg=1)
        p.sphere(0.04, (x, 0.03, 1.64), M('Mint'), seg=10, rings=6)
    p.rbox((W + 0.12, 0.04, H + 0.1), (0, 0.045, zc), dark, r=0.015, seg=1)
    p.box((W, 0.02, H), (0, 0.016, zc), cork)
    for s in (-1, 1):
        p.rbox((W + 0.12, 0.045, 0.05), (0, 0.006, zc + s * (H / 2 + 0.025)), wood, r=0.012, seg=1)
        p.rbox((0.06, 0.045, H + 0.1), (s * (W / 2 + 0.03), 0.006, zc), wood, r=0.012, seg=1)
    # header banner
    hz = zc + H / 2 + 0.13
    p.rbox((0.62, 0.035, 0.18), (0, 0.03, hz), M('Teal'), r=0.04, seg=2)
    p.plate(tooth2d(0.1, 0.11), 0.012, (0, 0.008, hz), M('Enamel'), axis='Y')
    for s in (-1, 1):
        p.plate(star2d(0.05, 0.022), 0.012, (s * 0.2, 0.008, hz), M('Sunshine'), axis='Y')
    # punch cards
    rng = random.Random(5)
    stripes = ('Bubblegum', 'Mint', 'Sky', 'Sunshine', 'Coral', 'Lilac', 'Mint', 'Bubblegum', 'Sky')
    k = 0
    for row in range(3):
        for col in range(3):
            mk = p.mark()
            c = stripes[k]
            p.plate(rrect(0.24, 0.14, 0.014, 1), 0.006, (0, 0, 0), M('Paper'), axis='Y')
            p.box((0.24, 0.008, 0.032), (0, -0.002, 0.054), M(c))
            punched = rng.randint(1, 5)
            for j in range(5):
                x = -0.084 + j * 0.042
                p.plate(hexagon(0.016 if j < punched else 0.011), 0.006, (x, -0.003, -0.02),
                        M('Sunshine') if j < punched else M('Cream'), axis='Y')
            p.sphere(0.016, (0, -0.012, 0.055), M(('Bubblegum', 'Teal', 'Sunshine')[k % 3]), seg=6, rings=4)
            p.xform_since(mk, loc=(-0.29 + col * 0.29, 0.0, zc + 0.2 - row * 0.2), rot=(0, rng.uniform(-6, 6), 0))
            k += 1
    # little shelf: blank cards and a hole punch
    sz = zc - H / 2 - 0.09
    p.rbox((W + 0.12, 0.14, 0.03), (0, -0.02, sz), wood, r=0.01, seg=1)
    for i in range(4):
        p.box((0.2, 0.1, 0.008), (-0.25, -0.03, sz + 0.02 + i * 0.009), M('Paper'), rot=(0, 0, i * 4))
    p.rbox((0.14, 0.08, 0.05), (0.22, -0.03, sz + 0.04), M('Bubblegum'), r=0.015, seg=2)
    p.rbox((0.12, 0.07, 0.022), (0.22, -0.035, sz + 0.075), M('Enamel'), r=0.01, seg=1, rot=(12, 0, 0))
    return p.finish()


def staff_lockers():
    """Three mint lockers on a teal plinth: vents, name tags, handles, a star sticker, a tooth sticker and a
    padlock; a pink gym bag and a small plant on top."""
    p = Part('StaffLockers')
    n, lw, d, h = 3, 0.42, 0.46, 1.82
    W = n * lw
    white, mint, teal, chrome = M('Enamel'), M('Mint'), M('Teal'), M('Chrome')
    p.bx(-W / 2 + 0.03, W / 2 - 0.03, -d / 2 + 0.04, d / 2, 0, 0.08, teal)
    p.rbox((W, d, h - 0.08), (0, 0, 0.08 + (h - 0.08) / 2), white, r=0.018, seg=2)
    p.rbox((W + 0.03, d + 0.03, 0.04), (0, 0, h + 0.015), M('MintLight'), r=0.012, seg=2)
    fy = -d / 2
    for i in range(n):
        x = -W / 2 + lw * (i + 0.5)
        p.rbox((lw - 0.04, 0.026, h - 0.2), (x, fy - 0.008, 0.1 + (h - 0.2) / 2 + 0.02), mint, r=0.014, seg=2)
        for k in range(4):
            p.box((lw * 0.5, 0.012, 0.018), (x, fy - 0.022, h - 0.24 - k * 0.042), M('TealDark'))
        p.rbox((0.14, 0.012, 0.05), (x, fy - 0.024, h - 0.47), M('Paper'), r=0.006, seg=1)
        p.rbox((0.034, 0.03, 0.15), (x + lw * 0.3, fy - 0.035, 0.98), chrome, r=0.012, seg=1)
    x0, x1, x2 = -lw, 0.0, lw
    p.plate(star2d(0.07, 0.03), 0.012, (x0 - 0.02, fy - 0.026, 0.72), M('Sunshine'), axis='Y')
    p.plate(tooth2d(0.11, 0.12), 0.012, (x2 - 0.03, fy - 0.026, 0.74), M('Enamel'), axis='Y')
    p.plate(ellipse(0.04, 0.03, 10), 0.012, (x2 + 0.06, fy - 0.026, 0.62), M('Bubblegum'), axis='Y')
    # padlock on the middle locker
    p.rbox((0.06, 0.03, 0.06), (x1 + lw * 0.3, fy - 0.055, 0.86), M('Gold'), r=0.012, seg=1)
    p.torus(0.02, 0.005, (x1 + lw * 0.3, fy - 0.055, 0.9), M('Steel'), segs=10, verts=4, rot=(90, 0, 0))
    # gym bag and a plant on top
    top = h + 0.035
    p.capsule((-0.42, -0.02, top + 0.1), (-0.02, -0.02, top + 0.1), 0.1, M('Bubblegum'), verts=12)
    p.box((0.36, 0.01, 0.02), (-0.22, -0.02, top + 0.2), M('Coral'))
    p.sweep([(-0.34, -0.02, top + 0.18), (-0.3, -0.02, top + 0.3), (-0.14, -0.02, top + 0.3),
             (-0.1, -0.02, top + 0.18)], 0.012, M('Slate'), verts=6)
    mk = p.mark()
    pot(p, 0, 0, 0.09, 0.14, M('Teal'), rim_m=M('Enamel'), segs=14)
    for (x, y, z, r) in ((0, 0, 0.22, 0.09), (0.06, 0.02, 0.18, 0.06), (-0.06, -0.01, 0.19, 0.06)):
        p.sphere(r, (x, y, z), M('LeafA') if r > 0.07 else M('LeafC'), ico=1)
    p.xform_since(mk, loc=(0.38, 0.02, top))
    return p.finish()


def digital_xray():
    """Wall-mounted digital x-ray: a teal wall mount, a sleek folded arm with a slim tube head and a glowing
    blue ring, a wall screen showing a scan, and a sensor holster with a coiled cable."""
    p = Part('DigitalXray')
    white, teal, mint = M('Enamel'), M('Teal'), M('Mint')
    wy = 0.16
    # wall mount
    p.rbox((0.2, 0.04, 0.36), (-0.3, wy - 0.02, 1.72), white, r=0.03, seg=2)
    p.rbox((0.21, 0.042, 0.04), (-0.3, wy - 0.022, 1.56), teal, r=0.012, seg=1)
    p.sphere(0.05, (-0.3, wy - 0.07, 1.78), teal, seg=12, rings=8)
    # folded arm: out from the wall, across, and back toward the head
    p.capsule((-0.3, wy - 0.07, 1.78), (-0.05, -0.12, 1.86), 0.034, white, verts=10)
    p.sphere(0.046, (-0.05, -0.12, 1.86), teal, seg=12, rings=8)
    p.capsule((-0.05, -0.12, 1.86), (0.18, -0.06, 1.7), 0.03, white, verts=10)
    p.sphere(0.042, (0.18, -0.06, 1.7), teal, seg=12, rings=8)
    p.tube((0.18, -0.06, 1.7), (0.18, -0.1, 1.6), 0.024, white, verts=8)
    # tube head: rounded housing with a square collimator pointing forward and down, lit ring
    mk = p.mark()
    p.rbox((0.16, 0.18, 0.15), (0, 0, 0), white, r=0.05, seg=3)
    p.box((0.1, 0.18, 0.1), (0, -0.16, 0), white, bevel=0.015, seg=1, taper=None)
    p.rbox((0.12, 0.03, 0.12), (0, -0.26, 0), teal, r=0.02, seg=2)
    p.box((0.08, 0.01, 0.08), (0, -0.278, 0), glow('BlueGlow', '#9FE3FF', 1.0))
    p.xform_since(mk, loc=(0.18, -0.14, 1.52), rot=(-30, 0, 0))
    # wall screen with a scan
    mk = p.mark()
    screen_panel(p, 0.6, 0.4, 0.04, bezel='Enamel', content=xray_content, r=0.02)
    p.xform_since(mk, loc=(0.56, wy - 0.05, 1.6))
    p.rbox((0.16, 0.03, 0.12), (0.56, wy - 0.015, 1.6), M('Slate'), r=0.01, seg=1)
    # sensor holster with a coiled cable
    p.rbox((0.09, 0.06, 0.12), (0.56, wy - 0.04, 1.25), mint, r=0.02, seg=2)
    p.rbox((0.05, 0.012, 0.07), (0.56, wy - 0.075, 1.3), M('Slate'), r=0.008, seg=1)
    coil = [(0.56 + 0.022 * math.cos(i * 0.9), wy - 0.05 + 0.022 * math.sin(i * 0.9), 1.19 - i * 0.004)
            for i in range(14)]
    p.sweep(coil, 0.005, M('Rubber'), verts=5)
    return p.finish()


def sound_panel():
    """A honeycomb of seven plush fabric acoustic panels in teal, pink, mint and blush, one stitched with a calm
    sound wave."""
    p = Part('SoundPanel')
    fabrics = {
        'teal': material('FabricTeal', '#1E9E96', 0.95, 0.0),
        'pink': material('FabricPink', '#FF86B0', 0.95, 0.0),
        'mint': material('FabricMint', '#8FE3CC', 0.95, 0.0),
        'blush': material('FabricBlush', '#FFC4D6', 0.95, 0.0),
    }
    R, zc, t = 0.27, 1.62, 0.06
    s3 = math.sqrt(3)
    cells = []
    for c in (-1, 0, 1):
        rows = (-1, 0, 1) if c == 0 else (-0.5, 0.5)
        for r in rows:
            cells.append((c * 1.5 * R, zc + r * s3 * R))
    colors = ['pink', 'mint', 'blush', 'teal', 'pink', 'teal', 'mint']
    for (x, z), c in zip(cells, colors):
        p.prism(hexagon(R * 0.94), t, fabrics[c], axis='Y', center=0.0, bevel=0.018, seg=2, flat=False, loc=(x, 0, z))
        p.prism(hexagon(R * 0.97), 0.02, M('Enamel'), axis='Y', center=0.03, loc=(x, 0, z))
    # stitched wave on the middle panel
    wave = [(-0.16 + 0.32 * i / 12, -t / 2 - 0.004, zc + 0.06 * math.sin(i * math.pi / 3) * (1 - abs(i - 6) / 7))
            for i in range(13)]
    p.sweep(wave, 0.008, M('Paper'), verts=5)
    return p.finish()


def app_screen(p, w, h, y):
    """The patient app: a light screen with a mint header, a tooth, a little calendar and a sunny Book button."""
    p.box((w, 0.003, h), (0, y - 0.0015, 0), glow('AppBg', '#EFFBF8', 0.55))
    p.box((w, 0.003, h * 0.18), (0, y - 0.004, h * 0.41), glow('UiMint', '#3DD6B5', 0.7))
    p.plate(tooth2d(h * 0.36, h * 0.4), 0.003, (-w * 0.26, y - 0.004, h * 0.06), glow('UiTeal', '#1FB3A9', 0.6), axis='Y')
    cols = ('UiSky', '#7CC8F2'), ('UiBubblegum', '#FF7AA8'), ('UiSky', '#7CC8F2'), ('UiSunshine', '#FFD166')
    for i in range(3):
        for j in range(2):
            name, col = cols[(i + j) % 4]
            p.box((w * 0.12, 0.003, h * 0.14), (w * (0.04 + i * 0.15), y - 0.004, h * (0.14 - j * 0.2)),
                  glow(name, col, 0.7))
    p.plate(rrect(w * 0.6, h * 0.16, h * 0.07, 2), 0.003, (0, y - 0.004, -h * 0.36), glow('UiSunshine', '#FFD166', 0.7),
            axis='Y')


def patient_tablet():
    """Tablet kiosk: weighted round base, slim steel pole, a pink-cased tablet tilted up showing the tooth app."""
    p = Part('PatientTablet')
    white, mint, pink = M('Enamel'), M('Mint'), M('Bubblegum')
    p.cyl(0.21, 0.04, (0, 0, 0.02), white, verts=26, bevel=0.014, seg=2)
    p.cyl(0.17, 0.012, (0, 0, 0.044), mint, verts=26)
    p.cyl(0.02, 1.0, (0, 0, 0.05 + 0.5), M('Steel'), verts=10)
    p.cyl(0.034, 0.06, (0, 0, 0.62), mint, verts=12, bevel=0.01)
    p.sphere(0.035, (0, 0, 1.06), white, seg=10, rings=6)
    mk = p.mark()
    p.rbox((0.36, 0.04, 0.27), (0, 0, 0), pink, r=0.035, seg=2)
    p.box((0.31, 0.006, 0.22), (0, -0.021, 0), M('Screen'))
    app_screen(p, 0.29, 0.2, -0.025)
    p.rbox((0.12, 0.03, 0.09), (0, 0.03, 0), white, r=0.015, seg=1)
    p.xform_since(mk, loc=(0, -0.04, 1.16), rot=(-32, 0, 0))
    # stylus in a little clip on the pole
    p.rbox((0.04, 0.03, 0.04), (0.035, 0, 0.9), white, r=0.01, seg=1)
    p.tube((0.05, -0.005, 0.86), (0.05, -0.005, 1.0), 0.007, M('Teal'), verts=6)
    return p.finish()


def nitrous_tank():
    """Laughing gas cart: a blue and a green cylinder strapped to a little rolling cart, a flowmeter head with two
    glowing flow tubes, a coral reservoir bag and a mint nose mask on a hose."""
    p = Part('NitrousTank')
    w, d = 0.5, 0.34
    white, chrome, steel = M('Enamel'), M('Chrome'), M('Steel')
    for sx in (-1, 1):
        for sy in (-1, 1):
            caster(p, sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0.03)
    p.rbox((w, d, 0.06), (0, 0, 0.1), white, r=0.02, seg=2)
    p.rbox((w - 0.05, d - 0.05, 0.012), (0, 0, 0.134), M('MintLight'), r=0.01, seg=1)
    py = d / 2 - 0.03
    for sx in (-1, 1):
        p.cyl(0.016, 1.12, (sx * (w / 2 - 0.03), py, 0.13 + 0.56), steel, verts=8)
    p.sweep([(-w / 2 + 0.03, py, 1.24), (-w / 2 + 0.03, py + 0.05, 1.3), (w / 2 - 0.03, py + 0.05, 1.3),
             (w / 2 - 0.03, py, 1.24)], 0.016, chrome, verts=8)
    p.tube((-w / 2 + 0.03, py, 0.55), (w / 2 - 0.03, py, 0.55), 0.014, steel, verts=6)
    cyl_m = {'b': material('CylBlue', '#3C8FE0', 0.4, 0.0), 'g': material('CylGreen', '#3DBE6E', 0.4, 0.0)}
    for x, k in ((-0.11, 'b'), (0.11, 'g')):
        prof = [(0.0, 0.14), (0.074, 0.14), (0.085, 0.16), (0.085, 0.8), (0.075, 0.86), (0.045, 0.9), (0.02, 0.91),
                (0.0, 0.912)]
        p.lathe(prof, (x, 0.0, 0), cyl_m[k], segs=16)
        p.lathe([(0.0, 0.72), (0.087, 0.72), (0.087, 0.77), (0.0, 0.77)], (x, 0.0, 0), white, segs=16)
        p.torus(0.087, 0.009, (x, 0.0, 0.55), M('Rubber'), segs=16, verts=4)
        p.cyl(0.02, 0.07, (x, 0.0, 0.94), chrome, verts=10)
        p.torus(0.032, 0.007, (x, 0.0, 0.975), cyl_m[k], segs=12, verts=4)
        p.sweep([(x, 0.0, 0.96), (x * 0.9, 0.05, 1.0), (x * 0.5, 0.1, 1.02)], 0.009, M('Rubber'), verts=5)
    # flowmeter head on the frame
    hz = 1.12
    p.rbox((0.36, 0.12, 0.2), (0, py - 0.03, hz), white, r=0.03, seg=2)
    p.rbox((0.37, 0.125, 0.03), (0, py - 0.03, hz + 0.09), M('Teal'), r=0.01, seg=1)
    tube_glass = material('FilterGlass', '#A8DDF7', 0.08, 0.0, alpha=0.45)
    for x, k, col in ((-0.06, 'b', '#7CC8F2'), (0.06, 'g', '#8CF0B0')):
        p.cyl(0.018, 0.13, (x, py - 0.1, hz + 0.01), tube_glass, verts=10)
        p.sphere(0.012, (x, py - 0.1, hz + 0.02 + (0.03 if k == 'b' else -0.02)), glow('Flow' + k, col, 1.0),
                 seg=8, rings=5)
        p.cyl(0.02, 0.03, (x, py - 0.1, hz - 0.08), cyl_m[k], axis='Y', verts=12)
    # reservoir bag and mask hose
    p.tube((0.18, py - 0.03, hz - 0.06), (0.24, py - 0.06, hz - 0.12), 0.012, white, verts=6)
    p.sphere(1.0, (0.28, py - 0.08, hz - 0.28), material('BagCoral', '#FF9B7A', 0.7, 0.0), seg=12, rings=8,
             scale=(0.07, 0.06, 0.14))
    hose = [(-0.18, py - 0.06, hz - 0.05), (-0.26, py - 0.14, hz - 0.12), (-0.3, -0.12, 0.82), (-0.28, -0.2, 0.7)]
    p.sweep(hose, 0.016, M('Sky'), verts=8)
    p.tube((-w / 2 + 0.02, py, 0.86), (-w / 2 - 0.05, py - 0.02, 0.88), 0.01, chrome, verts=6)
    mask = material('MaskMint', '#8FE3CC', 0.6, 0.0)
    p.sphere_cut(0.075, (-0.28, -0.24, 0.66), mask, plane_no=(0, -1, 0), plane_off=0.01, seg=14, rings=10,
                 scale=(1.0, 0.8, 0.8))
    p.torus(0.07, 0.008, (-0.28, -0.25, 0.66), M('Enamel'), segs=14, verts=4, rot=(90, 0, 0), scale=(1.0, 0.8, 1.0))
    return p.finish()


def laser_whitening():
    """Futuristic whitening laser: weighted dome base with a glowing ring, tapered column with a touch panel, a
    long sweeping arm and a disc head with a big blue lens inside a halo."""
    p = Part('LaserWhitening')
    white, teal, chrome = M('Enamel'), M('Teal'), M('Chrome')
    by = 0.12
    halo = glow('LaserHalo', '#9FE3FF', 1.3)
    p.lathe([(0.0, 0.0), (0.27, 0.0), (0.28, 0.02), (0.26, 0.06), (0.19, 0.1), (0.08, 0.125), (0.0, 0.13)],
            (0, by, 0), white, segs=30)
    p.torus(0.262, 0.011, (0, by, 0.045), halo, segs=30, verts=6)
    p.cyl(0.052, 1.08, (0, by, 0.12 + 0.54), white, verts=18, r2=0.04)
    p.cyl(0.06, 0.06, (0, by, 0.52), teal, verts=18, bevel=0.012)
    p.cyl(0.05, 0.05, (0, by, 1.2), teal, verts=18, bevel=0.012)
    # touch panel on the column
    p.rbox((0.16, 0.05, 0.12), (0, by - 0.06, 0.98), white, r=0.02, seg=2, rot=(-15, 0, 0))
    p.box((0.12, 0.006, 0.085), (0, by - 0.089, 0.985), glow('BlueGlow', '#9FE3FF', 1.0), rot=(-15, 0, 0))
    # the sweeping arm
    arm = [(0, by, 1.2), (0, by - 0.02, 1.4), (0, -0.1, 1.55), (0, -0.36, 1.58), (0, -0.56, 1.48), (0, -0.66, 1.36)]
    p.sweep(arm, 0.032, white, verts=10, rscale=(1.0, 1.3))
    p.sphere(0.045, (0, -0.1, 1.55), teal, seg=12, rings=8)
    p.sphere(0.04, (0, -0.66, 1.36), teal, seg=12, rings=8)
    # disc head aimed down and forward
    mk = p.mark()
    p.cyl(0.16, 0.08, (0, 0, 0), white, verts=30, bevel=0.03, seg=2)
    p.cyl(0.12, 0.02, (0, 0, -0.04), chrome, verts=30)
    p.cyl(0.09, 0.02, (0, 0, -0.05), glow('LaserLens', '#56C4FF', 1.8), verts=26)
    p.torus(0.19, 0.01, (0, 0, -0.035), halo, segs=32, verts=6)
    for k in range(3):
        a = TAU * k / 3 + math.pi / 2
        p.tube((0.16 * math.cos(a), 0.16 * math.sin(a), -0.03), (0.18 * math.cos(a), 0.18 * math.sin(a), -0.035),
               0.006, halo, verts=4)
    p.sphere(0.03, (0, 0, 0.05), teal, seg=10, rings=6)
    p.xform_since(mk, loc=(0, -0.66, 1.26), rot=(-35, 0, 0))
    return p.finish()


def ergo_stool():
    """Hygienist's saddle stool: five-leg base on casters, gas lift, chrome foot ring and a mint saddle seat."""
    p = Part('ErgoStool')
    white, chrome = M('Enamel'), M('Chrome')
    star_base(p, 0.25, 0.0, white, leg_w=0.045, caster_r=0.028)
    p.cyl(0.036, 0.2, (0, 0, 0.2), M('Slate'), verts=12)
    p.cyl(0.024, 0.2, (0, 0, 0.38), chrome, verts=12)
    p.torus(0.19, 0.012, (0, 0, 0.3), chrome, segs=24, verts=6)
    for k in range(3):
        a = TAU * k / 3 + math.pi / 2
        p.tube((0.03 * math.cos(a), 0.03 * math.sin(a), 0.3), (0.19 * math.cos(a), 0.19 * math.sin(a), 0.3), 0.009,
               chrome, verts=5)
    p.cyl(0.13, 0.03, (0, 0, 0.49), M('Slate'), verts=18, bevel=0.01)
    saddle = material('Saddle', '#3DD6B5', 0.55, 0.0)
    zc = 0.55
    mk = p.mark()
    p.sphere(1.0, (0, 0, zc), saddle, seg=24, rings=12, scale=(0.2, 0.2, 0.055))

    def shape(v):
        # saddle: raised front and back, dipped sides, narrow pommel toward the front (-Y)
        lx, ly, lz = v.x, v.y, v.z - zc
        if lz > -0.02:
            lz += 1.1 * ly * ly - 0.7 * lx * lx
        lx *= 1.0 - 0.45 * max(0.0, -ly / 0.2)
        return (lx, ly + 0.02, zc + lz)
    p.warp_since(mk, shape)
    p.lathe([(0.0, 0.5), (0.12, 0.5), (0.13, 0.515), (0.0, 0.53)], (0, 0.02, 0), M('Teal'), segs=18)
    p.tube((0.06, -0.03, 0.47), (0.2, -0.06, 0.45), 0.008, chrome, verts=5)
    p.sphere(0.02, (0.2, -0.06, 0.45), M('Bubblegum'), seg=8, rings=5)
    return p.finish()


# ------------------------------------------------------------------ bigger pieces (t3 and t4)

def spa_lounge():
    """Spa corner, about 2 x 1.5 m: a mint rug, a plush lilac chaise with a pillow and rolled towels, a stone
    fountain with a floating lotus, a bamboo plant and a side table with candles and towels."""
    p = Part('SpaLounge')
    wood, white = M('Wood'), M('Enamel')
    p.plate(rrect(2.0, 1.5, 0.32, 3), 0.012, (0, 0, 0.006), M('Cream'), axis='Z')
    p.plate(rrect(1.84, 1.34, 0.26, 3), 0.012, (0, 0, 0.009), M('MintLight'), axis='Z')
    # chaise lounge along X, raised end at -X
    plush = material('Plush', '#B9A6F2', 0.9, 0.0)
    cx, cy = -0.32, -0.17
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * 0.58, cy + sy * 0.23
            p.tube((x, y, 0.015), (x, y, 0.12), 0.024, wood, r2=0.03, verts=8)
    p.rbox((1.36, 0.6, 0.2), (cx, cy, 0.21), plush, r=0.08, seg=2)
    p.rbox((1.0, 0.52, 0.1), (cx + 0.15, cy, 0.33), material('PlushLight', '#D9CEFA', 0.9, 0.0), r=0.05, seg=2)
    p.rbox((0.24, 0.6, 0.52), (cx - 0.56, cy, 0.46), plush, r=0.1, seg=2, rot=(0, -18, 0))
    p.cyl(0.08, 0.5, (cx - 0.5, cy, 0.62), M('Blush'), axis='Y', verts=14)
    for k in range(2):
        p.cyl(0.05, 0.2, (cx + 0.42, cy - 0.12 + k * 0.12, 0.43), M('Paper'), axis='X', verts=12)
        p.cyl(0.052, 0.04, (cx + 0.42, cy - 0.12 + k * 0.12, 0.43), M('Mint'), axis='X', verts=12)
    # fountain at the back right
    fx, fy = 0.64, 0.36
    stone = material('Stone', '#DDD7CD', 0.85, 0.0)
    water = M('Water')
    p.lathe([(0.0, 0.0), (0.3, 0.0), (0.33, 0.03), (0.33, 0.28), (0.3, 0.3), (0.27, 0.28), (0.27, 0.24), (0.0, 0.24)],
            (fx, fy, 0), stone, segs=18)
    p.cyl(0.275, 0.03, (fx, fy, 0.25), water, verts=18)
    p.lathe([(0.0, 0.24), (0.06, 0.24), (0.05, 0.4), (0.07, 0.5), (0.04, 0.6), (0.0, 0.6)], (fx, fy, 0), stone,
            segs=14)
    p.lathe([(0.0, 0.58), (0.05, 0.58), (0.16, 0.66), (0.17, 0.7), (0.15, 0.71), (0.0, 0.68)], (fx, fy, 0), stone,
            segs=16)
    p.cyl(0.145, 0.02, (fx, fy, 0.69), water, verts=16)
    p.sphere(0.04, (fx, fy, 0.74), stone, seg=10, rings=6)
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        c, s = math.cos(a), math.sin(a)
        p.sweep([(fx + 0.16 * c, fy + 0.16 * s, 0.69), (fx + 0.21 * c, fy + 0.21 * s, 0.6),
                 (fx + 0.23 * c, fy + 0.23 * s, 0.45), (fx + 0.235 * c, fy + 0.235 * s, 0.27)], 0.012, water, verts=5)
    # lotus and lily pads in the basin
    p.cyl(0.06, 0.01, (fx - 0.12, fy - 0.1, 0.27), M('LeafA'), verts=12)
    p.prism(star2d(0.06, 0.03, 6), 0.03, M('Blush'), axis='Z', center=0.285, loc=(fx - 0.12, fy - 0.1, 0))
    p.sphere(0.018, (fx - 0.12, fy - 0.1, 0.3), M('Sunshine'), seg=8, rings=5)
    p.cyl(0.05, 0.01, (fx + 0.1, fy - 0.14, 0.27), M('LeafC'), verts=12)
    # bamboo in a stone pot at the back left
    bx, by = -0.78, 0.46
    pot(p, bx, by, 0.17, 0.34, stone, rim_m=M('TealDark'), segs=14)
    rng = random.Random(4)
    for k in range(5):
        a = TAU * k / 5
        x0, y0 = bx + 0.07 * math.cos(a), by + 0.07 * math.sin(a)
        top = 1.0 + rng.uniform(0, 0.45)
        x1, y1 = x0 + 0.05 * math.cos(a), y0 + 0.05 * math.sin(a)
        p.tube((x0, y0, 0.3), (x1, y1, top), 0.018, M('LeafC'), verts=6)
        for j in range(1, 3):
            t = j / 3
            p.cyl(0.021, 0.02, (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.3 + (top - 0.3) * t), M('LeafB'), verts=6)
        for j in range(2):
            b = a + (j - 0.5) * 1.2
            leaf(p, (x1, y1, top - 0.1 * j), (math.cos(b), math.sin(b), 0.3), 0.22, 0.07,
                 M(('LeafA', 'LeafB')[j % 2]), droop=0.3, thick=0.008)
    # side table with towels and candles, front right
    tx, ty = 0.66, -0.42
    p.cyl(0.2, 0.04, (tx, ty, 0.44), wood, verts=20, bevel=0.012)
    p.cyl(0.05, 0.42, (tx, ty, 0.21), M('WoodDark'), verts=10)
    p.cyl(0.14, 0.03, (tx, ty, 0.015), M('WoodDark'), verts=16, bevel=0.01)
    for k, mm in enumerate(('Paper', 'Blush', 'Mint')):
        p.rbox((0.18, 0.12, 0.04), (tx - 0.05, ty + 0.02, 0.48 + k * 0.042), M(mm), r=0.018, seg=1, rot=(0, 0, 8 * k))
    for k in range(3):
        x, y = tx + 0.1, ty - 0.08 + k * 0.07
        h = 0.08 + 0.03 * (k % 2)
        p.cyl(0.025, h, (x, y, 0.46 + h / 2), M('Cream'), verts=10)
        p.sphere(0.012, (x, y, 0.47 + h), M('Light'), seg=6, rings=4, scale=(0.7, 0.7, 1.4))
    return p.finish()


def cadcam_mill():
    """CAD/CAM crown mill: a cabinet with a white milling machine on top (glass front, lit inside, a spindle over
    a ceramic block with a tooth crown emerging), a screen showing the crown design and a tray of blocks."""
    p = Part('CadcamMill')
    w, d, h = 1.0, 0.6, 0.86
    white, mint, teal, chrome = M('Enamel'), M('Mint'), M('Teal'), M('Chrome')
    p.bx(-w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.05, d / 2, 0, 0.08, teal)
    p.rbox((w, d, h - 0.1), (0, 0, 0.08 + (h - 0.1) / 2), white, r=0.015, seg=2)
    for s in (-1, 1):
        p.rbox((w / 2 - 0.04, 0.02, h - 0.2), (s * w / 4, -d / 2 - 0.004, 0.08 + (h - 0.1) / 2), mint, r=0.012, seg=2)
        p.tube((s * 0.05, -d / 2 - 0.025, 0.55), (s * 0.05, -d / 2 - 0.025, 0.68), 0.009, chrome, verts=6)
    p.rbox((w + 0.03, d + 0.03, 0.04), (0, 0, h), M('Cream'), r=0.012, seg=2)
    # the mill: an open frame so the glass front shows the work inside
    mx, my, top = -0.14, 0.03, h + 0.02
    MW, MD, MH = 0.52, 0.44, 0.54
    p.rbox((MW, MD, 0.1), (mx, my, top + 0.05), white, r=0.03, seg=2)
    p.rbox((MW, MD, 0.14), (mx, my, top + MH - 0.07), white, r=0.04, seg=2)
    for s in (-1, 1):
        p.rbox((0.07, MD, MH), (mx + s * (MW / 2 - 0.035), my, top + MH / 2), white, r=0.025, seg=2)
    p.box((MW - 0.12, 0.03, MH - 0.2), (mx, my + MD / 2 - 0.03, top + MH / 2), M('Teal'))
    p.box((MW - 0.12, MD - 0.08, 0.012), (mx, my, top + 0.1), M('TealDark'))
    p.box((MW - 0.13, 0.012, MH - 0.23), (mx, my - MD / 2 + 0.03, top + MH / 2 - 0.005), M('Glass'))
    p.box((MW + 0.005, 0.02, 0.035), (mx, my - MD / 2 + 0.005, top + MH - 0.06), teal)
    p.box((MW - 0.16, 0.03, 0.012), (mx, my, top + MH - 0.145), glow('LampGlow', '#DDF7FF', 1.0))
    # spindle and bur
    p.cyl(0.04, 0.09, (mx, my, top + MH - 0.19), M('Steel'), verts=14)
    p.lathe([(0.0, top + 0.27), (0.006, top + 0.28), (0.012, top + 0.31), (0.0, top + 0.31)], (mx, my, 0), chrome,
            segs=8)
    p.cyl(0.018, 0.04, (mx, my, top + 0.33), chrome, verts=10)
    # ceramic block on its holder with the crown coming out of it
    p.cyl(0.03, 0.12, (mx, my + 0.12, top + 0.125), M('Steel'), axis='Y', verts=10)
    p.rbox((0.12, 0.09, 0.07), (mx, my + 0.02, top + 0.135), material('Blank', '#F7EBD3', 0.5, 0.0), r=0.01, seg=1)
    p.prism(tooth2d(0.15, 0.16), 0.08, M('Enamel'), axis='Y', center=0.0, bevel=0.02, seg=1, flat=False,
            loc=(mx, my - 0.01, top + 0.2))
    for (x, z, r) in ((0.06, 0.26, 0.022), (-0.07, 0.24, 0.016)):
        p.plate(star2d(r, r * 0.35, 4), 0.006, (mx + x, my - 0.05, top + z), M('Sunshine'), axis='Y')
    # touch display and status bar on the right pillar
    px = mx + MW / 2 - 0.035
    p.box((0.05, 0.006, 0.08), (px, my - MD / 2 - 0.001, top + MH / 2 + 0.06), glow('UiMint', '#3DD6B5', 0.8))
    for k, mm in enumerate(('UiBubblegum', 'UiSunshine')):
        col = '#FF7AA8' if k == 0 else '#FFD166'
        p.cyl(0.011, 0.008, (px, my - MD / 2 - 0.002, top + 0.2 - k * 0.04), glow(mm, col, 0.7), axis='Y', verts=8)
    # design screen on a small stand
    sx = 0.3
    p.rbox((0.14, 0.1, 0.012), (sx, 0.08, top + 0.006), M('Slate'), r=0.005, seg=1)
    p.cyl(0.014, 0.12, (sx, 0.09, top + 0.07), M('Slate'), verts=8)
    mk = p.mark()
    screen_panel(p, 0.3, 0.2, 0.025, bezel='Slate', content=lambda q, w2, h2, y: q.plate(
        tooth2d(h2 * 0.7, h2 * 0.78), 0.003, (0, y - 0.0015, 0), glow('XrayGlow', '#CFF6F0', 0.9), axis='Y'))
    p.xform_since(mk, loc=(sx, 0.07, top + 0.22), rot=(-10, 0, -15))
    # tray of colored blocks and a finished gold crown
    p.rbox((0.22, 0.12, 0.02), (0.3, -0.19, top + 0.01), M('Sky'), r=0.008, seg=1)
    for k, mm in enumerate(('Blank', 'Cream', 'Paper')):
        m = material('Blank', '#F7EBD3', 0.5, 0.0) if mm == 'Blank' else M(mm)
        p.rbox((0.04, 0.05, 0.035), (0.23 + k * 0.05, -0.19, top + 0.035), m, r=0.006, seg=1)
    p.prism(tooth2d(0.05, 0.05), 0.035, M('Gold'), axis='Y', center=-0.19, bevel=0.008, seg=1, flat=False,
            loc=(0.39, 0, top + 0.045))
    return p.finish()


def flower(p, x, y, z, kind, color, s=1.0):
    """A small flower head at (x, y, z) on nothing (the caller draws the stem). kinds: daisy, tulip, puff."""
    if kind == 'daisy':
        p.prism(star2d(0.05 * s, 0.022 * s, 6), 0.016 * s, M(color), axis='Z', center=z, loc=(x, y, 0))
        p.sphere(0.018 * s, (x, y, z + 0.01 * s), M('Sunshine'), seg=6, rings=4)
    elif kind == 'tulip':
        p.lathe([(0.0, z - 0.03 * s), (0.028 * s, z - 0.02 * s), (0.034 * s, z + 0.02 * s), (0.02 * s, z + 0.045 * s),
                 (0.0, z + 0.035 * s)], (x, y, 0), M(color), segs=6, flat=True)
    else:
        p.sphere(0.04 * s, (x, y, z), M(color), ico=1)


def rooftop_planter():
    """Two long wooden planter boxes full of greens, daisies, tulips and lilac puffs, with a mint watering can."""
    p = Part('RooftopPlanter')
    rng = random.Random(21)
    wood, dark = M('Wood'), M('WoodDark')
    kinds = [('daisy', 'Paper'), ('tulip', 'Bubblegum'), ('puff', 'Lilac'), ('daisy', 'Sunshine'), ('tulip', 'Coral'),
             ('puff', 'Blush'), ('daisy', 'Blush'), ('tulip', 'Sunshine')]
    for (bx, by, L) in ((0.08, 0.34, 2.0), (-0.22, -0.34, 1.5)):
        H, D = 0.44, 0.42
        p.rbox((L, D, 0.05), (bx, by, 0.025), dark, r=0.012, seg=1)
        for k in range(3):
            p.rbox((L - 0.02, D - 0.02, 0.125), (bx, by, 0.05 + 0.065 + k * 0.13), wood if k % 2 == 0 else
                   material('WoodMid', '#D7A56E', 0.7, 0.0), r=0.012, seg=1)
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.rbox((0.06, 0.06, H + 0.03), (bx + sx * (L / 2 - 0.025), by + sy * (D / 2 - 0.025), (H + 0.03) / 2),
                       dark, r=0.01, seg=1)
        p.box((L - 0.06, D - 0.06, 0.02), (bx, by, H - 0.02), M('Soil'))
        # greenery along the box
        n = int(L / 0.2)
        for i in range(n):
            x = bx - L / 2 + 0.14 + i * (L - 0.28) / (n - 1)
            y = by + rng.uniform(-0.08, 0.08)
            p.sphere(0.1 + rng.uniform(0, 0.03), (x, y, H + 0.04), M(('LeafA', 'LeafB', 'LeafC')[i % 3]), ico=1,
                     scale=(1.2, 1.0, 0.75))
        # flowers poking out
        nf = int(L / 0.16)
        for i in range(nf):
            x = bx - L / 2 + 0.1 + i * (L - 0.2) / (nf - 1) + rng.uniform(-0.03, 0.03)
            y = by + rng.uniform(-0.12, 0.12)
            z = H + 0.14 + rng.uniform(0, 0.16)
            kind, col = kinds[(i * 3 + int(L * 10)) % len(kinds)]
            p.tube((x, y, H), (x, y, z - 0.02), 0.007, M('LeafB'), verts=4)
            flower(p, x, y, z, kind, col)
    # watering can
    cx, cy = 1.0, -0.36
    can = M('Mint')
    p.lathe([(0.0, 0.0), (0.1, 0.0), (0.11, 0.02), (0.1, 0.2), (0.0, 0.2)], (cx, cy, 0), can, segs=16)
    p.tube((cx - 0.08, cy, 0.05), (cx - 0.24, cy, 0.24), 0.018, can, r2=0.012, verts=8)
    p.cyl(0.03, 0.02, (cx - 0.25, cy, 0.25), can, verts=10, rot=(0, -50, 0))
    p.sweep([(cx + 0.06, cy, 0.18), (cx + 0.1, cy, 0.27), (cx - 0.02, cy, 0.3), (cx - 0.07, cy, 0.2)], 0.014,
            M('Teal'), verts=6)
    return p.finish()


def velvet_chair(p, x, y, facing=0.0):
    """A plush berry velvet armchair on gold legs (tufted back), seat facing `facing` degrees (0 = -Y)."""
    mk = p.mark()
    velvet = material('Velvet', '#C8376F', 0.85, 0.0)
    gold = M('Gold')
    w, d = 0.82, 0.74
    for sx in (-1, 1):
        for sy in (-1, 1):
            lx, ly = sx * (w / 2 - 0.08), sy * (d / 2 - 0.08)
            p.tube((lx * 1.05, ly * 1.05, 0.005), (lx, ly, 0.16), 0.018, gold, r2=0.024, verts=8)
    p.rbox((w, d, 0.2), (0, 0, 0.25), velvet, r=0.07, seg=3)
    p.rbox((w - 0.2, d - 0.14, 0.12), (0, -0.04, 0.38), velvet, r=0.05, seg=3)
    p.rbox((w, 0.2, 0.8), (0, d / 2 - 0.1, 0.62), velvet, r=0.1, seg=3, rot=(-8, 0, 0))
    p.sphere(1.0, (0, d / 2 - 0.1, 1.02), velvet, seg=16, rings=8, scale=(w / 2, 0.1, 0.12))
    for sx in (-1, 1):
        p.rbox((0.14, d, 0.3), (sx * (w / 2 - 0.07), 0, 0.46), velvet, r=0.07, seg=3)
        p.cyl(0.08, d - 0.02, (sx * (w / 2 - 0.07), 0, 0.6), velvet, axis='Y', verts=14)
    for (bx, bz) in ((-0.2, 0.62), (0.0, 0.62), (0.2, 0.62), (-0.1, 0.82), (0.1, 0.82)):
        face_y = d / 2 - 0.2 + (bz - 0.62) * math.tan(math.radians(8))
        p.sphere(0.02, (bx, face_y - 0.008, bz), gold, seg=6, rings=4)
    p.xform_since(mk, loc=(x, y, 0), rot=(0, 0, facing))


def aim(dx, dy):
    """Z rotation (degrees) that turns a +Y-facing assembly to face along (dx, dy)."""
    return math.degrees(math.atan2(-dx, dy))


def smile_studio():
    """Photo corner, about 2 x 2 m: a blush paper sweep on two stands with gold stars, a berry velvet chair, a ring
    light on a tripod and a camera on a tripod, both aimed at the chair."""
    p = Part('SmileStudio')
    slate = M('Slate')
    backdrop = material('Backdrop', '#FFC9DA', 0.85, 0.0)
    by = 0.82
    for s in (-1, 1):
        x = s * 0.98
        tripod(p, x, by, 0.4, 0.28, slate)
        p.cyl(0.02, 2.36, (x, by, 1.18), slate, verts=8)
        p.sphere(0.03, (x, by, 2.36), slate, seg=8, rings=5)
    p.tube((-0.98, by, 2.3), (0.98, by, 2.3), 0.016, slate, verts=6)
    p.cyl(0.065, 1.84, (0, by - 0.01, 2.23), backdrop, axis='X', verts=14)
    # the sweep: hangs down, curves out over the floor
    t, R = 0.012, 0.45
    c = R + 0.003
    outer = [(by, 2.2), (by, c)] + arc(by - R, c, R, 0, -90, 6)[1:] + [(-0.34, 0.003)]
    inner = [(-0.34, 0.003 + t)] + arc(by - R, c, R - t, -90, 0, 6)[:-1] + [(by - t, c), (by - t, 2.2)]
    p.prism(outer + inner, 1.8, backdrop, axis='X', center=0.0)
    for (x, z, r) in ((-0.55, 1.85, 0.12), (0.6, 1.95, 0.09), (0.35, 1.6, 0.06), (-0.3, 2.05, 0.06)):
        p.plate(star2d(r, r * 0.45), 0.012, (x, by - t - 0.008, z), M('Gold'), axis='Y')
    velvet_chair(p, 0.0, 0.3, 0.0)
    # ring light, front left, aimed at the chair
    lx, ly = -0.66, -0.6
    tripod(p, lx, ly, 0.45, 0.24, slate, r=0.012)
    p.cyl(0.016, 1.1, (lx, ly, 0.45 + 0.55 - 0.1), slate, verts=8)
    mk = p.mark()
    p.torus(0.22, 0.032, (0, 0, 0), M('Light'), segs=28, verts=8, rot=(90, 0, 0))
    p.torus(0.22, 0.042, (0, 0.02, 0), M('Enamel'), segs=28, verts=6, rot=(90, 0, 0), scale=(1.0, 1.0, 0.6))
    p.rbox((0.07, 0.012, 0.13), (0, -0.01, 0), slate, r=0.008, seg=1)
    p.tube((0, 0, -0.07), (0, 0, -0.22), 0.008, slate, verts=5)
    p.tube((0, 0.0, -0.22), (0, 0, -0.29), 0.014, slate, verts=6)
    p.xform_since(mk, loc=(lx, ly, 1.44), rot=(0, 0, aim(0.0 - lx, 0.3 - ly) + 180))
    # camera on a tripod, front right
    cx, cy = 0.62, -0.66
    tripod(p, cx, cy, 0.9, 0.26, slate, r=0.012)
    p.cyl(0.02, 0.35, (cx, cy, 1.02), slate, verts=8)
    mk = p.mark()
    p.rbox((0.2, 0.1, 0.14), (0, 0, 0), M('Slate'), r=0.025, seg=2)
    p.rbox((0.07, 0.1, 0.1), (0.06, 0.01, 0.0), M('Rubber'), r=0.02, seg=1)
    p.cyl(0.05, 0.12, (-0.02, 0.1, 0.0), M('Rubber'), axis='Y', verts=14)
    p.cyl(0.042, 0.01, (-0.02, 0.165, 0.0), M('Glass'), axis='Y', verts=14)
    p.cyl(0.013, 0.02, (0.05, 0.0, 0.08), M('Bubblegum'), verts=8)
    p.rbox((0.06, 0.02, 0.04), (-0.05, -0.05, 0.04), M('Screen'), r=0.006, seg=1)
    p.xform_since(mk, loc=(cx, cy, 1.25), rot=(0, 0, aim(0.0 - cx, 0.3 - cy)))
    return p.finish()


def research_desk():
    """Lab bench: open frame with a teal drawer unit, a microscope, a big model molar on a stand, a rack of
    colorful test tubes, flasks on a riser shelf and a clipboard."""
    p = Part('ResearchDesk')
    w, d, h = 1.5, 0.7, 0.9
    white, teal, mint, chrome = M('Enamel'), M('Teal'), M('Mint'), M('Chrome')
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.rbox((0.05, 0.05, h - 0.04), (sx * (w / 2 - 0.04), sy * (d / 2 - 0.04), (h - 0.04) / 2), white, r=0.012,
                   seg=1)
    p.rbox((w - 0.06, d - 0.06, 0.03), (0, 0, 0.18), white, r=0.01, seg=1)
    p.rbox((0.42, d - 0.08, 0.6), (w / 2 - 0.26, 0, 0.52), white, r=0.015, seg=2)
    for k in range(3):
        z = 0.34 + k * 0.19
        p.rbox((0.38, 0.02, 0.16), (w / 2 - 0.26, -d / 2 + 0.03, z), teal if k != 1 else mint, r=0.01, seg=2)
        p.tube((w / 2 - 0.32, -d / 2 + 0.005, z + 0.04), (w / 2 - 0.2, -d / 2 + 0.005, z + 0.04), 0.008, chrome, verts=6)
    p.rbox((w + 0.04, d + 0.04, 0.045), (0, 0, h), M('Cream'), r=0.012, seg=2)
    p.box((w + 0.045, 0.02, 0.02), (0, -d / 2 - 0.012, h - 0.005), teal)
    # riser shelf with flasks
    ty = h + 0.0225
    for sx in (-1, 1):
        p.rbox((0.04, 0.2, 0.36), (sx * (w / 2 - 0.05), d / 2 - 0.1, ty + 0.18), white, r=0.01, seg=1)
    p.rbox((w - 0.06, 0.2, 0.025), (0, d / 2 - 0.1, ty + 0.33), white, r=0.008, seg=1)
    liquids = ('Mint', 'Bubblegum', 'Sky', 'Sunshine')
    for k, x in enumerate((-0.52, -0.3, 0.1, 0.4)):
        z0 = ty + 0.345
        p.lathe([(0.0, z0), (0.07, z0), (0.07, z0 + 0.02), (0.03, z0 + 0.12), (0.022, z0 + 0.13), (0.022, z0 + 0.17),
                 (0.0, z0 + 0.17)], (x, d / 2 - 0.1, 0), M('Glass'), segs=12)
        p.lathe([(0.0, z0 + 0.004), (0.062, z0 + 0.004), (0.062, z0 + 0.02), (0.04, z0 + 0.07), (0.0, z0 + 0.07)],
                (x, d / 2 - 0.1, 0), glow('Liquid' + liquids[k], {'Mint': '#3DD6B5', 'Bubblegum': '#FF7AA8',
                                                                   'Sky': '#7CC8F2', 'Sunshine': '#FFD166'}[liquids[k]],
                                          0.5), segs=12)
    # microscope
    mx, my = -0.42, -0.02
    p.rbox((0.2, 0.26, 0.04), (mx, my, ty + 0.02), white, r=0.015, seg=2)
    p.sweep([(mx, my + 0.1, ty + 0.04), (mx, my + 0.12, ty + 0.2), (mx, my + 0.06, ty + 0.34), (mx, my - 0.02, ty + 0.38)],
            0.035, teal, verts=10, rscale=(1.0, 0.8))
    p.rbox((0.16, 0.14, 0.02), (mx, my - 0.02, ty + 0.14), M('Slate'), r=0.008, seg=1)
    p.cyl(0.03, 0.06, (mx, my - 0.03, ty + 0.25), chrome, verts=12)
    p.cyl(0.035, 0.03, (mx, my - 0.03, ty + 0.3), white, verts=12)
    p.tube((mx, my - 0.02, ty + 0.36), (mx, my + 0.06, ty + 0.5), 0.022, white, verts=10)
    p.cyl(0.026, 0.035, (mx, my + 0.07, ty + 0.515), M('Slate'), verts=10, rot=(-30, 0, 0))
    for s in (-1, 1):
        p.cyl(0.03, 0.02, (mx + s * 0.05, my + 0.1, ty + 0.16), mint, axis='X', verts=12)
    # model molar on a stand
    tx = 0.02
    p.cyl(0.08, 0.03, (tx, 0.0, ty + 0.015), teal, verts=16, bevel=0.008)
    p.cyl(0.015, 0.12, (tx, 0.0, ty + 0.09), chrome, verts=8)
    p.prism(tooth2d(0.24, 0.26), 0.14, M('Enamel'), axis='Y', center=0.0, bevel=0.035, seg=2, flat=False,
            loc=(tx, 0, ty + 0.27))
    p.plate(star2d(0.035, 0.012, 4), 0.01, (tx + 0.1, -0.08, ty + 0.38), M('Sunshine'), axis='Y')
    # test tube rack
    rx, ry = 0.36, -0.12
    p.rbox((0.3, 0.1, 0.015), (rx, ry, ty + 0.01), M('Wood'), r=0.005, seg=1)
    p.rbox((0.3, 0.1, 0.015), (rx, ry, ty + 0.09), M('Wood'), r=0.005, seg=1)
    for s in (-1, 1):
        p.rbox((0.015, 0.1, 0.1), (rx + s * 0.14, ry, ty + 0.05), M('Wood'), r=0.004, seg=1)
    for k, mm in enumerate(('Mint', 'Bubblegum', 'Sunshine', 'Sky', 'Lilac')):
        x = rx - 0.1 + k * 0.05
        p.cyl(0.016, 0.16, (x, ry, ty + 0.09), M('Glass'), verts=8)
        p.cyl(0.012, 0.08, (x, ry, ty + 0.055), M(mm), verts=8)
    # clipboard
    p.rbox((0.2, 0.26, 0.012), (0.1, -0.2, ty + 0.006), M('WoodDark'), r=0.01, seg=1, rot=(0, 0, 12))
    p.rbox((0.16, 0.2, 0.004), (0.1, -0.21, ty + 0.013), M('Paper'), r=0.004, seg=1, rot=(0, 0, 12))
    p.rbox((0.06, 0.02, 0.012), (0.12, -0.09, ty + 0.02), M('Teal'), r=0.004, seg=1, rot=(0, 0, 12))
    return p.finish()


def helipad_sign():
    """A big helipad sign: a sunny disc with a white H on a tall pole, a tiny pink helicopter parked on top and a
    striped windsock."""
    p = Part('HelipadSign')
    white, teal = M('Enamel'), M('Teal')
    p.cyl(0.38, 0.14, (0, 0, 0.07), M('Cream'), verts=28, bevel=0.03, seg=2)
    p.cyl(0.33, 0.03, (0, 0, 0.15), teal, verts=28)
    p.cyl(0.05, 2.12, (0, 0, 0.16 + 1.06), white, verts=14)
    for z in (0.5, 1.2):
        p.cyl(0.054, 0.08, (0, 0, z), teal, verts=14)
    zc, R = 2.56, 0.56
    p.cyl(R, 0.1, (0, 0, zc), M('Sunshine'), axis='Y', verts=40, bevel=0.03, seg=2)
    p.cyl(R - 0.08, 0.112, (0, 0, zc), teal, axis='Y', verts=40)
    p.torus(R - 0.14, 0.022, (0, 0, zc), white, segs=40, verts=6, rot=(90, 0, 0), scale=(1.0, 1.0, 2.9))
    for s in (-1, 1):
        p.box((0.08, 0.13, 0.42), (s * 0.12, 0, zc), white)
    p.box((0.18, 0.13, 0.08), (0, 0, zc), white)
    # a little parking pad on the rim, and the helicopter on it
    top = zc + R
    p.rbox((0.34, 0.2, 0.03), (0, 0, top + 0.005), M('Slate'), r=0.01, seg=1)
    heli = M('Bubblegum')
    for s in (-1, 1):
        p.tube((s * 0.09, -0.17, top + 0.04), (s * 0.09, 0.15, top + 0.04), 0.01, M('Steel'), verts=6)
        p.tube((s * 0.09, -0.17, top + 0.04), (s * 0.09, -0.2, top + 0.06), 0.01, M('Steel'), verts=6)
        for yy in (-0.08, 0.07):
            p.tube((s * 0.09, yy, top + 0.04), (s * 0.05, yy, top + 0.1), 0.008, M('Steel'), verts=5)
    p.sphere(1.0, (0, 0.0, top + 0.17), heli, seg=16, rings=10, scale=(0.12, 0.2, 0.1))
    p.sphere(1.0, (0, -0.1, top + 0.19), M('Glass'), seg=14, rings=8, scale=(0.1, 0.11, 0.085))
    p.tube((0, 0.14, top + 0.19), (0, 0.46, top + 0.23), 0.04, heli, r2=0.018, verts=10)
    p.plate([(0.0, 0.0), (0.09, 0.0), (0.06, 0.12)], 0.012, (0, 0.42, top + 0.23), M('Sunshine'), axis='X')
    p.cyl(0.05, 0.008, (0.018, 0.46, top + 0.26), M('Slate'), axis='X', verts=10)
    p.cyl(0.016, 0.08, (0, 0, top + 0.3), M('Slate'), verts=8)
    for a in (25, 115):
        p.rbox((0.84, 0.05, 0.012), (0, 0, top + 0.345), M('Slate'), r=0.005, seg=1, rot=(0, 0, a))
    p.sphere(0.022, (0, 0, top + 0.355), M('Sunshine'), seg=8, rings=5)
    # windsock on a side arm
    p.tube((0.04, 0, 1.96), (0.36, 0, 1.96), 0.02, teal, verts=8)
    p.torus(0.08, 0.01, (0.4, 0, 1.96), M('Steel'), segs=12, verts=4, rot=(0, 90, 0))
    bands = ('Coral', 'Paper', 'Coral', 'Paper')
    for k, mm in enumerate(bands):
        x0, x1 = 0.4 + k * 0.1, 0.4 + (k + 1) * 0.1
        r0, r1 = 0.08 - k * 0.013, 0.08 - (k + 1) * 0.013
        z0, z1 = 1.96 - 0.02 * k * k, 1.96 - 0.02 * (k + 1) * (k + 1)
        p.tube((x0, 0, z0), (x1, 0, z1), r0, M(mm), r2=r1, verts=12)
    return p.finish()


def schedule_content(p, w, h, y):
    """A glowing schedule: a header of day chips, 5 day columns of appointment blocks, a pink now line and a
    sparkle in the corner."""
    cols = [('UiMint', '#3DD6B5'), ('UiBubblegum', '#FF7AA8'), ('UiSunshine', '#FFD166'), ('UiSky', '#7CC8F2'),
            ('UiLilac', '#B9A6F2')]
    head = glow('AiHead', '#BDEFF2', 0.7)
    dim = glow('AiDim', '#3E7580', 0.35)
    gx0, gw = -w / 2 + w * 0.12, w * 0.84
    cw = gw / 5
    p.box((w * 0.96, 0.003, h * 0.12), (0, y - 0.0015, h / 2 - h * 0.1), head)
    for c in range(5):
        x = gx0 + cw * (c + 0.5)
        p.plate(rrect(cw * 0.6, h * 0.06, h * 0.02, 1), 0.003, (x, y - 0.004, h / 2 - h * 0.1), glow('UiTeal', '#1FB3A9', 0.6),
                axis='Y')
    rows = 6
    rh = (h * 0.74) / rows
    top = h / 2 - h * 0.2
    rng = random.Random(9)
    for r in range(rows):
        p.box((w * 0.05, 0.003, rh * 0.18), (-w / 2 + w * 0.06, y - 0.0015, top - rh * (r + 0.5)), head)
        for c in range(5):
            x = gx0 + cw * (c + 0.5)
            z = top - rh * (r + 0.5)
            if rng.random() < 0.8:
                name, col = cols[(r * 2 + c * 3 + rng.randint(0, 1)) % 5]
                p.plate(rrect(cw * 0.86, rh * 0.78, rh * 0.18, 1), 0.003, (x, y - 0.0015, z), glow(name, col, 0.9),
                        axis='Y')
            else:
                p.plate(rrect(cw * 0.86, rh * 0.78, rh * 0.18, 1), 0.003, (x, y - 0.0015, z), dim, axis='Y')
    nz = top - rh * 2.3
    p.box((gw + w * 0.04, 0.004, h * 0.012), (gx0 + gw / 2 - w * 0.02, y - 0.005, nz), glow('NowPink', '#FF7AA8', 1.2))
    p.plate(ellipse(h * 0.025, h * 0.025, 10), 0.004, (gx0 - w * 0.02, y - 0.006, nz), glow('NowPink', '#FF7AA8', 1.2),
            axis='Y')
    p.plate(star2d(h * 0.06, h * 0.02, 4), 0.004, (w / 2 - w * 0.05, y - 0.006, h / 2 - h * 0.1),
            glow('UiSunshine', '#FFD166', 0.9), axis='Y')


def ai_screen():
    """A big wall screen (about 1.75 m up) showing a glowing schedule grid, with a mint glow strip under it and a
    little camera eye on top."""
    p = Part('AiScreen')
    zc, W, H = 1.78, 1.5, 0.86
    p.rbox((0.4, 0.05, 0.3), (0, 0.05, zc), M('Slate'), r=0.015, seg=1)
    mk = p.mark()
    screen_panel(p, W, H, 0.05, bezel='Slate', content=schedule_content, r=0.03)
    p.xform_since(mk, loc=(0, 0.0, zc))
    p.rbox((W * 0.7, 0.03, 0.025), (0, -0.005, zc - H / 2 - 0.035), glow('AiGlow', '#8CF0DB', 1.1), r=0.01, seg=1)
    p.rbox((0.1, 0.04, 0.05), (0, -0.005, zc + H / 2 + 0.02), M('Slate'), r=0.015, seg=1)
    p.sphere(0.016, (0, -0.026, zc + H / 2 + 0.02), glow('AiGlow', '#8CF0DB', 1.1), seg=8, rings=5)
    return p.finish()


MODELS = {
    'water_filter': dict(fn=water_filter, budget=120, preview_dir=(0.7, -1.4, 0.5)),
    'aroma_diffuser': dict(fn=aroma_diffuser, budget=120),
    'loyalty_board': dict(fn=loyalty_board, budget=120, preview_dir=(0.7, -1.4, 0.45)),
    'staff_lockers': dict(fn=staff_lockers, budget=120),
    'digital_xray': dict(fn=digital_xray, budget=120, preview_dir=(0.7, -1.4, 0.5)),
    'sound_panel': dict(fn=sound_panel, budget=120, preview_dir=(0.55, -1.4, 0.35)),
    'patient_tablet': dict(fn=patient_tablet, budget=120),
    'nitrous_tank': dict(fn=nitrous_tank, budget=120),
    'laser_whitening': dict(fn=laser_whitening, budget=120),
    'spa_lounge': dict(fn=spa_lounge, budget=120),
    'cadcam_mill': dict(fn=cadcam_mill, budget=120),
    'rooftop_planter': dict(fn=rooftop_planter, budget=120),
    'smile_studio': dict(fn=smile_studio, budget=120),
    'research_desk': dict(fn=research_desk, budget=120),
    'helipad_sign': dict(fn=helipad_sign, budget=120, preview_dir=(0.8, -1.4, 0.5)),
    'ai_screen': dict(fn=ai_screen, budget=120, preview_dir=(0.55, -1.4, 0.35)),
    'ergo_stool': dict(fn=ergo_stool, budget=120),
}
