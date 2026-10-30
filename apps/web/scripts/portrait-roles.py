#!/usr/bin/env python3
"""Build the genetic-portrait role map and face-marking masks (offline, deterministic).

All ten painted 3/4 head portraits share one 128x128 silhouette, so a pixel's meaning
can be derived by comparing the paintings:

  roles.png           RGBA, 128x128. R = role id x 28, G = shading LEVEL 0..255
                      (grey-painting luminance normalised inside the role), B = flags
                      (bit 0: face-front plane). Roles: 0 transparent, 1 outline/ink,
                      2 bridle leather, 3 bridle metal, 4 eye, 5 coat, 6 mane,
                      7 muzzle/skin, 8 inner ear. Runtime swaps coat/mane/muzzle/ear
                      (and eye, when the genes set it) and keeps fixed roles painted.
  portrait-marks.png  RGBA, 128x640: five 128x128 bands (star, snip, stripe, blaze,
                      bald). White pixels, alpha = marking coverage on the 3/4 face,
                      drawn along the face centre line (narrow on the forehead, wider
                      down the nose, wrapping the muzzle for bald).

Run:  python3 -I apps/web/scripts/portrait-roles.py
then  pnpm --filter @thoroughbred/web art-index
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "art", "portraits")
# Inspection sheets (roles-debug, marks-debug, preview) go here, never into the repo.
DEBUG_DIR = os.environ.get("PORTRAIT_DEBUG_DIR", "/tmp/portrait-roles")
FILES = ["bay", "black", "buckskin", "chestnut", "dapple_grey",
         "dark_bay", "grey", "liver_chestnut", "palomino", "roan"]

# Role ids (x28 in the R channel)
R_CLEAR, R_INK, R_LEATHER, R_METAL, R_EYE, R_COAT, R_MANE, R_MUZZLE, R_EAR = range(9)
FLAG_FACE_FRONT = 1  # B bit 0


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

    # star: a ragged diamond on the forehead (where the painted star sat).
    st = ((((xx - 39.0) / 4.2) ** 2 + ((yy - 44.5) / 5.2) ** 2 < 1.0) & (J > 0.12)
          | ((xx - 39.0) ** 2 + (yy - 44.5) ** 2 < 6.0))
    fill_band(0, st)

    # snip: a small patch on the muzzle front, over the nostril lip.
    sn = ((((xx - 24.0) / 5.5) ** 2 + ((yy - 90.0) / 4.2) ** 2 < 1.0) & (J > 0.15)
          | ((xx - 24.0) ** 2 + (yy - 90.0) ** 2 < 5.0))
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


def hx(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def ramp(t, shade, base, hi):
    t = t[..., None]
    s, b, h = hx(shade), hx(base), hx(hi)
    dk = s * 0.55
    return np.where(t < 0.25, dk + (s - dk) * (t / 0.25),
                    np.where(t < 0.6, s + (b - s) * ((t - 0.25) / 0.35), b + (h - b) * ((t - 0.6) / 0.4)))


def preview(L, role, flags, lv, marks, A):
    """Mirror of the runtime recolour, for build-time inspection only."""
    yy, xx = np.mgrid[0:128, 0:128]
    # Anchor palettes == resolveHorseColors() for the six lead-review /dev/coats cells.
    P = {
        "bay": dict(body="#8a4527", shade="#5a2a16", hi="#b5683d", mane="#17100d", muzzle="#3b1000", eye=None),
        "black": dict(body="#1f1c1c", shade="#0f0d0d", hi="#47403e", mane="#0b0a0a", muzzle="#060404", eye=None),
        "palomino": dict(body="#d9b56a", shade="#a8843f", hi="#f0d48f", mane="#f3ead2", muzzle="#6d4d00", eye=None),
        "cremello": dict(body="#efe4c8", shade="#d2c3a0", hi="#fbf4e2", mane="#f6efdd", muzzle="#d9a99a", eye="#7fa8c9"),
        "chestnut": dict(body="#a4552b", shade="#73371a", hi="#d07f47", mane="#c58a4d", muzzle="#4a1900", eye=None),
        "grey": dict(body="#b4b3ae", shade="#83827d", hi="#dddcd6", mane="#5f5e5b", muzzle="#4b4846", eye=None),
        "buckskin": dict(body="#c9a063", shade="#94713b", hi="#e2bf82", mane="#1c1612", muzzle="#4a3a2c", eye=None),
    }

    def mane_stops(mane):
        m = hx(mane)
        hexc = lambda v: "#%02x%02x%02x" % tuple(np.clip(v, 0, 255).astype(int))
        if m.dot([0.299, 0.587, 0.114]) > 110:  # flaxen/cream: darker shade, pale sheen
            return hexc(m * 0.55 + hx("#6b5236") * 0.45), mane, hexc(m * 0.8 + 255 * 0.2)
        return "#000000", mane, hexc(m * 0.75 + hx("#8a6a50") * 0.25)

    def render(p, base, mark=None, roan=False):
        out = L[base].copy().astype(float)  # fixed roles keep the horse's own painting
        t = lv / 255.0
        coat = ramp(t, p["shade"], p["body"], p["hi"])
        if roan:
            tick = (role == R_COAT) & ~(flags & 1).astype(bool) & (np.vectorize(jitter_hash)(xx >> 1, yy >> 1) > 0.70)
            coat = np.where(tick[..., None], coat * 0.45 + np.array([244, 241, 232]) * 0.55, coat)
        ms, mb, mh = mane_stops(p["mane"])
        mane = ramp(t, ms, mb, mh)
        muz = ramp(t, p["muzzle"], p["muzzle"], p["shade"]) * 0.9 + coat * 0.1
        ear = ramp(np.clip(t * 0.62, 0, 1), p["shade"], p["body"], p["hi"])
        out[..., :3] = np.where((role == R_COAT)[..., None], coat, out[..., :3])
        out[..., :3] = np.where((role == R_MANE)[..., None], mane, out[..., :3])
        out[..., :3] = np.where((role == R_MUZZLE)[..., None], muz, out[..., :3])
        out[..., :3] = np.where((role == R_EAR)[..., None], ear, out[..., :3])
        if p["eye"]:
            e = hx(p["eye"])
            eye = ramp(t, "#%02x%02x%02x" % tuple((e * 0.5).astype(int)), p["eye"],
                       "#%02x%02x%02x" % tuple((e * 0.7 + 255 * 0.3).astype(int)))
            out[..., :3] = np.where((role == R_EYE)[..., None], eye, out[..., :3])
        if mark is not None:
            i = ["star", "snip", "stripe", "blaze", "bald"].index(mark)
            m = marks[i * 128:(i + 1) * 128, :, 3] > 0
            white = hx("#f3f0e8") * (0.82 + 0.18 * t)[..., None]
            out[..., :3] = np.where(m[..., None], white, out[..., :3])
        return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")

    # The six lead-review cells: Bay, Palomino, Blue roan, Chestnut + blaze,
    # Bay + bald, Black + stripe.
    cells = [render(P["bay"], "bay"), render(P["palomino"], "palomino"),
             render(P["black"], "roan", roan=True),
             render(P["chestnut"], "chestnut", mark="blaze"), render(P["bay"], "bay", mark="bald"),
             render(P["black"], "black", mark="stripe")]
    S = 3
    sheet = Image.new("RGBA", (128 * S * 6 + 20, 128 * S + 30), (23, 18, 14, 255))
    for i, im in enumerate(cells):
        sheet.alpha_composite(im.resize((128 * S, 128 * S), Image.NEAREST), (i * 128 * S + 5, 5))
    sheet.save(os.path.join(DEBUG_DIR, "preview.png"))


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
    preview(L, role, flags, lv, marks, A)
    print("roles", {r: int((role == r).sum()) for r in range(9)}, "star", int(star.sum()))


if __name__ == "__main__":
    main()
