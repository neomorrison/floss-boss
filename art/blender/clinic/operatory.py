# Operatory props and clinical equipment: op_lamp, op_cart, op_counter, op_monitor, op_tv, whitening_lamp,
# intraoral_cam, xray_unit, ultrasonic_cart, sterilizer.
# Blender space: front toward -Y, Z up, meters. build.py recenters each model on its footprint.
import math
from lib import Part, M, material, star_base, caster, tooth2d, rrect, ellipse, arc


def glow(name, color, strength=0.8):
    return material(name, color, 0.4, 0.0, emit=strength)


# ------------------------------------------------------------------ shared bits

def screen_panel(p, w, h, t=0.045, bezel='Slate', content=None, r=0.02):
    """A flat screen built at the origin facing -Y (bezel, glass, content). Pose it with xform_since."""
    p.rbox((w, t, h), (0, 0, 0), M(bezel), r=r, seg=2)
    p.box((w - 0.04, 0.006, h - 0.04), (0, -t / 2 - 0.001, 0), M('Screen'))
    if content:
        content(p, w - 0.04, h - 0.04, -t / 2 - 0.004)


def xray_content(p, w, h, y):
    g = glow('XrayGlow', '#CFF6F0', 0.9)
    p.plate(tooth2d(h * 0.46, h * 0.62), 0.003, (-w * 0.18, y - 0.0015, 0.0), g, axis='Y')
    p.plate(tooth2d(h * 0.4, h * 0.56), 0.003, (w * 0.1, y - 0.0015, -h * 0.02), g, axis='Y')
    for k, mat in enumerate(('Mint', 'Bubblegum', 'Sunshine')):
        m = glow('Ui' + mat, {'Mint': '#3DD6B5', 'Bubblegum': '#FF7AA8', 'Sunshine': '#FFD166'}[mat], 0.7)
        p.box((w * 0.16, 0.003, h * 0.07), (w * 0.36, y - 0.0015, h * 0.3 - k * h * 0.16), m)


def cartoon_content(p, w, h, y):
    """A cheerful cartoon on the screen: sky, rolling hill, sun, cloud."""
    sky = glow('SkyGlow', '#8FD6F6', 0.75)
    hill = glow('HillGlow', '#6BD88E', 0.7)
    sun = glow('SunGlow', '#FFD166', 0.9)
    cloud = glow('CloudGlow', '#FFFFFF', 0.7)
    p.box((w, 0.002, h), (0, y - 0.001, 0), sky)
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2)] + [(w / 2 - w * i / 10, -h * 0.12 + math.sin(i / 10 * math.pi) * h * 0.14
                                                  - (i / 10) * h * 0.08) for i in range(11)]
    p.plate(pts, 0.003, (0, y - 0.0035, 0), hill, axis='Y')
    p.plate(ellipse(h * 0.14, h * 0.14, 14), 0.003, (w * 0.3, y - 0.0035, h * 0.22), sun, axis='Y')
    for (dx, dz, r) in ((-0.1, 0.24, 0.1), (-0.02, 0.27, 0.12), (0.06, 0.24, 0.09)):
        p.plate(ellipse(h * r, h * r * 0.8, 10), 0.003, (w * dx - w * 0.12, y - 0.0035 - 0.0005 * (dx > 0), h * dz), cloud,
                axis='Y')


