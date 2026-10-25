# @thoroughbred/pixel-rig

Code-animated HD-2D racehorses. PixelLab supplies the **source art** (one side-view horse and
a jockey inpainted onto it, plus normal maps). Code produces the final pixels:

1. a **cut-out part rig** (head, neck, mane, barrel, chest, hindquarter, two-piece tail,
   upper/lower/hoof of each leg, jockey head/torso/arms/thigh/shin, rein);
2. a **skeletal gallop** (transverse 4-beat gallop with suspension, canter, walk, idle;
   IK legs on a hoof path, body bob and rock, head nod, spring-driven tail and mane, jockey
   that absorbs the bob and hand-rides when driving);
3. a **per-horse render target** at native resolution (no downsampling, NearestFilter,
   pixel-snapped translations, quantised rotations, RotSprite-style 4x atlas for rotated
   parts);
4. **3D light on pixels**: per-pixel normals (PixelLab `/normal-map` blended with code
   normals from an inflated distance field) lit by the scene sun with rim light and sheen,
   then **quantised to the role's 8-step colour ramp** with ordered Bayer dithering;
5. a **resolve pass**: palette lookup, 1-px selective outline (darker step of the neighbour's
   own ramp, lighter on the lit side), contour lines where near legs or rider overlap the body.

The output always uses palette colours, so it reads as hand-shaded pixel art that is
nevertheless lit by the real sun.

## Usage

```ts
import { createHorseRigFactory, strideFrequency } from "@thoroughbred/pixel-rig";

const factory = createHorseRigFactory({ artBaseUrl: "/art" }); // usable at once, upgrades when the atlas loads
await factory.ready();                                          // optional
const rig = factory.create(horse.appearance, { gate: 3 });

// each frame, before rendering the main scene
phase += strideFrequency(speedMs) * dt; // or distance / strideLength(speedMs)
rig.update(renderer, {
  phase, speedMs, drive, time,
  lightDir,                   // world direction towards the sun
  spriteRight, spriteOut,     // optional: world dirs of sprite +x and of the camera side
});
material.map = rig.texture;   // 256x192, sRGB, transparent background, alpha 0/1
// ground contact: rig.anchor (px from the top-left of the texture)
rig.dispose(); factory.dispose();
```

- `rig.width × rig.height` is **256 × 192** (`density: 2`, the HD standard: the 256×192 sources
  are rendered 1:1). `density: 1` gives the legacy 128 × 96.
