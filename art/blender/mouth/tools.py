# Hygienist tools and shop extras.
#
# Contract (docs/ARCHITECTURE.md): tip at the origin, handle along +Y, about 9 units long, clearly different
# silhouettes per tier, working-end detail near the tip. extra_* are shop thumbnails only (centered).
# Authored in three.js space (see lib.py). Every tool also gets a 256 px transparent thumbnail.
import math
import os
from mathutils import Matrix, Vector
import lib
from lib import M, Part

rad = math.radians


def glow(name, color, strength=2.0):
    return lib.material(name, color, 0.3, 0.0, emit=strength)


# ------------------------------------------------------------------ shared pieces

CHUNK = 1.25   # cartoon chunkiness for the hand instruments (radial scale about the tip axis)

def hex_grip(p, y0, y1, r, m, ring_m, rings=6):
    """Hexagonal steel grip with knurled rings."""
    p.cyl(r, y1 - y0, (0, (y0 + y1) / 2, 0), m, axis='Y', verts=6, flat=True, spin=30)
    for k in range(rings):
        y = y0 + (y1 - y0) * (k + 0.5) / rings
        p.cyl(r * 1.06, 0.12, (0, y, 0), ring_m, axis='Y', verts=6, flat=True, spin=30)


def dome(p, y, r, m, up=True, verts=16, h=None, loc=(0, 0, 0)):
    """Rounded end cap on a Y axis handle."""
    h = h if h is not None else r
    prof = [(r * math.cos(a), y + (h * math.sin(a) if up else -h * math.sin(a))) for a in
            [rad(d) for d in (0, 30, 55, 75, 90)]]
    prof[-1] = (0.0, prof[-1][1])
    if not up:
        prof = list(reversed(prof))
    p.lathe(prof if up else prof, m, verts=verts, loc=loc)


def taper(p, y0, r0, y1, r1, m, verts=16, loc=(0, 0, 0)):
    p.lathe([(0.0, y0), (r0, y0), (r1, y1), (0.0, y1)], m, verts=verts, loc=loc)


def rubber_cup(p, m, r=0.2, depth=0.34, loc=(0, 0, 0), ridges=True):
    """Prophy cup: opening facing -Y with its rim center at loc, body going +Y."""
    x, y, z = loc
    prof = [(0.0, 0.17 * depth / 0.34), (0.6 * r, 0.15 * depth / 0.34), (0.78 * r, 0.04), (0.95 * r, 0.0),
            (1.12 * r, 0.035), (1.1 * r, 0.55 * depth), (0.8 * r, 0.92 * depth), (0.0, depth)]
    p.lathe(prof, m, verts=20, loc=loc)
    if ridges:  # the little webbing ribs inside the cup
        for k in range(4):
            a = k * math.pi / 4
            p.box((1.3 * r, 0.05, 0.035), (x, y + 0.13 * depth / 0.34, z), m, rot=(0, math.degrees(a), 0), bevel=0.01)


def with_spinner(body, part):
    """Finish `part` as a child node of `body`. The clean scene spins the first node whose name matches
    /cup|spin|head/ about its local Y, so the cup is its own node with its pivot on the spin axis."""
    ob = part.finish(smooth_angle=50)
    ob.parent = body
    ob.matrix_parent_inverse.identity()
    return body


# ------------------------------------------------------------------ scalers

def tool_scaler():
    """Tier 1 Sickle Scaler: steel, hexagonal knurled grip, pointed sickle blade."""
    p = Part('tool_scaler')
    steel, dark, mint = M('Steel'), M('SteelDark'), M('Mint')
    blade = [(0, 1.1, -0.04), (0, 0.84, 0.1), (0, 0.55, 0.18), (0, 0.28, 0.16), (0, 0.1, 0.09), (0, 0.0, 0.0)]
    p.sweep(blade, 0.07, steel, verts=8, radii=[0.075, 0.074, 0.066, 0.052, 0.032, 0.006], rscale=(0.42, 1.0),
            up=(1, 0, 0))
    shank = [(0, 1.05, -0.03), (0, 1.5, -0.25), (0, 2.1, -0.22), (0, 2.55, -0.04), (0, 2.85, 0)]
    p.sweep(shank, 0.07, steel, verts=10, radii=[0.06, 0.066, 0.075, 0.085, 0.095])
    taper(p, 2.8, 0.095, 3.45, 0.24, steel, verts=12)
    hex_grip(p, 3.45, 7.95, 0.3, steel, dark, rings=7)
    p.cyl(0.32, 0.28, (0, 7.2, 0), mint, axis='Y', verts=6, flat=True, spin=30)
    taper(p, 7.95, 0.3, 8.35, 0.24, steel, verts=12)
    dome(p, 8.35, 0.24, steel, h=0.3)
    p.transform(scale=(CHUNK, 1.0, CHUNK))
    return p.finish(smooth_angle=40)