def smile_content(p, w, h, y):
    """A happy tooth mascot on a sky background (the waiting room show)."""
    sky = glow('SkyGlow', '#8FD6F6', 0.75)
    tooth = glow('ToothGlow', '#FFFDF7', 0.8)
    ink = material('InkGlow', '#2B3C45', 0.5, 0.0)
    pink = glow('PinkGlow', '#FF7AA8', 0.7)
    sun = glow('SunGlow', '#FFD166', 0.9)
    p.box((w, 0.002, h), (0, y - 0.001, 0), sky)
    p.plate(tooth2d(h * 0.62, h * 0.72), 0.003, (0, y - 0.0035, -h * 0.02), tooth, axis='Y')
    for s in (-1, 1):
        p.plate(ellipse(h * 0.035, h * 0.05, 8), 0.003, (s * h * 0.09, y - 0.0055, h * 0.06), ink, axis='Y')
        p.plate(ellipse(h * 0.04, h * 0.025, 8), 0.003, (s * h * 0.16, y - 0.0055, -h * 0.03), pink, axis='Y')
    p.plate(grin2d(h * 0.22, h * 0.1), 0.003, (0, y - 0.0055, -h * 0.06), ink, axis='Y')
    for (sx, sz, r) in ((0.34, 0.3, 0.05), (-0.36, 0.26, 0.035), (0.3, -0.26, 0.03)):
        star = []
        for i in range(8):
            a = math.pi / 2 + i * math.pi / 4
            rr = r * h if i % 2 == 0 else r * h * 0.35
            star.append((rr * math.cos(a), rr * math.sin(a)))
        p.plate(star, 0.003, (w * sx, y - 0.0035, h * sz), sun, axis='Y')


def grin2d(w, h, n=8):
    """A D-shaped open smile: straight top edge, half-ellipse below, centered on the top edge."""
    pts = [(w / 2 * math.cos(math.pi + math.pi * i / n), h * math.sin(math.pi + math.pi * i / n)) for i in range(n + 1)]
    return pts


def cart_frame(p, w, d, z_top, m_frame='Steel', r_caster=0.035, shelf=True, shelf_m='Enamel'):
    """Rolling cart frame: four posts on casters, optional lower shelf."""
    fr = M(m_frame)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - 0.03), sy * (d / 2 - 0.03)
            caster(p, x, y, r_caster)
            p.cyl(0.016, z_top - r_caster * 2.2, (x, y, r_caster * 2.2 + (z_top - r_caster * 2.2) / 2), fr, verts=8)
    if shelf:
        p.rbox((w - 0.02, d - 0.02, 0.025), (0, 0, 0.16), M(shelf_m), r=0.01, seg=2)


# ------------------------------------------------------------------ models

def op_lamp():
    """Overhead operatory light on a floor post: arm reaches toward the front (-Y) over the patient."""
    p = Part('OpLamp')
    white, mint = M('Enamel'), M('Mint')
    p.cyl(0.24, 0.05, (0, 0.3, 0.025), white, verts=24, bevel=0.018, seg=2)
    p.cyl(0.2, 0.02, (0, 0.3, 0.055), mint, verts=24)
    p.cyl(0.04, 1.95, (0, 0.3, 0.05 + 0.975), white, verts=12)
    p.cyl(0.05, 0.12, (0, 0.3, 0.5), mint, verts=12, bevel=0.01)
    p.sphere(0.06, (0, 0.3, 2.0), white, seg=12, rings=8)
    # arm out and over
    p.tube((0, 0.3, 2.0), (0, -0.3, 2.06), 0.035, white, verts=10)
    p.sphere(0.05, (0, -0.3, 2.06), mint, seg=12, rings=8)
    p.tube((0, -0.3, 2.06), (0, -0.62, 1.84), 0.03, white, verts=10)
    p.sphere(0.045, (0, -0.62, 1.84), white, seg=10, rings=6)
    # yoke holding the lamp head
    p.sweep([(-0.24, -0.62, 1.70), (-0.24, -0.62, 1.80), (0.24, -0.62, 1.80), (0.24, -0.62, 1.70)], 0.02, white,
            verts=8)
    p.tube((0, -0.62, 1.80), (0, -0.62, 1.84), 0.025, white, verts=8)
    # lamp head (oval dish tilted toward the front), glowing underside, side handles
    mk = p.mark()
    p.sphere(1.0, (0, 0, 0), white, seg=20, rings=10, scale=(0.22, 0.13, 0.08))
    p.cyl(1.0, 0.012, (0, 0, -0.06), M('Light'), verts=20, scale=(0.18, 0.1, 1.0))
    for s in (-1, 1):
        p.tube((s * 0.2, 0, 0), (s * 0.28, 0, -0.02), 0.018, mint, verts=8)
    p.xform_since(mk, loc=(0, -0.62, 1.68), rot=(-20, 0, 0))
    return p.finish()


