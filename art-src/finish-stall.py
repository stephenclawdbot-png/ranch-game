"""Finishes the Trackside starting-stall art from the raw PixelLab generation
(art-src/race/raw/stall-bay-b-0.png):

  python3 -I art-src/finish-stall.py

- hard binary alpha (no semi-transparent texels; the viewer restacks layers)
- palette snap (median-cut, <= 24 colours, no dithering)
- shortens the bay: the tall empty truss interior is removed so the shell is ~2.1 m
  tall and reads as a stall around the horse, not a scaffold above it
- splits the sprite into the layers the viewer draws at different depths:
    starting-stall.png        frame only (front post + gate columns transparent)  [behind horse]
    starting-stall-front.png  front post crop                                     [in front, static]
    starting-stall-door.png   front gate crop                                     [in front, swings open]
  The frame's right wheel stays with the frame (a masked region, not a column cut)
  so nothing of the wheel squishes when the gate swings.
- writes art-src/meta/race/starting-stall*.meta.json with anchors; the door-plane
  fraction lives as a constant in packages/race-viewer/src/trackside/gate.ts
  (kept in sync by hand).

All rectangles below are measured on the trimmed sprite (bbox printout at run time).
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/race/raw/stall-bay-b-0.png")
OUT = Path("apps/web/public/art/race")
META = Path("art-src/meta/race")

POST_L, POST_R = 256, 266  # front (right) post columns, raw image px
DOOR_L, DOOR_R = 267, 317  # front gate columns, raw image px
WHEEL_X1 = 277             # the frame's right wheel reaches this far, raw px
WHEEL_TOP = 220            # wheel occupies raw rows below this
CUT_Y0, CUT_Y1 = 72, 112   # open interior band, removed to shorten the bay (trimmed rows)
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
x0 = xs.min()
a = a[ys.min() : ys.max() + 1, x0 : xs.max() + 1]  # trim, no pad: bottoms sit on the ground line
a = np.concatenate([a[:CUT_Y0], a[CUT_Y1:]], axis=0)  # shorten the open interior
H, W = a.shape[:2]
cut = CUT_Y1 - CUT_Y0
print("finished", W, "x", H, f"(cut {cut} rows at y={CUT_Y0})")
pl, pr, dl, dr = POST_L - x0, POST_R - x0, DOOR_L - x0, DOOR_R - x0
wx, wt = WHEEL_X1 - x0, WHEEL_TOP - ys.min() - cut

post, _ = tight(a[:, pl:pr].copy())
door = a[:, dl:dr].copy()
door[wt:, : wx - dl] = 0  # the wheel edge stays with the frame
door, dy = tight(door, axis="y")

frame = a.copy()
frame[:, pl:pr] = 0
frame[:, dl:dr] = 0
frame[wt:, dl:wx] = a[wt:, dl:wx]  # ... except the wheel edge

# Anchor: the front-door plane (left edge of the gate = right edge of the post) / bottom.
plane = dl
geom = {"anchor": {"x": round(plane / W, 4), "y": 1}}
save(frame, "starting-stall", source="race/stall-bay-b", **geom)
save(post, "starting-stall-front", source="race/stall-bay-b", anchor={"x": 1, "y": 1})
save(door, "starting-stall-door", source="race/stall-bay-b", anchor={"x": 0, "y": 1})
