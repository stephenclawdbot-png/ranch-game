#!/usr/bin/env python3
"""POST TIME: pixel wordmark, lockup and square mark (Design System v2, docs/brand-and-design-v2.md).

Everything is drawn on an integer pixel grid and exported as
  * SVG (one <path> of 1x1 runs per colour, shape-rendering="crispEdges"), and
  * PNG at integer scales only (nearest neighbour; never resampled).

The letters are bespoke 2-px-stroke caps (cap height 9 art px). The O of POST is a race
stopwatch: brass bezel, cream face, crown and pusher on top, the hand straight up at the off.
Ramp: honey #fff1c1 -> #f2c86a -> #d9a441 -> #b07a26, ink outline #0b1f15, 1-px drop #050d08.

    python3 apps/web/scripts/brand/wordmark.py            # writes apps/web/public/brand + app icons
"""
import os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(WEB, "public", "brand")
APP = os.path.join(WEB, "app")
os.makedirs(OUT, exist_ok=True)

INK = "#0b1f15"
DROP = "#050d08"
BAIZE = "#0f2a1d"
BAIZE_900 = "#08150e"
RAMP = ["#fff1c1", "#f2c86a", "#f2c86a", "#f2c86a", "#e2b04f", "#d9a441", "#d9a441", "#c48f33", "#b07a26"]  # by cap row 0..8
FACE, FACE_SH, HAND, SECOND = "#f6ecd3", "#e3d4ad", "#1d140a", "#8e2323"

CAP = 9
GLYPHS = {
    "P": ["111111.", "1111111", "11...11", "11...11", "1111111", "111111.", "11.....", "11.....", "11....."],
    "S": [".111111", "1111111", "11.....", "111111.", ".111111", ".....11", ".....11", "1111111", "111111."],
    "T": ["11111111", "11111111", "...11...", "...11...", "...11...", "...11...", "...11...", "...11...", "...11..."],
    "I": ["111111", "111111", "..11..", "..11..", "..11..", "..11..", "..11..", "111111", "111111"],
    "M": ["11.....11", "111...111", "1111.1111", "11.111.11", "11..1..11", "11.....11", "11.....11", "11.....11", "11.....11"],
    "E": ["111111", "111111", "11....", "11111.", "11111.", "11....", "11....", "111111", "111111"],
    " ": ["...."] * CAP,
}

# The stopwatch O: 11 x 11 dial (one row above and below the cap line) under a crown.
# B = bezel (takes the honey ramp of its row), F = face, f = face shade, K = hour hand, R = second hand.
WATCH = [
    "....BBB....",  # -3 crown
    ".....B..B..",  # -2 stem + pusher
    "...BBBBB...",  # -1
    ".BBBBBBBBB.",  # 0
    ".BBFFRFFBB.",  # 1
    "BBFFFRFFFBB",  # 2
    "BBFFFRFFFBB",  # 3
    "BBFFFKKKfBB",  # 4
    "BBFFFFFFfBB",  # 5
    "BBfFFFFFfBB",  # 6
    ".BBffffffB.",  # 7 -> keeps the round silhouette
    ".BBBBBBBBB.",  # 8
    "...BBBBB...",  # 9
]
WATCH_TOP = -3  # cap row of WATCH[0]


def ramp_for(row: int) -> str:
    return RAMP[max(0, min(len(RAMP) - 1, row))]


def watch_pixels(ox: int):
    px = {}
    for i, r in enumerate(WATCH):
        y = WATCH_TOP + i
        for x, ch in enumerate(r):
            if ch == ".":
                continue
            if ch == "B":
                c = ramp_for(y + 1 if y >= 0 else 0)
            else:
                c = {"F": FACE, "f": FACE_SH, "K": HAND, "R": SECOND}[ch]
            px[(ox + x, y)] = c
    return px, len(WATCH[0])


