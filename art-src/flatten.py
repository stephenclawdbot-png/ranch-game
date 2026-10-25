"""Remove low-frequency lighting gradients from a texture (so it tiles without visible
blocks), then snap every pixel back onto the image's own palette.
  python3 -I art-src/flatten.py <in.png> <out.png> [radius=24] [strength=1.0]"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
rad = int(sys.argv[3]) if len(sys.argv) > 3 else 24
k = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
im = Image.open(src).convert("RGB")
a = np.array(im).astype(float)
blur = np.array(im.filter(ImageFilter.BoxBlur(rad))).astype(float)
adj = a + k * (blur.reshape(-1, 3).mean(0) - blur)
pal = np.unique(a.reshape(-1, 3), axis=0)
flat = adj.reshape(-1, 3)
idx = np.empty(len(flat), int)
for i in range(0, len(flat), 4096):
    d = ((flat[i : i + 4096, None, :] - pal[None]) ** 2).sum(-1)
    idx[i : i + 4096] = d.argmin(1)
res = pal[idx].reshape(a.shape).astype(np.uint8)
Image.fromarray(res).save(out)
print(out, len(pal), "colours")
