#!/usr/bin/env python3
"""Build the genetic-portrait role map and face-marking masks (offline, deterministic).

All ten painted 3/4 head portraits share one 128x128 silhouette, so a pixel's meaning
can be derived by comparing the paintings:

  roles.png           RGBA, 128x128. R = role id x 28, G = shading LEVEL 0..255
                      (grey-painting luminance normalised inside the role), B = flags
                      (bit 0: face-front plane, bit 1: the painted star and its fringe).
                      Roles: 0 transparent, 1 outline/ink,
                      2 bridle leather, 3 bridle metal, 4 eye, 5 coat, 6 mane,
                      7 muzzle/skin, 8 inner ear. Runtime swaps coat/mane/muzzle/ear
                      (and eye, when the genes set it) and keeps fixed roles painted.
  portrait-marks.png  RGBA, 128x640: five 128x128 bands (star, snip, stripe, blaze,
                      bald). White pixels, alpha = marking coverage on the 3/4 face,
                      drawn along the face centre line (narrow on the forehead, wider
                      down the nose, wrapping the muzzle for bald).
  anim/warp/horse-<coat>.png
                      RGBA, same size as the idle-loop strip anim/horse-<coat>.png:
                      R, G = the still pixel each frame pixel shows (block matching,
                      refined to an exact colour within 1 px), B = 255 exact / 128
                      matched, A = frame opacity. The loop frames re-draw the head, so
                      the runtime reads roles, marks and patterns through this warp.

Run after art-src/portrait_anims.py (about 30 s), from the repo root:
      python3 -I apps/web/scripts/portrait-roles.py
then  pnpm --filter @thoroughbred/web art-index
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "art", "portraits")
# Inspection sheets (roles-debug, marks-debug) go here, never into the repo. The real
# recolour is the runtime one (packages/art-pipeline/src/portrait34.ts): see /dev/coats.
DEBUG_DIR = os.environ.get("PORTRAIT_DEBUG_DIR", "/tmp/portrait-roles")
FILES = ["bay", "black", "buckskin", "chestnut", "dapple_grey",
         "dark_bay", "grey", "liver_chestnut", "palomino", "roan"]

# Role ids (x28 in the R channel)
R_CLEAR, R_INK, R_LEATHER, R_METAL, R_EYE, R_COAT, R_MANE, R_MUZZLE, R_EAR = range(9)
FLAG_FACE_FRONT = 1  # B bit 0
FLAG_PAINTED_STAR = 2  # B bit 1


def lum(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def sat(a):
    mx = a[..., :3].max(-1).astype(float)
    mn = a[..., :3].min(-1).astype(float)
    return (mx - mn) / np.maximum(mx, 1)


def dilate(m, n=1):
    for _ in range(n):
        p = np.pad(m, 1)
        m = (p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
             | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:])
    return m


def poly_mask(pts, shape=(128, 128)):
    """Filled polygon mask (PIL rasteriser, deterministic)."""
    im = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([(x, y) for x, y in pts], fill=255)
    return np.array(im) > 0


def jitter_hash(x, y):
    """Deterministic 0..1 per pixel (same integer hash the runtime uses)."""
    h = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967295.0


def build_roles(L):
    bay, pal, che, blk = L["bay"], L["palomino"], L["chestnut"], L["black"]
    A = bay[..., 3] > 0
    yy, xx = np.mgrid[0:128, 0:128]
    g = lum(L["grey"][..., :3])  # shading source: the grey painting's luminance

    stack = np.stack([L[f][..., :3] for f in FILES])
    lstack = 0.299 * stack[..., 0] + 0.587 * stack[..., 1] + 0.114 * stack[..., 2]
    fixed = A & ((stack.max(0) - stack.min(0)).max(-1) < 28)
    # Every painting darkens the strap network to near-black; coat shadow is re-shaded
    # per painting. "Dark in >=8 paintings" is the bridle invariant.
    dark_count = (lstack < 60).sum(0)

    # Painted forehead star: near-white in bay/chestnut/black, low-sat, on the forehead.
    starish = A & (lum(bay) > 170) & (lum(che) > 170) & (lum(blk) > 120) & (sat(bay) < 0.30)
    starish &= (xx > 28) & (xx < 52) & (yy > 34) & (yy < 56)  # forehead window (not bridle metal)
    star = (starish & dilate(starish, 1)).copy()  # grow a ring so fringe pixels come along

    role = np.full((128, 128), R_COAT, np.uint8)
    role[~A] = R_CLEAR

    # Bridle straps (traced on the bay painting): browband+headpiece, the cheek double
    # strap, the cheek diagonal, the noseband, the mouth strap + bit ring, throatlash.
    bridle_poly = (
        poly_mask([(42, 16), (52, 16), (58, 26), (48, 38), (40, 43), (34, 38), (40, 26)]) |   # browband
        poly_mask([(50, 28), (64, 28), (64, 70), (50, 70)]) |                                  # cheek strap
        poly_mask([(52, 50), (60, 55), (30, 73), (24, 66)]) |                                  # cheek diagonal
        poly_mask([(16, 62), (58, 58), (62, 66), (56, 76), (18, 76)]) |                        # noseband
        poly_mask([(47, 64), (60, 66), (60, 92), (47, 92)]) |                                  # mouth strap + bit
        poly_mask([(74, 30), (84, 34), (84, 80), (74, 80)])                                    # throatlash
    )

    # Eye (fixed, painted): just the dark iris and the catchlight — near-black (or
    # bright white) in all ten paintings, inside the almond trace. The coat ring the
    # painter drew around the eye differs per painting; it must fall through to coat
    # (level from the grey painting) so no painted eye-surround survives a recolour.
    eye_window = poly_mask([(47, 42), (58, 41), (62, 48), (56, 54), (47, 53)]) & A
    iris = lstack.max(0) < 30   # near-black on every painting
    glint = lstack.min(0) > 170  # the catchlight, bright on every painting
    eye = (iris | glint) & dilate(eye_window, 1)

    # Mane: flood-fill connected mane pixels through the whole crest (no y cut-off).
    # Candidates are the bay painting's dark crest, the palomino's cream crest (and its
    # shaded strands) and the near-black strand ink that reads identical on every
    # painting. Three guards keep the flood honest: the silhouette's painted outline
    # ring (dark in every painting, it is ink — not hair), the eye moat, and the true
    # bridle web. A strap pixel reads dark and neutral on the bay AND the roan painting;
    # forelock hair hanging over the browband is dark in the bay but warm red on the
    # roan painting — those pixels are hair, and the flood is allowed to take them.
    edge = A & ~dilate(A, 1)
    ring = dilate(edge, 1)  # the silhouette's painted outline
    roan = L["roan"]
    roan_leak = ((roan[..., 0] - np.maximum(roan[..., 1], roan[..., 2])) > 15) & (lum(roan) < 120)
    bridle_true = bridle_poly & ~roan_leak
    cream = A & (lum(pal) > 95) & ((pal[..., 2] - pal[..., 0]) > -90)
    strand = fixed & (lum(bay) < 28) & ~ring
    baydark = A & (lum(bay) < 30) & ~ring
    mane_guard = poly_mask([(30, 16), (34, 30), (40, 40), (44, 46), (52, 52), (56, 44),
                            (70, 48), (84, 60), (94, 76), (92, 98), (80, 127), (127, 127),
                            (127, 66), (117, 57), (106, 43), (88, 31), (68, 23), (54, 19),
                            (33, 22), (30, 18)])
    cand = (cream | strand | baydark) & ~bridle_true & ~dilate(eye_window, 2) & mane_guard
    # Seeds: crest/forelock pixels whose mane identity was already provable.
    seed_core = poly_mask([(33, 22), (54, 19), (68, 23), (88, 31), (106, 43), (117, 57),
                           (117, 78), (96, 77), (84, 60), (70, 48), (56, 44), (44, 46), (33, 46)])
    mane = cand & seed_core
    while True:
        grow = dilate(mane, 1) & cand & ~mane
        if not grow.any():
            break
        mane |= grow

    # Muzzle / chin skin: in the bay it is a desaturated grey-brown patch low-left.
    muzzle = (A & (sat(bay) < 0.36) & (xx < 56) & (yy > 58) & (lum(bay) < 165)
              & ~mane & ~bridle_poly & ~star)

    # Inner ears: dark, coat-varied interiors inside the two ear outlines.
    ear_poly = poly_mask([(30, 7), (37, 11), (39, 24), (37, 30), (30, 30)]) | \
               poly_mask([(40, 5), (46, 8), (48, 22), (44, 27), (40, 24)])
    ear = A & ear_poly & ~mane & (lum(bay) < 130) & ~fixed

    mane &= ~eye
    taken = mane | eye | star
    metal_geo = dilate(bridle_poly, 1) | poly_mask([(22, 79), (31, 79), (32, 89), (22, 90)])
    # Fixed roles keep the horse's own painted pixel, so a warm tick trapped in a
    # bridle web or the ink set survives the recolour as a red speck (the blue-roan
    # leak from the lead review). Excluding them hands the pixel to coat, which
    # re-ramps dark from LEVEL anyway. Bright warm pixels (metal shine) stay.
    metal = A & ~taken & metal_geo & (sat(bay) < 0.22) & (lum(bay) > 120) & ~roan_leak
    taken |= metal
    leather = A & bridle_poly & ~taken & (dark_count >= 8) & ~roan_leak
    taken |= leather
    ink = A & fixed & ~taken & ~roan_leak  # identical across coats: silhouette outline, poll shadow
    taken |= ink
    muzzle &= ~taken
    ear &= ~taken

    role[mane] = R_MANE
    role[eye] = R_EYE
    role[metal] = R_METAL
    role[ink] = R_INK
    role[leather] = R_LEATHER
    role[ear] = R_EAR
    role[muzzle] = R_MUZZLE
    role[star] = R_COAT  # the painted star becomes plain coat; markings are drawn at runtime

    # Face-front flag: the lit face plane from under the forelock to the nose plus the
    # muzzle front — the whole plane a blaze would cover. Roan ticks never land here.
    face_front = poly_mask([(26, 30), (46, 28), (52, 38), (53, 46), (47, 60), (50, 72),
                            (46, 86), (40, 100), (34, 108), (10, 108), (10, 84), (14, 66),
                            (20, 50), (26, 38)])
    flags = np.zeros((128, 128), np.uint8)
    flags[face_front & ((role == R_COAT) | (role == R_MUZZLE) | (role == R_EAR))] |= FLAG_FACE_FRONT
    # Painted-star flag: the star and its fringe carry no painted detail into the recolour
    # (the runtime adds each painting's own shading detail everywhere else).
    flags[dilate(star, 2) & (role == R_COAT)] |= FLAG_PAINTED_STAR

    # LEVEL per role from the grey painting's luminance, 3..97 percentile normalised;
    # star pixels inherit the average of their coat neighbours (diffusion fill).
    level = g.copy()
    unknown = star.copy()
    for _ in range(40):
        if not unknown.any():
            break
        p = np.pad(level, 1)
        up = np.pad(~unknown, 1)
        s = (p[1:-1, 1:-1] * up[1:-1, 1:-1] + p[:-2, 1:-1] * up[:-2, 1:-1] + p[2:, 1:-1] * up[2:, 1:-1]
             + p[1:-1, :-2] * up[1:-1, :-2] + p[1:-1, 2:] * up[1:-1, 2:])
        c = (up[1:-1, 1:-1] + up[:-2, 1:-1] + up[2:, 1:-1] + up[1:-1, :-2] + up[1:-1, 2:])
        fill = unknown & (c > 0)
        level[fill] = s[fill] / c[fill]
        unknown[fill] = False

    lv = np.zeros((128, 128), np.uint8)
    for r in (R_COAT, R_MANE, R_MUZZLE, R_EAR, R_EYE, R_METAL, R_LEATHER, R_INK):
        m = role == r
        if not m.any():
            continue
        v = level[m]
        lo, hi = np.percentile(v, 3), np.percentile(v, 97)
        lv[m] = np.clip((level[m] - lo) / max(hi - lo, 1e-6), 0, 1) * 255

    return role, flags, lv, A, star


def build_marks(A):
    yy, xx = np.mgrid[0:128, 0:128]
    J = np.vectorize(jitter_hash)(xx, yy)
    marks = np.zeros((640, 128, 4), np.uint8)

    def cx_of(y):  # face centre line turning with the head
        t = np.clip((y - 46) / 40.0, 0, 1)
        return 39.0 - 15.0 * t if y <= 86 else 24.0 - 4.0 * np.clip((y - 86) / 14.0, 0, 1)

    def fill_band(i, mask):
        band = marks[i * 128:(i + 1) * 128]
        band[..., 0] = 255
        band[..., 1] = 255
        band[..., 2] = 255
        band[..., 3] = np.where(mask, 255, 0)

    # star: a small solid diamond on the forehead (where the painted star sat), with a
    # ragged rim only (no holes inside: holes read as a dotted disc at 64 px).
    dia = np.abs(xx + 0.5 - 39.0) / 3.4 + np.abs(yy + 0.5 - 43.5) / 4.4
    st = (dia < 0.8) | ((dia < 1.05) & (J > 0.45))
    fill_band(0, st)

    # snip: white on the upper lip between the nostrils, at the muzzle front.
    el = ((xx + 0.5 - 21.0) / 3.2) ** 2 + ((yy + 0.5 - 87.5) / 4.6) ** 2
    sn = (el < 0.75) | ((el < 1.1) & (J > 0.45))
    fill_band(1, sn)

    # stripe / blaze: follow the centre line forehead -> nose; narrow above, wider below,
    # ragged pixel edges so it reads painted, not stamped.
    def banded(w_hi, w_lo, y0=46, y1=99, rag=0.55):
        c = np.array([cx_of(y) for y in range(128)])[:, None]
        w = np.where(yy < 68, w_hi, w_hi + (w_lo - w_hi) * np.clip((yy - 68) / 22.0, 0, 1))
        dist = np.abs(xx - c) - (w / 2.0)
        return ((dist < 0) | ((dist < 1.0) & (J > rag))) & (yy >= y0) & (yy <= y1)

    fill_band(2, banded(2.6, 3.6))
    bl = banded(5.4, 8.0)
    bl |= (((xx - 23.0) / 8.0) ** 2 + ((yy - 92.0) / 6.5) ** 2 < 1.0) & (J > 0.25)  # spills over muzzle
    fill_band(3, bl)

    # bald: the whole face front (up the forehead under the forelock), wrapping the muzzle.
    ba = poly_mask([(27, 42), (47, 36), (52, 50), (46, 66), (40, 80), (36, 92),
                    (30, 104), (11, 104), (10, 82), (15, 66), (20, 52)])
    ba |= (((xx - 22.0) / 11.0) ** 2 + ((yy - 92.0) / 10.0) ** 2 < 1.0)
    ragged = dilate(ba) & ~ba & (J > 0.4)
    fill_band(4, (ba | ragged))

    for i in range(5):  # never outside the horse
        band = marks[i * 128:(i + 1) * 128]
        band[..., 3] = np.where(A & (band[..., 3] > 0), band[..., 3], 0)
    return marks


def debug_outputs(L, role, flags, marks, A):
    cmap = {R_CLEAR: (0, 0, 0), R_INK: (30, 30, 30), R_LEATHER: (160, 70, 210),
            R_METAL: (60, 210, 245), R_EYE: (255, 220, 0), R_COAT: (200, 110, 40),
            R_MANE: (20, 205, 90), R_MUZZLE: (225, 90, 165), R_EAR: (95, 130, 255)}
    dbg = np.zeros((128, 128, 4), np.uint8)
    dbg[..., 3] = 255
    for r, c in cmap.items():
        dbg[role == r, :3] = c
    ff = flags & 1 > 0
    dbg[ff, :3] = (dbg[ff, :3] * 0.35 + 165).astype(np.uint8)
    sheet = Image.new("RGBA", (512 + 16, 512 + 16), (40, 30, 24, 255))
    sheet.alpha_composite(Image.fromarray(dbg).resize((512, 512), Image.NEAREST), (8, 8))
    sheet.save(os.path.join(DEBUG_DIR, "roles-debug.png"))

    lv_img = np.zeros((128, 128, 4), np.uint8)
    lv_img[..., 3] = 255
    bands = marks.reshape(640, 128, 4)
    msheet = Image.new("RGBA", (132 * 5 + 4, 136), (40, 30, 24, 255))
    for i in range(5):
        b = Image.fromarray(bands[i * 128:(i + 1) * 128])
        base = Image.fromarray(L["bay"].astype(np.uint8)).resize((128, 128), Image.NEAREST)
        base.alpha_composite(b)
        msheet.alpha_composite(base, (i * 132 + 2, 4))
    msheet.resize((msheet.width * 2, msheet.height * 2), Image.NEAREST).save(os.path.join(DEBUG_DIR, "marks-debug.png"))


WARP_R = 8  # largest per-pixel displacement searched (art px)
WARP_PATCH = 7  # block-matching window (art px, odd)


def box_sum(a, k):
    """Sum over a k x k window centred on each pixel (zero padded)."""
    r = k // 2
    p = np.pad(a, r)
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    H, W = a.shape
    return c[k:k + H, k:k + W] - c[0:H, k:k + W] - c[k:k + H, 0:W] + c[0:H, 0:W]


def median3(a, k=5):
    r = k // 2
    p = np.pad(a, r, mode="edge")
    H, W = a.shape
    stack = np.stack([p[y:y + H, x:x + W] for y in range(k) for x in range(k)])
    return np.median(stack, axis=0)


def build_warp(still, frame):
    """Per-pixel source in the still for one animation frame (block matching, then a
    median-smoothed flow refined to an exact colour match within 1 px).

    The PixelLab idle frames re-draw the head (blink, ear flick, a small head turn), so the
    role map cannot be read at the same (x, y). Each frame pixel instead points at the still
    pixel it shows; the runtime reads role, LEVEL, flags, marks and patterns there.
    Returns (sx, sy, exact) arrays; frame-transparent pixels are (0, 0, False).
    """
    S = still.astype(float)
    F = frame.astype(float)
    fa = F[..., 3] > 0
    sa = S[..., 3] > 0
    H, W = fa.shape
    best = np.full((H, W), np.inf)
    bdx = np.zeros((H, W), int)
    bdy = np.zeros((H, W), int)
    Sp = np.pad(S, ((WARP_R, WARP_R), (WARP_R, WARP_R), (0, 0)))
    for dy in range(-WARP_R, WARP_R + 1):
        for dx in range(-WARP_R, WARP_R + 1):
            sh = Sp[WARP_R + dy:WARP_R + dy + H, WARP_R + dx:WARP_R + dx + W]
            d = np.abs(F[..., :3] - sh[..., :3]).sum(-1)
            d = np.where(sh[..., 3] > 0, d, 300.0)  # landing outside the horse
            d = np.where(fa, d, 0.0)
            cost = box_sum(d, WARP_PATCH) + 6.0 * (abs(dx) + abs(dy))
            better = cost < best
            best = np.where(better, cost, best)
            bdx = np.where(better, dx, bdx)
            bdy = np.where(better, dy, bdy)
    fdx = np.round(median3(bdx.astype(float))).astype(int)
    fdy = np.round(median3(bdy.astype(float))).astype(int)
    yy, xx = np.mgrid[0:H, 0:W]
    sx = np.clip(xx + fdx, 0, W - 1)
    sy = np.clip(yy + fdy, 0, H - 1)
    # refine: an exact colour match within 1 px of the smoothed flow wins (nearest first)
    exact = np.zeros((H, W), bool)
    rx, ry = sx.copy(), sy.copy()
    for oy, ox in sorted(((oy, ox) for oy in (-1, 0, 1) for ox in (-1, 0, 1)), key=lambda o: abs(o[0]) + abs(o[1])):
        cx = np.clip(sx + ox, 0, W - 1)
        cy = np.clip(sy + oy, 0, H - 1)
        hit = fa & ~exact & sa[cy, cx] & (np.abs(S[cy, cx, :3] - F[..., :3]).sum(-1) == 0)
        rx = np.where(hit, cx, rx)
        ry = np.where(hit, cy, ry)
        exact |= hit
    # never point at a transparent still pixel: fall back to the nearest opaque one
    bad = fa & ~sa[ry, rx]
    if bad.any():
        oy, ox = np.nonzero(sa)
        for y, x in zip(*np.nonzero(bad)):
            k = np.argmin((oy - ry[y, x]) ** 2 + (ox - rx[y, x]) ** 2)
            ry[y, x], rx[y, x] = oy[k], ox[k]
    rx = np.where(fa, rx, 0)
    ry = np.where(fa, ry, 0)
    return rx, ry, exact & fa


def build_warps(L):
    """anim/warp/horse-<coat>.png: one warp per animated strip, same size as the strip.
    R = source x, G = source y in the 128 px still, B = 255 exact colour match / 128
    block-matched only, A = 255 where the frame is opaque."""
    anim_dir = os.path.join(OUT, "anim")
    warp_dir = os.path.join(anim_dir, "warp")
    os.makedirs(warp_dir, exist_ok=True)
    stats = {}
    for f in FILES:
        p = os.path.join(anim_dir, "horse-%s.png" % f)
        if not os.path.exists(p):
            continue
        strip = np.array(Image.open(p).convert("RGBA")).astype(int)
        n = strip.shape[1] // 128
        out = np.zeros((128, 128 * n, 4), np.uint8)
        cache = {}
        exact_n = 0
        total = 0
        for i in range(n):
            fr = strip[:, i * 128:(i + 1) * 128]
            key = fr.tobytes()
            if key not in cache:  # ping-pong strips repeat frames
                cache[key] = build_warp(L[f], fr)
            rx, ry, ex = cache[key]
            fa = fr[..., 3] > 0
            band = out[:, i * 128:(i + 1) * 128]
            band[..., 0] = rx
            band[..., 1] = ry
            band[..., 2] = np.where(ex, 255, np.where(fa, 128, 0))
            band[..., 3] = np.where(fa, 255, 0)
            exact_n += int(ex.sum())
            total += int(fa.sum())
        Image.fromarray(out, "RGBA").save(os.path.join(warp_dir, "horse-%s.png" % f), optimize=True)
        stats[f] = round(exact_n / max(total, 1), 3)
    return stats


def main():
    os.makedirs(DEBUG_DIR, exist_ok=True)
    L = {f: np.array(Image.open(os.path.join(OUT, "horse-%s.png" % f)).convert("RGBA")).astype(int)
         for f in FILES}
    role, flags, lv, A, star = build_roles(L)
    marks = build_marks(A)

    out = np.zeros((128, 128, 4), np.uint8)
    out[..., 0] = role * 28
    out[..., 1] = lv
    out[..., 2] = flags
    out[..., 3] = 255
    Image.fromarray(out, "RGBA").save(os.path.join(OUT, "roles.png"))
    Image.fromarray(marks, "RGBA").save(os.path.join(OUT, "portrait-marks.png"))
    debug_outputs(L, role, flags, marks, A)
    print("roles", {r: int((role == r).sum()) for r in range(9)}, "star", int(star.sum()))
    print("warps (share of frame pixels with an exact colour source)", build_warps(L))


if __name__ == "__main__":
    main()
