# End-game models for the diorama (docs/DESIGN.md 11): smile_van, trophy_golden_molar, plaque_frame, prop_ribbon.
# Blender space: front toward -Y, Z up, meters. build.py recenters each model on its footprint.
#
#   smile_van            a cute teal-and-white van, about 3.0 m long, nose toward -Y (three.js +Z), a big smiling
#                        tooth on the roof, SMILE VAN on both sides. Root mesh SmileVan (the body) with four wheel
#                        nodes WheelFL, WheelFR, WheelBL, WheelBR (pivot at the hub, identity rotation: spin them
#                        about the model's X axis to drive). F = front (the nose), L = the -X side (three.js -X).
#   trophy_golden_molar  a golden molar on a black-and-gold plinth, about 0.55 m tall. One mesh.
#   plaque_frame         a 0.35 x 0.28 m wall frame with a generic certificate. Wall-mounted like `certificate`:
#                        modelled at its mounting height (center 1.5 m up), the wall side toward +Y (three.js -Z),
#                        the depth centered on the origin. Material Frame is the tintable frame (gold by default).
#   prop_ribbon          a red ribbon with a big bow between two brass stanchions, spanning about 2 m along X.
#                        Root mesh Posts (the stanchions) with two children RibbonL (-X half, pivot where it is tied
#                        to the left post) and RibbonR (+X half, pivot at the right post), identity rotations: after
#                        the snip, rotate each half down about the model's Z axis (three.js; Blender -Y) so it
#                        droops against its post. The bow's knot rides with RibbonL; each half carries one loop and
#                        one tail, so the cut in the middle reads as cutting the bow in two.
import importlib.util
import math
import os
import bmesh
from mathutils import Vector
from lib import Part, M, material, tooth2d, rrect, ellipse
from operatory import glow, grin2d
from front import star2d
from props import stanchion

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mouth_implicit', os.path.join(HERE, '..', 'mouth', 'implicit.py'))
im = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(im)

TAU = 2 * math.pi


# ------------------------------------------------------------------ a 3D cartoon molar (shared by the van and trophy)

def _molar_fn():
    """Crown SDF in a unit frame (Z up): a soft body with four cusps on top, flat-ish bottom where the roots start."""
    import numpy as np
    lumps = [((0.0, 0.0, 0.42), (0.5, 0.42, 0.34)),
             ((-0.2, -0.16, 0.66), (0.2, 0.19, 0.17)), ((0.2, -0.16, 0.66), (0.2, 0.19, 0.17)),
             ((-0.2, 0.17, 0.64), (0.2, 0.18, 0.16)), ((0.2, 0.17, 0.64), (0.2, 0.18, 0.16))]

    def f(P):
        d = None
        for c, r in lumps:
            e = im.ellipsoid(P, c, r)
            d = e if d is None else im.smin(d, e, 0.12)
        return im.smax(d, 0.14 - P[:, 2], 0.08)
    return f


def molar(p, loc, s, m_crown, m_root=None, n=9):
    """A chunky cartoon molar standing on (loc), crown up, s = scale (the whole tooth is about 1.1 s tall and
    s wide). Returns (crown SDF, center) so faces can be laid on the crown."""
    import numpy as np
    m_root = m_root or m_crown
    f = _molar_fn()
    P, quads = im.mesh_star(f, (0.0, 0.0, 0.45), (0.5, 0.42, 0.36), n=n, relax=4)
    tmp = bmesh.new()
    vs = [tmp.verts.new(Vector((loc[0] + x * s, loc[1] + y * s, loc[2] + (z + 0.3) * s))) for (x, y, z) in P]
    for q in quads:
        try:
            tmp.faces.new([vs[i] for i in q])
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    p._emit(tmp, m_crown, False)
    # two rounded roots, splayed a little
    for sx in (-1, 1):
        a = Vector((loc[0] + sx * 0.2 * s, loc[1], loc[2] + 0.52 * s))
        b = Vector((loc[0] + sx * 0.3 * s, loc[1], loc[2] + 0.1 * s))
        p.capsule(b, a, 0.1 * s, m_root, verts=12, rings=3, r2=0.17 * s)
    return f, np.array([0.0, 0.0, 0.45]), s, loc


def on_crown(mol, d, lift=0.0):
    """World point on the crown surface in direction d (unit frame) from the crown center."""
    import numpy as np
    f, c, s, loc = mol
    D = np.array([d], dtype=float)
    D /= np.linalg.norm(D, axis=1)[:, None]
    t = im._raycast(f, c, D, 1.2)[0]
    q = c + D[0] * (t + lift)
    return (loc[0] + q[0] * s, loc[1] + q[1] * s, loc[2] + (q[2] + 0.3) * s)


# ------------------------------------------------------------------ smile van

