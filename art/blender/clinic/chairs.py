# Dental chairs: chair_basic, chair_comfort, chair_deluxe.
# Blender space: front (footrest) toward -Y, headrest toward +Y, Z up, origin on the floor under the seat.
# After export (three.js): headrest toward -Z, footrest toward +Z. Seat top about 0.55, length about 1.95.
# The upholstery material is named exactly `Upholstery` so the game can tint it.
import math
from lib import Part, M, material, rad

# Profile of the reclined chair (y, z) along the top surface: foot end -> seat -> backrest -> headrest.
FOOT = (-0.88, 0.47)
KNEE = (-0.24, 0.56)
HIP = (0.26, 0.525)
BACK_TOP = (0.80, 0.84)
HEAD_A = (0.86, 0.885)
HEAD_B = (1.02, 0.955)


def seg_pad(p, a, b, w, t, m, r=0.04, seg=3, offset=0.0, ext=0.0, x=0.0, flat=False):
    """A rounded pad whose top surface runs along the (y, z) segment a -> b (sagittal plane).
    offset pushes it along the surface normal (negative = below), ext lengthens both ends."""
    (y0, z0), (y1, z1) = a, b
    dy, dz = y1 - y0, z1 - z0
    L = math.hypot(dy, dz)
    uy, uz = dy / L, dz / L
    ny, nz = -uz, uy
    cy = (y0 + y1) / 2 + ny * (offset - t / 2)
    cz = (z0 + z1) / 2 + nz * (offset - t / 2)
    th = math.degrees(math.atan2(dz, dy))
    size = (w, L + 2 * ext, t)
    rr = min(r, min(size) * 0.49)
    if rr > 0:
        p.box(size, (x, cy, cz), m, bevel=rr, seg=seg, rot=(th, 0, 0), flat=flat)
    else:
        p.box(size, (x, cy, cz), m, rot=(th, 0, 0))


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def along(a, b, t, off):
    """A point on segment a->b at fraction t, pushed `off` along its upward normal. Returns (y, z)."""
    (y0, z0), (y1, z1) = a, b
    L = math.hypot(y1 - y0, z1 - z0)
    ny, nz = -(z1 - z0) / L, (y1 - y0) / L
    y, z = lerp2(a, b, t)
    return (y + ny * off, z + nz * off)


