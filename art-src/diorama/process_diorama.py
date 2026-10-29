"""Finish the raw PixelLab diorama generations into served layers + a generated atlas.

  python3 -I art-src/diorama/process_diorama.py

Inputs : art-src/diorama/raw/*.png (gen-diorama.mjs) + existing approved art.
Outputs: apps/web/public/art/diorama/*.png
         apps/web/src/components/diorama/atlas.generated.ts   (frame sizes, prop rects, doorway holes)
         art-src/diorama/meta.json                              (what each output came from)

Code passes (no resampling of the art ever, except exact 3:1 / 2:1 box downsamples that are
snapped back onto the source palette so the result is still hard-edged pixel art):
  * binary alpha + palette clamp (k-means-free: unique colours, capped by median-cut)
  * mirror tiling for strips that must repeat horizontally
  * doorway holes cut out of facades so animated heads sit "inside" the dark stall
  * prop sheets split into connected components -> atlas rects
  * animation frames aligned on a common baseline and packed into strips
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/diorama/raw")
OUT = Path("apps/web/public/art/diorama")
TS = Path("apps/web/src/components/diorama/atlas.generated.ts")
META = Path("art-src/diorama/meta.json")
OUT.mkdir(parents=True, exist_ok=True)
meta: dict = {}
atlas: dict = {"files": {}, "props": {}, "holes": {}, "anims": {}}


def load(p):
    return np.array(Image.open(p).convert("RGBA"))


def lum(a):
    return (a[..., 0].astype(int) * 299 + a[..., 1].astype(int) * 587 + a[..., 2].astype(int) * 114) // 1000


def clean(a):
    a = a.copy()
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    a[a[..., 3] == 0] = 0
    return a


def quantise(a, colours=96):
    """Clamp to at most `colours` colours (median cut, no dither) - keeps edges hard."""
    rgb = Image.fromarray(a[..., :3].astype(np.uint8))
    n = len(np.unique(a[a[..., 3] > 0][:, :3], axis=0))
    if n <= colours:
        return a
    q = np.array(rgb.quantize(colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB"))
    out = a.copy()
    out[..., :3] = q
    return out


def components(mask, min_px=1):
    H, W = mask.shape
    lab = np.zeros((H, W), int)
    n = 0
    boxes = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        ys, xs = [y0], [x0]
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
                    ys.append(yy)
                    xs.append(xx)
        if len(ys) >= min_px:
            boxes.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1, len(ys), n))
    return lab, boxes


def save(a, name, src, **extra):
    a = a.astype(np.uint8)
    Image.fromarray(a).save(OUT / f"{name}.png", optimize=True)
    atlas["files"][name] = {"w": int(a.shape[1]), "h": int(a.shape[0])}
    meta[name] = {"source": src, **extra}
    print(f"{name:24s} {a.shape[1]}x{a.shape[0]}")


def mirror_tile(a):
    return np.concatenate([a, a[:, ::-1]], axis=1)


def downsample(a, k):
    """Exact k:1 box downsample, alpha by majority, colours snapped back onto the source palette."""
    H, W = a.shape[0] // k * k, a.shape[1] // k * k
    a = a[:H, :W].astype(float)
    blk = a.reshape(H // k, k, W // k, k, 4)
    alpha = blk[..., 3].mean((1, 3))
    w = blk[..., 3:4] / 255.0
    rgb = (blk[..., :3] * w).sum((1, 3)) / np.maximum(w.sum((1, 3)), 1e-6)
    pal = np.unique(a[a[..., 3] > 0][:, :3], axis=0)
    flat = rgb.reshape(-1, 3)
    idx = np.empty(len(flat), int)
    for i in range(0, len(flat), 2048):
        d = ((flat[i : i + 2048, None, :] - pal[None]) ** 2).sum(-1)
        idx[i : i + 2048] = d.argmin(1)
    out = np.zeros((H // k, W // k, 4), np.uint8)
    out[..., :3] = pal[idx].reshape(H // k, W // k, 3)
    out[..., 3] = np.where(alpha >= 110, 255, 0)
    out[out[..., 3] == 0] = 0
    return out


def quilt(a, K):
    """Seamless in x by a min-cut seam between the strip's two ends (no blending, no mirror)."""
    A = a.astype(int)
    H, W = A.shape[:2]
    L, R = A[:, W - K :], A[:, :K]
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
    comp = R.copy()
    for y in range(H):
        comp[y, : seam[y]] = L[y, : seam[y]]
    return np.concatenate([comp, A[:, K : W - K]], axis=1).astype(np.uint8)


