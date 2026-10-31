"""Section scenes and wiki figures: chosen PixelLab picks -> served palette PNGs.

    python3 -I art-src/process_sections.py

Each pick is a 688x288 golden-hour scene (art-src/gen-sections.mjs). Kept at native size (the
page kit shows it at 1x/2x/3x with nearest filtering), stored as an exact palette PNG when the
picture has at most 256 colours, otherwise quantised to 256 without dithering.
Output: apps/web/public/art/scenes/<id>.png
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/sections")
OUT = os.path.join(ROOT, "apps/web/public/art/scenes")

PICKS = {
    "club-lawn": "club-lawn-9501-0",
    "winners-enclosure": "winners-enclosure-9511-0",
    "weighing-room": "weighing-room-9521-0",
    "stud-dawn": "stud-dawn-9531-0",
    "hall-of-fame": "hall-of-fame-9541-0",
    "press-room": "press-room-9651-0",
    "form-rail": "form-rail-9661-0",
    "foaling-barn": "foaling-barn-9571-0",
    "estate-office": "estate-office-9681-0",
    "retirement-meadow": "retirement-meadow-9591-0",
    "gallops-morning": "gallops-morning-9701-0",
    "club-library": "club-library-9711-0",
    "yard-works": "yard-works-9621-0",
    "vet-room": "vet-room-9631-0",
    "grooming-aisle": "grooming-aisle-9641-0",
    "farrier-forge": "farrier-forge-9651-0",
    "stud-book": "stud-book-9661-0",
    "starting-stalls": "starting-stalls-9671-0",
    "pedigree-wall": "pedigree-wall-9671-0",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    for sid, stem in PICKS.items():
        if only and sid not in only:
            continue
        im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGB")
        colours = im.getcolors(1 << 16)
        n = len(colours) if colours else 1 << 16
        q = im.quantize(colors=min(n, 256), method=Image.Quantize.MEDIANCUT if n > 256 else Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        out = os.path.join(OUT, sid + ".png")
        q.save(out, optimize=True)
        print(sid, stem, im.size, "colours", n, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
