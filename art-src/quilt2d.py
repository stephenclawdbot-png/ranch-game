"""Seamless square tile by min-cut quilting in x then y (pixels never blended).
  python3 -I art-src/quilt2d.py <in.png> <out.png> <size>
Input must be larger than <size>; overlap = in_size - size on each axis."""
import sys
import numpy as np
from PIL import Image


def quilt_x(A, K):
    H, W = A.shape[:2]
    L, R = A[:, W - K :].astype(int), A[:, :K].astype(int)
    e = np.abs(L[..., :3] - R[..., :3]).sum(-1).astype(float)
    C = e.copy()
    for y in range(1, H):
        p = C[y - 1]
        C[y] += np.minimum(p, np.minimum(np.r_[np.inf, p[:-1]], np.r_[p[1:], np.inf]))
    seam = np.zeros(H, int)
    seam[-1] = int(np.argmin(C[-1]))
    for y in range(H - 2, -1, -1):
        c = seam[y + 1]
        lo, hi = max(0, c - 1), min(K, c + 2)
        seam[y] = lo + int(np.argmin(C[y, lo:hi]))
    comp = A[:, :K].copy()
    for y in range(H):
        comp[y, : seam[y]] = A[y, W - K : W - K + seam[y]]
    return np.concatenate([comp, A[:, K : W - K]], axis=1), C[-1].min() / H


src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
A = np.array(Image.open(src).convert("RGBA"))
A[..., 3] = 255
A, cx = quilt_x(A, A.shape[1] - size)
T, cy = quilt_x(A.transpose(1, 0, 2), A.shape[0] - size)
T = T.transpose(1, 0, 2)
Image.fromarray(T.astype(np.uint8)).save(out, optimize=True)
print(out, T.shape[:2], "seam cost/px x=%.1f y=%.1f" % (cx, cy))
