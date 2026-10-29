#!/usr/bin/env bash
# Key the Ranch turnout strips (untacked horse: walk, graze, idle) onto the race palette so the
# diorama can recolour them to any horse's genetic coat. Run from the repo root after
#   node art-src/diorama/gen-diorama.mjs loose-horse anim-loose-walk anim-loose-graze anim-loose-idle
# then python3 -I art-src/diorama/process_diorama.py (LOD copies + atlas).
set -euo pipefail
RAW=art-src/diorama/raw
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# graze: head goes down (0-8), nibbles (7/8 x4), comes back up (7-1)
i=0
for f in 0 1 2 3 4 5 6 7 8 7 8 7 8 7 8 7 8 7 6 5 4 3 2 1; do cp "$RAW/anim-loose-graze-$f.png" "$TMP/g-$i.png"; i=$((i + 1)); done
KEY="--hd --palette-from art-src/meta/race/horse-gallop.meta.json --out apps/web/public/art/diorama"
python3 -I art-src/process_gallop.py "$RAW/anim-loose-walk" 1 8 horse-loose-walk $KEY
python3 -I art-src/process_gallop.py "$RAW/anim-loose-idle" 1 8 horse-loose-idle $KEY
python3 -I art-src/process_gallop.py "$TMP/g" 0 24 horse-loose-graze $KEY
