"""Stitch the two animated crowd windows into race/crowd-cheer.png (seamless-x, 320x128 frames).

  python3 -I art-src/race/process_crowd.py <i,j,k,...> [--still-rail ROW]   (frame indices, in order)

Window A = crowd.png columns 0..255, window B = columns 160..319 then 0..95 (wrapped), both
animated by animate-with-text-v3 (art-src/race/raw/anims/anim-crowd-{A,B}-N.png). Per frame:
  x in [96,160)  -> A         x in [256,320) -> B
  x in [160,256) -> A | B split by a min-error vertical seam (A on the left)
  x in [0,96)    -> B | A split by a min-error vertical seam (B on the left)
Colours are snapped to crowd.png's own palette and alpha is made binary. With --still-rail
the white rail rows (and everything below it) are copied from crowd.png so the rail never
wobbles.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/race/raw/anims")
SRC = np.array(Image.open("apps/web/public/art/race/crowd.png").convert("RGBA")).astype(int)
H, W = SRC.shape[:2]


def seam_merge(L, R):
    """Left image L, right image R (same size): per row, columns < seam from L, rest from R."""
    e = np.abs(L[..., :3] - R[..., :3]).sum(-1) * ((L[..., 3] > 0) | (R[..., 3] > 0)) + np.abs(L[..., 3] - R[..., 3]) * 3
    h, k = e.shape
    C = e.astype(float).copy()
    for y in range(1, h):
        p = C[y - 1]
        C[y] += np.minimum(p, np.minimum(np.r_[np.inf, p[:-1]], np.r_[p[1:], np.inf]))
    seam = np.zeros(h, int)
    seam[-1] = int(np.argmin(C[-1]))
    for y in range(h - 2, -1, -1):
        c = seam[y + 1]
        lo, hi = max(0, c - 1), min(k, c + 2)
        seam[y] = lo + int(np.argmin(C[y, lo:hi]))
    out = R.copy()
    for y in range(h):
        out[y, : seam[y]] = L[y, : seam[y]]
    return out, C[-1].min() / h


def snap(img, pal):
    a = img[..., 3] >= 128
    px = img[a][:, :3]
    out = np.zeros_like(img)
    # chunked nearest-colour search
    res = np.zeros((len(px), 3), int)
    for i in range(0, len(px), 4096):
        d = ((px[i : i + 4096, None, :] - pal[None]) ** 2).sum(-1)
        res[i : i + 4096] = pal[d.argmin(1)]
    out[a, :3] = res
    out[a, 3] = 255
    return out


def main():
    order = [int(x) for x in sys.argv[1].split(",")]
    pal = np.unique(SRC[SRC[..., 3] > 0][:, :3], axis=0)
    rail_top = None
    if "--still-rail" in sys.argv:
        rail_top = int(sys.argv[sys.argv.index("--still-rail") + 1])
    frames = []
    costs = []
    for i in order:
        A = np.array(Image.open(RAW / f"anim-crowd-A-{i}.png").convert("RGBA")).astype(int)
        B = np.array(Image.open(RAW / f"anim-crowd-B-{i}.png").convert("RGBA")).astype(int)
        out = np.zeros((H, W, 4), int)
        out[:, 96:160] = A[:, 96:160]
        out[:, 256:320] = B[:, 96:160]
        o1, c1 = seam_merge(A[:, 160:256], B[:, 0:96])
        o2, c2 = seam_merge(B[:, 160:256], A[:, 0:96])
        out[:, 160:256] = o1
        out[:, 0:96] = o2
        out = snap(out, pal)
        if rail_top is not None:
            out[rail_top:] = SRC[rail_top:]
        frames.append(out.astype(np.uint8))
        costs.append((round(c1, 1), round(c2, 1)))
    strip = np.concatenate(frames, axis=1)
    Image.fromarray(strip).save("apps/web/public/art/race/crowd-cheer.png", optimize=True)
    print("crowd-cheer", len(frames), "frames, seam cost/row", costs)


if __name__ == "__main__":
    main()
