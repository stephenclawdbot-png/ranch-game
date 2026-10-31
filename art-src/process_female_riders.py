"""Women riders: PixelLab edits (art-src/gen-female-riders.mjs) -> female rider strips.

    python3 -I art-src/process_female_riders.py --crops <strip>   # JSON for the generator
    python3 -I art-src/process_female_riders.py [strip ...]        # write the -f strips

Each frame's rider is edited in a 64x64 crop around the cap. Only rider pixels come back into a
copy of the strip, so the horse, the timing and the keys never move:
  - lime HAIR keys (the ponytail / bun) anywhere the male frame is empty, silks or cap edge;
  - silks keys where the male frame has silks (the jacket re-shaped);
  - empty where the male frame has silks on its outer edge (the slimmer back), at most 2 px in.
Output: apps/web/public/art/<strip>-f.png, and for the diorama strips their LOD copies
(-f-s2 / -f-s3 / -f-s4: whole-block downsamples, darkest colour wins ties, like the race LODs).
Lime hair keys are added to race/palette.json as the "hair" role.
"""
import base64
import io
import json
import os
import re
import sys
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "apps/web/public/art")
RAW = os.path.join(ROOT, "art-src/raw/riders")
PAL_FILE = os.path.join(ART, "race/palette.json")
PAL = json.load(open(PAL_FILE))
HAIR_KEYS = ["#3f8f1a", "#6fcf2f", "#a8f060"]
SIZE = 64
STRIPS = {
    "race/horse-gallop": 12, "race/horse-idle": 14, "race/horse-break": 8, "race/horse-drive": 12, "race/horse-lunge": 6,
    "race/horse-easeup": 13, "race/horse-celebrate": 11, "race/horse-pullup": 10, "diorama/horse-canter": 12, "diorama/horse-walk-jockey": 8,
}
# diorama LOD copies: strip -> [(output stem, factor)]
LODS = {
    "diorama/horse-walk-jockey": [("diorama/horse-walk-jockey-f-s2", 2), ("diorama/horse-walk-jockey-f-s3", 3), ("diorama/horse-walk-jockey-f-s4", 4)],
    "diorama/horse-canter": [("diorama/horse-canter-f-s2", 2), ("diorama/horse-canter-f-s3", 3)],
    "race/horse-gallop": [("diorama/horse-gallop-f-s2", 2), ("diorama/horse-gallop-f-s3", 3)],
}