def smile_van():
    """A cute two-tone van: teal lower body, white upper body with a mint stripe, round headlight eyes, a smiling
    grille, sky-blue windows, SMILE VAN on both sides and a big smiling tooth on a roof rack."""
    p = Part('SmileVan')
    teal, white, mint = M('Teal'), M('Enamel'), M('Mint')
    ink, slate, chrome = M('Ink'), M('Slate'), M('Chrome')
    glass = material('VanGlass', '#9FD8EE', 0.18, 0.0)
    L, W = 3.0, 1.62
    z0, zs, z1 = 0.3, 1.05, 1.9            # body bottom, two-tone seam, roof
    # lower body, stripe, upper body (a little narrower and rounder on top)
    p.rbox((W, L, zs - z0 + 0.06), (0, 0, (z0 + zs) / 2), teal, r=0.14, seg=2)
    p.rbox((W + 0.02, L + 0.02, 0.07), (0, 0, zs + 0.02), mint, r=0.03, seg=1)
    p.rbox((W - 0.04, L - 0.06, z1 - zs), (0, 0.02, (zs + z1) / 2 + 0.02), white, r=0.17, seg=2)
    # windshield, cab side windows, big side windows, a rear window (all on the flat parts of the body)
    yf = -L / 2 + 0.03
    zw = zs + 0.5
    p.plate(rrect(W - 0.4, 0.5, 0.12, 3), 0.03, (0, yf - 0.02, zw), glass, axis='Y')
    for sx in (-1, 1):
        x = sx * ((W - 0.04) / 2 + 0.004)
        mk = p.mark()
        p.plate(rrect(0.46, 0.42, 0.1, 2), 0.03, (0, 0, 0), glass, axis='Y')
        p.xform_since(mk, loc=(x, -L / 2 + 0.5, zw), rot=(0, 0, 90))
        mk = p.mark()
        p.plate(rrect(1.05, 0.4, 0.12, 2), 0.03, (0, 0, 0), glass, axis='Y')
        p.xform_since(mk, loc=(x, 0.5, zw), rot=(0, 0, 90))
        # a mint tooth logo between the windows
        mk = p.mark()
        p.plate(tooth2d(0.2, 0.24), 0.02, (0, 0, 0), mint, axis='Y')
        p.xform_since(mk, loc=(x + sx * 0.006, -0.38, zw), rot=(0, 0, 90))
        # SMILE VAN in white along the teal, between the wheels, above the wheel tops
        xl = sx * (W / 2 + 0.004)
        p.text('SMILE VAN', 0.25, (xl + sx * 0.006, 0.02 * sx, 0.63), white, depth=0.0, rot=(90, 0, 90 * sx), res=1)
    p.plate(rrect(W - 0.5, 0.36, 0.1, 2), 0.03, (0, L / 2 - 0.02 + 0.03, zw), glass, axis='Y')
    # headlight eyes with chrome rims and a sparkle, a smiling grille between them, bumpers
    for sx in (-1, 1):
        x = sx * 0.5
        p.cyl(0.15, 0.05, (x, yf - 0.02, 0.78), chrome, axis='Y', verts=18)
        p.cyl(0.12, 0.05, (x, yf - 0.045, 0.78), glow('Headlight', '#FFF3C4', 1.2), axis='Y', verts=18)
        p.sphere(0.03, (x + 0.04, yf - 0.075, 0.82), M('EyeShine'), seg=6, rings=4, scale=(1, 0.5, 1))
    p.plate(grin2d(0.46, 0.2, n=10), 0.03, (0, yf - 0.02, 0.62), ink, axis='Y')
    p.plate([(-0.19, -0.001), (0.19, -0.001), (0.18, -0.06), (-0.18, -0.06)], 0.02, (0, yf - 0.035, 0.62), white,
            axis='Y')
    for sy in (-1, 1):
        p.rbox((W + 0.06, 0.16, 0.16), (0, sy * (L / 2 + 0.02), 0.38), slate, r=0.06, seg=1)
    # tail lights
    for sx in (-1, 1):
        p.rbox((0.16, 0.03, 0.1), (sx * 0.58, L / 2 + 0.01, 0.78), glow('TailLight', '#FF6F7F', 0.8), r=0.03, seg=1)
    # roof rack and the big smiling tooth
    for sx in (-1, 1):
        p.rbox((0.06, 1.3, 0.05), (sx * 0.5, 0.1, z1 + 0.02), slate, r=0.02, seg=1)
    p.rbox((1.1, 0.9, 0.08), (0, 0.1, z1 + 0.07), teal, r=0.03, seg=1)
    mol = molar(p, (0, 0.1, z1 + 0.11), 0.92, white, n=7)
    for sx in (-1, 1):
        e = on_crown(mol, (sx * 0.28, -1.0, 0.1), 0.0)
        p.sphere(0.055, e, ink, seg=12, rings=8, scale=(0.85, 0.55, 1.1))
        p.sphere(0.017, (e[0] + 0.018, e[1] - 0.03, e[2] + 0.025), M('EyeShine'), seg=6, rings=4)
        ch = on_crown(mol, (sx * 0.52, -1.0, -0.2), 0.0)
        p.sphere(0.045, ch, M('Cheek'), seg=8, rings=5, scale=(1.0, 0.4, 0.7))
    grin = [on_crown(mol, (x, -1.0, -0.14 - 0.25 * (1 - (x / 0.3) ** 2)), 0.0) for x in (-0.3, -0.18, -0.06, 0.06, 0.18, 0.3)]
    p.sweep(grin, 0.016, M('Mouth'), verts=6)
    for (x, z, r) in ((-0.52, z1 + 0.95, 0.07), (0.5, z1 + 0.78, 0.05)):
        p.plate(star2d(r, r * 0.35, 4), 0.02, (x, 0.1, z), glow('Sparkle', '#FFE9A6', 0.9), axis='Y')
    body = p.finish()
    # wheels: separate nodes, pivot at the hub
    for name, sx, sy in (('WheelFL', -1, -1), ('WheelFR', 1, -1), ('WheelBL', -1, 1), ('WheelBR', 1, 1)):
        hub = (sx * (W / 2 - 0.1), sy * (L / 2 - 0.62), 0.3)
        w = Part(name)
        w.cyl(0.3, 0.24, hub, M('Rubber'), axis='X', verts=16, bevel=0.05, seg=1)
        w.cyl(0.17, 0.25, hub, M('Enamel'), axis='X', verts=14)
        w.cyl(0.07, 0.27, hub, mint, axis='X', verts=10)
        w.finish(origin=hub, parent=body)
    return body


