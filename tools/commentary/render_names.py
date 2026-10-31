#!/usr/bin/env python3
"""
Voices horse names for the radio commentary: asks POST TIME which names still lack clips,
renders each with the shared recipe (recipe.py) for every caster missing it, at the three
intensities, and uploads them. Run hourly by .github/workflows/commentary-names.yml.

  POST_TIME_URL=https://... COMMENTARY_UPLOAD_SECRET=... \\
    python3 tools/commentary/render_names.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin [--limit 150]

Local use (no server): render given names to files, e.g. for the sample races:
  python3 tools/commentary/render_names.py --model ... --voices ... --names "Silver Bramble,Quiet Riot" --out /tmp/names
  -> /tmp/names/<caster>/<intensity>/<name key>.mp3
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recipe  # noqa: E402


def name_key(name: str) -> str:
    """Same as the server (db commentaryNameKey) and the viewer (library nameKey)."""
    return " ".join(unicodedata.normalize("NFKC", name).split()).lower()


def call(method: str, url: str, secret: str, body: dict | None = None, timeout: float = 60) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json", "User-Agent": "post-time-commentary-names"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:300]
            if e.code < 500 and e.code != 429:
                raise RuntimeError(f"{method} {url}: {e.code} {msg}") from e
            err: Exception = RuntimeError(f"{e.code} {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            err = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{method} {url} failed: {err}")


def render_name(voice: recipe.Voice, name: str, caster: str, d: str) -> dict[str, bytes]:
    clips = {}
    for intensity in recipe.INTENSITIES:
        path = os.path.join(d, f"{caster}-{intensity}.mp3")
        voice.clip(recipe.name_text(name, intensity), caster, intensity, path)
        with open(path, "rb") as f:
            clips[intensity] = f.read()
    return clips


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--limit", type=int, default=150, help="names per run")
    ap.add_argument("--max-minutes", type=float, default=40, help="stop starting new names after this long")
    ap.add_argument("--names", help="comma-separated names to render locally (no server)")
    ap.add_argument("--out", help="with --names: output folder (also writes durations.json)")
    ap.add_argument("--casters", help="with --names: comma-separated casters (default: all)")
    a = ap.parse_args()
    voice = recipe.Voice(a.model, a.voices)

    if a.names:
        out = a.out or "."
        os.makedirs(out, exist_ok=True)
        dpath = os.path.join(out, "durations.json")
        durations = json.load(open(dpath)) if os.path.exists(dpath) else {}
        casters = [c for c in (a.casters or ",".join(recipe.CASTERS)).split(",") if c]
        for name in [n.strip() for n in a.names.split(",") if n.strip()]:
            for caster in casters:
                if all(f"{caster}|{i}|{name_key(name)}" in durations for i in recipe.INTENSITIES):
                    continue
                with tempfile.TemporaryDirectory() as d:
                    for intensity, b in render_name(voice, name, caster, d).items():
                        p = os.path.join(out, caster, intensity, f"{name_key(name)}.mp3")
                        os.makedirs(os.path.dirname(p), exist_ok=True)
                        with open(p, "wb") as f:
                            f.write(b)
                        durations[f"{caster}|{intensity}|{name_key(name)}"] = recipe.mp3_duration(p)
                with open(dpath, "w") as f:
                    json.dump(durations, f, indent=1, sort_keys=True)
            print("rendered", name, flush=True)
        return

    base = os.environ.get("POST_TIME_URL", "").rstrip("/")
    secret = os.environ.get("COMMENTARY_UPLOAD_SECRET", "")
    if not base or not secret:
        sys.exit("Set POST_TIME_URL and COMMENTARY_UPLOAD_SECRET (repository secrets; see docs/commentary.md).")
    todo = call("GET", f"{base}/api/commentary/names/missing?limit={a.limit}", secret)
    if todo.get("recipe") != recipe.RECIPE_VERSION:
        sys.exit(f"Server recipe {todo.get('recipe')} != tools/commentary/recipe.py RECIPE_VERSION {recipe.RECIPE_VERSION}: deploy or update first.")
    names = todo.get("names", [])
    print(f"{len(names)} names to voice", flush=True)
    t0 = time.time()
    done = failed = 0
    for n in names:
        if time.time() - t0 > a.max_minutes * 60:
            print("time budget spent; the rest next run", flush=True)
            break
        for caster in n["casters"]:
            if caster not in recipe.CASTERS:
                continue
            try:
                with tempfile.TemporaryDirectory() as d:
                    clips = render_name(voice, n["name"], caster, d)
                body = {"name": n["name"], "caster": caster, "recipe": recipe.RECIPE_VERSION, "clips": {k: base64.b64encode(v).decode() for k, v in clips.items()}}
                call("POST", f"{base}/api/commentary/names", secret, body)
                done += 1
            except Exception as e:  # one bad name never stops the run
                failed += 1
                print(f"failed: {n['name']} / {caster}: {e}", flush=True)
        print(f"voiced {n['name']}", flush=True)
    print(f"uploaded {done} name x caster sets, {failed} failed, {time.time() - t0:.0f}s", flush=True)
    if failed and not done:
        sys.exit(1)


if __name__ == "__main__":
    main()
