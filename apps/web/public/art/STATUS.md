# Art drop status (PixelLab)

Updated by the art agent as batches land. Everything listed here is in `manifest.json`
(validated by `packages/art-pipeline/src/public-art.test.ts`). Scale: native pixels, render
with nearest filtering at integer scale.

## 1. Racehorse (READY)

| File | Layout | Notes |
|---|---|---|
| `race/horse-gallop.png` | 12 frames × **118×72**, horizontal strip (1416×72) | Bay horse + jockey, facing right, transparent, seamless loop (frame 11 -> 0). Suggested 12–16 fps. 37 colours. |
| `race/horse-gallop-normal.png` | same layout | PixelLab `/normal-map` pro, OpenGL convention (R = right, G = up, B = toward viewer), alpha matches sprite. |
| `race/palette.json` | | Recolour keys. Every role is an ordered ramp dark -> light of **exact** source colours. |

- **Anchor**: nose tip x = 0.932, ground y = 0.986 (hooves touch row 70 of 72). Frames are
  already aligned (x stabilised on the jockey, natural vertical bob kept, common ground line).
- **palette.json roles**: `coat` (7), `mane` (4, mane + tail), `points` (3, lower legs: black on
  bay/buckskin/dark bay, coat-coloured otherwise), `silksPrimary` (4, magenta), `silksSecondary`
  (4, cyan sleeves), `cap` (3, separate keys so the cap can differ from the body). `fixed.*`
  (skin, white breeches/saddle cloth, tack, ink outline) are never recoloured.
- **Recolour by ramp index**: source ramp colour *i* -> target ramp colour *i*. Reference
  implementation: `art-src/recolour.py` (coat ramp from COAT_PALETTES shade/body/highlight;
  silks ramp = base colour at value ×0.5..×1.0). Silks patterns (hoops, stripes...) can be
  drawn by mapping `silksPrimary` pixels to primary or secondary by position.
- Preview (recolour test, 6 coats × silks):
  `/tmp/claude-0/-home-user-ranch-game/3b0ae554-9522-55a6-a3b2-6050bd308c89/scratchpad/prev/recolour-test.png`

### Pixel-rig sources (`art-src/raw/rig/`, not served)

All 128×96, transparent, same style/scale as the gallop strip (horse ≈ 108 px long).
Each has a `*-normal.png` (PixelLab `/normal-map` pro, OpenGL).

| File | What |
|---|---|
| `horse-neutral-stance.png` | Riderless bay, **neutral extended stance**, four legs straight and separated, saddle + white cloth. Best rig base. |
| `horse-standing-alt.png` | Alternative standing bay (longer tail, more elegant neck). |
| `horse-gallop-pose-aligned.png` | Riderless horse in mid-gallop pose (legs gathered). |
| `jockey-crouch-aligned.png` | **Jockey alone** in racing crouch, magenta/cyan key colours, positioned so it overlays `horse-gallop-pose-aligned.png` exactly (see `composite-check.png`). |
| `horse-jockey-gallop-pose.png` | The original combined frame both layers were cut from. |

## 2. Race scene (READY)

All in `race/`, listed in `manifest.json` as `race.<stem>`. Every billboard/prop/texture also has a
`<stem>-normal.png` (PixelLab `/normal-map` lite, OpenGL, same size/frame layout).

| File | Size | Notes |
|---|---|---|
| `sky-clear.png`, `sky-dusk.png`, `sky-overcast.png` | 480×270 | Opaque backdrops (golden hour / dusk / rain). |
| `far-hills.png` | 960×92 | Transparent sky, **seamless-x** (mirror-tiled). Rolling fields, church spire, distant white rail. |
| `tex-turf.png`, `tex-dirt.png`, `tex-grass.png`, `tex-gravel.png`, `tex-hedge.png` | 64×64 | **Seamless top-down tiles** for the 3D ground planes (verified 4×4). Opaque. |
| `bb-tree-oak.png` (120×112), `bb-tree-oak-b.png` (115×113), `bb-tree-poplar.png` (34×110), `bb-bush.png` (41×32), `bb-bush-b.png` (43×33) | | Billboards, trimmed to bbox, anchor bottom-centre = ground. Lit from the right. |
| `bb-crowd-a.png`, `bb-crowd-b.png` | 192×64 | Crowd behind a white rail (b has bunting, cheering). |
| `bb-grandstand.png` (= `grandstand.png`) | 320×160 | Victorian two-tier stand, green/cream striped roofs, clock tower, bunting, seated crowd. |
| `bb-flag.png` | 8 frames × 41×71 | Racing-green/brass pennant waving loop, 8 fps, pole at anchor x≈0.05 (see `bb-flag.meta.json`). |
| `finish-post.png` (32×112), `furlong-pole.png` (19×72), `starting-gate.png` (256×128) | | Props, bottom = ground. Gate has numbered stalls 1–8. |
| `crowd.png` (192×64), `rail-near.png` / `rail-far.png` (192×32), `hedge-near.png` (137×48), `track-turf.png` / `track-dirt.png` (128×48) | | 2D parallax strips, **seamless-x**. |

Mock composed scene (2D layers + 4 recoloured horses):
`/tmp/claude-0/-home-user-ranch-game/3b0ae554-9522-55a6-a3b2-6050bd308c89/scratchpad/prev/mock-scene-3x.png`

## pixel-rig (USABLE, being polished) — owner: pixel-rig agent

Code-animated HD-2D horse + jockey (`@thoroughbred/pixel-rig`), cut from PixelLab sources
(`art-src/rig/raw/stand-a-0.png` + jockey inpainted on it) into a part atlas in `rig/`
(`horse-rig.json`, `horse-parts.png` (4x RotSprite atlas), `horse-parts@1x.png`,
`horse-parts-normal.png`, `horse-parts-aux.png`). Rebuild: `python3 -I art-src/rig/build_rig.py`.

```ts
import { createHorseRigFactory, strideFrequency } from "@thoroughbred/pixel-rig";
const factory = createHorseRigFactory({ artBaseUrl: "/art" }); // works immediately (generated parts), upgrades when the atlas loads
const rig = factory.create(horse.appearance, { gate });          // optional: variants / morph / seed / sabino
// every frame (before rendering the main scene):
phase += strideFrequency(speedMs) * dt;                          // or distance / strideLength(speedMs)
rig.update(renderer, { phase, speedMs, drive, lightDir /* world, towards sun */, time,
                       spriteRight /* optional world dir of sprite +x, default (1,0,0) */,
                       spriteOut   /* optional world dir towards camera, default (0,0,1) */ });
billboardMaterial.map = rig.texture;   // NearestFilter, no mipmaps, transparent background, alphaTest 0.5
```

- **Texture**: `rig.width × rig.height` = **128 × 96** native px. Colour space **sRGB**
  (SRGB8_ALPHA8 target, sampled as linear like any sRGB map). Alpha is 0/1.
- **Anchor**: `rig.anchor` = ground contact under the barrel in texture px **from the top-left**
  (currently x = 64, y = 89). Billboard: place so that UV (x/128, 1 - y/96) sits on the ground.
  The horse faces +x (east/right); the near (visible) side is the horse's right.
- Lighting is already done in the texture (sun → normals → palette ramp + dither + outline), so
  use an unlit material (MeshBasicMaterial / custom) for the billboard; tint for fog is fine.
- Cost: ~2 draw calls per rig per update (16 rigs ≈ 32 small draws). Call `rig.dispose()` /
  `factory.dispose()`.
- Harness: `/dev/rig` (`?mode=grid|strip|morph|bench`), dev server port 3103.
