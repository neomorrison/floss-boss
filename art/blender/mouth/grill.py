# The Grill Glow-Up case prop (DESIGN 11.6): grill_diamond, a platinum-and-gold grill over the upper front six teeth
# (upper arch positions 4..9: canine, four incisors, canine), set with twelve cut diamonds.
#
# Contract (docs/ARCHITECTURE.md "Mouth models" + the v4 brief):
#   Mouth space. Like gum_upper, X and Z are absolute mouth coordinates and Y is measured from the upper gumline:
#   the model's origin is the upper gumline center, so the scene places it at (0, UPPER_GUM_Y, 0) and it sits on
#   the teeth exactly (each cap is an offset of that tooth's own enamel surface, built from layoutTeeth()).
#   Nodes: the root mesh `Grill` (material Grill: the platinum caps with gold bezels, gold gem collars and gold
#   links; the two metals are COLOR_0 vertex colors on one material, so keep vertexColors if the material is
#   swapped) and twelve children Gem_00..Gem_11 (material Gem, one mesh each, pivot at the gem's girdle center,
#   identity rotation; the table faces out of the tooth). Gem order is center-out so the first N read well for
#   any grillGems count: Gem_00..05 are the big gems (one per tooth, center-incisal) in the order positions
#   6, 7, 5, 8, 4, 9; Gem_06..11 are the small gems near the gumline in the same order.
# Authored in three.js space (see lib.py).
import math
import bmesh
import numpy as np
from mathutils import Vector
import lib
import implicit as im
import teeth as teeth_mod
from mouthgeo import layout_teeth, tooth_matrix, TOOTH_DIMS, UPPER_GUM_Y
from lib import Part

lib.STD.update({
    'Grill': ('#FFFFFF', 0.24, 0.3),     # base white: the vertex colors carry platinum and gold
    'Gem':   ('#E8F6FF', 0.06, 0.05),
})
lib.EMISSIVE['Gem'] = 0.35

PLATINUM = lib.hex_rgb('#DCE4EC')
GOLD = lib.hex_rgb('#F2C14E')
GOLD_DARK = lib.hex_rgb('#D9A23A')

POSITIONS = [4, 5, 6, 7, 8, 9]
GEM_ORDER = [6, 7, 5, 8, 4, 9]
GAP = 0.012          # enamel to the inside of the cap
THICK = 0.045        # cap thickness
RIM = 0.018          # the gold bezel stands this much proud of the cap
# normalized cap grid: columns across the tooth (fraction of the side angle), rows gumline -> incisal edge.
# The rows/columns right next to the border are close together so the gold bezel band ends crisply.
U = [-1.0, -0.86, -0.78, -0.35, 0.0, 0.35, 0.78, 0.86, 1.0]
V = [0.0, 0.12, 0.19, 0.5, 0.81, 0.88, 1.0]
THETA = {'incisor': math.radians(64), 'canine': math.radians(60)}


def _normal(f, P, eps=1e-3):
    g = np.zeros_like(P)
    for k in range(3):
        d = np.zeros(3)
        d[k] = eps
        g[:, k] = f(P + d) - f(P - d)
    return g / np.maximum(np.linalg.norm(g, axis=1)[:, None], 1e-12)


def _center_z(f, y):
    """Middle of the tooth's inside interval along z at x = 0, height y (local tooth space)."""
    zs = np.linspace(-0.7, 0.7, 281)
    vals = f(np.stack([np.zeros_like(zs), np.full_like(zs, y), zs], 1))
    inside = zs[vals < 0]
    return float((inside.min() + inside.max()) / 2) if len(inside) else None


def _surface(f, y, theta):
    """Labial surface point (local tooth space) at height y, direction theta from the tooth's axis."""
    zc = _center_z(f, y)
    if zc is None:
        return None
    C = np.array([0.0, y, zc])
    D = np.array([[math.sin(theta), 0.0, math.cos(theta)]])
    t = im._raycast(f, C, D, 1.0)[0]
    return C + D[0] * t


def _edge_height(f, p, h):
    """How high the enamel reaches at the labial point p's x (the incisal edge or the cusp slope there): the
    highest y where some z at that x is still inside the tooth."""
    x = p[0] * 0.96
    ys = np.linspace(p[1], h + 0.1, 120)
    zs = np.linspace(-0.7, 0.7, 141)
    Y, Z = np.meshgrid(ys, zs, indexing='ij')
    vals = f(np.stack([np.full(Y.size, x), Y.ravel(), Z.ravel()], 1)).reshape(Y.shape)
    inside = (vals < 0).any(axis=1)
    k = np.nonzero(inside)[0]
    return float(ys[k[-1]]) if len(k) else h


