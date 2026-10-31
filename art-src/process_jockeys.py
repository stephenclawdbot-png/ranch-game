"""Jockey portraits: chosen PixelLab busts -> keyed, served portraits.

    python3 -I art-src/process_jockeys.py

Each pick (art-src/raw/jockeys/<id>-<seed>-<n>.png, 128x128) is generated in KEY silks: a magenta
jersey, cyan sleeves and a magenta cap. This snaps those pixels to the exact silks key ramps of
apps/web/public/art/race/palette.json (silksPrimary, silksSecondary, cap; dark -> light by
luminance), so the web app's existing recolour (recolorMap / applyRecolor) paints every jockey
in their stable's silks. Everything else (face, hair, collar, goggles, outline) is untouched.
Output: apps/web/public/art/portraits/jockeys/<id>.png (palette PNG when it fits).
"""
import colorsys
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/jockeys")
OUT = os.path.join(ROOT, "apps/web/public/art/portraits/jockeys")
PALETTE = json.load(open(os.path.join(ROOT, "apps/web/public/art/race/palette.json")))

# id -> chosen raw file (stem). Apprentices a-*, prime j-*, veterans v-*; f/m in jockeyPortraits.ts.
PICKS = {
    "a-freckled-lad": "a-freckled-lad-9101-0",
    "a-young-woman-braid": "a-young-woman-braid-9102-2",
    "a-shy-lad": "a-shy-lad-9103-0",
    "a-bright-girl": "a-bright-girl-9104-0",
    "a-lanky-lad": "a-lanky-lad-9105-3",
    "a-blonde-girl": "a-blonde-girl-9106-1",
    "j-calm-man": "j-calm-man-9107-1",
    "j-sharp-woman": "j-sharp-woman-9108-2",
    "j-grinning-man": "j-grinning-man-9109-0",
    "j-stern-woman": "j-stern-woman-9110-0",
    "j-irish-man": "j-irish-man-9111-0",
    "j-moustache-man": "j-moustache-man-9112-2",
    "j-kind-woman": "j-kind-woman-9113-0",
    "j-scar-man": "j-scar-man-9114-2",
    "j-glasses-woman": "j-glasses-woman-9115-1",
    "j-curly-man": "j-curly-man-9116-2",
    "j-focused-woman": "j-focused-woman-9117-2",
    "j-pale-man": "j-pale-man-9118-2",
    "v-grey-man": "v-grey-man-9119-0",
    "v-silver-woman": "v-silver-woman-9120-1",
    "v-craggy-man": "v-craggy-man-9121-3",
    "v-wily-man": "v-wily-man-9122-2",
    "v-steely-woman": "v-steely-woman-9123-1",
    "v-jolly-man": "v-jolly-man-9124-1",
    "v-wise-woman": "v-wise-woman-9125-1",
    "a-quiet-girl": "a-quiet-girl-9126-1",
    "j-ginger-woman": "j-ginger-woman-9127-3",
}


def hexrgb(h):
    n = int(h[1:], 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


KEYS = {role: [hexrgb(h) for h in PALETTE[role]] for role in ("silksPrimary", "silksSecondary", "cap")}
# share of each ramp step, dark -> light (shadows and highlights are the small ends)
SHARES = {5: [0.12, 0.22, 0.36, 0.2, 0.1], 4: [0.15, 0.4, 0.33, 0.12]}


def hsv(p):
    return colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)


def is_magenta(p):
    """Magenta key and its pink sheen (hue 285..360/0..5)."""
    h, s, v = hsv(p)
    return (h >= 285 / 360 or h <= 5 / 360) and s >= 0.2 and v >= 0.2


def is_cyan(p):
    h, s, v = hsv(p)
    return 160 / 360 <= h <= 210 / 360 and s >= 0.2 and v >= 0.22