def tool_curette():
    """Tier 2 Gracey Curette: chunky mint silicone grip, angled shank, rounded spoon blade."""
    p = Part('tool_curette')
    steel, mint, teal = M('Steel'), M('Mint'), M('Teal')
    blade = [(0, 0.95, 0.14), (0, 0.62, 0.22), (0, 0.32, 0.2), (0, 0.12, 0.12), (0, 0.045, 0.045)]
    p.sweep(blade, 0.07, steel, verts=10, radii=[0.07, 0.08, 0.082, 0.075, 0.062], rscale=(0.4, 1.0),
            up=(1, 0, 0), cap_round=3)
    shank = [(0, 0.92, 0.14), (0, 1.35, 0.4), (0, 1.9, 0.38), (0, 2.35, 0.14), (0, 2.75, 0.0), (0, 3.0, 0.0)]
    p.sweep(shank, 0.07, steel, verts=10, radii=[0.062, 0.068, 0.075, 0.085, 0.1, 0.11])
    taper(p, 2.95, 0.11, 3.3, 0.2, steel, verts=14)
    # silicone grip with soft ribs
    prof = [(0.0, 3.25), (0.24, 3.25), (0.36, 3.45)]
    y = 3.45
    for k in range(9):
        prof += [(0.4, y + 0.12), (0.36, y + 0.3)]
        y += 0.36
    prof += [(0.32, y + 0.2), (0.0, y + 0.2)]
    p.lathe(prof, mint, verts=18)
    top = y + 0.2
    p.cyl(0.27, 0.16, (0, top + 0.08, 0), teal, axis='Y', verts=16)
    taper(p, top + 0.16, 0.26, 8.35, 0.22, steel, verts=16)
    dome(p, 8.35, 0.22, steel, h=0.28)
    p.transform(scale=(CHUNK, 1.0, CHUNK))
    return p.finish(smooth_angle=50)


def tool_titanium():
    """Tier 3 Titanium Scaler: gold anodized, slim faceted grip in ink, long sharp blade."""
    p = Part('tool_titanium')
    gold, goldd, ink = M('Gold'), M('GoldDark'), M('Ink')
    blade = [(0, 1.25, 0.02), (0, 0.95, 0.16), (0, 0.62, 0.22), (0, 0.32, 0.19), (0, 0.11, 0.1), (0, 0.0, 0.0)]
    p.sweep(blade, 0.07, gold, verts=8, radii=[0.07, 0.07, 0.064, 0.05, 0.03, 0.005], rscale=(0.36, 1.0),
            up=(1, 0, 0))
    shank = [(0, 1.2, 0.02), (0, 1.6, -0.22), (0, 2.2, -0.26), (0, 2.7, -0.06), (0, 3.05, 0)]
    p.sweep(shank, 0.07, gold, verts=10, radii=[0.058, 0.063, 0.07, 0.08, 0.09])
    taper(p, 3.0, 0.09, 3.6, 0.22, gold, verts=16)
    # grip: 12-sided faceted ink section with gold bands
    p.cyl(0.27, 3.2, (0, 5.25, 0), ink, axis='Y', verts=12, flat=True)
    for k in range(8):
        p.cyl(0.285, 0.08, (0, 3.85 + k * 0.4, 0), goldd, axis='Y', verts=12, flat=True)
    p.cyl(0.24, 0.3, (0, 3.75, 0), gold, axis='Y', verts=16)
    taper(p, 6.85, 0.27, 8.55, 0.14, gold, verts=16)
    p.cyl(0.29, 0.12, (0, 6.9, 0), goldd, axis='Y', verts=16)
    dome(p, 8.55, 0.14, gold, h=0.14)
    p.transform(scale=(CHUNK, 1.0, CHUNK))
    return p.finish(smooth_angle=35)


def ultra_tip(p, m, y_top=1.65, r0=0.05):
    tip = [(0, 0.0, 0.0), (0, 0.22, 0.09), (0, 0.62, 0.2), (0, 1.1, 0.16), (0, 1.45, 0.04), (0, y_top, 0.0)]
    p.sweep(tip, r0, m, verts=10, radii=[0.018, 0.026, 0.034, 0.042, 0.05, r0], cap_round=1)


def tool_ultrasonic():
    """Tier 4 Ultrasonic Scaler: chunky blue handpiece, thin metal insert, coiled cord."""
    p = Part('tool_ultrasonic')
    blue, blued, chrome, white, cord = M('Blue'), M('BlueDark'), M('Chrome'), M('White'), M('Cord')
    ultra_tip(p, chrome)
    taper(p, 1.6, 0.07, 2.25, 0.3, M('Grey'), verts=18)
    p.cyl(0.33, 0.14, (0, 2.3, 0), white, axis='Y', verts=20)
    prof = [(0.0, 2.35), (0.36, 2.35), (0.4, 2.6), (0.4, 3.0)]
    y = 3.0
    for k in range(5):
        prof += [(0.35, y + 0.1), (0.35, y + 0.22), (0.4, y + 0.32)]
        y += 0.32
    prof += [(0.4, 6.4), (0.36, 6.7), (0.0, 6.72)]
    p.lathe(prof, blue, verts=20)
    for k in range(5):
        p.cyl(0.365, 0.1, (0, 3.16 + k * 0.32, 0), blued, axis='Y', verts=20)
    p.cyl(0.41, 0.1, (0, 5.2, 0), white, axis='Y', verts=20)
    taper(p, 6.65, 0.3, 7.15, 0.14, white, verts=16)
    cord_pts = [(0, 7.1, 0), (0, 7.6, 0.05), (0.12, 8.1, 0.25), (0.45, 8.5, 0.45), (0.85, 8.75, 0.5), (1.25, 8.9, 0.3),
                (1.5, 9.15, 0.0)]
    p.sweep(cord_pts, 0.12, cord, verts=10, cap_round=1)
    p.transform(scale=(1.12, 1.0, 1.12))
    return p.finish(smooth_angle=45)


