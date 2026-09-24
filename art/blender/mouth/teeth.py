# Cartoon teeth: incisor (spade), canine (pointy), premolar (two cusps), molar (four cusps).
#
# Contract (docs/ARCHITECTURE.md, Mouth models): crown dimensions from TOOTH_DIMS (w along X, h along +Y,
# d along Z), origin at the gumline center, crown toward +Y, root stub to y = -0.35, labial face +Z,
# material Enamel, 800 to 2,500 triangles, smooth, closed shell. We also write the contract's cylindrical
# UVs (u = atan2(x, z) / 2pi + 0.5, v = y / h) with the seam split along the back (x = 0, z < 0).
import math
import numpy as np
import lib
import implicit as im
from mouthgeo import TOOTH_DIMS, ROOT_Y

# per kind: cube-sphere resolution (12 n^2 triangles) and shape parameters
SPEC = {
    'incisor': {'n': 12},
    'canine': {'n': 12},
    'premolar': {'n': 12},
    'molar': {'n': 14},
}


def _cusp(x, z, cx, cz, hc, kx, kz, e):
    return hc - kx * (np.sqrt((x - cx) ** 2 + e * e) - e) - kz * (np.sqrt((z - cz) ** 2 + e * e) - e)


def tooth_fn(kind):
    D = TOOTH_DIMS[kind]
    w, h, d = D['w'], D['h'], D['d']
    hw, hd = w / 2, d / 2
    S = im.sstep

    def profile(t):
        """half width, labial z, lingual z at crown height fraction t (0 gumline, 1 top)."""
        if kind == 'incisor':
            W = hw * (0.64 + 0.36 * S(0.0, 0.66, t))
            zF = hd * (0.84 + 0.16 * S(0.0, 0.3, t) - 0.12 * S(0.45, 1.0, t))
            zB0 = -hd * (0.84 + 0.16 * S(0.0, 0.22, t))
            zB = zB0 + (zF - 0.27 - zB0) * S(0.22, 0.97, t)
        elif kind == 'canine':
            W = hw * (0.72 + 0.28 * S(0.0, 0.55, t))
            zF = hd * (0.84 + 0.16 * S(0.0, 0.3, t) - 0.14 * S(0.5, 1.0, t))
            zB0 = -hd * (0.84 + 0.16 * S(0.0, 0.25, t))
            zB = zB0 + (zF - 0.42 - zB0) * S(0.3, 1.0, t)
        elif kind == 'premolar':
            W = hw * (0.76 + 0.24 * S(0.0, 0.45, t) - 0.07 * S(0.6, 1.0, t))
            zF = hd * (0.80 + 0.20 * S(0.0, 0.35, t) - 0.08 * S(0.6, 1.0, t))
            zB = -hd * (0.80 + 0.20 * S(0.0, 0.45, t) - 0.08 * S(0.6, 1.0, t))
        else:  # molar
            W = hw * (0.80 + 0.20 * S(0.0, 0.45, t) - 0.06 * S(0.6, 1.0, t))
            zF = hd * (0.80 + 0.20 * S(0.0, 0.4, t) - 0.06 * S(0.6, 1.0, t))
            zB = -hd * (0.80 + 0.20 * S(0.0, 0.45, t) - 0.06 * S(0.6, 1.0, t))
        return W, zF, zB

    p_exp = {'incisor': 2.7, 'canine': 2.2, 'premolar': 2.6, 'molar': 2.8}[kind]
    taper = {'incisor': 0.24, 'canine': 0.2, 'premolar': 0.12, 'molar': 0.1}[kind]
    k_top = {'incisor': 0.08, 'canine': 0.08, 'premolar': 0.1, 'molar': 0.11}[kind]

    def top(x, z):
        if kind == 'incisor':
            return h - 0.16 * (np.abs(x) / hw) ** 3.5
        if kind == 'canine':
            return _cusp(x, z, 0.0, 0.05, h, 0.62, 0.55, 0.05)
        if kind == 'premolar':
            a = _cusp(x, z, 0.0, 0.15, h, 0.5, 0.62, 0.07)
            b = _cusp(x, z, 0.0, -0.17, h - 0.09, 0.5, 0.62, 0.07)
            return im.smax(a, b, 0.07)
        c = [_cusp(x, z, sx * 0.25, 0.21, h, 0.55, 0.55, 0.1) for sx in (-1, 1)]
        c += [_cusp(x, z, sx * 0.25, -0.22, h - 0.04, 0.55, 0.55, 0.1) for sx in (-1, 1)]
        r = im.smax(c[0], c[1], 0.06)
        r = im.smax(r, c[2], 0.06)
        return im.smax(r, c[3], 0.06)

    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        t = np.clip(y / h, 0.0, 1.0)
        W, zF, zB = profile(t)
        # root stub: shrink toward the tip below the gumline
        rt = np.clip(y / ROOT_Y, 0.0, 1.0)
        rs = 1.0 - 0.38 * rt ** 1.2
        W, zF, zB = W * rs, zF * rs, zB * rs
        zc = (zF + zB) / 2
        T = (zF - zB) / 2
        Weff = W * (1.0 - taper * np.clip((zc - z) / T, 0.0, 1.0) ** 2)
        q = ((np.abs(x) / Weff) ** p_exp + (np.abs(z - zc) / T) ** p_exp) ** (1.0 / p_exp)
        f_side = (q - 1.0) * np.minimum(W, T)
        f = im.smax(f_side, y - top(x, z), k_top)
        return im.smax(f, ROOT_Y - y, 0.12)

    return f


def build(kind):
    D = TOOTH_DIMS[kind]
    w, h, d = D['w'], D['h'], D['d']
    f = tooth_fn(kind)
    center = (0.0, (h + ROOT_Y) / 2, 0.0)
    radii = (w / 2, (h - ROOT_Y) / 2, d / 2)
    P, quads = im.mesh_star(f, center, radii, n=SPEC[kind]['n'], relax=8)
    part = lib.Part('tooth_' + kind)
    part.add_mesh([tuple(p) for p in P], quads, lib.M('Enamel'))

    def uv(face, loop):
        co = loop.vert.co
        if abs(co.x) < 1e-9 and co.z < 0:
            cx = sum(v.co.x for v in face.verts)
            u = 0.0 if cx < 0 else 1.0
        else:
            u = math.atan2(co.x, co.z) / (2 * math.pi) + 0.5
        return (u, co.y / h)

    return part.finish(all_smooth=True, uv_fn=uv)


def builders():
    return {'tooth_' + k: (lambda k=k: build(k)) for k in ('incisor', 'canine', 'premolar', 'molar')}
