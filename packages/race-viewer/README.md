# @thoroughbred/race-viewer

HD 2.5D playback of a stored `RaceReplay` (React 19 + PixiJS 8). The server simulates
races; this package only plays the replay back. Positions come from replay frames and
the finishing order from `replay.result`.

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
| `highlightHorseId` | none | Gold marker above the horse, highlighted standings and result row. |
| `onFinished` | none | Called once. |
| `className`, `height` | responsive 16:9, min 320 px | `height` sets the stage height in px. The controls overlay the bottom of the stage. |
| `quality` | `"auto"` | `"auto"` picks low on narrow or low-core/low-memory devices. It also drops to low at runtime when frames run over 25 ms. |
| `debug` | `false` | fps, JS ms and draw ms overlay |
| `initialTimeSec`, `initialCamera`, `manifest` | none | Extras for dev and art swap |

The other exports are `CameraMode` (`"leader" | "mine" | "wide"`), `sampleReplay`,
`createReplaySampler`, `replayTiming`, `standingsAt`, `distanceToGoM`, `commentaryAt` and
`PlaybackClock`. Dev-only helpers (`fakeReplay`, `HorseStudio`) live in
`@thoroughbred/race-viewer/dev`. The main entry doesn't import Pixi: it is loaded with
`import()` on the client.

## How it works

- **Sampling** (`sampleReplay.ts`): cubic Hermite between 10 Hz frames, clamped per segment.
  It never extrapolates past the last frame. After the line, finish state and order come
  from `result`.
- **Clock** (`playback.ts`): local or wall-clock playback, speeds 0.5/1/2/4×. On a photo
  finish it plays slow-mo for the last ~14 m, then holds a 1.4 s **PHOTO** freeze. A live
  viewer falls behind by that time instead of skipping it.
- **Scene** (`scene/RaceScene.ts`): parallax sky, clouds, hills (0.1), skyline (0.2) and
  the grandstand with crowd, flags and trees (0.4). Then the perspective track mesh (turf
  stripes or dirt/synthetic texture), inner rail, furlong poles and the winning post and
  line. Horses are depth-sorted by lane together with the stall partitions and the pooled
  hoof dust/turf. On top come the outer rail, the hedge (1.25), rain, the marker and a
  vignette. Far lanes are about 0.82× size and hazier.
- **Camera**: a critically damped spring with feed-forward velocity. It zooms out at the
  gates and in through the final furlong, then holds the line while the rest finish.
  Modes are leader, mine and wide (wide fits the whole field).
- **Horses** (`scene/horse/`): a procedural rig with 2-bone IK legs and a transverse
  gallop. The stride phase is driven by distance travelled (~7 m strides), so hooves don't
  slide. The jockey pumps when driving after a kick or in the final furlong.
  `AtlasHorseRenderer` swaps in an approved `horse.body.gallop` sprite sheet from an
  `AssetManifest`.

## Dev

- Harness: `apps/web/app/dev/viewer`. Query params are `weather`, `surface`, `horses`,
  `seed`, `distance`, `t`, `start` (seconds to post), `paused`, `camera`, `quality`,
  `highlight`, and `studio=1` for the horse rig.
- `pnpm --filter @thoroughbred/race-viewer test` and `pnpm --filter @thoroughbred/race-viewer typecheck`
