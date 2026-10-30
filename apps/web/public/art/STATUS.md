# Art drop status (PixelLab)

Updated by the art agent as batches land. Everything listed here is in `manifest.json`
(validated by `packages/art-pipeline/src/public-art.test.ts`). Scale: native pixels, render
with nearest filtering at integer scale.

## 1. Racehorse — HD v2 (READY)

| File | Layout | Notes |
|---|---|---|
| `race/horse-gallop.png` | 12 frames × **229×146**, horizontal strip (2748×146) | **HD v2.** Bay horse + jockey (goggles, magenta/cyan key silks), facing right, transparent, seamless loop (11 -> 0). Horse ≈ 215 px nose to tail. 12–16 fps. 47 colours. |
| `race/horse-gallop-normal.png` | same layout | PixelLab `/normal-map` pro per frame, OpenGL convention (R = right, G = up, B = toward viewer), alpha matches sprite. |
| `race/palette.json` | | Recolour keys for the HD strip. Every role is an ordered ramp dark -> light of **exact** source colours. |
| `race/horse-idle.png` + `horse-idle-normal.png` | 14 frames × **256×192** | Standing at the start/parade (breathing, ear/tail flicks), ping-pong baked so it loops, ~6 fps. Anchor nose x = 0.98, ground y = 1.0. **Uses the same `palette.json` keys** as the gallop. |
| `race/horse-gallop-lo.png` + `-lo-normal.png` + `palette-lo.json` | 12 × 118×72 | v1 low-res fallback (same scheme, smaller ramps). |

- **Anchor** (HD): nose tip x = 0.974, ground y = 0.993 (hooves touch row 144 of 146). Frames are
  aligned (x stabilised on the silks, natural vertical bob kept, common ground line).
- **palette.json roles** (HD): `coat` (9), `mane` (5, mane + tail), `points` (4, lower legs: black on
  bay/buckskin/dark bay, coat-coloured otherwise), `silksPrimary` (5, magenta), `silksSecondary`
  (5, cyan sleeves), `cap` (4, separate keys so the cap can differ from the body). `fixed.*`
  (skin, white breeches/cloth, tack incl. girth/boots/saddle, ink outline, accent = goggle lenses)
  are never recoloured.
- **Recolour by ramp index**: source ramp colour *i* -> target ramp colour *i*. Reference
  implementation: `art-src/recolour.py` (coat ramp from COAT_PALETTES shade/body/highlight;
  silks ramp = base colour at value ×0.5..×1.0). Silks patterns (hoops, stripes...) can be
  drawn by mapping `silksPrimary` pixels to primary or secondary by position.
- Previews: HD recolour test (6 coats × silks × 4 frames):
  `/tmp/claude-0/-home-user-ranch-game/3b0ae554-9522-55a6-a3b2-6050bd308c89/scratchpad/prev/recolour-test-hd.png`
  (v1: `.../scratchpad/prev/recolour-test.png`)
- No canter strip: PixelLab's "canter" came out as another gallop, so it was not shipped — play
  the gallop at ~8–10 fps for a canter.
- Known: girth/boot detection is heuristic; on light coats a few frames may show a 1–2 px
  coat-coloured fleck on the girth.

### Pixel-rig sources HD v2 (`art-src/raw/rig-hd/`, not served) — use these

All **256×192**, transparent, same HD density as the HD gallop (horse ≈ 238 px nose to tail).
Each has a `*-normal.png` (PixelLab `/normal-map` pro, OpenGL).

| File | What |
|---|---|
| `horse-neutral-stance-256.png` | Riderless bay, **neutral extended stance**, four legs straight and separated, racing saddle + white cloth + girth, bridle. Hooves on the bottom row. |
| `jockey-crouch-256.png` | **Jockey alone** (magenta/cyan key silks, cap, goggles, white breeches, black boots) in racing crouch, positioned to overlay `horse-neutral-stance-256.png` exactly (see `composite-check.png`). |
| `horse-jockey-neutral-256.png` | The original combined frame both layers were cut from (reference). |
| `horse-standing-alt-256.png` | Alternative riderless standing bay (different seed). |

### Pixel-rig sources (`art-src/raw/rig/`, not served) — v1 128×96

All 128×96, transparent, same style/scale as the gallop strip (horse ≈ 108 px long).
Each has a `*-normal.png` (PixelLab `/normal-map` pro, OpenGL).

