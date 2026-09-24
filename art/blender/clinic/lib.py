# Mow Money machine art: shared Blender helpers.
#
# Geometry is built with bmesh directly (no operators), which keeps the scripts fast, deterministic
# and safe to run headless. A Part accumulates primitives (each with a material) into one bmesh and
# becomes one mesh object on finish(). Conventions (Blender space): Z up, the model's front faces -Y,
# 1 unit = 1 meter, origin on the ground at the footprint center. The glTF exporter turns this into
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

rad = math.radians


# ------------------------------------------------------------------ scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)


def scene():
    return bpy.context.scene


def link(ob):
    scene().collection.objects.link(ob)
    return ob


def empty(name, loc=(0, 0, 0), parent=None, size=0.1):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = size
    ob.location = Vector(loc)
    link(ob)
    bpy.context.view_layer.update()
    if parent is not None:
        ob.parent = parent
        ob.location = Vector(loc) - parent.matrix_world.translation
    return ob


# ------------------------------------------------------------------ materials

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# Standard palette. Metalness stays low on purpose: three.js renders metallic surfaces almost black
# without an environment map, so these read well with or without one.
STD = {
    'Tire':      ('#2B2A2F', 0.92, 0.0),
    'Rim':       ('#D5D8DD', 0.45, 0.25),
    'Hub':       ('#8C929A', 0.45, 0.25),
    'Metal':     ('#565C64', 0.55, 0.3),
    'Steel':     ('#A3AAB2', 0.4, 0.35),
    'Chrome':    ('#E6E9EE', 0.22, 0.35),
    'Seat':      ('#2A2A2F', 0.6, 0.0),
    'Engine':    ('#3C4046', 0.55, 0.25),
    'Deck':      ('#474C54', 0.55, 0.3),
    'Plastic':   ('#2F3237', 0.6, 0.0),
    'Grip':      ('#1E1E22', 0.85, 0.0),
    'Grass Bag': ('#5F6E48', 0.95, 0.0),
    'Glass':     ('#8EC4E2', 0.12, 0.1),
    'Light':     ('#FFF3C2', 0.3, 0.0),
    'TailLight': ('#E0332B', 0.3, 0.0),
    'Marker':    ('#FF9A2E', 0.3, 0.0),
    'Accent':    ('#F4C331', 0.45, 0.0),
    'Wood':      ('#B98052', 0.8, 0.0),
    'Bed':       ('#35383E', 0.8, 0.0),
    'Box':       ('#F3F1EA', 0.6, 0.0),
    'Trim':      ('#C9CDD2', 0.5, 0.1),
    'Stone':     ('#9D958A', 0.9, 0.0),
    'Blade':     ('#D9DDE2', 0.3, 0.35),
    'Line':      ('#FF8A1F', 0.5, 0.0),
    'Bristle':   ('#E1B862', 0.9, 0.0),
    'Canvas':    ('#6F7C55', 0.95, 0.0),
    'Skin':      ('#E6B08A', 0.7, 0.0),
    'Hair':      ('#5A3A22', 0.85, 0.0),
    'Eye':       ('#1D1E24', 0.4, 0.0),
    'Shorts':    ('#C8B083', 0.85, 0.0),
    'Boots':     ('#7A5230', 0.8, 0.0),
    'Sole':      ('#2E2A27', 0.9, 0.0),
    'Leather':   ('#4A3222', 0.7, 0.0),
    'Gloves':    ('#C99A5B', 0.85, 0.0),
    'Sock':      ('#EFEDE6', 0.9, 0.0),
    'Shirt':     ('#4E7FCB', 0.85, 0.0),
    'Pants':     ('#3E587F', 0.85, 0.0),
    'Sneaker':   ('#F1F1EE', 0.7, 0.0),
    'White':     ('#F4F4F1', 0.6, 0.0),
}
EMISSIVE = {'Light': 1.2, 'TailLight': 0.6, 'Marker': 0.6}


def material(name, color=None, rough=None, metal=None, emit=None):
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
    m.diffuse_color = (*lin, 1.0)
    m.roughness = rough
    m.metallic = metal
    # every mesh is a closed shell with outward normals, so export single-sided (cheaper in three.js)
    m.use_backface_culling = True
    return m


