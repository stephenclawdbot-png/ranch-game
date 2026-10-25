"""Post-process the PixelLab gallop animation into the delivered recolourable strip.

  python3 -I art-src/process_gallop.py <anim-prefix> <first> <count> <out-name> [--debug DIR]

Steps:
  1. load frames <prefix>-<first..first+count-1>.png (PixelLab animate output)
  2. classify every opaque pixel into a role: coat, mane (mane/tail/bay points),
     silksPrimary, silksSecondary, cap, skin, white (breeches/saddle cloth), tack, ink
  3. quantise each role onto a small fixed ramp shared by ALL frames (k-means on luminance)
  4. align frames on a common ground baseline, write the strip + palette.json

Roles are found from colour (HSV) plus a little spatial logic (cap = the magenta blob on
the jockey's head; tack = dark pixels around the saddle; skin = light warm pixels next to
the cap).
"""
import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

LEG_BAND = 0.36  # lower fraction of the sprite height treated as legs

RAMP_SIZES = {
    "coat": 7,
    "mane": 4,
    "points": 3,
    "silksPrimary": 4,
    "silksSecondary": 4,
    "cap": 3,
    "skin": 3,
    "white": 4,
    "tack": 3,
    "ink": 2,
}


def hsv(arr):
    a = arr[..., :3].astype(float) / 255
    mx, mn = a.max(-1), a.min(-1)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    d = np.maximum(mx - mn, 1e-9)
    h = np.where(
        mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)
    ) * 60
    h = np.where(mx - mn < 1e-9, 0, h)
    return h, s, v


def components(mask):
    """4-connected component labels (tiny images, plain BFS)."""
    lab = np.zeros(mask.shape, int)
    n = 0
    H, W = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        while stack:
            y, x = stack.pop()
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    stack.append((yy, xx))
    return lab, n


def classify(img):
    """img: HxWx4 uint8 -> HxW array of role names ('' = transparent)."""
    H, W = img.shape[:2]
    a = img[..., 3] > 0
    h, s, v = hsv(img)
    role = np.full((H, W), "", dtype=object)
    magenta = a & (h >= 285) & (h <= 350) & (s > 0.55) & (v > 0.25)
    cyan = a & (h >= 165) & (h <= 205) & (s > 0.55) & (v > 0.12)
    neutral = a & (s < 0.16)
    ink = a & (v < 0.10)
    warm = a & ~magenta & ~cyan & ~neutral & ~ink

    role[warm] = "coat"
    role[cyan] = "silksSecondary"
    role[magenta] = "silksPrimary"
    role[neutral & (v >= 0.10) & (v < 0.45)] = "mane"
    role[neutral & (v >= 0.45)] = "white"
    role[ink] = "ink"
    # Thick near-black areas (bay points: lower legs, mane, tail) belong to the mane ramp;
    # only near-black pixels touching transparency or another colour stay as outline ink.
    pad = np.pad(ink, 1)
    interior = ink & pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
    role[interior] = "mane"

    # Cap: the magenta component whose top is highest and lies right of the body silks.
    lab, n = components(magenta)
    if n:
        comps = []
        for i in range(1, n + 1):
            ys, xs = np.nonzero(lab == i)
            comps.append((len(ys), ys.min(), ys.max(), xs.min(), xs.max(), i))
        body = max(comps)  # largest magenta blob = silks body
        caps = [c for c in comps if c[5] != body[5] and c[0] >= 6 and c[1] <= body[1] + 4]
        if caps:
            cap = max(caps)
            capmask = lab == cap[5]
        else:
            # cap fused to the body: take magenta pixels in the top-right corner of the blob
            ys, xs = np.nonzero(lab == body[5])
            top = ys.min()
            capmask = (lab == body[5]) & (np.arange(H)[:, None] <= top + 5) & (
                np.arange(W)[None, :] >= np.percentile(xs, 60)
            )
        role[capmask] = "cap"
        cy, cx = np.nonzero(capmask)
        # Skin: light warm pixels just below/right of the cap (face, hands are covered by gloves).
        y0, y1, x0, x1 = cy.min(), cy.max() + 9, cx.min() - 2, cx.max() + 5
        box = np.zeros((H, W), bool)
        box[y0:y1, max(0, x0):x1] = True
        skin = box & warm & (v > 0.55) & (s < 0.72)
        role[skin] = "skin"

    # Tack: dark neutral pixels near the white saddle cloth (saddle, girth, boots).
    white = role == "white"
    if white.any():
        lab2, n2 = components(white)
        sizes = [(np.sum(lab2 == i), i) for i in range(1, n2 + 1)]
        big = max(sizes)[1]
        ys, xs = np.nonzero(lab2 == big)
        # saddle cloth is the white blob lowest down (breeches sit above it)
        cand = []
        for sz, i in sizes:
            if sz < 8:
                continue
            yy, xx = np.nonzero(lab2 == i)
            cand.append((yy.max(), i))
        cloth = max(cand)[1]
        yy, xx = np.nonzero(lab2 == cloth)
        box = np.zeros((H, W), bool)
        top = 0
        if (role == "cap").any():
            top = np.nonzero(role == "cap")[0].min()
        box[top : yy.max() + 4, max(0, xx.min() - 3) : xx.max() + 5] = True
        role[box & (role == "mane")] = "tack"
    # Points: dark (bay) lower legs -> separate ramp so non-bay coats get body-coloured legs.
    ys = np.nonzero(a)[0]
    ground = ys.max()
    band = int(round((ground - ys.min()) * LEG_BAND))
    rows = np.arange(H)[:, None] >= ground - band
    role[(role == "mane") & rows] = "points"
    return role


