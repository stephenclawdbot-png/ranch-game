"""Trophy Room plaques: one chosen PixelLab plaque per achievement -> one sprite sheet.

    python3 -I art-src/process_plaques.py

Each pick (48x48, transparent) is trimmed to its bounding box, given hard alpha and placed
bottom-centred in a cell of the common size, left to right in PICKS order.
Output: apps/web/public/art/trophies/plaques.png + plaques.json ({cell: [w, h], ids: [...]}).
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "art-src/raw/plaques")
OUT = os.path.join(ROOT, "apps/web/public/art/trophies")

# achievement id (game-core social.ts ACHIEVEMENTS) -> chosen raw stem
PICKS = {
    "first_race": "first_race-9901-1",
    "first_win": "first_win-9902-15",
    "ten_wins": "ten_wins-9903-15",
    "photo_win": "photo_win-9904-10",
    "graded_win": "graded_win-9905-9",
    "g1_win": "g1_win-9906-7",
    "first_foal": "first_foal-9907-2",
    "bred_b": "bred_b-9908-2",
    "bred_a": "bred_a-9909-5",
    "bred_s": "bred_s-9910-2",
    "cup_regular": "cup_regular-9911-2",
    "cup_top10": "cup_top10-9912-2",
    "promoted": "promoted-9913-7",
    "final_win": "final_win-9914-2",
    "hall_of_fame": "hall_of_fame-9915-2",
    "carer": "carer-9916-2",
    "stable_steps": "stable_steps-9917-4",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    pieces = []
    for aid, stem in PICKS.items():
        im = Image.open(os.path.join(RAW, stem + ".png")).convert("RGBA")
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
        pieces.append(im.crop(im.getbbox()))
    cw = max(p.width for p in pieces)
    ch = max(p.height for p in pieces)
    sheet = Image.new("RGBA", (cw * len(pieces), ch), (0, 0, 0, 0))
    for i, p in enumerate(pieces):
        sheet.alpha_composite(p, (i * cw + (cw - p.width) // 2, ch - p.height))
    n = len(sheet.getcolors(1 << 16))
    sheet.quantize(colors=min(256, n), method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(OUT, "plaques.png"), optimize=True)
    with open(os.path.join(OUT, "plaques.json"), "w") as f:
        json.dump({"cell": [cw, ch], "ids": list(PICKS)}, f, indent=1)
    print("cell", cw, ch, "colours", n)


if __name__ == "__main__":
    main()
