# Floss Boss clinic art: shared Blender helpers (adapted from the Mow Money machine helpers).
#
# Geometry is built with bmesh directly (no operators), which keeps the scripts fast, deterministic
# and safe to run headless. A Part accumulates primitives (each with a material) into one bmesh and
# becomes one mesh object on finish(). Conventions (Blender space): Z up, the model's front faces -Y,
# 1 unit = 1 meter, origin on the floor at the footprint center. The glTF exporter turns this into
# three.js space (+Y up, front toward +Z).
import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
MODELS_DIR = os.path.join(ROOT, 'public', 'models')
THUMBS_DIR = os.path.join(ROOT, 'public', 'img', 'thumbs')
OUT_DIR = os.path.join(ROOT, 'out')
PREVIEW_DIR = os.path.join(OUT_DIR, 'preview-clinic')

rad = math.radians


# ------------------------------------------------------------------ scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects, bpy.data.cameras, bpy.data.lights,
                  bpy.data.worlds):
        for item in list(block):
            block.remove(item)


def scene():
    return bpy.context.scene


def link(ob):
    scene().collection.objects.link(ob)
    return ob


def empty(name, loc=(0, 0, 0), parent=None, size=0.1):
    """An empty at world position loc (parented without changing its world position)."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = size
    link(ob)
    set_parent(ob, parent, loc)
    return ob


def set_parent(ob, parent, world_loc):
    """Parent with identity rotation: the child's local location is its world offset from the parent."""
    bpy.context.view_layer.update()
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.location = Vector(world_loc) - parent.matrix_world.translation
    else:
        ob.location = Vector(world_loc)
    bpy.context.view_layer.update()


# ------------------------------------------------------------------ materials

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# Clinic palette (docs/DESIGN.md section 9): mint, teal, bubblegum, sunshine, enamel white. Metalness
# stays low on purpose: three.js renders metallic surfaces almost black without an environment map.
# name: (hex, roughness, metalness)
STD = {
    'Enamel':     ('#FFFDF7', 0.45, 0.0),   # main white body color
    'Cream':      ('#F3ECDF', 0.6, 0.0),    # secondary off-white
    'Mint':       ('#3DD6B5', 0.5, 0.0),
    'MintLight':  ('#A9EEDD', 0.55, 0.0),
    'Teal':       ('#0E8F8A', 0.5, 0.0),
    'TealDark':   ('#0B6F6B', 0.55, 0.0),
    'Bubblegum':  ('#FF7AA8', 0.5, 0.0),
    'Blush':      ('#FFB8CE', 0.6, 0.0),
    'Sunshine':   ('#FFD166', 0.5, 0.0),
    'Coral':      ('#FF9B7A', 0.55, 0.0),
    'Sky':        ('#7CC8F2', 0.5, 0.0),
    'Lilac':      ('#B9A6F2', 0.55, 0.0),
    'Slate':      ('#51656F', 0.6, 0.0),    # the darkest body color: soft slate, never black
    'Rubber':     ('#4C5B63', 0.85, 0.0),   # casters, pads, cables
    'Steel':      ('#C3CDD4', 0.35, 0.2),
    'Chrome':     ('#E3E9ED', 0.25, 0.3),
    'Gold':       ('#F2BE45', 0.32, 0.35),
    'Wood':       ('#E2B47E', 0.7, 0.0),
    'WoodDark':   ('#BE8A5C', 0.7, 0.0),
    'Paper':      ('#FFFFFF', 0.8, 0.0),
    'Screen':     ('#2A5361', 0.25, 0.0),   # an unlit screen: deep teal, not black
    'Glass':      ('#CDEFF5', 0.08, 0.0),
    'Water':      ('#7FD3EC', 0.1, 0.0),
    'LeafA':      ('#5ACB88', 0.65, 0.0),
    'LeafB':      ('#34A873', 0.65, 0.0),
    'LeafC':      ('#93DDA3', 0.65, 0.0),
    'Soil':       ('#8A6246', 0.95, 0.0),
    'Light':      ('#FFF3C4', 0.3, 0.0),
    'LightBlue':  ('#9FE3FF', 0.3, 0.0),
    'Glow':       ('#8CF0DB', 0.35, 0.0),
    'Ink':        ('#2B3C45', 0.45, 0.0),   # eyes and fine print: soft ink, never pure black
    'Coffee':     ('#8A5A2B', 0.4, 0.0),
    # people
    'Skin':       ('#EDB793', 0.65, 0.0),
    'Hair':       ('#8A6A52', 0.8, 0.0),
    'Shirt':      ('#8EB5D6', 0.8, 0.0),
    'Pants':      ('#667A96', 0.8, 0.0),
    'Shoes':      ('#7A675C', 0.7, 0.0),
    'Scrubs':     ('#5EC6B6', 0.75, 0.0),
    'Coat':       ('#F7FAF9', 0.7, 0.0),
    'Eye':        ('#2B3A44', 0.3, 0.0),
    'EyeShine':   ('#FFFFFF', 0.3, 0.0),
    'Mouth':      ('#B94A62', 0.5, 0.0),
    'Cheek':      ('#FF9DB5', 0.7, 0.0),
    'Glasses':    ('#5A6B78', 0.4, 0.0),
    'Sole':       ('#F4F0EA', 0.7, 0.0),
}
EMISSIVE = {'Light': 1.6, 'LightBlue': 1.6, 'Glow': 0.9}
ALPHA = {'Glass': 0.28, 'Water': 0.5}


