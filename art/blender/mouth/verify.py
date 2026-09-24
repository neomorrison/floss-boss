# Fit check for the assembled mouth, using the same implicit shapes the models are meshed from.
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
#       --python art/blender/mouth/verify.py
#
# 1. Neighbouring crowns (placed exactly like the game: layoutTeeth(), x scaled to the placement width,
#    upper teeth given a half turn about Z) must not intersect.
# 2. The gum margin must tuck into each tooth (no gap you can see into) while the rolled gum edge stays
#    in front of the enamel (the scallop is visible).
import os
import sys
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import implicit as im  # noqa: E402
import teeth  # noqa: E402
import gums  # noqa: E402
from mouthgeo import layout_teeth, TOOTH_DIMS, ROOT_Y, arch_point, arch_normal, tooth_matrix  # noqa: E402


def apply(Mx, P):
    return (np.c_[P, np.ones(len(P))] @ Mx.T)[:, :3]


def main():
    lay = layout_teeth()
    fns = {k: teeth.tooth_fn(k) for k in TOOTH_DIMS}
    meshes = {}
    for k in TOOTH_DIMS:
        D = TOOTH_DIMS[k]
        P, _ = im.mesh_star(fns[k], (0.0, (D['h'] + ROOT_Y) / 2, 0.0), (D['w'] / 2, (D['h'] - ROOT_Y) / 2, D['d'] / 2),
                            n=teeth.SPEC[k]['n'], relax=8)
        meshes[k] = P
    worst = 1e9
    fails = 0
    print('-- neighbour clearance (crowns above the gumline; negative = overlap)')
    for arch in ('upper', 'lower'):
        row = [t for t in lay if t['arch'] == arch]
        for a, b in zip(row, row[1:]):
            Pa = meshes[a['kind']]
            Pa = Pa[Pa[:, 1] > 0.02]                        # the visible crown only
            W = apply(tooth_matrix(a), Pa)
            Lb = apply(np.linalg.inv(tooth_matrix(b)), W)
            d = fns[b['kind']](Lb)
            m = float(d.min())
            worst = min(worst, m)
            flag = 'OVERLAP' if m < -0.004 else 'ok'
            if flag != 'ok':
                fails += 1
            print('  %s %2d-%2d %-8s %-8s min clearance %+.3f %s' % (arch, a['pos'], b['pos'], a['kind'], b['kind'], m, flag))
    print('-- gum margin fit')
    for arch in ('upper', 'lower'):
        rows, scale = gums._samples(arch)
        row_t = [t for t in lay if t['arch'] == arch]
        bad = 0
        for r in rows:
            if r['ext'] > 0 or abs(r['tau']) > 0.55:
                continue                                   # only where the tooth is (not the papilla gap)
            t = row_t[r['k']]
            ax, az = arch_point(r['s'], scale)
            nx, nz = arch_normal(r['s'])
            sign = -1.0 if arch == 'upper' else 1.0
            y0 = t['y']
            pts_in = []
            pts_out = []
            for (n, u, lst) in ((r['ndF'] - 0.025, r['ym'], pts_in), (r['ndF'] + 0.1, r['ym'] - 0.03, pts_out),
                                (-(r['ndB'] - 0.025), r['ym'], pts_in)):
                lst.append((ax + nx * n, y0 + sign * u, az + nz * n))
            L_in = apply(np.linalg.inv(tooth_matrix(t)), np.array(pts_in))
            L_out = apply(np.linalg.inv(tooth_matrix(t)), np.array(pts_out))
            f_in = fns[t['kind']](L_in)
            f_out = fns[t['kind']](L_out)
            if f_in.max() > 0.01 or f_out.min() < 0.0:
                bad += 1
                print('  %s tooth %2d tau %+.2f  margin inside %+.3f  roll outside %+.3f  CHECK' % (
                    arch, t['pos'], r['tau'], f_in.max(), f_out.min()))
        print('  %s: %d rows checked, %d need attention' % (arch, len(rows), bad))
        fails += bad
    print('RESULT worst crown clearance %+.3f, %d issue(s)' % (worst, fails))


main()
