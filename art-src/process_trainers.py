"""Story rival trainers: chosen PixelLab busts -> served portraits.

    python3 -I art-src/process_trainers.py

128x128, hard alpha (0/255), exact palette PNG. Ids are game-core RIVAL_STABLES ids.
Output: apps/web/public/art/portraits/trainers/<id>.png
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/trainers")
OUT = os.path.join(ROOT, "apps/web/public/art/portraits/trainers")

PICKS = {
    "house-harrowgate": "house-harrowgate-9301-0",
    "house-larkspur": "house-larkspur-9302-1",
    "house-vicarage": "house-vicarage-9303-0",
    "house-saltmarsh": "house-saltmarsh-9304-1",
    "house-kestrel": "house-kestrel-9305-2",
    "house-bellmont": "house-bellmont-9306-0",
    "house-copperfield": "house-copperfield-9307-0",
    "house-ashcombe": "house-ashcombe-9308-1",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for tid, stem in PICKS.items():
        im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGBA")
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
        n = len(im.getcolors(4096))
        q = im.quantize(colors=min(256, n), method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        q.save(os.path.join(OUT, tid + ".png"), optimize=True)
        print(tid, stem, "colours", n)


if __name__ == "__main__":
    main()