| File | What |
|---|---|
| `horse-neutral-stance.png` | Riderless bay, **neutral extended stance**, four legs straight and separated, saddle + white cloth. Best rig base. |
| `horse-standing-alt.png` | Alternative standing bay (longer tail, more elegant neck). |
| `horse-gallop-pose-aligned.png` | Riderless horse in mid-gallop pose (legs gathered). |
| `jockey-crouch-aligned.png` | **Jockey alone** in racing crouch, magenta/cyan key colours, positioned so it overlays `horse-gallop-pose-aligned.png` exactly (see `composite-check.png`). |
| `horse-jockey-gallop-pose.png` | The original combined frame both layers were cut from. |

## 1b. Race-day animations (READY, not wired yet)

New strips for the broadcast, all in `race/` and in `manifest.json`, each with a `-normal.png`
(same size and layout; horses: PixelLab `/normal-map` pro per frame like the gallop; crowd:
`/normal-map` lite; fx: computed in code). Sources, prompts and the rebuild script:
`art-src/race/RACEANIMS.md`.

### Horse strips: shared conventions

- **Frame 256×192**, horizontal strip, transparent, alpha 0/255, facing right. Same density as
  `horse-gallop.png` (one sprite px = one gallop px), so a billboard is **256/229 × 192/146** the
  size of the gallop's quad.
- **Recolour exactly like the gallop**: every opaque pixel is one of the `race/palette.json` keys
  (coat, mane, points, silksPrimary, silksSecondary, cap + `fixed.*`), so the existing per-horse
  recolour bake works unchanged on these strips. The test enforces it.
- **Ground**: the lowest hoof of each strip is on **row 191** (anchor y = 1.0). Frames keep their
  natural bob and suspension (hooves above 191 in some frames).
- **Anchor** = the gallop's own anchor point (its nose/ground point, x 0.974 of 229) mapped into the
  new frame: **x = 0.926, y = 1.0** (lunge: **x = 0.879**). Place every horse strip by its anchor at
  the horse's world position and the body lines up with the gallop. In pixels: gallop pixel (x, y)
  = race-day pixel (x + 14, y + 47) (lunge: x + 2, generated 12 px left so the stretched nose fits).
- **Body height**: drive and lunge sit **7 px lower** than the gallop (horse flattened and stretched
  out, hooves still on the ground); celebrate 4 px higher; the others within 1 px. A cut is fine;
  to hide it, tween the sprite y over ~3 frames.
- Hand-ride only: the drive and lunge jockey pushes with hands and heels and **never uses the whip**
  (welfare-friendly; prompts say "no whip").

