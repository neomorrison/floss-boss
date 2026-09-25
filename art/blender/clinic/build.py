# Floss Boss clinic + people models: headless Blender build.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
#       --python art/blender/clinic/build.py -- [--only key,key | --only v3 | --only v4] [--preview] [--no-thumbs] [--no-export]
#
# Writes public/models/<key>.glb for every key in CLINIC_MODELS and PEOPLE_MODELS (src/data/assets.ts),
# public/img/thumbs/<key>.png for the chairs, op upgrades and equipment, and with --preview a 384 px
# render per model to out/preview-clinic/<key>.png. Idempotent: every model starts from an empty scene.
#
# Contract (docs/ARCHITECTURE.md "Clinic models"): meters, front faces +Z (Blender -Y), origin on the floor
# at the footprint center. Chairs: headrest toward -Z, material Upholstery. People: root node at the floor
# with children Body (pivot at the hips; Head, ArmL, ArmR under it), LegL, LegR; tintable materials Skin,
# Hair, Shirt, Pants, Shoes, Scrubs, Coat.
import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
sys.dont_write_bytecode = True   # keep __pycache__ out of the repo

import lib  # noqa: E402
import chairs  # noqa: E402
import operatory  # noqa: E402
import front  # noqa: E402
import people  # noqa: E402
import equipment  # noqa: E402
import props  # noqa: E402
import endgame  # noqa: E402

for _m in (lib, chairs, operatory, front, people, equipment, props, endgame):
    importlib.reload(_m)

REGISTRY = {}
for _m in (chairs, operatory, front, people, equipment, props, endgame):
    REGISTRY.update(_m.MODELS)

# Keys listed in src/data/assets.ts, in order.
CLINIC_KEYS = [
    'chair_basic', 'chair_comfort', 'chair_deluxe',
    'op_lamp', 'op_cart', 'op_counter', 'op_monitor', 'op_tv', 'whitening_lamp', 'intraoral_cam',
    'reception_desk', 'waiting_chair', 'plant_tall', 'plant_small', 'water_cooler', 'magazine_table',
    'fish_tank', 'kids_corner', 'espresso_machine', 'sterilizer', 'kiosk', 'ultrasonic_cart', 'xray_unit',
    'break_table', 'certificate', 'wall_tv', 'entrance_door', 'partition', 'tooth_sign', 'trash_bin', 'coat_rack',
    # v3 equipment and op upgrades (DESIGN 10.5)
    'water_filter', 'aroma_diffuser', 'loyalty_board', 'staff_lockers', 'digital_xray', 'sound_panel', 'patient_tablet',
    'nitrous_tank', 'laser_whitening', 'spa_lounge', 'cadcam_mill', 'rooftop_planter', 'smile_studio', 'research_desk',
    'helipad_sign', 'ai_screen', 'ergo_stool',
    # v3 event props (DESIGN 10.2)
    'prop_puppy', 'prop_balloons', 'prop_jolly_roger', 'prop_rival_sign', 'prop_red_carpet', 'prop_generator',
    'prop_camera_crew',
    # end game (DESIGN 11): Smile Van on the street, the trophy wall, the ribbon for openings
    'smile_van', 'trophy_golden_molar', 'plaque_frame', 'prop_ribbon',
]
V3_KEYS = CLINIC_KEYS[CLINIC_KEYS.index('water_filter'):]
V4_KEYS = CLINIC_KEYS[CLINIC_KEYS.index('smile_van'):]
PEOPLE_KEYS = ['char_adult', 'char_kid', 'char_senior', 'char_staff', 'char_dentist']
ALL_KEYS = CLINIC_KEYS + PEOPLE_KEYS

# Shop thumbnails: chairs, OP_UPGRADES[].model, EQUIPMENT[].model (src/data/upgrades.ts).
THUMB_KEYS = [
    'chair_basic', 'chair_comfort', 'chair_deluxe',
    'op_tv', 'whitening_lamp', 'intraoral_cam',
    'certificate', 'espresso_machine', 'kids_corner', 'fish_tank', 'sterilizer', 'kiosk', 'ultrasonic_cart',
    'xray_unit', 'break_table',
    # v3: OP_UPGRADES ergoStool, nitrous and the new EQUIPMENT
    'ergo_stool', 'nitrous_tank',
    'water_filter', 'aroma_diffuser', 'loyalty_board', 'staff_lockers', 'digital_xray', 'sound_panel', 'patient_tablet',
    'laser_whitening', 'spa_lounge', 'cadcam_mill', 'rooftop_planter', 'smile_studio', 'research_desk', 'helipad_sign',
    'ai_screen',
    # v4: EQUIPMENT smileVan
    'smile_van',
]
# Thumbnail camera direction overrides (Blender space, pointing from the model toward the camera). Tall thin
# props get a higher camera, which foreshortens the pole so the whole object still reads at card size.
HIGH = (0.9, -1.2, 1.5)
THUMB_DIR = {
    'certificate': (0.55, -1.4, 0.35),
    'op_tv': (0.9, -1.3, 0.2),
    'whitening_lamp': HIGH,
    'intraoral_cam': HIGH,
    'xray_unit': HIGH,
    'kiosk': HIGH,
    # wall pieces read best nearly face on; tall thin ones from higher up
    'water_filter': (0.75, -1.4, 0.45),
    'digital_xray': (0.75, -1.4, 0.45),
    'sound_panel': (0.5, -1.4, 0.3),
    'ai_screen': (0.5, -1.4, 0.3),
    'loyalty_board': (0.75, -1.4, 0.5),
    'patient_tablet': HIGH,
    'laser_whitening': (1.15, -1.1, 0.3),
    'helipad_sign': (0.8, -1.3, 0.9),
}
# Optional: frame the thumbnail on the part above this height (meters, Blender Z), letting the rest run off
# the bottom edge. Unused for now: whole objects read better as shop cards.
THUMB_MIN_Z = {}

