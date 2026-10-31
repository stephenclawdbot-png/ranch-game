"""Jockey base faces: chosen PixelLab busts -> keyed, layered portraits (graphics round 2).

    python3 -I art-src/process_jockeys.py [id ...]

Each pick (art-src/raw/jockeys/<id>-<seed>-<n>.png, 128x128, art-src/gen-jockey-faces.mjs) is
painted with key colours. This snaps every recolourable layer to exact key ramps, so the game can
draw any jockey from a base face plus a look (skin tone, hair colour, accessories, silks):

  silks    magenta jacket / cyan sleeves / magenta cap -> race/palette.json silksPrimary,
           silksSecondary, cap (dark -> light by luminance)
  hair     the lime-green key (hair, eyebrows, beards) -> HAIR_KEYS (6 levels)
  skin     the warm skin of the face, ears and neck -> SKIN_KEYS (8 levels, by luminance rank)
  lips     the reddest pixels of the lower face -> LIP_KEYS (3 levels)

Everything else (eyes, teeth, ink outline, the white stock) is untouched. It also measures the
anchors the accessory layers need (eyes for spectacles, the mouth for a moustache) and the
painting's own skin tone, and writes:

  apps/web/public/art/portraits/jockeys/<id>.png     the keyed bust (palette PNG)
  apps/web/public/art/portraits/jockeys/index.json   keys, head crop and anchors per face
  packages/game-core/src/jockeyFaces.json            the face catalogue the game assigns from
"""
import colorsys
import json
import os
import re
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/jockeys")
OUT = os.path.join(ROOT, "apps/web/public/art/portraits/jockeys")
CATALOGUE = os.path.join(ROOT, "packages/game-core/src/jockeyFaces.json")
PALETTE = json.load(open(os.path.join(ROOT, "apps/web/public/art/race/palette.json")))
PICKS_FILE = os.path.join(ROOT, "art-src/jockey_picks.json")

# Key ramps (dark -> light). Plausible colours, so the served file reads as a person.
SKIN_KEYS = ["#5a3324", "#77452f", "#94593c", "#ad6e4d", "#c58662", "#d89d79", "#e6b392", "#f1caae"]
LIP_KEYS = ["#6b2b2d", "#93403f", "#b85a55"]
HAIR_KEYS = ["#24160d", "#3b2516", "#55361f", "#70492b", "#8d6039", "#ad7c4f"]

# Skin tones (game-core JOCKEY_SKINS base colours) to estimate each painting's own tone.
SKIN_BASES = {
    "porcelain": "#ecc5b2", "fair": "#e2b096", "rose": "#d39a80", "olive": "#c39466",
    "tan": "#a8724a", "bronze": "#8c5a36", "brown": "#6c4228", "deep": "#46291b",
}


def hexrgb(h):
    n = int(h[1:], 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


KEYS = {role: [hexrgb(h) for h in PALETTE[role]] for role in ("silksPrimary", "silksSecondary", "cap")}
KEYS["skin"] = [hexrgb(h) for h in SKIN_KEYS]
KEYS["lip"] = [hexrgb(h) for h in LIP_KEYS]
KEYS["hair"] = [hexrgb(h) for h in HAIR_KEYS]
ALL_KEYS = {c for ramp in KEYS.values() for c in ramp}
SHARES = {5: [0.12, 0.22, 0.36, 0.2, 0.1], 4: [0.15, 0.4, 0.33, 0.12]}
FACE = 56


def hsv(p):
    return colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)