| File | Frames | fps | Loop | Enter | Exit |
|---|---|---|---|---|---|
| `horse-break.png` | 8 | 12 | no | Frame 0 = standing in the stalls (all four hooves down, weight back, jockey crouched): hold it while the gates are shut. | After frame 7 play **gallop frame 0** (the generation's 9th frame was gallop frame 0 itself and was dropped). |
| `horse-drive.png` | 12 | 14 (same as gallop) | 11 → 0 | Frame k starts in gallop frame k's leg phase at k = 0: switch at the gallop's frame 0 → drive 0 (any frame works with a small pop). Final furlong / under pressure. | Back to gallop at drive 11 → gallop 0, or into the lunge. |
| `horse-lunge.png` | 6 | 12 | no | **After drive frame 11** (lunge 0 follows drive 11). Start it ~0.5 s before the post. | Frame 5 = full stretch (head and neck out, jockey's arms extended): **hold it for the photo-finish freeze**. Then ease-up (cut). |
| `horse-easeup.png` | 13 | 10 (or 12 → 8 across the strip) | no | Frame 0 = gallop frame 0: after gallop frame 11, or cut from drive/lunge after the line. | Gallop strides (0–6), jockey sits up (7–9), trot (10–12). Hold 12 while the sprite slows, or go to celebrate (winner) / idle. |
| `horse-celebrate.png` | 11 | 10 | 10 → 0 | Winner after the line: from ease-up (any frame, cut) or straight from drive. Jockey stands in the irons, right arm raised, punching the air; horse canters. | Loop. |
| `horse-pullup.png` | 10 | 10 for 0–4, 6 for 5–9 | no | Frame 0 = gallop frame 0 (enter after gallop 11). Jockey sits up and stops the horse; short uneven steps (favouring the right fore), nothing graphic. | Frame 9: standing still on four hooves. Hold it; bring the sprite speed to 0 by frame 9. |

Note: `horse-idle.png` is drawn ~1.21× larger than the gallop (and these strips). For the stalls,
use `horse-break` frame 0 (gallop scale) rather than the idle, or scale the idle by 1/1.21.

### Ground effects (`fx-mud.png`, `fx-dust.png`, `fx-divot.png`)

- 8 frames × **48×32**, one-shot (not looping): a burst rising up and **back to the left** (for a
  right-facing horse; mirror for a left-facing one), then falling/settling. mud 14 fps, dust 12 fps,
  divot 14 fps (≈ 0.6 s). Same pixel density as the horse.
- **Anchor** (manifest `anchor`) = the hoof contact point: mud (0.812, 0.812), dust (0.729, 0.812),
  divot (0.792, 0.844). Spawn at the hoof's ground position when it strikes (4 strikes per stride:
  one burst per stride from the leading hind hoof reads well; add ±3 px jitter and an occasional
  horizontal flip), then let it stay in world space while the horse runs on.
- **Colour by surface**: `race/fx-palette.json`. `keys[strip][role]` are the exact source colours
  (dark → light; roles `material`, plus `grass` on the divot); `surfaces["<surface>/<going>"][strip][role]`
  is the target ramp of the same length (recolour by ramp index, like the horses). Surfaces:
  `turf/firm|good|soft|heavy`, `dirt/firm|good|soft|heavy`, `synthetic/*`. Ramps are sampled from
  `tex-dirt.png` (soil and dust), with the divot's own greens for grass, darker and more saturated as
  the going softens.
- **Which strip where**: `emit["<surface>/<going>"]` (first = main, rest = occasional): turf firm →
  dust; good → divot; soft → divot + mud; heavy → mud + divot; dirt firm/good → dust; dirt
  soft/heavy (wet) → mud; synthetic → mud (dark granules) + dust.

### Cheering crowd (`crowd-cheer.png`)

- 10 frames × **320×128** (same size, scale and seamless-x tiling as `crowd.png`), 8 fps, loop
  (ping-pong baked in: 0 1 2 3 4 5 4 3 2 1). **Frame 0 is pixel-identical to `crowd.png`**, so it drops
  in for the static strip; play it while the field passes / at the finish, rest on frame 0 otherwise.
  People wave arms and race cards, jump and clap; the rail stays put.

Previews: contact sheet `/tmp/claude-0/-home-user-ranch-game/0b8609fd-c589-5d91-8b9c-ad4f22ab63cb/scratchpad/raceanims/contact-sheet.png`,
recolour test (6 coats × 3 silks × 8 frames across the strips) `.../raceanims/recolour-test.png`, fx tints per
surface `.../raceanims/fx-recolour.png`.

## 2. Race scene — HD v2 (READY)

All in `race/`, listed in `manifest.json` as `race.<stem>` (same stems as v1, so loaders need no
change). Billboards/props have `<stem>-normal.png` (PixelLab `/normal-map` lite, OpenGL, same
size/frame layout); ground tiles have **seamless** normals computed in code (`art-src/tile_normals.py`).

| File | Size | Notes |
|---|---|---|
| `sky-clear.png`, `sky-dusk.png`, `sky-overcast.png` | 688×384 | Opaque backdrops (PixelLab max for 16:9; 960×540 isn't possible natively — stretch on the sky dome / mirror-repeat, don't upscale non-integer). |
| `far-hills.png` | 1376×86 | Transparent sky, **seamless-x** (mirror-tiled). Rolling fields, church spire, distant white rail. |
| `tex-turf.png`, `tex-dirt.png`, `tex-grass.png`, `tex-gravel.png`, `tex-hedge.png` | **128×128** | **Seamless top-down tiles** (gradient-flattened + min-cut quilted, verified 4×4). Opaque. v1 64 px kept as `tex-*-lo.png`. |
| `bb-tree-oak.png` (240×226), `bb-tree-oak-b.png` (236×208), `bb-tree-poplar.png` (70×240), `bb-bush.png` (54×47), `bb-bush-b.png` (72×49) | | Billboards, trimmed to bbox, anchor bottom-centre = ground. Lit from the right. |
| `bb-crowd-a.png`, `bb-crowd-b.png` | 384×128 | Crowd behind a white rail (b: cheering, bunting). |
| `bb-grandstand.png` (= `grandstand.png`) | 640×319 | Victorian two-tier stand, striped roofs, clock tower, bunting, packed seats. |
| `bb-flag.png` | 8 frames × 90×100 | Pennant waving loop, 8 fps, pole at anchor x≈0.056. |
| `finish-post.png` (49×202), `furlong-pole.png` (32×142), `starting-gate.png` (512×211) | | Props, bottom = ground. Gate stalls numbered 1–8. |
| `crowd.png` (320×128), `rail-near.png` / `rail-far.png` (336×64), `hedge-near.png` (320×96), `track-turf.png` / `track-dirt.png` (256×96) | | 2D strips, **seamless-x** (min-cut quilted). |

Mock HD scene (960×540, 4 recoloured HD horses):
`/tmp/claude-0/-home-user-ranch-game/3b0ae554-9522-55a6-a3b2-6050bd308c89/scratchpad/prev/mock-scene-hd.png`
(v1: `.../scratchpad/prev/mock-scene-3x.png`)

## 3. Portraits (READY, HD v2)

`portraits/horse-<coat>.png` for every `CoatSchema` coat (bay, dark_bay, chestnut, liver_chestnut,
black, grey, dapple_grey, palomino, buckskin, roan): **128×128**, transparent, head-and-neck
facing left, leather halter, small white star. Identical framing across coats (bbox 17,6–113,121),
so they can be swapped in place. Made from one bay master (`/generate-image-v2`) + per-coat
`/edit-images-v2`.

## 4. UI kit (READY)

`ui/ui.json` holds the 9-slice insets and the icon list.

| File | Size | 9-slice (t,r,b,l) | Notes |
|---|---|---|---|
| `ui/panel-9slice.png` | 64×64 | 18,18,18,18 | Racing-green panel, brass frame, oxblood corner plates with rivets. |
| `ui/card-9slice.png` | 72×72 | 24,24,24,24 | Cream parchment card, oxblood frame, brass scroll corners. |
| `ui/button.png`, `-hover.png`, `-pressed.png` | 48×25 | 8,12,8,12 | Oxblood button with brass bevel (hover = brighter, pressed = darker, content 1 px down). |
| `ui/button-green.png`, `-hover`, `-pressed` | 56×30 | 9,14,9,14 | Racing-green variant. |
| `ui/logo.png` | 110×93 | | Emblem: brass horseshoe + green shield + galloping horse + laurels + blank oxblood ribbon (put "Thoroughbred" text over the ribbon in the pixel font). |
| `ui/icon-<name>.png` | 32×32 each, 64 icons | | One consistent sheet. Asked-for: `coin`, `trophy`, `horseshoe` (gold, clover), `horseshoe-iron`, `stopwatch`, `flag`, `star`, `rosette`, `saddle`, `calendar`, `badge-gold/silver/bronze`. Plus 50 extras (cap-checked, silks-sash, binoculars, racecard, bell, money-sack, hay, apple, carrots, stable-door, tote, trophy-silver, ...). Full list in `ui.json`. |

CSS: `border-image: url(/art/ui/panel-9slice.png) 18 fill / 36px / 0 round; image-rendering: pixelated;`
(border width = inset × display scale).

## 5. Page scenes (READY)

`scenes/stable-yard.png`, `scenes/paddock.png`, `scenes/grandstand.png`, `scenes/barn-interior.png`
— opaque, **688×288** (HD v2), golden hour (barn: lantern-lit interior).

## pixel-rig (HD, opt-in in the viewer via `?rig=1`) — owner: pixel-rig agent

Code-animated HD-2D horse + jockey (`@thoroughbred/pixel-rig`), cut from **256×192** PixelLab
sources (`art-src/rig/raw/hd-stand.png` + jockey inpainted on it, `/normal-map` pro) into a part
atlas in `rig/` (`horse-rig.json`, `horse-parts.png` (4x RotSprite atlas), `horse-parts@1x.png`,
`horse-parts-normal.png`, `horse-parts-aux.png`). Rebuild: `python3 -I art-src/rig/build_rig.py`.
Full docs: `packages/pixel-rig/README.md`.

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

- **Texture**: `rig.width × rig.height` = **256 × 192** native px (HD density 2; the sources are
  rendered 1:1, nothing is downsampled; horse ≈ 190 px standing, ≈ 215 px galloping with the
  tail out → 96 px/m puts it at ~2.2 m). Colour space **sRGB** (SRGB8_ALPHA8 target, sampled as
  linear like any sRGB map). Alpha is 0/1.
- **Anchor**: `rig.anchor` = ground contact under the barrel in texture px **from the top-left**:
  **x = 128, y = 179**. Billboard: UV (x/256, 1 - y/192) sits on the ground. The horse faces +x
  (east/right); the near (visible) side is the horse's right.
- Lighting, palette quantisation, dithering and the outline are already in the texture: draw it
  unlit (MeshBasicMaterial / custom); fog tint is fine.
- Cost: 2 small draw calls per rig per update; CPU pose ~0.01 ms per rig. `rig.dispose()` /
  `factory.dispose()`. Saddle cloths show the gate number.
- Verified: `/dev/viewer?rig=1` and `/race/<id>?rig=1` with zero WebGL errors/warnings from the
  rig (swiftshader / ANGLE in headless Chromium; no real GPU in this container).
- Harness: `/dev/rig` (`?mode=grid|strip|morph|bench`), dev server port 3103.
