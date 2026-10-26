"""Register every served diorama PNG in apps/web/public/art/manifest.json (ids "diorama.*").
Idempotent: existing diorama.* entries are replaced, everything else is left untouched.

  python3 -I art-src/diorama/register.py && node apps/web/scripts/art-index.mjs
"""
import json
from pathlib import Path

from PIL import Image

ART = Path("apps/web/public/art")
DIR = ART / "diorama"
MANIFEST = ART / "manifest.json"
meta = json.loads(Path("art-src/diorama/meta.json").read_text())
atlas_ts = Path("apps/web/src/components/diorama/atlas.generated.ts").read_text()
atlas = json.loads(atlas_ts.split("export const DIORAMA_ATLAS = ", 1)[1].rsplit(" as const;", 1)[0])
prompts = {}
for f in Path("art-src/diorama/raw").glob("*.json"):
    try:
        req = json.loads(f.read_text()).get("request", {})
        prompts[f.stem] = req.get("description") or req.get("action")
    except Exception:  # noqa: BLE001
        pass
keys = json.loads((ART / "race/palette.json").read_text())
KEYED = [c for r in ("coat", "mane", "points", "silksPrimary", "silksSecondary", "cap") for c in keys[r]]

KIND = {
    "horse": "horse_body",
    "head": "horse_body",
    "groom": "prop",
    "yard-props": "prop",
    "barn-props": "prop",
    "fg": "vfx",
    "poster": "building",
}
BAND = {"yard-trees": "far", "fg-branch": "near", "fg-grass": "near", "barn-wall": "far", "crowd-s2": "far", "grandstand-s2": "far"}


def kind(name):
    for p, k in KIND.items():
        if name.startswith(p):
            return k
    return "track_layer" if any(t in name for t in ("cobbles", "floor", "crowd")) else "building"


def raw_prompt(name):
    base = name.replace("-s2", "").replace("-s3", "")
    for cand in (f"anim-{base}", base, base.replace("horse-", "anim-"), base.replace("-walk", ""), f"anim-{base.replace('-walk', '')}-hd"):
        if cand in prompts and prompts[cand]:
            return prompts[cand]
    return None


entries = []
for png in sorted(DIR.glob("*.png")):
    name = png.stem
    w, h = Image.open(png).size
    anim = atlas["anims"].get(name)
    frames = anim["frames"] if anim else 1
    fw = anim["fw"] if anim else w
    m = meta.get(name, {})
    src_note = m.get("source", "")
    if name.startswith("poster-"):
        src_note = f"Composited still frame of <Diorama scene=\"{name[7:]}\"> (art-src/diorama/make-posters.mjs + finish-posters.py)"
    prompt = raw_prompt(name)
    e = {
        "id": f"diorama.{name}",
        "kind": kind(name),
        "origin": "pixellab",
        "license": "PixelLab generated (commercial use per PixelLab ToS)",
        "status": "approved",
        "frameCount": frames,
        "frameWidth": fw,
        "frameHeight": h,
        "fps": anim["fps"] if anim else 0,
        "anchor": {"x": 0.5, "y": 1},
        "depthBand": BAND.get(name, "overlay" if name.startswith("poster-") else "near" if name.startswith("fg") else "mid" if anim is None else "track"),
        "palette": KEYED if m.get("keyed") or name.startswith("horse-walk-jockey") or name.startswith("horse-canter") else [],
        "variants": ["keyed-recolour"] if (m.get("keyed") or name.startswith("horse-walk-jockey") or name.startswith("horse-canter")) else [],
        "sourcePrompt": (f"{src_note} | {prompt}" if prompt else src_note) or None,
        "optimizationTier": "hero" if name.startswith(("horse", "head", "groom")) else "background",
        "src": f"diorama/{name}.png",
    }
    if anim:
        e["animations"] = {name: {"from": 0, "to": frames - 1, "loop": True}}
    entries.append(e)

m = json.loads(MANIFEST.read_text())
m["assets"] = [a for a in m["assets"] if not a["id"].startswith("diorama.")] + entries
MANIFEST.write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n")
print(len(entries), "diorama entries;", len(m["assets"]), "total")