def text_pixels(text: str, watch_for_o: bool = True, gap: int = 1):
    px = {}
    x = 0
    for ch in text:
        if ch == "O" and watch_for_o:
            p, w = watch_pixels(x)
            px.update(p)
        else:
            g = GLYPHS[ch]
            w = len(g[0])
            for y, row in enumerate(g):
                for i, v in enumerate(row):
                    if v == "1":
                        px[(x + i, y)] = ramp_for(y)
        x += w + gap
    return px


def finish(px, outline=True, drop=True):
    """Adds the 1-px ink outline (8-neighbour) and a 1-px drop below; returns (pixels, bbox)."""
    out = dict(px)
    if outline:
        for (x, y) in list(px):
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q not in px:
                        out.setdefault(q, INK)
    if drop:
        for (x, y), c in list(out.items()):
            q = (x, y + 1)
            if q not in out:
                out[q] = DROP
    xs = [p[0] for p in out]
    ys = [p[1] for p in out]
    x0, y0 = min(xs), min(ys)
    norm = {(x - x0, y - y0): c for (x, y), c in out.items()}
    return norm, (max(xs) - x0 + 1, max(ys) - y0 + 1)


def to_svg(px, size, scale, title, bg=None, pad=0):
    w, h = size
    W, H = w + 2 * pad, h + 2 * pad
    by = {}
    for (x, y), c in sorted(px.items(), key=lambda t: (t[0][1], t[0][0])):
        by.setdefault(c, []).append((x + pad, y + pad))
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W * scale}" height="{H * scale}" viewBox="0 0 {W} {H}" shape-rendering="crispEdges" role="img" aria-label="{title}">',
        f"<title>{title}</title>",
    ]
    if bg:
        parts.append(f'<rect width="{W}" height="{H}" fill="{bg}"/>')
    for c, pts in by.items():
        # merge horizontal runs
        runs = []
        pts = sorted(pts, key=lambda p: (p[1], p[0]))
        i = 0
        while i < len(pts):
            x, y = pts[i]
            j = i
            while j + 1 < len(pts) and pts[j + 1] == (pts[j][0] + 1, y):
                j += 1
            runs.append(f"M{x} {y}h{j - i + 1}v1h-{j - i + 1}z")
            i = j + 1
        parts.append(f'<path fill="{c}" d="{"".join(runs)}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def hexrgb(c):
    c = c.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4)) + (255,)


def to_png(px, size, scale, path, bg=None, pad=0, canvas=None):
    w, h = size
    W, H = (w + 2 * pad) * scale, (h + 2 * pad) * scale
    if canvas:
        W, H = canvas
    im = Image.new("RGBA", (W, H), hexrgb(bg) if bg else (0, 0, 0, 0))
    ox = (W - w * scale) // 2 if canvas else pad * scale
    oy = (H - h * scale) // 2 if canvas else pad * scale
    for (x, y), c in px.items():
        im.paste(hexrgb(c), (ox + x * scale, oy + y * scale, ox + (x + 1) * scale, oy + (y + 1) * scale))
    im.save(path, optimize=True)
    return im


# ---------------------------------------------------------------- square marks (app icon)
# 16 px mark: the stopwatch alone, hand-tuned for favicon size (on baize).
MARK16 = [
    "................",
    "......BBBB......",
    ".......BB.......",
    ".....KKKKKK.....",
    "...KKBBBBBBKK...",
    "..KBBFFRRFFBBK..",
    "..KBFFFRRFFFBK..",
    ".KBBFFFRRFFFBBK.",
    ".KBBFFFKKKKFBBK.",
    ".KBBFFFFFFFfBBK.",
    ".KBBFFFFFFffBBK.",
    "..KBffffffffBK..",
    "..KBBffffffBBK..",
    "...KKBBBBBBKK...",
    ".....KKKKKK.....",
    "................",
]
# 32 px mark: a bigger dial with tick marks; drawn programmatically on the integer grid.


