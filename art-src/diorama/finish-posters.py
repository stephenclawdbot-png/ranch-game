"""Clamp the rendered posters to 256 colours (no dither) so they stay small, hard-edged PNGs.
  python3 -I art-src/diorama/finish-posters.py"""
from pathlib import Path
from PIL import Image

for p in sorted(Path("apps/web/public/art/diorama").glob("poster-*.png")):
    im = Image.open(p).convert("RGB")
    q = im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q.save(p, optimize=True)
    print(p.name, im.size, p.stat().st_size // 1024, "KB")
