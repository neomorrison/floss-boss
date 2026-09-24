#!/usr/bin/env python3
"""
Floss Boss: slice generated 2D art sheets into final game assets.

Reads raw generated sheets from art/raw/ (gitignored) and writes sliced,
trimmed, center-cropped WebP files into public/img/.

Usage:
    python art/2d/slice.py

Requires Pillow (PIL). Run from the repo root or anywhere; paths are
resolved relative to this script's location.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(ROOT, "art", "raw")
IMG = os.path.join(ROOT, "public", "img")

PORTRAITS_DIR = os.path.join(IMG, "portraits")
STAFF_DIR = os.path.join(IMG, "staff")
AVATARS_DIR = os.path.join(IMG, "avatars")

os.makedirs(PORTRAITS_DIR, exist_ok=True)
os.makedirs(STAFF_DIR, exist_ok=True)
os.makedirs(AVATARS_DIR, exist_ok=True)

# Fraction of the whole image trimmed off each outer edge before dividing
# into a grid, to remove the generation model's own outer margin.
OUTER_TRIM = 0.02
# Fraction of a single cell trimmed off each edge of that cell, to remove
# the small gap the model leaves between cells and any halo/shadow bleed.
CELL_TRIM = 0.045


def trimmed_bounds(w, h, trim):
    dx = int(w * trim)
    dy = int(h * trim)
    return dx, dy, w - dx, h - dy


def grid_cell(im, rows, cols, r, c):
    """Return a PIL Image for cell (r, c) of an rows x cols grid, with
    outer-image trim and per-cell trim applied."""
    W, H = im.size
    x0, y0, x1, y1 = trimmed_bounds(W, H, OUTER_TRIM)
    gw = (x1 - x0) / cols
    gh = (y1 - y0) / rows
    cx0 = x0 + c * gw
    cy0 = y0 + r * gh
    cx1 = cx0 + gw
    cy1 = cy0 + gh
    # per-cell trim
    tw = gw * CELL_TRIM
    th = gh * CELL_TRIM
    box = (int(cx0 + tw), int(cy0 + th), int(cx1 - tw), int(cy1 - th))
    return im.crop(box)


def center_square(im):
    """Center-crop an image to a square using its shorter side."""
    w, h = im.size
    s = min(w, h)
    x0 = (w - s) // 2
    y0 = (h - s) // 2
    return im.crop((x0, y0, x0 + s, y0 + s))


def save_webp(im, path, size, quality):
    im = center_square(im)
    im = im.convert("RGB").resize((size, size), Image.LANCZOS)
    im.save(path, "WEBP", quality=quality)
    print(f"  wrote {os.path.relpath(path, ROOT)}  ({size}x{size} q{quality})")


def load(name):
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        p = os.path.join(RAW, name + ext)
        if os.path.exists(p):
            return Image.open(p)
    raise FileNotFoundError(f"no raw sheet found for {name} in {RAW}")


# ------------------------------------------------------------------ patients
MOODS = ["happy", "neutral", "pain", "wow"]  # top-left, top-right, bottom-left, bottom-right
PATIENTS = [
    "mannequin", "regular", "coffee", "kid", "nervous",
    "gagger", "smoker", "senior", "influencer", "athlete", "chatty",
]

print("Patient portraits (2x2 sheets -> 512px webp q82)")
for name in PATIENTS:
    im = load(f"{name}_sheet")
    for idx, mood in enumerate(MOODS):
        r, c = divmod(idx, 2)
        cell = grid_cell(im, 2, 2, r, c)
        out = os.path.join(PORTRAITS_DIR, f"{name}_{mood}.webp")
        save_webp(cell, out, 512, 82)

# ------------------------------------------------------------------ staff
print("Staff (3x3 sheets -> 384px webp q82)")
staff_n = 0
for sheet_idx in (1, 2):
    im = load(f"staff_sheet_{sheet_idx}")
    for idx in range(9):
        r, c = divmod(idx, 3)
        cell = grid_cell(im, 3, 3, r, c)
        out = os.path.join(STAFF_DIR, f"staff_{staff_n}.webp")
        save_webp(cell, out, 384, 82)
        staff_n += 1

# ------------------------------------------------------------------ avatars
print("Avatars (2x2 sheet -> 384px webp q82)")
im = load("avatar_sheet")
for idx in range(4):
    r, c = divmod(idx, 2)
    cell = grid_cell(im, 2, 2, r, c)
    out = os.path.join(AVATARS_DIR, f"avatar_{idx}.webp")
    save_webp(cell, out, 384, 82)

# ------------------------------------------------------------------ boss
print("Boss (single portrait -> 512px webp q82)")
im = load("boss")
save_webp(im, os.path.join(IMG, "boss.webp"), 512, 82)

# ------------------------------------------------------------------ title
print("Title key art (16:9 -> 1920x1080 webp q80)")
im = load("title_bg")
x0, y0, x1, y1 = trimmed_bounds(im.size[0], im.size[1], 0.0)
im2 = im.crop((x0, y0, x1, y1)).convert("RGB").resize((1920, 1080), Image.LANCZOS)
im2.save(os.path.join(IMG, "title_bg.webp"), "WEBP", quality=80)
print(f"  wrote public/img/title_bg.webp (1920x1080 q80)")

print("Done.")
