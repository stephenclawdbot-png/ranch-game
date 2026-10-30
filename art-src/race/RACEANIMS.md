# Race-day animations: sources and rebuild

Delivered strips and how to use them: `apps/web/public/art/STATUS.md` § "1b. Race-day animations".

## Pipeline

1. `python3 -I art-src/race/prep_raceanims.py`: seed frames = frames of the shipped
   `race/horse-gallop.png` (already keyed to `palette.json`) pasted at a fixed offset on the
   PixelLab canvases (256×168 for up to 12 frames, 256×192 for up to 10: PixelLab's
   width × height × frames ≤ 524,288 budget). Every strip therefore starts from the gallop's exact
   scale, outline and key colours.
2. `node art-src/race/gen-raceanims.mjs <job...>`: every PixelLab request with its prompt and
   seed (keyframes with `/edit-images-v2`, strips with `/animate-with-text-v3` from a seed frame,
   optionally pinned with `last_frame`; ground fx with `/vfx` pro; the crowd as two overlapping
   256 px windows). Raw output in `raw/anims/<job>-N.png` + `<job>.json` (request/response, base64
   stripped); every call is in `art-src/generation-log.jsonl`.
3. `art-src/race/build_raceanims.sh`: rebuilds every served strip from the chosen raw frames:
   - `process_raceanims.py`: role classification (`process_gallop.classify`) + fixes (girth/boots
     → tack, nothing behind the saddle cloth is tack, white hoof flecks → points), snap to the
     exact `palette.json` ramps, despeckle, common ground line (row 191), horizontal steadying
     (`--align silks` like the gallop, `barrel` = coat silhouette cross-correlation when the jockey
     changes posture, `--ref self` for the standing jockey), meta in `art-src/meta/race/`.
   - `process_fx.py` → `fx-*.png` + `fx-palette.json`; `fx_normals.py` → fx normals.
   - `process_crowd.py` → `crowd-cheer.png` (min-cut seams between the two windows, crowd.png palette).
4. Normals (PixelLab): `node art-src/normals-strip.mjs apps/web/public/art/race/horse-<name>.png <frames> apps/web/public/art/race/horse-<name>-normal.png character pro`
   (crowd: `... crowd-cheer.png 10 ... object lite`, then the ping-pong twins copied, see below).
5. `node art-src/build-manifest.mjs` (entries in `raceDay()`), previews with `preview_raceanims.py`
   (contact sheet, recolour test) and `preview_fx.py`.

## What was used, what was rejected

| Strip | Used | Rejected (why) |
|---|---|---|
| break | `key-stall-b` (stall stance; lifted 8 px onto the gallop ground → `key-stall-b-up`) → `anim-break-b` 0–7 (last_frame = gallop frame 0; output 8 was gallop 0 and is dropped) | `key-stall` (drew a starting gate around the horse); `anim-break-a` (coat lighting blew out to orange/white in frames 2–7) |
| drive | `key-drive` (jockey lower, arms pushing) → `anim-drive-c` 0–11 (11 → 0 loops) | `anim-drive-a/b` (from the plain gallop seed: just the gallop again, no visible push); `anim-drive-d` (fine, c loops better) |
| lunge | `key-lunge` (from drive frame 0 shifted 12 px left) ← `anim-lunge-b` 1–6 (first = drive frame 11) | `anim-lunge-a` (no lunge, only another stride); `key-lunge-clipped` (nose ran off the 256 px canvas); `anim-lunge-c` (b stretches earlier) |
| easeup | `anim-easeup-c` 0–12 (last_frame = a trotting frame) | `anim-easeup-a` (never got below a gallop); `anim-easeup-b` (kept cantering); `anim-easeup-d` (sits up too late) |
| celebrate | `key-celebrate` → `anim-celebrate-a` 0–10 (10 → 0 loops) | |
| pullup | `anim-pullup-a` 0,2,…,12 + `anim-pullup-b` 2,4,6 (b continues a's last frame to a standstill) | |
| fx | `vfx-mud`, `vfx-dust`, `vfx-divot` (pro, 48×32, 8 frames) | |
| crowd | `anim-crowd-A/B` frames 0–5 ping-pong (6–8 calm down again, not a loop) | |

The crowd normal map's ping-pong frames (6–9) reuse the maps of frames 4–1 so the light doesn't
flicker between twins.
