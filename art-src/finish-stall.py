"""Finishes the Trackside starting-stall art from the raw PixelLab generation
(art-src/race/raw/stall-bay-b-0.png):

  python3 -I art-src/finish-stall.py

- hard binary alpha (no semi-transparent texels; the viewer restacks layers)
- palette snap (median-cut, <= 24 colours, no dithering)
- rebuilds the bay LOW and OPEN: the tall truss and the number board are cut off
  (the truss bottom rail becomes the top rail at roughly jockey-shoulder height,
  ~1.4 m), and the solid padded side boarding is removed so the horse in the bay
  behind stays visible; the side is now posts + top rail + bars + a low rail +
  the base beam on wheels. The padded front gate slab is kept (its own layer).
- splits the sprite into the layers the viewer draws at different depths:
    starting-stall.png        frame only (front post + gate columns transparent)  [behind horse]
    starting-stall-front.png  front post crop                                     [in front, static]
    starting-stall-door.png   front gate crop                                     [in front, swings open]
  The frame's right wheel stays with the frame (a masked region, not a column cut)
  so nothing of the wheel squishes when the gate swings.
- writes art-src/meta/race/starting-stall*.meta.json with anchors; the door-plane
  fraction lives as a constant in packages/race-viewer/src/trackside/gate.ts
  (kept in sync by hand).

Row bands below are measured on the raw generation; the rebuilt sprite keeps the
trimmed width (266 px) and the ground line, so the viewer constants are unchanged.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/race/raw/stall-bay-b-0.png")
OUT = Path("apps/web/public/art/race")
META = Path("art-src/meta/race")

# Column split, raw image px (unchanged from the original finish).
POST_L, POST_R = 256, 266  # front (right) post columns
DOOR_L, DOOR_R = 267, 317  # front gate columns
WHEEL_X1 = 277             # the frame's right wheel reaches this far, raw px

# Row bands copied from the raw generation into the rebuilt bay: (canvas top, raw
# first row, raw last row). The truss/number board (raw rows < 66) is dropped; the
# truss bottom rail + its padding tabs (66..75) become the top rail; the open band
# keeps just the posts; rail + hanging bars (124..145) sit at mid height; the solid
# side boarding (146..201) is dropped — the base beam and wheels keep the bottom.
BANDS = [(0, 66, 75), (10, 90, 123), (44, 124, 145), (86, 202, 217), (102, 218, 244)]
CANVAS_H = max(ct + (r1 - r0 + 1) for ct, r0, r1 in BANDS)

# The gap between the bars and the base is refilled per region: the posts carry on
# (a strip from the open band), the paddock interior gets a low rail (a copy of the
# rail strip), and the front gate columns keep the top of their padded slab.
GAP_TOP, GAP_BOT = 66, 85      # canvas rows
POST_STRIP_RAW = (100, 119)    # raw rows of plain post
LOW_RAIL_RAW = (120, 126)      # raw rows of the horizontal rail strip
LOW_RAIL_AT = 73               # canvas row the low rail lands on
DOOR_PAD_RAW = (146, 165)      # raw rows of the gate slab's padded top
WHEEL_TOP = 102                # canvas row where the wheels band starts
PALETTE = 24


def clean_alpha(a):
    a = a.copy()
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    a[a[..., 3] == 0] = 0
    return a


def snap_palette(a, n=PALETTE):
    """Median-cut quantize the opaque pixels; alpha stays binary."""
    rgb = Image.fromarray(a[..., :3].astype(np.uint8)).quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    b = np.dstack([np.array(rgb.convert("RGB")), a[..., 3]])
    b[b[..., 3] == 0] = 0
    return b


def tight(a, axis=None):
    ys, xs = np.nonzero(a[..., 3])
    if axis == "y":
        return a[ys.min() :], ys.min()
    return a[ys.min() :, xs.min() :], (ys.min(), xs.min())


def save(a, name, **meta):
    Image.fromarray(a.astype(np.uint8)).save(OUT / f"{name}.png", optimize=True)
    (META / f"{name}.meta.json").write_text(json.dumps(meta, indent=1))
    print(name, a.shape[1], "x", a.shape[0])


a = snap_palette(clean_alpha(np.array(Image.open(RAW).convert("RGBA"))))
ys, xs = np.nonzero(a[..., 3])
y0, x0 = ys.min(), xs.min()
a = a[ys.min() : ys.max() + 1, x0 : xs.max() + 1]  # trim, no pad: bottoms sit on the ground line
W = a.shape[1]

def row(y):  # trimmed row index for a raw row
    return y - y0

bay = np.zeros((CANVAS_H, W, 4), dtype=np.uint8)
for ct, r0, r1 in BANDS:
    bay[ct : ct + (r1 - r0 + 1)] = a[row(r0) : row(r1) + 1]
pl, pr, dl, dr = POST_L - x0, POST_R - x0, DOOR_L - x0, DOOR_R - x0
wx = WHEEL_X1 - x0
lp = (56 - x0, 74 - x0 + 1)  # rear (left) post columns, trimmed rel
strip = a[row(POST_STRIP_RAW[0]) : row(POST_STRIP_RAW[1]) + 1]
bay[GAP_TOP : GAP_BOT + 1, lp[0] : lp[1]] = strip[:, lp[0] : lp[1]]
bay[GAP_TOP : GAP_BOT + 1, pl:pr] = strip[:, pl:pr]
rail = a[row(LOW_RAIL_RAW[0]) : row(LOW_RAIL_RAW[1]) + 1]
bay[LOW_RAIL_AT : LOW_RAIL_AT + rail.shape[0], :dl] = rail[:, :dl]
bay[GAP_TOP : GAP_BOT + 1, dl:] = a[row(DOOR_PAD_RAW[0]) : row(DOOR_PAD_RAW[1]) + 1, dl:]
print("rebuilt bay", W, "x", CANVAS_H)

post, _ = tight(bay[:, pl:pr].copy())
door = bay[:, dl:dr].copy()
door[WHEEL_TOP:, : wx - dl] = 0  # the wheel edge stays with the frame
door, dy = tight(door, axis="y")

frame = bay.copy()
frame[:, pl:pr] = 0
frame[:, dl:dr] = 0
frame[WHEEL_TOP:, dl:wx] = bay[WHEEL_TOP:, dl:wx]  # ... except the wheel edge

# Anchor: the front-door plane (left edge of the gate = right edge of the post) / bottom.
plane = dl
geom = {"anchor": {"x": round(plane / W, 4), "y": 1}}
save(frame, "starting-stall", source="race/stall-bay-b", **geom)
save(post, "starting-stall-front", source="race/stall-bay-b", anchor={"x": 1, "y": 1})
save(door, "starting-stall-door", source="race/stall-bay-b", anchor={"x": 0, "y": 1})