# ------------------------------------------------------------------ golden molar trophy

def trophy_golden_molar():
    """The Golden Molar: a shiny gold cartoon molar on a gold stem and a black-and-gold stepped plinth with a
    gold nameplate and a star."""
    p = Part('GoldenMolar')
    gold = M('Gold')
    black = material('TrophyBlack', '#1E272E', 0.3, 0.1)
    p.rbox((0.34, 0.34, 0.08), (0, 0, 0.04), black, r=0.015, seg=2)
    p.rbox((0.355, 0.355, 0.014), (0, 0, 0.083), gold, r=0.006, seg=1)
    p.rbox((0.26, 0.26, 0.1), (0, 0, 0.14), black, r=0.012, seg=2)
    p.rbox((0.27, 0.27, 0.012), (0, 0, 0.195), gold, r=0.005, seg=1)
    # nameplate and star on the front
    p.plate(rrect(0.18, 0.05, 0.008, 1), 0.006, (0, -0.132, 0.14), gold, axis='Y')
    for k in range(2):
        p.box((0.12 - k * 0.04, 0.004, 0.006), (0, -0.136, 0.148 - k * 0.016), black)
    p.plate(star2d(0.022, 0.009, 5), 0.006, (0, -0.172, 0.045), gold, axis='Y')
    # stem: a short fluted gold column with a collar
    p.lathe([(0.0, 0.2), (0.075, 0.2), (0.06, 0.215), (0.028, 0.235), (0.024, 0.26), (0.1, 0.285), (0.09, 0.3),
             (0.0, 0.3)], (0, 0, 0), gold, segs=20)
    mol = molar(p, (0, 0, 0.29), 0.23, gold, n=10)
    # two small sparkles glinting off the crown
    for (d, r) in (((0.55, -0.6, 0.5), 0.02), ((-0.6, -0.5, 0.15), 0.014)):
        c = on_crown(mol, d, 0.2)
        p.plate(star2d(r, r * 0.3, 4), 0.004, c, glow('Sparkle', '#FFF3C4', 1.2), axis='Y')
    return p.finish()


# ------------------------------------------------------------------ plaque frame

