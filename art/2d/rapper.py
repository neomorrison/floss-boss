#!/usr/bin/env python3
"""
Floss Boss: slice the rap star patient sheet (art/raw/rapper_sheet.png, see prompts.md #18) into
public/img/portraits/rapper_<mood>.webp (512 px, q82).

The sheet needs three small fixes that slice.py does not do, so the rap star has his own script:
  - the model drew the sunglasses pushed up on his head only in the top row; they are copied from
    the cell above onto the pain and wow heads (same head position, found by silhouette matching),
    behind the pain cell's sweat drop,
  - the background came out a darker sand (#E5C68A) than the requested pastel champagne; it is
    shifted to #F5E3BF, with the anti-aliased edges against the dark outlines blended, not cut,
  - each crop is a square centered on the character whose bottom edge sits just above the flat
    bottom outline of the bust, so the jacket runs off the bottom like the other portraits.

Usage: python art/2d/rapper.py        (needs Pillow, numpy, scipy)
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(ROOT, "art", "raw", "rapper_sheet.png")
OUT = os.path.join(ROOT, "public", "img", "portraits")

BG_OLD = np.array([229.0, 198.0, 138.0])   # the sheet's flat background
BG_NEW = np.array([245.0, 227.0, 191.0])   # #F5E3BF, pastel champagne
LINE = np.array([13.0, 50.0, 53.0])        # the dark-teal outline colour
CELL = 512
SIZE = 512
QUALITY = 82
CROP = 440                                 # square crop side in sheet pixels (upscaled to 512)


def glasses_mask(im, box):
    """The sunglasses (yellow frame, dark lenses, their outline) inside box = (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    c = im[y0:y1, x0:x1]
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    yellow = (r > 195) & (g > 200) & (g - b > 80)
    m = nd.binary_fill_holes(nd.binary_closing(yellow, iterations=2))
    dark = c.mean(-1) < 120
    m = m | (nd.binary_dilation(m, iterations=4) & dark)
    return nd.binary_fill_holes(m)


def best_offset(im, top_x0, top_x1):
    """Vertical/horizontal shift from a top-row head to the head below it: the shift that best matches
    the face-and-hair silhouette below the sunglasses."""
    sil = np.abs(im - BG_OLD).sum(-1) > 60
    a = sil[150:330, top_x0:top_x1]
    best = None
    for dy in range(460, 505):
        for dx in range(-16, 17):
            b = sil[150 + dy:330 + dy, top_x0 + dx:top_x1 + dx]
            s = int((a != b).sum())
            if best is None or s < best[0]:
                best = (s, dx, dy)
    return best[1], best[2]


def transplant_glasses(im, src_box, dx, dy, protect=None):
    """Copy the masked sunglasses from src_box to the same spot shifted by (dx, dy). Pixels in `protect`
    (a full-size bool mask) stay untouched, so a sweat drop stays in front."""
    x0, y0, x1, y1 = src_box
    m = glasses_mask(im, src_box)
    soft = nd.gaussian_filter(m.astype(float), 0.6)
    soft = np.clip(soft * 1.4, 0, 1)[..., None]
    src = im[y0:y1, x0:x1]
    tx0, ty0 = x0 + dx, y0 + dy
    dst = im[ty0:ty0 + (y1 - y0), tx0:tx0 + (x1 - x0)]
    blend = dst * (1 - soft) + src * soft
    if protect is not None:
        p = protect[ty0:ty0 + (y1 - y0), tx0:tx0 + (x1 - x0)][..., None]
        blend = np.where(p, dst, blend)
    im[ty0:ty0 + (y1 - y0), tx0:tx0 + (x1 - x0)] = blend


def sweat_drop_mask(im, box):
    """The light-blue cartoon sweat drop and its outline inside box."""
    x0, y0, x1, y1 = box
    c = im[y0:y1, x0:x1]
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    blue = (b > 170) & (b - r > 40)
    m = nd.binary_fill_holes(nd.binary_closing(blue, iterations=2))
    m = m | (nd.binary_dilation(m, iterations=4) & (c.mean(-1) < 120))
    full = np.zeros(im.shape[:2], bool)
    full[y0:y1, x0:x1] = nd.binary_dilation(m, iterations=1)
    return full


def recolor_background(im):
    """Shift the flat background to BG_NEW. The weight is how much of the background colour a pixel
    holds on the line from the outline colour to the background (1 for pure background, a fraction on
    anti-aliased outline edges), only inside the background region grown by 3 px."""
    d = np.abs(im - BG_OLD).sum(-1)
    near = d < 40
    lab, _ = nd.label(near)
    corners = {lab[4, 4], lab[4, -5], lab[-5, 4], lab[-5, -5], lab[CELL, 4], lab[4, CELL], lab[CELL, CELL]}
    corners.discard(0)
    region = np.isin(lab, list(corners))
    region = nd.binary_dilation(region, iterations=3)
    v = BG_OLD - LINE
    w = np.clip(((im - LINE) @ v) / (v @ v), 0, 1)
    w = np.where(region, w, 0.0)[..., None]
    return np.clip(im + w * (BG_NEW - BG_OLD), 0, 255)


def char_bounds(im, x0, y0):
    sil = np.abs(im[y0:y0 + CELL, x0:x0 + CELL] - BG_OLD).sum(-1) > 60
    ys, xs = np.nonzero(sil)
    return xs.min() + x0, xs.max() + x0, ys.min() + y0, ys.max() + y0


def main():
    im = np.asarray(Image.open(RAW).convert("RGB")).astype(float)
    cells = {"happy": (0, 0), "neutral": (CELL, 0), "pain": (0, CELL), "wow": (CELL, CELL)}
    bounds = {k: char_bounds(im, *xy) for k, xy in cells.items()}

    # sunglasses: happy -> pain, neutral -> wow (the sweat drop stays in front)
    drop = sweat_drop_mask(im, (360, 560, 460, 700))
    for src, dst_key, (x0, x1) in (("happy", "pain", (110, 470)), ("neutral", "wow", (570, 930))):
        dx, dy = best_offset(im, x0, x1)
        box = (x0 + 40, 50, x1 - 40, 160)
        transplant_glasses(im, box, dx, dy, protect=drop if dst_key == "pain" else None)
        print(f"  sunglasses {src} -> {dst_key}: shift ({dx}, {dy})")

    im = recolor_background(im)
    out = Image.fromarray(im.round().astype(np.uint8))
    os.makedirs(OUT, exist_ok=True)
    for mood, (cx0, cy0) in cells.items():
        x0, x1, _y0, y1 = bounds[mood]
        cx = (x0 + x1) / 2
        bottom = y1 - 7                    # just above the flat bottom outline of the bust
        left = int(round(cx - CROP / 2))
        left = max(cx0, min(cx0 + CELL - CROP, left))
        top = bottom - CROP
        crop = out.crop((left, top, left + CROP, bottom)).resize((SIZE, SIZE), Image.LANCZOS)
        path = os.path.join(OUT, f"rapper_{mood}.webp")
        crop.save(path, "WEBP", quality=QUALITY)
        print(f"  wrote {os.path.relpath(path, ROOT)}  crop ({left}, {top}) {CROP} px -> {SIZE} q{QUALITY}")


if __name__ == "__main__":
    main()
