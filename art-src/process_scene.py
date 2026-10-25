"""Assemble the race-scene drop from raw PixelLab outputs into apps/web/public/art/race/.

  python3 -I art-src/process_scene.py

Picks the chosen candidates, trims billboards to their bounding box (bottom-centre = ground),
makes strips seamless (see quilt.py / seamless.py for how the *-seamless sources were made),
cuts the far-hills sky, fixes the flag pole across frames, and writes <name>.meta.json
sidecars used by build-manifest.mjs.
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/raw")
OUT = Path("apps/web/public/art/race")
OUT.mkdir(parents=True, exist_ok=True)
Path("art-src/meta/race").mkdir(parents=True, exist_ok=True)


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def save(a, name, **meta):
    Image.fromarray(a.astype(np.uint8)).save(OUT / f"{name}.png", optimize=True)
    if meta:
        (Path("art-src/meta/race") / f"{name}.meta.json").write_text(json.dumps(meta, indent=1))
    print(name, a.shape[1], "x", a.shape[0])


def trim(a, pad=1):
    ys, xs = np.nonzero(a[..., 3])
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a = a[max(0, y0 - pad) : y1, max(0, x0 - pad) : x1 + pad]
    return a


def clean_alpha(a):
    a = a.copy()
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    a[a[..., 3] == 0] = 0
    return a


# --- skies (opaque backdrops) ------------------------------------------------------
for s in ("clear", "dusk", "overcast"):
    a = load(RAW / f"scene/sky-{s}-0.png")
    a[..., 3] = 255
    save(a, f"sky-{s}")

# --- far hills: mirror-tile (lighting gradient makes a cut seam visible), cut the sky -----
h = load(RAW / "scene/far-hills-opaque-0.png")
sky = h[2, 2, :3].astype(int)
H, W = h.shape[:2]
dist = np.abs(h[..., :3].astype(int) - sky).sum(-1)
mask = np.zeros((H, W), bool)
for x in range(W):
    for y in range(H):
        if dist[y, x] < 30:
            mask[y, x] = True
        else:
            break
h[mask] = 0
hills = np.concatenate([h, h[:, ::-1]], axis=1)
save(hills[np.nonzero(hills[..., 3].max(1))[0].min() :], "far-hills")

# --- tileable strips ------------------------------------------------------------------
save(clean_alpha(load(RAW / "seam/crowd-seamless.png")), "crowd")
rail = clean_alpha(load(RAW / "seam/rail-seamless.png"))
save(rail, "rail-near")
save(rail, "rail-far")
save(clean_alpha(load(RAW / "seam/hedge-quilt.png")), "hedge-near")

# --- ground tiles (top-down, 64x64, seamless) --------------------------------------------
TILES = {
    "tex-turf": "scene/tiles2-tile_5.png",
    "tex-dirt": "scene/tiles-tile_5.png",
    "tex-grass": "scene/tiles-tile_9.png",
    "tex-gravel": "scene/tiles-tile_12.png",
    "tex-hedge": "scene/tiles2-tile_13.png",
}
for name, src in TILES.items():
    a = load(RAW / src)
    a[..., 3] = 255
    save(a, name)

# 2D fallback track strips: tiled from the textures (seamless by construction)
for name, tex in (("track-turf", "tex-turf"), ("track-dirt", "tex-dirt")):
    t = load(OUT / f"{tex}.png")
    strip = np.concatenate([t, t], axis=1)[:48]
    # darker 2px lip along the far edge so the band reads as a surface
    strip[:2, :, :3] = (strip[:2, :, :3] * 0.7).astype(np.uint8)
    save(strip, name)

# --- billboards -------------------------------------------------------------------------
BB = {
    "bb-tree-oak": "scene/bb-tree-oak-0.png",
    "bb-tree-oak-b": "scene/bb-tree-oak-2.png",
    "bb-tree-poplar": "scene/bb-tree-poplar-3.png",
    "bb-bush": "scene/bb-bush-7.png",
    "bb-bush-b": "scene/bb-bush-15.png",
    "bb-crowd-a": "scene/bb-crowd-a-0.png",
    "bb-crowd-b": "scene/bb-crowd-b-0.png",
    "bb-grandstand": "scene/bb-grandstand-0.png",
    "finish-post": "scene/finish-post-clean-0.png",
    "furlong-pole": "scene/furlong-pole-clean-0.png",
    "starting-gate": "scene/starting-gate-0.png",
}
for name, src in BB.items():
    save(trim(clean_alpha(load(RAW / src))), name)
shutil.copy(OUT / "bb-grandstand.png", OUT / "grandstand.png")

# --- flag: 8-frame wave, pole pinned to frame 0 -------------------------------------------
frames = [clean_alpha(load(RAW / f"scene/flag-wave-{i}.png")) for i in range(8)]
f0 = frames[0]
counts = (f0[..., 3] > 0).sum(0)
pole_cols = np.nonzero(counts > 0.5 * counts.max())[0]
x1 = pole_cols.max() + 1
for f in frames[1:]:
    f[:, :x1] = f0[:, :x1]
union = np.zeros(f0.shape[:2], bool)
for f in frames:
    union |= f[..., 3] > 0
ys, xs = np.nonzero(union)
crop = [f[ys.min() : ys.max() + 1, xs.min() : xs.max() + 2] for f in frames]
fw = crop[0].shape[1]
pole_x = (pole_cols.mean() - xs.min() + 0.5) / fw
save(np.concatenate(crop, axis=1), "bb-flag", frameCount=8, fps=8, anchor={"x": round(float(pole_x), 3), "y": 1})