def material(name, color=None, rough=None, metal=None, emit=None, alpha=None):
    """Get or create a Principled material. Standard names pull their look from STD."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    std = STD.get(name)
    if color is None:
        color = std[0] if std else '#FF00FF'
    if rough is None:
        rough = std[1] if std else 0.55
    if metal is None:
        metal = std[2] if std else 0.0
    if emit is None:
        emit = EMISSIVE.get(name, 0.0)
    if alpha is None:
        alpha = ALPHA.get(name, 1.0)
    lin = hex_rgb(color) if isinstance(color, str) else tuple(color)
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*lin, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = (*lin, alpha)
    m.roughness = rough
    m.metallic = metal
    # every mesh is a closed shell with outward normals, so export single-sided (cheaper in three.js);
    # see-through materials stay double-sided so the far side of a tank shows through the near side.
    m.use_backface_culling = alpha >= 1.0
    return m


def M(name, color=None, **kw):
    return material(name, color, **kw)


# ------------------------------------------------------------------ geometry

def _mat4(loc=(0, 0, 0), rot=None, scale=None):
    mm = Matrix.Translation(Vector(loc))
    if rot is not None:
        mm = mm @ Euler(tuple(rad(a) for a in rot), 'XYZ').to_matrix().to_4x4()
    if scale is not None:
        mm = mm @ Matrix.Diagonal((*scale, 1.0))
    return mm


AXIS_ROT = {'Z': None, 'X': (0, 90, 0), 'Y': (90, 0, 0)}


def arc(cu, cv, r, a0, a1, n):
    """Points on a circular arc in 2D (degrees, counterclockwise from +u)."""
    return [(cu + r * math.cos(rad(a0 + (a1 - a0) * i / n)), cv + r * math.sin(rad(a0 + (a1 - a0) * i / n)))
            for i in range(n + 1)]


def rrect(w, h, r, n=3, cu=0.0, cv=0.0):
    """Counterclockwise rounded rectangle (2D) centered at (cu, cv)."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    hw, hh = w / 2 - r, h / 2 - r
    pts = []
    for (x, y, a0) in ((hw, -hh, -90), (hw, hh, 0), (-hw, hh, 90), (-hw, -hh, 180)):
        pts += arc(cu + x, cv + y, r, a0, a0 + 90, n)
    return pts


