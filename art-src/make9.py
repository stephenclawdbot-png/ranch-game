"""Turn a generated UI frame into a clean 9-slice image (regular edges, flat-tiled centre).

  python3 -I art-src/make9.py <in.png> <out.png> <top> <right> <bottom> <left> <outW> <outH>
         [--sample sx sy S] [--centre cx cy P] [--states]

The source is cropped to its alpha bbox. Corners are copied as drawn; each edge is rebuilt by
repeating an S-pixel run sampled `sx`/`sy` px past the corner (so edge ornaments vanish and
the edge stretches/tiles cleanly); the centre is a P×P patch tiled. Writes <out>.json with the
slice insets. --states also writes <out>-hover.png and <out>-pressed.png.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

args = sys.argv[1:]


def opt(name, n, default):
    if name in args:
        i = args.index(name)
        return [int(x) for x in args[i + 1 : i + 1 + n]]
    return default


src, out = args[0], args[1]
t, r, b, l, OW, OH = (int(x) for x in args[2:8])
sx, sy, S = opt("--sample", 3, [2, 2, 4])
cx, cy, P = opt("--centre", 3, [None, None, 8])

im = Image.open(src).convert("RGBA")
A = np.array(im.crop(im.getbbox()))
A[..., 3] = np.where(A[..., 3] > 127, 255, 0)
h, w = A.shape[:2]
O = np.zeros((OH, OW, 4), np.uint8)


def tile_h(seg, length):
    reps = -(-length // seg.shape[1])
    return np.tile(seg, (1, reps, 1))[:, :length]


def tile_v(seg, length):
    reps = -(-length // seg.shape[0])
    return np.tile(seg, (reps, 1, 1))[:length]


# corners
O[:t, :l] = A[:t, :l]
O[:t, OW - r :] = A[:t, w - r :]
O[OH - b :, :l] = A[h - b :, :l]
O[OH - b :, OW - r :] = A[h - b :, w - r :]
# edges
O[:t, l : OW - r] = tile_h(A[:t, l + sx : l + sx + S], OW - l - r)
O[OH - b :, l : OW - r] = tile_h(A[h - b :, l + sx : l + sx + S], OW - l - r)
O[t : OH - b, :l] = tile_v(A[t + sy : t + sy + S, :l], OH - t - b)
O[t : OH - b, OW - r :] = tile_v(A[t + sy : t + sy + S, w - r :], OH - t - b)
# centre
if cx is None:
    cx, cy = w // 2 - P // 2, h // 2 - P // 2
patch = A[cy : cy + P, cx : cx + P]
O[t : OH - b, l : OW - r] = tile_v(tile_h(patch, OW - l - r), OH - t - b)

Image.fromarray(O).save(out, optimize=True)
meta = {"slice": {"top": t, "right": r, "bottom": b, "left": l}, "width": OW, "height": OH}
Path(out).with_suffix(".json").write_text(json.dumps(meta, indent=1))  # collected into ui/ui.json by the UI batch
print(out, OW, "x", OH, meta["slice"])

if "--states" in args:
    def scale(a, f):
        o = a.copy()
        m = o[..., 3] > 0
        o[m, :3] = np.clip(o[m, :3].astype(float) * f, 0, 255).astype(np.uint8)
        return o

    hover = scale(O, 1.15)
    pressed = scale(O, 0.82)
    # pressed: content sinks 1px (keep the top outline row)
    pressed[2:-1] = pressed[1:-2].copy()
    base = Path(out)
    for name, a in (("hover", hover), ("pressed", pressed)):
        p = base.with_name(base.stem + f"-{name}.png")
        Image.fromarray(a).save(p, optimize=True)
        p.with_suffix(".json").write_text(json.dumps(meta, indent=1))
