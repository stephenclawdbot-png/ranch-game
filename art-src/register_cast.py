"""Register the anti-repeat art batch (jockey cast, rival trainers, section scenes, vignettes,
achievement plaques) in art-src/assets.json, with each file's PixelLab prompt read back from its
raw job log. Upserts by id, so it can be re-run after re-picking.

    python3 -I art-src/register_cast.py && node art-src/build-manifest.mjs
"""
import importlib.util
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "art-src/assets.json")


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "art-src", name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.PICKS


# the style_image each batch was generated against
STYLE = {
    "jockeys": "portraits/mentor-wilf.png",
    "trainers": "portraits/mentor-wilf.png",
    "sections": "diorama/poster-paddock.png",
    "vignettes": "raw/vignettes/photo-finish-9803-5.png",
    "plaques": "raw/plaques/style-old-plaque.png (the old shared plaque)",
}


def prompt(raw_dir, stem, post):
    """'<endpoint> WxH seed S (pick n of N)[, styled on X]: '<description>' -> post'."""
    base, pick = re.match(r"(.+)-(\d+)$", stem).groups()
    job = json.load(open(os.path.join(ROOT, "art-src/raw", raw_dir, base + ".json")))
    req = job["request"]
    size = req["image_size"]
    n = len(job.get("files", []))
    style = f" style_image {STYLE[raw_dir]}," if req.get("style_image") else ""
    return f"{job['endpoint'].strip('/')} {size['width']}x{size['height']} seed {req['seed']} (pick {pick} of {n}),{style} '{req['description']}' -> {post}"


def main():
    entries = []
    for pid, stem in load("process_jockeys").items():
        entries.append({
            "id": f"portrait.jockey.{pid}", "kind": "jockey", "depthBand": "overlay", "src": f"portraits/jockeys/{pid}.png",
            "optimizationTier": "hero", "anchor": {"x": 0.5, "y": 0.5},
            "sourcePrompt": prompt("jockeys", stem, "silks snapped to race/palette.json silks keys, face masked out (art-src/process_jockeys.py)"),
            "variants": ["silks-keyed"],
        })
    for tid, stem in load("process_trainers").items():
        entries.append({
            "id": f"portrait.trainer.{tid}", "kind": "ui_portrait", "depthBand": "overlay", "src": f"portraits/trainers/{tid}.png",
            "optimizationTier": "hero", "anchor": {"x": 0.5, "y": 0.5},
            "sourcePrompt": prompt("trainers", stem, "hard alpha, palette PNG (art-src/process_trainers.py)"), "variants": [],
        })
    for sid, stem in load("process_sections").items():
        entries.append({
            "id": f"scenes.{sid}", "kind": "building", "depthBand": "mid", "src": f"scenes/{sid}.png",
            "optimizationTier": "standard", "anchor": {"x": 0.5, "y": 1},
            "sourcePrompt": prompt("sections", stem, "palette PNG, native size (art-src/process_sections.py)"), "variants": [],
        })
    for vid, stem in load("process_vignettes").items():
        entries.append({
            "id": f"vignettes.{vid}", "kind": "ui_portrait", "depthBand": "overlay", "src": f"vignettes/{vid}.png",
            "optimizationTier": "standard", "anchor": {"x": 0.5, "y": 0.5},
            "sourcePrompt": prompt("vignettes", stem, "centre 52 px in the shared 6 px frame (art-src/process_vignettes.py)"), "variants": [],
        })
    plaques = load("process_plaques")
    entries.append({
        "id": "trophies.plaques", "kind": "prop", "depthBand": "overlay", "src": "trophies/plaques.png",
        "optimizationTier": "standard", "anchor": {"x": 0.5, "y": 1},
        "frameCount": len(plaques), "animations": {},
        "sourcePrompt": "; ".join(prompt("plaques", stem, f"cell {i}") for i, stem in enumerate(plaques.values())) + " (art-src/process_plaques.py; order in trophies/plaques.json)",
        "variants": list(plaques),
    })

    assets = json.load(open(ASSETS))
    by_id = {a["id"]: i for i, a in enumerate(assets)}
    for e in entries:
        if e["id"] in by_id:
            assets[by_id[e["id"]]] = e
        else:
            assets.append(e)
    with open(ASSETS, "w") as f:
        json.dump(assets, f, indent=1)
        f.write("\n")
    print(len(entries), "entries registered;", len(assets), "in assets.json")


if __name__ == "__main__":
    main()