def plaque_frame():
    """A small framed certificate for the trophy wall: tintable frame, cream certificate with a tooth crest, a title
    bar, text lines, a signature and a gold seal with two ribbon tails. Center 1.5 m up, facing -Y."""
    p = Part('PlaqueFrame')
    zc = 1.5
    fw, fh = 0.35, 0.28
    frame = material('Frame', '#E9B84C', 0.35, 0.2)
    paper = material('Parchment', '#FFF6E0', 0.8, 0.0)
    ink, teal = M('Ink'), M('Teal')
    p.plate(rrect(fw, fh, 0.012, 2), 0.024, (0, 0, zc), frame, axis='Y', bevel=0.006, seg=1)
    p.plate(rrect(fw - 0.05, fh - 0.05, 0.004, 1), 0.024, (0, -0.004, zc), paper, axis='Y')
    y = -0.017
    p.plate(tooth2d(0.04, 0.042), 0.003, (0, y, zc + 0.078), teal, axis='Y')
    p.box((0.17, 0.003, 0.016), (0, y, zc + 0.04), teal)
    for k, wl in enumerate((0.22, 0.19, 0.2)):
        p.box((wl, 0.003, 0.006), (0, y, zc + 0.008 - k * 0.022), ink)
    p.sweep([(0.03, y - 0.001, zc - 0.085), (0.05, y - 0.001, zc - 0.072), (0.07, y - 0.001, zc - 0.09),
             (0.1, y - 0.001, zc - 0.074)], 0.003, ink, verts=4)
    sx, sz = -0.085, zc - 0.07
    for side in (-1, 1):
        p.plate([(side * 0.004, 0.0), (side * 0.02, -0.05), (side * 0.01, -0.044), (side * 0.0, -0.052),
                 (side * -0.008, 0.0)][::side], 0.003, (sx + side * 0.008, y + 0.001, sz), M('Bubblegum'), axis='Y')
    p.plate(star2d(0.032, 0.025, 12), 0.005, (sx, y - 0.003, sz), M('Gold'), axis='Y')
    return p.finish()


# ------------------------------------------------------------------ ribbon for openings

def _band(p, pts, m, r=0.05, thin=0.12):
    """A flat ribbon band along pts (vertical width 2r, thickness 2r * thin)."""
    p.sweep(pts, r, m, verts=8, rscale=(1.0, thin))


def _loop(cx, cz, sx, size=1.0):
    """Points of one bow loop leaving the knot at (cx, cz) toward sx (-1 left, +1 right), a rounded teardrop."""
    pts = []
    for i in range(13):
        a = TAU * i / 12
        # teardrop in (x, z): starts and ends at the knot
        x = sx * 0.13 * size * (1 - math.cos(a)) * (1.0 + 0.25 * math.sin(a))
        z = 0.1 * size * math.sin(a)
        pts.append((cx + x, -0.01 * math.sin(a), cz + z))
    return pts


def prop_ribbon():
    """A grand-opening ribbon: two brass stanchions about 2 m apart, a red satin ribbon with a gentle sag and a big
    bow in the middle. Separate halves RibbonL and RibbonR (see the header)."""
    brass = material('Brass', '#E9B84C', 0.3, 0.25)
    red = material('Ribbon', '#E0303F', 0.45, 0.0)
    posts = Part('Posts')
    X = 1.0
    for sx in (-1, 1):
        stanchion(posts, sx * X, 0.0, brass)
        # the ribbon's end wrapped around the post
        posts.torus(0.03, 0.012, (sx * X, 0.0, 0.86), red, segs=14, verts=6)
    root = posts.finish()
    z_post, z_mid = 0.86, 0.8
    for name, sx in (('RibbonL', -1), ('RibbonR', 1)):
        half = Part(name)
        pts = []
        n = 10
        for i in range(n + 1):
            t = i / n
            x = sx * (X - 0.03) * (1 - t) + sx * 0.03 * t
            z = z_post + (z_mid - z_post) * t - 0.035 * math.sin(math.pi * t)
            y = 0.012 * math.sin(TAU * t)
            pts.append((x, y, z))
        _band(half, pts, red)
        # one bow loop and one tail on each half
        _band(half, _loop(sx * 0.03, z_mid + 0.02, sx, 1.15), red, r=0.042)
        tail = [(sx * 0.04, -0.02, z_mid - 0.02), (sx * 0.09, -0.03, z_mid - 0.12), (sx * 0.12, -0.02, z_mid - 0.22),
                (sx * 0.16, -0.03, z_mid - 0.3)]
        _band(half, tail, red, r=0.04)
        if sx < 0:
            half.sphere(0.05, (0.0, -0.02, z_mid + 0.01), red, seg=12, rings=8, scale=(0.9, 0.7, 1.0))
            half.sphere(0.012, (-0.015, -0.055, z_mid + 0.03), material('Shine', '#FFFFFF', 0.3, 0.0, emit=0.2),
                        seg=6, rings=4)
        half.finish(origin=(sx * (X - 0.03), 0.0, z_post), parent=root)
    return root


MODELS = {
    'smile_van': dict(fn=smile_van, budget=120, preview_dir=(1.1, -1.3, 0.7)),
    'trophy_golden_molar': dict(fn=trophy_golden_molar, budget=120, preview_dir=(0.8, -1.4, 0.55)),
    'plaque_frame': dict(fn=plaque_frame, budget=120, preview_dir=(0.45, -1.4, 0.3)),
    'prop_ribbon': dict(fn=prop_ribbon, budget=120, preview_dir=(0.6, -1.4, 0.55)),
}
