"""Finishes the racecourse scenery art from the raw PixelLab generations
(art-src/course/raw, made by gen-course.mjs) into apps/web/public/art/course/:

  python3 -I art-src/course/finish-course.py && node art-src/build-manifest.mjs \
    && node apps/web/scripts/art-index.mjs

Far layers (one per scenery):
- crop the clean band of the generation (the "landscape in the bottom half" prompt sometimes
  draws a second, hazier copy of the scene; we keep the crisp one),
- cut the flat cream sky to transparency column by column from the top (or a hard cut at a
  sea horizon), binary alpha,
- mirror-tile to twice the width (horizontally seamless, like race/far-hills.png); on the
  coast the mirrored lighthouse is painted out so the panorama shows a single one.
Sprites (midground, rail decor, grandstands): binary alpha, trimmed to their bounding box,
bottom = ground line.
Writes art-src/meta/course/<name>.meta.json and appends/refreshes the course entries in
art-src/assets.json (the manifest registry).
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/course/raw")
OUT = Path("apps/web/public/art/course")
META = Path("art-src/meta/course")
OUT.mkdir(parents=True, exist_ok=True)
META.mkdir(parents=True, exist_ok=True)


def load(name):
    return np.array(Image.open(RAW / name).convert("RGBA"))


def prompt_of(name):
    stem = name.rsplit("-", 1)[0]
    d = json.loads((RAW / f"{stem}.json").read_text())
    return f"{d['endpoint']}: {d['request']['description']}"


def binary(a):
    a = a.copy()
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    a[a[..., 3] == 0] = 0
    return a


def trim(a):
    ys, xs = np.nonzero(a[..., 3])
    return a[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def cut_sky(a, thr, haze=()):
    """Flood-fill the flat sky from the top row (4-connected, colour distance < thr) to transparency,
    then drop anything left floating (not connected to the bottom row)."""
    from collections import deque

    sky = np.median(a[:3, :, :3].reshape(-1, 3), axis=0)
    dist = np.abs(a[..., :3].astype(int) - sky).sum(-1)
    for h in haze:  # flat haze / glow bands the generation painted over the sky: treat them as sky
        hd = np.abs(a[..., :3].astype(int) - np.array(h)).sum(-1)
        dist = np.where(hd < 12, 0, dist)
    H, W = dist.shape
    seen = np.zeros((H, W), bool)
    q = deque((0, x) for x in range(W) if dist[0, x] < thr)
    for _, x in q:
        seen[0, x] = True
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and not seen[ny, nx] and dist[ny, nx] < thr:
                seen[ny, nx] = True
                q.append((ny, nx))
    out = a.copy()
    out[seen] = 0
    # drop floating islands (haze left between the hills): keep what touches the bottom row
    keep = np.zeros((H, W), bool)
    q = deque((H - 1, x) for x in range(W) if not seen[H - 1, x])
    for y, x in q:
        keep[y, x] = True
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and not keep[ny, nx] and not seen[ny, nx]:
                keep[ny, nx] = True
                q.append((ny, nx))
    out[~keep] = 0
    return out


ENTRIES = []


def save(a, name, src, kind, band, tier, post, variants=()):
    Image.fromarray(a.astype(np.uint8)).save(OUT / f"{name}.png", optimize=True)
    meta = {"source": f"course/raw/{src}", "anchor": {"x": 0.5, "y": 1}, "post": post}
    (META / f"{name}.meta.json").write_text(json.dumps(meta, indent=1))
    ENTRIES.append(
        {
            "id": f"course.{name}",
            "kind": kind,
            "depthBand": band,
            "src": f"course/{name}.png",
            "optimizationTier": tier,
            "sourcePrompt": f"{prompt_of(src)} | post: {post}",
            "anchor": {"x": 0.5, "y": 1},
            "variants": list(variants),
        }
    )
    print(name, a.shape[1], "x", a.shape[0])


# --- far layers ---------------------------------------------------------------------------
FAR = {
    # name: (raw, first row, last row (excl.), sky threshold or None for a hard horizon cut)
    "far-downs": ("far-downs-0.png", 66, 224, 90),
    "far-coast": ("far-coast-noref-0.png", 113, 224, None),
    "far-city": ("far-city-noref-0.png", 0, 127, 40),
    "far-meadow": ("far-meadow-noref-0.png", 92, 224, 60),
    "far-moor": ("far-moor-noref-0.png", 0, 103, 60),
}
# flat colour bands (distant haze, a sunset glow) painted behind the moor's hills
HAZE = {"far-moor": ((191, 172, 161), (244, 205, 150), (219, 182, 139))}
for name, (raw, y0, y1, thr) in FAR.items():
    a = load(raw)[y0:y1]
    a[..., 3] = 255
    if thr is not None:
        a = cut_sky(a, thr, HAZE.get(name, ()))
    a = binary(a)
    flip = a[:, ::-1].copy()
    if name == "far-coast":
        # paint out the mirrored lighthouse (raw x 124..152, rows 0..34 of the crop) with the sea
        # and headland beside it, so the panorama has one lighthouse
        W = a.shape[1]
        x0, x1 = W - 153, W - 123
        flip[0:36, x0:x1] = flip[0:36, x0 - 32 : x1 - 32]
    a = np.concatenate([a, flip], axis=1)
    rows = np.nonzero(a[..., 3].max(1))[0]
    a = a[rows.min() :]
    post = ("hard cut at the sea horizon" if thr is None else "sky cut to alpha") + ", mirror-tiled (seamless x)"
    save(a, name, raw, "track_layer", "far", "background", post, ("seamless-x",))

# --- sprites -------------------------------------------------------------------------------
SPRITES = {
    "mid-hawthorn": ("mid-hawthorn-0.png", "prop", "far"),
    "mid-gorse": ("mid-gorse-0.png", "prop", "far"),
    "mid-dunes": ("mid-dunes-0.png", "prop", "far"),
    "mid-huts": ("mid-huts-0.png", "prop", "far"),
    "mid-terrace": ("mid-terrace-0.png", "building", "far"),
    "mid-lamp": ("mid-lamp-0.png", "prop", "far"),
    "mid-willow": ("mid-willow-0.png", "prop", "far"),
    "mid-flowers": ("mid-flowers-0.png", "prop", "far"),
    "mid-wall": ("mid-wall-0.png", "prop", "mid"),
    "mid-heather": ("mid-heather-0.png", "prop", "far"),
    "mid-rowan": ("mid-rowan-0.png", "prop", "far"),
    "rail-boards": ("rail-boards-0.png", "prop", "mid"),
    "stand-downs": ("stand-downs-0.png", "building", "mid"),
    "stand-coast": ("stand-coast-0.png", "building", "mid"),
    "stand-city": ("stand-city-0.png", "building", "mid"),
    "stand-meadow": ("stand-meadow-0.png", "building", "mid"),
    "stand-moor": ("stand-moor-0.png", "building", "mid"),
}
for name, (raw, kind, band) in SPRITES.items():
    a = binary(load(raw))
    if name == "mid-dunes":
        # the generation draws a bright ground line under the dune: drop the bottom white rows
        lum = a[..., :3].astype(int).sum(-1)
        for y in range(a.shape[0] - 1, 0, -1):
            row = a[y]
            op = row[..., 3] > 0
            if op.sum() and (lum[y][op] > 600).mean() > 0.5:
                a[y] = 0
            elif op.sum():
                break
    save(trim(a), name, raw, kind, band, "standard", "binary alpha, trimmed (bottom = ground line)")

# --- registry ------------------------------------------------------------------------------
reg_path = Path("art-src/assets.json")
reg = json.loads(reg_path.read_text())
reg = [e for e in reg if not e["id"].startswith("course.")] + ENTRIES
reg_path.write_text(json.dumps(reg, indent=1))
print(len(ENTRIES), "course entries registered")