def op_cart():
    """Instrument cart: drawers, a tray with tools, cups and cotton rolls, a push handle at the back."""
    p = Part('OpCart')
    w, d = 0.56, 0.42
    white, mint, steel, chrome = M('Enamel'), M('Mint'), M('Steel'), M('Chrome')
    for sx in (-1, 1):
        for sy in (-1, 1):
            caster(p, sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0.035)
    p.rbox((w, d, 0.62), (0, 0, 0.09 + 0.31), white, r=0.03, seg=2)
    for k in range(3):
        z = 0.2 + k * 0.17
        p.rbox((w - 0.06, 0.02, 0.14), (0, -d / 2 - 0.004, z), mint if k != 1 else M('MintLight'), r=0.012, seg=2)
        p.tube((-0.08, -d / 2 - 0.03, z + 0.03), (0.08, -d / 2 - 0.03, z + 0.03), 0.009, chrome, verts=6)
        for s in (-1, 1):
            p.tube((s * 0.08, -d / 2 - 0.014, z + 0.03), (s * 0.08, -d / 2 - 0.03, z + 0.03), 0.008, chrome, verts=6)
    # tray with a raised rim
    p.rbox((w + 0.04, d + 0.04, 0.03), (0, 0, 0.73), steel, r=0.012, seg=2)
    p.rbox((w - 0.02, d - 0.02, 0.012), (0, 0, 0.745), M('Sky'), r=0.01, seg=1)
    # tools laid out on the tray: mirror, scaler, explorer, probe
    for k, x in enumerate((-0.18, -0.12, -0.06, 0.0)):
        p.tube((x, -0.14, 0.76), (x, 0.1, 0.76), 0.007, chrome, verts=6)
        p.cyl(0.011, 0.07, (x, 0.02, 0.76), M('Teal') if k % 2 else steel, axis='Y', verts=8)
        if k == 0:
            p.cyl(0.02, 0.006, (x, -0.155, 0.765), chrome, axis='X', verts=12)
    # paper cups and cotton rolls
    for (x, y, m) in ((0.12, -0.08, 'Bubblegum'), (0.19, -0.08, 'Sunshine')):
        p.lathe([(0.0, 0.752), (0.022, 0.752), (0.03, 0.83), (0.0, 0.83)], (x, y, 0), M(m), segs=10)
    for k in range(3):
        p.cyl(0.011, 0.05, (0.12 + k * 0.026, 0.1, 0.763), M('Paper'), axis='Y', verts=8)
    p.rbox((0.12, 0.09, 0.02), (0.15, 0.02, 0.76), M('MintLight'), r=0.006, seg=1)
    # push handle at the back
    p.sweep([(-0.2, d / 2, 0.66), (-0.2, d / 2 + 0.07, 0.7), (0.2, d / 2 + 0.07, 0.7), (0.2, d / 2, 0.66)], 0.015,
            chrome, verts=8)
    return p.finish()