def ellipse(rx, ry, n=16, cu=0.0, cv=0.0):
    return [(cu + rx * math.cos(2 * math.pi * i / n), cv + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def tooth2d(w=1.0, h=1.0, n=5):
    """A cartoon molar silhouette (two crown lobes, two rounded roots), counterclockwise, centered, w x h."""
    right = []
    right += arc(0.0, -0.215, 0.075, 90, 0, n)[1:]                  # notch between the roots (from the middle)
    right += [(0.09, -0.28)]
    right += arc(0.2, -0.4, 0.1, 180, 360, n + 1)                   # rounded root tip
    right += [(0.33, -0.2), (0.4, 0.0)]
    right += arc(0.2, 0.2, 0.25, -30, 95, n + 2)                     # crown lobe
    right += [(0.07, 0.43)]
    pts = [(0.0, -0.14)] + right + [(0.0, 0.38)]
    left = [(-x, y) for (x, y) in reversed(right)]
    pts += left
    out = []
    for p in pts:
        if not out or (abs(out[-1][0] - p[0]) + abs(out[-1][1] - p[1])) > 1e-3:
            out.append(p)
    return [(x * w, y * h) for (x, y) in out]


class Part:
    """Accumulates primitives into one mesh. finish() makes the object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    # -- internal
    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _emit(self, tmp, m, flat, matrix=None):
        if matrix is not None:
            bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts)
            if matrix.determinant() < 0:
                bmesh.ops.reverse_faces(tmp, faces=tmp.faces[:])
        idx = self._mi(m)
        vmap = {}
        for v in tmp.verts:
            vmap[v] = self.bm.verts.new(v.co)
        for f in tmp.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idx
            nf.smooth = not flat
        tmp.free()

    @staticmethod
    def _bevel_all(tmp, amount, seg):
        if amount > 0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges) + list(tmp.verts), offset=amount, offset_type='OFFSET',
                            segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)

    # -- primitives
    def box(self, size, loc, m, bevel=0.0, seg=1, rot=None, taper=None, shift=None, flat=None):
        """Box centered at loc. taper=(sx, sy) scales the top face, shift=(dx, dy) slides it."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            top = v.co.z > 0
            v.co.x *= size[0]
            v.co.y *= size[1]
            v.co.z *= size[2]
            if top and taper:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
            if top and shift:
                v.co.x += shift[0]
                v.co.y += shift[1]
        self._bevel_all(tmp, bevel, seg)
        self._emit(tmp, m, flat if flat is not None else seg <= 1, _mat4(loc, rot))

    def bx(self, x0, x1, y0, y1, z0, z1, m, **kw):
        self.box((abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), m, **kw)

    def rbox(self, size, loc, m, r=0.02, seg=2, rot=None, **kw):
        """Rounded box: bevel radius r clamped to the smallest half-extent."""
        r = min(r, min(size) * 0.49)
        self.box(size, loc, m, bevel=r, seg=seg, rot=rot, flat=False, **kw)

    def cyl(self, r, depth, loc, m, axis='Z', verts=16, r2=None, bevel=0.0, seg=1, rot=None, flat=False,
            caps=True, scale=None):
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=caps, cap_tris=False, segments=verts, radius1=r,
                              radius2=r if r2 is None else r2, depth=depth)
        if bevel > 0 and caps:
            edges = [e for e in tmp.edges if len(e.link_faces) == 2 and
                     any(len(f.verts) > 4 for f in e.link_faces)]
            bmesh.ops.bevel(tmp, geom=edges, offset=bevel, offset_type='OFFSET', segments=seg, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        mm = _mat4(loc, rot)
        if AXIS_ROT[axis]:
            mm = mm @ Euler(tuple(rad(a) for a in AXIS_ROT[axis]), 'XYZ').to_matrix().to_4x4()
        if scale:
            mm = mm @ Matrix.Diagonal((*scale, 1.0))
        self._emit(tmp, m, flat, mm)

    def tube(self, p1, p2, r, m, verts=8, r2=None, flat=False, caps=True):
        p1, p2 = Vector(p1), Vector(p2)
        d = p2 - p1
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=caps, cap_tris=False, segments=verts, radius1=r,
                              radius2=r if r2 is None else r2, depth=d.length)
        mm = Matrix.Translation((p1 + p2) / 2) @ q.to_matrix().to_4x4()
        self._emit(tmp, m, flat, mm)

    def capsule(self, p1, p2, r, m, verts=10, rings=3, r2=None):
        """A rounded limb from p1 to p2 (radius r at p1, r2 at p2), hemispherical ends."""
        p1, p2 = Vector(p1), Vector(p2)
        r2 = r if r2 is None else r2
        L = (p2 - p1).length
        prof = []
        for i in range(rings + 1):             # bottom cap (at p1) from the pole up
            a = -90 + 90 * i / rings
            prof.append((r * math.cos(rad(a)), r * math.sin(rad(a))))
        for i in range(rings + 1):             # top cap (at p2)
            a = 90 * i / rings
            prof.append((r2 * math.cos(rad(a)), L + r2 * math.sin(rad(a))))
        q = Vector((0, 0, 1)).rotation_difference((p2 - p1).normalized())
        self.lathe(prof, (0, 0, 0), m, segs=verts, matrix=Matrix.Translation(p1) @ q.to_matrix().to_4x4())

    def sphere(self, r, loc, m, seg=12, rings=8, scale=None, rot=None, flat=False, ico=None):
        tmp = bmesh.new()
        if ico is not None:
            bmesh.ops.create_icosphere(tmp, subdivisions=ico, radius=r)
        else:
            bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=rings, radius=r)
        self._emit(tmp, m, flat, _mat4(loc, rot, scale))

    def sphere_cut(self, r, loc, m, plane_no, plane_off=0.0, seg=16, rings=12, scale=None, rot=None, flat=False,
                   keep='below'):
        """A sphere sliced by a plane (normal plane_no in the sphere's local frame, offset plane_off from the
        center along it) with the cut filled: keep 'below' drops the part the normal points into."""
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=rings, radius=r)
        n = Vector(plane_no).normalized()
        geom = list(tmp.verts) + list(tmp.edges) + list(tmp.faces)
        bmesh.ops.bisect_plane(tmp, geom=geom, dist=1e-5, plane_co=n * plane_off, plane_no=n,
                               clear_outer=(keep == 'below'), clear_inner=(keep != 'below'))
        boundary = [e for e in tmp.edges if e.is_boundary]
        if boundary:
            bmesh.ops.holes_fill(tmp, edges=boundary, sides=0)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self._emit(tmp, m, flat, _mat4(loc, rot, scale))

    def lathe(self, prof, loc, m, segs=16, scale=None, rot=None, flat=False, matrix=None, a0=0.0):
        """Revolve a (radius, z) profile, listed bottom to top, around Z. r == 0 ends become poles,
        open ends get capped, so the result is a closed shell."""
        tmp = bmesh.new()
        rings = []
        for (r, z) in prof:
            if r < 1e-6:
                rings.append([tmp.verts.new((0, 0, z))])
            else:
                rings.append([tmp.verts.new((r * math.cos(2 * math.pi * k / segs + a0),
                                             r * math.sin(2 * math.pi * k / segs + a0), z)) for k in range(segs)])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            if len(a) == 1 and len(b) == 1:
                continue
            for k in range(segs):
                k2 = (k + 1) % segs
                if len(a) == 1:
                    tmp.faces.new([a[0], b[k], b[k2]])
                elif len(b) == 1:
                    tmp.faces.new([a[k], b[0], a[k2]])
                else:
                    tmp.faces.new([a[k], a[k2], b[k2], b[k]])
        if len(rings[0]) > 1:
            tmp.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            tmp.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        mm = matrix if matrix is not None else _mat4(loc, rot, scale)
        self._emit(tmp, m, flat, mm)

    def sweep(self, pts, r, m, verts=8, closed=False, caps=True, flat=False, rscale=None):
        """Tube along a polyline with mitered joints. rscale=(sx, sy) makes an oval section."""
        P = [Vector(p) for p in pts]
        n = len(P)
        T = []
        for i in range(n):
            if closed:
                d = (P[(i + 1) % n] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
            elif i == 0:
                d = P[1] - P[0]
            elif i == n - 1:
                d = P[-1] - P[-2]
            else:
                d = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
            T.append(d.normalized())
        up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
        N = (up - T[0] * up.dot(T[0])).normalized()
        tmp = bmesh.new()
        rings = []
        for i in range(n):
            if i > 0:
                q = T[i - 1].rotation_difference(T[i])
                N = q @ N
                N = (N - T[i] * N.dot(T[i])).normalized()
            B = T[i].cross(N)
            inner = closed or 0 < i < n - 1
            bend = None
            scale = 1.0
            if inner:
                sin_ = (P[(i + 1) % n] - P[i]).normalized()
                c = max(sin_.dot(T[i]), 0.35)
                scale = 1.0 / c
                bd = sin_ - T[i] * sin_.dot(T[i])
                if bd.length > 1e-6:
                    bend = bd.normalized()
            ring = []
            for k in range(verts):
                a = 2 * math.pi * k / verts
                sx, sy = rscale if rscale else (1.0, 1.0)
                o = (N * math.cos(a) * sx + B * math.sin(a) * sy) * r
                if bend is not None:
                    o = o + bend * o.dot(bend) * (scale - 1.0)
                ring.append(tmp.verts.new(P[i] + o))
            rings.append(ring)
        segs = n if closed else n - 1
        for i in range(segs):
            a, b = rings[i], rings[(i + 1) % n]
            for k in range(verts):
                k2 = (k + 1) % verts
                tmp.faces.new([a[k], a[k2], b[k2], b[k]])
        if caps and not closed:
            tmp.faces.new(list(reversed(rings[0])))
            tmp.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self._emit(tmp, m, flat)

    def torus(self, R, r, loc, m, segs=20, verts=8, rot=None, scale=None):
        """A ring of major radius R around Z (tube radius r)."""
        pts = [(R * math.cos(2 * math.pi * i / segs), R * math.sin(2 * math.pi * i / segs), 0) for i in range(segs)]
        tmp_part = Part('_t')
        tmp_part.sweep(pts, r, m, verts=verts, closed=True)
        tmp = tmp_part.bm
        self._emit(tmp, m, False, _mat4(loc, rot, scale))

    def prism(self, pts, width, m, axis='X', center=0.0, bevel=0.0, seg=1, flat=True, loc=(0, 0, 0), rot=None):
        """Extrude a 2D polygon. axis X: pts are (y, z). axis Y: (x, z). axis Z: (x, y)."""
        tmp = bmesh.new()

        def v3(u, v, w):
            if axis == 'X':
                return Vector((w, u, v))
            if axis == 'Y':
                return Vector((u, w, v))
            return Vector((u, v, w))
        a = [tmp.verts.new(v3(u, v, center - width / 2)) for (u, v) in pts]
        b = [tmp.verts.new(v3(u, v, center + width / 2)) for (u, v) in pts]
        tmp.faces.new(a)
        tmp.faces.new(list(reversed(b)))
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            tmp.faces.new([a[i], a[j], b[j], b[i]])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self._bevel_all(tmp, bevel, seg)
        self._emit(tmp, m, flat, _mat4(loc, rot))

    def plate(self, pts, t, loc, m, axis='Y', rot=None, bevel=0.0, seg=1, flat=True):
        """A flat 2D shape of thickness t facing -Y (axis Y, pts are (x, z)) or up (axis Z, pts are (x, y)),
        centered on loc."""
        self.prism(pts, t, m, axis=axis, center=0.0, bevel=bevel, seg=seg, flat=flat, loc=loc, rot=rot)

    def slab(self, pts, t, m, flat=True):
        """A thin plate from a planar 3D polygon, thickened by t along its normal."""
        tmp = bmesh.new()
        P = [Vector(p) for p in pts]
        nrm = Vector((0, 0, 0))
        for i in range(len(P)):
            nrm += P[i].cross(P[(i + 1) % len(P)])
        nrm.normalize()
        a = [tmp.verts.new(p) for p in P]
        b = [tmp.verts.new(p + nrm * t) for p in P]
        tmp.faces.new(a)
        tmp.faces.new(list(reversed(b)))
        for i in range(len(P)):
            j = (i + 1) % len(P)
            tmp.faces.new([a[i], a[j], b[j], b[i]])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self._emit(tmp, m, flat)

    def transform(self, loc=(0, 0, 0), rot=None, scale=None):
        """Transform everything added so far (used to pose a whole sub-assembly)."""
        bmesh.ops.transform(self.bm, matrix=_mat4(loc, rot, scale), verts=self.bm.verts)

    def mark(self):
        """Remember the vertex count, so a sub-assembly built after it can be posed with xform_since."""
        self.bm.verts.ensure_lookup_table()
        return len(self.bm.verts)

    def xform_since(self, mark, loc=(0, 0, 0), rot=None, scale=None, pivot=(0, 0, 0)):
        """Rotate/scale the geometry added since `mark` about `pivot`, then move it by loc."""
        self.bm.verts.ensure_lookup_table()
        vs = [self.bm.verts[i] for i in range(mark, len(self.bm.verts))]
        mm = Matrix.Translation(Vector(pivot) + Vector(loc)) @ _mat4((0, 0, 0), rot, scale) @ \
            Matrix.Translation(-Vector(pivot))
        bmesh.ops.transform(self.bm, matrix=mm, verts=vs)

    # -- output
    def finish(self, origin=(0, 0, 0), parent=None, smooth_angle=61.0, mesh_name=None):
        """Make the object. Vertices are stored relative to `origin` (world), which becomes the pivot."""
        bpy.context.view_layer.update()
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        lim = rad(smooth_angle)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                try:
                    e.smooth = e.calc_face_angle() < lim
                except ValueError:
                    e.smooth = False
            else:
                e.smooth = False
        o = Vector(origin)
        bmesh.ops.translate(bm, vec=-o, verts=bm.verts)
        me = bpy.data.meshes.new(mesh_name or (self.name + 'Mesh'))
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        link(ob)
        set_parent(ob, parent, o)
        return ob


# ------------------------------------------------------------------ reusable bits

def caster(p, x, y, r=0.035, m_wheel=None, m_fork=None):
    """A small swivel caster with its wheel touching the floor at (x, y)."""
    m_wheel = m_wheel or M('Rubber')
    m_fork = m_fork or M('Steel')
    p.cyl(r, r * 0.9, (x, y, r), m_wheel, axis='X', verts=10)
    p.bx(x - r * 0.7, x + r * 0.7, y - r * 0.5, y + r * 0.5, r * 1.2, r * 2.2, m_fork)


def star_base(p, r, z, m, legs=5, leg_w=0.05, caster_r=0.03, hub_r=0.06):
    """Five-leg rolling base (office-chair style) with casters."""
    for k in range(legs):
        a = 2 * math.pi * k / legs + math.pi / 2
        x, y = math.cos(a) * r, math.sin(a) * r
        p.tube((0, 0, z + caster_r * 2.4), (x, y, z + caster_r * 2.4), leg_w / 2, m, verts=8)
        caster(p, x, y, caster_r)
    p.cyl(hub_r, 0.06, (0, 0, z + caster_r * 2.4), m, verts=12, bevel=0.01)


# ------------------------------------------------------------------ utilities

def mesh_objects():
    return [o for o in scene().objects if o.type == 'MESH']


def world_bbox(objs=None):
    import numpy as np
    P = world_points(objs)
    mn, mx = P.min(axis=0), P.max(axis=0)
    return Vector(mn.tolist()), Vector(mx.tolist())


def recenter_xy():
    """Move every root object so the footprint center sits at the origin."""
    mn, mx = world_bbox()
    c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 0))
    for o in scene().objects:
        if o.parent is None:
            o.location -= c
    bpy.context.view_layer.update()
    return c


