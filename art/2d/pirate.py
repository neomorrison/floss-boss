#!/usr/bin/env python3
"""
Floss Boss: slice the pirate patient sheet (art/raw/pirate_sheet.png, see prompts.md #17) into
public/img/portraits/pirate_<mood>.webp (512 px, q82).

The sheet needs three small fixes that slice.py does not do, so the pirate has its own script:
  - the cells are cropped with a small trim (the tricorn hats reach the top of each cell),
  - the pain cell is mirrored so the eyepatch sits on the same side as in the other three cells,
  - the happy and wow grins get a painted gold front tooth (the model drew it only in the pain cell).

Usage: python art/2d/pirate.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(ROOT, "art", "raw", "pirate_sheet.png")
OUT = os.path.join(ROOT, "public", "img", "portraits")

MOODS = ["happy", "neutral", "pain", "wow"]  # top-left, top-right, bottom-left, bottom-right
TRIM = 6                                     # px trimmed off every edge of a 512 px cell

GOLD_HI = (255, 226, 122)
GOLD = (242, 185, 58)
GOLD_LO = (190, 128, 30)
LINE = (24, 50, 56)

# gold tooth boxes in sheet pixels: (x0, y0, x1, y1). Only near-white pixels inside are repainted.
GOLD_TEETH = {
    "happy": (276, 310, 291, 326),
    "wow": (750, 808, 764, 821),
}


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def paint_gold_tooth(im, box):
    x0, y0, x1, y1 = box
    px = im.load()
    ys = [y for y in range(y0, y1) if any(sum(px[x, y]) > 560 for x in range(x0, x1))]
    if not ys:
        return
    top, bot = min(ys), max(ys)
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            lum = (r + g + b) / 3
            if lum < 150 or not (r > 150 and g > 150 and b > 140):
                continue
            # vertical gradient: bright at the top edge, deeper gold toward the gumline, a glint stripe
            t = (y - top) / max(1, bot - top)
            c = lerp(GOLD_HI, GOLD, min(1, t * 1.6)) if t < 0.6 else lerp(GOLD, GOLD_LO, (t - 0.6) / 0.4)
            if x0 + 3 <= x <= x0 + 4 and t < 0.7:
                c = lerp(c, (255, 250, 220), 0.7)
            k = min(1.0, (lum - 150) / 90)        # keep the anti-aliased edge against the dark outline
            px[x, y] = lerp(LINE, c, k)
    # tooth separators: thin outline strokes at both sides, inside the white band only
    for x in (x0, x0 + 1, x1 - 2, x1 - 1):
        for y in range(y0, y1):
            r, g, b = px[x, y]
            if (r + g + b) / 3 > 120:
                px[x, y] = lerp(px[x, y], LINE, 0.85)


def main():
    sheet = Image.open(RAW).convert("RGB")
    W, H = sheet.size
    for mood, box in GOLD_TEETH.items():
        sx, sy = W / 1024, H / 1024
        paint_gold_tooth(sheet, (int(box[0] * sx), int(box[1] * sy), int(box[2] * sx), int(box[3] * sy)))
    cw, ch = W // 2, H // 2
    bg = sheet.getpixel((4, 4))
    px = sheet.load()
    for idx, mood in enumerate(MOODS):
        r, c = divmod(idx, 2)
        t = int(TRIM * W / 1024)
        # center the crop on the character (the model drew every pirate a little right of its cell center,
        # which the mirrored pain cell would otherwise turn into a left offset)
        xs = [x for x in range(c * cw, (c + 1) * cw, 2)
              if any(sum(abs(px[x, y][k] - bg[k]) for k in range(3)) > 60 for y in range(r * ch + ch // 3, r * ch + ch * 2 // 3, 3))]
        mid = (min(xs) + max(xs)) // 2 if xs else c * cw + cw // 2
        half = cw // 2 - t
        x0 = max(0, min(W - 2 * half, mid - half))
        cell = sheet.crop((x0, r * ch + t, x0 + 2 * half, (r + 1) * ch - t))
        if mood == "pain":
            cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
        cell = cell.resize((512, 512), Image.LANCZOS)
        path = os.path.join(OUT, f"pirate_{mood}.webp")
        cell.save(path, "WEBP", quality=82)
        print(f"  wrote {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