PEOPLE_NODES = ['Body', 'Head', 'LegL', 'LegR', 'ArmL', 'ArmR']
PEOPLE_MATS = {'Skin', 'Hair', 'Shirt', 'Pants', 'Shoes', 'Scrubs', 'Coat'}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'only': None, 'preview': False, 'thumbs': True, 'export': True}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--only':
            opts['only'] = [k.strip() for k in argv[i + 1].split(',') if k.strip()]
            i += 1
        elif a == '--preview':
            opts['preview'] = True
        elif a == '--no-thumbs':
            opts['thumbs'] = False
        elif a == '--no-export':
            opts['export'] = False
        i += 1
    return opts


def check(key, spec):
    """Contract checks. Returns a list of problems (empty when the model is fine)."""
    import bpy
    problems = []
    mn, mx = lib.world_bbox()
    if mn.z < -0.002:
        problems.append(f'geometry below the floor (min z {mn.z:.3f})')
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    tol = spec.get('center_tol', 0.06)
    if abs(cx) > tol or abs(cy) > tol:
        problems.append(f'footprint center off the origin ({cx:.3f}, {cy:.3f})')
    for o in bpy.context.scene.objects:
        r = o.rotation_euler
        if abs(r.x) + abs(r.y) + abs(r.z) > 1e-6 or any(abs(s - 1) > 1e-6 for s in o.scale):
            problems.append(f'node {o.name} has a rotation or scale (joints must be identity)')
    if key.startswith('char_'):
        names = {o.name for o in bpy.context.scene.objects}
        for n in PEOPLE_NODES:
            if n not in names:
                problems.append(f'missing node {n}')
        roots = [o for o in bpy.context.scene.objects if o.parent is None]
        if len(roots) != 1:
            problems.append(f'expected one root, found {[o.name for o in roots]}')
        mats = {m.name for o in lib.mesh_objects() for m in o.data.materials}
        if not (mats & PEOPLE_MATS):
            problems.append('no tintable materials')
    if key == 'prop_puppy':
        names = {o.name for o in bpy.context.scene.objects}
        for n in ('Body', 'Head', 'Tail'):
            if n not in names:
                problems.append(f'missing node {n}')
    if key.startswith('chair_'):
        mats = {m.name for o in lib.mesh_objects() for m in o.data.materials}
        if 'Upholstery' not in mats:
            problems.append('missing Upholstery material')
    return problems


def main():
    import bpy
    opts = parse_args()
    keys = opts['only'] or ALL_KEYS
    if keys == ['v3']:
        keys = V3_KEYS
    if keys == ['v4']:
        keys = V4_KEYS
    unknown = [k for k in keys if k not in REGISTRY]
    if unknown:
        print('UNKNOWN KEYS', unknown)
    rows = []
    t_all = time.time()
    for key in keys:
        if key not in REGISTRY:
            continue
        spec = REGISTRY[key]
        t0 = time.time()
        lib.reset()
        spec['fn']()
        if spec.get('recenter', True):
            lib.recenter_xy()
        problems = check(key, spec)
        tris = lib.tri_count()
        size_kb = 0.0
        if opts['export']:
            path = lib.export_glb(key)
            size_kb = os.path.getsize(path) / 1024.0
            budget = spec.get('budget', 150)
            if size_kb > budget:
                problems.append(f'{size_kb:.0f} KB is over the {budget} KB budget')
        if opts['preview']:
            lib.render_preview(key, direction=spec.get('preview_dir'))
        if opts['thumbs'] and key in THUMB_KEYS:
            lib.render_thumb(key, direction=THUMB_DIR.get(key), min_z=THUMB_MIN_Z.get(key))
        mn, mx = lib.world_bbox()
        dims = mx - mn
        rows.append((key, tris, size_kb, dims, problems, time.time() - t0))
    print('\n==== clinic build summary ====')
    for key, tris, kb, d, problems, dt in rows:
        flag = 'OK ' if not problems else 'BAD'
        print(f'{flag} {key:18s} tris {tris:6d}  {kb:6.1f} KB  size {d.x:.2f} x {d.y:.2f} x {d.z:.2f} m  {dt:4.1f}s')
        for pr in problems:
            print(f'      - {pr}')
    print(f'==== {len(rows)} models in {time.time() - t_all:.1f}s ====')


if __name__ == '__main__':
    main()
