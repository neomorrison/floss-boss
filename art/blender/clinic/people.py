# People: char_adult, char_kid, char_senior, char_staff, char_dentist.
#
# Rig (object hierarchy, no skinning), every node with identity rotation and scale:
#   <key>            root empty on the floor between the feet
#     Body           pivot at the hips (torso, pelvis, neck)
#       Head         pivot at the neck
#       ArmL, ArmR   pivots at the shoulders
#     LegL, LegR     pivots at the hip joints
# L and R are the character's own left and right: facing -Y in Blender (+Z in three.js) the left side is +X.
# Tintable materials: Skin, Hair, Shirt, Pants, Shoes, Scrubs, Coat (the game recolors them per person).
import math
import bmesh
from mathutils import Vector
from lib import Part, M, material, empty, rad


class Face:
    """The head ellipsoid, for sticking features onto its front surface."""

    def __init__(self, c, rx, ry, rz):
        self.c, self.rx, self.ry, self.rz = Vector(c), rx, ry, rz

    def y(self, x, z, out=0.0):
        """Front surface y (toward -Y) at (x, z), pushed out by `out`."""
        u = (x - self.c.x) / self.rx
        w = (z - self.c.z) / self.rz
        k = max(0.0, 1.0 - u * u - w * w)
        return self.c.y - self.ry * math.sqrt(k) - out

    def side_x(self, s, y, z, out=0.0):
        v = (y - self.c.y) / self.ry
        w = (z - self.c.z) / self.rz
        k = max(0.0, 1.0 - v * v - w * w)
        return self.c.x + s * (self.rx * math.sqrt(k) + out)