def op_counter():
    """Counter with cabinets, a vessel sink with a gooseneck faucet, and a few supplies."""
    p = Part('OpCounter')
    w, d, h = 1.8, 0.6, 0.9
    white, mint, teal, chrome = M('Enamel'), M('Mint'), M('Teal'), M('Chrome')
    p.bx(-w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.06, d / 2, 0, 0.09, teal)
    p.rbox((w, d, h - 0.13), (0, 0.0, 0.09 + (h - 0.13) / 2), white, r=0.015, seg=2)
    n = 4
    dw = (w - 0.06) / n
    for i in range(n):
        x = -w / 2 + 0.03 + dw * (i + 0.5)
        # drawer on top, door below
        p.rbox((dw - 0.03, 0.02, 0.13), (x, -d / 2 - 0.004, h - 0.13), M('MintLight'), r=0.01, seg=2)
        p.rbox((dw - 0.03, 0.02, 0.46), (x, -d / 2 - 0.004, 0.37), mint, r=0.012, seg=2)
        p.tube((x - 0.06, -d / 2 - 0.025, h - 0.12), (x + 0.06, -d / 2 - 0.025, h - 0.12), 0.009, chrome, verts=6)
        p.sphere(0.018, (x + (0.12 if i % 2 == 0 else -0.12), -d / 2 - 0.025, 0.52), chrome, seg=8, rings=6)
    # countertop
    p.rbox((w + 0.04, d + 0.04, 0.045), (0, 0, h + 0.0), M('Cream'), r=0.012, seg=2)
    # backsplash
    p.rbox((w + 0.04, 0.03, 0.2), (0, d / 2 + 0.005, h + 0.12), M('MintLight'), r=0.01, seg=2)
    # vessel sink (bowl with a hollow) and faucet
    sx = -0.45
    bowl = [(0.0, h + 0.02), (0.17, h + 0.02), (0.2, h + 0.08), (0.205, h + 0.13), (0.185, h + 0.135),
            (0.17, h + 0.08), (0.12, h + 0.055), (0.0, h + 0.05)]
    p.lathe(bowl, (sx, 0.0, 0), white, segs=24, scale=(1.0, 0.78, 1.0))
    p.cyl(0.02, 0.006, (sx, 0.0, h + 0.052), chrome, verts=10)
    p.sweep([(sx, 0.2, h + 0.02), (sx, 0.2, h + 0.3), (sx, 0.16, h + 0.36), (sx, 0.1, h + 0.34), (sx, 0.08, h + 0.28)],
            0.016, chrome, verts=8)
    p.tube((sx + 0.07, 0.2, h + 0.03), (sx + 0.07, 0.2, h + 0.1), 0.012, chrome, verts=6)
    p.tube((sx + 0.07, 0.2, h + 0.1), (sx + 0.07, 0.13, h + 0.12), 0.01, chrome, verts=6)
    # soap pump
    p.lathe([(0.0, h + 0.02), (0.035, h + 0.02), (0.038, h + 0.12), (0.02, h + 0.14), (0.0, h + 0.14)],
            (sx - 0.26, 0.15, 0), M('Bubblegum'), segs=10)
    p.tube((sx - 0.26, 0.15, h + 0.14), (sx - 0.26, 0.15, h + 0.18), 0.008, M('Enamel'), verts=6)
    p.tube((sx - 0.26, 0.15, h + 0.18), (sx - 0.26, 0.11, h + 0.18), 0.007, M('Enamel'), verts=6)
    # glove box with a glove poking out
    p.rbox((0.24, 0.13, 0.11), (0.15, 0.12, h + 0.075), M('Sky'), r=0.01, seg=2)
    p.sphere(0.04, (0.15, 0.12, h + 0.14), M('Blush'), seg=8, rings=6, scale=(1.3, 0.8, 0.6))
    # cotton swab jar
    p.lathe([(0.0, h + 0.02), (0.05, h + 0.02), (0.05, h + 0.16), (0.0, h + 0.16)], (0.42, 0.1, 0), M('Glass'),
            segs=12)
    for k in range(5):
        a = k * 1.3
        p.tube((0.42 + 0.02 * math.cos(a), 0.1 + 0.02 * math.sin(a), h + 0.03),
               (0.42 + 0.03 * math.cos(a), 0.1 + 0.03 * math.sin(a), h + 0.2), 0.004, M('Paper'), verts=4)
    # a big model tooth on a little stand
    p.cyl(0.07, 0.03, (0.72, 0.12, h + 0.035), M('Teal'), verts=14)
    p.prism(tooth2d(0.15, 0.17), 0.09, M('Enamel'), axis='Y', center=0.12, bevel=0.02, seg=2, flat=False,
            loc=(0.72, 0, h + 0.14))
    return p.finish()


