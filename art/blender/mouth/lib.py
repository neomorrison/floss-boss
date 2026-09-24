# Floss Boss mouth + tool art: shared Blender helpers (adapted from the Mow Money machine helpers).
#
# Everything here is authored directly in THREE.JS MOUTH SPACE: +Y up, +Z toward the camera, 1 unit ~ 8 mm.
# finish() rotates the geometry +90 degrees about X into Blender space (Z up, front -Y), and the glTF
# exporter (export_yup) rotates it back, so the numbers in the scripts are exactly the numbers the game sees.
#
# Geometry is built with bmesh directly (no operators): fast, deterministic and safe headless.
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
# three.js space -> Blender space
TO_BLENDER = Matrix.Rotation(rad(90), 4, 'X')


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


# ------------------------------------------------------------------ materials

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# name: (sRGB hex, roughness, metalness). Metalness stays low: three.js renders metal nearly black
# without an environment map. Names in the art contract (docs/ARCHITECTURE.md) must not change.
STD = {
    # mouth (contract names)
    'Enamel':      ('#FFFAF0', 0.26, 0.0),
    'Gum':         ('#FF8FAE', 0.5, 0.0),
    'Tongue':      ('#F26F84', 0.62, 0.0),
    'Skin':        ('#F6CDB2', 0.6, 0.0),
    'Lips':        ('#E2586F', 0.38, 0.0),
    'Throat':      ('#8C2F46', 0.85, 0.0),
    'Tartar':      ('#D8B04A', 0.85, 0.0),
    'Popcorn':     ('#FFF3D6', 0.8, 0.0),
    'PopcornHull': ('#C98A2E', 0.5, 0.0),
    'Spinach':     ('#2F7D32', 0.55, 0.0),
    'SpinachVein': ('#7FC46A', 0.55, 0.0),
    'Seed':        ('#F4E3B8', 0.6, 0.0),
    'Candy':       ('#F0263E', 0.14, 0.0),
    # tools
    'Steel':       ('#CBD3DC', 0.3, 0.3),
    'SteelDark':   ('#8D98A5', 0.35, 0.3),
    'Chrome':      ('#EEF2F6', 0.18, 0.3),
    'Gold':        ('#F2C14E', 0.28, 0.3),
    'GoldDark':    ('#C98E2A', 0.35, 0.3),
    'Mint':        ('#3DD6B5', 0.5, 0.0),
    'Teal':        ('#0E8F8A', 0.45, 0.0),
    'Bubblegum':   ('#FF7AA8', 0.55, 0.0),
    'Sunshine':    ('#FFD166', 0.5, 0.0),
    'Ink':         ('#16323A', 0.55, 0.0),
    'Blue':        ('#3A86E8', 0.42, 0.0),
    'BlueDark':    ('#1F5FB8', 0.45, 0.0),
    'White':       ('#F7F8F6', 0.4, 0.0),
    'Grey':        ('#9AA3AD', 0.45, 0.1),
    'GreyDark':    ('#59626C', 0.5, 0.1),
    'Rubber':      ('#FF8CB0', 0.75, 0.0),
    'Cord':        ('#EDEFF1', 0.6, 0.0),
    'Floss':       ('#F4FBFF', 0.5, 0.0),
    'ClearTube':   ('#CFE9FF', 0.12, 0.0),
    'Glass':       ('#BFE6FF', 0.08, 0.0),
    'Lens':        ('#9ED8F0', 0.05, 0.0),
    'Light':       ('#FFF6C8', 0.3, 0.0),
    'Magenta':     ('#E0218A', 0.3, 0.0),
    'Label':       ('#FFFDF7', 0.6, 0.0),
    'Cushion':     ('#2B3A44', 0.8, 0.0),
    'Powder':      ('#F5F7FA', 0.9, 0.0),
    'Water':       ('#7FD3F7', 0.1, 0.0),
}
EMISSIVE = {'Light': 1.5, 'Enamel': 0.07}
ALPHA = {'ClearTube': 0.5, 'Glass': 0.42}


def material(name, color=None, rough=None, metal=None, emit=None, alpha=None, double=False):
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
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
    m.diffuse_color = (*lin, alpha)
    m.roughness = rough
    m.metallic = metal
    m.use_backface_culling = not double
    return m


def M(name, color=None):
    return material(name, color)


