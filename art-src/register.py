"""Regenerate art-src/assets.json (manifest registry for build-manifest.mjs) from the files in
apps/web/public/art/{race,portraits,ui,scenes}. Prompts are read back from the raw job logs.

  python3 -I art-src/register.py && node art-src/build-manifest.mjs
"""
import json
from pathlib import Path

ART = Path("apps/web/public/art")
RAW = Path("art-src/raw")

# public stem -> raw job json holding the request (prompt) that produced it
SOURCE = {
    "sky-clear": "scene/sky-clear", "sky-dusk": "scene/sky-dusk", "sky-overcast": "scene/sky-overcast",
    "far-hills": "scene/far-hills-opaque", "crowd": "scene/bb-crowd-a", "bb-crowd-a": "scene/bb-crowd-a",
    "bb-crowd-b": "scene/bb-crowd-b", "rail-near": "scene/rail-white", "rail-far": "scene/rail-white",
    "hedge-near": "scene/hedge-near", "tex-turf": "scene/tiles2", "tex-hedge": "scene/tiles2",
    "tex-dirt": "scene/tiles", "tex-grass": "scene/tiles", "tex-gravel": "scene/tiles",
    "track-turf": "scene/tiles2", "track-dirt": "scene/tiles",
    "bb-tree-oak": "scene/bb-tree-oak", "bb-tree-oak-b": "scene/bb-tree-oak", "bb-tree-poplar": "scene/bb-tree-poplar",
    "bb-bush": "scene/bb-bush", "bb-bush-b": "scene/bb-bush", "bb-grandstand": "scene/bb-grandstand",
    "grandstand": "scene/bb-grandstand", "finish-post": "scene/finish-post", "furlong-pole": "scene/furlong-pole",
    "starting-gate": "scene/starting-gate", "bb-flag": "scene/bb-flag",
}
POST = {
    "far-hills": "sky cut to alpha, mirror-tiled to 960 px (art-src/process_scene.py)",
    "crowd": "made seamless: roll + /inpaint-v3 of the centre band (art-src/seamless.py)",
    "rail-near": "made seamless: roll + /inpaint-v3", "rail-far": "made seamless: roll + /inpaint-v3",
    "hedge-near": "made seamless by min-cut quilting (art-src/quilt.py)",
    "finish-post": "cleaned with /edit-images-v2 (base removed)", "furlong-pole": "cleaned with /edit-images-v2 (base removed)",
    "bb-flag": "animated with /animate-pixminimax (8 frames), pole pinned",
    "track-turf": "tiled from tex-turf", "track-dirt": "tiled from tex-dirt",
}


def prompt(stem):
    base = stem[: -len("-normal")] if stem.endswith("-normal") else stem
    src = SOURCE.get(base)
    text = None
    if src and (RAW / f"{src}.json").exists():
        d = json.loads((RAW / f"{src}.json").read_text())
        req = d["request"]
        text = f"{d['endpoint']}: {req.get('description') or req.get('action')}"
    if base in POST:
        text = f"{text or ''} | post: {POST[base]}".strip(" |")
    if stem.endswith("-normal"):
        text = f"/normal-map (OpenGL) of {base}.png" + (f" | source: {text}" if text else "")
    return text


def race_kind(stem):
    s = stem.replace("-normal", "")
    if s.startswith("sky-"):
        return "track_layer", "sky", "background"
    if s == "far-hills":
        return "track_layer", "far", "background"
    if s in ("grandstand", "bb-grandstand"):
        return "building", "mid", "standard"
    if s in ("crowd", "bb-crowd-a", "bb-crowd-b", "rail-far"):
        return "track_layer", "mid", "standard"
    if s.startswith("tex-") or s.startswith("track-"):
        return "track_layer", "track", "background"
    if s in ("rail-near", "hedge-near"):
        return "track_layer", "near", "standard"
    if s.startswith("bb-tree") or s.startswith("bb-bush"):
        return "prop", "far", "standard"
    if s == "bb-flag":
        return "prop", "mid", "standard"
    return "prop", "track", "standard"


def meta(p):
    m = Path("art-src/meta") / p.relative_to(ART).with_suffix(".meta.json")
    return json.loads(m.read_text()) if m.exists() else {}


entries = []
for p in sorted((ART / "race").glob("*.png")):
    stem = p.stem
    if stem.startswith("horse-"):
        continue  # registered in build-manifest.mjs
    kind, band, tier = race_kind(stem)
    base_meta = meta(ART / "race" / f"{stem.replace('-normal', '')}.png")
    e = {
        "id": f"race.{stem}",
        "kind": kind,
        "depthBand": band,
        "src": f"race/{stem}.png",
        "optimizationTier": tier,
        "sourcePrompt": prompt(stem),
        "anchor": base_meta.get("anchor", {"x": 0.5, "y": 1} if band not in ("sky",) else {"x": 0, "y": 0}),
    }
    if base_meta.get("frameCount"):
        e["frameCount"] = base_meta["frameCount"]
        e["fps"] = base_meta.get("fps", 8)
    variants = []
    if stem.endswith("-normal"):
        variants.append("normal-opengl")
    if stem.startswith("tex-") and not stem.endswith("-normal"):
        variants.append("seamless-2d")
    if stem in ("far-hills", "crowd", "rail-near", "rail-far", "hedge-near", "track-turf", "track-dirt"):
        variants.append("seamless-x")
    e["variants"] = variants
    entries.append(e)

for p in sorted((ART / "portraits").glob("*.png")) if (ART / "portraits").exists() else []:
    m = meta(p)
    entries.append({
        "id": f"portrait.{p.stem}", "kind": "ui_portrait", "depthBand": "overlay", "src": f"portraits/{p.name}",
        "optimizationTier": "hero", "sourcePrompt": m.get("sourcePrompt"), "anchor": {"x": 0.5, "y": 0.5},
        "variants": [p.stem.replace("horse-", "")] if p.stem.startswith("horse-") else [],
    })

for sub, kind in (("ui", "ui_portrait"), ("scenes", "building")):
    d = ART / sub
    if not d.exists():
        continue
    for p in sorted(d.glob("*.png")):
        m = meta(p)
        e = {
            "id": f"{sub}.{p.stem}", "kind": kind, "depthBand": "overlay" if sub == "ui" else "mid",
            "src": f"{sub}/{p.name}", "optimizationTier": "standard", "sourcePrompt": m.get("sourcePrompt"),
            "anchor": {"x": 0.5, "y": 0.5}, "variants": m.get("variants", []),
        }
        if m.get("frameCount"):
            e["frameCount"] = m["frameCount"]
            e["fps"] = m.get("fps", 0)
        entries.append(e)

Path("art-src/assets.json").write_text(json.dumps(entries, indent=1))
print(len(entries), "registry entries")