def op_monitor():
    """Patient monitor on a rolling pole stand, showing an x-ray."""
    p = Part('OpMonitor')
    white, mint = M('Enamel'), M('Mint')
    star_base(p, 0.28, 0.0, white, leg_w=0.05, caster_r=0.03)
    p.cyl(0.03, 1.2, (0, 0, 0.1 + 0.6), white, verts=12)
    p.cyl(0.045, 0.1, (0, 0, 0.8), mint, verts=12, bevel=0.01)
    # small basket
    p.rbox((0.22, 0.14, 0.08), (0, -0.07, 0.85), M('Steel'), r=0.01, seg=1)
    p.box((0.08, 0.06, 0.06), (0, 0.0, 1.32), white, bevel=0.015, seg=2, flat=False)
    mk = p.mark()
    screen_panel(p, 0.62, 0.4, 0.05, bezel='Enamel', content=xray_content)
    p.xform_since(mk, loc=(0, -0.05, 1.42), rot=(-8, 0, 0))
    return p.finish()


def op_tv():
    """Ceiling TV on a drop pole, tilted down toward the chair, playing a cartoon."""
    p = Part('OpTv')
    white = M('Enamel')
    p.cyl(0.1, 0.03, (0, 0.03, 2.72), white, verts=16, bevel=0.01)
    p.cyl(0.028, 0.46, (0, 0.03, 2.49), white, verts=10)
    p.sphere(0.045, (0, 0.03, 2.26), M('Mint'), seg=10, rings=6)
    mk = p.mark()
    screen_panel(p, 0.86, 0.5, 0.05, bezel='Slate', content=cartoon_content)
    # friendly white back cover (the back is what the room sees) with the tilt bracket
    p.rbox((0.8, 0.03, 0.44), (0, 0.035, 0), white, r=0.03, seg=2)
    p.rbox((0.26, 0.05, 0.18), (0, 0.06, 0), M('Mint'), r=0.015, seg=1)
    p.xform_since(mk, loc=(0, -0.02, 2.02), rot=(14, 0, 0))
    return p.finish()


def whitening_lamp():
    """Teeth whitening lamp: rolling stand, balanced arm, curved blue LED mouthpiece head."""
    p = Part('WhiteningLamp')
    white, pink, blue = M('Enamel'), M('Bubblegum'), M('LightBlue')
    star_base(p, 0.3, 0.0, white, leg_w=0.05, caster_r=0.03)
    p.cyl(0.035, 1.15, (0, 0.05, 0.1 + 0.575), white, verts=12)
    # control box with a glowing display
    p.rbox((0.2, 0.12, 0.26), (0, 0.02, 0.95), white, r=0.03, seg=2)
    p.box((0.13, 0.01, 0.1), (0, -0.045, 1.0), M('Screen'))
    p.box((0.11, 0.006, 0.06), (0, -0.052, 1.0), glow('BlueGlow', '#9FE3FF', 1.0))
    for k, mm in enumerate(('Bubblegum', 'Mint')):
        p.cyl(0.013, 0.012, (-0.03 + k * 0.06, -0.045, 0.9), M(mm), axis='Y', verts=10)
    p.rbox((0.21, 0.02, 0.05), (0, 0.02, 0.83), pink, r=0.01, seg=2)
    # arm: up, then a long boom forward with a counterweight at the back
    p.sphere(0.05, (0, 0.05, 1.28), pink, seg=12, rings=8)
    p.tube((0, 0.3, 1.36), (0, -0.52, 1.2), 0.026, white, verts=10)
    p.sphere(0.07, (0, 0.33, 1.37), pink, seg=12, rings=8)
    p.tube((0, -0.52, 1.2), (0, -0.58, 1.06), 0.022, white, verts=8)
    # curved LED head: a U-shaped band facing down/front, lit inside
    mk = p.mark()
    pts = [(0.14 * math.cos(math.radians(a)), 0.1 * math.sin(math.radians(a)), 0) for a in range(0, 181, 20)]
    p.sweep(pts, 0.035, white, verts=10, rscale=(1.0, 1.4))
    for (x, y, z) in pts[1:-1]:
        p.sphere(0.018, (x * 0.93, y * 0.93 - 0.004, -0.03), blue, seg=8, rings=5)
    p.rbox((0.08, 0.05, 0.05), (0, 0.1, 0.03), pink, r=0.015, seg=2)
    p.xform_since(mk, loc=(0, -0.66, 1.0), rot=(-25, 0, 0))
    return p.finish()