def tri_count(objs=None):
    objs = objs if objs is not None else mesh_objects()
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def export_glb(key):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, key + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_cameras=False, export_lights=False, export_texcoords=False, export_normals=True,
        export_tangents=False, export_materials='EXPORT', export_animations=False, export_skins=False,
        export_morph=False, export_extras=False, use_selection=False,
    )
    return path


# ------------------------------------------------------------------ rendering

def setup_studio(size=256, samples=48, width=None):
    sc = scene()
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = width or size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.eevee.taa_render_samples = samples
        sc.eevee.use_shadows = True
    except Exception:
        pass
    try:
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
    except Exception:
        pass
    world = bpy.data.worlds.get('Studio') or bpy.data.worlds.new('Studio')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.78, 0.84, 0.86, 1.0)
    bg.inputs['Strength'].default_value = 0.75

    def sun(name, direction, strength, angle, shadow=True):
        ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
        ld.energy = strength
        ld.angle = rad(angle)
        try:
            ld.use_shadow = shadow
        except Exception:
            pass
        ob = bpy.data.objects.get(name) or link(bpy.data.objects.new(name, ld))
        ob.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
        return ob
    sun('KeyLight', (-0.9, -1.2, 1.6), 2.6, 25)
    sun('FillLight', (1.4, -0.6, 0.6), 0.9, 40, False)
    sun('RimLight', (0.5, 1.6, 1.0), 1.3, 30, False)