def use_vertex_colors(m, strength=1.0):
    """Multiply the base color by the mesh's color attribute (exported as COLOR_0; three.js multiplies too)."""
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if any(n.type == 'VERTEX_COLOR' for n in nt.nodes):
        return m
    base = tuple(bsdf.inputs['Base Color'].default_value)
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = strength
    mix.inputs[6].default_value = base
    nt.links.new(attr.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    return m


# ------------------------------------------------------------------ geometry

def _mat4(loc=(0, 0, 0), rot=None, scale=None):
    mm = Matrix.Translation(Vector(loc))
    if rot is not None:
        mm = mm @ Euler(tuple(rad(a) for a in rot), 'XYZ').to_matrix().to_4x4()
    if scale is not None:
        mm = mm @ Matrix.Diagonal((*scale, 1.0))
    return mm


AXIS_ROT = {'Z': None, 'X': (0, 90, 0), 'Y': (-90, 0, 0)}


class Part:
    """Accumulates primitives (three.js space) into one mesh. finish() makes the object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

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

    def add_mesh(self, verts, faces, m, flat=False, matrix=None):
        """Raw vertices + polygon index lists."""
        tmp = bmesh.new()
        vs = [tmp.verts.new(Vector(v)) for v in verts]
        for f in faces:
            try:
                tmp.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        self._emit(tmp, m, flat, matrix)

    @staticmethod
    def _bevel_all(tmp, amount, seg):
        if amount > 0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges) + list(tmp.verts), offset=amount, offset_type='OFFSET',
                            segments=seg, profile=0.5, affect='EDGES', clamp_overlap=True)

    def box(self, size, loc, m, bevel=0.0, seg=1, rot=None, flat=None):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co.x *= size[0]
            v.co.y *= size[1]
            v.co.z *= size[2]
        self._bevel_all(tmp, bevel, seg)
        self._emit(tmp, m, flat if flat is not None else seg <= 1, _mat4(loc, rot))

    def cyl(self, r, depth, loc, m, axis='Y', verts=16, r2=None, bevel=0.0, seg=1, rot=None, flat=False,
            caps=True, scale=None, spin=0.0):
        """Cylinder or cone (r at -axis end, r2 at +axis end) centered at loc."""
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
        if spin:
            mm = mm @ Matrix.Rotation(rad(spin), 4, 'Z')
        if scale:
            mm = mm @ Matrix.Diagonal((*scale, 1.0))
        self._emit(tmp, m, flat, mm)

    def tube(self, p1, p2, r, m, verts=10, r2=None, flat=False, caps=True):
        p1, p2 = Vector(p1), Vector(p2)
        d = p2 - p1
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=caps, cap_tris=False, segments=verts, radius1=r,
                              radius2=r if r2 is None else r2, depth=d.length)
        mm = Matrix.Translation((p1 + p2) / 2) @ q.to_matrix().to_4x4()
        self._emit(tmp, m, flat, mm)

    def sphere(self, r, loc, m, seg=12, rings=8, scale=None, rot=None, flat=False):
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=rings, radius=r)
        self._emit(tmp, m, flat, _mat4(loc, rot, scale))

    def sweep(self, pts, r, m, verts=10, closed=False, caps=True, flat=False, radii=None, rscale=None, up=None,
              cap_round=0):
        """Tube along a polyline with parallel-transported frames. radii: per-point radius list.
        rscale=(sx, sy) makes an oval section. cap_round>0 adds rounded end caps (that many rings)."""
        P = [Vector(p) for p in pts]
        n = len(P)
        R = radii if radii is not None else [r] * n
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
        upv = Vector(up) if up else (Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0)))
        N = (upv - T[0] * upv.dot(T[0])).normalized()
        tmp = bmesh.new()
        rings = []
        frames = []
        for i in range(n):
            if i > 0:
                q = T[i - 1].rotation_difference(T[i])
                N = q @ N
                N = (N - T[i] * N.dot(T[i])).normalized()
            B = T[i].cross(N)
            frames.append((N.copy(), B.copy()))
            ring = []
            sx, sy = rscale if rscale else (1.0, 1.0)
            for k in range(verts):
                a = 2 * math.pi * k / verts
                o = (N * math.cos(a) * sx + B * math.sin(a) * sy) * R[i]
                ring.append(tmp.verts.new(P[i] + o))
            rings.append(ring)
        segs = n if closed else n - 1
        for i in range(segs):
            a, b = rings[i], rings[(i + 1) % n]
            for k in range(verts):
                k2 = (k + 1) % verts
                tmp.faces.new([a[k], a[k2], b[k2], b[k]])
        if caps and not closed:
            for end in (0, 1):
                idx = 0 if end == 0 else n - 1
                ring = rings[idx]
                if cap_round > 0:
                    Nn, Bn = frames[idx]
                    t = -T[idx] if end == 0 else T[idx]
                    prev = ring
                    sx, sy = rscale if rscale else (1.0, 1.0)
                    for j in range(1, cap_round + 1):
                        ang = (math.pi / 2) * j / (cap_round + 1)
                        rr = R[idx] * math.cos(ang)
                        off = t * R[idx] * math.sin(ang) * min(sx, sy)
                        cur = []
                        for k in range(verts):
                            a = 2 * math.pi * k / verts
                            o = (Nn * math.cos(a) * sx + Bn * math.sin(a) * sy) * rr
                            cur.append(tmp.verts.new(P[idx] + off + o))
                        for k in range(verts):
                            k2 = (k + 1) % verts
                            tmp.faces.new([prev[k], prev[k2], cur[k2], cur[k]])
                        prev = cur
                    tip = tmp.verts.new(P[idx] + t * R[idx] * min(sx, sy))
                    for k in range(verts):
                        k2 = (k + 1) % verts
                        tmp.faces.new([prev[k], prev[k2], tip])
                else:
                    tmp.faces.new(list(reversed(ring)) if end == 0 else ring)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self._emit(tmp, m, flat)

    def lathe(self, profile, m, verts=24, loc=(0, 0, 0), rot=None, flat=False, axis='Y', close_ends=True):
        """Surface of revolution around +Y (or axis). profile: [(radius, height), ...] bottom to top.
        A radius of 0 at an end closes it with a pole."""
        tmp = bmesh.new()
        rings = []
        for (r, h) in profile:
            if r <= 1e-6:
                rings.append([tmp.verts.new((0, h, 0))])
            else:
                rings.append([tmp.verts.new((r * math.sin(2 * math.pi * k / verts), h,
                                             r * math.cos(2 * math.pi * k / verts))) for k in range(verts)])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            if len(a) == 1 and len(b) == 1:
                continue
            for k in range(verts):
                k2 = (k + 1) % verts
                if len(a) == 1:
                    tmp.faces.new([a[0], b[k], b[k2]])
                elif len(b) == 1:
                    tmp.faces.new([a[k], b[0], a[k2]])
                else:
                    tmp.faces.new([a[k], b[k], b[k2], a[k2]])
        if close_ends:
            if len(rings[0]) > 1:
                tmp.faces.new(list(reversed(rings[0])))
            if len(rings[-1]) > 1:
                tmp.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        mm = _mat4(loc, rot)
        if axis == 'Z':
            mm = mm @ Matrix.Rotation(rad(90), 4, 'X')
        elif axis == 'X':
            mm = mm @ Matrix.Rotation(rad(-90), 4, 'Z')
        self._emit(tmp, m, flat, mm)

    def prism(self, pts, width, m, axis='Z', center=0.0, bevel=0.0, seg=1, flat=True, loc=(0, 0, 0), rot=None):
        """Extrude a 2D polygon. axis Z: pts are (x, y). axis X: (z, y) hmm (y, z). axis Y: (x, z)."""
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

    def transform(self, loc=(0, 0, 0), rot=None, scale=None, matrix=None):
        """Transform everything added so far."""
        mm = matrix if matrix is not None else _mat4(loc, rot, scale)
        bmesh.ops.transform(self.bm, matrix=mm, verts=self.bm.verts)

    def finish(self, smooth_angle=None, all_smooth=False, uv_fn=None, color_fn=None, recalc=True, weld=0.0,
               tri=None):
        """Make the object. Geometry stays in three.js space numbers; the object is rotated into
        Blender space so the Y-up glTF export restores them exactly.
        smooth_angle: sharp edges above this angle (degrees) get split normals (per-face `smooth` wins).
        uv_fn(face, loop) -> (u, v) writes a UV map; color_fn(co) -> (r, g, b) writes vertex colors."""
        bm = self.bm
        if weld > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=weld)
            bmesh.ops.dissolve_degenerate(bm, dist=weld, edges=bm.edges[:])
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if tri:  # triangulate ourselves ('FIXED' keeps every quad split the same way: no switch lines)
            bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method=tri, ngon_method='BEAUTY')
        if all_smooth:
            for f in bm.faces:
                f.smooth = True
        if smooth_angle is not None:
            lim = rad(smooth_angle)
            for e in bm.edges:
                if len(e.link_faces) == 2:
                    try:
                        e.smooth = e.calc_face_angle() < lim
                    except ValueError:
                        e.smooth = False
                else:
                    e.smooth = False
        if uv_fn is not None:
            uvl = bm.loops.layers.uv.new('UVMap')
            for f in bm.faces:
                for lp in f.loops:
                    lp[uvl].uv = uv_fn(f, lp)
        if color_fn is not None:
            cl = bm.verts.layers.float_color.new('Color')
            for v in bm.verts:
                c = color_fn(v.co)
                v[cl] = (c[0], c[1], c[2], 1.0)
        bmesh.ops.transform(bm, matrix=TO_BLENDER, verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        if color_fn is not None:
            try:
                me.color_attributes.active_color = me.color_attributes['Color']
                me.color_attributes.render_color_index = 0
            except Exception:
                pass
        ob = bpy.data.objects.new(self.name, me)
        link(ob)
        return ob


# ------------------------------------------------------------------ utilities

def color_lookup(verts, colors, default=(1.0, 1.0, 1.0)):
    """A color_fn for Part.finish from parallel lists of vertex positions and colors (nearest match, so
    float32 rounding inside Blender cannot miss a vertex)."""
    from mathutils import kdtree
    kd = kdtree.KDTree(len(verts))
    for i, p in enumerate(verts):
        kd.insert(Vector(p), i)
    kd.balance()

    def fn(co):
        _, i, d = kd.find(co)
        return colors[i] if i is not None and d < 1e-3 else default
    return fn


def mesh_objects():
    return [o for o in scene().objects if o.type == 'MESH']


def three_points(objs=None):
    """All vertex positions in three.js space as an (N, 3) numpy array."""
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
        w = co @ mw[:3, :3].T + mw[:3, 3]
        chunks.append(np.stack([w[:, 0], w[:, 2], -w[:, 1]], axis=1))
    return np.concatenate(chunks) if chunks else np.zeros((1, 3))


def tri_count(objs=None):
    objs = objs if objs is not None else mesh_objects()
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def export_glb(key, texcoords=False, colors=False, morph=False):
    """morph: export shape keys as glTF morph targets (positions only: the rest normals are kept, which also
    keeps custom normals intact). Modifiers are not applied then, since the exporter drops shape keys otherwise."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, key + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=not morph,
        export_cameras=False, export_lights=False, export_texcoords=texcoords, export_normals=True,
        export_tangents=False, export_materials='EXPORT', export_animations=False, export_skins=False,
        export_morph=morph, export_morph_normal=False, export_morph_tangent=False, export_extras=False,
        use_selection=False,
        export_vertex_color='ACTIVE' if colors else 'NONE',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=colors,
    )
    return path


