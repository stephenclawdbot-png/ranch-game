# POST TIME: Trackside vs 3D view audit

Branch `claude/intelligent-ride-rkrz3i` @ 66ba616. This was a read-only audit: nothing in the repo was edited. The app was built and run from a copy at `/tmp/audit-repo` (`next build`, then `next start -p 3113` with the embedded PGlite DB). Captures come from `/dev/viewer?course=<id>&paused=1&t=<s>&debug=0&view=<trackside|classic>&hour=14`, which uses the `fakeReplay` defaults: 10 runners, seed 7, 1200 m, clear weather, turf, and a photo finish.

Moments captured: start t=0.5, mid t=37.06, final 200 m t=62.22, finish t=74.11 (the winner's time), and finish+5 s t=79.11. Every moment is the same race state in both views, because both scenes sample the same replay with the same sampler.

Paths are relative to `packages/race-viewer/src/` unless stated otherwise.

Out of scope: Trackside's gap compression (`trackside/layout.ts:270-303` `placeField`, horses drawn closer than their true spacing) is being fixed by another builder. It can be seen at "finish" in every sheet and was not looked at again here.

## Contact sheets

All sheets are in `/tmp/claude-0/-home-user-ranch-game/0b8609fd-c589-5d91-8b9c-ad4f22ab63cb/scratchpad/audit/`. Trackside is on the left, 3D on the right.

| Sheet | Contents |
|---|---|
| `sheet_ashcombe_1440.png` | Ashcombe, all 5 moments, 1440 px |
| `sheet_kestrel_downs_1440.png` | Kestrel Downs, all 5 moments |
| `sheet_saltmarsh_1440.png` | Saltmarsh, all 5 moments |
| `sheet_bellmont_1440.png` | Bellmont, all 5 moments |
| `sheet_larkspur_1440.png` | Larkspur, all 5 moments |
| `sheet_harrowgate_1440.png` | Harrowgate, all 5 moments |
| `sheet_ashcombe_390.png`, `sheet_harrowgate_390.png`, `sheet_saltmarsh_390.png` | Phone width (390x844): mid, f200, finish, post5 |
| `sheet_ashcombe_1440_dusk19.png`, `sheet_bellmont_1440_dusk19.png` | 19:00 post. Trackside is a purple sunset; 3D is bright midday |
| `sheet_larkspur_1440_rain.png` | Rain. Trackside is dim and grey; 3D is still sunny green |
| `sheet_kestrel_downs_classic_wide.png` | 3D "Wide" camera: dark empty grass, tiny horses |

The individual frames are in the same folder, named `<course>_<view>_<moment>_<width>[_tag].png`.

## 1. How each view decides each thing

| Item | Trackside (`trackside/TracksideScene.ts`) | 3D "classic" (`three/HD2DScene.ts`) |
|---|---|---|
| **Course scenery** | Full recipe from `sceneryFor(course.scenery)` (`trackside/scenery.ts:74-194`), all of it used (`TracksideScene.ts:405-446`): far panorama, course-specific midground band (thorn and gorse, dunes and huts, terraces and lamps, willows and flowers, rowan and heather), field-strip colours, rail fill, rail decor (gorse, advertising boards, flowers, dry-stone wall), and a course grandstand. | Only `courseFar` and `courseStand` are passed in (`RaceViewer.tsx:391-400`). The midground is always the same instanced oaks, poplars and bushes (`HD2DScene.ts:512-545`). The field colour, rail fill and rail decor from the recipe are ignored. The ground is one Lambert grass plane (`:366-377`). |
| **Sky / lighting / weather** | `lookFor(weather, postHour)` (`trackside/looks.ts:256-261`): dusk, golden, overcast or rain. A clear race after 17:00 is drawn as dusk. Sun glow sits at 70-74 % of screen x, on the **right** (`looks.ts:190,211`). Rim light comes from the right (`looks.ts:195`). Every layer gets a grade, haze, motes and rays. | `LOOKS[weather]` only (`HD2DScene.ts:226`, `three/pixelTextures.ts:40-139`), so the **post hour is ignored**. The sun direction is `[-0.55, 0.42, -0.72]`, meaning **left** and beyond the stands, which backlights the horses (`pixelTextures.ts:45`). A sky sphere, clouds and fog are built, but the sky is rarely in frame. Post FX (DOF, bloom, grade) run on high quality only. |
| **Track surface** | `track-turf` / `track-dirt` art through a perspective ground shader, with faint stripes, motion blur and a finish line (`:458-497`, `:918-932`). Synthetic gets a purple tint. | `tex-turf` / `tex-dirt` tiles with hard 6 m light/dark mowing bands across the track (`:378-385`), a white finish line on the ground (`:386-391`) and a hedge on the camera side (`:392-401`). |
| **Rails** | A painted far-rail band, plus an out-of-focus near rail drawn **below the horses' feet** so it never crosses a horse (`:434-445`, `:871-887`). Both tilt with the finish gradient. | White 3D box rails on both sides, posts every 2.5 m (`:548-575`). The near (inner) rail is at z=0, between the camera and the field, so at the 7-12° camera elevation the **1.06 m bar cuts across the horses' bodies** in every close and pack shot (see "mid" in every sheet). |
| **Furlong poles / markers** | `furlong-pole` art on the **far** rail. No labels. Skipped within 20 m of the start (`:499-515`, `:934-951`). | Red-and-white poles on the **near** rail with large "1f/2f…" plates at focal pixel density (`:589-607`). In "f200" the 1f plate fills a sixth of the frame and the pole stands in front of the leader. |
| **Winning post** | One `finish-post` sprite (roundel) on the far rail at x=L (`:503-506`). | A tall far-side post plus a floating roundel and a short striped post on the **near** side (`:608-619`). The near post sits right in front of the winner at the line ("finish" in every sheet). |
| **Grandstand / crowd** | Course stand centred 20 m **before** the post (`STAND_PAST_POST_M=-20`), with 0.16 parallax so it lingers over the last ~100 m (`:56-58`, `:899-908`). No rail crowd, no flags. | Stand centred 50 m before the post, 30 m beyond the outer rail, at least 200 m wide (`:468-480`). Bunting on the roof (`:481-498`), a 230 m strip of rail spectators from L-200 to L+30 (`:500-510`), and nothing else along the course. |
| **Camera** | Orthographic long-lens shot with lane perspective (`trackside/layout.ts`). Whole field always in frame: zoom fits the field box, rests on a pixel-perfect ladder, centre spring with feed-forward (`layout.ts:402-450`, `:486-547`). Eases the post in when the leader is within 30 % of the frame (`:438-443`). "Follow mine" locks my horse at 40 % of the width. Never cuts. | Perspective with the TV `Director` (`director.ts:88-139`). Shots: gate (fov 32, elev 16→10°), close (2-4 horses, fov 22, elev 7°), pack (7 horses, fov 26, 12°), wide (whole field, fov 30, 20°), judge (photo), and post (`HD2DScene.ts:1211-1353`). Spring-eased with no cuts. A PiP of my horse appears on desktop/high (`:974-994`). Manual modes: My horse / Leader / Wide. |
| **Horse x / lanes** | Same sampler `x`, mapped linearly and then squeezed by `placeField` (the compression issue). Lanes recede with `LANE_K=0.03` per lane and rise on screen. The ground uses `LANE_W=1.25` m (`layout.ts:30-32`). | True `x` metres. Lanes are `z = -(1.2 + lane*2.2)` m (`:81-83`, `:622-624`). Lanes are cosmetic and wider than real, so a 10-horse field is 22 m deep. |
| **Horse size** | Readable sprite between `minLen = clamp(0.14W, 84, 180)` and `maxLen = min(520, 0.34W)` CSS px (`layout.ts:388-393`). At 1248 px the whole field is shown at about 120-170 px per horse. | Life-size 2.4 m billboard (`:92`, `:694`), yawed up to ±35° and tilted back up to 31° toward the camera (`:1033-1040`). On screen it is about 250 px in a close shot and about 25 px in Wide. |
| **Gallop animation** | Phase += dx / `strideLengthM(max(v,6))` (`:975-979`), so cadence tracks ground speed. Switches to the idle strip when a finished horse drops below 1.4 m/s or before the off (`:981-990`). | The same phase formula (`:1020-1024`). There is **no idle or canter state**: the gallop rig keeps running at whatever cadence the falling speed gives. |
| **At / after the line** | Pull-up: `x = L + v_f*2.6*(1-e^{-t/2.6})`, speed `v_f*e^{-t/2.6}` (`:716-723`, `PULLUP_TAU=2.6` at `:62`). The camera keeps framing the whole field. No confetti. | **The same formula** (`:884-891`, `PULLUP_TAU` at `:93`). The director moves to a "post" shot 0.9 s after the winner (vel 0, elev 12°, fov 28, frames runners within 40 m of the post) (`director.ts:106`, `HD2DScene.ts:1303-1311`). 260 confetti particles at the line (`:1062-1075`). |
| **Photo finish** | Uses only the shared clock: slow-mo at 0.3x from 14 m out until winner+0.25 s, a 1.4 s freeze and a white flash (`playback.ts:17-26,152-161`), plus the HUD PhotoStamp. No special camera. | The same clock, plus the director's "judge" shot from winner-1.6 s to winner+0.9 s: square-on to the line, fov 28 (`director.ts:105`, `HD2DScene.ts:1290-1302`). Flash goes through post FX. |
| **HUD** | Shared `RaceViewer.tsx:636-706`: top bar, standings, commentary, progress strip, course map with the UPHILL/DOWNHILL chip, countdown, PhotoStamp, results card. Controls: "Whole field / Follow mine" and a "3D view" toggle. | The same shared HUD, plus the PiP frame "My horse" (`RaceViewer.tsx:667-671`). Controls: "Director / My horse / Leader / Wide" and a "Trackside" toggle. |
| **Finish gradient** | The track layer tilts by `finishTilt()` on the home straight: Harrowgate +35‰ climbs, Larkspur -5‰ (`:795-818`, `scenery.ts:216-221`). | Flat. The gradient is ignored. |

## 2. Mismatch table ("does it feel like the same race?")

Severity: **H** breaks the illusion on a view switch, **M** noticeable, **L** subtle.

| # | What | Where (code) | Sev |
|---|---|---|---|
| 1 | Time of day: Trackside uses weather + post hour (a 19:00 clear race is dusk purple and orange); 3D uses weather only (bright midday). See `sheet_*_dusk19.png`. | `trackside/looks.ts:256-261` vs `three/HD2DScene.ts:226`, `three/pixelTextures.ts:40-139` | H |
| 2 | Midground is course-specific in Trackside (dunes and huts, terraces and lamps, gorse, willows, rowans and heather) but generic oaks, poplars and bushes in 3D for all 6 courses. Saltmarsh and Bellmont look like Ashcombe in 3D. | `scenery.ts:84-193`, `TracksideScene.ts:426-427` vs `HD2DScene.ts:512-545` and `RaceViewer.tsx:398-400` (only far + stand passed) | H |
| 3 | Rain and overcast: Trackside is desaturated (sat 0.62, bright 0.8) with a grey sky; 3D is still lush green (`sheet_larkspur_1440_rain.png`). | `looks.ts:221-250` vs `pixelTextures.ts:91-139` + `post.ts` grade | H |
| 4 | Sun and key light on opposite sides: Trackside sun and rim are on the right; 3D sun is on the left and behind the stands, so the 3D horses are backlit and dark. | `looks.ts:190,195,211,216` vs `pixelTextures.ts:45,70` | M |
| 5 | Field strip, rail fill and rail decor (Bellmont's red boards, Harrowgate's walls, Larkspur's flowers, Kestrel's gorse) are absent in 3D. | `scenery.ts` `field/railFill/railDecor`, `bake.bakeRailFar` vs `HD2DScene.ts:366-377,548-575` | M |
| 6 | Finish gradient: Harrowgate's uphill run-in tilts in Trackside but is flat in 3D, although the HUD says "UPHILL" in both. | `TracksideScene.ts:795-818` vs absent in HD2DScene | M |
| 7 | Furlong poles: far rail with no labels in Trackside; near rail with huge "Nf" plates in 3D. The first pole differs too (Trackside omits any within 20 m of the start). | `TracksideScene.ts:507-513` vs `HD2DScene.ts:596-607` | M |
| 8 | Winning post: one far-side post in Trackside; a far post, floating roundel and near post in 3D. The near post occludes the finish. | `TracksideScene.ts:503-506` vs `HD2DScene.ts:608-619` | M |
| 9 | Stand placement: centred at L-20 m (0.16 parallax) in Trackside vs L-50 m and 200 m+ wide in 3D. Rail crowd and bunting exist only in 3D. | `TracksideScene.ts:56-58,899-908` vs `HD2DScene.ts:468-510` | M |
| 10 | Framing philosophy: Trackside always shows all 10 runners; 3D usually shows 2-4. "Mid" in Trackside shows the field strung out; 3D shows three horses behind a rail. | `layout.ts:402-450` vs `director.ts:88-139` | H (for "same race") |
| 11 | Horse scale and lane depth: Trackside lanes are about 1.25 m with mild perspective; 3D lanes are 2.2 m, so the 3D field is 22 m deep and looks sparse in Wide. | `layout.ts:30-32` vs `HD2DScene.ts:81-83` | L |
| 12 | Near rail crosses horses in 3D; Trackside's near rail sits below the feet. | `HD2DScene.ts:561-571` vs `TracksideScene.ts:877-887` | M |
| 13 | Surface look: subtle stripes and motion blur in Trackside vs hard 6 m light/dark bands across the track in 3D. | `TracksideScene.ts:489` vs `HD2DScene.ts:385` | L |
| 14 | Photo finish: 3D cuts to a square-on "judge" framing and fires confetti; Trackside does neither. | `director.ts:105`, `HD2DScene.ts:1062-1075` | L |
| 15 | Start: Trackside shows its stalls large in the foreground; 3D shows them small from 16° up, in front of bushes. | `trackside/gate.ts` vs `HD2DScene.ts:626-684,1245-1258` | L |
| 16 | Running direction is left to right in both views for every course, while the course map mirrors right-handed courses (Ashcombe, Larkspur, Harrowgate). Both views agree with each other but not with the map. | `course/geometry.ts:14-15` vs both scenes | L |
| 17 | HUD differs only in camera controls and the 3D-only PiP. Otherwise identical (good). | `hud/Hud.tsx:325-350`, `RaceViewer.tsx:667` | L |
| — | Out of scope, noted only: Trackside gap compression. | `layout.ts:270-303` | (other builder) |

## 3. Why the 3D view is underwhelming (concrete)

1. **Camera.**
   - The default "close" shot is a 22° telephoto at 7° elevation that frames 2-4 horses (`HD2DScene.ts:1259-1268`). The race as a race (who leads, by how much) is invisible most of the time.
   - The rotation (close, pack, close) never shows the whole field unless the user picks Wide.
   - Wide (`:1279-1289`, 20° down) is mostly dark empty grass with tiny 25 px horses (`sheet_kestrel_downs_classic_wide.png`).
   - Every framing uses the same side-on angle (yaw -6° to 0°). There are no head-on, high-reverse or tracking-dolly variations, so there is no sense of a "broadcast".
2. **Occlusion.**
   - The white near rail cuts through the horses' legs and bodies in every close shot.
   - In the final furlong a near-rail furlong pole and its oversized "1f" plate block the leader.
   - At the line, the near winning post stands in front of the winner.
3. **Scale and pixel consistency.**
   - Horses use a 96 px/m texel density, trees and the stand 10 px/m, hills a coarse code strip (`:88-90`). Big blocky trees sit behind fine-pixel horses.
   - Billboards tilted up to 31° toward the camera (`:1037`) look like cards when the camera is high.
4. **Lighting.**
   - Backlit sun from the left and behind the stands (`pixelTextures.ts:45`), so the visible flank of every horse is in shade and the picture reads muddy and dark.
   - The hour is ignored.
   - Shadows and post FX only run at "high" quality (`:239,287`). Phones (`autoQuality` returns "low" under 560 px) get flat unlit-looking frames.
   - The sky is rarely in frame: the sky sphere and clouds are built but the low telephoto camera mostly sees the grass plane and trees.
5. **Scenery density.**
   - One flat grass plane, 55 oaks, 55 poplars and 90 bushes scattered over L+640 m and 30-150 m of depth (`:512-545`).
   - Nothing course-specific apart from the far panorama, which sits 1000 m away and is mostly hidden behind trees (`:457-466`).
   - No fences, boards, buildings, car parks, tents, TV towers or inner-field features.
   - The first 1000 m of a 1200 m race have no crowd at all.
6. **Crowd.** One 2-frame grandstand texture and a 2-frame rail-crowd strip limited to the last 230 m (`:500-510`). There is no cheering build-up, apart from the strip's flip rate rising from 1.5 to 6 Hz 8 s before the finish (`:1008-1011`).
7. **Markers.**
   - Furlong plates only, on the near side and oversized. No "200 m / 100 m" boards, no distance-to-go overlay in-world, no judge's box.
   - The finish line is a 0.2 m white strip that is hard to see at telephoto.
8. **Motion read.**
   - Ground speed is hard to sense: the long lens plus a spring camera with feed-forward keeps the subject fixed, and the turf tile is fine.
   - There is no foreground motion parallax (the hedge is at z=+3.4 but sits out of frame at 7° elevation) and no speed blur, unlike Trackside's ground blur and near-rail streak.
9. **Post-finish.**
   - The "post" shot has velocity 0 (`:1303-1311`): a parked camera watching horses that stop within about 40 m (see section 4).
   - No winner close-up, no "pulled up and walking back", no jockey celebration.
   - The rig has no slow gait, so horses end frozen mid-gallop when the clock stops.

## 4. Current post-finish behaviour (both views)

What the data and the clock do:
- The engine clamps each recorded distance at the line (`packages/racing-engine/src/simulate.ts:217`, `f.push(d > L ? L : d …)`), although internally it keeps simulating "pulling up past the post" (`simulate.ts:249-251`).
- Frames stop once the last horse finishes (`simulate.ts:226`).
- So the replay holds no motion past the post. The viewer must invent it.
- `PlaybackClock` runs for `RUNOUT_SEC = 6` s after the **last** finisher, then stops (`playback.ts:18,124-141`).

Pull-up model (identical in both views; `TracksideScene.ts:716-723`, `HD2DScene.ts:884-891`):
- `x = L + v_f*τ*(1-e^{-t/τ})`, with τ = 2.6 s and `v_f = max(8, speed 50 ms before the line)`.
- For v_f ≈ 17 m/s:

| Time after finishing | Distance past post | Speed |
|---|---|---|
| +1 s | 8 m | 11.6 m/s |
| +2 s | 14 m | 7.9 m/s |
| +3 s | 19 m | 5.4 m/s |
| +5 s | 38 m | 2.5 m/s |
| Never more than | 44 m | |

- The initial deceleration is 6.5 m/s² (about 0.67 g). Real horses decelerate at roughly 0.5-1 m/s² and canter on for 200-400 m.
- **This is the main "stop dead"**: the field brakes like a car.
- The winner gets about 8.9 s of run-out (to 83 s in this replay). The last finisher gets only 6 s.

Gait after the line:
- **Trackside** swaps to the standing idle strip once speed is under 1.4 m/s (`TracksideScene.ts:981`), so a horse goes from gallop straight to standing (about 6 s after the line), with no canter or trot in between.
- **3D** keeps the gallop rig. Stride length is floored at 4.1 m, so the legs slow to a slow-motion gallop and freeze mid-stride when the clock stops.

Live broadcast (measured):
- `LiveClock` can't pass the data edge (`playback.ts:264-269`). When the last runner crosses, the edge stops.
- The server publishes `final` only 750 ms after the broadcast end (`apps/web/src/server/live.ts:35,54-56`), and the client polls every 1.2 s (`apps/web/src/lib/liveRaceFeed.ts:114`).
- Measured on `/dev/viewer?live=-70`: race time sat at **77.00 for about 1.4 s with the whole field frozen**.
- It then jumped back to 72.27 for the PHOTO REPLAY (`RaceViewer.tsx:450-460`), slow-mo, a 1.7 s freeze at 74.11, ran to 83.00, and stopped.
- In other words, a live viewer sees the field freeze at the moment the last horse crosses, before any replay.

Camera after the line:
- **3D** uses the director's "post" shot (static, elev 12°, frames runners within 40 m of the post, `maxSpan` 30 m). Manual modes switch to "post" as well, except "My horse".
- **Trackside** keeps the whole-field framing. As the field bunches while braking, it zooms in, which emphasises the stop.

Results card:
- In dev, the results card appears as soon as `time ≥ duration` (the last finisher, `RaceViewer.tsx:614`) and covers the run-out.
- Production passes `resultsCard={false}` (`apps/web/src/components/RaceViewerClient.tsx:11`).

## 5. Recommended single source of truth

Add one pure, unit-tested module, for example `packages/race-viewer/src/stage/` with `buildRaceStage(course, race, laneCount) → RaceStage`. Both scenes render from it and keep only their projection (ortho layers vs perspective world).

```ts
interface RaceStage {
  L: number;                                // metres
  lanes: { count: number; widthM: number; railGapM: number };  // one lateral scale for both views
  elevation(x: number): number;             // finish gradient profile (Harrowgate +35‰ …); Trackside tilts, 3D displaces the ground mesh
  lighting: StageLook;                      // ONE look from lookFor(weather, postHour): sky art + gradient, sun azimuth/elevation
                                            // (→ Trackside sun x/rim dir AND 3D sunDir), fog/haze colour, grade, sprite tint, rain, motes
  landmarks: {
    start: { x: 0; stalls: true };
    furlongPoles: { x: number; label: string; side: "far" }[];  // one rule (e.g. every furlong > 20 m from start), one side
    distanceBoards?: { x: number; label: "200m" | "100m" }[];
    winningPost: { x: number; side: "far"; roundel: true };
    judgeBox?: { x: number };
    finishLine: { x: number };
  };
  scenery: {                                // from scenery.ts, but in WORLD metres instead of art px
    far: ArtId | null;                      // panorama
    mid: { art: ArtId; xM: number; depthM: number; heightM: number; flip?: boolean }[];  // placed along the course
    field: [string, string]; railFill: [string, string];
    railDecor: { art: ArtId; everyM: number } | null;
    stand: { art: ArtId; centreX: number; widthM: number; depthM: number };   // e.g. centred L-30
    crowd: { fromX: number; toX: number }[]; // rail spectators, shared
  };
}
```

How each view consumes it:
- **Trackside** maps `depthM` to parallax (`depth = f(depthM)`) and `xM` to band offsets.
- **3D** places the same items as billboards at `z = -trackW - depthM` and `x = xM`.
- Both read `lighting`.
- `scenery.ts` stays the authoring source, but its art-px layout becomes metres in one place.

Shared motion: add `runnerState(sample, t, finishInfo) → { x, lane, speed, gait: "gallop"|"canter"|"trot"|"walk"|"stand", phase }` used by both scenes.
- Pull-up: constant deceleration of about 0.8 m/s² down to a canter (about 7 m/s), then easing to a walk. This runs for 15-20 s and 150-250 m.
- Raise `RUNOUT_SEC` to match.
- Gait thresholds pick the strip or rig. 3D needs at least canter and idle states.
- Optionally the engine could store unclamped post-line distances for a few seconds. That should be checked against the result hash and determinism rules before changing it; the viewer-side model is enough.

Live hand-off: past the data edge, `LiveClock` should keep advancing using `runnerState` extrapolation (all finished horses are pulling up), instead of holding at `dataEdge`. Alternatively the server could publish `final` at the last crossing with no 750 ms margin, or the client could poll immediately when the last horse crosses.

Shared shot intent: let the `Director` produce an intent (`whole field | group around X | line | pull-up follow`) that both views honour.
- Trackside: whole field, plus follow on a "group" intent.
- 3D: maps the intent to its lens.
- A view switch then keeps the same subject and roughly the same framing. Trackside's whole-field box could also be the 3D Wide target, at about 10-12° elevation and with scenery in frame.

Guard test: for each of the 6 courses, assert that both scenes register the same landmark set, scenery art set, look id and sun side from `RaceStage`. This is a pure test on the stage plus small scene "inventory" getters.

Quick wins for 3D, independent of the refactor:
- Pass the full recipe and `lookFor(weather, hour)` into HD2DScene.
- Move the furlong poles and the near winning post to the far rail.
- Drop the near rail bar below the lens line, or fade it in close shots.
- Mirror the sun to the right and front-light the horses.
- Add course midground items and rail decor as billboards.
- Add a whole-field "establishing" shot to the director rotation.
- Make the post shot track the winner (vel > 0).
