# Art Direction & Asset Contract

The procedural vector art is retired as the primary look. **Everything visual comes from
PixelLab-generated pixel art.** Procedural drawing remains only as a fallback when an
asset is missing.

## Style

- **High-res pixel art.** Crisp, hand-pixelled look with selective dark outlines, rich
  shading and limited cohesive palettes. Always rendered with nearest-neighbour scaling
  (`image-rendering: pixelated`; Pixi `scaleMode: "nearest"`) at integer scales
  (2×, 3× or 4×). Never blur.
- **Mood.** A warm golden-hour English racecourse: honey sunlight, long shadows, deep
  greens, white rails, a striped grandstand with bunting, a lively crowd. A secondary dusk
  palette (orange to violet) and an overcast/rain variant.
- **UI.** A pixel-art game UI in a "racing club" palette: deep racing green `#0f2a1d`, warm
  cream `#f3e7c9`, brass `#d9a441`, oxblood `#7a1f1f` and ink `#0b0f0c`. Chunky 9-slice
  framed panels, pixel icons, a pixel display font for headings and numbers, and a clean
  readable font for body text. It should feel like a premium indie management sim, not a
  generic web dashboard.

## HD-2D: pixel art in a real 3D scene

The target is **HD-2D**: hand-quality pixel-art sprites living inside a true 3D world.

- **Renderer.** The race renders in **Three.js** (`three@0.180.0` in `packages/race-viewer`).
  The track, rails, ground and terrain are real 3D geometry textured with PixelLab pixel
  textures (nearest filtering). Horses, jockeys, trees, crowd and props are **pixel-art
  billboards** (camera-facing or axis-locked quads) placed in 3D.
- **Light.**
  - A warm directional sun.
  - Sprites lit through **PixelLab normal maps** (`/v2/normal-map`), so the gallop catches
    rim light.
  - Real ground shadows: blob shadows or shadow maps from the billboards.
  - Hemisphere fill, and fog for aerial perspective.
- **Lens.** Tilt-shift **depth of field** (sharp at the focus horse, soft foreground and
  background), gentle **bloom** on highlights, vignette and a subtle colour grade. The
  postprocessing passes come from `three/examples/jsm` (EffectComposer, UnrealBloomPass,
  BokehPass, or a custom tilt-shift shader).
- **Camera.** A real perspective camera that dollies alongside the field, cranes up at the
  start, swings to a low angle in the final furlong, and cuts to a head-on photo-finish view.
  Lanes and depth come from real perspective.
- **Pixel integrity.** Sprite textures use NearestFilter with no mipmaps. Every effect
  (DOF, bloom) happens in screen space, so the sprites keep their pixel art. The canvas can
  render at a low internal resolution and upscale with nearest filtering for the most
  authentic pixel look; this is a quality toggle.
- **Pixel art drawn in code.** Where PixelLab output needs help, code finishes it:
  - palette clamping and recolouring;
  - outline passes;
  - generated normal maps as a fallback;
  - procedural pixel VFX: dust, turf clods, rain and confetti, all drawn as pixel quads.
  - Never smooth vector shapes.

## Pixel rig pipeline: PixelLab as source, code makes it HD-2D

We don't rely on a template gallop. PixelLab provides **source material**: base sprites,
parts, textures and normals. Our own code produces the final pixels:

1. **Part rig.** A side-view PixelLab horse and jockey are cut into parts (head, neck,
   barrel, hindquarter, upper and lower legs near and far, tail, mane, jockey torso, arms and
   head). Cut masks and pivots are defined in code (JSON). Hidden areas are filled with
   PixelLab inpainting. A **code-driven skeletal gallop** with gait phases, speed-matched
   stride, head nod, tail flow and a jockey push in the final furlong animates the parts.
   That gives unlimited smooth frames at any speed.
2. **Pixel-snapped rendering.** Each horse rig renders into its own **low-res render target**
   (native sprite resolution), with nearest filtering and part rotations snapped to the pixel
   grid, so motion stays crisp pixel art (RotSprite-like, never blurry).
