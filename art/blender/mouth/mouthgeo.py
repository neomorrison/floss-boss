# Python port of src/core/mouth.ts (arch curve, tooth sizes, layoutTeeth). Pure math, no bpy, so the
# gum builder, the verifier and plain `python` agree with the game. Keep in sync with mouth.ts.
#
# Mouth space (three.js convention): +Y up, camera at +Z looking -Z, 1 unit ~ 8 mm.
#   x = ARCH_X * s * scale,  z = ARCH_Z0 * scale + ARCH_Z * (1 - s^2) * scale,  s in [-1, 1]
import math

ARCH_X = 4.8
ARCH_Z = 4.4
ARCH_Z0 = -1.8
LOWER_ARCH_SCALE = 0.95
UPPER_GUM_Y = 2.0
LOWER_GUM_Y = -2.0
TOOTH_GAP = 0.04
TEETH_PER_ARCH = 14
TOOTH_COUNT = 28

KIND_BY_POS = ['molar', 'molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor',
               'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar']

TOOTH_DIMS = {
    'incisor': {'w': 0.8, 'h': 1.05, 'd': 0.55},
    'canine': {'w': 0.8, 'h': 1.15, 'd': 0.7},
    'premolar': {'w': 0.75, 'h': 0.85, 'd': 0.8},
    'molar': {'w': 1.05, 'h': 0.75, 'd': 0.95},
}
ROOT_Y = -0.35


def tooth_width(pos):
    k = KIND_BY_POS[pos]
    if pos in (5, 8):
        return 0.68
    if pos in (6, 7):
        return 0.85
    return TOOTH_DIMS[k]['w']


def arch_point(s, scale=1.0):
    return ARCH_X * s * scale, ARCH_Z0 * scale + ARCH_Z * (1 - s * s) * scale


def arch_normal(s):
    nx = 2 * ARCH_Z * s
    nz = ARCH_X
    l = math.hypot(nx, nz)
    return nx / l, nz / l


TABLE_N = 400


def _arc_table():
    t = [0.0]
    px, pz = arch_point(-1)
    for i in range(1, TABLE_N + 1):
        s = -1 + (2 * i) / TABLE_N
        x, z = arch_point(s)
        t.append(t[i - 1] + math.hypot(x - px, z - pz))
        px, pz = x, z
    return t


ARC_TABLE = _arc_table()
ARCH_LENGTH = ARC_TABLE[TABLE_N]


def s_at_length(length):
    L = max(0.0, min(ARCH_LENGTH, length))
    lo, hi = 0, TABLE_N
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if ARC_TABLE[mid] < L:
            lo = mid
        else:
            hi = mid
    seg = (ARC_TABLE[hi] - ARC_TABLE[lo]) or 1
    f = (L - ARC_TABLE[lo]) / seg
    return -1 + (2 * (lo + f)) / TABLE_N


def s_at_length_ext(length):
    """Like s_at_length but extrapolates past the arch ends (for gum tissue behind the last molar)."""
    if 0 <= length <= ARCH_LENGTH:
        return s_at_length(length)
    # beyond the ends the arch continues along its end tangent: use |ds/dL| at the end
    x0, z0 = arch_point(1)
    x1, z1 = arch_point(1 - 1e-3)
    dsdl = 1e-3 / math.hypot(x0 - x1, z0 - z1)
    if length < 0:
        return -1 + length * dsdl
    return 1 + (length - ARCH_LENGTH) * dsdl


def layout_teeth():
    widths = [tooth_width(p) for p in range(TEETH_PER_ARCH)]
    total = sum(widths) + TOOTH_GAP * (TEETH_PER_ARCH - 1)
    out = []
    for arch in ('upper', 'lower'):
        scale = 1.0 if arch == 'upper' else LOWER_ARCH_SCALE
        cursor = (ARCH_LENGTH - total / scale) / 2
        for pos in range(TEETH_PER_ARCH):
            w = widths[pos]
            center = cursor + w / 2 / scale
            cursor += (w + TOOTH_GAP) / scale
            s = s_at_length(center)
            x, z = arch_point(s, scale)
            nx, nz = arch_normal(s)
            kind = KIND_BY_POS[pos]
            dims = TOOTH_DIMS[kind]
            out.append({
                'index': pos if arch == 'upper' else TEETH_PER_ARCH + pos,
                'arch': arch, 'pos': pos, 'kind': kind,
                'width': w, 'height': dims['h'], 'depth': dims['d'],
                's': s, 'x': x, 'y': UPPER_GUM_Y if arch == 'upper' else LOWER_GUM_Y, 'z': z,
                'yaw': math.atan2(nx, nz), 'nx': nx, 'nz': nz,
                'dir': -1 if arch == 'upper' else 1,
                'center_len': center,          # unit-scale arc length of the tooth center
                'half_len': w / 2 / scale,     # half width in unit-scale arc length
            })
    return out


def tooth_matrix(t):
    """Local -> world 4x4 (numpy) for a placement, exactly as the scene places teeth:
    translate(x, y, z) * rotY(yaw) * rotZ(pi for the upper arch) * scale(width / dims.w, 1, 1)."""
    import numpy as np
    sx = t['width'] / TOOTH_DIMS[t['kind']]['w']
    S = np.diag([sx, 1.0, 1.0, 1.0])
    c, s = math.cos(t['yaw']), math.sin(t['yaw'])
    Ry = np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1.0]])
    Rz = np.diag([-1.0, -1.0, 1.0, 1.0]) if t['dir'] < 0 else np.eye(4)
    T = np.eye(4)
    T[:3, 3] = (t['x'], t['y'], t['z'])
    return T @ Ry @ Rz @ S


if __name__ == '__main__':
    print('ARCH_LENGTH', round(ARCH_LENGTH, 4))
    for t in layout_teeth():
        print(t['index'], t['arch'], t['kind'], 's=%.3f x=%.3f z=%.3f yaw=%.1f' % (t['s'], t['x'], t['z'], math.degrees(t['yaw'])))
