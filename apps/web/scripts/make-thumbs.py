#!/usr/bin/env python3
"""64 px horse thumbnails: exact 2:1 box downsample of the 128 px PixelLab portraits.

Design System v2 (docs/brand-and-design-v2.md §4.7): a thumbnail is never a 128 px portrait
scaled in CSS. Run after adding a portrait, then `pnpm --filter @thoroughbred/web art-index`.
    python3 apps/web/scripts/make-thumbs.py
"""
import glob, os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), "..", "public", "art", "portraits")
os.makedirs(os.path.join(root, "thumb"), exist_ok=True)
for src in sorted(glob.glob(os.path.join(root, "horse-*.png"))):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    assert w % 2 == 0 and h % 2 == 0, src
    out = im.resize((w // 2, h // 2), Image.BOX)
    out.save(os.path.join(root, "thumb", os.path.basename(src)), optimize=True)
    print("thumb", os.path.basename(src), out.size)