def frame(p, tier):
    """Base, lifting column, seat carriage, backrest shell, foot control and the cuspidor unit."""
    white = M('Enamel')
    steel = M('Steel')
    slate = M('Slate')
    gold = M('Gold') if tier == 'deluxe' else None
    # base plate and column
    p.rbox((0.58, 0.84, 0.07), (0, 0.04, 0.035), white, r=0.03, seg=2)
    p.box((0.28, 0.36, 0.30), (0, 0.06, 0.07 + 0.15), white, bevel=0.035, seg=2, taper=(0.82, 0.8), flat=False)
    band = gold or M('Mint')
    p.rbox((0.25, 0.32, 0.035), (0, 0.06, 0.345), band if tier != 'basic' else steel, r=0.012, seg=2)
    if gold:
        # gold trim around the base plate
        from lib import rrect
        ring = [(x, y + 0.04, 0.066) for (x, y) in rrect(0.54, 0.8, 0.05, 3)]
        p.sweep(ring, 0.012, gold, verts=6, closed=True)
    # seat carriage under the cushions
    seg_pad(p, KNEE, HIP, 0.46, 0.09, white, r=0.03, seg=2, offset=-0.08, ext=0.03)
    seg_pad(p, FOOT, KNEE, 0.36, 0.05, white, r=0.02, seg=2, offset=-0.075, ext=-0.03)
    seg_pad(p, HIP, BACK_TOP, 0.44, 0.06, white, r=0.025, seg=2, offset=-0.09, ext=-0.02)
    # foot plate at the end of the leg rest
    fy, fz = FOOT
    p.box((0.34, 0.035, 0.1), (0, fy - 0.03, fz - 0.005), white, bevel=0.015, seg=2, rot=(-18, 0, 0), flat=False)
    # headrest stem
    s0 = along(HIP, BACK_TOP, 0.92, -0.10)
    s1 = along(HEAD_A, HEAD_B, 0.4, -0.08)
    p.tube((0, s0[0], s0[1]), (0, s1[0], s1[1]), 0.022, steel, verts=8)
    # foot control pedal with a cable back to the base
    p.cyl(0.11, 0.04, (0.46, -0.52, 0.02), slate, verts=16, bevel=0.012, seg=2)
    p.cyl(0.07, 0.03, (0.46, -0.52, 0.05), M('Mint') if tier != 'deluxe' else gold, verts=14, bevel=0.01, seg=2)
    p.sweep([(0.46, -0.41, 0.012), (0.40, -0.25, 0.012), (0.22, -0.2, 0.012), (0.14, -0.12, 0.03)], 0.012,
            M('Rubber'), verts=6)
    # cuspidor unit (bowl, spout, cup) on the patient's side
    cx, cy = -0.47, 0.42
    p.tube((-0.2, 0.30, 0.2), (cx, cy, 0.2), 0.03, white, verts=8)
    p.cyl(0.035, 0.62, (cx, cy, 0.2 + 0.31), white, verts=10)
    bowl = [(0.0, 0.76), (0.05, 0.765), (0.1, 0.8), (0.125, 0.85), (0.12, 0.865), (0.0, 0.865)]
    p.lathe(bowl, (cx, cy, 0), gold if gold else white, segs=16)
    p.cyl(0.085, 0.01, (cx, cy, 0.862), M('Sky'), verts=16)     # water in the bowl
    p.tube((cx - 0.02, cy + 0.1, 0.84), (cx - 0.02, cy + 0.1, 0.95), 0.012, M('Chrome'), verts=6)
    p.tube((cx - 0.02, cy + 0.1, 0.95), (cx - 0.02, cy + 0.03, 0.93), 0.01, M('Chrome'), verts=6)
    # cup holder and paper cup
    p.tube((cx + 0.02, cy - 0.06, 0.8), (cx + 0.02, cy - 0.14, 0.8), 0.01, M('Chrome'), verts=6)
    p.lathe([(0.0, 0.79), (0.026, 0.79), (0.034, 0.87), (0.0, 0.87)], (cx + 0.02, cy - 0.17, 0), M('Paper'), segs=10)
    p.lathe([(0.0, 0.84), (0.035, 0.84), (0.036, 0.855), (0.0, 0.855)], (cx + 0.02, cy - 0.17, 0), M('Mint'),
            segs=10)


def armrests(p, tier, up):
    white = M('Enamel')
    for s in (-1, 1):
        x = s * 0.33
        # support post from the seat carriage
        p.tube((s * 0.2, 0.18, 0.46), (x, 0.16, 0.5), 0.022, white, verts=8)
        p.tube((x, 0.16, 0.5), (x, 0.12, 0.66), 0.022, white, verts=8)
        if tier == 'basic':
            p.rbox((0.07, 0.40, 0.035), (x, -0.02, 0.67), white, r=0.015, seg=2)
            p.rbox((0.075, 0.30, 0.03), (x, -0.02, 0.695), up, r=0.014, seg=2)
        else:
            w = 0.1 if tier == 'comfort' else 0.11
            p.rbox((w, 0.46, 0.085), (x + s * 0.005, -0.03, 0.70), up, r=0.04, seg=3)
            if tier == 'deluxe':
                gold = M('Gold')
                # gold piping along the outer edge and a cup holder on the front
                p.sweep([(x + s * (w / 2), -0.25, 0.70), (x + s * (w / 2 + 0.004), 0.19, 0.70)], 0.009, gold, verts=6)
                if s > 0:
                    p.cyl(0.042, 0.05, (x + 0.02, -0.28, 0.705), gold, verts=14)
                    p.lathe([(0.0, 0.71), (0.03, 0.71), (0.036, 0.8), (0.0, 0.8)], (x + 0.02, -0.28, 0),
                            M('Bubblegum'), segs=12)
                    p.lathe([(0.0, 0.8), (0.03, 0.8), (0.03, 0.81), (0.0, 0.81)], (x + 0.02, -0.28, 0),
                            M('Enamel'), segs=12)
                else:
                    # massage remote: a little pad with glowing buttons
                    p.rbox((0.06, 0.1, 0.025), (x, -0.12, 0.755), M('Enamel'), r=0.01, seg=2)
                    for k, mat in enumerate(('Glow', 'Bubblegum', 'Sunshine')):
                        p.cyl(0.009, 0.01, (x, -0.15 + k * 0.03, 0.769), M(mat), verts=8)