def tool_piezo():
    """Tier 5 Piezo Pro: sleek white and teal handpiece with a glowing ring and a fine tip."""
    p = Part('tool_piezo')
    white, teal, chrome, cord = M('White'), M('Teal'), M('Chrome'), M('Cord')
    ring = glow('PiezoGlow', '#6FF2DA', 2.2)
    ultra_tip(p, chrome, y_top=1.75, r0=0.045)
    taper(p, 1.7, 0.06, 2.45, 0.24, teal, verts=20)
    p.cyl(0.25, 0.09, (0, 2.5, 0), ring, axis='Y', verts=20)
    prof = [(0.0, 2.54), (0.25, 2.54), (0.3, 2.9), (0.31, 4.2), (0.28, 5.2), (0.28, 6.9), (0.25, 7.3), (0.0, 7.35)]
    p.lathe(prof, white, verts=24)
    # teal soft grip inlays
    p.cyl(0.318, 0.9, (0, 3.35, 0), teal, axis='Y', verts=24)
    p.cyl(0.29, 0.07, (0, 5.6, 0), teal, axis='Y', verts=24)
    p.cyl(0.29, 0.07, (0, 5.8, 0), ring, axis='Y', verts=24)
    taper(p, 7.3, 0.2, 7.75, 0.11, teal, verts=16)
    cord_pts = [(0, 7.7, 0), (0, 8.2, 0.03), (0.1, 8.65, 0.18), (0.35, 9.0, 0.3)]
    p.sweep(cord_pts, 0.09, cord, verts=10, cap_round=1)
    p.transform(scale=(1.15, 1.0, 1.15))
    return p.finish(smooth_angle=45)


# ------------------------------------------------------------------ polishers

def tool_polisher():
    """Tier 1 Prophy Angle: grey contra-angle handpiece with a pink rubber cup."""
    p = Part('tool_polisher')
    grey, greyd, rubber, white = M('Grey'), M('GreyDark'), M('Rubber'), M('White')
    cup = Part('Cup')
    rubber_cup(cup, rubber, r=0.24, depth=0.38)
    p.cyl(0.21, 0.34, (0, 0.54, 0), grey, axis='Y', verts=16)
    dome(p, 0.71, 0.21, grey, h=0.17)
    neck = [(0, 0.58, -0.06), (0, 0.95, -0.3), (0, 1.55, -0.42), (0, 2.1, -0.42)]
    p.sweep(neck, 0.13, grey, verts=12, radii=[0.12, 0.13, 0.15, 0.17])
    taper(p, 2.0, 0.17, 3.9, 0.28, white, loc=(0, 0, -0.42), verts=18)
    p.cyl(0.3, 0.14, (0, 3.95, -0.42), greyd, axis='Y', verts=18)
    prof = [(0.0, 4.0), (0.31, 4.0), (0.34, 4.3), (0.34, 8.2), (0.3, 8.6), (0.0, 8.65)]
    p.lathe(prof, grey, verts=20, loc=(0, 0, -0.42))
    for k in range(3):
        p.cyl(0.35, 0.08, (0, 7.2 + k * 0.25, -0.42), greyd, axis='Y', verts=20)
    return with_spinner(p.finish(smooth_angle=45), cup)


def tool_cordless():
    """Tier 2 Cordless Polisher: chunky teal body, big cup, power button."""
    p = Part('tool_cordless')
    teal, mint, white, ink, rubber = M('Teal'), M('Mint'), M('White'), M('Ink'), M('Rubber')
    cup = Part('Cup')
    rubber_cup(cup, rubber, r=0.26, depth=0.4)
    p.cyl(0.22, 0.34, (0, 0.56, 0), white, axis='Y', verts=16)
    dome(p, 0.73, 0.22, white, h=0.18)
    neck = [(0, 0.62, -0.07), (0, 1.0, -0.34), (0, 1.55, -0.48), (0, 2.0, -0.5)]
    p.sweep(neck, 0.15, white, verts=12, radii=[0.14, 0.15, 0.17, 0.2])
    taper(p, 1.95, 0.2, 2.9, 0.3, white, loc=(0, 0, -0.5), verts=18)
    prof = [(0.0, 2.85), (0.34, 2.85), (0.5, 3.3), (0.56, 4.2), (0.54, 6.4), (0.5, 7.6), (0.38, 8.1), (0.0, 8.2)]
    p.lathe(prof, teal, verts=22, loc=(0, 0, -0.5))
    p.cyl(0.575, 0.18, (0, 3.6, -0.5), mint, axis='Y', verts=22)
    p.cyl(0.555, 0.9, (0, 6.9, -0.5), ink, axis='Y', verts=22)
    # power button and battery light on the front
    p.cyl(0.16, 0.12, (0, 4.6, 0.04), white, axis='Z', verts=16, bevel=0.03, seg=2)
    p.sphere(0.06, (0, 5.2, 0.03), glow('CordlessGlow', '#7CFFB2', 1.8), seg=10, rings=6)
    return with_spinner(p.finish(smooth_angle=45), cup)


