#!/usr/bin/env python3
"""Offline pixel-rig builder: PixelLab source sprites + rig.json cut definition -> part atlases.

    python3 -I art-src/rig/build_rig.py [--debug OUT_DIR]

Inputs (see art-src/rig/rig.json):
  * a side-view horse (no rider) and the same picture with a jockey inpainted on top,
  * PixelLab /normal-map results for both.

Outputs (apps/web/public/art/rig/):
  horse-parts.png         RGBA  R = role id * 17, G = ramp position (0..255 within the role),
                                B = baked detail (128 = neutral), A = coverage (0/255)
  horse-parts-normal.png  RGBA  RGB = tangent-space normal (OpenGL, y up), A = height
  horse-parts-aux.png     RGBA  R = marking zone (1 face, 2 leg), G = along, B = across
  horse-rig.json          part rects (native atlas px), pivots, parents, z, joints, frames

The atlases are stored at SCALE x the native resolution using Scale2x (EPX) twice: the runtime
renders parts at native resolution with nearest sampling, so rotated parts pick up
RotSprite-style smoothed edges instead of nearest-neighbour jaggies. Every output pixel is
still a copy of a source pixel, so roles and ramp positions stay exact.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RIG = os.path.join(ROOT, "art-src", "rig", "rig.json")
OUT = os.path.join(ROOT, "apps", "web", "public", "art", "rig")
SCALE = 4

ROLES = [
    "none", "coat", "points", "mane", "hoof", "muzzle", "ink", "marking",
    "silksPrimary", "silksSecondary", "cap", "skin", "breeches", "boots", "tack", "saddlecloth",
]
RID = {n: i for i, n in enumerate(ROLES)}


def load(path):
    return np.array(Image.open(os.path.join(ROOT, path)).convert("RGBA")).astype(np.int32)


def hsv(img):
    rgb = img[..., :3] / 255.0
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.maximum(d, 1e-6), 0)
    gc = np.where(m, (mx - g) / np.maximum(d, 1e-6), 0)
    bc = np.where(m, (mx - b) / np.maximum(d, 1e-6), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(m, (h / 6.0) % 1.0, 0)
    lum = (img[..., 0] * 299 + img[..., 1] * 587 + img[..., 2] * 114) / 1000.0
    return h, s, lum


def poly_mask(poly, h, w):
    """Pixel-centre point-in-polygon (even-odd) for an (h, w) grid."""
    ys, xs = np.mgrid[0:h, 0:w]
    px = xs + 0.5
    py = ys + 0.5
    inside = np.zeros((h, w), bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > py) != (y2 > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1
        inside ^= cond & (px < xint)
    return inside


def colour_class(img, name):
    h, s, lum = hsv(img)
    if name == "dark":
        return lum < 62
    if name == "darkish":
        return lum < 90
    if name == "brown":
        return (lum >= 45) & (s > 0.35)
    if name == "white":
        return (s < 0.22) & (lum > 140)
    if name == "whiteish":
        return (s < 0.3) & (lum > 110)
    if name == "magenta":
        return (h > 0.75) & (h < 0.97) & (s > 0.35)
    if name == "cyan":
        return (h > 0.42) & (h < 0.6) & (s > 0.3)
    if name == "skin":
        return (h < 0.12) & (s > 0.15) & (s < 0.65) & (lum > 95)
    raise ValueError(name)


def neighbours4(m):
    out = np.zeros_like(m)
    out[1:, :] |= m[:-1, :]
    out[:-1, :] |= m[1:, :]
    out[:, 1:] |= m[:, :-1]
    out[:, :-1] |= m[:, 1:]
    return out


def dist_transform(mask):
    """Euclidean distance (px) from each inside pixel to the nearest outside pixel centre."""
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), bool)
    pad[1:-1, 1:-1] = mask
    outside = ~pad
    border = outside & neighbours4(pad)
    by, bx = np.nonzero(border)
    iy, ix = np.nonzero(pad)
    d = np.zeros((h + 2, w + 2))
    if len(iy) == 0:
        return d[1:-1, 1:-1]
    best = np.full(len(iy), 1e9)
    for k in range(0, len(by), 512):
        dy = iy[:, None] - by[None, k:k + 512]
        dx = ix[:, None] - bx[None, k:k + 512]
        best = np.minimum(best, np.sqrt(dx * dx + dy * dy).min(1))
    d[iy, ix] = best - 0.5
    return d[1:-1, 1:-1]


def box_blur(a, r):
    if r <= 0:
        return a
    k = 2 * r + 1
    p = np.pad(a, r, mode="edge")
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def scale2x_index(key):
    """Scale2x on an integer key image; returns (2h, 2w, 2) source coordinates."""
    h, w = key.shape
    yy, xx = np.mgrid[0:h, 0:w]
    P = key
    A = np.vstack([key[:1], key[:-1]])  # up
    D = np.vstack([key[1:], key[-1:]])  # down
    C = np.hstack([key[:, :1], key[:, :-1]])  # left
    B = np.hstack([key[:, 1:], key[:, -1:]])  # right
    srcy = np.zeros((2 * h, 2 * w), np.int32)
    srcx = np.zeros((2 * h, 2 * w), np.int32)
    upy = np.maximum(yy - 1, 0)
    dny = np.minimum(yy + 1, h - 1)
    lfx = np.maximum(xx - 1, 0)
    rtx = np.minimum(xx + 1, w - 1)
    cond = (A != D) & (C != B)
    # E0 (top-left) = C==A ? A : P
    e0 = cond & (C == A)
    e1 = cond & (A == B)
    e2 = cond & (D == C)
    e3 = cond & (B == D)
    for (oy, ox, sel, sy, sx) in (
        (0, 0, e0, upy, xx),
        (0, 1, e1, upy, xx),
        (1, 0, e2, dny, xx),
        (1, 1, e3, dny, xx),
    ):
        srcy[oy::2, ox::2] = np.where(sel, sy, yy)
        srcx[oy::2, ox::2] = np.where(sel, sx, xx)
    return srcy, srcx


def upscale(layers, key, times):
    """Apply Scale2x `times` times driven by `key`; gather every layer through the same picks."""
    for _ in range(times):
        sy, sx = scale2x_index(key)
        key = key[sy, sx]
        layers = [l[sy, sx] for l in layers]
    return layers


def main():
    debug_dir = None
    if "--debug" in sys.argv:
        debug_dir = sys.argv[sys.argv.index("--debug") + 1]
        os.makedirs(debug_dir, exist_ok=True)
    rig = json.load(open(RIG))
    W, H = rig["canvas"]
    src = {k: load(v) for k, v in rig["sources"].items()}
    horse, rider = src["horse"], src["rider"]
    diff = (np.abs(rider - horse).sum(-1) > 0) & (rider[..., 3] > 0)
    images = {"horse": horse, "rider": rider}
    normals_pl = {"horse": src.get("horseNormal"), "rider": src.get("riderNormal")}

    # ---- 1. label every source pixel -----------------------------------------------------
    labels = {"horse": np.full((H, W), -1, np.int32), "rider": np.full((H, W), -1, np.int32)}
    parts = rig["parts"]
    cut = [p for p in parts if "copyOf" not in p and "derive" not in p]
    for i, p in enumerate(cut):
        img = images[p["src"]]
        m = poly_mask(p["poly"], H, W) & (img[..., 3] > 0) & (labels[p["src"]] < 0)
        if p.get("filter"):
            fm = np.zeros((H, W), bool)
            for f in p["filter"].split("|"):
                fm |= diff if f == "diff" else colour_class(img, f)
            m &= fm
        if p.get("except"):
            m &= ~colour_class(img, p["except"])
        labels[p["src"]][m] = i
    # unlabelled horse pixels inside the silhouette: give them to the nearest labelled part
    for s in ("horse",):
        lab = labels[s]
        alpha = images[s][..., 3] > 0
        for _ in range(6):
            todo = alpha & (lab < 0)
            if not todo.any():
                break
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                sh = np.roll(np.roll(lab, dy, 0), dx, 1)
                fill = todo & (sh >= 0) & (lab < 0)
                fill &= np.array([not cut[v].get("discard") for v in sh.ravel()]).reshape(sh.shape) if fill.any() else fill
                lab[fill] = sh[fill]

    # ---- 2. per-pixel role + strip outer dark outline --------------------------------------
    roles = {s: np.zeros((H, W), np.int32) for s in images}
    keep = {s: np.zeros((H, W), bool) for s in images}
    for i, p in enumerate(cut):
        if p.get("discard"):
            continue
        img = images[p["src"]]
        m = labels[p["src"]] == i
        r = np.full((H, W), RID[p["role"]], np.int32)
        for rule in reversed(p.get("rules", [])):
            sel = colour_class(img, rule["if"])
            if "poly" in rule:
                sel &= poly_mask(rule["poly"], H, W)
            r = np.where(sel, RID[rule["role"]], r)
        roles[p["src"]][m] = r[m]
        keep[p["src"]] |= m
    # The jockey layer's "silhouette" is its own pixels; the horse's is the full sprite.
    for s in images:
        img = images[s]
        _, sat, lum = hsv(img)
        sil = keep[s] if s == "rider" else (img[..., 3] > 0)
        edge = sil & neighbours4(~sil)
        outline = edge & (lum < 40) & (sat < 0.6)
        keep[s] &= ~outline

    # ---- 3. ramp position per role (luminance, percentile-normalised) ----------------------
    tval = {s: np.zeros((H, W)) for s in images}
    for rid in range(1, len(ROLES)):
        vals = []
        for s in images:
            m = keep[s] & (roles[s] == rid)
            vals.append(hsv(images[s])[2][m])
        v = np.concatenate(vals)
        if len(v) == 0:
            continue
        lo, hi = np.percentile(v, 3), np.percentile(v, 97)
        for s in images:
            m = keep[s] & (roles[s] == rid)
            lum = hsv(images[s])[2]
            tval[s][m] = np.clip((lum[m] - lo) / max(hi - lo, 1.0), 0, 1)

    # ---- 4. normals: inflate each volume's silhouette + PixelLab normal --------------------
    nrm = {s: np.zeros((H, W, 3)) for s in images}
    hgt = {s: np.zeros((H, W)) for s in images}
    detail = {s: np.zeros((H, W)) for s in images}
    vols = rig["volumes"]
    for s in images:
        for vname, R in vols.items():
            members = [i for i, p in enumerate(cut) if p.get("vol") == vname and p["src"] == s]
            if not members:
                continue
            if vname in ("leg", "limb"):
                groups = [[i] for i in members]  # each limb segment is its own cylinder
            else:
                groups = [members]
            for g in groups:
                vm = np.isin(labels[s], g) & (images[s][..., 3] > 0)
                if not vm.any():
                    continue
                d = dist_transform(vm)
                x = np.clip(d / R, 0, 1)
                hh = R * np.sqrt(np.clip(1 - (1 - x) ** 2, 0, 1))
                hh = np.where(vm, hh, 0)
                hs = box_blur(hh, 1)
                gy, gx = np.gradient(hs)
                n = np.dstack([-gx, gy, np.ones_like(hs)])  # image y down -> normal y up
                n /= np.linalg.norm(n, axis=-1, keepdims=True)
                nrm[s][vm] = n[vm]
                hgt[s][vm] = hh[vm]
        pl = normals_pl[s]
        if pl is not None:
            npl = pl[..., :3] / 127.5 - 1.0
            npl /= np.maximum(np.linalg.norm(npl, axis=-1, keepdims=True), 1e-6)
            m = pl[..., 3] > 0
            mix = nrm[s] * 0.55 + np.where(m[..., None], npl, nrm[s]) * 0.45
            nrm[s] = mix / np.maximum(np.linalg.norm(mix, axis=-1, keepdims=True), 1e-6)
        lum = hsv(images[s])[2]
        base = box_blur(np.where(keep[s], lum, 0), 2) / np.maximum(box_blur(keep[s].astype(float), 2), 1e-3)
        detail[s] = np.clip((lum - base) / 60.0, -1, 1)

    # ---- 5. aux: face / leg marking coordinates -------------------------------------------
    aux = {s: np.zeros((H, W, 3)) for s in images}
    face = rig["face"]
    idx = {p["name"]: i for i, p in enumerate(cut)}
    hm = labels["horse"] == idx["head"]
    for y in range(H):
        xs = np.nonzero(hm[y])[0]
        if len(xs) == 0:
            continue
        xf = xs.max()
        for x in xs:
            along = (y - face["foreheadY"]) / (face["noseY"] - face["foreheadY"])
            aux["horse"][y, x] = (1, np.clip(along, 0, 1), np.clip((xf - x) / 6.0, 0, 1))
    J = rig["joints"]
    for leg, (knee, hoofTop) in {
        "fore": (J["foreKnee"][1], next(p for p in cut if p["name"] == "foreNearHoof")["pivot"][1]),
        "hind": (J["hindHock"][1], next(p for p in cut if p["name"] == "hindNearHoof")["pivot"][1]),
    }.items():
        for seg in ("Upper", "Lower", "Hoof"):
            m = labels["horse"] == idx[f"{leg}Near{seg}"]
            ys, xs = np.nonzero(m)
            along = (hoofTop - ys - 0.5) / (hoofTop - knee)
            aux["horse"][ys, xs] = np.stack([np.full(len(ys), 2.0), np.clip(along / 2.0 + 0.0, 0, 1), np.zeros(len(ys))], -1)

    # ---- 6. cut parts (+ seam / joint padding) and pack -----------------------------------
    rects = {}
    tiles = []
    for i, p in enumerate(cut):
        if p.get("discard"):
            continue
        s = p["src"]
        core = (labels[s] == i) & keep[s]
        # seam pad: grow into neighbouring parts' real pixels (identical at rest)
        grown = core.copy()
        other = keep[s] & ~core
        if s == "horse":
            for _ in range(p.get("seam", 2)):
                grown |= neighbours4(grown) & other
            # under-child pads: keep the child's real source pixels near the joint, so when the
            # child swings away the parent still shows the muscle mass there (thigh, elbow)
            yy0, xx0 = np.mgrid[0:H, 0:W]
            for q in cut:
                if q.get("parent") == p["name"] and q.get("underPad"):
                    (cx, cy), r = q["pivot"], q["underPad"]
                    disc = ((xx0 + 0.5 - cx) ** 2 + (yy0 + 0.5 - cy) ** 2) <= r * r
                    if "underPadMaxY" in q:
                        disc &= (yy0 + 0.5) < q["underPadMaxY"]
                    grown |= disc & (labels[s] == cut.index(q)) & keep[s]
        # joint pads: discs at the part's pivot and at its children's pivots, filled by propagation
        discs = [(p["pivot"], p.get("padR", 3))]
        for q in cut:
            if q.get("parent") == p["name"] and "pivot" in q:
                discs.append((q["pivot"], q.get("padR", 3)))
        fill_region = np.zeros((H, W), bool)
        yy, xx = np.mgrid[0:H, 0:W]
        for (cx, cy), r in discs:
            fill_region |= ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2) <= r * r
        data_role = roles[s].copy()
        data_t = tval[s].copy()
        data_d = detail[s].copy()
        data_n = nrm[s].copy()
        data_h = hgt[s].copy()
        data_a = aux[s].copy()
        cur = grown.copy()
        for _ in range(3):
            cand = fill_region & ~cur & neighbours4(cur)
            if not cand.any():
                break
            cy_, cx_ = np.nonzero(cand)
            for y, x in zip(cy_, cx_):
                best = None
                for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    yy2, xx2 = y + dy, x + dx
                    if 0 <= yy2 < H and 0 <= xx2 < W and cur[yy2, xx2]:
                        best = (yy2, xx2)
                        break
                if best is not None:
                    data_role[y, x] = data_role[best]
                    data_t[y, x] = data_t[best]
                    data_d[y, x] = data_d[best]
                    data_n[y, x] = data_n[best]
                    data_h[y, x] = data_h[best]
                    data_a[y, x] = data_a[best]
            cur |= cand
        m = cur
        ys, xs = np.nonzero(m)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        sl = (slice(y0, y1), slice(x0, x1))
        tile = {
            "name": p["name"], "mask": m[sl], "role": data_role[sl], "t": data_t[sl], "d": data_d[sl],
            "n": data_n[sl], "h": data_h[sl], "aux": data_a[sl], "origin": [int(x0), int(y0)],
        }
        tile["key"] = p["name"]
        tiles.append(tile)

    # derived variants: re-use a cut part's pixels with a code operation (thin, crop)
    for p in parts:
        if "derive" not in p:
            continue
        base = next(t for t in tiles if t["key"] == p["derive"])
        m = base["mask"].copy()
        op = p.get("op", {})
        if "thin" in op:
            for _ in range(op["thin"]):
                up = np.zeros_like(m)
                up[1:, :] = m[:-1, :]
                m &= up  # drop the top row of every column (thinner, pulled mane)
        if "maxY" in op:
            ys = np.arange(m.shape[0])[:, None] + base["origin"][1]
            m &= ys < op["maxY"]
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sl = (slice(y0, y1), slice(x0, x1))
        t = {k: (v[sl] if isinstance(v, np.ndarray) else v) for k, v in base.items()}
        t["mask"] = m[sl]
        t["origin"] = [int(base["origin"][0] + x0), int(base["origin"][1] + y0)]
        t["key"] = f'{p["name"]}~{p["variant"]}'
        t["name"] = p["name"]
        tiles.append(t)

    # shelf pack, 1px gutter, atlas width 128
    AW = 128
    x = y = 1
    shelf = 0
    for t in sorted(tiles, key=lambda t: -t["mask"].shape[0]):
        h, w = t["mask"].shape
        if x + w + 1 > AW:
            x = 1
            y += shelf + 1
            shelf = 0
        t["rect"] = [x, y, w, h]
        x += w + 1
        shelf = max(shelf, h)
    AH = y + shelf + 1
    AH = int(2 ** np.ceil(np.log2(AH)))
    A_idx = np.zeros((AH, AW, 4), np.uint8)
    A_nrm = np.zeros((AH, AW, 4), np.uint8)
    A_aux = np.zeros((AH, AW, 4), np.uint8)
    for t in tiles:
        x, y, w, h = t["rect"]
        m = t["mask"]
        blk = A_idx[y:y + h, x:x + w]
        blk[..., 0] = np.where(m, t["role"] * 17, 0)
        blk[..., 1] = np.where(m, np.round(t["t"] * 255), 0)
        blk[..., 2] = np.where(m, np.round(128 + t["d"] * 127), 0)
        blk[..., 3] = np.where(m, 255, 0)
        nb = A_nrm[y:y + h, x:x + w]
        nn = np.round((t["n"] * 0.5 + 0.5) * 255)
        nb[..., :3] = np.where(m[..., None], nn, 0)
        nb[..., 3] = np.where(m, np.clip(np.round(t["h"] / 10.0 * 255), 0, 255), 0)
        ab = A_aux[y:y + h, x:x + w]
        ab[..., 0] = np.where(m, t["aux"][..., 0] * 85, 0)
        ab[..., 1] = np.where(m, np.round(t["aux"][..., 1] * 255), 0)
        ab[..., 2] = np.where(m, np.round(t["aux"][..., 2] * 255), 0)
        ab[..., 3] = np.where(m, 255, 0)
    key = (A_idx[..., 0].astype(np.int64) << 24) | (A_idx[..., 1].astype(np.int64) << 16) | (A_idx[..., 3].astype(np.int64))
    # Quantise G into the key coarsely so Scale2x sees "same colour" for near-equal ramp steps.
    key = (A_idx[..., 0].astype(np.int64) << 16) | ((A_idx[..., 1].astype(np.int64) // 24) << 8) | A_idx[..., 3]
    times = int(np.log2(SCALE))
    up_idx, up_nrm, up_aux = upscale([A_idx, A_nrm, A_aux], key, times)

    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(up_idx, "RGBA").save(os.path.join(OUT, "horse-parts.png"), optimize=True)
    Image.fromarray(A_idx, "RGBA").save(os.path.join(OUT, "horse-parts@1x.png"), optimize=True)
    Image.fromarray(up_nrm, "RGBA").save(os.path.join(OUT, "horse-parts-normal.png"), optimize=True)
    Image.fromarray(up_aux, "RGBA").save(os.path.join(OUT, "horse-parts-aux.png"), optimize=True)

    by_name = {t["key"]: t for t in tiles}
    out_parts = []
    for p in parts:
        if p.get("discard"):
            continue
        key = p.get("copyOf") or (f'{p["name"]}~{p["variant"]}' if "derive" in p else p["name"])
        base = by_name[key]
        srcp = next(q for q in cut if q["name"] == p.get("copyOf", p.get("derive", p["name"])))
        off = p.get("offset", [0, 0])
        out_parts.append({
            "name": p["name"],
            "rect": base["rect"],
            "origin": [base["origin"][0] + off[0], base["origin"][1] + off[1]],
            "pivot": [srcp["pivot"][0] + off[0], srcp["pivot"][1] + off[1]],
            "parent": p.get("parent", srcp.get("parent")),
            "z": p.get("z", srcp.get("z")),
            "side": p.get("side", "near"),
            **({"copyOf": p["copyOf"]} if "copyOf" in p else {}),
            **({"slot": p["slot"], "variant": p.get("variant", 0)} if "slot" in p else {}),
        })
    out_parts.sort(key=lambda q: q["z"])
    torso = by_name["jTorso"]
    sf = rig["silksFrame"]

    def to_atlas(pt, tile):
        return [pt[0] - tile["origin"][0] + tile["rect"][0], pt[1] - tile["origin"][1] + tile["rect"][1]]

    meta = {
        "version": 1,
        "scale": SCALE,
        "atlas": [AW, AH],
        "canvas": rig["canvas"],
        "groundY": rig["groundY"],
        "roles": ROLES,
        "parts": out_parts,
        "joints": rig["joints"],
        "silksFrame": {"origin": to_atlas(sf["origin"], torso), "shoulder": to_atlas(sf["shoulder"], torso)},
        "textures": {"index": "horse-parts.png", "normal": "horse-parts-normal.png", "aux": "horse-parts-aux.png", "index1x": "horse-parts@1x.png"},
        "source": {k: v for k, v in rig["sources"].items()},
    }
    with open(os.path.join(OUT, "horse-rig.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"atlas {AW}x{AH} native, {len(tiles)} cut parts, {len(out_parts)} rig parts -> {OUT}")

    if debug_dir:
        pal = np.array([[0, 0, 0], [200, 110, 60], [40, 30, 30], [20, 20, 90], [90, 90, 90], [120, 70, 90],
                        [0, 0, 0], [255, 255, 255], [230, 30, 200], [30, 220, 230], [250, 120, 230],
                        [240, 190, 150], [235, 235, 235], [50, 50, 50], [120, 60, 10], [190, 190, 255]], np.uint8)
        for s in images:
            lab = labels[s]
            rng = np.random.RandomState(3)
            cols = rng.randint(40, 255, (len(cut) + 1, 3)).astype(np.uint8)
            im = np.zeros((H, W, 4), np.uint8)
            m = lab >= 0
            im[m, :3] = cols[lab[m]]
            im[m, 3] = 255
            im[m & ~keep[s], :3] = 255
            Image.fromarray(im).resize((W * 6, H * 6), Image.NEAREST).save(os.path.join(debug_dir, f"labels-{s}.png"))
            im2 = np.zeros((H, W, 4), np.uint8)
            mm = keep[s]
            im2[mm, :3] = (pal[roles[s][mm]] * (0.4 + 0.6 * tval[s][mm, None])).astype(np.uint8)
            im2[mm, 3] = 255
            Image.fromarray(im2).resize((W * 6, H * 6), Image.NEAREST).save(os.path.join(debug_dir, f"roles-{s}.png"))
            im3 = np.zeros((H, W, 4), np.uint8)
            im3[mm, :3] = np.round((nrm[s][mm] * 0.5 + 0.5) * 255)
            im3[mm, 3] = 255
            Image.fromarray(im3).resize((W * 6, H * 6), Image.NEAREST).save(os.path.join(debug_dir, f"normals-{s}.png"))


if __name__ == "__main__":
    main()
