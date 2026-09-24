# Gums: gum_upper (with the palate roof) and gum_lower (with the mouth floor).
#
# Contract (docs/ARCHITECTURE.md): built along the arch curve (ARCH_* mirrored in mouthgeo.py), gumline
# plane at model y = 0 with a scalloped edge where the teeth emerge; upper tissue extends +Y (with a palate),
# lower extends -Y (with a floor). About 1.6 wide across the curve, wrapping past the last molar.
# Material Gum. XZ are absolute mouth coordinates (the lower arch is scaled by LOWER_ARCH_SCALE); the scene
# places the models at UPPER_GUM_Y / LOWER_GUM_Y.
#
# Everything is authored in a "crown-up" frame: u points from the gum toward the crowns (u = y for the lower
# gum, u = -y for the upper) and n is the outward (labial) offset from the arch curve. The margin scallops
# are computed from layout_teeth(), so the arcs sit exactly over each tooth and the papillae fill the gaps.
import math
import numpy as np
import lib
from mouthgeo import (layout_teeth, arch_point, arch_normal, s_at_length_ext, tooth_matrix, TOOTH_GAP,
                      LOWER_ARCH_SCALE)
import teeth as teeth_mod

_FN = {}


def _surface_n(t, s, scale, u, side):
    """Distance along the arch normal (side +1 labial, -1 lingual) from the arch curve to the tooth's
    enamel at crown height u, or None when that line misses the tooth."""
    f = _FN.setdefault(t['kind'], teeth_mod.tooth_fn(t['kind']))
    Minv = np.linalg.inv(tooth_matrix(t))
    ax, az = arch_point(s, scale)
    nx, nz = arch_normal(s)
    sign = -1.0 if t['arch'] == 'upper' else 1.0
    ns = np.linspace(0.0, 1.2, 97)
    W = np.stack([ax + nx * side * ns, np.full_like(ns, t['y'] + sign * u), az + nz * side * ns, np.ones_like(ns)], 1)
    L = (W @ Minv.T)[:, :3]
    vals = f(L)
    if vals[0] >= 0:
        return None
    k = int(np.argmax(vals > 0))
    if k == 0:
        return None
    lo, hi = ns[k - 1], ns[k]
    for _ in range(30):
        mid = (lo + hi) / 2
        P = np.array([[ax + nx * side * mid, t['y'] + sign * u, az + nz * side * mid, 1.0]])
        if f((P @ Minv.T)[:, :3])[0] > 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2

NECK = {'incisor': 0.84, 'canine': 0.84, 'premolar': 0.80, 'molar': 0.80}   # neck depth / half depth
PAPILLA = {'incisor': 0.24, 'canine': 0.23, 'premolar': 0.19, 'molar': 0.15}
Y0 = 0.035          # margin height at a tooth's center (just over the enamel's neck)
NS = 8              # samples per tooth along the arch
EXT = 2.3           # tissue past the last molar (mouth units): the band runs on into the throat wall
NE = 11             # samples in that extension