COATS = {  # shade, body, highlight, mane (art-pipeline COAT_PALETTES)
    "grey": ("#83827d", "#b4b3ae", "#dddcd6", "#5f5e5b"),
    "chestnut": ("#73371a", "#a4552b", "#d07f47", "#8a4a26"),
    "black": ("#0f0d0d", "#1f1c1c", "#47403e", "#0b0a0a"),
}


def recoat(f, coat):
    """Luminance-ramp recolour of the warm coat pixels (and dark mane) onto another coat."""
    if coat == "bay":
        return f
    o = f.copy()
    a = f[..., 3] > 0
    rgb = f[..., :3].astype(float) / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    warm = a & (r >= g) & (g >= b * 0.85) & (sat > 0.28) & ~((r > 0.75) & (g > 0.55))  # not brass buckles
    L = 0.299 * r + 0.587 * g + 0.114 * b
    hx = lambda h: np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)], float)
    sh, bd, hi, mane = (hx(c) for c in COATS[coat])
    stops = [sh * 0.55, sh, bd, hi, hi * 0.6 + 255 * 0.4]
    lw = L[warm]
    if len(lw):
        q = np.clip((lw - np.quantile(lw, 0.02)) / max(1e-6, np.quantile(lw, 0.98) - np.quantile(lw, 0.02)), 0, 1) * (len(stops) - 1)
        i0 = np.minimum(np.floor(q).astype(int), len(stops) - 2)
        t = (q - i0)[:, None]
        S = np.array(stops)
        o[warm, :3] = np.round(S[i0] * (1 - t) + S[i0 + 1] * t).astype(np.uint8)
    darkmane = a & ~warm & (L < 0.22) & (sat < 0.6)
    if coat == "grey":
        o[darkmane, :3] = np.clip(mane * (0.6 + L[darkmane][:, None] * 2.2), 0, 255).astype(np.uint8)
    return quantise(o, 48)


def strip(frames, name, src, fps, pad=1):
    """Align frames on a common baseline, crop to the union box, pack horizontally."""
    frames = [clean(f) for f in frames]
    union = np.zeros(frames[0].shape[:2], bool)
    for f in frames:
        union |= f[..., 3] > 0
    ys, xs = np.nonzero(union)
    y0, y1 = max(0, ys.min() - pad), min(union.shape[0], ys.max() + 1)
    x0, x1 = max(0, xs.min() - pad), min(union.shape[1], xs.max() + 1 + pad)
    crop = [f[y0:y1, x0:x1] for f in frames]
    s = np.concatenate(crop, axis=1)
    save(s, name, src, frames=len(crop))
    atlas["anims"][name] = {"fw": int(x1 - x0), "fh": int(y1 - y0), "frames": len(crop), "fps": fps}


# ---------------------------------------------------------------- static layers
fac = clean(quantise(load(RAW / "yard-stables-0.png")))
# doorway holes: near-black pixels in the door band -> transparent; remembered as rects
dark = (lum(fac) < 24) & (fac[..., 3] > 0)
band = np.zeros_like(dark)
band[186:224] = True
_, boxes = components(dark & band, 200)
holes = []
for x0, y0, x1, y1, n, _ in sorted(boxes):
    holes.append([int(x0), int(y0), int(x1 - x0), int(y1 - y0)])
atlas["holes"]["yard-stables"] = holes
fac[dark & band] = 0  # the engine paints a lit stall interior behind each doorway
save(fac, "yard-stables", "diorama/raw/yard-stables-0 (generate-image-v2, style ref scenes/stable-yard)", holes=holes)

save(clean(quantise(load(RAW / "yard-trees-0.png"))), "yard-trees", "diorama/raw/yard-trees-0")
cob = quantise(load(RAW / "yard-ground-0.png"))
cob[..., 3] = 255
cobq = quilt(cob, 64)
save(cobq, "yard-cobbles", "diorama/raw/yard-ground-0", seamless="x (min-cut quilt, no mirror)")
# finer cobbles for the receding yard floor: exact 2:1, snapped back onto the cobble palette
save(downsample(cobq, 2), "yard-cobbles-s2", "yard-cobbles 2:1 box downsample", seamless="x (min-cut quilt)")
# far crowd behind a rail: the race crowd strip at 2:1 (it is seamless in x already)
save(downsample(load(Path("apps/web/public/art/race/crowd.png")), 2), "crowd-s2", "race/crowd.png 2:1 box downsample", seamless="x")
save(downsample(load(Path("apps/web/public/art/race/bb-grandstand.png")), 2), "grandstand-s2", "race/bb-grandstand.png 2:1 box downsample")