def mark32():
    N = 32
    cx, cy, R = 15.5, 17.5, 12.6
    px = {}
    for y in range(N):
        for x in range(N):
            d = ((x + 0.5 - (cx + 0.5)) ** 2 + (y + 0.5 - (cy + 0.5)) ** 2) ** 0.5
            if d <= R + 1.0 and d > R - 0.0:
                px[(x, y)] = INK
            elif d <= R and d > R - 2.6:
                # bezel: honey ramp, lit from the top-left
                t = (y - (cy - R)) / (2 * R)
                lit = (x + y) < (cx + cy) - 6
                px[(x, y)] = "#fff1c1" if lit and d > R - 1.2 else RAMP[min(8, max(1, int(t * 8)))]
            elif d <= R - 2.6 and d > R - 3.4:
                px[(x, y)] = "#b07a26"
            elif d <= R - 3.4:
                shade = (x - cx) + (y - cy) > 6
                px[(x, y)] = FACE_SH if shade else FACE
    # crown + pusher
    for x in range(13, 19):
        px[(x, 1)] = INK
        px[(x, 2)] = "#fff1c1" if x < 16 else "#f2c86a"
        px[(x, 3)] = "#d9a441"
    for x in (12, 19):
        for y in (1, 2, 3):
            px[(x, y)] = INK
    for y in (4,):
        for x in range(12, 20):
            px[(x, y)] = INK
    for y in (4, 5):
        px[(15, y)] = "#d9a441"
        px[(16, y)] = "#b07a26"
    # pusher at 1-2 o'clock: a short brass stem leaving the bezel, outlined in ink
    stem = set()
    for t in range(0, 21):
        fx, fy = 23.2 + (27.0 - 23.2) * t / 20, 9.8 + (6.0 - 9.8) * t / 20
        for x in range(20, 30):
            for y in range(3, 13):
                if (x + 0.5 - fx) ** 2 + (y + 0.5 - fy) ** 2 <= 0.9:
                    stem.add((x, y))
    stem = {q for q in stem if q not in px or px[q] == INK}
    for (x, y) in stem:
        px[(x, y)] = "#f2c86a" if (x + y) % 3 else "#d9a441"
    for (x, y) in list(stem):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                q = (x + dx, y + dy)
                if q not in px:
                    px[q] = INK
    # ticks at 12 / 3 / 6 / 9
    for (x, y) in [(15, 8), (16, 8), (15, 9), (16, 9)]:
        px[(x, y)] = HAND
    for (x, y) in [(15, 26), (16, 26)]:
        px[(x, y)] = HAND
    for (x, y) in [(6, 17), (6, 18), (25, 17), (25, 18)]:
        px[(x, y)] = HAND
    # second hand straight up (oxblood) and the hour hand to 2 o'clock (ink)
    for y in range(10, 18):
        px[(15, y)] = SECOND
        px[(16, y)] = SECOND
    for i, (x, y) in enumerate([(17, 17), (18, 16), (19, 16), (20, 15), (21, 14)]):
        px[(x, y)] = HAND
        px[(x, y + 1)] = HAND
    for (x, y) in [(15, 17), (16, 17), (15, 18), (16, 18)]:
        px[(x, y)] = HAND
    return px


def grid_px(rows, pal):
    px = {}
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != ".":
                px[(x, y)] = pal[ch]
    return px