def tool_airpolisher():
    """Tier 3 Air Polisher: slim wand with an angled nozzle and a clear powder chamber."""
    p = Part('tool_airpolisher')
    white, teal, chrome, glass, powder, grey = M('White'), M('Teal'), M('Chrome'), M('Glass'), M('Powder'), M('Grey')
    nozzle = [(0, 0.0, 0.0), (0, 0.3, -0.16), (0, 0.8, -0.4), (0, 1.35, -0.5), (0, 1.8, -0.5)]
    p.sweep(nozzle, 0.06, chrome, verts=10, radii=[0.045, 0.05, 0.058, 0.065, 0.07])
    p.cyl(0.07, 0.08, (0, 0.02, 0), M('GreyDark'), axis='Y', verts=10)
    taper(p, 1.75, 0.08, 2.45, 0.27, teal, loc=(0, 0, -0.5), verts=18)
    prof = [(0.0, 2.4), (0.28, 2.4), (0.31, 2.8), (0.31, 7.4), (0.26, 7.8), (0.0, 7.85)]
    p.lathe(prof, white, verts=20, loc=(0, 0, -0.5))
    p.cyl(0.325, 0.12, (0, 2.95, -0.5), teal, axis='Y', verts=20)
    p.cyl(0.325, 0.12, (0, 6.6, -0.5), teal, axis='Y', verts=20)
    # powder chamber on the side
    cx, cz = 0.78, -0.5
    p.cyl(0.38, 2.3, (cx, 4.6, cz), glass, axis='Y', verts=22)
    p.cyl(0.32, 1.35, (cx, 4.05, cz), powder, axis='Y', verts=20)
    dome(p, 4.72, 0.32, powder, h=0.12, loc=(cx, 0, cz))
    p.cyl(0.42, 0.26, (cx, 5.85, cz), teal, axis='Y', verts=22, bevel=0.05, seg=2)
    p.cyl(0.42, 0.2, (cx, 3.38, cz), grey, axis='Y', verts=22)
    p.box((0.5, 1.9, 0.2), (0.4, 4.6, cz), white, bevel=0.05, seg=2)
    hose = [(0, 7.8, -0.5), (0, 8.3, -0.48), (0.1, 8.8, -0.3), (0.3, 9.2, 0.0)]
    p.sweep(hose, 0.12, grey, verts=10, cap_round=1)
    return p.finish(smooth_angle=45)


# ------------------------------------------------------------------ floss

def tool_floss():
    """Tier 1 String Floss: a floss holder, fork with a taut strand."""
    p = Part('tool_floss')
    mint, white, floss = M('Mint'), M('White'), M('Floss')
    for sx in (-1, 1):
        prong = [(0, 1.2, 0), (sx * 0.12, 0.95, 0), (sx * 0.3, 0.55, 0), (sx * 0.38, 0.2, 0), (sx * 0.38, -0.03, 0)]
        p.sweep(prong, 0.06, white, verts=10, radii=[0.1, 0.085, 0.07, 0.06, 0.055], cap_round=2)
    p.tube((-0.39, 0.0, 0), (0.39, 0.0, 0), 0.02, floss, verts=6)
    # a few wraps of floss round each prong tip
    for sx in (-1, 1):
        p.cyl(0.07, 0.07, (sx * 0.38, 0.02, 0), floss, axis='Y', verts=10)
    taper(p, 1.1, 0.12, 1.6, 0.24, white, verts=16)
    prof = [(0.0, 1.55), (0.24, 1.55), (0.3, 2.0), (0.3, 7.6), (0.26, 8.1), (0.0, 8.2)]
    p.lathe(prof, mint, verts=18)
    # floss spool bump on the handle
    p.cyl(0.33, 0.5, (0, 2.6, 0), white, axis='Y', verts=18, bevel=0.06, seg=2)
    p.lathe([(0.0, 2.45), (0.345, 2.45), (0.345, 2.75), (0.0, 2.75)], floss, verts=18)
    return p.finish(smooth_angle=45)


def tool_flosspick():
    """Tier 2 Floss Picks: a pink one-piece pick, arched head, pointed tail."""
    p = Part('tool_flosspick')
    pink, floss = M('Bubblegum'), M('Floss')
    arch = [(-0.36, -0.02, 0), (-0.38, 0.3, 0), (-0.3, 0.62, 0), (0.0, 0.8, 0), (0.3, 0.62, 0), (0.38, 0.3, 0),
            (0.36, -0.02, 0)]
    p.sweep(arch, 0.095, pink, verts=10, rscale=(1.0, 0.75), up=(0, 0, 1), cap_round=2)
    p.tube((-0.37, 0.0, 0), (0.37, 0.0, 0), 0.02, floss, verts=6)
    handle = [(0, 0.75, 0), (0, 1.4, 0), (0, 3.0, 0), (0, 5.2, 0), (0, 6.9, 0), (0, 7.8, 0), (0, 8.4, 0)]
    p.sweep(handle, 0.2, pink, verts=14, radii=[0.14, 0.25, 0.32, 0.32, 0.26, 0.14, 0.03], rscale=(1.0, 0.5),
            up=(1, 0, 0))
    # grip ridges
    for k in range(6):
        p.box((0.46, 0.07, 0.22), (0, 2.4 + 0.3 * k, 0), pink, bevel=0.03, seg=1)
    return p.finish(smooth_angle=45)


def tool_waterflosser():
    """Tier 3 Water Flosser: white wand with a blue button, angled nozzle and a hose."""
    p = Part('tool_waterflosser')
    white, blue, chrome, grey = M('White'), M('Blue'), M('Chrome'), M('Grey')
    p.lathe([(0.0, 0.0), (0.035, 0.0), (0.06, 0.12), (0.07, 0.2), (0.0, 0.22)], chrome, verts=12)
    nozzle = [(0, 0.15, 0), (0, 0.5, -0.12), (0, 1.1, -0.32), (0, 1.9, -0.4), (0, 2.6, -0.4)]
    p.sweep(nozzle, 0.08, white, verts=12, radii=[0.06, 0.07, 0.08, 0.09, 0.1])
    p.cyl(0.17, 0.25, (0, 2.6, -0.4), blue, axis='Y', verts=16, bevel=0.04, seg=2)
    prof = [(0.0, 2.7), (0.2, 2.7), (0.36, 3.2), (0.4, 4.2), (0.38, 6.6), (0.3, 7.3), (0.0, 7.35)]
    p.lathe(prof, white, verts=20, loc=(0, 0, -0.4))
    p.cyl(0.405, 0.12, (0, 3.35, -0.4), blue, axis='Y', verts=20)
    p.box((0.2, 0.55, 0.14), (0, 4.4, -0.03), blue, bevel=0.06, seg=2)
    hose = [(0, 7.3, -0.4), (0, 7.8, -0.38), (0.12, 8.3, -0.2), (0.4, 8.7, 0.05), (0.8, 8.9, 0.1)]
    p.sweep(hose, 0.12, grey, verts=10, cap_round=1)
    # a bead of water at the nozzle tip
    p.sphere(0.07, (0, -0.07, 0), M('Water'), seg=10, rings=6)
    return p.finish(smooth_angle=45)