3. **3D lighting on pixels.** Every part carries a normal map and a height map: from PixelLab
   `/normal-map`, plus normals derived in code by inflating the silhouette distance field.
   A shader lights each pixel from the scene's sun, with rim light and coat sheen, then
   **quantises the result to the horse's palette ramp** with ordered (Bayer) dithering. The
   result is real 3D light that still reads as hand-shaded pixel art.
4. **Code passes.** A one-pixel selective outline (darker hue of the neighbour ramp, not
   black), palette clamping, recolouring per coat and silks, and pixel VFX.
5. The rig's render target is used as a **billboard texture** in the Three.js world. It casts a
   shadow and is lit consistently with the world.

## HD pixel standard (v2, supersedes the native scale below)

User feedback: "still not HD pixel". The first drop was low-density: a 118×72 horse,
64 px tiles, and heavy depth-of-field blur. HD pixel art means **more native pixels and
consistent pixel density**, not bigger chunky pixels.

- **Horse and jockey:** frames of about **240×150 native** (PixelLab maximum is 256), with
  the horse about 220 px nose to tail. Smooth 12–16 frame gallop. The rig sources are
  256×192.
- **Pixel density:** every world asset is authored so that one texel covers about the same
  screen area when it sits in the focal plane. That's about **96 px per metre** for horses
  and props near the action. There's no mixing of chunky and fine pixels in the same plane.
- **Textures:** ground tiles at **128×128**. Billboards (trees, stand, crowd) at about **2×**
  the first drop. Sky and hills authored at 960×540.
- **Rendering:**
  - Internal resolution of at least **960×540**; on desktop, render at device resolution
    with nearest sampling.
  - Depth of field is subtle: the focal band (the field of horses) stays tack-sharp, with
    blur only on the far background and nearest foreground.
  - No blurring of sprites. Bloom is gentle, and text is always crisp.
- **UI:** pixel icons at 24–32 px native, displayed at 1× or 2×; portraits at 128×128.

## Native scale (v1, superseded)

- The race canvas is designed at **480×270 native pixels** (16:9) and shown at 3–4× on
  desktop. Background layers are 270 px tall or less.
- The racehorse frame is about **96–128 px wide** native (side view, facing **east/right**).

## File contract (`apps/web/public/art/`)

| Path | What | Format |
|---|---|---|
| `manifest.json` | Every generated asset, validated by `AssetManifestSchema` (`@thoroughbred/art-pipeline`): `origin: "pixellab"`, `status: "approved"`, `sourcePrompt`, `frameCount`, `frameWidth`, `frameHeight`, `fps`, `anchor`, `depthBand`, `palette`, `src` | JSON |
| `race/horse-gallop.png` | Racehorse gallop cycle **with jockey**, facing right, transparent, horizontal strip of `frameCount` frames | PNG strip |
| `race/horse-canter.png`, `race/horse-idle.png` | Optional extra states (post parade, gate) | PNG strip |
| `race/jockey-gallop.png` | *Only if* the jockey is a separate layer: same frame size and count, aligned overlay | PNG strip |
| `race/palette.json` | Recolour keys: `{ "coat": [hex dark→light], "mane": [...], "silksPrimary": [...], "silksSecondary": [...], "cap": [...] }`. These are the exact source colours in the sprite that the viewer swaps per horse. | JSON |
| `race/sky-{clear,dusk,overcast}.png` | Sky gradient and clouds | PNG |
| `race/far-hills.png`, `race/grandstand.png`, `race/crowd.png`, `race/rail-far.png`, `race/track-turf.png`, `race/track-dirt.png`, `race/rail-near.png`, `race/hedge-near.png` | Parallax layers, **horizontally tileable** | PNG |
| `race/finish-post.png`, `race/furlong-pole.png`, `race/starting-gate.png` | Props | PNG |
| `race/*-normal.png` | Normal maps matching sprites (same size and frame layout), e.g. `horse-gallop-normal.png` | PNG |
| `race/tex-{turf,dirt,grass,gravel,hedge}.png` | **Seamless top-down tiles** (32–64 px) for the 3D ground planes | PNG |
| `race/bb-{tree-oak,tree-poplar,bush,crowd-a,crowd-b,flag,grandstand}.png` | Billboard sprites placed in 3D | PNG |
| `portraits/horse-<coat>.png` | Head-and-neck portrait facing left, one per coat in `CoatSchema` | PNG |
| `portraits/anim/horse-<coat>.png`, `anim/thumb/…`, `anim/index.json` | Idle loop (blink, ear flick, breath) per coat, ping-pong strip of 128 px frames, and its 64 px thumbs (`art-src/portrait_anims.py`) | PNG strip |
| `portraits/roles.png`, `portraits/portrait-marks.png`, `portraits/anim/warp/horse-<coat>.png` | Genetic portrait data (`apps/web/scripts/portrait-roles.py`): role map + shading level + flags, the five face-marking masks, and per-frame warps from each idle-loop pixel to the still pixel it shows | PNG (data) |
| `ui/*.png` | Panel 9-slice frames, buttons, icons (coin, trophy, horseshoe, stopwatch, flag, star, rosette), logo emblem | PNG |
| `scenes/*.png` | Wide page backdrops: stable yard, paddock, grandstand/finish line, barn interior | PNG |