def M(name, color=None):
    return material(name, color)


def body(color):
    """The tintable company-color material. The game recolors every material named exactly Body."""
    return material('Body', color, 0.5, 0.0)


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
        if axis == 'X':  # put a vertex at the bottom so wheels touch the ground exactly
            mm = mm @ Matrix.Rotation(rad(-90), 4, 'Z')
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

    def sphere(self, r, loc, m, seg=12, rings=8, scale=None, rot=None, flat=False, ico=None):
        tmp = bmesh.new()
        if ico is not None:
            bmesh.ops.create_icosphere(tmp, subdivisions=ico, radius=r)
        else:
            bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=rings, radius=r)
        self._emit(tmp, m, flat, _mat4(loc, rot, scale))

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

    def reel(self, length, r, loc, m_blade, m_core, blades=5, twist=70.0, segs=8, thick=0.022, depth=0.035,
             spider_verts=12, core=True):
        """Spiral reel cylinder along X centered at loc: helical blades, a shaft and end spiders."""
        cx, cy, cz = loc
        tmp = bmesh.new()
        for b in range(blades):
            a0 = 2 * math.pi * b / blades
            sections = []
            for i in range(segs + 1):
                x = -length / 2 + length * i / segs
                th = a0 + rad(twist) * i / segs
                d = thick / (2 * r)
                sec = []
                for (rr, dd) in ((r - depth, -d), (r, -d), (r, d), (r - depth, d)):
                    sec.append(tmp.verts.new((x, math.cos(th + dd) * rr, math.sin(th + dd) * rr)))
                sections.append(sec)
            for i in range(segs):
                s0, s1 = sections[i], sections[i + 1]
                for k in range(4):
                    k2 = (k + 1) % 4
                    tmp.faces.new([s0[k], s0[k2], s1[k2], s1[k]])
            tmp.faces.new(list(reversed(sections[0])))
            tmp.faces.new(sections[-1])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self._emit(tmp, m_blade, True, Matrix.Translation((cx, cy, cz)))
        if core:
            self.cyl(r * 0.18, length, loc, m_core, axis='X', verts=8)
        for s in (-1, 1):
            self.cyl(r * 0.92, 0.02, (cx + s * (length / 2 - 0.01), cy, cz), m_core, axis='X', verts=spider_verts)

    def transform(self, loc=(0, 0, 0), rot=None, scale=None):
        """Transform everything added so far (used to pose a whole tool)."""
        bmesh.ops.transform(self.bm, matrix=_mat4(loc, rot, scale), verts=self.bm.verts)

    # -- output
    def finish(self, origin=(0, 0, 0), parent=None, smooth_angle=38.0):
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
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        link(ob)
        ob.location = o
        if parent is not None:
            ob.parent = parent
            ob.location = o - parent.matrix_world.translation
        return ob


def wheel(name, r, w, loc, rim_m=None, tire_m=None, verts=18, rim_frac=0.62, hub_m=None, style='turf', side=0):
    """A wheel object spinning around X with its origin at the axle."""
    tire_m = tire_m or M('Tire')
    rim_m = rim_m or M('Rim')
    hub_m = hub_m or M('Hub')
    p = Part(name)
    x, y, z = loc
    p.cyl(r, w, loc, tire_m, axis='X', verts=verts, bevel=min(w * 0.32, r * 0.25), seg=2)
    if style == 'thin':  # bicycle
        p.cyl(r * 0.86, w * 1.1, loc, rim_m, axis='X', verts=verts)
        p.cyl(r * 0.8, w * 1.15, loc, M('Metal'), axis='X', verts=verts, caps=True)
        for k in range(3):
            p.box((w * 0.6, r * 1.6, 0.012), loc, rim_m, rot=(k * 60, 0, 0))
        p.cyl(r * 0.1, w * 1.8, loc, hub_m, axis='X', verts=8)
    else:
        p.cyl(r * rim_frac, w + 0.012, loc, rim_m, axis='X', verts=verts)
        p.cyl(r * rim_frac * 0.42, w + 0.04, loc, hub_m, axis='X', verts=8)
        if style == 'car':
            sides = (side,) if side else (-1, 1)
            for k in range(5):
                a = 2 * math.pi * k / 5
                for s in sides:
                    p.cyl(r * 0.05, 0.03, (x + s * (w / 2 + 0.012), y + math.cos(a) * r * rim_frac * 0.62,
                                           z + math.sin(a) * r * rim_frac * 0.62), hub_m, axis='X', verts=6)
    return p.finish(origin=loc)


