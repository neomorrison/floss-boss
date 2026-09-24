# Builds, exports and thumbnails every mouth and tool model. Idempotent: rerun at will.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
#       --python art/blender/mouth/build.py -- [options]
#     --only key1,key2   build a subset (model keys from src/data/assets.ts MOUTH_MODELS / TOOL_MODELS)
#     --no-thumbs        skip the shop thumbnails (tools and extras)
#     --preview          also render 512 px Blender previews to out/artmouth/preview/<key>.png
#
# Output: public/models/<key>.glb, public/img/thumbs/<key>.png (tools and extras), out/mouth_build.json
# Fit check (teeth vs neighbours and gum margins): art/blender/mouth/verify.py
# Visual check in three.js: /harness/models-mouth.html (see the header of harness/models-mouth.ts)
import os
import sys
import json
import time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402
import teeth  # noqa: E402
import gums  # noqa: E402
import soft  # noqa: E402
import tools  # noqa: E402
import cases  # noqa: E402

# budgets (docs: teeth 800 to 2,500 tris and < 80 KB, gums/frame < 250 KB, tools < 120 KB, case props < 100 KB)
BUDGET = {'tooth': (800, 2500, 80), 'gum': (0, 1e9, 250), 'frame': (0, 1e9, 250), 'tool': (0, 1e9, 120),
          'soft': (0, 1e9, 120), 'case': (0, 1e9, 100)}


def registry():
    reg = {}
    for k, fn in teeth.builders().items():
        reg[k] = {'fn': fn, 'kind': 'tooth', 'uv': True, 'colors': False}
    for k, fn in gums.builders().items():
        reg[k] = {'fn': fn, 'kind': 'gum', 'uv': False, 'colors': True}
    for k, (fn, colors) in soft.builders().items():
        reg[k] = {'fn': fn, 'kind': 'frame' if k == 'mouth_frame' else 'soft', 'uv': False, 'colors': colors}
    for k, (fn, colors) in cases.builders().items():
        reg[k] = {'fn': fn, 'kind': 'case', 'uv': False, 'colors': colors}
    for k, fn in tools.builders().items():
        reg[k] = {'fn': fn, 'kind': 'tool', 'uv': False, 'colors': False, 'thumb': True}
    return reg


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'only': None, 'thumbs': True, 'preview': False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--only':
            opts['only'] = set(argv[i + 1].split(','))
            i += 1
        elif a == '--no-thumbs':
            opts['thumbs'] = False
        elif a == '--preview':
            opts['preview'] = True
        i += 1
    return opts


PREVIEW_VIEW = {
    'tooth': (0.9, 0.55, 1.4),
    'gum': (0.0, 1.2, 1.6),
    'frame': (0.25, 0.15, 1.6),
    'case': (0.7, 0.9, 1.1),
}


def main():
    opts = parse_args()
    reg = registry()
    report = []
    t0 = time.time()
    for key, meta in reg.items():
        if opts['only'] and key not in opts['only']:
            continue
        lib.reset()
        meta['fn']()
        bpy.context.view_layer.update()
        path = lib.export_glb(key, texcoords=meta['uv'], colors=meta['colors'], morph=key == 'mouth_frame')
        P = lib.three_points()
        mn, mx = P.min(axis=0), P.max(axis=0)
        kb = os.path.getsize(path) / 1024
        tris = lib.tri_count()
        lo, hi, kb_max = BUDGET[meta['kind']]
        ok = lo <= tris <= hi and kb <= kb_max
        row = {'key': key, 'tris': tris, 'kb': round(kb, 1), 'ok': ok,
               'min': [round(float(v), 3) for v in mn], 'max': [round(float(v), 3) for v in mx],
               'materials': sorted({m.name for o in lib.mesh_objects() for m in o.data.materials if m})}
        report.append(row)
        print('BUILT %-18s tris=%-6d %6.1f KB %s  min=%s max=%s  %s' % (
            key, tris, kb, 'ok' if ok else 'OVER BUDGET', row['min'], row['max'], row['materials']))
        if meta.get('thumb') and opts['thumbs']:
            tools.render_thumb(key)
        if opts['preview']:
            lib.setup_studio(512, samples=32)
            if meta['kind'] == 'tool':
                view = tools.THUMB_VIEW.get(key, (0.2, 0.25, 1.0))
            elif key == 'gum_upper':
                view = (0.0, -1.2, 1.6)
            else:
                view = PREVIEW_VIEW.get(meta['kind'], (0.9, 0.7, 1.3))
            if meta['kind'] == 'tool':
                tools.pose_for_thumb(key)
            lib.frame_camera(direction=view or (1.0, 0.7, 1.25), fill=0.9)
            lib.render_to(os.path.join(lib.OUT_DIR, 'artmouth', 'preview', key + '.png'))
    os.makedirs(lib.OUT_DIR, exist_ok=True)
    with open(os.path.join(lib.OUT_DIR, 'mouth_build.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
    print('DONE %d models in %.1fs' % (len(report), time.time() - t0))


main()