def intraoral_cam():
    """Intraoral camera: a small console on a rolling stand with a pen-like wand in a holster."""
    p = Part('IntraoralCam')
    white, teal, mint = M('Enamel'), M('Teal'), M('Mint')
    star_base(p, 0.25, 0.0, white, leg_w=0.045, caster_r=0.028)
    p.cyl(0.028, 0.92, (0, 0.03, 0.1 + 0.46), white, verts=12)
    p.cyl(0.04, 0.08, (0, 0.03, 0.6), mint, verts=12, bevel=0.01)
    # console with a tilted screen showing a tooth close-up
    p.rbox((0.34, 0.2, 0.12), (0, 0.02, 1.07), white, r=0.03, seg=2)
    mk = p.mark()
    screen_panel(p, 0.34, 0.24, 0.035, bezel='Enamel', content=lambda q, w, h, y: q.plate(
        tooth2d(h * 0.75, h * 0.8), 0.003, (0, y - 0.0015, 0), glow('PinkGlow2', '#FFC2D6', 0.8), axis='Y'))
    p.xform_since(mk, loc=(0, 0.08, 1.26), rot=(-22, 0, 0))
    # holster on the side with the wand, and a coiled cable down to the console
    hx = 0.2
    p.rbox((0.06, 0.06, 0.1), (hx, -0.02, 1.07), mint, r=0.015, seg=2)
    p.tube((hx, -0.02, 1.08), (hx + 0.01, -0.03, 1.3), 0.018, white, verts=10)
    p.tube((hx + 0.01, -0.03, 1.3), (hx + 0.012, -0.033, 1.34), 0.012, teal, verts=8)
    p.sphere(0.012, (hx + 0.012, -0.045, 1.335), glow('BlueGlow', '#9FE3FF', 1.0), seg=8, rings=5)
    coil = []
    for i in range(40):
        a = i * 0.9
        coil.append((hx - 0.01 + 0.025 * math.cos(a), -0.02 + 0.025 * math.sin(a), 1.02 - i * 0.012))
    coil.append((0.06, 0.0, 0.5))
    coil.append((0.03, 0.03, 0.5))
    p.sweep(coil, 0.006, M('Rubber'), verts=5)
    return p.finish()


def xray_unit():
    """Wall-style x-ray on a column: scissor arm, tube head with a sunny cone, a lead apron on a hook."""
    p = Part('XrayUnit')
    white, sun, teal, mint = M('Enamel'), M('Sunshine'), M('Teal'), M('Mint')
    p.rbox((0.5, 0.42, 0.05), (0, 0.15, 0.025), white, r=0.02, seg=2)
    p.rbox((0.16, 0.14, 1.9), (0, 0.2, 0.05 + 0.95), white, r=0.04, seg=2)
    p.rbox((0.17, 0.15, 0.06), (0, 0.2, 0.5), mint, r=0.015, seg=2)
    # control panel
    p.rbox((0.14, 0.04, 0.18), (0, 0.11, 1.25), M('Slate'), r=0.015, seg=2)
    p.box((0.1, 0.006, 0.05), (0, 0.089, 1.3), glow('UiMint', '#3DD6B5', 0.7))
    for k, mm in enumerate(('Bubblegum', 'Sunshine', 'Mint')):
        p.cyl(0.012, 0.01, (-0.035 + k * 0.035, 0.088, 1.2), M(mm), axis='Y', verts=8)
    # scissor arm forward (-Y)
    p.sphere(0.05, (0, 0.2, 1.75), mint, seg=10, rings=6)
    p.tube((0, 0.2, 1.75), (0, -0.2, 1.62), 0.03, white, verts=10)
    p.sphere(0.045, (0, -0.2, 1.62), mint, seg=10, rings=6)
    p.tube((0, -0.2, 1.62), (0, -0.55, 1.5), 0.028, white, verts=10)
    p.sphere(0.04, (0, -0.55, 1.5), mint, seg=10, rings=6)
    # tube head with the cone pointing down and forward
    mk = p.mark()
    p.rbox((0.2, 0.2, 0.18), (0, 0, 0), white, r=0.06, seg=3)
    p.cyl(0.045, 0.24, (0.0, 0.0, 0.0), teal, axis='X', verts=12)
    p.lathe([(0.0, -0.09), (0.065, -0.09), (0.05, -0.3), (0.0, -0.3)], (0, 0, 0), sun, segs=16)
    p.lathe([(0.0, -0.3), (0.052, -0.3), (0.052, -0.315), (0.0, -0.315)], (0, 0, 0), white, segs=16)
    p.xform_since(mk, loc=(0, -0.62, 1.4), rot=(-35, 0, 0))
    # lead apron hanging on a hook on the column side
    p.tube((0.08, 0.2, 1.45), (0.16, 0.2, 1.45), 0.012, M('Steel'), verts=6)
    pts = rrect(0.26, 0.42, 0.08, 3)
    p.plate([(x, z) for (x, z) in pts], 0.04, (0.2, 0.28, 1.22), M('Bubblegum'), axis='X', bevel=0.012, seg=1)
    p.plate(ellipse(0.06, 0.03, 10), 0.046, (0.2, 0.28, 1.42), M('Bubblegum'), axis='X')
    return p.finish()