def lum(c):
    return 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]


def kmeans_ramp(px, k, iters=30):
    """1D-ish k-means in RGB, initialised on luminance quantiles; returns centres dark->light."""
    px = px.astype(float)
    if len(px) == 0:
        return np.zeros((0, 3))
    uniq = np.unique(px, axis=0)
    k = min(k, len(uniq))
    L = lum(px)
    qs = np.quantile(L, np.linspace(0.08, 0.92, k))
    centres = np.array([px[np.argmin(np.abs(L - q))] for q in qs])
    for _ in range(iters):
        d = ((px[:, None, :] - centres[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        new = np.array([px[lab == i].mean(0) if np.any(lab == i) else centres[i] for i in range(k)])
        if np.allclose(new, centres):
            break
        centres = new
    centres = np.round(centres).astype(int)
    order = np.argsort(lum(centres))
    return centres[order]


def to_hex(c):
    return "#%02x%02x%02x" % tuple(int(x) for x in c)


def main():
    prefix, first, count, out_name = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    debug = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    out_dir = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else Path("apps/web/public/art/race")
    frames = [np.array(Image.open(f"{prefix}-{i}.png").convert("RGBA")) for i in range(first, first + count)]
    roles = [classify(f) for f in frames]

    ramps = {}
    for r, k in RAMP_SIZES.items():
        px = np.concatenate([f[ro == r][:, :3] for f, ro in zip(frames, roles)])
        ramps[r] = kmeans_ramp(px, k)

    # Make every role's colours unique (the viewer swaps by exact colour).
    used = {}
    for r in RAMP_SIZES:
        fixed = []
        for c in ramps[r]:
            c = c.copy()
            while tuple(c) in used:
                c[2] = min(255, c[2] + 1) if c[2] < 255 else c[2] - 1
            used[tuple(c)] = r
            fixed.append(c)
        ramps[r] = np.array(fixed)

    out_frames = []
    for f, ro in zip(frames, roles):
        o = np.zeros_like(f)
        for r in RAMP_SIZES:
            m = ro == r
            if not m.any() or len(ramps[r]) == 0:
                continue
            px = f[m][:, :3].astype(float)
            d = ((px[:, None, :] - ramps[r][None]) ** 2).sum(-1)
            o[m, :3] = ramps[r][d.argmin(1)]
            o[m, 3] = 255
        out_frames.append(o)

    # Align: common baseline (lowest opaque row -> same y) and stable x (median jockey x).
    H, W = frames[0].shape[:2]
    bottoms = [np.nonzero(o[..., 3])[0].max() for o in out_frames]
    base = max(bottoms)
    # Keep natural vertical bob; frames are already on one ground line within 1-2 px, so
    # only shift horizontally by the silks centroid to kill sideways jitter.
    cx = [np.nonzero((ro == "silksPrimary") | (ro == "silksSecondary"))[1].mean() for ro in roles]
    ref = np.median(cx)
    shifted = []
    for o, c in zip(out_frames, cx):
        dx = int(round(ref - c))
        s = np.zeros_like(o)
        if dx >= 0:
            s[:, dx:] = o[:, : W - dx]
        else:
            s[:, :dx] = o[:, -dx:]
        shifted.append(s)

    # Crop all frames to the union bbox + 2px margin, keeping width/height even.
    union = np.zeros((H, W), bool)
    for s in shifted:
        union |= s[..., 3] > 0
    ys, xs = np.nonzero(union)
    y0, y1 = max(0, ys.min() - 2), min(H, ys.max() + 2)
    x0, x1 = max(0, xs.min() - 2), min(W, xs.max() + 3)
    crop = [s[y0:y1, x0:x1] for s in shifted]
    fw, fh = x1 - x0, y1 - y0
    strip = np.concatenate(crop, axis=1)
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(strip).save(out_dir / f"{out_name}.png", optimize=True)

    pal = {
        "coat": [to_hex(c) for c in ramps["coat"]],
        "mane": [to_hex(c) for c in ramps["mane"]],
        "points": [to_hex(c) for c in ramps["points"]],
        "silksPrimary": [to_hex(c) for c in ramps["silksPrimary"]],
        "silksSecondary": [to_hex(c) for c in ramps["silksSecondary"]],
        "cap": [to_hex(c) for c in ramps["cap"]],
        "fixed": {r: [to_hex(c) for c in ramps[r]] for r in ("skin", "white", "tack", "ink")},
    }
    # nose anchor: rightmost opaque pixel of frame 0 at ground level
    groundY = max(np.nonzero(c[..., 3])[0].max() for c in crop)
    meta = {
        "frameWidth": int(fw),
        "frameHeight": int(fh),
        "frameCount": len(crop),
        "groundY": int(groundY),
        "anchor": {"x": round(float(np.nonzero(crop[0][..., 3])[1].max() / fw), 3), "y": round(float((groundY + 1) / fh), 3)},
        "palette": pal,
        "colours": int(len(np.unique(strip[strip[..., 3] > 0][:, :3], axis=0))),
    }
    print(json.dumps(meta, indent=1))
    Path(out_dir / f"{out_name}.meta.json").write_text(json.dumps(meta, indent=1))

    if debug:
        dbg = Path(debug)
        dbg.mkdir(parents=True, exist_ok=True)
        cmap = {
            "coat": (170, 90, 40), "mane": (60, 60, 60), "points": (0, 160, 0), "silksPrimary": (255, 0, 200), "silksSecondary": (0, 230, 230),
            "cap": (255, 230, 0), "skin": (255, 190, 150), "white": (255, 255, 255), "tack": (40, 40, 160), "ink": (0, 0, 0),
        }
        rows = []
        for ro in roles:
            im = np.zeros((H, W, 4), np.uint8)
            for r, c in cmap.items():
                im[ro == r] = (*c, 255)
            rows.append(im)
        Image.fromarray(np.concatenate(rows, axis=1)).save(dbg / f"{out_name}-roles.png")


if __name__ == "__main__":
    main()
