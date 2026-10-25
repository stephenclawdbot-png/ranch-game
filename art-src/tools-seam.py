"""Seam metrics + 4x4 tiling preview.  python3 -I art-src/tools-seam.py out.png tile1.png tile2.png ..."""
import sys
import numpy as np
from PIL import Image


def seam(a):
    a = a[..., :3].astype(int)
    inner_x = np.abs(np.diff(a, axis=1)).mean()
    inner_y = np.abs(np.diff(a, axis=0)).mean()
    ex = np.abs(a[:, 0] - a[:, -1]).mean()
    ey = np.abs(a[0] - a[-1]).mean()
    return ex / inner_x, ey / inner_y


if __name__ == "__main__":
    out, files = sys.argv[1], sys.argv[2:]
    tiles = []
    for f in files:
        a = np.array(Image.open(f).convert("RGBA"))
        print(f, a.shape, "seam ratio x=%.2f y=%.2f (<=1.3 is invisible)" % seam(a))
        big = np.tile(a, (4, 4, 1))
        tiles.append(big)
    gap = np.zeros((tiles[0].shape[0], 8, 4), np.uint8)
    row = np.concatenate(sum([[t, gap] for t in tiles], [])[:-1], axis=1)
    Image.fromarray(row).resize((row.shape[1] * 2, row.shape[0] * 2), Image.NEAREST).save(out)
