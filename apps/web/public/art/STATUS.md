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
