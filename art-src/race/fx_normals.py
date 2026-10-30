"""Normals for the small ground-fx strips, computed in code (PixelLab /normal-map does not do
anything useful on 2-6 px particles).

  python3 -I art-src/race/fx_normals.py fx-mud fx-dust fx-divot

Each opaque blob is inflated into a dome from its distance to the edge (height = sqrt of the
distance), and the height gradient becomes the normal. OpenGL convention like every other
race/*-normal.png: R = +x (right), G = +y (up), B = toward the viewer; alpha = sprite alpha.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ART = Path("apps/web/public/art/race")


def edge_distance(a):
    """Chamfer distance (in px) from each opaque pixel to the nearest transparent one."""
    big = 1e6
    d = np.where(a, big, 0.0)
    H, W = a.shape
    for _ in range(2):
        for y in range(H):
            for x in range(W):
                if d[y, x] == 0:
                    continue
                best = d[y, x]
                for dy, dx, c in ((-1, 0, 1), (0, -1, 1), (-1, -1, 1.41), (-1, 1, 1.41)):
                    yy, xx = y + dy, x + dx
                    v = d[yy, xx] if 0 <= yy < H and 0 <= xx < W else 0
                    best = min(best, v + c)
                d[y, x] = best
        d = d[::-1, ::-1]
    return d


def main():
    for name in sys.argv[1:]:
        im = np.array(Image.open(ART / f"{name}.png").convert("RGBA"))
        a = im[..., 3] > 0
        h = np.sqrt(edge_distance(a)) * 1.6
        gy, gx = np.gradient(h)
        nx, ny, nz = -gx, gy, np.ones_like(h)  # image y grows down -> flip for G = up
        n = np.sqrt(nx**2 + ny**2 + nz**2)
        out = np.zeros_like(im)
        out[..., 0] = np.round((nx / n * 0.5 + 0.5) * 255)
        out[..., 1] = np.round((ny / n * 0.5 + 0.5) * 255)
        out[..., 2] = np.round((nz / n * 0.5 + 0.5) * 255)
        out[..., 3] = np.where(a, 255, 0)
        out[~a, :3] = 0
        Image.fromarray(out.astype(np.uint8)).save(ART / f"{name}-normal.png", optimize=True)
        print(name, "normal", out.shape[1], "x", out.shape[0])


if __name__ == "__main__":
    main()
