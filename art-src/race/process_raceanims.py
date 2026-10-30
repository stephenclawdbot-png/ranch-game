"""Post-process PixelLab race-day animations into keyed strips on the shared 256x192 canvas.

  python3 -I art-src/race/process_raceanims.py <out-name> <gen-height> <frame.png...>
        [--align silks|coat|none] [--hold-x A:B] [--debug DIR]

Same recolour contract as the HD gallop (art-src/process_gallop.py): every opaque pixel is
classified into a role (coat, mane, points, silks, cap, skin, white, tack, ink, accent) with
process_gallop.classify, then snapped to the nearest colour of THAT role's ramp in
race/palette.json, so the strip recolours with the same keys as horse-gallop.png.

Placement: frames come from the 256x168 or 256x192 generation canvas whose seed is a gallop
frame pasted at a fixed offset (prep_raceanims.py). They are moved down so the gen ground row
lands on row 191 of the 256x192 output; a gallop pixel (x, y) therefore sits at
(x + 14, y + 47) in every delivered strip.

--align silks : shift each frame horizontally so its silks centroid matches the seed gallop
                frame's (kills sideways jitter; default)
--align coat  : same on the coat centroid
--align barrel: cross-correlate the coat in the barrel band (rows 55-85 px above the ground:
                below the back, above the legs, no head/tail) with the gallop's; use when the
                jockey changes posture (sits up), since the silks then move on the horse
--hold-x A:B  : only align frames A..B (inclusive); others keep their drift
--dx-left N   : the inputs were generated N px left of the standard placement (the lunge, so the
                stretched nose fits); content stays there and the anchor moves with it
--ref self    : align to the strip's own median centroid instead of the gallop's
Specks (opaque components under 6 px not touching the sprite) are removed.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from process_gallop import classify, components  # noqa: E402

PAL = json.loads(Path("apps/web/public/art/race/palette.json").read_text())
ROLES = ["coat", "mane", "points", "silksPrimary", "silksSecondary", "cap", "skin", "white", "tack", "ink", "accent"]
OUT_W, OUT_H, GROUND = 256, 192, 191
GEN_GROUND = {168: 158, 192: 182}
GALLOP_DX, GALLOP_DY = 14, 47


def h2(h):
    return np.array([int(h[i : i + 2], 16) for i in (1, 3, 5)])


RAMPS = {r: np.array([h2(x) for x in (PAL.get(r) or PAL["fixed"].get(r))]) for r in ROLES}
ALL_KEYS = {tuple(c) for r in ROLES for c in RAMPS[r]}


def fix_tack(ro):
    """Girth, boots and saddle are sometimes classified as mane (dark neutral): anything in the
    'mane' role under the jockey (between the saddle cloth's back edge and the silks' front
    edge, from the silks down to the belly) is tack. Mane/tail never reach that box."""
    silks = (ro == "silksPrimary") | (ro == "silksSecondary")
    if not silks.any():
        return ro
    sy, sx = np.nonzero(ro == "silksPrimary") if (ro == "silksPrimary").any() else np.nonzero(silks)
    white = ro == "white"
    ys_all = np.nonzero(ro != "")[0]
    mid = ys_all.min() + int(0.6 * (ys_all.max() - ys_all.min()))  # cloth is never in the legs
    rows = np.arange(ro.shape[0])[:, None]
    cand = white & (rows > sy.min()) & (rows < mid)
    # breeches + saddle cloth = white blobs under the jockey (not grey highlights in the tail)
    lab, n = components(cand)
    keep = np.zeros(ro.shape, bool)
    for i in range(1, n + 1):
        m = lab == i
        xs_ = np.nonzero(m)[1]
        if m.sum() >= 4 and xs_.max() >= sx.min() - 30:
            keep |= m
    wy, wx = np.nonzero(keep)
    if len(wy) == 0:
        return ro
    x0, x1 = wx.min() - 2, sx.max() + 1
    y0, y1 = sy.min(), wy.max() + 34
    box = np.zeros(ro.shape, bool)
    box[max(0, y0) : y1, max(0, x0) : x1] = True
    ro = ro.copy()
    ro[box & (ro == "mane")] = "tack"
    # ...and the inverse: nothing behind the saddle cloth's back edge is tack (the classifier's
    # girth heuristic sometimes grabs the dark far hind leg there)
    behind = (np.arange(ro.shape[1])[None, :] < x0 - 1) & (ro == "tack")
    ro[behind & (rows > wy.max())] = "points"
    ro[behind & (rows <= wy.max())] = "mane"
    return ro


def fix_hooves(ro):
    """White flecks on the hooves (PixelLab sometimes paints socks/shoe glints the gallop never
    had) belong to the lower legs: 'white' pixels in the bottom quarter of the sprite -> points."""
    ys = np.nonzero(ro != "")[0]
    if len(ys) == 0:
        return ro
    cut = ys.max() - (ys.max() - ys.min()) // 4
    ro = ro.copy()
    low = np.arange(ro.shape[0])[:, None] > cut
    ro[low & (ro == "white")] = "points"
    return ro


def key_frame(f):
    ro = fix_tack(fix_hooves(classify(f)))
    o = np.zeros_like(f)
    for r in ROLES:
        m = ro == r
        if not m.any():
            continue
        px = f[m][:, :3].astype(float)
        d = ((px[:, None, :] - RAMPS[r][None]) ** 2).sum(-1)
        o[m, :3] = RAMPS[r][d.argmin(1)]
        o[m, 3] = 255
    return o, ro


def despeckle(o, min_px=6):
    a = o[..., 3] > 0
    lab, n = components(a)
    if n <= 1:
        return o
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    keep = sizes >= min_px
    keep[sizes.argmax()] = True
    o = o.copy()
    o[~keep[lab]] = 0
    return o


def centroid(ro, align):
    if align == "coat":
        m = ro == "coat"
    else:
        m = (ro == "silksPrimary") | (ro == "silksSecondary")
        if not m.any():
            m = ro == "coat"
    return np.nonzero(m)[1].mean()


def barrel_profile(ro, ground):
    band = ro[ground - 85 : ground - 55] == "coat"
    return band.sum(0).astype(float)


def barrel_shift(ro, ground, ref_prof):
    p = barrel_profile(ro, ground)
    best, arg = -1, 0
    for dx in range(-24, 25):
        q = np.roll(p, dx)
        sc = float((q * ref_prof).sum())
        if sc > best:
            best, arg = sc, dx
    return arg


def shift_x(o, dx):
    s = np.zeros_like(o)
    W = o.shape[1]
    if dx >= 0:
        s[:, dx:] = o[:, : W - dx]
    else:
        s[:, :dx] = o[:, -dx:]
    return s


def ref_centroid(align):
    g = np.array(Image.open("apps/web/public/art/race/horse-gallop.png").convert("RGBA"))[:, :229]
    canvas = np.zeros((OUT_H, OUT_W, 4), np.uint8)
    canvas[GALLOP_DY : GALLOP_DY + 145, GALLOP_DX : GALLOP_DX + 229] = g[:145]  # row 145 is empty margin
    return centroid(classify(canvas), align)


def main():
    args = [a for a in sys.argv[1:]]
    opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
    align = opt("--align", "silks")
    hold = opt("--hold-x")
    debug = opt("--debug")
    pos = []
    skip = False
    for a in args:
        if skip:
            skip = False
            continue
        if a.startswith("--"):
            skip = True
            continue
        pos.append(a)
    name, gen_h, files = pos[0], int(pos[1]), pos[2:]
    keyed = []
    for f in files:
        im = np.array(Image.open(f).convert("RGBA"))
        assert im.shape[:2] == (gen_h, 256), (f, im.shape)
        im[..., 3] = np.where(im[..., 3] >= 128, 255, 0)
        o, ro = key_frame(im)
        o = despeckle(o)
        keyed.append((o, np.where(o[..., 3] > 0, ro, "")))
    # Common ground line: the lowest hoof of the whole strip lands on row 191 (one constant
    # shift per strip, so the natural bob and suspension phases are kept).
    gen_bottom = max(int(np.nonzero(o[..., 3])[0].max()) for o, _ in keyed)
    dy = GROUND - gen_bottom
    body_dy = dy - (GROUND - GEN_GROUND[gen_h])  # vs. the gallop's placement (0 = same height)
    frames = []
    roles = []
    for o, ro in keyed:
        c = np.zeros((OUT_H, OUT_W, 4), np.uint8)
        r2 = np.full((OUT_H, OUT_W), "", dtype=object)
        src0 = max(0, -dy)
        assert not o[:src0, :, 3].any(), "sprite would be clipped at the top"
        n = min(gen_h - src0, OUT_H - max(0, dy))
        c[max(0, dy) : max(0, dy) + n] = o[src0 : src0 + n]
        r2[max(0, dy) : max(0, dy) + n] = ro[src0 : src0 + n]
        frames.append(c)
        roles.append(r2)

    dx_left = int(opt("--dx-left", 0))
    report = []
    if align == "barrel":
        g = np.array(Image.open("apps/web/public/art/race/horse-gallop.png").convert("RGBA"))[:, :229]
        canvas = np.zeros((OUT_H, OUT_W, 4), np.uint8)
        canvas[GALLOP_DY : GALLOP_DY + 145, GALLOP_DX - dx_left : GALLOP_DX - dx_left + 229] = g[:145]
        ref_prof = barrel_profile(classify(canvas), GROUND)
        for i in range(len(frames)):
            dx = barrel_shift(roles[i], GROUND + body_dy, ref_prof)
            report.append(dx)
            if dx:
                frames[i] = shift_x(frames[i], dx)
                roles[i] = np.roll(roles[i], dx, axis=1)
    elif align != "none":
        cxs = [centroid(r, align) for r in roles]
        # --ref self: steady on the strip's own median (jockey posture differs from the gallop's)
        ref = float(np.median(cxs)) if opt("--ref") == "self" else ref_centroid(align) - dx_left
        a0, a1 = (int(x) for x in hold.split(":")) if hold else (0, len(frames) - 1)
        for i in range(len(frames)):
            cx = centroid(roles[i], align)
            dx = int(round(ref - cx)) if a0 <= i <= a1 else 0
            report.append(round(ref - cx, 1))
            if dx:
                frames[i] = shift_x(frames[i], dx)
                roles[i] = np.roll(roles[i], dx, axis=1)
    strip = np.concatenate(frames, axis=1)
    opaque = strip[strip[..., 3] > 0][:, :3]
    stray = {tuple(c) for c in np.unique(opaque, axis=0)} - ALL_KEYS
    assert not stray, f"non-key colours: {list(stray)[:5]}"
    out = Path("apps/web/public/art/race") / f"{name}.png"
    Image.fromarray(strip).save(out, optimize=True)
    bottoms = [int(np.nonzero(f[..., 3])[0].max()) for f in frames]
    boxes = []
    for f in frames:
        ys, xs = np.nonzero(f[..., 3])
        boxes.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
    meta = {
        "frameWidth": OUT_W,
        "frameHeight": OUT_H,
        "frameCount": len(frames),
        "groundY": GROUND,
        "anchor": {"x": round((GALLOP_DX - dx_left + 223) / OUT_W, 3), "y": 1.0},
        "gallopOffset": {"x": GALLOP_DX - dx_left, "y": GALLOP_DY},
        "bodyDy": body_dy,
        "sources": files,
        "align": align,
        "alignShift": report,
        "bottoms": bottoms,
        "bboxes": boxes,
        "colours": int(len(np.unique(opaque, axis=0))),
    }
    Path("art-src/meta/race").mkdir(parents=True, exist_ok=True)
    prev = Path(f"art-src/meta/race/{name}.meta.json")
    if prev.exists():
        old = json.loads(prev.read_text())
        for k in ("fps", "sourcePrompt"):
            if k in old:
                meta[k] = old[k]
    prev.write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps({k: meta[k] for k in ("frameCount", "bodyDy", "alignShift", "bottoms", "colours")}))
    if debug:
        cmap = {
            "coat": (170, 90, 40), "mane": (60, 60, 60), "points": (0, 160, 0), "silksPrimary": (255, 0, 200),
            "silksSecondary": (0, 230, 230), "cap": (255, 230, 0), "skin": (255, 190, 150), "white": (255, 255, 255),
            "tack": (40, 40, 160), "ink": (0, 0, 0), "accent": (255, 0, 0),
        }
        rows = []
        for ro in roles:
            im = np.zeros((OUT_H, OUT_W, 4), np.uint8)
            for r, c in cmap.items():
                im[ro == r] = (*c, 255)
            rows.append(im)
        Path(debug).mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.concatenate(rows, axis=1)).save(Path(debug) / f"{name}-roles.png")


if __name__ == "__main__":
    main()
