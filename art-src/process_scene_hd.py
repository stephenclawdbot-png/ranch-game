"""HD v2 race-scene drop (about 2x the v1 density). Overwrites the v1 files in
apps/web/public/art/race/ (same stems, so the viewer picks them up unchanged).

  python3 -I art-src/process_scene_hd.py

Seamless strips come from art-src/quilt.py (min-cut, no blending); ground tiles from
flatten.py + quilt2d.py (see STATUS.md); far hills are sky-cut and mirror-tiled.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/raw")
OUT = Path("apps/web/public/art/race")
META = Path("art-src/meta/race")
META.mkdir(parents=True, exist_ok=True)


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def clean_alpha(a):
    a = a.copy()
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    a[a[..., 3] == 0] = 0
    return a


def trim(a, pad=1):
    ys, xs = np.nonzero(a[..., 3])
    return a[max(0, ys.min() - pad) : ys.max() + 1, max(0, xs.min() - pad) : xs.max() + 1 + pad]


def save(a, name, **meta):
    Image.fromarray(a.astype(np.uint8)).save(OUT / f"{name}.png", optimize=True)
    (META / f"{name}.meta.json").write_text(json.dumps({"hd": True, **meta}, indent=1))
    print(name, a.shape[1], "x", a.shape[0])


for s in ("clear", "dusk", "overcast"):
    a = load(RAW / f"scene/hd-sky-{s}-0.png")
    a[..., 3] = 255
    save(a, f"sky-{s}", source=f"scene/hd-sky-{s}")

# far hills: cut the flat cream sky (column flood from the top), crop, mirror-tile
h = load(RAW / "scene/hd-far-hills-3-0.png")
sky = h[3, 3, :3].astype(int)
dist = np.abs(h[..., :3].astype(int) - sky).sum(-1)
H, W = h.shape[:2]
for x in range(W):
    y = 0
    while y < H and dist[y, x] < 26:
        h[y, x] = 0
        y += 1
top = np.nonzero(h[..., 3].max(1))[0].min()
h = h[top:]
save(np.concatenate([h, h[:, ::-1]], axis=1), "far-hills", source="scene/hd-far-hills-3", seamless="x (mirror)")

# seamless strips
crowd = clean_alpha(load(RAW / "seam/hd-crowd-quilt.png"))
save(crowd, "crowd", source="scene/hd-crowd-a", seamless="x (quilt)")
rail = clean_alpha(load(RAW / "seam/hd-rail-quilt.png"))
save(rail, "rail-near", source="scene/hd-rail", seamless="x (quilt)")
save(rail, "rail-far", source="scene/hd-rail", seamless="x (quilt)")
save(clean_alpha(load(RAW / "seam/hd-hedge-quilt.png")), "hedge-near", source="scene/hd-hedge", seamless="x (quilt)")

for name, tex in (("track-turf", "tex-turf"), ("track-dirt", "tex-dirt")):
    t = load(OUT / f"{tex}.png")
    strip = np.concatenate([t, t], axis=1)[:96]
    strip[:3, :, :3] = (strip[:3, :, :3] * 0.7).astype(np.uint8)
    save(strip, name, source=tex, seamless="x")

BB = {
    "bb-tree-oak": "scene/hd-oak-clean-0.png",
    "bb-tree-oak-b": "scene/hd-oak-b-clean-0.png",
    "bb-tree-poplar": "scene/hd-poplar-0.png",
    "bb-bush": "scene/hd-bush-5.png",
    "bb-bush-b": "scene/hd-bush-3.png",
    "bb-crowd-a": "scene/hd-crowd-a-0.png",
    "bb-crowd-b": "scene/hd-crowd-b-0.png",
    "bb-grandstand": "scene/hd-grandstand-0.png",
    "grandstand": "scene/hd-grandstand-0.png",
    "finish-post": "scene/hd-finish-post-clean-0.png",
    "furlong-pole": "scene/hd-furlong-pole-1.png",
    "starting-gate": "scene/hd-starting-gate-0.png",
}
for name, src in BB.items():
    save(trim(clean_alpha(load(RAW / src))), name, source=src.rsplit("-", 1)[0])

# flag: 8-frame wave, pole pinned to frame 0
frames = [clean_alpha(load(RAW / f"scene/hd-flag-wave-{i}.png")) for i in range(8)]
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
save(np.concatenate(crop, axis=1), "bb-flag", frameCount=8, fps=8,
     anchor={"x": round(float((pole_cols.mean() - xs.min() + 0.5) / fw), 3), "y": 1}, source="scene/hd-flag-wave")