def _column(f, h, th, u):
    """Crown heights (bottom at the gum side, top at the incisal side) of the cap column at u."""
    mid = _surface(f, 0.6 * h, u * th)
    top = _edge_height(f, mid, h) - 0.045              # stop just short of the incisal edge / cusp slope
    bot = 0.1 + 0.2 * abs(u) ** 2.2                    # follows the gum scallop: higher toward the papillae
    return bot, top


def cap_grid(t):
    """Surface points and normals (local tooth space) of one tooth's cap: rows x cols arrays."""
    kind = t['kind']
    f = teeth_mod.tooth_fn(kind)
    h = TOOTH_DIMS[kind]['h']
    th = THETA[kind]
    P = np.zeros((len(V), len(U), 3))
    for j, u in enumerate(U):
        bot, top = _column(f, h, th, u)
        for i, v in enumerate(V):
            P[i, j] = _surface(f, bot + (top - bot) * v, u * th)
    N = _normal(f, P.reshape(-1, 3)).reshape(P.shape)
    return P, N


def gem_spots(t):
    """(center, outward normal) in model space for the tooth's big gem and small gem. Incisors: on the tooth's
    center line. Canines face sideways, so their gems sit a little toward the midline to read from the front."""
    kind = t['kind']
    f = teeth_mod.tooth_fn(kind)
    h = TOOTH_DIMS[kind]['h']
    th = THETA[kind]
    cands = [0.0] if kind == 'incisor' else [0.28, -0.28]
    best = None
    for u in cands:
        bot, top = _column(f, h, th, u)
        spots = []
        for v in (0.64, 0.24):
            p = _surface(f, bot + (top - bot) * v, u * th)
            n = _normal(f, p[None, :])[0]
            c = _to_model(t, (p + n * (GAP + THICK + 0.012))[None, None, :])[0, 0]
            nm = _dir_to_model(t, n[None, None, :])[0, 0]
            spots.append((c, nm))
        if best is None or abs(spots[0][0][0]) < abs(best[0][0][0]):
            best = spots
    return best