- `rig.anchor` is the ground point under the barrel, `{ x: 128, y: 179 }` at density 2.
- The texture is already lit; draw it unlit (MeshBasicMaterial or a custom shader).
- Cost per rig per update: two small draw calls (parts → shared data target, resolve → the
  rig's own target). CPU pose cost is about **0.01 ms per rig** (16 rigs: 0.15 ms).
- If a shader fails to compile on a GPU, the factory logs once and stops drawing rigs instead
  of issuing more GL calls (`factory.broken`).

Factory options (`HorseRigFactoryOptions`): `density`, `width`/`height`, `offset`,
`angleStep`, `loadSourceArt: false` (force the code-generated parts), and `lighting`
(`ambient`, `lightMix`, `dither`, `rim`, `farShade`, `outline`, `innerLines`).

## Per-horse look (thousands of horses, one part library)

`factory.create(appearance, opts)` takes optional knobs. Every one defaults deterministically
from a hash of the appearance, so a horse always looks the same while two horses with the
same coat still differ a little.

| Knob | Type | Effect |
|---|---|---|
| `variants` | `{ head?, mane?, tail?, build? }` integers | Picks a variant part per slot from the atlas. Indices wrap, so any integer is valid. Today: mane 0 = full, 1 = pulled; tail 0 = full, 1 = banged. |
| `morph` | `{ legLength 0.85–1.15, neckLength 0.85–1.2, girth 0.88–1.15, height 0.9–1.08, headSize 0.9–1.12 }` | Bone morphs applied to the skeleton at create time: joints move, parts scale with nearest sampling (crisp), the body rises so hooves stay on the ground, the jockey rides along at its own size. Quantised to 1/32. |
| `seed` | integer | Drives the procedural markings: ragged marking edges, marking size jitter, dapple and roan layout, sabino patches. |
| `sabino` | 0..1 | Irregular white patches rising from belly and legs, plus a wider face. |

White **face** (star, snip, stripe, blaze, bald) and **leg** (coronet, sock, stocking)
markings come from `HorseAppearance` and are generated in the shader as pixel masks, applied
at the role stage (before lighting and dithering), so they are lit and dithered like the coat.
Dapple-grey and roan coats get their dapples / flecks the same way.

### Genotype → knobs (Milestone B sketch)

- **Coat colour**: Extension (E/e) and Agouti (A/a) give bay / black / chestnut; Cream (Cr)
  dilutes to palomino / buckskin; Grey (G) gives grey (dapple stage by age); Roan (Rn) sets roan.
  These pick the `Coat` (→ coat ramp, `points`, mane ramp).
- **White**: KIT alleles (Sabino-1, W-series) set `sabino` (0.3 per copy plus polygenic noise),
  face/leg markings from a polygenic white score (thresholds → none, star, stripe, blaze, bald;
  coronet, sock, stocking per leg with front/hind bias).
- **Conformation** (polygenic, heritable ~0.3–0.5): `legLength`, `neckLength`, `girth`,
  `height`, `headSize` as the mean of the parents ± a Gaussian segregation term, clamped to
  the ranges above. Speed / stamina stats can correlate (long legs, light girth = sprinter).
- **Mane / tail / head shape**: categorical alleles mapped to `variants` indices.
- **`seed`**: hash of the horse id, so its marking edges and dapples are its own for life.

## Source art pipeline (offline)

`art-src/rig/` (Python 3 + Pillow + NumPy):

- `pl.mjs`: PixelLab helper (key from `~/.config/pixellab/key`, log in `generation-log.jsonl`).
- `raw/hd-stand.png`: 256×192 riderless bay (PixelLab `/edit-images-v2` HD redraw of the
  128×96 `/generate-image-v2` source, so the pose stays aligned); `raw/hd-rider.png`: the same
  picture with a jockey added by `/inpaint-v3` (pixels that differ = the jockey layer);
  `raw/hd-normal-*.png`: `/normal-map` pro.
- `rig.json`: hand-authored cut definition: per part polygon (base 128×96 coordinates scaled by
  `unit`, with `polyHD` / `pivotHD` overrides), colour filter, role rules, pivot, parent,
  z-order, far-side copies, variant slots and derived variants.
- `build_rig.py`: labels pixels, strips the outer outline (the resolve pass redraws it), assigns
  roles and ramp positions, builds normals and height, adds seam pads, joint pads and
  under-child pads so rotation never opens holes, packs and Scale2x-upscales the atlas, and
  writes `apps/web/public/art/rig/`:
  - `horse-parts.png` (4x) and `horse-parts@1x.png`: R = role × 17, G = ramp position,
    B = baked detail, A = coverage;
  - `horse-parts-normal.png`: RGB = normal (OpenGL), A = height;
  - `horse-parts-aux.png`: marking zones (face profile distance, leg height);
  - `horse-rig.json`: rects, pivots, parents, z, joints, silks frame (validated by
    `parseRigDef`).

Rebuild with `python3 -I art-src/rig/build_rig.py [--debug DIR]`. The legacy 128×96 cut is
`rig-1x.json` (`--rig art-src/rig/rig-1x.json`).

If the atlas is missing, `generateFallbackRig()` draws the same skeleton from primitives, so the
factory always works.

## Dev harness

`apps/web/app/dev/rig` (dev server: `cd apps/web && NEXT_DIST_DIR=.next-rig npx next dev -p 3103`,
then `/dev/rig`). Query: `mode=grid|strip|morph|bench`, `paused=1&t=…`, `sun=az,el`, `close=i`,
`cspeed`, `cdrive`, `gen=1`, `neutral=1`, `lm`, `dither`, `rim`, `outline=0`, `inner=0`.
Drag on the canvas to move the sun. `window.__rig.captureFrames(slot, n, dt)` returns a PNG
strip of native frames.

## Tests

`pnpm --filter @thoroughbred/pixel-rig test`: gait periodicity, footfall order, duty and
suspension, IK, pose periodicity and pixel snapping, stance contact, ramp generation and
anchoring, palette role mapping, rig.json validation, look resolution and morphs.