# ------------------------------------------------------------------ suction and rinse

def helix(y0, y1, r, turns, n, cz=0.0, path=None):
    pts = []
    for k in range(n + 1):
        t = k / n
        a = 2 * math.pi * turns * t
        pts.append((r * math.cos(a), y0 + (y1 - y0) * t, cz + r * math.sin(a)))
    return pts


def tool_suction():
    """Tier 1 Saliva Ejector: a clear bendy tube with a wire inside and a blue tip."""
    p = Part('tool_suction')
    blue, clear, white, grey, greyd = M('Blue'), M('ClearTube'), M('White'), M('Grey'), M('GreyDark')
    p.lathe([(0.0, 0.0), (0.14, 0.0), (0.2, 0.05), (0.21, 0.3), (0.18, 0.55), (0.0, 0.55)], blue, verts=18)
    for k in range(6):  # holes in the tip
        a = k * math.pi / 3
        p.sphere(0.045, (0.2 * math.cos(a), 0.24, 0.2 * math.sin(a)), M('Ink'), seg=8, rings=5)
    path = [(0, 0.5, 0), (0, 1.2, 0.02), (0, 2.2, 0.15), (0, 3.2, 0.3), (0, 4.3, 0.28), (0, 5.3, 0.1), (0, 5.9, 0)]
    p.sweep(path, 0.16, clear, verts=14)
    # the bendy wire inside the tube
    wire = []
    import numpy as np
    P = [np.array(v) for v in path]
    seg_n = 60
    for k in range(seg_n + 1):
        t = k / seg_n * (len(P) - 1)
        i = min(int(t), len(P) - 2)
        f = t - i
        c = P[i] * (1 - f) + P[i + 1] * f
        a = 2 * math.pi * 7 * k / seg_n
        wire.append((c[0] + 0.09 * math.cos(a), c[1], c[2] + 0.09 * math.sin(a)))
    p.sweep(wire, 0.024, white, verts=5, caps=True)
    p.cyl(0.19, 0.5, (0, 6.1, 0), grey, axis='Y', verts=16, bevel=0.05, seg=2)
    p.cyl(0.22, 0.18, (0, 6.45, 0), greyd, axis='Y', verts=16)
    hose = [(0, 6.5, 0), (0, 7.2, 0), (0.1, 8.0, 0.15), (0.35, 8.7, 0.35), (0.7, 9.1, 0.4)]
    p.sweep(hose, 0.15, grey, verts=12, cap_round=1)
    return p.finish(smooth_angle=45)


def tool_hve():
    """Tier 2 High-Volume Evacuator: a wide tube with a bevelled mouth, valve and lever."""
    import bmesh
    p = Part('tool_hve')
    white, grey, greyd, blue = M('White'), M('Grey'), M('GreyDark'), M('Blue')
    # hollow wide tube, mouth cut at an angle
    tmp = Part('tmp')
    ro, ri, L = 0.34, 0.27, 4.2
    tmp.lathe([(ri, L), (ri, 0.0), (ro, 0.0), (ro, L)], white, verts=24, close_ends=False)
    bm = tmp.bm
    for v in bm.verts:
        if v.co.y < 0.01:
            v.co.y = 0.32 * (v.co.z / ro) + 0.32
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, -0.32 * 0 - 0.0, 0)), verts=bm.verts)
    part_verts = [tuple(v.co) for v in bm.verts]
    idx = {v: i for i, v in enumerate(bm.verts)}
    faces = [[idx[v] for v in f.verts] for f in bm.faces]
    bm.free()
    p.add_mesh(part_verts, faces, white)
    # mouth at the origin: the cut's center sits at y = 0.32 -> shift the part so the center is at 0
    p.transform(loc=(0, -0.32, 0))
    # a dark plug a little way down the tube so the mouth reads as a hole
    p.cyl(ri * 0.99, 0.05, (0, 0.9, 0), M('Ink'), axis='Y', verts=24)
    p.cyl(ro * 1.04, 0.3, (0, 2.3, 0), M('Teal'), axis='Y', verts=24)
    p.cyl(0.37, 0.35, (0, L - 0.32 - 0.1, 0), grey, axis='Y', verts=24, bevel=0.05, seg=2)
    prof = [(0.0, L - 0.4), (0.3, L - 0.4), (0.36, L - 0.1), (0.36, L + 1.4), (0.3, L + 1.6), (0.0, L + 1.62)]
    p.lathe(prof, grey, verts=22)
    # valve lever
    p.box((0.16, 1.1, 0.14), (0, L + 0.6, 0.45), blue, bevel=0.06, seg=2, rot=(-8, 0, 0))
    p.cyl(0.08, 0.3, (0, L + 1.1, 0.36), greyd, axis='X', verts=10)
    hose = [(0, L + 1.55, 0), (0, L + 2.3, 0.0), (0.12, L + 3.1, 0.2), (0.4, L + 3.7, 0.45), (0.8, L + 4.0, 0.5)]
    p.sweep(hose, 0.24, greyd, verts=14, cap_round=1)
    return p.finish(smooth_angle=45)