def decal(p, face, pts, m, out=0.004, depth=0.025):
    """A thin plate on the face: front verts follow the ellipsoid (pushed out by `out`), back verts sink in."""
    tmp = bmesh.new()
    a = [tmp.verts.new((x, face.y(x, z, out), z)) for (x, z) in pts]
    b = [tmp.verts.new((x, face.y(x, z, out) + depth, z)) for (x, z) in pts]
    tmp.faces.new(a)
    tmp.faces.new(list(reversed(b)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        tmp.faces.new([a[i], a[j], b[j], b[i]])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    p._emit(tmp, m, True)


def head(p, face, spec):
    """Head sphere, ears, nose, eyes, cheeks and the big toothy grin."""
    skin = M('Skin')
    c = face.c
    p.sphere(1.0, tuple(c), skin, seg=16, rings=12, scale=(face.rx, face.ry, face.rz))
    # ears
    for s in (-1, 1):
        p.sphere(0.052, (face.side_x(s, c.y + 0.01, c.z - 0.01, -0.012), c.y + 0.01, c.z - 0.01), skin, seg=8,
                 rings=5, scale=(0.55, 0.8, 1.0))
    # nose
    nz = c.z - face.rz * 0.12
    p.sphere(0.028, (0, face.y(0, nz, -0.012), nz), skin, seg=8, rings=5, scale=(1.1, 0.9, 0.9))
    # eyes with a shine
    ex, ez = face.rx * 0.36, c.z + face.rz * 0.04
    er = spec.get('eye_r', 0.03)
    for s in (-1, 1):
        x = s * ex
        y = face.y(x, ez, -0.012)
        p.sphere(er, (x, y, ez), M('Eye'), seg=10, rings=6, scale=(0.85, 0.55, 1.25))
        p.sphere(er * 0.32, (x + er * 0.3, y - er * 0.45, ez + er * 0.45), M('EyeShine'), seg=6, rings=4)
    # cheeks
    cz = c.z - face.rz * 0.2
    for s in (-1, 1):
        x = s * face.rx * 0.56
        p.sphere(0.036, (x, face.y(x, cz, -0.006), cz), M('Cheek'), seg=8, rings=5, scale=(1.2, 0.35, 0.8))
    # grin with a row of teeth
    mz = c.z - face.rz * 0.3
    w, h = face.rx * 0.46, face.rz * 0.2
    pts = []
    n = 8
    for i in range(n + 1):
        a = math.pi + math.pi * i / n            # bottom half-ellipse, left to right
        pts.append((w / 2 * math.cos(a), mz + h * math.sin(a)))
    for i in range(1, n):
        t = 1 - 2 * i / n                        # top edge back, right to left, curving up at the corners
        pts.append((w / 2 * t, mz + h * 0.18 * t * t))
    decal(p, face, pts, M('Mouth'), out=0.003)
    # teeth: a white band hugging the top edge of the grin
    top, bot = [], []
    n = 6
    for i in range(n + 1):
        t = -0.78 + 1.56 * i / n
        zt = mz + h * 0.18 * t * t - 0.004
        top.append((w / 2 * t, zt))
        bot.append((w / 2 * t, zt - h * 0.34))
    decal(p, face, bot + list(reversed(top)), M('Enamel'), out=0.0055, depth=0.02)


def hair_cap(p, face, spec, m):
    """Short hair: a sliced sphere over the top and back, plus a fringe swoop."""
    c = face.c
    r = max(face.rx, face.rz) * 1.06
    tilt = spec.get('hair_tilt', (0, -0.62, -0.78))
    p.sphere_cut(1.0, (c.x, c.y + 0.012, c.z + 0.02), m, tilt, spec.get('hair_cut', -0.08), seg=16, rings=10,
                 scale=(face.rx * 1.07, face.ry * 1.08, face.rz * 1.07))
    # fringe swoop across the forehead
    fz = c.z + face.rz * 0.62
    p.sphere(1.0, (face.rx * 0.2, face.y(face.rx * 0.2, fz, -0.02) + 0.03, fz), m, seg=10, rings=6,
             scale=(face.rx * 0.62, face.ry * 0.3, face.rz * 0.26), rot=(0, -14, 0))


def torso(p, z0, z1, rx, ry, m, bulge=1.0):
    """Rounded bean torso from z0 (bottom) to z1 (shoulder top), elliptical section rx x ry."""
    h = z1 - z0
    prof = [(0.0, z0), (rx * 0.82, z0 + 0.0), (rx * 0.98, z0 + h * 0.18), (rx * bulge, z0 + h * 0.45),
            (rx * 0.97, z0 + h * 0.72), (rx * 0.84, z0 + h * 0.9), (rx * 0.55, z1), (0.0, z1 + 0.005)]
    p.lathe(prof, (0, 0, 0), m, segs=14, scale=(1.0, ry / rx, 1.0))


def arm(name, parent, sx, sz, length, r, sleeve_m, sleeve_len, skin, hand_r=None, spread=9.0, sleeve_r=None,
        extra=None):
    """Arm hanging from the shoulder (sx, 0, sz), splayed out by `spread` degrees."""
    s = 1 if sx > 0 else -1
    a = rad(spread)
    end = Vector((sx + s * math.sin(a) * length, 0.0, sz - math.cos(a) * length))
    sh = Vector((sx, 0.0, sz))
    p = Part(name)
    sr = sleeve_r or r * 1.22
    if sleeve_len >= 0.99:
        p.capsule(sh, sh + (end - sh) * 0.96, sr, sleeve_m, verts=8, rings=2, r2=sr * 0.92)
        cuff = sh + (end - sh) * 0.9
        p.capsule(cuff, end, r * 0.9, skin, verts=8, rings=2)
    else:
        p.capsule(sh, end, r, skin, verts=8, rings=2, r2=r * 0.9)
        p.capsule(sh, sh + (end - sh) * sleeve_len, sr, sleeve_m, verts=8, rings=2, r2=sr * 0.95)
    hr = hand_r or r * 1.12
    p.sphere(hr, tuple(end + Vector((0, -0.005, -hr * 0.5))), skin, seg=10, rings=6, scale=(0.9, 1.0, 1.1))
    if extra:
        extra(p, end)
    return p.finish(origin=tuple(sh), parent=parent)


def leg(name, parent, hx, hz, r, pants, shoes, skin=None, short=0.0, sole=None, shoe_len=0.15):
    """Leg from the hip joint (hx, 0, hz) to a rounded shoe on the floor. short > 0 = shorts (skin below)."""
    p = Part(name)
    ankle = Vector((hx, 0.0, 0.1))
    hip = Vector((hx, 0.0, hz))
    if short > 0:
        knee = hip + (ankle - hip) * short
        p.capsule(hip + Vector((0, 0, 0.02)), knee, r * 1.12, pants, verts=10, rings=2)
        p.capsule(knee, ankle, r * 0.72, skin, verts=8, rings=2)
    else:
        p.capsule(hip + Vector((0, 0, 0.02)), ankle, r, pants, verts=10, rings=2, r2=r * 0.92)
    # shoe: rounded toe box, toe toward -Y
    sh = 0.062 if shoe_len > 0.12 else 0.052
    p.sphere(1.0, (hx, -0.035, sh), shoes, seg=12, rings=6, scale=(r * 1.12, shoe_len, sh))
    if sole:
        p.cyl(1.0, 0.024, (hx, -0.035, 0.012), sole, verts=12, scale=(r * 1.14, shoe_len * 1.01, 1.0))
    return p.finish(origin=tuple(hip), parent=parent)


# ------------------------------------------------------------------ characters

def build_person(key, spec):
    root = empty(key, (0, 0, 0))
    hip_z, neck_z = spec['hip_z'], spec['neck_z']
    hr = spec['head_r']
    face = Face((0, 0, neck_z + hr * 0.92), hr, hr * 0.94, hr * 0.97)

    skin = M('Skin')
    # --- Body
    body = Part('Body')
    top_m = M(spec['top'])
    bottom_m = M(spec['bottom'])
    tz0 = hip_z + spec.get('top_z0', 0.02)
    torso(body, tz0, neck_z - 0.01, spec['torso_rx'], spec['torso_ry'], top_m, bulge=spec.get('bulge', 1.0))
    # pelvis / waistband
    prx = spec['torso_rx'] * 0.95
    body.lathe([(0.0, hip_z - 0.1), (prx * 0.8, hip_z - 0.09), (prx, hip_z - 0.02), (prx * 1.0, tz0 + 0.06),
                (0.0, tz0 + 0.06)], (0, 0, 0), bottom_m, segs=16, scale=(1.0, spec['torso_ry'] / spec['torso_rx'], 1.0))
    body.cyl(hr * 0.34, 0.08, (0, 0, neck_z + 0.01), skin, verts=10)
    if spec.get('body_extra'):
        spec['body_extra'](body, spec)
    body_ob = body.finish(origin=(0, 0, hip_z), parent=root)

    # --- Head
    hd = Part('Head')
    head(hd, face, spec)
    spec['hair'](hd, face, spec)
    hd.finish(origin=(0, 0, neck_z), parent=body_ob)

    # --- Arms (on the Body so a lean or bob carries them)
    sx = spec['torso_rx'] * spec.get('shoulder_k', 1.02)
    sz = neck_z - spec.get('shoulder_drop', 0.075)
    for name, s in (('ArmL', 1), ('ArmR', -1)):
        arm(name, body_ob, s * sx, sz, spec['arm_len'], spec['arm_r'], M(spec.get('sleeve', spec['top'])),
            spec.get('sleeve_len', 0.45), skin, spread=spec.get('spread', 9.0),
            extra=spec.get('hand_extra', {}).get(name))

    # --- Legs (on the root: they swing from the hips)
    lx = spec['torso_rx'] * 0.46
    for name, s in (('LegL', 1), ('LegR', -1)):
        leg(name, root, s * lx, hip_z, spec['leg_r'], M(spec.get('legs', spec['bottom'])), M('Shoes'), skin=skin,
            short=spec.get('shorts', 0.0), sole=M('Sole') if spec.get('sole') else None,
            shoe_len=spec.get('shoe_len', 0.14))


# ---- hair styles

def hair_adult(p, face, spec):
    hair_cap(p, face, spec, M('Hair'))


def hair_kid(p, face, spec):
    m = M('Hair')
    hair_cap(p, face, spec, m)
    c = face.c
    # cowlick tuft on top and a couple of messy bumps
    p.lathe([(0.0, 0.0), (0.035, 0.0), (0.02, 0.07), (0.0, 0.1)], (0, 0, 0), m, segs=8,
            matrix=_tuft_matrix((0.02, c.y + 0.04, c.z + face.rz * 1.0), (8, -20, 0)))
    for (x, y, z) in ((-0.1, 0.1, 0.84), (0.12, 0.09, 0.84)):
        p.sphere(1.0, (x * face.rx / 0.2, c.y + y, c.z + face.rz * z), m, seg=10, rings=6,
                 scale=(0.07, 0.07, 0.06))


def _tuft_matrix(loc, rot):
    from lib import _mat4
    return _mat4(loc, rot)


def hair_senior(p, face, spec):
    """Mostly bald: fluffy grey puffs over the ears and round the back, bushy brows and a mustache."""
    m = M('Hair')
    c = face.c
    for s in (-1, 1):
        x = face.side_x(s, c.y + 0.03, c.z + face.rz * 0.2, -0.02)
        p.sphere(1.0, (x, c.y + 0.03, c.z + face.rz * 0.22), m, seg=10, rings=6, scale=(0.07, 0.12, 0.1))
        p.sphere(1.0, (x * 0.8, c.y + 0.13, c.z + face.rz * 0.1), m, seg=10, rings=6, scale=(0.08, 0.1, 0.1))
    p.sphere(1.0, (0, c.y + face.ry * 0.86, c.z + face.rz * 0.02), m, seg=10, rings=6, scale=(0.15, 0.08, 0.12))
    # brows
    ez = c.z + face.rz * 0.3
    for s in (-1, 1):
        x = s * face.rx * 0.36
        p.sphere(1.0, (x, face.y(x, ez, -0.012), ez), m, seg=8, rings=4, scale=(0.05, 0.022, 0.02),
                 rot=(0, s * 8, 0))
    # mustache: two puffs under the nose
    mz = c.z - face.rz * 0.2
    for s in (-1, 1):
        x = s * 0.045
        p.sphere(1.0, (x, face.y(x, mz, -0.018), mz), m, seg=8, rings=5, scale=(0.058, 0.032, 0.03),
                 rot=(0, -s * 14, 0))
    # round glasses
    g = M('Glasses')
    gz = c.z + face.rz * 0.04
    for s in (-1, 1):
        x = s * face.rx * 0.36
        y = face.y(x, gz, -0.03)
        p.torus(0.056, 0.012, (x, y, gz), g, segs=12, verts=4, rot=(90, 0, 0))
        # temple arm back to the ear
        p.tube((s * face.rx * 0.36 + s * 0.05, y + 0.005, gz), (face.side_x(s, c.y - 0.04, gz, 0.004),
                                                               c.y - 0.02, gz), 0.006, g, verts=5)
    p.tube((-face.rx * 0.36 + 0.05, face.y(0, gz, -0.034), gz + 0.005),
           (face.rx * 0.36 - 0.05, face.y(0, gz, -0.034), gz + 0.005), 0.007, g, verts=5)


def hair_staff(p, face, spec):
    """Scrub cap (Scrubs) with a little hair showing at the sides and back."""
    c = face.c
    hair = M('Hair')
    p.sphere_cut(1.0, (c.x, c.y + 0.01, c.z - 0.01), hair, (0, -0.5, -0.87), -0.02, seg=12, rings=8,
                 scale=(face.rx * 1.05, face.ry * 1.06, face.rz * 1.03))
    cap = M('Scrubs')
    p.sphere_cut(1.0, (c.x, c.y + 0.004, c.z + 0.035), cap, (0, -0.32, -0.95), 0.06, seg=16, rings=10,
                 scale=(face.rx * 1.1, face.ry * 1.1, face.rz * 1.08))
    # cap band
    bz = c.z + face.rz * 0.42
    p.lathe([(face.rx * 0.95, -0.03), (face.rx * 0.99, -0.02), (face.rx * 0.98, 0.03),
             (face.rx * 0.9, 0.035)], (0, c.y, bz), cap, segs=16, scale=(1.0, face.ry / face.rx * 1.05, 1.0),
            rot=(-10, 0, 0))
    # a little bow knot at the back
    p.sphere(1.0, (0, c.y + face.ry * 0.95, bz), cap, seg=8, rings=6, scale=(0.05, 0.03, 0.035))


def hair_dentist(p, face, spec):
    m = M('Hair')
    hair_cap(p, face, spec, m)
    c = face.c
    # neat side part: a raised swoop on one side
    p.sphere(1.0, (-face.rx * 0.35, c.y - 0.02, c.z + face.rz * 0.78), m, seg=12, rings=8,
             scale=(face.rx * 0.6, face.ry * 0.7, face.rz * 0.3), rot=(0, 12, 0))


# ---- clothing extras

def adult_extra(body, spec):
    # a little chest pocket
    tz = spec['neck_z'] - 0.2
    rx, ry = spec['torso_rx'], spec['torso_ry']
    body.rbox((0.07, 0.02, 0.07), (rx * 0.42, -ry * 0.93, tz), M('Shirt'), r=0.008)


def kid_extra(body, spec):
    # a sunny star on the tee
    rx, ry = spec['torso_rx'], spec['torso_ry']
    tz = spec['hip_z'] + (spec['neck_z'] - spec['hip_z']) * 0.55
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = 0.06 if i % 2 == 0 else 0.026
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    body.plate(pts, 0.02, (0, -ry * 0.99, tz), M('Sunshine'), axis='Y')


def senior_extra(body, spec):
    """Cardigan buttons and a collared shirt in the V."""
    rx, ry = spec['torso_rx'], spec['torso_ry']
    nz = spec['neck_z']
    hz = spec['hip_z']
    # shirt V at the neck
    v = [(-0.075, nz - 0.01), (0.075, nz - 0.01), (0.0, nz - 0.17)]
    body.plate(v, 0.03, (0, -ry * 0.86, 0), M('Cream'), axis='Y')
    # collar points
    for s in (-1, 1):
        body.plate([(0, 0), (s * 0.06, 0.0), (s * 0.02, -0.06)], 0.02, (s * 0.02, -ry * 0.9, nz - 0.005),
                   M('Enamel'), axis='Y')
    # buttons down the front
    for k in range(4):
        z = nz - 0.2 - k * 0.1
        body.sphere(0.018, (0, -ry * 1.0 - 0.004, z), M('WoodDark'), seg=6, rings=4, scale=(1, 0.6, 1))
    # cardigan pockets
    for s in (-1, 1):
        body.box((0.1, 0.02, 0.08), (s * rx * 0.5, -ry * 0.9, hz + 0.1), M('Shirt'))


def staff_extra(body, spec):
    rx, ry = spec['torso_rx'], spec['torso_ry']
    nz = spec['neck_z']
    # V-neck
    body.plate([(-0.06, nz - 0.005), (0.06, nz - 0.005), (0.0, nz - 0.12)], 0.03, (0, -ry * 0.84, 0), M('Skin'),
               axis='Y')
    # name badge and a pen in the chest pocket
    body.rbox((0.07, 0.015, 0.045), (rx * 0.45, -ry * 0.97, nz - 0.2), M('Enamel'), r=0.006)
    body.rbox((0.05, 0.016, 0.012), (rx * 0.45, -ry * 0.98, nz - 0.19), M('Mint'), r=0.004)
    body.tube((-rx * 0.45, -ry * 0.95, nz - 0.26), (-rx * 0.45, -ry * 0.95, nz - 0.16), 0.01, M('Bubblegum'),
              verts=6)
    body.rbox((0.08, 0.02, 0.08), (-rx * 0.45, -ry * 0.94, nz - 0.26), M('Scrubs'), r=0.008)


def dentist_extra(body, spec):
    rx, ry = spec['torso_rx'], spec['torso_ry']
    nz = spec['neck_z']
    hz = spec['hip_z']
    coat = M('Coat')
    # coat skirt down to mid thigh, split at the front
    body.lathe([(0.0, hz - 0.2), (rx * 1.02, hz - 0.2), (rx * 1.03, hz - 0.05), (rx * 1.0, hz + 0.1),
                (0.0, hz + 0.1)], (0, 0, 0), coat, segs=16, scale=(1.0, ry / rx * 1.05, 1.0))
    # scrubs showing in the V and lapels
    body.plate([(-0.08, nz - 0.005), (0.08, nz - 0.005), (0.0, nz - 0.25)], 0.03, (0, -ry * 0.86, 0),
               M('Scrubs'), axis='Y')
    body.plate([(-0.035, nz - 0.03), (0.035, nz - 0.03), (0.0, nz - 0.1)], 0.032, (0, -ry * 0.86, 0), M('Skin'),
               axis='Y')
    for s in (-1, 1):
        body.plate([(s * 0.085, nz + 0.0), (s * 0.13, nz - 0.08), (s * 0.02, nz - 0.28), (s * 0.005, nz - 0.25)],
                   0.02, (0, -ry * 0.93, 0), coat, axis='Y')
    # front seam and buttons
    for k in range(3):
        body.sphere(0.016, (0.0, -ry * 1.0 - 0.006, nz - 0.33 - k * 0.12), M('Enamel'), seg=6, rings=4,
                    scale=(1, 0.6, 1))
    # chest pocket with pens and a tooth badge
    body.rbox((0.085, 0.02, 0.07), (-rx * 0.48, -ry * 0.95, nz - 0.25), coat, r=0.008)
    for k, mm in enumerate(('Bubblegum', 'Teal')):
        body.tube((-rx * 0.48 - 0.018 + k * 0.03, -ry * 0.96, nz - 0.25),
                  (-rx * 0.48 - 0.018 + k * 0.03, -ry * 0.96, nz - 0.17), 0.009, M(mm), verts=6)
    from lib import tooth2d
    body.plate(tooth2d(0.06, 0.06, n=2), 0.02, (rx * 0.46, -ry * 0.98, nz - 0.22), M('Mint'), axis='Y')
    # side pockets on the skirt
    for s in (-1, 1):
        body.rbox((0.1, 0.02, 0.09), (s * rx * 0.55, -ry * 0.98, hz - 0.08), coat, r=0.01)


def senior_cane(p, end):
    """A wooden cane in the right hand, tip on the floor when the arm hangs."""
    wood = M('WoodDark')
    top = end + Vector((0, -0.05, -0.02))
    p.tube(top, Vector((top.x, top.y - 0.02, 0.02)), 0.014, wood, verts=6)
    p.sweep([top + Vector((0, 0.07, -0.03)), top + Vector((0, 0.05, 0.02)), top + Vector((0, 0.0, 0.03)),
             top], 0.016, wood, verts=6)
    p.sphere(0.02, (top.x, top.y - 0.02, 0.02), M('Rubber'), seg=8, rings=5)


SPECS = {
    'char_adult': dict(hip_z=0.64, neck_z=1.1, head_r=0.25, torso_rx=0.215, torso_ry=0.15, arm_len=0.44,
                       arm_r=0.058, leg_r=0.08, top='Shirt', bottom='Pants', hair=hair_adult, sole=True,
                       body_extra=adult_extra, sleeve_len=0.42),
    'char_kid': dict(hip_z=0.34, neck_z=0.66, head_r=0.215, torso_rx=0.165, torso_ry=0.125, arm_len=0.3,
                     arm_r=0.045, leg_r=0.06, top='Shirt', bottom='Pants', hair=hair_kid, shorts=0.55, sole=True,
                     body_extra=kid_extra, sleeve_len=0.45, shoe_len=0.11, eye_r=0.032, spread=12.0),
    'char_senior': dict(hip_z=0.6, neck_z=1.03, head_r=0.235, torso_rx=0.22, torso_ry=0.16, arm_len=0.42,
                        arm_r=0.056, leg_r=0.078, top='Shirt', bottom='Pants', hair=hair_senior,
                        body_extra=senior_extra, sleeve_len=1.0, bulge=1.05,
                        hand_extra={'ArmR': senior_cane}),
    'char_staff': dict(hip_z=0.64, neck_z=1.1, head_r=0.245, torso_rx=0.21, torso_ry=0.15, arm_len=0.44,
                       arm_r=0.056, leg_r=0.08, top='Scrubs', bottom='Scrubs', hair=hair_staff,
                       body_extra=staff_extra, sleeve_len=0.36, sole=True),
    'char_dentist': dict(hip_z=0.66, neck_z=1.13, head_r=0.245, torso_rx=0.22, torso_ry=0.155, arm_len=0.45,
                         arm_r=0.057, leg_r=0.08, top='Coat', bottom='Coat', legs='Scrubs', hair=hair_dentist,
                         body_extra=dentist_extra, sleeve_len=1.0),
}


def _builder(key):
    def fn():
        spec = SPECS[key]
        if key == 'char_senior':
            material('Hair', '#D9DCE0', 0.85, 0.0)
            material('Shirt', '#C98F9E', 0.9, 0.0)
            material('Pants', '#8C8F99', 0.85, 0.0)
        if key == 'char_kid':
            material('Shirt', '#F59BB8', 0.8, 0.0)
            material('Pants', '#6FA0D8', 0.8, 0.0)
        build_person(key, spec)
    return fn


MODELS = {k: dict(fn=_builder(k), budget=100, recenter=False, center_tol=0.12,
                  preview_dir=(0.55, -1.4, 0.45)) for k in SPECS}
