"""Preview sheets for the race-day animations.

  python3 -I art-src/race/preview_raceanims.py grid <png> <frameW> <out.png> [--cols N] [--scale S]
  python3 -I art-src/race/preview_raceanims.py raw <out.png> <frame.png...>       # raw generations
  python3 -I art-src/race/preview_raceanims.py recolour <out.png> <strip:frames,...>  # 6 coats x 3 silks
  python3 -I art-src/race/preview_raceanims.py contact <out.png>                   # every race-day strip

Frames sit on a green field with a 1 px guide on the ground row (191) and the gallop's nose
column (x = 237) so scale/ground/jitter problems are easy to spot.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recolour import COATS, recolour  # noqa: E402

ART = Path("apps/web/public/art/race")
BG = (96, 128, 72, 255)
SILKS = [("#b90fb2", "#08ebe4", "#b90fb2"), ("#1d3fbf", "#f2c230", "#f2c230"), ("#d1202a", "#f4f1e6", "#f4f1e6")]
COAT_ORDER = ["bay", "chestnut", "grey", "black", "palomino", "dark_bay"]
HORSE = ["horse-break", "horse-drive", "horse-lunge", "horse-easeup", "horse-celebrate", "horse-pullup"]


def frames_of(path, fw):
    im = Image.open(path).convert("RGBA")
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(im.width // fw)]


def guides(cell, ground=True):
    d = ImageDraw.Draw(cell)
    if ground and cell.height == 192:
        d.line([(0, 191), (cell.width, 191)], fill=(70, 96, 52, 255))
        d.line([(237, 0), (237, 191)], fill=(84, 112, 62, 255))
    return cell


def grid(frames, cols, scale=1, label=None, ground=True):
    fw, fh = frames[0].size
    rows = (len(frames) + cols - 1) // cols
    out = Image.new("RGBA", (fw * cols + cols - 1, fh * rows + rows - 1), (40, 40, 40, 255))
    for i, f in enumerate(frames):
        cell = guides(Image.new("RGBA", (fw, fh), BG), ground)
        cell.alpha_composite(f)
        ImageDraw.Draw(cell).text((3, 2), str(i), fill=(255, 255, 255, 255))
        out.paste(cell, ((i % cols) * (fw + 1), (i // cols) * (fh + 1)))
    if scale != 1:
        out = out.resize((out.width * scale, out.height * scale), Image.NEAREST)
    return out


def main():
    mode = sys.argv[1]
    if mode == "grid":
        png, fw, out = sys.argv[2], int(sys.argv[3]), sys.argv[4]
        cols = int(sys.argv[sys.argv.index("--cols") + 1]) if "--cols" in sys.argv else 6
        scale = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 1
        grid(frames_of(png, fw), cols, scale).save(out)
    elif mode == "raw":
        out, files = sys.argv[2], sys.argv[3:]
        grid([Image.open(f).convert("RGBA") for f in files], 7, ground=False).save(out)
    elif mode == "recolour":
        out, specs = sys.argv[2], sys.argv[3].split(",")
        pal = json.load(open(ART / "palette.json"))
        cols = []
        for spec in specs:
            name, idx = spec.split(":")
            fr = frames_of(ART / f"{name}.png", 256)
            cols += [np.array(fr[int(i)]) for i in idx.split("/")]
        strip = np.concatenate(cols, axis=1)
        rows = []
        for ci, coat in enumerate(COAT_ORDER):
            for si in range(3):
                p, s, c = SILKS[si]
                rows.append(recolour(strip, pal, COATS[coat], p, s, c))
        sheet = np.concatenate(rows, axis=0)
        im = Image.new("RGBA", (sheet.shape[1], sheet.shape[0]), BG)
        im.alpha_composite(Image.fromarray(sheet))
        im.save(out)
    elif mode == "contact":
        out = sys.argv[2]
        parts = []
        for n in HORSE:
            if (ART / f"{n}.png").exists():
                parts.append(grid(frames_of(ART / f"{n}.png", 256), 7))
        for n, fw in (("fx-mud", 48), ("fx-dust", 48), ("fx-divot", 48)):
            p = ART / f"{n}.png"
            if p.exists():
                h = Image.open(p).height
                parts.append(grid(frames_of(p, fw), 8, 4, ground=False))
        if (ART / "crowd-cheer.png").exists():
            parts.append(grid(frames_of(ART / "crowd-cheer.png", 320), 4, ground=False))
        W = max(p.width for p in parts)
        H = sum(p.height + 8 for p in parts)
        sheet = Image.new("RGBA", (W, H), (20, 20, 20, 255))
        y = 0
        for p in parts:
            sheet.paste(p, (0, y))
            y += p.height + 8
        sheet.save(out)


if __name__ == "__main__":
    main()
