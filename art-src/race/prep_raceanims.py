"""Seed frames for the race-day animations (art-src/race/gen-raceanims.mjs).

  python3 -I art-src/race/prep_raceanims.py

Pastes frames of the delivered HD gallop (race/horse-gallop.png, keyed colours) onto the
PixelLab canvases at a FIXED offset, so every new strip starts from exactly the gallop's
scale, outline and key palette:
  gen canvas 256x168 (<= 12 frames): gallop pixel (x, y) -> (x + 14, y + 14), ground row 158
  gen canvas 256x192 (<= 10 frames): gallop pixel (x, y) -> (x + 14, y + 38), ground row 182
The delivered strips are 256x192 with gallop pixel (x, y) -> (x + 14, y + 47), ground row 191.
"""
from pathlib import Path

from PIL import Image

OUT = Path("art-src/race/raw/anims")
GALLOP = Image.open("apps/web/public/art/race/horse-gallop.png").convert("RGBA")
FW, FH = 229, 146
DX = 14
DY = {168: 14, 192: 38}


def gallop_frame(i):
    return GALLOP.crop((i * FW, 0, (i + 1) * FW, FH))


def seed(i, h):
    c = Image.new("RGBA", (256, h), (0, 0, 0, 0))
    c.alpha_composite(gallop_frame(i), (DX, DY[h]))
    return c


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for i in range(12):
        seed(i, 168).save(OUT / f"seed-g{i}-168.png")
        seed(i, 192).save(OUT / f"seed-g{i}-192.png")
    print("seeds written to", OUT)