def tool_syringe():
    """Tier 1 Air-Water Syringe: a metal pistol grip, two buttons and a long angled nozzle."""
    p = Part('tool_syringe')
    steel, dark, chrome, blue, white = M('Steel'), M('SteelDark'), M('Chrome'), M('Blue'), M('White')
    nozzle = [(0, 0.0, 0.0), (0, 0.35, -0.1), (0, 1.1, -0.36), (0, 2.1, -0.46), (0, 2.8, -0.46)]
    p.sweep(nozzle, 0.06, chrome, verts=10, radii=[0.04, 0.045, 0.055, 0.06, 0.07], cap_round=1)
    p.cyl(0.13, 0.35, (0, 2.8, -0.46), dark, axis='Y', verts=14, bevel=0.03, seg=2)
    # head block with the two buttons on the thumb side (+Z)
    p.box((0.8, 1.5, 0.9), (0, 3.6, -0.46), steel, bevel=0.26, seg=3)
    p.cyl(0.17, 0.2, (-0.17, 3.3, -0.02), blue, axis='Z', verts=16, bevel=0.05, seg=2)
    p.cyl(0.17, 0.2, (0.17, 3.85, -0.02), white, axis='Z', verts=16, bevel=0.05, seg=2)
    # pistol grip, angled back toward the palm
    grip = [(0, 4.1, -0.5), (0, 5.2, -0.2), (0, 6.5, 0.3), (0, 7.8, 0.8), (0, 8.4, 1.0)]
    p.sweep(grip, 0.38, steel, verts=16, radii=[0.36, 0.4, 0.42, 0.4, 0.34], rscale=(1.0, 0.82), up=(1, 0, 0),
            cap_round=3)
    for k in range(4):
        y = 5.4 + k * 0.55
        z = -0.2 + (y - 5.2) * 0.38
        p.cyl(0.43, 0.1, (0, y, z), dark, axis='Y', verts=16, rot=(-21, 0, 0))
    hose = [(0, 8.4, 1.0), (0, 8.8, 1.2), (0.1, 9.1, 1.4)]
    p.sweep(hose, 0.13, M('Grey'), verts=10, cap_round=1)
    return p.finish(smooth_angle=45)


# ------------------------------------------------------------------ case tools (whitening, sealants)

def tool_gelbrush():
    """Gel Brush: a slim applicator with a teal handle, a bendable white neck and a soft white brush tip."""
    p = Part('tool_gelbrush')
    teal, mint, white, chrome = M('Teal'), M('Mint'), M('White'), M('Chrome')
    bristle = lib.material('Bristle', '#FFFFFF', 0.85, 0.0)
    gel = lib.material('Gel', '#BFF5EA', 0.08, 0.0, alpha=0.55)
    # the soft tip: a plump rounded tuft, tip at the origin, with a few splayed bristle bundles
    p.lathe([(0.0, 0.0), (0.1, 0.03), (0.18, 0.14), (0.21, 0.3), (0.2, 0.48), (0.15, 0.62), (0.0, 0.66)],
            bristle, verts=18)
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        p.sweep([(0.12 * math.cos(a), 0.58, 0.12 * math.sin(a)), (0.17 * math.cos(a), 0.28, 0.17 * math.sin(a)),
                 (0.14 * math.cos(a), 0.05, 0.14 * math.sin(a))], 0.045, bristle, verts=6, cap_round=1)
    # a bead of glossy gel loaded on the tip
    p.sphere(0.11, (0.0, 0.16, 0.12), gel, seg=12, rings=8, scale=(1.1, 0.9, 0.8))
    # ferrule and the bendable neck (angled like the other hand instruments)
    taper(p, 0.6, 0.15, 0.95, 0.08, chrome, verts=14)
    neck = [(0, 0.92, 0), (0, 1.35, 0.05), (0, 1.85, 0.22), (0, 2.4, 0.3), (0, 2.85, 0.3)]
    p.sweep(neck, 0.06, white, verts=10, radii=[0.06, 0.062, 0.068, 0.078, 0.09])
    # slim teal handle with soft mint grip rings and a rounded end
    taper(p, 2.8, 0.09, 3.3, 0.21, teal, loc=(0, 0, 0.3), verts=16)
    prof = [(0.0, 3.25), (0.21, 3.25), (0.23, 3.6), (0.23, 7.9), (0.2, 8.4), (0.0, 8.5)]
    p.lathe(prof, teal, verts=18, loc=(0, 0, 0.3))
    for k in range(7):
        p.cyl(0.245, 0.12, (0, 3.75 + k * 0.28, 0.3), mint, axis='Y', verts=18, bevel=0.03, seg=2)
    p.cyl(0.235, 0.18, (0, 7.2, 0.3), white, axis='Y', verts=18)
    dome(p, 8.45, 0.08, mint, h=0.1, loc=(0, 0, 0.3))
    return p.finish(smooth_angle=45)