### Recolouring (one animation, every horse)

The racehorse is generated **once** in a bay coat, with jockey silks in two flat **key
colours**: a magenta ramp for primary and a cyan ramp for secondary (cap in primary). The
palette is reduced so each role uses a small fixed set of exact colours, listed in
`race/palette.json`. The viewer bakes a recoloured texture per horse appearance at load
time: coat ramp from `COAT_PALETTES`, silks from the horse's silks. One gallop cycle gives
every coat and silks combination with identical animation quality.

### Genetic 3/4 portraits (one painting, every coat)

The ten painted 3/4 portraits share one silhouette, so a pixel's meaning is found by comparing
them. `python3 -I apps/web/scripts/portrait-roles.py` (run after any portrait or idle loop
changes, after `art-src/portrait_anims.py`, then `pnpm --filter @thoroughbred/web art-index`)
writes:

- `roles.png`: R = role x 28 (clear, outline ink, bridle leather, bridle metal, eye, coat, mane,
  muzzle skin, inner ear), G = shading LEVEL (the grey painting's luminance, normalised per
  role), B = flags (bit 0 face-front plane, bit 1 the painted star and its fringe);
- `portrait-marks.png`: star, snip, stripe, blaze and bald masks (five 128 px bands);
- `anim/warp/horse-<coat>.png`: for each idle-loop frame pixel, the still pixel it shows
  (R = x, G = y; block matching, then an exact-colour refine). The PixelLab frames re-draw
  the head, so roles, markings and patterns are read through the warp and ride with it.

At runtime `paintGeneticPortrait` (`@thoroughbred/art-pipeline`, pure) recolours every frame:
the gene palette's ramp by LEVEL plus the painting's own achromatic detail (its luminance
minus its median at that LEVEL), white patterns from masks in still space, and fixed roles
(outline, bridle, painted eye) untouched. `HorsePortrait` swaps the result in after hydration
in the same box, caches it per genes, and keeps the painted file if anything fails. Legacy
appearances (no layered `colour`) keep the painting. `/dev/coats` has a cell per coat and gene.

## Budget

PixelLab account: $31.62 credit plus 10,000 subscription generations. Art generation
should aim for the **highest quality available**: prefer Pro endpoints for hero assets, and
spend up to about **$25 of credit** (keep a reserve of about $6). Check `GET /v2/balance` before and after
each batch, and prefer cheaper endpoints for iteration. Store raw generations and the
prompts used in `art-src/` (sources, not served).
