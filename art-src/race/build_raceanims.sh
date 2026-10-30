#!/usr/bin/env bash
# Rebuild every race-day strip from the chosen raw generations (art-src/race/raw/anims).
# Run from the repo root. Normals are separate (PixelLab, see STATUS.md "Race-day animations").
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
R=art-src/race/raw/anims
P="python3 -I art-src/race/process_raceanims.py"
$P horse-break 168 $R/anim-break-b-{0..7}.png                       # stall stance -> stride; output 8 == gallop frame 0
$P horse-drive 168 $R/anim-drive-c-{0..11}.png                      # loop 11 -> 0, frame k shares gallop frame k's leg phase
$P horse-lunge 168 $R/anim-lunge-b-{1..6}.png --dx-left 12          # after drive frame 11; generated 12 px left (nose fits)
$P horse-easeup 168 $R/anim-easeup-c-{0..12}.png --align barrel     # gallop -> canter -> trot
$P horse-celebrate 192 $R/anim-celebrate-a-{0..10}.png --ref self   # loop 10 -> 0
$P horse-pullup 168 $R/anim-pullup-a-{0,2,4,6,8,10,12}.png $R/anim-pullup-b-{2,4,6}.png --align barrel
python3 -I art-src/race/process_fx.py
python3 -I art-src/race/fx_normals.py fx-mud fx-dust fx-divot
python3 -I art-src/race/process_crowd.py 0,1,2,3,4,5,4,3,2,1        # ping-pong; frame 0 == crowd.png
