"""News and moment vignettes: chosen PixelLab picks -> one consistent framed set.

    python3 -I art-src/process_vignettes.py

PixelLab draws each 64x64 vignette with its own border (dark wood, grey card, brass...). This
drops each pick's border (at most 6 px), keeps the centre 52x52 of the picture and puts every one in
the same 6 px frame (ink, brass bevel, dark wood, ink), so the feed reads as one set.
Output: apps/web/public/art/vignettes/<id>.png (64x64, palette PNG).
"""
import os
import sys
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/vignettes")
OUT = os.path.join(ROOT, "apps/web/public/art/vignettes")

PICKS = {
    "win": "win-9801-7",
    "first-win": "first-win-9802-1",
    "photo-finish": "photo-finish-9803-5",
    "purse": "purse-9804-10",
    "champion": "champion-9805-7",
    "jockey-signed": "jockey-signed-9806-2",
    "jockey-retires": "jockey-retires-9857-11",
    "jockey-claim": "jockey-claim-9808-7",
    "sale": "sale-9809-7",
    "claim": "claim-9810-3",
    "hall-of-fame": "hall-of-fame-9811-2",
    "memorial": "memorial-9812-1",
    "retired": "retired-9813-2",
    "foal": "foal-9814-2",
    "vet": "vet-9815-6",
    "week": "week-9816-3",
    "improver": "improver-9817-0",
    "quirk": "quirk-9818-0",
    "unlock": "unlock-9819-7",
    "scan": "scan-9870-10",
    "exact": "exact-9871-4",
    "legacy": "legacy-9872-1",
    "stable-steps": "stable-steps-9873-0",
}

SIZE = 64
FRAME = 6
INNER = SIZE - 2 * FRAME  # 52
# outside -> in: ink, brass light, brass, dark wood, dark wood, ink
RINGS = [(11, 15, 12), (240, 200, 110), (196, 140, 58), (74, 45, 26), (58, 34, 20), (20, 14, 10)]


def ring(im, k):
    w, h = im.size
    px = im.load()
    pts = [(x, k) for x in range(k, w - k)] + [(x, h - 1 - k) for x in range(k, w - k)]
    pts += [(k, y) for y in range(k + 1, h - 1 - k)] + [(w - 1 - k, y) for y in range(k + 1, h - 1 - k)]
    return [px[p][:3] for p in pts]


def border_depth(im):
    """Rings from the outside that are border (two colours cover most of the ring)."""
    k = 0
    while k < 16:
        c = Counter(ring(im, k))
        top2 = sum(n for _, n in c.most_common(2))
        if top2 < 0.72 * sum(c.values()):
            break
        k += 1
    return k


def frame(inner):
    out = Image.new("RGB", (SIZE, SIZE))
    px = out.load()
    for k, col in enumerate(RINGS):
        for x in range(k, SIZE - k):
            px[x, k] = col
            px[x, SIZE - 1 - k] = col
        for y in range(k, SIZE - k):
            px[k, y] = col
            px[SIZE - 1 - k, y] = col
    out.paste(inner, (FRAME, FRAME))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    for vid, stem in PICKS.items():
        if only and vid not in only:
            continue
        im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGB")
        # every pick's own border is at most FRAME px (checked by eye on the contact sheet; plain
        # backgrounds fool border_depth, which is only reported), so the centre crop drops it
        d = border_depth(im)
        off = (SIZE - INNER) // 2
        inner = im.crop((off, off, off + INNER, off + INNER))
        out = frame(inner)
        n = len(out.getcolors(4096) or [])
        out.quantize(colors=min(256, n), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(OUT, vid + ".png"), optimize=True)
        print(vid, stem, "border", d, "colours", n)


if __name__ == "__main__":
    main()