def tool_uvlamp():
    """UV Lamp: a curing light wand. The bent light guide ends in the glowing blue tip at the origin; an
    orange eye shield sits on the guide; white body with a teal band and button. LampBody, LampGlow (emissive)."""
    p = Part('tool_uvlamp')
    body = lib.material('LampBody', '#F4F7F8', 0.35, 0.0)
    glowm = glow('LampGlow', '#58B4FF', 2.6)
    guide = lib.material('LightGuide', '#34424E', 0.2, 0.1)
    shield = lib.material('Shield', '#FF8A3D', 0.2, 0.0, alpha=0.6, double=True)
    teal, mint, grey = M('Teal'), M('Mint'), M('GreyDark')
    # glowing tip: a short bright lens facing -Y at the origin
    p.cyl(0.16, 0.08, (0, 0.04, 0), glowm, axis='Y', verts=20, bevel=0.02, seg=2)
    p.cyl(0.175, 0.1, (0, 0.12, 0), guide, axis='Y', verts=20)
    # light guide: a stout fiber rod bending back toward the handle
    rod = [(0, 0.15, 0), (0, 0.8, 0.02), (0, 1.35, -0.12), (0, 1.8, -0.4), (0, 2.2, -0.62), (0, 2.6, -0.7)]
    p.sweep(rod, 0.13, guide, verts=16, radii=[0.14, 0.13, 0.13, 0.135, 0.15, 0.17])
    # orange eye shield: a shallow cone clipped on the rod
    p.lathe([(0.12, 0.0), (0.55, 0.12), (0.57, 0.16), (0.14, 0.05)], shield, verts=28, loc=(0, 0.72, 0.02))
    p.cyl(0.16, 0.12, (0, 0.74, 0.02), grey, axis='Y', verts=16)
    # head: the rod enters a rounded nose with a thin glowing ring
    z0 = -0.7
    taper(p, 2.5, 0.18, 3.2, 0.42, body, loc=(0, 0, z0), verts=22)
    p.cyl(0.43, 0.06, (0, 3.2, z0), glowm, axis='Y', verts=22)
    prof = [(0.0, 3.2), (0.44, 3.2), (0.48, 3.7), (0.47, 5.4), (0.42, 7.2), (0.44, 8.3), (0.38, 8.8), (0.0, 8.85)]
    p.lathe(prof, body, verts=24, loc=(0, 0, z0))
    p.cyl(0.485, 0.35, (0, 5.0, z0), teal, axis='Y', verts=24)
    p.cyl(0.445, 0.5, (0, 8.1, z0), grey, axis='Y', verts=24)
    # trigger button on the thumb side (+Z) and a little blue status light
    p.box((0.22, 0.6, 0.16), (0, 4.1, z0 + 0.44), teal, bevel=0.07, seg=2)
    p.sphere(0.06, (0, 4.65, z0 + 0.46), glowm, seg=10, rings=6)
    p.box((0.28, 0.32, 0.08), (0, 5.65, z0 + 0.45), mint, bevel=0.03, seg=2)
    return p.finish(smooth_angle=45)


# ------------------------------------------------------------------ extras (display models)

def extra_headlamp():
    """LED Headlamp: an elastic head strap with a glowing lamp."""
    p = Part('extra_headlamp')
    strap, teal, white = M('Teal'), M('Mint'), M('White')
    ring = [(3.0 * math.cos(a), 0.0, 3.4 * math.sin(a)) for a in [2 * math.pi * k / 40 for k in range(40)]]
    p.sweep(ring, 0.4, strap, verts=8, closed=True, rscale=(0.35, 1.0), up=(0, 1, 0))
    top = [(0.0, 0.3 + 2.4 * math.sin(a) * 0.95, 3.4 * math.cos(a) * 0.98) for a in [math.pi * k / 16 for k in range(17)]]
    top = [(x, y, z) for (x, y, z) in top]
    p.sweep(top, 0.3, strap, verts=8, rscale=(1.0, 0.35), up=(0, 0, 1))
    # lamp housing at the front (+Z)
    p.box((1.9, 1.3, 0.9), (0, 0.1, 3.75), white, bevel=0.3, seg=3)
    p.box((2.0, 0.3, 0.95), (0, -0.45, 3.75), teal, bevel=0.12, seg=2)
    p.cyl(0.5, 0.2, (0, 0.15, 4.25), M('Chrome'), axis='Z', verts=20, bevel=0.06, seg=2)
    p.cyl(0.4, 0.1, (0, 0.15, 4.35), M('Light'), axis='Z', verts=20)
    p.cyl(0.12, 0.3, (0.75, 0.55, 3.8), teal, axis='Y', verts=12)
    return p.finish(smooth_angle=40)


def extra_disclosing():
    """Disclosing Solution: a squat magenta dropper bottle with a label."""
    p = Part('extra_disclosing')
    mag, white, label, mint = M('Magenta'), M('White'), M('Label'), M('Mint')
    prof = [(0.0, 0.0), (1.1, 0.0), (1.25, 0.15), (1.3, 0.5), (1.3, 2.4), (1.2, 2.8), (0.8, 3.15), (0.55, 3.3),
            (0.55, 3.5), (0.0, 3.5)]
    p.lathe(prof, mag, verts=28)
    p.lathe([(0.0, 0.9), (1.33, 0.9), (1.33, 2.2), (0.0, 2.2)], label, verts=28)
    p.lathe([(0.0, 1.35), (1.345, 1.35), (1.345, 1.75), (0.0, 1.75)], mint, verts=28)
    # dropper cap and bulb
    p.cyl(0.62, 0.7, (0, 3.75, 0), white, axis='Y', verts=22, bevel=0.1, seg=2)
    for k in range(10):
        a = 2 * math.pi * k / 10
        p.box((0.08, 0.6, 0.08), (0.64 * math.cos(a), 3.75, 0.64 * math.sin(a)), white, rot=(0, -math.degrees(a), 0))
    p.lathe([(0.0, 4.05), (0.42, 4.05), (0.5, 4.4), (0.48, 4.9), (0.3, 5.3), (0.0, 5.4)], M('Rubber'), verts=20)
    # a little drop on the label
    p.sphere(0.25, (0, 1.55, 1.33), mag, seg=14, rings=10, scale=(0.8, 1.0, 0.35))
    return p.finish(smooth_angle=40)


