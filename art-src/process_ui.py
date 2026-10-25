"""Assemble the UI kit into apps/web/public/art/ui/ from raw PixelLab outputs.

  python3 -I art-src/process_ui.py

- 9-slice panels / buttons rebuilt by make9.py (insets collected into ui/ui.json)
- 64 icons from one create-1-direction-object sheet (art-src/raw/ui/icons-N.png)
- logo emblem
Prompt/source notes go to art-src/meta/ui/<stem>.meta.json (read by register.py).
"""
import glob
import json
import os
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

OUT = "apps/web/public/art/ui/"
META = Path("art-src/meta/ui")
META.mkdir(parents=True, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

NINE = [
    ("panel-2", "panel-9slice", "18 18 18 18 64 64 --sample 3 3 1"),
    ("card-3", "card-9slice", "24 24 24 24 72 72 --sample 4 4 1"),
    ("button-3", "button", "8 12 8 12 48 25 --sample 2 1 1 --states"),
    ("button-green-2", "button-green", "9 14 9 14 56 30 --sample 2 1 1 --states"),
]
for src, out, a in NINE:
    subprocess.run(["python3", "-I", "art-src/make9.py", f"art-src/raw/ui/{src}.png", f"{OUT}{out}.png", *a.split()], check=True)

NAMES = [
    "coin", "trophy", "horseshoe-pair", "stopwatch", "flag", "star", "rosette", "saddle", "calendar", "badge-gold",
    "badge-silver", "badge-bronze", "horse-head", "ticket", "binoculars", "whip", "cap-checked", "cap-green",
    "binoculars-leather", "goggles", "carrots", "apple", "feed-bucket", "water-bucket", "hay", "grooming-brush",
    "body-brush", "tonic", "laurel", "stall-number", "saddle-cloth", "stirrup", "spurs", "boots", "silks-checked",
    "silks-sash", "racecard", "papers", "bell", "megaphone", "pocket-watch", "whistle", "lantern", "stable-door",
    "garland", "plaque", "money-sack", "medallion", "winner-drape", "rosette-green", "calendar-day", "crest-shield",
    "horseshoe", "trunk", "horseshoe-iron", "tote", "club-crest", "jug", "tankard", "shield", "bridle", "chips",
    "gate", "trophy-silver",
]
for i, n in enumerate(NAMES):
    a = np.array(Image.open(f"art-src/raw/ui/icons-{i}.png").convert("RGBA"))
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    if a[31, :, 3].any() and not a[30, :, 3].any():
        a[31] = 0  # stray separator line under some sheet cells
    a[a[..., 3] == 0] = 0
    Image.fromarray(a).save(f"{OUT}icon-{n}.png", optimize=True)
    (META / f"icon-{n}.meta.json").write_text(json.dumps({
        "sourcePrompt": f"create-1-direction-object (size 32, sidescroller, 64-slot sheet) item: {n}", "variants": ["32px"]}))

lg = Image.open("art-src/raw/ui/logo-1.png").convert("RGBA")
a = np.array(lg.crop(lg.getbbox()))
a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
a[a[..., 3] == 0] = 0
Image.fromarray(a).save(f"{OUT}logo.png", optimize=True)
(META / "logo.meta.json").write_text(json.dumps({"sourcePrompt": "generate-image-v2: game logo emblem crest, brass horseshoe framing a racing-green shield with a galloping cream thoroughbred, laurels, blank oxblood ribbon (seed 8105)"}))

slices = {}
for f in sorted(glob.glob(OUT + "*.json")):
    if f.endswith("ui.json"):
        continue
    d = json.load(open(f))
    stem = os.path.basename(f)[:-5]
    slices[stem + ".png"] = d["slice"]
    os.remove(f)
    src = {"panel-9slice": "panel", "card-9slice": "card"}.get(stem, "button-green" if "green" in stem else "button")
    desc = json.load(open(f"art-src/raw/ui/{src}.json"))["request"]["description"]
    s = d["slice"]
    (META / f"{stem}.meta.json").write_text(json.dumps({
        "sourcePrompt": f"generate-ui-v2: {desc} | rebuilt as clean 9-slice (art-src/make9.py)",
        "variants": [f"slice:{s['top']},{s['right']},{s['bottom']},{s['left']}"]}))
json.dump({
    "_note": "9-slice insets in native px (CSS border-image-slice / Pixi NineSliceSprite). Render at integer scale with image-rendering: pixelated.",
    "slices": slices,
    "icons": {"size": 32, "names": NAMES},
}, open(OUT + "ui.json", "w"), indent=1)
print(len(slices), "9-slices,", len(NAMES), "icons")