def catmull(points, sub):
    """Centripetal-ish uniform Catmull-Rom through 2D/3D points, `sub` samples per segment."""
    P = [np.asarray(p, dtype=float) for p in points]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def _samples(arch):
    scale = 1.0 if arch == 'upper' else LOWER_ARCH_SCALE
    teeth = [t for t in layout_teeth() if t['arch'] == arch]
    g = TOOTH_GAP / 2 / scale
    K = len(teeth)
    A = [PAPILLA[t['kind']] for t in teeth]
    ND = [NECK[t['kind']] * t['depth'] / 2 for t in teeth]
    bound_A = [A[0] * 0.75] + [(A[k] + A[k + 1]) / 2 for k in range(K - 1)] + [A[-1] * 0.75]
    rows = []
    # leading extension (behind the first molar)
    a0 = teeth[0]['center_len'] - teeth[0]['half_len'] - g
    ext = EXT / scale
    for i in range(NE):
        e = 1 - i / NE                     # 1 at the band end, 0 at the tooth boundary
        rows.append({'L': a0 - ext * e, 'ext': e, 'k': 0, 'tau': -1.0})
    for k, t in enumerate(teeth):
        a = t['center_len'] - t['half_len'] - g
        b = t['center_len'] + t['half_len'] + g
        for i in range(NS):
            rows.append({'L': a + (b - a) * i / NS, 'ext': 0.0, 'k': k, 'tau': -1 + 2 * i / NS})
    bK = teeth[-1]['center_len'] + teeth[-1]['half_len'] + g
    rows.append({'L': bK, 'ext': 0.0, 'k': K - 1, 'tau': 1.0})
    for i in range(1, NE + 1):
        e = i / NE
        rows.append({'L': bK + ext * e, 'ext': e, 'k': K - 1, 'tau': 1.0})
    # per-row margin height and neck depth
    for r in rows:
        k, tau, e = r['k'], r['tau'], r['ext']
        side_A = bound_A[k] if tau < 0 else bound_A[k + 1]
        if e > 0:  # retromolar pad: a soft bump behind the last molar, then the ridge sinks away
            ym = side_A * (1 - im_sstep(0.0, 0.2, e)) + 0.06 * im_sstep(0.0, 0.2, e) - 0.75 * im_sstep(0.25, 1.0, e)
        else:
            ym = Y0 + im_sstep(0.0, 1.0, abs(tau)) ** 2.0 * (side_A - Y0)
        nb = k - 1 if tau < 0 else k + 1
        nd = ND[k]
        if 0 <= nb < K:
            nd = nd + (ND[nb] - nd) * 0.5 * im_sstep(0.55, 1.0, abs(tau))
        root = math.cos(min(1.0, abs(tau)) * math.pi / 2) ** 2 if e == 0 else 0.0
        if e > 0:
            nd *= 1 - 0.3 * im_sstep(0.0, 1.0, e)
        s = s_at_length_ext(r['L'])
        ndF = ndB = nd
        if e == 0 and abs(tau) < 0.95:
            # hug the actual enamel outline at the margin height, easing to the neck depth in the gaps
            w = im_sstep(0.5, 0.9, abs(tau))
            hF = _surface_n(teeth[k], s, scale, ym, 1)
            hB = _surface_n(teeth[k], s, scale, ym, -1)
            if hF is not None:
                ndF = hF * (1 - w) + nd * w
            if hB is not None:
                ndB = hB * (1 - w) + nd * w
        r.update({'ym': ym, 'nd': nd, 'ndF': ndF, 'ndB': ndB, 'root': root, 's': s})
    return rows, scale


def im_sstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def profile(r, arch):
    """Cross-section control points (n, u) from the labial wall bottom to the lingual end."""
    ym, nd, root, e = r['ym'], r['nd'], r['root'], r['ext']
    ndF, ndB = r['ndF'], r['ndB']
    bulge = 0.03 * root
    lab = [
        (nd + 0.30, -2.4),
        (nd + 0.36 + bulge * 0.5, -1.7),
        (nd + 0.40 + bulge, -1.05),
        (nd + 0.37 + bulge, -0.5),
        (ndF + 0.25, ym - 0.16),
        (ndF + 0.1, ym - 0.03),
        (ndF - 0.025, ym),
    ]
    lin = [
        (-(ndB - 0.025), ym),
        (-(ndB + 0.1), ym - 0.03),
        (-(ndB + 0.25), ym - 0.16),
        (-(nd + 0.40), -0.42),
        (-(nd + 0.56), -0.64),
        (-(nd + 0.78), -0.8),
    ]
    mid = [(0.0, ym - 0.03)]
    pts = lab + mid + lin
    return pts


def _mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


ROSY = (0.92, 0.6, 0.7)          # alveolar mucosa, a little deeper than the gingiva
DARK = (0.27, 0.13, 0.17)        # fades into the throat color where the tissue runs out of view
PALATE = (1.0, 0.96, 0.96)
FLOOR = (0.8, 0.5, 0.6)


def band_color(n, u, arch, e, s):
    """Vertex color multiplier: bright bubblegum gingiva at the teeth, deeper rose further away, fading to
    the throat's dark red where the tissue meets the cheeks and the throat (reads like soft occlusion).
    Toward the back teeth the fade starts sooner, as if the cheeks pressed in."""
    if n >= 0:
        back = im_sstep(0.3, 0.85, abs(s))
        c = _mix((1.0, 1.0, 1.0), ROSY, im_sstep(-0.5 + 0.25 * back, -1.2 + 0.5 * back, u))
        c = _mix(c, DARK, im_sstep(-1.15 + 0.75 * back, -2.35 + 1.0 * back, u) ** 0.9)
    else:
        target = PALATE if arch == 'upper' else FLOOR
        c = _mix((1.0, 1.0, 1.0), target, im_sstep(-0.3, -0.8, u))
    return _mix(c, DARK, im_sstep(0.04, 0.42, e))


