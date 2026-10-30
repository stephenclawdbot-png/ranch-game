"""Ground effects -> keyed strips + race/fx-palette.json.

  python3 -I art-src/race/process_fx.py

Input: the /vfx (pro) spritesheets art-src/race/raw/anims/vfx-<fx>--race-fx-<fx>.png (3x3 grid
of 48x32 cells, 8 frames, + .json with pivots and frame durations).
Output: race/fx-{mud,dust,divot}.png, 8 frames x 48x32 horizontal strips, binary alpha, every
pixel one of a few KEY colours:
  material: 4 keys dark -> light (clods / dust / divot soil, incl. their outline)
  grass   : 3 keys dark -> light (divot only: the grass on top of the turf chunk)
race/fx-palette.json lists the keys per strip and the target ramps per surface/going, sampled
from the track's own ground tiles (tex-dirt, tex-turf) so the particles match the ground.
Recolour by ramp index, exactly like palette.json for the horses.
"""
import colorsys
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("art-src/race/raw/anims")
ART = Path("apps/web/public/art/race")
FX = ["mud", "dust", "divot"]
CW, CH, N = 48, 32, 8


def hexs(c):
    return "#%02x%02x%02x" % tuple(int(v) for v in c)


def lum(c):
    c = np.asarray(c, float)
    return 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]


def kmeans(px, k, iters=40):
    px = px.astype(float)
    L = lum(px)
    qs = np.quantile(L, np.linspace(0.06, 0.94, k))
    cen = np.array([px[np.argmin(np.abs(L - q))] for q in qs])
    for _ in range(iters):
        lab = ((px[:, None] - cen[None]) ** 2).sum(-1).argmin(1)
        new = np.array([px[lab == i].mean(0) if np.any(lab == i) else cen[i] for i in range(k)])
        if np.allclose(new, cen):
            break
        cen = new
    cen = np.round(cen).astype(int)
    return cen[np.argsort(lum(cen))]


def is_grass(rgb):
    out = np.zeros(len(rgb), bool)
    for i, c in enumerate(rgb / 255):
        h, s, v = colorsys.rgb_to_hsv(*c)
        out[i] = 0.17 <= h <= 0.45 and s > 0.25 and v > 0.18
    return out


def ramp_from_tile(name, k, lo=0.05, hi=0.95):
    t = np.array(Image.open(ART / f"tex-{name}.png").convert("RGB")).reshape(-1, 3).astype(float)
    L = lum(t)
    order = np.argsort(L)
    out = []
    for q in np.linspace(lo, hi, k):
        i = order[int(q * (len(order) - 1))]
        # average a small luminance window around the quantile for a clean colour
        w = order[max(0, int(q * len(order)) - 40) : int(q * len(order)) + 40]
        out.append(t[w].mean(0))
    return out


def scale(c, f, sat=1.0):
    h, s, v = colorsys.rgb_to_hsv(*(np.asarray(c, float) / 255))
    return np.array(colorsys.hsv_to_rgb(h, min(1, s * sat), min(1, v * f))) * 255


