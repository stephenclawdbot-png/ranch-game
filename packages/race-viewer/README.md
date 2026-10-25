# @thoroughbred/race-viewer

HD-2D playback of a stored `RaceReplay`: pixel-art sprites in a real 3D racecourse (React
19 + Three.js 0.180). The server simulates races; this package only plays the replay
back. Positions come from replay frames, and the winner and finishing order from
`replay.result`.

```tsx
import { RaceViewer } from "@thoroughbred/race-viewer";

<RaceViewer
  replay={replay}              // memoize: a new object rebuilds the scene
  startAtMs={race.postTimeMs}  // optional wall-clock sync (countdown, live, already-over)
  highlightHorseId={myHorseId} // optional marker + "My horse" camera
  onFinished={() => {}}        // fires once when playback first reaches the end
/>
```

| Prop | Default | Notes |
|---|---|---|
| `replay` | (required) | `RaceReplay` from `@thoroughbred/shared` |
| `startAtMs` | none | `elapsed = (Date.now() - startAtMs) / 1000`. A negative value shows the gate-loading countdown. When the race is already over, the viewer opens on the result card. Shows a **Live** button. |
| `autoplay` | `true` | Without `startAtMs`, play starts with a ~1.6 s pre-roll at the gates. |
| `highlightHorseId` | none | Gold pixel marker and ground ring, highlighted standings and result row. |
| `onFinished` | none | Called once. |
| `className`, `height` | responsive 16:9, min 320 px | `height` sets the stage height in px. The controls overlay the bottom of the stage. |
| `quality` | `"auto"` | `"auto"` picks low on narrow or low-core/low-memory devices. It also drops to low at runtime when frames run over 25 ms. High has shadows, DOF, bloom and grade at up to 2× DPR. Low renders at ~360 px internal height, upscaled with nearest filtering, with no post-processing. |
| `debug` | `false` | fps, CPU ms, horse source, camera shot |
| `artBaseUrl` | `"/art"` | Root of the art drop (`manifest.json`). A 404 or invalid manifest falls back to code-drawn art. `null` skips the fetch. |
| `pixelated` | `false` | Renders at a low internal resolution with a nearest upscale, even on high quality |
| `initialTimeSec`, `initialCamera` | none | Dev and deep-link extras |

The other exports are `CameraMode` (`"leader" | "mine" | "wide"`), `sampleReplay`,
`createReplaySampler`, `replayTiming`, `standingsAt`, `distanceToGoM`, `commentaryAt` and
`PlaybackClock`. Dev-only helpers (`fakeReplay`, `SpriteSheet` for art QA) live in
`@thoroughbred/race-viewer/dev`. The main entry doesn't import three.js: it loads with
`import()` inside an effect, so the component is safe under SSR. Init is StrictMode-safe,
and everything is disposed on unmount.

## How it works

- **Sampling** (`sampleReplay.ts`): cubic Hermite between 10 Hz frames, clamped per segment.
  It never extrapolates past the last frame. After the line, finish state and order come
  from `result`. Finished horses pull up visually (a decaying speed past the post).
- **Clock** (`playback.ts`): local or wall-clock playback, speeds 0.5/1/2/4×. On a photo
  finish it plays slow-mo for the last ~14 m, then holds a 1.4 s **PHOTO** freeze. A live
  viewer falls behind by that time instead of skipping it.
- **World** (`three/HD2DScene.ts`): metres, with x along the track, y up and z across (the
  inner rail at z = 0 nearest the camera). It contains:
  - textured ground planes (turf mowing stripes or dirt/synthetic, plus infield and
    outfield grass);
  - instanced white rails, furlong poles with pixel-font signs, the winning post with its
    roundel, and the finish line;
  - a 3D starting gate whose doors swing open;
  - a foreground hedge;
  - pixel billboards for the grandstand (animated crowd, bunting, flags), rail-side
    spectators and trees;
  - far hills, pixel clouds, the sun and a dithered sky dome.

  Lighting is a warm directional sun with shadow maps on high quality, a hemisphere fill
  and fog. Weather presets cover clear golden hour, dusk, overcast and rain (with 1px rain
  streaks).
- **Pixel art drawn in code** (`three/pixelTextures.ts`): every fallback texture is
  painted per pixel from small palette ramps with Bayer dithering, never smooth
  gradients. PixelLab files listed in the manifest (`race/tex-*`, `race/bb-*`,
  `far-hills`, `sky-*`) replace them automatically.
- **Horses** (`three/horseRig.ts`): axis-locked billboards (limited yaw) placed by the
  rig's ground anchor at 0.025 m per sprite pixel, with contact shadows. The gait frame
  follows distance travelled / stride (~7 m), so hooves don't slide. The jockey drive ramps
  up after a kick and through the final furlong. Sources, best first:
  1. `@thoroughbred/pixel-rig` (`createHorseRigFactory`), used automatically once the
     package exports an implementation;
  2. the approved PixelLab strip `race/horse-gallop.png`, recoloured per horse from
     `race/palette.json` (coat ramp from `COAT_PALETTES`, silks, cap, silks pattern
     painted on the primary keys) and lit with `horse-gallop-normal.png`;
  3. a code-drawn keyed placeholder that goes through the same recolour path.
- **Camera**: critically damped springs with feed-forward velocity. The shots are: a
  crane down onto the gates; a telephoto dolly alongside the leader or my horse; a wide
  shot that fits the whole field; a low angle ahead of the leader in the final furlong;
  a cut to the judge's camera on the line for photo finishes; and a hold on the post while
  the rest finish. The horizontal FOV is kept constant on narrow screens.
- **Lens** (`three/post.ts`): scene to a render target with depth, a quarter-res blur
  chain, then a composite with depth DOF focused on the followed horse, tilt-shift, soft
  bloom, colour grade, vignette and the photo flash. Sprites stay crisp because the sharp
  layer is sampled 1:1 with nearest filtering.
- **VFX** (`three/vfx.ts`): square pixel point sprites for hoof dust, turf clods and finish
  confetti.
- **HUD** (`hud/`): HTML overlay in the racing-club pixel style. It uses the web app's
  `--font-*` variables, with fallbacks.

## Dev

- Harness: `apps/web/app/dev/viewer`. Query params are `weather`, `surface`, `horses`,
  `seed`, `distance`, `t`, `start` (seconds to post), `paused`, `camera`, `quality`,
  `highlight`, `pixel`, `art=none`, and `studio=1` for the sprite-sheet QA view.
- `pnpm --filter @thoroughbred/race-viewer test` and `pnpm --filter @thoroughbred/race-viewer typecheck`
- `pixi.js` is still listed in `package.json` but is no longer imported (the lead will drop it).