def lum(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def is_magenta(p):
    h, s, v = hsv(p)
    return ((285 / 360 <= h <= 345 / 360) and s >= 0.2 and v >= 0.2) or ((h > 345 / 360 or h <= 5 / 360) and s >= 0.5 and v >= 0.35)


def is_cyan(p):
    h, s, v = hsv(p)
    return 172 / 360 <= h <= 210 / 360 and s >= 0.2 and v >= 0.22


def is_pure_key(p):
    h, s, v = hsv(p)
    return s >= 0.55 and v >= 0.25 and (290 / 360 <= h <= 340 / 360 or 172 / 360 <= h <= 200 / 360)


def is_green(p):
    """The lime-green hair key (and its yellow-green edge)."""
    h, s, v = hsv(p)
    r, g, b = p[:3]
    return 52 / 360 <= h <= 168 / 360 and s >= 0.28 and v >= 0.16 and g >= r and g > b


def is_skin(p):
    h, s, v = hsv(p)
    return (h <= 52 / 360 or h >= 345 / 360) and s >= 0.12 and v >= 0.1 and not (285 / 360 <= h <= 345 / 360)


def is_lip(p):
    h, s, v = hsv(p)
    return (h >= 340 / 360 or h <= 14 / 360) and s >= 0.36 and v >= 0.2


def components(mask):
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


def fill_holes(comp):
    xs = [c[0] for c in comp]
    ys = [c[1] for c in comp]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cs = set(comp)
    stack = [(x, y) for x in range(x0, x1 + 1) for y in (y0, y1)] + [(x, y) for y in range(y0, y1 + 1) for x in (x0, x1)]
    stack = [q for q in stack if q not in cs]
    out = set(stack)
    while stack:
        x, y = stack.pop()
        for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if x0 <= q[0] <= x1 and y0 <= q[1] <= y1 and q not in cs and q not in out:
                out.add(q)
                stack.append(q)
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if (x, y) not in out}


def key_role(px, coords, keys, shares=None):
    """Snap the pixels at coords to the key ramp by luminance rank (even shares unless given)."""
    if not coords:
        return
    order = sorted(coords, key=lambda c: (lum(px[c]), c))
    n = len(keys)
    shares = shares or [1 / n] * n
    bounds, acc = [], 0.0
    for s in shares:
        acc += s
        bounds.append(acc * len(order))
    for i, c in enumerate(order):
        k = next((j for j, b in enumerate(bounds) if i < b + 1e-9), n - 1)
        px[c] = (*keys[min(k, n - 1)], px[c][3])


