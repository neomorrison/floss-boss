# Contact sheet of the Blender previews (plain Python + PIL, run outside Blender):
#   python art/blender/clinic/sheet.py [out/preview-clinic] [cols] [key,key,...]
# Writes out/sheet-<dir name>.png (never into the source folder) with each image labelled, on a light backdrop.
import os
import sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'out', 'preview-clinic')
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 6
only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
files = sorted(f for f in os.listdir(d) if f.endswith('.png') and not f.startswith('sheet'))
if only:
    files = [f + '.png' for f in only if os.path.exists(os.path.join(d, f + '.png'))]
cell = 256
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * cell, rows * (cell + 18)), (236, 243, 241, 255))
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).convert('RGBA').resize((cell, cell), Image.LANCZOS)
    x, y = (i % cols) * cell, (i // cols) * (cell + 18)
    sheet.alpha_composite(im, (x, y))
    dr.text((x + 6, y + cell + 3), f[:-4], fill=(22, 50, 58, 255))
os.makedirs(os.path.join(ROOT, 'out'), exist_ok=True)
out = os.path.join(ROOT, 'out', 'sheet-' + os.path.basename(os.path.normpath(d)) + '.png')
sheet.save(out)
print('wrote', out, len(files), 'images')
