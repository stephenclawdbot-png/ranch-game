"""Make a strip horizontally seamless by min-cut quilting its two ends (no blending, pixels stay pixels).
  python3 -I art-src/quilt.py <in.png> <out.png> <overlap> [cropL cropR]
The last `overlap` columns are laid over the first `overlap` columns; a minimum-error vertical
seam (dynamic programming) picks, per row, where the end hands over to the start. Output width
= W - overlap and tiles perfectly.
"""
import sys
import numpy as np
from PIL import Image

src, out, K = sys.argv[1], sys.argv[2], int(sys.argv[3])
A = np.array(Image.open(src).convert("RGBA")).astype(int)
if len(sys.argv) > 5:
    A = A[:, int(sys.argv[4]) : A.shape[1] - int(sys.argv[5])]
H, W = A.shape[:2]
L, R = A[:, W - K :], A[:, :K]
e = np.abs(L[..., :3] - R[..., :3]).sum(-1) * ((L[..., 3] > 0) | (R[..., 3] > 0)) + np.abs(L[..., 3] - R[..., 3])
# cumulative min-path cost, seam may move by 1 column per row
C = e.astype(float).copy()
for y in range(1, H):
    prev = C[y - 1]
    best = np.minimum(prev, np.minimum(np.r_[np.inf, prev[:-1]], np.r_[prev[1:], np.inf]))
    C[y] += best
seam = np.zeros(H, int)
seam[-1] = int(np.argmin(C[-1]))
for y in range(H - 2, -1, -1):
    c = seam[y + 1]
    lo, hi = max(0, c - 1), min(K, c + 2)
    seam[y] = lo + int(np.argmin(C[y, lo:hi]))
comp = R.copy()
for y in range(H):
    comp[y, : seam[y]] = L[y, : seam[y]]
T = np.concatenate([comp, A[:, K : W - K]], axis=1).astype(np.uint8)
Image.fromarray(T).save(out)
print(out, T.shape[1], "x", H, "seam cost/row %.1f" % (C[-1].min() / H))