def grow(px, role, w, h, passes=4):
    for _ in range(passes):
        add = {}
        for y in range(h):
            for x in range(w):
                if (x, y) in role or not px[x, y][3]:
                    continue
                hh, ss, vv = hsv(px[x, y])
                if vv < 0.22 or (ss < 0.15 and vv > 0.8):
                    continue
                near = [role[q] for q in ((x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy) if q in role]
                if len(near) >= 5:
                    add[(x, y)] = max(set(near), key=near.count)
        if not add:
            break
        role.update(add)


def nearest_tone(rgb):
    best, bd = None, 1e9
    for name, hx in SKIN_BASES.items():
        c = hexrgb(hx)
        d = sum((a - b) ** 2 for a, b in zip(rgb, c))
        if d < bd:
            best, bd = name, d
    return best


def process(stem):
    im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGBA")
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a >= 128 else 0)
    opaque = {(x, y) for y in range(h) for x in range(w) if px[x, y][3]}
    hair = {c for c in opaque if is_green(px[c])}
    # yellow-green fringe pixels touching the key join it
    for _ in range(2):
        hair |= {c for c in opaque - hair if any((c[0] + dx, c[1] + dy) in hair for dx in (-1, 0, 1) for dy in (-1, 0, 1)) and hsv(px[c])[0] * 360 <= 75 and hsv(px[c])[1] >= 0.35 and px[c][1] >= px[c][0] * 0.85}
    # skin: the big warm components (face, ears, neck), holes filled (eyes, mouth)
    warm = {c for c in opaque - hair if is_skin(px[c]) and not is_pure_key(px[c])}
    comps = sorted(components(warm), key=len, reverse=True)
    face_area = set()
    skin = set()
    for comp in comps:
        if len(comp) < 60:
            break
        skin.update(comp)
        face_area |= fill_holes(comp)
    # silks (never inside the face, unless unmistakably key-coloured)
    mag = {c for c in opaque - hair if (c not in face_area or is_pure_key(px[c])) and is_magenta(px[c])}
    cyan = {c for c in opaque - hair if (c not in face_area or is_pure_key(px[c])) and is_cyan(px[c])}
    role = {}
    for comp in components(mag):
        if len(comp) < 6:
            continue
        cy = sum(c[1] for c in comp) / len(comp)
        top = min(c[1] for c in comp)
        r = "cap" if cy < 0.42 * h and top < 0.4 * h else "silksPrimary"
        role.update((c, r) for c in comp)
    role.update((c, "silksSecondary") for c in cyan)
    grow(px, role, w, h)
    skin -= set(role)
    # lips: clearly redder and more saturated than the face's own skin, in the lower face
    if skin:
        ys = [c[1] for c in skin if c in face_area]
        fy0, fy1 = min(ys), max(ys)
    else:
        fy0, fy1 = 0, h - 1
    hs = sorted(((hsv(px[c])[0] * 360 + 180) % 360 - 180) for c in skin)
    ss = sorted(hsv(px[c])[1] for c in skin)
    mh = hs[len(hs) // 2] if hs else 20
    ms = ss[len(ss) // 2] if ss else 0.4

    def lipish(c):
        hh, s2, v2 = hsv(px[c])
        hd = mh - ((hh * 360 + 180) % 360 - 180)
        return 3 <= hd <= 60 and s2 >= ms + 0.03 and v2 >= 0.18

    cand = {c for c in face_area - set(role) - hair if c in skin and c[1] > fy0 + 0.4 * (fy1 - fy0) and lipish(c)}
    lip_comps = sorted(components(cand), key=len, reverse=True) if cand else []
    lips = set()
    if lip_comps and len(lip_comps[0]) >= 4:
        lx = [c[0] for c in lip_comps[0]]
        if max(lx) - min(lx) <= 16:
            lips = set(lip_comps[0])
    skin -= lips
    # median painted skin -> the face's own tone
    mid = sorted(skin, key=lambda c: lum(px[c]))
    core = mid[len(mid) // 4: 3 * len(mid) // 4] or mid
    avg = tuple(sum(px[c][i] for c in core) // max(1, len(core)) for i in range(3))
    tone = nearest_tone(avg)

    # anchors: the eyes (the topmost pair of small white patches in the face: the eye whites),
    # the mouth (the lip patch, below the eyes)
    sx = [c[0] for c in skin if c in face_area] or [0]
    box = {(x, y) for x in range(min(sx), max(sx) + 1) for y in range(fy0, fy1 + 1)}
    whites = {c for c in (box & opaque) - set(role) - hair if hsv(px[c])[1] < 0.3 and hsv(px[c])[2] > 0.6}
    cen = [(sum(c[0] for c in cc) / len(cc), sum(c[1] for c in cc) / len(cc)) for cc in components(whites) if 1 <= len(cc) <= 24]
    cen = [c for c in cen if c[1] < fy0 + 0.55 * (fy1 - fy0)]
    eyes = None
    best = None
    for a in cen:
        for b in cen:
            if 9 <= b[0] - a[0] <= 28 and abs(a[1] - b[1]) <= 4:
                if best is None or a[1] + b[1] < best[0]:
                    best = (a[1] + b[1], a, b)
    if best:
        _, a, b = best
        eyes = [[round(a[0]), round(a[1]), 4], [round(b[0]), round(b[1]), 3]]
    mouth = None
    if lips:
        lx = [c[0] for c in lips]
        ly = [c[1] for c in lips]
        mx = (min(lx) + max(lx)) / 2
        if eyes and min(ly) > max(e[1] for e in eyes) + 8 and eyes[0][0] - 2 <= mx <= eyes[1][0] + 4:
            mouth = [min(lx), max(lx), min(ly)]

    key_role(px, list(hair), KEYS["hair"])
    key_role(px, list(skin), KEYS["skin"])
    key_role(px, list(lips), KEYS["lip"])
    for r in ("silksPrimary", "silksSecondary", "cap"):
        key_role(px, [c for c, rr in role.items() if rr == r], KEYS[r], SHARES[len(KEYS[r])])
    keyed = hair | skin | lips | set(role)
    # no unkeyed pixel may carry a key colour by accident
    for c in opaque - keyed:
        if px[c][:3] in ALL_KEYS:
            r_, g_, b_ = px[c][:3]
            px[c] = (r_, g_, b_ ^ 1, 255)
    cap = [c for c, r in role.items() if r == "cap"]
    face_xy = face_box(skin & face_area or skin, cap, w, h)
    stats = {"hair": len(hair), "skin": len(skin), "lips": len(lips), "body": sum(1 for r in role.values() if r == "silksPrimary"), "sleeves": sum(1 for r in role.values() if r == "silksSecondary"), "cap": len(cap)}
    return im, {"face": face_xy, "eyes": eyes, "mouth": mouth, "tone": tone}, stats


def face_box(face, cap, w, h):
    xs = [x for x, _ in face] or [w // 2]
    cx = (min(xs) + max(xs)) // 2
    top = min(y for _, y in cap) + 16 if cap else min((y for _, y in face), default=20)
    return [max(0, min(w - FACE, cx - FACE // 2)), max(0, min(h - FACE, top))]


def to_palette(im):
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


def faces_table():
    """FACES from gen-jockey-faces.mjs: id -> [native hair, description]."""
    js = "import('./art-src/gen-jockey-faces.mjs').then(m => process.stdout.write(JSON.stringify(m.FACES)))"
    return json.loads(subprocess.run(["node", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout)


def meta(fid):
    stage = "apprentice" if fid[0] == "a" else "veteran" if fid[0] == "v" else "prime"
    presents = "f" if re.match(r"^(af|pf|vf)-", fid) or re.search(r"woman|girl", fid) else "m"
    return stage, presents


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    picks = json.load(open(PICKS_FILE))
    table = faces_table()
    index_file = os.path.join(OUT, "index.json")
    old = json.load(open(index_file)) if os.path.exists(index_file) else {}
    index = old.get("faces", {}) if old.get("version") == 2 else {}
    cat = {f["id"]: f for f in json.load(open(CATALOGUE))["faces"]} if os.path.exists(CATALOGUE) else {}
    for fid, stem in picks.items():
        if only and fid not in only:
            continue
        if not os.path.exists(os.path.join(RAW, stem + ".png")):
            print(fid, "MISSING", stem)
            continue
        im, anchors, stats = process(stem)
        colours = im.getcolors(256)
        out = os.path.join(OUT, fid + ".png")
        if colours is not None and len(colours) < 256:
            to_palette(im).save(out, optimize=True, transparency=0)
        else:
            im.save(out, optimize=True)
        stage, presents = meta(fid)
        hair_native, desc = table[fid]
        index[fid] = {"face": anchors["face"], "eyes": anchors["eyes"], "mouth": anchors["mouth"]}
        cat[fid] = {
            "id": fid, "stage": stage, "presents": presents, "skin": anchors["tone"], "hair": hair_native,
            "long": bool(re.search(r"plait|braid|ponytail|bun\b|long|puff", desc)),
            "beard": bool(re.search(r"beard|moustache|stubble|sideburns|mutton", desc)),
            "glasses": bool(re.search(r"spectacles|glasses", desc)),
            "eyes": anchors["eyes"] is not None, "mouth": anchors["mouth"] is not None,
        }
        print(fid, stem, anchors["tone"], stats, "eyes" if anchors["eyes"] else "-", "mouth" if anchors["mouth"] else "-")
    order = [k for k in picks if k in index]
    with open(index_file, "w") as f:
        json.dump({
            "version": 2, "size": 128, "faceSize": FACE,
            "keys": {"skin": SKIN_KEYS, "lip": LIP_KEYS, "hair": HAIR_KEYS},
            "faces": {k: index[k] for k in order},
        }, f, indent=1)
    with open(CATALOGUE, "w") as f:
        json.dump({"_note": "Written by art-src/process_jockeys.py: the jockey base faces the game assigns looks from (game-core jockeyLooks.ts).", "faces": [cat[k] for k in order if k in cat]}, f, indent=1)


if __name__ == "__main__":
    main()