def ultrasonic_cart():
    """Ultrasonic scaler unit on a cart: dial, glowing display, two handpieces, water bottle, tip box."""
    p = Part('UltrasonicCart')
    w, d = 0.52, 0.42
    white, mint, teal, chrome = M('Enamel'), M('Mint'), M('Teal'), M('Chrome')
    cart_frame(p, w, d, 0.62, shelf=True, shelf_m='MintLight')
    p.rbox((w + 0.02, d + 0.02, 0.035), (0, 0, 0.64), white, r=0.012, seg=2)
    # the unit
    p.rbox((0.36, 0.28, 0.16), (0, 0.04, 0.74), white, r=0.04, seg=2)
    p.rbox((0.37, 0.29, 0.03), (0, 0.04, 0.68), teal, r=0.012, seg=2)
    p.cyl(0.05, 0.03, (0.08, -0.105, 0.75), M('Steel'), axis='Y', verts=16, bevel=0.008)
    p.cyl(0.035, 0.03, (0.08, -0.115, 0.75), mint, axis='Y', verts=14)
    p.box((0.12, 0.01, 0.06), (-0.08, -0.1, 0.77), M('Screen'))
    p.box((0.1, 0.006, 0.04), (-0.08, -0.106, 0.77), glow('BlueGlow', '#9FE3FF', 1.0))
    # handpiece holders and handpieces with coiled hoses
    for s in (-1, 1):
        x = s * 0.14
        p.rbox((0.05, 0.05, 0.06), (x, 0.14, 0.85), mint, r=0.012, seg=2)
        p.tube((x, 0.14, 0.86), (x + s * 0.01, 0.12, 1.02), 0.014, white, verts=8)
        p.tube((x + s * 0.01, 0.12, 1.02), (x + s * 0.012, 0.118, 1.05), 0.008, chrome, verts=6)
        coil = [(x + 0.02 * math.cos(i * 0.9), 0.2 + 0.02 * math.sin(i * 0.9), 0.84 - i * 0.008) for i in range(20)]
        p.sweep(coil, 0.005, M('Rubber'), verts=5)
    # water bottle on a side bracket
    p.tube((w / 2, 0.0, 0.8), (w / 2 + 0.06, 0.0, 0.8), 0.01, chrome, verts=6)
    p.lathe([(0.0, 0.72), (0.05, 0.72), (0.055, 0.9), (0.03, 0.96), (0.018, 0.99), (0.0, 0.99)], (w / 2 + 0.08, 0, 0),
            M('Water'), segs=14)
    p.cyl(0.02, 0.03, (w / 2 + 0.08, 0, 1.0), teal, verts=10)
    # box of tips on the lower shelf
    p.rbox((0.2, 0.14, 0.1), (-0.08, 0.0, 0.225), M('Bubblegum'), r=0.012, seg=2)
    p.rbox((0.14, 0.12, 0.08), (0.14, 0.02, 0.215), M('Sunshine'), r=0.012, seg=2)
    return p.finish()