def world_points(objs=None):
    """All world-space vertex positions of the mesh objects as an (N, 3) numpy array."""
    import numpy as np
    objs = objs if objs is not None else mesh_objects()
    bpy.context.view_layer.update()
    chunks = []
    for o in objs:
        n = len(o.data.vertices)
        if not n:
            continue
        co = np.empty(n * 3, dtype=np.float64)
        o.data.vertices.foreach_get('co', co)
        co = co.reshape(n, 3)
        mw = np.array(o.matrix_world)
        chunks.append(co @ mw[:3, :3].T + mw[:3, 3])
    return np.concatenate(chunks) if chunks else np.zeros((1, 3))


def frame_camera(direction=(1.0, -1.25, 0.8), fill=0.8, lens=50.0, objs=None, aspect=1.0, points=None):
    """Perspective camera looking along -direction, framed so the model's silhouette spans `fill`
    of the frame (fit on the actual vertices, not the bounding box) and sits centered."""
    import numpy as np
    sc = scene()
    cd = bpy.data.cameras.get('ThumbCam') or bpy.data.cameras.new('ThumbCam')
    cd.lens = lens
    cd.sensor_fit = 'AUTO'
    cam = bpy.data.objects.get('ThumbCam') or link(bpy.data.objects.new('ThumbCam', cd))
    sc.camera = cam
    P = world_points(objs) if points is None else points
    mn, mx = P.min(axis=0), P.max(axis=0)
    center = (mn + mx) / 2
    diag = float(np.linalg.norm(mx - mn))
    d = Vector(direction).normalized()
    rot = (-d).to_track_quat('-Z', 'Y')
    R = rot.to_matrix()
    right = np.array(R @ Vector((1, 0, 0)))
    upv = np.array(R @ Vector((0, 1, 0)))
    fwd = np.array(-(R @ Vector((0, 0, 1))))
    dn = np.array(d)
    tanh = math.tan(math.atan(18.0 / lens))
    target = center.copy()

    def extents(dist, tgt):
        v = P - (tgt + dn * dist)
        depth = v @ fwd
        if depth.min() < 0.05:
            return -1e9, 1e9, -1e9, 1e9      # part of the model is behind the camera: far too close
        xs = (v @ right) / depth / tanh
        ys = (v @ upv) / depth / tanh
        return xs.min(), xs.max(), ys.min(), ys.max()

    dist = diag * 2
    for _ in range(4):
        lo, hi = 0.01, diag * 20 + 1
        for _ in range(40):
            mid = (lo + hi) / 2
            x0, x1, y0, y1 = extents(mid, target)
            if max((x1 - x0) / aspect, (y1 - y0)) / 2 > fill:
                lo = mid
            else:
                hi = mid
        dist = hi
        x0, x1, y0, y1 = extents(dist, target)
        depth_c = float((target - (target + dn * dist)) @ fwd)
        target = target + right * ((x0 + x1) / 2) * tanh * depth_c + upv * ((y0 + y1) / 2) * tanh * depth_c
    cam.location = Vector(target + dn * dist)
    cam.rotation_euler = rot.to_euler()
    cd.clip_start = 0.02
    cd.clip_end = dist * 4 + 100
    return cam


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene().render.filepath = path
    bpy.ops.render.render(write_still=True)


THUMB_DIR_VEC = (1.0, -1.3, 0.85)   # 3/4 view from the front-right, a little above


def render_thumb(key, size=256, direction=None, min_z=None, fill=0.84):
    """Shop thumbnail. min_z frames the camera on the part above that height (tall thin props), letting a pole
    run off the bottom edge so the recognizable head fills the card."""
    setup_studio(size)
    pts = None
    if min_z is not None:
        P = world_points()
        pts = P[P[:, 2] >= min_z]
    frame_camera(direction=direction or THUMB_DIR_VEC, fill=fill, points=pts)
    path = os.path.join(THUMBS_DIR, key + '.png')
    render_to(path)
    return path


def render_preview(key, size=384, direction=None):
    setup_studio(size, samples=24)
    frame_camera(direction=direction or THUMB_DIR_VEC, fill=0.86)
    path = os.path.join(PREVIEW_DIR, key + '.png')
    render_to(path)
    return path
