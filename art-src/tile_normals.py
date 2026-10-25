"""Seamless normal maps for tiling ground textures (PixelLab's /normal-map does not wrap).
Height = smoothed luminance; gradients use wrap-around so the map tiles like the texture.
  python3 -I art-src/tile_normals.py <tex.png> <out-normal.png> [strength=2.0]
OpenGL convention (R = +x right, G = +y up, B = out of the surface)."""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
k = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
a = np.array(Image.open(src).convert("RGB")).astype(float) / 255
h = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
# light 3x3 wrap blur so single-pixel noise doesn't dominate
h = sum(np.roll(np.roll(h, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5  # image y grows downwards
n = np.dstack([-dx * k, dy * k, np.ones_like(h)])
n /= np.linalg.norm(n, axis=-1, keepdims=True)
rgb = ((n * 0.5 + 0.5) * 255).round().astype(np.uint8)
Image.fromarray(np.dstack([rgb, np.full(h.shape, 255, np.uint8)])).save(out, optimize=True)
print(out)