def main():
    # 1) Wordmark (one line) and the top-bar lockup (same art; the lockup is shown at 2x).
    word, wsize = finish(text_pixels("POST TIME"))
    open(os.path.join(OUT, "post-time-wordmark.svg"), "w").write(to_svg(word, wsize, 2, "Post Time"))
    for s in (1, 2, 3, 4, 8):
        to_png(word, wsize, s, os.path.join(OUT, f"post-time-wordmark@{s}x.png"))
    print("wordmark", wsize)

    # 2) Square marks.
    pal16 = {"B": "#d9a441", "K": INK, "F": FACE, "f": FACE_SH, "R": SECOND}
    m16 = grid_px(MARK16, pal16)
    # crown highlight on the 16 px mark
    for x in (6, 7):
        m16[(x, 1)] = "#fff1c1"
    m32 = mark32()
    open(os.path.join(OUT, "post-time-mark-16.svg"), "w").write(to_svg(m16, (16, 16), 1, "Post Time", bg=BAIZE))
    open(os.path.join(OUT, "post-time-mark.svg"), "w").write(to_svg(m32, (32, 32), 1, "Post Time", bg=BAIZE))
    to_png(m16, (16, 16), 1, os.path.join(OUT, "icon-16.png"), bg=BAIZE)
    to_png(m32, (32, 32), 1, os.path.join(OUT, "icon-32.png"), bg=BAIZE)
    to_png(m32, (32, 32), 6, os.path.join(OUT, "icon-192.png"), bg=BAIZE)
    to_png(m32, (32, 32), 16, os.path.join(OUT, "icon-512.png"), bg=BAIZE)
    # Apple touch icon: 32 x 5 = 160 on a 180 canvas (10 px baize margin; integer scale).
    to_png(m32, (32, 32), 5, os.path.join(OUT, "apple-touch-icon.png"), bg=BAIZE, canvas=(180, 180))
    # Next.js app-router icon files.
    open(os.path.join(APP, "icon.svg"), "w").write(to_svg(m32, (32, 32), 1, "Post Time", bg=BAIZE))
    to_png(m32, (32, 32), 5, os.path.join(APP, "apple-icon.png"), bg=BAIZE, canvas=(180, 180))
    to_png(m16, (16, 16), 1, os.path.join(OUT, "favicon-16.png"), bg=BAIZE)

    # 3) Open Graph card: the stable-yard scene at 2x, a baize fade, the wordmark at 8x.
    scene = Image.open(os.path.join(WEB, "public", "art", "scenes", "stable-yard.png")).convert("RGBA")
    scene = scene.resize((scene.width * 2, scene.height * 2), Image.NEAREST)
    og = Image.new("RGBA", (1200, 630), hexrgb(BAIZE_900))
    og.alpha_composite(scene.crop(((scene.width - 1200) // 2, 0, (scene.width - 1200) // 2 + 1200, 576)), (0, 0))
    fade = Image.new("RGBA", (1200, 630), (0, 0, 0, 0))
    for y in range(260, 630):
        a = min(235, int((y - 260) / 300 * 235))
        fade.paste((8, 21, 14, a), (0, y, 1200, y + 1))
    og.alpha_composite(fade)
    wm8 = Image.open(os.path.join(OUT, "post-time-wordmark@8x.png"))
    og.alpha_composite(wm8, ((1200 - wm8.width) // 2, 630 - wm8.height - 72))
    og.convert("RGB").save(os.path.join(APP, "opengraph-image.png"), optimize=True)
    og.convert("RGB").save(os.path.join(OUT, "og.png"), optimize=True)

    # 4) Sheet for review.
    sheet = Image.new("RGBA", (900, 520), hexrgb(BAIZE_900))
    wm = Image.open(os.path.join(OUT, "post-time-wordmark@4x.png"))
    sheet.alpha_composite(wm, (20, 20))
    wm2 = Image.open(os.path.join(OUT, "post-time-wordmark@2x.png"))
    paper = Image.new("RGBA", (wm2.width + 32, wm2.height + 24), hexrgb("#f6ecd3"))
    paper.alpha_composite(wm2, (16, 12))
    sheet.alpha_composite(paper, (20, 140))
    sheet.alpha_composite(wm2, (20 + paper.width + 24, 152))
    x = 20
    for name in ("icon-16.png", "icon-32.png", "icon-192.png"):
        im = Image.open(os.path.join(OUT, name))
        sheet.alpha_composite(im, (x, 230))
        x += im.width + 24
    big16 = Image.open(os.path.join(OUT, "icon-16.png")).resize((128, 128), Image.NEAREST)
    sheet.alpha_composite(big16, (x, 230))
    big32 = Image.open(os.path.join(OUT, "icon-32.png")).resize((128, 128), Image.NEAREST)
    sheet.alpha_composite(big32, (x + 150, 230))
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, "_sheet.png")
    sheet.save(path)
    print("sheet", path)


if __name__ == "__main__":
    main()
