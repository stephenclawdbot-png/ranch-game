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

## Native scale

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
| `ui/*.png` | Panel 9-slice frames, buttons, icons (coin, trophy, horseshoe, stopwatch, flag, star, rosette), logo emblem | PNG |
| `scenes/*.png` | Wide page backdrops: stable yard, paddock, grandstand/finish line, barn interior | PNG |

### Recolouring (one animation, every horse)

The racehorse is generated **once** in a bay coat, with jockey silks in two flat **key
colours**: a magenta ramp for primary and a cyan ramp for secondary (cap in primary). The
palette is reduced so each role uses a small fixed set of exact colours, listed in
`race/palette.json`. The viewer bakes a recoloured texture per horse appearance at load
time: coat ramp from `COAT_PALETTES`, silks from the horse's silks. One gallop cycle gives
every coat and silks combination with identical animation quality.

## Budget

PixelLab account: $31.62 credit plus 10,000 subscription generations. Art generation
should aim for the **highest quality available**: prefer Pro endpoints for hero assets, and
spend up to about **$25 of credit** (keep a reserve of about $6). Check `GET /v2/balance` before and after
each batch, and prefer cheaper endpoints for iteration. Store raw generations and the
prompts used in `art-src/` (sources, not served).