def hx(h):
    n = int(h[1:], 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


CAP = {hx(c) for c in PAL["cap"]}
SILK = {hx(c) for c in PAL["silksPrimary"] + PAL["silksSecondary"]}
HAIR = {hx(c) for c in HAIR_KEYS}


def load(name):
    im = Image.open(os.path.join(ART, name + ".png")).convert("RGBA")
    return im, im.width // STRIPS[name]


def windows(im, fw, frames):
    px = im.load()
    out, last = [], (0, 0)
    for f in range(frames):
        xs, ys = [], []
        for y in range(im.height):
            for x in range(f * fw, (f + 1) * fw):
                c = px[x, y]
                if c[3] >= 128 and c[:3] in CAP:
                    xs.append(x - f * fw)
                    ys.append(y)
        if xs:
            last = (max(0, min(fw - SIZE, max(xs) - SIZE + 6)), max(0, min(im.height - SIZE, min(ys) - 3)))
        out.append(last)
    return out


def crops(name):
    im, fw = load(name)
    frames = STRIPS[name]
    wins = windows(im, fw, frames)
    b64s, colours = [], Counter()
    for f, (x0, y0) in enumerate(wins):
        c = im.crop((f * fw + x0, y0, f * fw + x0 + SIZE, y0 + SIZE))
        for r, g, b, a in (c.get_flattened_data() if hasattr(c, "get_flattened_data") else c.getdata()):
            if a >= 128:
                colours["#%02x%02x%02x" % (r, g, b)] += 1
        buf = io.BytesIO()
        c.save(buf, format="PNG")
        b64s.append(base64.b64encode(buf.getvalue()).decode())
    # the most used colours first, so a cap keeps the ones that matter
    cols = [c for c, _ in colours.most_common(61)]
    print(json.dumps({"frames": b64s, "colours": cols, "size": SIZE}))


def edited(name):
    stem = name.replace("/", "--")
    cands = sorted(f for f in os.listdir(RAW) if re.match(re.escape(stem) + r"-\d+-\d+\.png$", f)) if os.path.isdir(RAW) else []
    return [Image.open(os.path.join(RAW, f)).convert("RGBA") for f in sorted(cands, key=lambda f: int(f.rsplit("-", 1)[1][:-4]))]


def merge(name):
    im, fw = load(name)
    frames = STRIPS[name]
    eds = edited(name)
    if len(eds) < frames:
        print(name, "edited frames missing:", len(eds))
        return None
    wins = windows(im, fw, frames)
    out = im.copy()
    src = im.load()
    dst = out.load()
    stats = Counter()
    for f, (x0, y0) in enumerate(wins):
        e = eds[f].load()
        ox = f * fw + x0
        for y in range(SIZE):
            for x in range(SIZE):
                X, Y = ox + x, y0 + y
                if X >= (f + 1) * fw or Y >= im.height:
                    continue
                m = src[X, Y]
                n = e[x, y]
                mk = m[:3] if m[3] >= 128 else None
                nk = n[:3] if n[3] >= 128 else None
                if nk in HAIR and (mk is None or mk in SILK or mk in CAP):
                    dst[X, Y] = (*nk, 255)
                    stats["hair"] += 1
                elif nk in SILK and mk in SILK and nk != mk:
                    dst[X, Y] = (*nk, 255)
                    stats["silks"] += 1
                elif nk is None and mk in SILK:
                    # slimmer back: only pixels near the jacket's edge
                    edge = any(
                        not (0 <= X + dx < im.width and 0 <= Y + dy < im.height) or src[X + dx, Y + dy][3] < 128
                        for dx in range(-2, 3) for dy in range(-2, 3)
                    )
                    if edge:
                        dst[X, Y] = (0, 0, 0, 0)
                        stats["trim"] += 1
    return out, stats


def down(im, frames, n):
    """Whole-block downsample per frame: opaque when >= 45 % of the block is, most common colour, darkest wins ties."""
    fw = im.width // frames
    w, h = (fw + n - 1) // n, (im.height + n - 1) // n
    out = Image.new("RGBA", (w * frames, h), (0, 0, 0, 0))
    s, d = im.load(), out.load()
    for f in range(frames):
        for y in range(h):
            for x in range(w):
                cols = []
                tot = 0
                for dy in range(n):
                    for dx in range(n):
                        X, Y = f * fw + x * n + dx, y * n + dy
                        if X >= (f + 1) * fw or Y >= im.height:
                            continue
                        tot += 1
                        c = s[X, Y]
                        if c[3] >= 128:
                            cols.append(c[:3])
                if not cols or len(cols) < 0.45 * tot:
                    continue
                cnt = Counter(cols)
                best = sorted(cnt, key=lambda c: (-cnt[c], 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]))[0]
                d[f * w + x, y] = (*best, 255)
    return out


def main():
    if sys.argv[1:2] == ["--crops"]:
        crops(sys.argv[2])
        return
    only = sys.argv[1:]
    if PAL.get("hair") != HAIR_KEYS:
        PAL["hair"] = HAIR_KEYS
        with open(PAL_FILE, "w") as fp:
            json.dump(PAL, fp, indent=1)
    for name in STRIPS:
        if only and name not in only:
            continue
        r = merge(name)
        if not r:
            continue
        out, stats = r
        out.save(os.path.join(ART, name + "-f.png"), optimize=True)
        print(name, dict(stats))
        for stem, n in LODS.get(name, []):
            down(out, STRIPS[name], n).save(os.path.join(ART, stem + ".png"), optimize=True)


if __name__ == "__main__":
    main()