def is_pure_key(p):
    """Unmistakable key colour (no face is saturated magenta or cyan): keyed even next to the face."""
    h, s, v = hsv(p)
    return s >= 0.55 and v >= 0.25 and (290 / 360 <= h <= 340 / 360 or 170 / 360 <= h <= 200 / 360)


def is_skin(p):
    """Skin, lips and warm hair tones (they share the key's red end, so faces are masked out)."""
    h, s, v = hsv(p)
    return 5 / 360 < h <= 55 / 360 and s >= 0.12 and v >= 0.15


def face_mask(px, w, h):
    """The face (largest warm region), holes filled (blush, lips, eyes) and grown by 2 px."""
    skin = {(x, y) for y in range(h) for x in range(w) if px[x, y][3] and is_skin(px[x, y])}
    comps = sorted(components(skin, w, h), key=len, reverse=True)
    face = set()
    for comp in comps:
        if len(comp) < 120:
            break
        face.update(comp)
        xs = [c[0] for c in comp]
        ys = [c[1] for c in comp]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        cs = set(comp)
        # flood the bbox's outside; whatever it can't reach is a hole in the face
        out, stack = set(), [(x, y) for x in range(x0, x1 + 1) for y in (y0, y1)] + [(x, y) for y in range(y0, y1 + 1) for x in (x0, x1)]
        stack = [q for q in stack if q not in cs]
        out.update(stack)
        while stack:
            x, y = stack.pop()
            for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if x0 <= q[0] <= x1 and y0 <= q[1] <= y1 and q not in cs and q not in out:
                    out.add(q)
                    stack.append(q)
        face.update((x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if (x, y) not in out)
    for _ in range(2):
        face |= {(x + dx, y + dy) for x, y in face for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    return face


def lum(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def components(mask, w, h):
    seen = set()
    comps = []
    for start in mask:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in mask and q not in seen:
                        seen.add(q)
                        stack.append(q)
        comps.append(comp)
    return comps


def key_role(px, coords, keys):
    """Snap the pixels at coords to the key ramp by luminance rank."""
    if not coords:
        return
    order = sorted(coords, key=lambda c: lum(px[c]))
    shares = SHARES[len(keys)]
    bounds, acc = [], 0.0
    for s in shares:
        acc += s
        bounds.append(acc * len(order))
    for i, c in enumerate(order):
        k = next(j for j, b in enumerate(bounds) if i < b + 1e-9)
        a = px[c][3]
        px[c] = (*keys[min(k, len(keys) - 1)], a)


def process(stem):
    im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGBA")
    w, h = im.size
    px = im.load()
    # hard alpha (pixel art): 0 or 255
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= 128 else 0)
    face = face_mask(px, w, h)
    mag = {(x, y) for y in range(h) for x in range(w) if px[x, y][3] and ((x, y) not in face or is_pure_key(px[x, y])) and is_magenta(px[x, y])}
    cyan = {(x, y) for y in range(h) for x in range(w) if px[x, y][3] and ((x, y) not in face or is_pure_key(px[x, y])) and is_cyan(px[x, y])}
    role = {}
    for comp in components(mag, w, h):
        if len(comp) < 6:
            continue
        cy = sum(c[1] for c in comp) / len(comp)
        top = min(c[1] for c in comp)
        r = "cap" if cy < 0.42 * h and top < 0.4 * h else "silksPrimary"
        role.update((c, r) for c in comp)
    role.update((c, "silksSecondary") for c in cyan)
    grow(px, role, w, h)
    enclosed(px, role, face, w, h)
    for r in KEYS:
        key_role(px, [c for c, rr in role.items() if rr == r], KEYS[r])
    count = lambda r: sum(1 for v in role.values() if v == r)
    im.face = face_box(face, [c for c, r in role.items() if r == "cap"], w, h)
    return im, count("silksPrimary"), count("silksSecondary"), count("cap")


FACE = 56


def face_box(face, cap, w, h):
    """A FACE x FACE head crop: from the crown of the cap to the chin, centred on the face."""
    xs = [x for x, _ in face]
    cx = (min(xs) + max(xs)) // 2
    top = min(y for _, y in cap) + 16 if cap else min(y for _, y in face)
    x = max(0, min(w - FACE, cx - FACE // 2))
    y = max(0, min(h - FACE, top))
    return [x, y]


def enclosed(px, role, face, w, h):
    """Glint patches (peach, lilac) lying inside the silks: a small unkeyed patch whose border is
    mostly keyed silks takes its neighbours' role."""
    cand = set()
    for y in range(h):
        for x in range(w):
            if (x, y) in role or (x, y) in face or not px[x, y][3]:
                continue
            _, ss, vv = hsv(px[x, y])
            if vv < 0.22 or (ss < 0.15 and vv > 0.8):
                continue
            cand.add((x, y))
    for comp in components(cand, w, h):
        if len(comp) > 80:
            continue
        cs = set(comp)
        border = {(x + dx, y + dy) for x, y in comp for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - cs
        keyed = [role[q] for q in border if q in role]
        if border and len(keyed) >= 0.7 * len(border):
            r = max(set(keyed), key=keyed.count)
            role.update((c, r) for c in comp)


def grow(px, role, w, h, passes=4):
    """Pull in the silks' own sheen (pink, orange or lilac glints the strict hue test misses):
    an unkeyed, coloured pixel mostly surrounded by keyed silks joins its neighbours' role. Skin
    and hair at the cap's edge have few keyed neighbours, so faces stay untouched."""
    for _ in range(passes):
        add = {}
        for y in range(h):
            for x in range(w):
                if (x, y) in role or not px[x, y][3]:
                    continue
                hh, ss, vv = hsv(px[x, y])
                if vv < 0.22 or (ss < 0.15 and vv > 0.8):
                    continue  # outline ink, white collar
                near = [role[q] for q in ((x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy) if q in role]
                if len(near) >= 5:
                    add[(x, y)] = max(set(near), key=near.count)
        if not add:
            break
        role.update(add)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    index_file = os.path.join(OUT, "index.json")
    index = json.load(open(index_file))["cast"] if os.path.exists(index_file) else {}
    for pid, stem in PICKS.items():
        if only and pid not in only:
            continue
        if not os.path.exists(os.path.join(RAW, stem + ".png")):
            print(pid, "MISSING", stem)
            continue
        im, nb, nc, ncap = process(stem)
        colours = im.getcolors(256)
        out = os.path.join(OUT, pid + ".png")
        if colours is not None and len(colours) < 256:
            # exact palette PNG, built by hand so no colour moves
            to_palette(im).save(out, optimize=True, transparency=0)
        else:
            im.save(out, optimize=True)
        print(pid, stem, "body", nb, "sleeves", nc, "cap", ncap, "colours", len(colours) if colours else ">256")
        index[pid] = {
            "stage": {"a": "apprentice", "j": "prime", "v": "veteran"}[pid[0]],
            "presents": "f" if ("woman" in pid or "girl" in pid) else "m",
            "face": im.face,
        }
    index = {k: index[k] for k in PICKS if k in index}
    with open(index_file, "w") as f:
        json.dump({"size": 128, "faceSize": FACE, "cast": index}, f, indent=1)


def to_palette(im):
    """RGBA with hard alpha -> P image with index 0 transparent, every other colour exact."""
    w, h = im.size
    src = im.load()
    colours = {}
    out = Image.new("P", (w, h), 0)
    dst = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            c = (r, g, b)
            if c not in colours:
                colours[c] = len(colours) + 1
            dst[x, y] = colours[c]
    pal = [0, 0, 0]
    for c, _ in sorted(colours.items(), key=lambda kv: kv[1]):
        pal.extend(c)
    pal.extend([0, 0, 0] * (256 - len(pal) // 3))
    out.putpalette(pal)
    return out


if __name__ == "__main__":
    main()