def build(arch):
    rows, scale = _samples(arch)
    sign = -1.0 if arch == 'upper' else 1.0     # y = sign * u
    SUB = 2
    grid = []
    cols = []
    for r in rows:
        s = r['s']
        ax, az = arch_point(s, scale)
        nx, nz = arch_normal(s)
        prof = catmull(profile(r, arch), SUB)
        ring = []
        for (n, u) in prof:
            ring.append((ax + nx * n, sign * u, az + nz * n))
            cols.append(band_color(n, u, arch, r['ext'], s))
        grid.append(ring)
    R, C = len(grid), len(grid[0])
    verts = [p for ring in grid for p in ring]
    vid = lambda i, j: i * C + j
    faces = []
    for i in range(R - 1):
        for j in range(C - 1):
            q = [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)]
            faces.append(q if sign > 0 else q[::-1])

    # ---- palate (upper) / floor (lower): a fan from the lingual edge + a back closing curve to a center
    edge = [vid(i, C - 1) for i in range(R)]
    Qe = np.array(verts[edge[-1]])
    Qs = np.array(verts[edge[0]])
    u_edge = sign * Qe[1]
    if arch == 'upper':
        z_back, u_back, u_c, cz = -2.95, -1.05, -1.5, 0.1
    else:
        z_back, u_back, u_c, cz = -2.7, -0.95, -1.0, 0.05
    z_back *= scale
    cz *= scale
    NB = 14
    back_ctrl = [
        (Qe[0], Qe[2], u_edge),
        (Qe[0] * 0.55, (Qe[2] + z_back) / 2 - 0.35, (u_edge + u_back) / 2),
        (0.0, z_back, u_back),
        (Qs[0] * 0.55, (Qs[2] + z_back) / 2 - 0.35, (u_edge + u_back) / 2),
        (Qs[0], Qs[2], u_edge),
    ]
    back = catmull(back_ctrl, NB // 4)[1:-1]
    ring_ids = list(edge)
    for (x, z, u) in back:
        verts.append((float(x), sign * float(u), float(z)))
        cols.append(_mix(PALATE if arch == 'upper' else FLOOR, DARK, 0.85 if arch == 'upper' else 0.7))
        ring_ids.append(len(verts) - 1)
    ring = [np.array(verts[i]) for i in ring_ids]
    NRING = 9
    center = np.array([0.0, sign * u_c, cz])
    prev = ring_ids
    for j in range(1, NRING):
        rho = (1 - j / NRING) ** 0.85
        cur = []
        for k, p in enumerate(ring):
            u_b = sign * p[1]
            x = center[0] + (p[0] - center[0]) * rho
            z = center[2] + (p[2] - center[2]) * rho
            u = u_c + (u_b - u_c) * rho ** 2
            if arch == 'upper':
                u += rugae(x, z, rho)
            verts.append((float(x), sign * float(u), float(z)))
            c0 = cols[ring_ids[k]]
            cc = PALATE if arch == 'upper' else FLOOR
            c = _mix(c0, cc, min(1.0, j / 3))
            # the soft palate / floor darkens toward the throat
            c = _mix(c, DARK, im_sstep(-1.2 * scale, -3.1 * scale, z) * (0.85 if arch == 'upper' else 0.7))
            cols.append(c)
            cur.append(len(verts) - 1)
        n = len(ring)
        for k in range(n):
            k2 = (k + 1) % n
            q = [prev[k], prev[k2], cur[k2], cur[k]]
            faces.append(q if sign > 0 else q[::-1])
        prev = cur
    verts.append(tuple(float(c) for c in center))
    cols.append(cols[-1])
    ci = len(verts) - 1
    n = len(ring)
    for k in range(n):
        k2 = (k + 1) % n
        t = [prev[k], prev[k2], ci]
        faces.append(t if sign > 0 else t[::-1])
    part = lib.Part('gum_' + arch)
    part.add_mesh(verts, faces, lib.material('Gum', double=True))
    return part.finish(all_smooth=True, recalc=False, color_fn=lib.color_lookup(verts, cols))


def rugae(x, z, rho):
    """Soft transverse ridges on the front of the palate and a faint midline seam (cartoon anatomy)."""
    # distance behind the front of the palate
    zf = 2.0
    dz = zf - z
    bump = 0.0
    if 0.0 < dz < 1.6 and abs(x) < 1.3:
        fade = (1 - abs(x) / 1.3) ** 1.5 * min(1.0, dz / 0.3) * max(0.0, 1 - dz / 1.6)
        bump += 0.05 * fade * (0.5 + 0.5 * math.cos(dz * math.pi * 2 / 0.5 + abs(x) * 1.2))
    bump -= 0.03 * math.exp(-(x / 0.12) ** 2) * min(1.0, max(0.0, (1.9 - dz) / 1.0)) * (1 if rho < 0.9 else 0)
    return bump


def builders():
    return {'gum_upper': lambda: build('upper'), 'gum_lower': lambda: build('lower')}