def sterilizer():
    """Sterilizer Pro: an autoclave with a round door on a small cabinet, pouches stacked beside it."""
    p = Part('Sterilizer')
    w, d, h = 0.9, 0.56, 0.86
    white, mint, teal, chrome = M('Enamel'), M('Mint'), M('Teal'), M('Chrome')
    p.bx(-w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.05, d / 2, 0, 0.08, teal)
    p.rbox((w, d, h - 0.1), (0, 0, 0.08 + (h - 0.1) / 2), white, r=0.015, seg=2)
    for s in (-1, 1):
        p.rbox((w / 2 - 0.04, 0.02, h - 0.2), (s * w / 4, -d / 2 - 0.004, 0.08 + (h - 0.1) / 2), mint, r=0.012, seg=2)
        p.tube((s * 0.05, -d / 2 - 0.025, 0.55), (s * 0.05, -d / 2 - 0.025, 0.68), 0.009, chrome, verts=6)
    p.rbox((w + 0.03, d + 0.03, 0.04), (0, 0, h), M('Cream'), r=0.012, seg=2)
    # autoclave
    ax = -0.1
    p.rbox((0.56, 0.44, 0.4), (ax, 0.02, h + 0.02 + 0.2), white, r=0.05, seg=3)
    p.rbox((0.57, 0.45, 0.05), (ax, 0.02, h + 0.05), M('Slate'), r=0.02, seg=2)
    door_y = 0.02 - 0.22
    p.cyl(0.14, 0.03, (ax - 0.06, door_y - 0.005, h + 0.24), M('Steel'), axis='Y', verts=24, bevel=0.01)
    p.cyl(0.11, 0.03, (ax - 0.06, door_y - 0.015, h + 0.24), chrome, axis='Y', verts=24)
    p.tube((ax - 0.06, door_y - 0.04, h + 0.24), (ax + 0.06, door_y - 0.04, h + 0.24), 0.014, teal, verts=8)
    # control panel with display and buttons
    p.box((0.1, 0.01, 0.06), (ax + 0.18, door_y, h + 0.3), M('Screen'))
    p.box((0.085, 0.006, 0.045), (ax + 0.18, door_y - 0.006, h + 0.3), glow('UiMint', '#3DD6B5', 0.8))
    for k, mm in enumerate(('Bubblegum', 'Sunshine')):
        p.cyl(0.014, 0.01, (ax + 0.155 + k * 0.05, door_y - 0.004, h + 0.2), M(mm), axis='Y', verts=10)
    # a status light on top
    p.sphere(0.02, (ax + 0.2, 0.1, h + 0.43), glow('UiMint', '#3DD6B5', 0.8), seg=8, rings=5)
    # sterilization pouches
    for k, mm in enumerate(('Sky', 'Paper', 'Sky')):
        p.rbox((0.2, 0.14, 0.018), (0.32, 0.0, h + 0.03 + k * 0.02), M(mm), r=0.006, seg=1)
    return p.finish()


MODELS = {
    'op_lamp': dict(fn=op_lamp, budget=150),
    'op_cart': dict(fn=op_cart, budget=150),
    'op_counter': dict(fn=op_counter, budget=150),
    'op_monitor': dict(fn=op_monitor, budget=150),
    'op_tv': dict(fn=op_tv, budget=150),
    'whitening_lamp': dict(fn=whitening_lamp, budget=150),
    'intraoral_cam': dict(fn=intraoral_cam, budget=150),
    'xray_unit': dict(fn=xray_unit, budget=150),
    'ultrasonic_cart': dict(fn=ultrasonic_cart, budget=150),
    'sterilizer': dict(fn=sterilizer, budget=150),
}