def extra_headphones():
    """Patient Headphones: over-ear, mint band, white cups, soft cushions."""
    p = Part('extra_headphones')
    mint, white, cush, teal = M('Mint'), M('White'), M('Cushion'), M('Teal')
    band = [(3.0 * math.cos(a), 3.0 * math.sin(a) + 0.3, 0) for a in [math.pi * k / 24 for k in range(25)]]
    p.sweep(band, 0.3, mint, verts=10, rscale=(1.0, 0.45), up=(0, 0, 1))
    pad = [(2.55 * math.cos(a), 2.55 * math.sin(a) + 0.3, 0) for a in [math.pi * (0.2 + 0.6 * k / 12) for k in range(13)]]
    p.sweep(pad, 0.28, cush, verts=10, rscale=(1.0, 0.5), up=(0, 0, 1))
    for sx in (-1, 1):
        p.box((0.3, 1.3, 0.4), (sx * 3.0, -0.2, 0), teal, bevel=0.12, seg=2)
        p.cyl(1.3, 0.8, (sx * 3.15, -1.2, 0), white, axis='X', verts=28, bevel=0.3, seg=3)
        p.cyl(1.1, 0.5, (sx * 2.6, -1.2, 0), cush, axis='X', verts=28, bevel=0.22, seg=3)
        p.cyl(0.55, 0.1, (sx * 3.6, -1.2, 0), mint, axis='X', verts=24)
    return p.finish(smooth_angle=40)


def extra_loupes():
    """Magnifying Loupes: teal glasses with two short chrome telescopes."""
    p = Part('extra_loupes')
    frame, chrome, lens, ink = M('Teal'), M('Chrome'), M('Lens'), M('Ink')
    for sx in (-1, 1):
        cx = sx * 1.3
        rim = [(cx + 1.05 * math.cos(a), 0.9 * math.sin(a), 0) for a in [2 * math.pi * k / 32 for k in range(32)]]
        p.sweep(rim, 0.15, frame, verts=10, closed=True)
        p.cyl(1.0, 0.06, (cx, 0, -0.02), lens, axis='Z', verts=32, scale=(1.0, 0.86, 1.0))
        # telescope barrel through the lens, pointing forward
        p.lathe([(0.0, -0.15), (0.34, -0.15), (0.4, 0.0), (0.4, 0.95), (0.5, 1.05), (0.5, 1.35), (0.0, 1.35)], chrome,
                verts=24, loc=(cx, -0.05, 0.0), axis='Z')
        p.cyl(0.52, 0.16, (cx, -0.05, 0.62), ink, axis='Z', verts=24)
        p.cyl(0.42, 0.04, (cx, -0.05, 1.36), lens, axis='Z', verts=24)
        arm = [(sx * 2.38, 0.35, 0), (sx * 2.55, 0.4, -0.5), (sx * 2.6, 0.4, -3.0), (sx * 2.5, -0.25, -3.8)]
        p.sweep(arm, 0.12, frame, verts=8, cap_round=1)
    bridge = [(-0.28, 0.45, 0), (0, 0.72, 0.05), (0.28, 0.45, 0)]
    p.sweep(bridge, 0.13, frame, verts=8)
    return p.finish(smooth_angle=40)


TOOLS = {
    'tool_scaler': tool_scaler, 'tool_curette': tool_curette, 'tool_titanium': tool_titanium,
    'tool_ultrasonic': tool_ultrasonic, 'tool_piezo': tool_piezo,
    'tool_polisher': tool_polisher, 'tool_cordless': tool_cordless, 'tool_airpolisher': tool_airpolisher,
    'tool_floss': tool_floss, 'tool_flosspick': tool_flosspick, 'tool_waterflosser': tool_waterflosser,
    'tool_suction': tool_suction, 'tool_hve': tool_hve, 'tool_syringe': tool_syringe,
    'tool_gelbrush': tool_gelbrush, 'tool_uvlamp': tool_uvlamp,
    'extra_headlamp': extra_headlamp, 'extra_disclosing': extra_disclosing, 'extra_headphones': extra_headphones,
    'extra_loupes': extra_loupes,
}

# thumbnail camera direction per key (three.js space, where the camera sits relative to the model)
THUMB_VIEW = {
    'extra_headlamp': (0.9, 0.9, 1.4),
    'extra_disclosing': (0.7, 0.5, 1.3),
    'extra_headphones': (0.5, 0.35, 1.3),
    'extra_loupes': (0.55, 0.45, 1.3),
}


def builders():
    return dict(TOOLS)


def pose_for_thumb(key=None):
    """Lay a tool on the diagonal of the square (tip bottom-left, handle top-right), turned a little so
    its working end shows in 3/4. Extras keep their pose."""
    if key and key.startswith('extra_'):
        return
    R3 = Matrix.Rotation(rad(-42), 4, 'Z') @ Matrix.Rotation(rad(-35), 4, 'Y')
    T = lib.TO_BLENDER
    for o in lib.mesh_objects():
        if o.parent is None:
            o.matrix_world = T @ R3 @ T.inverted() @ o.matrix_world


def render_thumb(key):
    lib.setup_studio(256, samples=48)
    pose_for_thumb(key)
    import bpy
    bpy.context.view_layer.update()
    view = THUMB_VIEW.get(key, (0.2, 0.25, 1.0))
    lib.frame_camera(direction=view, fill=0.86, lens=70)
    path = os.path.join(lib.THUMBS_DIR, key + '.png')
    lib.render_to(path)
    # undo the pose so later steps see the model as exported
    if not key.startswith('extra_'):
        R3 = Matrix.Rotation(rad(-42), 4, 'Z') @ Matrix.Rotation(rad(-35), 4, 'Y')
        T = lib.TO_BLENDER
        for o in lib.mesh_objects():
            if o.parent is None:
                o.matrix_world = T @ R3.inverted() @ T.inverted() @ o.matrix_world
        import bpy
        bpy.context.view_layer.update()
    return path