def cushions(p, tier, up):
    if tier == 'basic':
        t, r = 0.1, 0.035
        seg_pad(p, FOOT, KNEE, 0.44, t, up, r=r, ext=0.015)
        seg_pad(p, KNEE, HIP, 0.54, t, up, r=r, ext=0.02)
        seg_pad(p, HIP, BACK_TOP, 0.54, t, up, r=r, ext=0.02)
        seg_pad(p, HEAD_A, HEAD_B, 0.3, 0.09, up, r=0.035)
        return
    # comfort and deluxe: thick, pillowy, split into puffy sections
    t = 0.14
    r = 0.06
    mid_leg = lerp2(FOOT, KNEE, 0.5)
    seg_pad(p, FOOT, mid_leg, 0.46, t, up, r=r, ext=0.02)
    seg_pad(p, mid_leg, KNEE, 0.5, t, up, r=r, ext=0.02)
    seg_pad(p, KNEE, HIP, 0.58, t + 0.01, up, r=r, ext=0.03)
    mid_back = lerp2(HIP, BACK_TOP, 0.45)
    seg_pad(p, HIP, mid_back, 0.58, t, up, r=r, ext=0.03)
    seg_pad(p, mid_back, BACK_TOP, 0.58, t, up, r=r, ext=0.03)
    # pillow headrest
    hy, hz = lerp2(HEAD_A, HEAD_B, 0.5)
    L = math.hypot(HEAD_B[0] - HEAD_A[0], HEAD_B[1] - HEAD_A[1])
    th = math.degrees(math.atan2(HEAD_B[1] - HEAD_A[1], HEAD_B[0] - HEAD_A[0]))
    p.box((0.32, 0.2, 0.1), (0, hy - 0.01, hz - 0.035), up, bevel=0.045, seg=3, rot=(th, 0, 0), flat=False)
    # neck roll between the backrest and the headrest
    ny, nz = along(BACK_TOP, HEAD_A, 0.6, 0.0)
    p.cyl(0.05, 0.34, (0, ny, nz + 0.02), up, axis='X', verts=12, bevel=0.02, seg=2)
    if tier == 'deluxe':
        gold = M('Gold')
        # gold piping along both sides of the seat, leg rest and backrest
        for s in (-1, 1):
            for (a, b, w) in ((FOOT, KNEE, 0.48), (KNEE, HIP, 0.58), (HIP, BACK_TOP, 0.58)):
                pa = along(a, b, 0.05, -0.075)
                pb = along(a, b, 0.95, -0.075)
                p.sweep([(s * (w / 2 + 0.004), pa[0], pa[1]), (s * (w / 2 + 0.004), pb[0], pb[1])], 0.011, gold,
                        verts=6)
        # massage pads: two columns of round nodes on the backrest
        for s in (-1, 1):
            for k in range(4):
                y, z = along(HIP, BACK_TOP, 0.2 + 0.2 * k, 0.005)
                p.sphere(0.045, (s * 0.12, y, z), up, seg=10, rings=6, scale=(1, 1, 0.55),
                         rot=(math.degrees(math.atan2(BACK_TOP[1] - HIP[1], BACK_TOP[0] - HIP[0])), 0, 0))
        # tufting buttons on the seat
        for (u, s) in ((0.3, -1), (0.3, 1), (0.7, -1), (0.7, 1), (0.5, 0)):
            y, z = along(KNEE, HIP, u, 0.008)
            p.sphere(0.018, (s * 0.15, y, z), gold, seg=8, rings=5, scale=(1, 1, 0.6))


UPHOLSTERY = {'basic': '#3DD6B5', 'comfort': '#FF8DB3', 'deluxe': '#14A89F'}


def build_chair(tier):
    up = material('Upholstery', UPHOLSTERY[tier], 0.55 if tier == 'basic' else 0.75, 0.0)
    p = Part('Chair')
    frame(p, tier)
    cushions(p, tier, up)
    armrests(p, tier, up)
    p.finish()


MODELS = {
    'chair_basic': dict(fn=lambda: build_chair('basic'), budget=150, recenter=False),
    'chair_comfort': dict(fn=lambda: build_chair('comfort'), budget=150, recenter=False),
    'chair_deluxe': dict(fn=lambda: build_chair('deluxe'), budget=150, recenter=False),
}
