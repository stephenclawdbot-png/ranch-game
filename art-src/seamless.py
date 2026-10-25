"""Horizontal seamless helper.
  prep:  python3 -I art-src/seamless.py prep <in.png> <out-prefix> <band> [cropL cropR]
         -> <prefix>-rolled.png, <prefix>-mask.png (white band in the centre = regenerate)
  merge: python3 -I art-src/seamless.py merge <prefix> <inpainted.png> <out.png>
         -> keeps rolled pixels outside the band, inpainted pixels inside it.
The rolled image's left/right edges were neighbouring columns in the source, so the result
tiles perfectly; only the centre band (the old seam) is redrawn by PixelLab inpainting.
"""
import sys
import numpy as np
from PIL import Image

cmd = sys.argv[1]
if cmd == "prep":
    src, prefix, band = sys.argv[2], sys.argv[3], int(sys.argv[4])
    a = np.array(Image.open(src).convert("RGBA"))
    if len(sys.argv) > 6:
        a = a[:, int(sys.argv[5]) : a.shape[1] - int(sys.argv[6])]
    W = a.shape[1]
    r = np.roll(a, W // 2, axis=1)
    m = np.zeros(a.shape[:2], np.uint8)
    m[:, W // 2 - band // 2 : W // 2 + band // 2] = 255
    Image.fromarray(r).save(f"{prefix}-rolled.png")
    Image.fromarray(m).convert("RGB").save(f"{prefix}-mask.png")
    print(W, a.shape[0])
elif cmd == "merge":
    prefix, inp, out = sys.argv[2], sys.argv[3], sys.argv[4]
    r = np.array(Image.open(f"{prefix}-rolled.png").convert("RGBA"))
    m = np.array(Image.open(f"{prefix}-mask.png").convert("L")) > 127
    p = np.array(Image.open(inp).convert("RGBA"))
    if p.shape != r.shape:
        p = np.array(Image.fromarray(p).resize((r.shape[1], r.shape[0]), Image.NEAREST))
    o = r.copy()
    o[m] = p[m]
    Image.fromarray(o).save(out)
