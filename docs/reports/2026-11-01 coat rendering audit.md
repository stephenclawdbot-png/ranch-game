# Coat rendering audit (2026-11-01)

Owner goal: every horse colour, pattern and marking drawn correctly everywhere, plus new rare
colours, shade modifiers and a long-haired (feathered) horse. Colour is looks only: it never
changes racing or breeding performance.

## 1. What every view drew before this work

Five renderers drew horses, each with its own recolour. None of them used the white-pattern genes
except the 3/4 portrait, and only the Trackside shader drew markings on the race sprites.

| Phenotype | Trackside strips | 3D view | Portrait | Ranch / paddock (dioramas) | Gallop sprite | Photo finish / share card |
|---|---|---|---|---|---|---|
| Base colours, cream (palomino, buckskin, smoky black, cremello, perlino, smoky cream) | palette (coat v2) | palette | palette, pink muzzle, blue eye | palette | palette | palette |
| Dun (red dun, bay dun, grullo, dunskin, dunalino) | code-drawn stripe, legs barred by a fixed row pattern | **no stripe, no barring** | dark grullo head only | **none** | stripe only, box-shaped | **none** |
| Roan (strawberry, bay, blue) | screen-space hash, **ticks changed every frame** (sparkle) | **none** | ticks on the neck | **none** | hash, per strip texel | **none** |
| Grey stages | dapple grid, greying as dapples | **plain grey palette** | painted dapples | plain | dapple grid | plain |
| Champagne, silver, pearl | palette | palette | palette, freckles | palette | palette | palette |
| Tobiano, leopard / blanket / few-spot / varnish, splash, sabino | **none** | **none** | procedural on the head and neck only | **none** | **none** | **none** |
| Face markings (star, snip, stripe, blaze, bald) | straight-line formulas from the profile edge | **none** | painted masks | **none** | **none** | **none** |
| Leg markings (coronet, sock, stocking) | straight cut at a fixed height | **none** | n/a | **none** | **none** | **none** |
| Feathering (fe/fe) | **none anywhere** | | | | | |

Source-art defects found on the way (all frames checked with the geometry debug view):
- Tails drawn in the lower-leg keys in some frames of `loose-idle`, `loose-walk`, `walk-jockey`,
  `easeup`, `pullup`: a chestnut's or flaxen horse's tail flipped to the leg colour mid-animation.
- Dark lower-leg pixels, belly shadows and the riders' boots drawn in the mane keys: any pale mane
  (flaxen, silver, cremello) painted pale patches on the legs and the jockey's boots.
- `walk-led` and `aisle-idle` are painted, not keyed: decorative scene horses only (they never
  show a player's horse), so they carry no genes. Listed in `DECORATIVE_HORSE_SHEETS`.
- The 1:2..1:4 copies of the diorama sheets were made by an older method and kept the bad keys.

## 2. How each mismatch was fixed

One per-horse pattern definition and one horse space, used by every view:

- **Coat geometry** (`art-pipeline/coatGeometry.ts`): from any keyed sheet, per frame, where each
  texel sits on the horse: body (along the body from the rump, depth under the top line, which
  follows the crest and is traced under the saddle), face (brow to nose, in from the profile),
  each leg (hoof to belly, across the leg, near and far per pair), mane and tail; the rider's face
  and hands are excluded. Grazing heads, outlined sprites and ridden sprites are handled.
- **Coat layers** (`art-pipeline/coatLayers.ts`): every pattern, marking, shade and rare colour was
  painted by PixelLab once on a reference horse (59 variants, `art-src/coat-layers/jobs.mjs`) and
  read back into horse space (`extract.ts`) as one atlas cell per variant (`race/coat-layers.png`,
  2x copy for portraits). `coatPatternOf(appearance)` picks the layers and the drawn variants from
  the horse's marking seed, the same for every view.
- **Trackside**: the shader samples the atlas through masks built from the shared geometry (one
  copy per strip, per-runner LUT rows carry the pattern). **3D, photo finish, ranch, paddock,
  stable band, gallop sprite, share cards**: the CPU painter (`paintCoatStrip`), same geometry
  and atlas; small diorama copies are painted at full size and reduced. **Portrait**: the still
  is mapped into the same spaces (`portraitCoat.ts`), so its blaze, patches, spots, ticking and
  mane match the sprites.
- Patterns are registered to the body: the head and upper legs read body space (no seam at the
  throat or the belly), white on the lower legs is a band that rides with the leg, roan / rabicano
  / varnish / greying ticking is a density from the painting applied as fine hairs fixed to the
  body (no sparkle). White patterns use the frame's own shading. Single-pixel read-back noise is
  removed with a majority filter; the dun stripe is a thin line on the top line.
- Source fixes: tails and leg / shadow / boot pixels re-keyed (`fix-tail-keys.ts`), N:1 copies
  rebuilt from the fixed sheets (`lods.py`).
- Tests: every painted pixel inside that frame's horse (no pixels below the hooves, between the
  legs or on the rider), face and leg markings at the same place on their body part in every
  frame, white patches not drifting along the body, the pattern definition identical in the
  portrait, the Trackside LUT and the CPU painter, every coat x animation x view painted.

## 3. New cosmetic genetics (game-core `cosmetic.ts`)

- Shade modifiers (polygenic, every breed): sooty, flaxen (chestnut only), pangaré.
- Rare colours: mushroom (recessive, chestnut only), rabicano, brindle (X-linked: a mare passes it
  to about half her foals, a stallion to every daughter and no son), dominant white (not lethal),
  Bend Or spots (red coats), Birdcatcher spots. No lethal colour genes.
- Sources (owner decision): every third replacement Club house stallion stands for one rare colour
  in turn, on a common (weak) genome at the common fee; pack foals carry them at natural frequency
  (0.2-0.6 % per copy). Never Club runners, sale lots or leases.
- Display names for every combination (`fullCoatName`), the horse page's Genetics panel (full
  name and a Shades and rare colours table), the breeding preview's possible looks and the wiki.
- Pack-pull proofs accept v2 genomes stored before these genes (`expectedPullGenome`).

## 4. The feathered horse

Drawn in code (owner decision): a long wavy mane past halfway down the neck and a forelock, a
fuller tail traced from the dock, and a fringe from the knee and hock over the fetlock to the hoof
top, grown per frame from the geometry's anchors, streaming back at a gallop and swaying at a walk
(deterministic per sheet and frame). It is an extra layer on the existing sprites, coloured from
the coat's keys, so markings turn the feathering white over a sock or stocking. The portrait gets
the long mane and forelock from the same rules. The PixelLab feathered painting is kept as a style
reference only.

## 5. Left open

- Hair variation per horse (the long hair is the same shape for every feathered horse on a sheet).
- `walk-led` and `aisle-idle` stay decorative and unkeyed.
- The opt-in pixel-rig 3D (`?rig=1`) keeps its own ramps (no patterns); the default 3D view uses the
  painted strips.
- A forearm stripe can show where a tobiano patch meets the belly line in some gallop frames.
