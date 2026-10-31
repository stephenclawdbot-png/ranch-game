"""Rebuild the N:1 copies of the keyed horse sheets from their base sheets (after the key fixes in
art-src/coat-layers/fix-tail-keys.ts), with the same whole-block downsample as the women riders'
copies (art-src/process_female_riders.py `down`: opaque when >= 45 % of the block is, the most
common key, darkest wins ties), so every scale carries the same keys.

    python3 -I art-src/coat-layers/lods.py [--check]
"""
import os
import sys
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(ROOT, "apps/web/public/art")
# base sheet -> (frames, [(copy stem, factor)])
LODS = {
    "diorama/horse-canter": (12, [("diorama/horse-canter-s2", 2), ("diorama/horse-canter-s3", 3)]),
    "diorama/horse-canter-f": (12, [("diorama/horse-canter-f-s2", 2), ("diorama/horse-canter-f-s3", 3)]),
    "diorama/horse-walk-jockey": (8, [("diorama/horse-walk-jockey-s2", 2), ("diorama/horse-walk-jockey-s3", 3), ("diorama/horse-walk-jockey-s4", 4)]),
    "diorama/horse-walk-jockey-f": (8, [("diorama/horse-walk-jockey-f-s2", 2), ("diorama/horse-walk-jockey-f-s3", 3), ("diorama/horse-walk-jockey-f-s4", 4)]),
    "race/horse-gallop": (12, [("diorama/horse-gallop-s2", 2), ("diorama/horse-gallop-s3", 3)]),
    "race/horse-gallop-f": (12, [("diorama/horse-gallop-f-s2", 2), ("diorama/horse-gallop-f-s3", 3)]),
    "diorama/horse-loose-walk": (8, [("diorama/horse-loose-walk-s2", 2), ("diorama/horse-loose-walk-s3", 3)]),
    "diorama/horse-loose-graze": (24, [("diorama/horse-loose-graze-s2", 2), ("diorama/horse-loose-graze-s3", 3)]),
    "diorama/horse-loose-idle": (8, [("diorama/horse-loose-idle-s2", 2), ("diorama/horse-loose-idle-s3", 3)]),
}


def down(im, frames, n):
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


if __name__ == "__main__":
    check = "--check" in sys.argv
    for base, (frames, copies) in LODS.items():
        src = os.path.join(ART, base + ".png")
        if not os.path.exists(src):
            continue
        im = Image.open(src).convert("RGBA")
        for stem, n in copies:
            path = os.path.join(ART, stem + ".png")
            new = down(im, frames, n)
            if os.path.exists(path):
                old = Image.open(path).convert("RGBA")
                same = old.size == new.size
                diff = sum(1 for a, b in zip(old.getdata(), new.getdata()) if a != b) if same else -1
                print(stem, "size ok" if same else f"size {old.size} -> {new.size}", "changed px", diff)
            if not check:
                new.save(path)