def main():
    used = set()
    keys = {}
    meta = {}
    for fx in FX:
        sheet = np.array(Image.open(RAW / f"vfx-{fx}--race-fx-{fx}.png").convert("RGBA"))
        info = json.loads((RAW / f"vfx-{fx}--race-fx-{fx}.json").read_text())
        frames = []
        for i in range(N):
            r = info["frames"][i]["frame"]
            frames.append(sheet[r["y"] : r["y"] + CH, r["x"] : r["x"] + CW].copy())
        strip = np.concatenate(frames, axis=1)
        a = strip[..., 3] >= 128
        px = strip[a][:, :3]
        grass = is_grass(px) if fx == "divot" else np.zeros(len(px), bool)
        roles = {"material": (~grass, 4)}
        if grass.any():
            roles["grass"] = (grass, 3)
        out = np.zeros_like(strip)
        ys, xs = np.nonzero(a)
        keys[f"fx-{fx}"] = {}
        for role, (m, k) in roles.items():
            uniq = np.unique(px[m], axis=0)
            # the /vfx sheets use a handful of flat colours: keep them as the keys (dark -> light)
            cen = uniq[np.argsort(lum(uniq))] if len(uniq) <= 6 else kmeans(px[m], k)
            assert not any(tuple(c) in used for c in cen), f"key clash in fx-{fx}"
            used.update(tuple(c) for c in cen)
            lab = ((px[m][:, None].astype(float) - cen[None]) ** 2).sum(-1).argmin(1)
            out[ys[m], xs[m], :3] = cen[lab]
            out[ys[m], xs[m], 3] = 255
            keys[f"fx-{fx}"][role] = [hexs(c) for c in cen]
        Image.fromarray(out).save(ART / f"fx-{fx}.png", optimize=True)
        piv = info["frames"][0].get("pivot", {"x": 0.8, "y": 0.8})
        dur = info["frames"][0].get("duration", 71)
        meta[f"fx-{fx}"] = {
            "frameWidth": CW, "frameHeight": CH, "frameCount": N,
            "fps": round(1000 / dur), "anchor": {"x": round(piv["x"], 3), "y": round(piv["y"], 3)},
        }

    # Base ramps (dark -> light) sampled from the ground tiles, resampled to each key length.
    def tile_ramp(name, lo, hi, f=1.0, sat=1.0):
        return lambda n: [scale(c, f, sat) for c in ramp_from_tile(name, n, lo, hi)]

    def fixed_ramp(cols):
        cols = np.array(cols, float)
        return lambda n: [cols[int(round(i))] if float(i).is_integer() else cols[int(i)] * (1 - i % 1) + cols[int(i) + 1] * (i % 1) for i in np.linspace(0, len(cols) - 1, n)]

    GOING = {"firm": (1.18, 0.8), "good": (1.0, 1.0), "soft": (0.8, 1.1), "heavy": (0.64, 1.15)}
    base = {
        # flying clods and divot soil: the track's earth, darker than the sunlit top surface
        "turf": {"soil": tile_ramp("dirt", 0.03, 0.75, 0.62, 1.1), "grass": fixed_ramp([(38, 82, 36), (50, 97, 43), (97, 148, 59), (128, 172, 74)]), "dust": tile_ramp("dirt", 0.55, 0.99, 1.25, 0.6)},
        "dirt": {"soil": tile_ramp("dirt", 0.03, 0.85, 0.85, 1.05), "dust": tile_ramp("dirt", 0.5, 0.99, 1.15, 0.75)},
        "synthetic": {"soil": fixed_ramp([(30, 24, 24), (62, 48, 42), (98, 76, 60), (138, 110, 86)])},
    }
    use = {"fx-mud": {"material": "soil"}, "fx-divot": {"material": "soil", "grass": "grass"}, "fx-dust": {"material": "dust"}}
    emit = {
        "turf/firm": ["fx-dust"],
        "turf/good": ["fx-divot"],
        "turf/soft": ["fx-divot", "fx-mud"],
        "turf/heavy": ["fx-mud", "fx-divot"],
        "dirt/firm": ["fx-dust"],
        "dirt/good": ["fx-dust"],
        "dirt/soft": ["fx-mud"],
        "dirt/heavy": ["fx-mud"],
        "synthetic/*": ["fx-mud", "fx-dust"],
    }
    R = lambda r: [hexs(np.clip(np.round(c), 0, 255)) for c in r]
    surfaces = {}
    for surf, strips in emit.items():
        ground, going = surf.split("/")
        f, sat = GOING.get(going, (1.0, 1.0))
        surfaces[surf] = {}
        for st in strips:
            surfaces[surf][st] = {}
            for role, src in keys[st].items():
                kind = use[st][role]
                mk = base[ground].get(kind) or base[ground]["soil"]
                ff, ss = (f, sat) if kind != "dust" else (1.0, 1.0)
                surfaces[surf][st][role] = R(scale(c, ff, ss) for c in mk(len(src)))
    pal = {
        "_note": "Ground fx recolour keys. keys[strip][role] = exact source colours dark->light; surfaces['<surface>/<going>'][strip][role] = target ramp of the same length (recolour by ramp index). emit = strips to spawn behind the hooves on that ground (first = main, rest = occasional). synthetic/* = any going.",
        "keys": keys,
        "surfaces": surfaces,
        "emit": emit,
        "strips": meta,
    }
    (ART / "fx-palette.json").write_text(json.dumps(pal, indent=1) + "\n")
    Path("art-src/meta/race").mkdir(parents=True, exist_ok=True)
    for k, m in meta.items():
        (Path("art-src/meta/race") / f"{k}.meta.json").write_text(json.dumps(m, indent=1) + "\n")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
