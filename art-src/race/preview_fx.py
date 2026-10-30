"""Ground fx recolour sheet: every strip x every surface/going it is emitted on.
  python3 -I art-src/race/preview_fx.py <out.png>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ART = Path("apps/web/public/art/race")
h2 = lambda h: tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def tint(img, keys, ramps):
    out = img.copy()
    for role, src in keys.items():
        dst = ramps.get(role)
        if not dst:
            continue
        for a, b in zip(src, dst):
            m = (img[..., 0] == h2(a)[0]) & (img[..., 1] == h2(a)[1]) & (img[..., 2] == h2(a)[2]) & (img[..., 3] > 0)
            out[m, :3] = h2(b)
    return out


def main():
    pal = json.loads((ART / "fx-palette.json").read_text())
    rows = []
    labels = []
    for surf, strips in pal["emit"].items():
        ground = (90, 120, 60) if surf.startswith("turf") else (150, 110, 70) if surf.startswith("dirt") else (60, 50, 45)
        for s in strips:
            img = np.array(Image.open(ART / f"{s}.png").convert("RGBA"))
            t = tint(img, pal["keys"][s], pal["surfaces"][surf][s])
            bg = Image.new("RGBA", (img.shape[1], img.shape[0]), (*ground, 255))
            bg.alpha_composite(Image.fromarray(t))
            rows.append(bg)
            labels.append(f"{surf} {s}")
    W = rows[0].width * 3
    sheet = Image.new("RGBA", (W + 300, sum(r.height * 3 + 2 for r in rows)), (20, 20, 20, 255))
    d = ImageDraw.Draw(sheet)
    y = 0
    for r, l in zip(rows, labels):
        sheet.paste(r.resize((r.width * 3, r.height * 3), Image.NEAREST), (0, y))
        d.text((W + 8, y + 40), l, fill=(255, 255, 255, 255))
        y += r.height * 3 + 2
    sheet.save(sys.argv[1])


if __name__ == "__main__":
    main()