def caster_fork(p, x, y, z_axle, z_top, r, m_fork, m_pivot, w=0.12):
    """Swivel fork (added to Part p) holding a caster wheel at (x, y, z_axle)."""
    off = 0.06
    for s in (-1, 1):
        p.bx(x + s * (w / 2 + 0.03) - 0.015, x + s * (w / 2 + 0.03) + 0.015, y - 0.035, y + 0.035 + off, z_axle - 0.02,
             z_top - 0.05, m_fork)
    p.bx(x - w / 2 - 0.05, x + w / 2 + 0.05, y - 0.04, y + 0.05 + off, z_top - 0.07, z_top - 0.02, m_fork)
    p.cyl(0.045, 0.14, (x, y + off, z_top + 0.03), m_pivot, verts=10)
    p.cyl(r * 0.3, w + 0.08, (x, y, z_axle), m_pivot, axis='X', verts=8)


# ------------------------------------------------------------------ utilities

def mesh_objects():
    return [o for o in scene().objects if o.type == 'MESH']


def world_bbox(objs=None):
    objs = objs if objs is not None else mesh_objects()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    bpy.context.view_layer.update()
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
    return mn, mx


def recenter_xy():
    """Move every root object so the footprint center sits at the origin (vehicles and add-ons)."""
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

def setup_studio(size=256, samples=48):
    sc = scene()
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = size
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
    bg.inputs['Color'].default_value = (0.62, 0.66, 0.72, 1.0)
    bg.inputs['Strength'].default_value = 0.85

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
    sun('KeyLight', (-0.8, -1.0, 1.5), 3.2, 12)
    sun('FillLight', (1.3, -0.4, 0.5), 1.1, 30, False)
    sun('RimLight', (0.4, 1.6, 1.0), 1.6, 20, False)


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


def frame_camera(direction=(1.0, -1.25, 0.8), fill=0.8, lens=50.0, objs=None, aspect=1.0):
    """Perspective camera looking along -direction, framed so the model's silhouette spans `fill`
    of the frame (fit on the actual vertices, not the bounding box) and sits centered."""
    import numpy as np
    sc = scene()
    cd = bpy.data.cameras.get('ThumbCam') or bpy.data.cameras.new('ThumbCam')
    cd.lens = lens
    cd.sensor_fit = 'AUTO'
    cam = bpy.data.objects.get('ThumbCam') or link(bpy.data.objects.new('ThumbCam', cd))
    sc.camera = cam
    P = world_points(objs)
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
        xs = (v @ right) / depth / tanh
        ys = (v @ upv) / depth / tanh
        return xs.min(), xs.max(), ys.min(), ys.max()

    dist = diag * 2
    for _ in range(4):
        lo, hi = 0.01, diag * 20 + 1
        for _ in range(40):
            mid = (lo + hi) / 2
            x0, x1, y0, y1 = extents(mid, target)
            if max(x1 - x0, (y1 - y0) * aspect) / 2 > fill:
                lo = mid
            else:
                hi = mid
        dist = hi
        x0, x1, y0, y1 = extents(dist, target)
        depth_c = float((target - (target + dn * dist)) @ fwd)
        target = target + right * ((x0 + x1) / 2) * tanh * depth_c + upv * ((y0 + y1) / 2) * tanh * depth_c
    cam.location = Vector(target + dn * dist)
    cam.rotation_euler = rot.to_euler()
    cd.clip_start = 0.05
    cd.clip_end = dist * 4 + 100
    return cam


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene().render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_thumb(key, size=256, direction=None):
    setup_studio(size)
    frame_camera(direction=direction or (1.0, -1.25, 0.8))
    path = os.path.join(THUMBS_DIR, key + '.png')
    render_to(path)
    return path
