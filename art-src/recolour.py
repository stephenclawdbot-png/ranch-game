"""Reference recolouring for the race sprites (what the viewer does at load time).

  python3 -I art-src/recolour.py <strip.png> <palette.json> <out.png> <frameWidth> [--frames N]

Builds a test sheet: rows = coat x silks combos. Mapping is by RAMP INDEX: source ramp
colour i (dark->light) becomes target ramp colour i, where the target ramp is generated
from the coat palette (shade/body/highlight, mane, points) or a single silks colour.
"""
import colorsys
import json
import sys

import numpy as np
from PIL import Image

COATS = {
    # subset of packages/art-pipeline/src/palettes.ts COAT_PALETTES
    "bay": dict(body="#8a4527", shade="#5a2a16", highlight="#b5683d", mane="#17100d", points="#1b1310"),
    "chestnut": dict(body="#a4552b", shade="#73371a", highlight="#d07f47", mane="#c58a4d", points="#93491f"),
    "grey": dict(body="#b4b3ae", shade="#83827d", highlight="#dddcd6", mane="#5f5e5b", points="#77766f"),
    "black": dict(body="#1f1c1c", shade="#0f0d0d", highlight="#47403e", mane="#0b0a0a", points="#141212"),
    "palomino": dict(body="#d5a457", shade="#a97a34", highlight="#f0ca86", mane="#f1e4c6", points="#c49340"),
    "dark_bay": dict(body="#4d2618", shade="#2e150c", highlight="#74402a", mane="#110b09", points="#140d0b"),
}


def h2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], float)


def shade(rgb, f, hue_shift=0.0):
    """Scale value by f with a small hue shift (cooler shadows, warmer lights)."""
    r, g, b = rgb / 255
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    v2 = min(1.0, v * f)
    s2 = min(1.0, s * (1.08 if f < 1 else 0.9 if f > 1 else 1))
    h2 = (h + hue_shift) % 1
    return np.array(colorsys.hsv_to_rgb(h2, s2, v2)) * 255


def ramp_from(base, n, lo=0.45, hi=1.25):
    c = h2rgb(base)
    fs = np.linspace(lo, hi, n)
    return [shade(c, f, -0.01 if f < 1 else 0.01) for f in fs]


def coat_ramp(p, n):
    s, b, h = h2rgb(p["shade"]), h2rgb(p["body"]), h2rgb(p["highlight"])
    # anchors along the ramp: very dark shade .. highlight sparkle
    anchors = [shade(s, 0.55, -0.01), s, (s + b) / 2, b, (b + h) / 2, h, shade(h, 1.18, 0.01)]
    xs = np.linspace(0, 1, len(anchors))
    out = []
    for t in np.linspace(0, 1, n):
        i = min(len(anchors) - 2, int(t * (len(anchors) - 1)))
        u = (t - xs[i]) / (xs[i + 1] - xs[i])
        out.append(anchors[i] * (1 - u) + anchors[i + 1] * u)
    return out


def recolour(img, pal, coat, primary, secondary, cap):
    out = img.copy()
    maps = {}

    def add(src, dst):
        for a, b in zip(src, dst):
            maps[tuple(h2rgb(a).astype(int))] = np.clip(np.round(b), 0, 255).astype(np.uint8)

    add(pal["coat"], coat_ramp(coat, len(pal["coat"])))
    add(pal["mane"], ramp_from(coat["mane"], len(pal["mane"]), 0.55, 1.2))
    add(pal["points"], ramp_from(coat["points"], len(pal["points"]), 0.6, 1.15))
    add(pal["silksPrimary"], ramp_from(primary, len(pal["silksPrimary"]), 0.5, 1.0))
    add(pal["silksSecondary"], ramp_from(secondary, len(pal["silksSecondary"]), 0.5, 1.0))
    add(pal["cap"], ramp_from(cap, len(pal["cap"]), 0.55, 1.0))
    a = img[..., 3] > 0
    for y, x in zip(*np.nonzero(a)):
        k = tuple(int(v) for v in img[y, x, :3])
        if k in maps:
            out[y, x, :3] = maps[k]
    return out


def main():
    strip, palf, outf, fw = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    nfr = int(sys.argv[sys.argv.index("--frames") + 1]) if "--frames" in sys.argv else 3
    img = np.array(Image.open(strip).convert("RGBA"))
    pal = json.load(open(palf))
    combos = [
        ("bay", "#b90fb2", "#08ebe4", "#b90fb2"),
        ("chestnut", "#1d3fbf", "#f2c230", "#f2c230"),
        ("grey", "#127a3a", "#f4f1e6", "#127a3a"),
        ("black", "#d1202a", "#f4f1e6", "#f4f1e6"),
        ("palomino", "#1b2a55", "#f07c1e", "#1b2a55"),
        ("dark_bay", "#f4d21c", "#151515", "#151515"),
    ]
    H = img.shape[0]
    rows = []
    for coat, p, s, c in combos:
        rc = recolour(img, pal, COATS[coat], p, s, c)
        frames = [rc[:, i * fw : (i + 1) * fw] for i in range(nfr)]
        rows.append(np.concatenate(frames, axis=1))
    sheet = np.concatenate(rows, axis=0)
    bg = np.zeros_like(sheet)
    bg[..., :3] = (96, 128, 72)
    bg[..., 3] = 255
    im = Image.alpha_composite(Image.fromarray(bg), Image.fromarray(sheet))
    im.resize((im.width * 3, im.height * 3), Image.NEAREST).save(outf)


if __name__ == "__main__":
    main()
