#!/usr/bin/env python3
"""
Renders the radio commentary phrase library: every phrase in phrases.json, for every caster
and intensity, with the shared recipe (recipe.py), plus the crowd and static beds. Output:

  apps/web/public/audio/commentary/<caster>/<intensity>/<phrase id>.mp3
  apps/web/public/audio/commentary/beds/*.mp3
  apps/web/public/audio/commentary/manifest.json   (ids, durations, hashes, beds)

Incremental: a clip whose (recipe version, caster, intensity, text) hash is unchanged in the
manifest and whose file exists is kept, so editing a few phrases re-renders only those.

  pip install kokoro-onnx soundfile numpy        # plus ffmpeg with rubberband
  npx vitest run --config tools/commentary/vitest.config.ts export
  python3 tools/commentary/render_library.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin [--jobs 3]
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recipe  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "audio", "commentary")

_voice: recipe.Voice | None = None


def _init(model: str, voices: str) -> None:
    global _voice
    _voice = recipe.Voice(model, voices)


def _render(task: tuple[str, str, str, str, str]) -> tuple[str, str, str, float, str]:
    caster, intensity, pid, text, h = task
    path = os.path.join(OUT, caster, intensity, f"{pid}.mp3")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    assert _voice is not None
    dur = _voice.clip(recipe.text_for(text, intensity), caster, intensity, path)
    return caster, intensity, pid, dur, h


def load_manifest() -> dict:
    p = os.path.join(OUT, "manifest.json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {}


def save_manifest(m: dict) -> None:
    p = os.path.join(OUT, "manifest.json")
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(m, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, p)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--casters", default=",".join(recipe.CASTERS))
    ap.add_argument("--beds", action="store_true", help="re-render the crowd and static beds")
    args = ap.parse_args()

    with open(os.path.join(HERE, "phrases.json")) as f:
        spec = json.load(f)
    assert tuple(spec["casters"]) == recipe.CASTERS, "phrases.json casters differ from recipe.CASTERS"
    assert tuple(spec["intensities"]) == recipe.INTENSITIES
    phrases: dict[str, str] = spec["phrases"]

    m = load_manifest()
    if m.get("recipe") != recipe.RECIPE_VERSION:
        m = {}
    m.update(
        {
            "recipe": recipe.RECIPE_VERSION,
            "sampleRate": recipe.OUT_SR,
            "bitrate": recipe.OUT_BITRATE,
            "casters": list(recipe.CASTERS),
            "intensities": list(recipe.INTENSITIES),
        }
    )
    clips = m.setdefault("clips", {})

    if args.beds or "beds" not in m:
        os.makedirs(os.path.join(OUT, "beds"), exist_ok=True)
        m["beds"] = recipe.render_beds(os.path.join(OUT, "beds"))
        save_manifest(m)
        print("beds", m["beds"])

    tasks = []
    for caster in args.casters.split(","):
        for intensity in recipe.INTENSITIES:
            have = clips.setdefault(caster, {}).setdefault(intensity, {})
            for pid in list(have):
                if pid not in phrases:
                    del have[pid]
                    try:
                        os.remove(os.path.join(OUT, caster, intensity, f"{pid}.mp3"))
                    except FileNotFoundError:
                        pass
            for pid, text in phrases.items():
                h = recipe.clip_hash(recipe.text_for(text, intensity), caster, intensity)
                ok = have.get(pid, {}).get("h") == h and os.path.exists(os.path.join(OUT, caster, intensity, f"{pid}.mp3"))
                if not ok:
                    tasks.append((caster, intensity, pid, text, h))
    print(f"{len(tasks)} clips to render", flush=True)
    t0 = time.time()
    done = 0
    with mp.Pool(args.jobs, initializer=_init, initargs=(args.model, args.voices)) as pool:
        for caster, intensity, pid, dur, h in pool.imap_unordered(_render, tasks):
            clips[caster][intensity][pid] = {"d": dur, "h": h}
            done += 1
            if done % 25 == 0 or done == len(tasks):
                save_manifest(m)
                rate = (time.time() - t0) / done
                print(f"{done}/{len(tasks)}  {rate:.2f}s/clip  eta {rate * (len(tasks) - done) / 60:.1f} min", flush=True)
    save_manifest(m)
    total = 0
    for dirpath, _, files in os.walk(OUT):
        total += sum(os.path.getsize(os.path.join(dirpath, f)) for f in files)
    print(f"library: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