for sheet in ("yard-props", "barn-props", "pasture-props", "trophies"):
    a = clean(quantise(load(RAW / f"{sheet}-0.png")))
    _, bx = components(a[..., 3] > 0, 60)
    # merge components whose boxes overlap (e.g. a lantern and its bracket)
    bx = sorted([list(b[:4]) for b in bx])
    merged = []
    for b in bx:
        m0 = merged[-1] if merged else None
        if m0 and b[0] <= m0[2] + 2 and b[1] <= m0[3] and b[3] >= m0[1]:
            m = merged[-1]
            merged[-1] = [min(m[0], b[0]), min(m[1], b[1]), max(m[2], b[2]), max(m[3], b[3])]
        else:
            merged.append(b)
    atlas["props"][sheet] = [[int(x0), int(y0), int(x1 - x0), int(y1 - y0)] for x0, y0, x1, y1 in merged]
    save(a, sheet, f"diorama/raw/{sheet}-0", rects=atlas["props"][sheet])

save(clean(quantise(load(RAW / "fg-branch-0.png"))), "fg-branch", "diorama/raw/fg-branch-0")
grass = clean(quantise(load(RAW / "fg-grass-0.png")))
save(mirror_tile(grass), "fg-grass", "diorama/raw/fg-grass-0", seamless="x (mirror)")
save(clean(quantise(load(RAW / "paddock-pavilion-0.png"))), "paddock-pavilion", "diorama/raw/paddock-pavilion-0")
# the Ranch pasture: far countryside (alpha-cropped, mirrored to tile), meadow floor and fence
far = clean(quantise(load(RAW / "pasture-far-0.png")))
ys, xs = np.nonzero(far[..., 3])
far = far[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
save(mirror_tile(far), "pasture-far", "diorama/raw/pasture-far-0", seamless="x (mirror)")
# one continuous meadow in perspective (fine at the fence, larger up close): the whole pasture
# floor, so the depth rows stand on one ground with no seams between strips
meadow = quantise(load(RAW / "pasture-meadow-0.png"))
meadow[..., 3] = 255
save(quilt(meadow, 64), "pasture-meadow", "diorama/raw/pasture-meadow-0", seamless="x (min-cut quilt, no mirror)")
fence = clean(quantise(load(RAW / "pasture-fence-0.png")))
ys, xs = np.nonzero(fence[..., 3])
save(fence[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], "pasture-fence", "diorama/raw/pasture-fence-0")

wall = quantise(load(RAW / "barn-wall-0.png"))
wall[..., 3] = 255
save(mirror_tile(wall), "barn-wall", "diorama/raw/barn-wall-0", seamless="x (mirror)")
floor = quantise(load(RAW / "barn-floor-0.png"))
floor[..., 3] = 255
save(quilt(floor, 64), "barn-floor", "diorama/raw/barn-floor-0", seamless="x (min-cut quilt, no mirror)")

stalls = clean(quantise(load(RAW / "barn-stalls-0.png")))
# enclosed transparent regions (stall openings) -> holes; the engine paints a dark interior there
_, tb = components(stalls[..., 3] == 0, 400)
H, W = stalls.shape[:2]
sh = [[int(x0), int(y0), int(x1 - x0), int(y1 - y0)] for x0, y0, x1, y1, n, _ in sorted(tb) if x0 > 0 and y0 > 0 and x1 < W and y1 < H]
atlas["holes"]["barn-stalls"] = sh
save(stalls, "barn-stalls", "diorama/raw/barn-stalls-0", holes=sh)

# ---------------------------------------------------------------- animations
fr = lambda p, a, b: [load(RAW / f"{p}-{i}.png") for i in range(a, b + 1)]
strip(fr("anim-walk-led", 1, 8), "horse-walk-led", "anim-walk-led 1..8 (animate-with-text-v3 from rig-hd/horse-neutral-stance-256)", 8)
strip(fr("anim-groom-hd", 1, 8), "groom-walk", "anim-groom-hd 1..8 (animate-with-text-v3 from groom-hd-0)", 8)
# stall horses looking out over the half-door, cut from the approved 3/4 portraits (owner: the
# old generated head/chest read as a floating head). The portrait's neck runs straight down, so
# the door line crosses the neck under the muzzle (portrait row 105) and the rest is behind the
# door. 128 -> 96 px (3x nearest up, exact 4:1 box down, palette-snapped) to suit the stalls; a
# slow 1 px nod; `door` = frame rows down to the door line (overDoor crops there).
PORTRAITS = Path("apps/web/public/art/portraits")
DOOR_ROW = 105
NOD = (0, 0, 1, 1, 1, 0)


def scale_3_4(a):
    return downsample(np.repeat(np.repeat(a, 3, 0), 3, 1), 4)


for coat in ("bay", "grey", "chestnut", "black"):
    head = scale_3_4(clean(load(PORTRAITS / f"horse-{coat}.png")))
    frames = []
    for d in NOD:
        f = np.zeros_like(head)
        f[: head.shape[0] - d] = head[d:]
        frames.append(f)
    ys = np.nonzero((head[..., 3] > 0).any(1))[0]
    y0 = max(0, int(ys.min()) - max(NOD) - 1)  # strip() crops the union box with 1 px of padding
    strip(frames, f"stall-horse-{coat}", f"portraits/horse-{coat}.png 3:4 (3x nearest, 4:1 box), 1 px nod", 4)
    atlas["anims"][f"stall-horse-{coat}"]["door"] = int(round(DOOR_ROW * 0.75)) - y0
for i in range(4):
    im = quantise(load(RAW / f"stall-interior-{i}.png"))
    im[..., 3] = 255
    save(im, f"stall-interior-{i}", f"diorama/raw/stall-interior-{i}")
    save(downsample(im, 2), f"stall-interior-{i}-s2", f"stall-interior-{i} 2:1")
# full-body horse standing in the barn aisle (idle: weight shift, tail swish, ears, head)
strip(fr("anim-aisle-idle", 1, 8), "horse-aisle-idle", "anim-aisle-idle 1..8 (animate-with-text-v3 from rig-hd/horse-standing-alt-256)", 5)

# keyed (recolourable) strips made by art-src/process_gallop.py --palette-from race/horse-gallop
# horse-loose-*: the Ranch turnout (untacked, keyed; art-src/diorama/key-ranch.sh)
for name, fps in (("horse-walk-jockey", 8), ("horse-canter", 12), ("horse-loose-walk", 7), ("horse-loose-graze", 5), ("horse-loose-idle", 5)):
    m = json.loads(Path(f"art-src/meta/race/{name}.meta.json").read_text())
    atlas["anims"][name] = {"fw": m["frameWidth"], "fh": m["frameHeight"], "frames": m["frameCount"], "fps": fps}
    im = Image.open(OUT / f"{name}.png")
    atlas["files"][name] = {"w": im.width, "h": im.height}
    meta[name] = {"source": f"art-src/process_gallop.py --hd --palette-from art-src/meta/race/horse-gallop.meta.json ({name})", "keyed": "race/palette.json"}



def downsample_strip(name, k, fps, src=None):
    """k:1 copy of a served strip (frames split by the atlas frame width) for far planes."""
    a = load(src or OUT / f"{name}.png")
    fw = atlas["anims"][name]["fw"]
    n = a.shape[1] // fw
    frames = [a[:, i * fw : (i + 1) * fw] for i in range(n)]
    pw = (k - fw % k) % k
    ph = (k - a.shape[0] % k) % k
    frames = [np.pad(f, ((ph, 0), (0, pw), (0, 0))) for f in frames]  # pad on top so the baseline stays
    small = [downsample(f, k) for f in frames]
    s = np.concatenate(small, axis=1)
    out = f"{name}-s{k}"
    save(s, out, f"{name} {k}:1 box downsample snapped to its own (key) palette")
    atlas["anims"][out] = {"fw": int(small[0].shape[1]), "fh": int(small[0].shape[0]), "frames": n, "fps": fps}
    if "door" in atlas["anims"][name]:
        atlas["anims"][out]["door"] = int(atlas["anims"][name]["door"] + ph) // k


# level-of-detail copies (the engine picks one so a sprite always fits its band)
for name, ks, fps in (
    ("horse-walk-jockey", (2, 3, 4), 8),
    ("groom-walk", (2, 3, 4), 8),
    ("horse-walk-led", (2, 3), 8),
    ("horse-canter", (2, 3), 12),
    ("horse-aisle-idle", (2, 3), 5),
    ("stall-horse-bay", (2, 3), 4),
    ("stall-horse-grey", (2, 3), 4),
    ("stall-horse-chestnut", (2, 3), 4),
    ("stall-horse-black", (2, 3), 4),
    ("horse-loose-walk", (2, 3), 7),
    ("horse-loose-graze", (2, 3), 5),
    ("horse-loose-idle", (2, 3), 5),
):
    for k in ks:
        downsample_strip(name, k, fps)
# the race gallop (keyed, race/palette.json) for short bands
atlas["anims"]["horse-gallop"] = {"fw": 229, "fh": 146, "frames": 12, "fps": 14}
for k in (2, 3):
    downsample_strip("horse-gallop", k, 14, src=Path("apps/web/public/art/race/horse-gallop.png"))
del atlas["anims"]["horse-gallop"]
META.write_text(json.dumps(meta, indent=1))
TS.write_text(
    "// Generated by art-src/diorama/process_diorama.py - do not edit by hand.\n"
    "/* eslint-disable */\n"
    f"export const DIORAMA_ATLAS = {json.dumps(atlas, indent=1)} as const;\n"
)
print("atlas ->", TS)