def _to_model(t, P):
    """Local tooth points -> model space (mouth x, z; y from the upper gumline)."""
    Mx = tooth_matrix(t)
    Q = (np.c_[P.reshape(-1, 3), np.ones(P.size // 3)] @ Mx.T)[:, :3]
    Q[:, 1] -= UPPER_GUM_Y
    return Q.reshape(P.shape)


def _dir_to_model(t, N):
    Mx = tooth_matrix(t)[:3, :3]
    Q = N.reshape(-1, 3) @ Mx.T
    Q /= np.maximum(np.linalg.norm(Q, axis=1)[:, None], 1e-12)
    return Q.reshape(N.shape)


def build_grill():
    import bpy
    lay = {t['pos']: t for t in layout_teeth() if t['arch'] == 'upper'}
    grill = lib.M('Grill')
    lib.use_vertex_colors(grill)
    part = Part('Grill')
    col_v, col_c = [], []
    gems = {}          # pos -> [(center, normal, radius) big, small]
    edges = {}         # pos -> (left side mid point, right side mid point) on the outer surface, model space
    nr, nc = len(V), len(U)
    for pos in POSITIONS:
        t = lay[pos]
        P, N = cap_grid(t)
        border = np.zeros((nr, nc), bool)
        border[[0, 1, -2, -1], :] = True
        border[:, [0, 1, -2, -1]] = True
        out_off = np.where(border, GAP + THICK + RIM, GAP + THICK)[..., None]
        outer = _to_model(t, P + N * out_off)
        inner = _to_model(t, P + N * GAP)
        verts = [tuple(p) for p in outer.reshape(-1, 3)] + [tuple(p) for p in inner.reshape(-1, 3)]
        n = nr * nc
        idx = lambda i, j: i * nc + j
        faces = []
        for i in range(nr - 1):
            for j in range(nc - 1):
                q = [idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)]
                faces.append(q)
                faces.append([k + n for k in reversed(q)])
        ring = [idx(0, j) for j in range(nc)] + [idx(i, nc - 1) for i in range(1, nr)] + \
               [idx(nr - 1, j) for j in range(nc - 2, -1, -1)] + [idx(i, 0) for i in range(nr - 2, 0, -1)]
        for k in range(len(ring)):
            a, b = ring[k], ring[(k + 1) % len(ring)]
            faces.append([a, b, b + n, a + n])
        part.add_mesh(verts, faces, grill)
        cols = [GOLD if border.reshape(-1)[k] else PLATINUM for k in range(n)] + [GOLD_DARK] * n
        col_v += verts
        col_c += cols
        # the two gems: big one at the tooth's center toward the edge, small one near the gumline
        w_scale = t['width'] / 0.85
        gl = [(c, nm, r * min(1.0, w_scale ** 0.6)) for (c, nm), r in zip(gem_spots(t), (0.125, 0.085))]
        gems[pos] = gl
        # side midpoints on the outer surface (for the links between neighbouring caps)
        mi = nr // 2 - 1
        edges[pos] = (outer[mi, 0], outer[mi, -1])
    # gold links through the gaps between neighbouring caps (model x: the upper arch is mirrored, so the
    # tooth's local -x side lands on +x in the mouth; pick whichever side end is nearer the neighbour)
    for a, b in zip(POSITIONS, POSITIONS[1:]):
        ea, eb = edges[a], edges[b]
        pa = min(ea, key=lambda p: np.linalg.norm(p - (eb[0] + eb[1]) / 2))
        pb = min(eb, key=lambda p: np.linalg.norm(p - pa))
        mid = (pa + pb) / 2
        part.sweep([tuple(pa), tuple(mid + np.array([0.0, 0.0, 0.02])), tuple(pb)], 0.028, grill, verts=6)
    # gold collars around the gems
    for pos in POSITIONS:
        for (c, nm, r) in gems[pos]:
            q = Vector((0, 1, 0)).rotation_difference(Vector(tuple(nm)))
            mat = q.to_matrix().to_4x4()
            mat.translation = Vector(tuple(c))
            # a bezel ring: a closed profile loop (inner bottom, outer bottom, outer top, inner top) that just
            # laps over the girdle, so the crown facets stay clear
            prof = [(r * 1.0, -0.06), (r * 1.2, -0.04), (r * 0.97, 0.012), (r * 1.0, -0.06)]
            tmp_part = Part('_c')
            tmp_part.lathe(prof, grill, verts=8, close_ends=False)
            bmesh.ops.remove_doubles(tmp_part.bm, verts=tmp_part.bm.verts[:], dist=1e-6)
            bmesh.ops.transform(tmp_part.bm, matrix=mat, verts=tmp_part.bm.verts)
            part._emit(tmp_part.bm, grill, False)
    colfn = lib.color_lookup(col_v, col_c, default=GOLD)
    root = part.finish(smooth_angle=50, color_fn=colfn)
    # gems: separate child nodes, pivot at the girdle center, rotation baked into the mesh
    gem_m = lib.M('Gem')
    order = [(pos, 0) for pos in GEM_ORDER] + [(pos, 1) for pos in GEM_ORDER]
    for k, (pos, which) in enumerate(order):
        c, nm, r = gems[pos][which]
        g = Part('Gem_%02d' % k)
        V_, F_ = gem_mesh(r)
        q = Vector((0, 1, 0)).rotation_difference(Vector(tuple(nm)))
        g.add_mesh(V_, F_, gem_m, flat=True, matrix=q.to_matrix().to_4x4())
        go = g.finish(smooth_angle=0)
        go.location = lib.TO_BLENDER @ Vector(tuple(c))
        go.parent = root
        go.matrix_parent_inverse.identity()
    bpy.context.view_layer.update()
    return root


def gem_mesh(r, n=8):
    """A small cut diamond: octagonal table, a crown of n facets down to the girdle, a pavilion of n facets to the
    culet. Table toward +Y, girdle at y = 0. Flat shaded (every facet catches the light on its own). Winding is
    fixed by finish()'s recalc."""
    table_r, crown_h, pav_h = 0.56 * r, 0.34 * r, 0.62 * r
    V_ = []
    for k in range(n):
        a = 2 * math.pi * (k + 0.5) / n
        V_.append((table_r * math.cos(a), crown_h, table_r * math.sin(a)))
    for k in range(n):
        a = 2 * math.pi * k / n
        V_.append((r * math.cos(a), 0.0, r * math.sin(a)))
    V_.append((0.0, -pav_h, 0.0))
    F_ = [list(range(n))]
    for k in range(n):
        k1 = (k + 1) % n
        F_.append([k, k1, n + k1, n + k])                # crown facet (table edge to girdle edge, offset half a step)
        F_.append([n + k, n + k1, 2 * n])                # pavilion facet
    return V_, F_


def builders():
    """key -> (build function, exports vertex colors)"""
    return {'grill_diamond': (build_grill, True)}
