"""Icons, graphics round 2.

    python3 -I art-src/process_icons2.py

1. New 32 px icons, one per meaning that used to share the horseshoe / stopwatch / shield /
   ticket (art-src/gen-round2.mjs icons: generate-image-v2 32x32 styled on icon-horseshoe.png;
   PICKS = the chosen option of each job): hard alpha -> apps/web/public/art/ui/icon-<name>.png
2. A hand-tuned 16 px version of EVERY 32 px icon (apps/web/public/art/ui/icon16/<name>.png), so
   icons drawn at 16 CSS px are whole pixels on 1x screens (the 32 px file serves 2x screens):
   2:1 blocks, opaque when at least two of the four are; a block on the silhouette's edge
   keeps its darkest (outline) colour, an inner block its most common colour (darker wins
   ties), then any lone opaque pixel with no neighbour is dropped.
"""
import glob
import json
import os
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/ui2")
UI = os.path.join(ROOT, "apps/web/public/art/ui")
META = os.path.join(ROOT, "art-src/meta/ui")

PICKS = {
    "stall-empty": "stall-empty-9601-2",
    "telephone": "telephone-9602-14",
    "race-diary": "race-diary-9603-0",
    "results-board": "results-board-9604-0",
    "record-plaque": "record-plaque-9605-7",
    "licence": "licence-9606-3",
    "purse-lock": "purse-lock-9607-1",
    "wax-seal": "wax-seal-9608-0",
    "invitation": "invitation-9609-2",
    "stalls-empty": "stalls-empty-9610-3",
    "race-clock": "race-clock-9611-6",
    "training-chart": "training-chart-9612-0",
    "cap-peg": "cap-peg-9613-1",
    "door-key": "door-key-9614-0",
    "lead-rope": "lead-rope-9615-0",
    "sale-board": "sale-board-9616-1",
}


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def hard(im):
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
    return im


def half(im):
    w, h = im.width // 2, im.height // 2
    src = im.load()
    opaque = [[sum(1 for dx in (0, 1) for dy in (0, 1) if src[2 * x + dx, 2 * y + dy][3]) >= 2 for x in range(w)] for y in range(h)]
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if not opaque[y][x]:
                continue
            cols = [src[2 * x + dx, 2 * y + dy][:3] for dx in (0, 1) for dy in (0, 1) if src[2 * x + dx, 2 * y + dy][3]]
            edge = any(not (0 <= x + dx < w and 0 <= y + dy < h and opaque[y + dy][x + dx]) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge:
                c = min(cols, key=lum)
            else:
                cnt = Counter(cols)
                c = sorted(cnt, key=lambda k: (-cnt[k], lum(k)))[0]
            dst[x, y] = (*c, 255)
    for y in range(h):
        for x in range(w):
            if dst[x, y][3] and not any(0 <= x + dx < w and 0 <= y + dy < h and dst[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                dst[x, y] = (0, 0, 0, 0)
    return out


def main():
    os.makedirs(META, exist_ok=True)
    for name, stem in PICKS.items():
        im = hard(Image.open(os.path.join(RAW, stem + ".png")).convert("RGBA"))
        im.save(os.path.join(UI, f"icon-{name}.png"), optimize=True)
        job = json.load(open(os.path.join(RAW, stem.rsplit("-", 1)[0] + ".json")))
        req = job["request"]
        with open(os.path.join(META, f"icon-{name}.meta.json"), "w") as f:
            json.dump({"sourcePrompt": f"generate-image-v2 32x32 seed {req['seed']} (pick {stem.rsplit('-', 1)[1]}), style_image ui/icon-horseshoe.png: '{req['description']}'", "variants": ["32px", "16px"]}, f)
    os.makedirs(os.path.join(UI, "icon16"), exist_ok=True)
    n = 0
    for f in sorted(glob.glob(os.path.join(UI, "icon-*.png"))):
        im = Image.open(f).convert("RGBA")
        if im.size != (32, 32):
            continue
        half(im).save(os.path.join(UI, "icon16", os.path.basename(f)[len("icon-"):]), optimize=True)
        n += 1
    print(len(PICKS), "new icons;", n, "16 px icons")


if __name__ == "__main__":
    main()