# ------------------------------------------------------------------ rendering

def setup_studio(size=256, samples=48, world=0.55):
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
    w = bpy.data.worlds.get('Studio') or bpy.data.worlds.new('Studio')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.72, 0.76, 0.82, 1.0)
    bg.inputs['Strength'].default_value = world

    def sun(name, direction, strength, angle, shadow=True):
        ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
        ld.energy = strength
        ld.angle = rad(angle)
        try:
            ld.use_shadow = shadow
        except Exception:
            pass
        ob = bpy.data.objects.get(name) or link(bpy.data.objects.new(name, ld))
        # direction given in three.js space (where the light comes FROM); convert to Blender
        d = TO_BLENDER.to_3x3() @ Vector(direction)
        ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        return ob
    sun('KeyLight', (-0.7, 1.4, 1.0), 2.1, 14)
    sun('FillLight', (1.4, 0.4, 0.9), 0.7, 30, False)
    sun('RimLight', (0.3, 1.0, -1.5), 1.4, 20, False)


def frame_camera(direction=(1.0, 0.7, 1.25), fill=0.84, lens=60.0, objs=None, aspect=1.0, up=(0, 1, 0)):
    """Perspective camera looking along -direction (three.js space), framed so the silhouette spans `fill`
    of the frame (fit on the actual vertices) and sits centered."""
    import numpy as np
    sc = scene()
    cd = bpy.data.cameras.get('ThumbCam') or bpy.data.cameras.new('ThumbCam')
    cd.lens = lens
    cd.sensor_fit = 'AUTO'
    cam = bpy.data.objects.get('ThumbCam') or link(bpy.data.objects.new('ThumbCam', cd))
    sc.camera = cam
    T3 = TO_BLENDER.to_3x3()
    P3 = three_points(objs)
    P = np.stack([P3[:, 0], -P3[:, 2], P3[:, 1]], axis=1)  # to Blender space
    mn, mx = P.min(axis=0), P.max(axis=0)
    center = (mn + mx) / 2
    diag = float(np.linalg.norm(mx - mn))
    d = (T3 @ Vector(direction)).normalized()
    upb = T3 @ Vector(up)
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
