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
| `replay` | — | A finished `RaceReplay` (full controls). Pass exactly one of `replay` / `feed`. |
| `feed` | — | A `LiveRaceFeed` (live broadcast). See **Live mode** below. |
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
| `view` | URL / remembered / `"trackside"` | `"trackside"` (default) or `"classic"`. When omitted: `?view=classic` / `?view=trackside` on the page URL, then the viewer's last choice (`localStorage["rv:view"]`, guarded), then Trackside. The **3D view / Trackside** button in the controls toggles it. |

The other exports are `CameraMode` (`"leader" | "mine" | "wide"`), `sampleReplay`,
`createReplaySampler`, `replayTiming`, `standingsAt`, `distanceToGoM`, `commentaryAt` and
`PlaybackClock`. Dev-only helpers (`fakeReplay`, `SpriteSheet` for art QA) live in
`@thoroughbred/race-viewer/dev`. The main entry doesn't import three.js: it loads with
`import()` inside an effect, so the component is safe under SSR. Init is StrictMode-safe,
and everything is disposed on unmount.

## Trackside view (default)

`src/trackside/`: the real race drawn like the "track-dusk" diorama (big side-on pixel
gallopers, sunset sky, tilt-shift trees and rails, warm rim light, hoof dust). Same props,
HUD, minimap, clocks, live rules and results flow as the classic view; only rendering differs.

- **Rendering** (`TracksideScene.ts`, three.js, orthographic, screen-space layers): sky wash +
  sky strip (drifting), sun glow and light shafts, far hills / trees / far rail baked once in
  Canvas2D with the diorama's blur and haze (`bake.ts`), a perspective "mode-7" turf
  (world-anchored so hooves don't slide, mowing stripes, the winning line, motion blur at
  speed), furlong poles and the winning post, contact shadows, horses, dust, the "my horse"
  chevron, the out-of-focus near rail, motes, rain, grade, vignette and photo flash.
  Art: the same `race/*` files the diorama uses (read only).
- **Horses** (`strips.ts`, `art.ts`): `race/horse-gallop.png` (and `horse-idle.png` before the
  off / after pulling up) become shared palette-index textures plus one LUT row per runner
  (real coat ramp, silks primary/secondary/cap and the silks pattern), lit from the strip's
  normal map (rim light), with exact 2:1 / 3:1 / 4:1 palette-preserving downsamples (block
  mode) so a sprite never minifies. A "sharp pixel" 2x2 resolve keeps texels crisp at any
  scale (no blur, AA seams only). GLSL in `shaders.ts` avoids reserved words.
- **Every runner is visible on every frame** in whole-field mode (`layout.ts`, unit tested): lanes recede like a
  long lens (far lanes smaller and higher, depth sorted). The camera eases zoom (log-space
  spring, resting on a pixel-perfect `m/s` ladder) and centre (spring with the field's speed
  fed forward) to fit leader to last horse, with the zoom clamped between a close-up cap and a
  minimum readable horse size. `placeField` then hard-clamps the zoom so the lanes fit the
  HUD-safe band and, when the field is still too wide, keeps the leader where the camera put
  it and squeezes the gaps behind it (biggest gaps first, order kept) so stragglers are never
  dropped. Props and the winning line go through the same squeeze, so whoever is on the line
  is drawn on the line. The camera brings the winning post in as the leader closes on it.
- **"Follow mine" camera**: with a highlighted horse, the viewer controls offer
  Whole field | Follow mine (remembered in `localStorage["rv:follow"]`). Follow mode locks
  the marked runner at 40 % from the left at the close-up cap (same ladder, same springs —
  toggling animates, never cuts) and lets the rest of the field leave the frame; the whole-
  field guarantee above is whole-field only. The minimap and standings still show everyone,
  and the post still eases in as the runner closes on it.
- **Looks** (`looks.ts`): dusk by default; a clear race with a daytime post (local hour 7–16)
  gets golden hour; overcast and rain dim/desaturate and drop the sun, shafts and rim light.
- **Dev hook**: with `debug` (the `/dev/viewer` harness) or `?rvdebug` on the page,
  `window.__rvTrackside.rects()` returns the drawn horse quads in stage px (plus `stage()`,
  `camera()`, `time()`, `maxCamStep()`), used by the all-runners-visible frame check (whole-
  field mode; follow mode intentionally crops the field).
- If the keyed strip can't be loaded, the viewer falls back to the classic view.

## Live mode (`feed`)

- The scene is built from `feed.header` plus the frames and events received so far. It
  never reads a result while live. Before the first frame, horses are placed by gate
  order.
- The playhead is `(Date.now() - feed.broadcastStartMs) / 1000` (the feed supplies
  `broadcastStartMs` in the browser's clock), capped at the last received frame. Before 0
  it shows the gate countdown. While the playhead is holding for late data it shows a
  BUFFERING pip after 0.6 s.
- Controls while live:
  - pause, rewind and scrub over the broadcast so far (the bar shows elapsed time only,
    no total);
  - **LIVE** jumps back to the edge;
  - speeds of 1×, 2× and 4× appear only when you are behind the edge (to catch up),
    and nothing can pass it.
- Live standings come from frames only. Finishers are ordered by crossing time from the
  frames, and gaps under 30 ms read "photo".
- When `feed.final` arrives and the playhead is at the end, the scene switches to the
  official replay in place. On a photo finish it replays the finish in slow-mo with the
  PHOTO freeze. Then the results card shows and full replay controls unlock.
- `fakeLiveFeed(replay, startMs)` in `/dev` simulates the server. Use `?live=-30` on the
  harness to open 30 s into a live race.

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
- **Pixel density (HD pixel standard v2)**: 96 px/m in the focal plane (horses, ground
  tiles, signs, gate padding, roundel), 32 px/m mid-plane, 10 px/m for background
  billboards. The HD horse strip (`race/horse-gallop.png`, ~230 px frames) is used at
  96 px/m, with `horse-gallop-lo.png` scaled to life size as a fallback (a palette whose
  keys don't occur in the strip is rejected). Internal resolution is at least 540 lines.
  The DOF only softens the far background and nearest foreground.
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
- **Camera**: broadcast framing. The camera picks the horses that must be on screen,
  then solves its distance at a set elevation and yaw so they fill a target part of the
  frame:
  - **Leader** (default): the leader back to at least the 6th horse, or the whole field
    while it is tight; at most ~30 m of track.
  - **My horse**: my horse plus its three nearest rivals.
  - **Wide**: every horse.

  The final ~150 m is tighter and lower, a photo finish cuts to the judge's camera, and
  the gates get a three-quarter view from behind the stalls. Narrow screens frame less
  track at a higher angle. Visual lanes are 2.2 m wide (cosmetic). Critically damped
  springs with feed-forward velocity. The shots are: a
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
