"""Animated 3/4 portraits: the PixelLab idle loops (anim-portrait-<coat>, gen-diorama.mjs) finished
into served strips the HorsePortrait component plays like a gif.

  python3 -I art-src/portrait_anims.py

Per coat:
  * every frame snapped onto the ORIGINAL portrait's palette (no colour drift between frames)
  * aligned to the original by the alpha centroid (no jitter)
  * frames that drift too far from the original (head turned, recoloured) are dropped
  * ping-pong order (0..n..1) so the loop is seamless
Outputs apps/web/public/art/portraits/anim/horse-<coat>.png (128 px frames) and
anim/thumb/horse-<coat>.png (exact 2:1 box downsample), plus anim/index.json (frame counts).
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/diorama/raw")
SRC = Path("apps/web/public/art/portraits")
OUT = SRC / "anim"
(OUT / "thumb").mkdir(parents=True, exist_ok=True)
COATS = ["bay", "black", "buckskin", "chestnut", "dapple_grey", "dark_bay", "grey", "liver_chestnut", "palomino", "roan"]
MAX_DRIFT = 22.0  # mean |rgb| difference over the head vs the original; above = a different pose/colour


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def snap(frame, pal):
    out = np.zeros_like(frame)
    a = frame[..., 3] >= 128
    px = frame[a][:, :3].astype(float)
    idx = np.empty(len(px), int)
    for i in range(0, len(px), 4096):
        d = ((px[i : i + 4096, None, :] - pal[None]) ** 2).sum(-1)
        idx[i : i + 4096] = d.argmin(1)
    out[a, :3] = pal[idx].astype(np.uint8)
    out[a, 3] = 255
    return out


def centroid(a):
    ys, xs = np.nonzero(a[..., 3])
    return ys.mean(), xs.mean()


def shift(a, dy, dx):
    out = np.zeros_like(a)
    H, W = a.shape[:2]
    ys, yd = (slice(max(0, -dy), H - max(0, dy)), slice(max(0, dy), H - max(0, -dy)))
    xs, xd = (slice(max(0, -dx), W - max(0, dx)), slice(max(0, dx), W - max(0, -dx)))
    out[yd, xd] = a[ys, xs]
    return out


def down2(a):
    H, W = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    blk = a[:H, :W].astype(float).reshape(H // 2, 2, W // 2, 2, 4)
    alpha = blk[..., 3].mean((1, 3))
    w = blk[..., 3:4] / 255.0
    rgb = (blk[..., :3] * w).sum((1, 3)) / np.maximum(w.sum((1, 3)), 1e-6)
    out = np.zeros((H // 2, W // 2, 4), np.uint8)
    out[..., :3] = np.round(rgb).astype(np.uint8)
    out[..., 3] = np.where(alpha >= 128, 255, 0)
    return out


index = {}
for coat in COATS:
    orig = load(SRC / f"horse-{coat}.png")
    pal = np.unique(orig[orig[..., 3] > 0][:, :3], axis=0).astype(float)
    cy, cx = centroid(orig)
    mask = orig[..., 3] > 0
    kept = [orig]
    for i in range(1, 9):
        p = RAW / f"anim-portrait-{coat}-{i}.png"
        if not p.exists():
            continue
        f = snap(load(p), pal)
        fy, fx = centroid(f)
        f = shift(f, int(round(cy - fy)), int(round(cx - fx)))
        both = mask & (f[..., 3] > 0)
        drift = np.abs(f[both][:, :3].astype(float) - orig[both][:, :3].astype(float)).mean() if both.any() else 999
        overlap = both.sum() / max(1, mask.sum())
        if drift <= MAX_DRIFT and overlap >= 0.9:
            kept.append(f)
    seq = kept + kept[-2:0:-1] if len(kept) > 2 else kept
    strip = np.concatenate(seq, axis=1)
    Image.fromarray(strip).save(OUT / f"horse-{coat}.png", optimize=True)
    Image.fromarray(np.concatenate([down2(f) for f in seq], axis=1)).save(OUT / "thumb" / f"horse-{coat}.png", optimize=True)
    index[coat] = {"frames": len(seq), "kept": len(kept), "size": int(orig.shape[1])}
    print(f"{coat:16s} kept {len(kept)}/9 -> {len(seq)} frames")
(OUT / "index.json").write_text(json.dumps(index, indent=1))
