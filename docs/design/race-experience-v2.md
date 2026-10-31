# Race experience v2 (design, 2026-10-30)

Owner: "I love the design and the map; the experience is underwhelming. Trackside and 3D must
match: someone switching between them must feel it's the same race. After the photo finish,
close-ups of the top 3 portraits like a slide show with name and stable, and the horses ease down
instead of stopping dead." Inputs: `docs/reports/2026-10-30 race experience research.md` (67 sources:
broadcast craft, photo finish, track design, racing games) and `docs/reports/2026-10-30 trackside vs
3D view audit.md` (side-by-side captures of both views at all six courses).

## What's wrong today (audit)

- The 3D view gets only the course's far panorama and grandstand; its trees, field colours, rail
  decor and finish slope are generic. Lighting differs (Trackside uses weather + post hour, 3D
  weather only): a 19:00 race is a sunset in one and midday in the other; the sun is on opposite sides.
- Landmarks differ: furlong poles far rail vs near rail with oversized plates, the stand 20 m vs
  50 m before the line, a near-side post only in 3D, rail crowd only in 3D.
- 3D frames 2-4 horses with a telephoto lens at 7°, the near rail and poles cut across the horses,
  the field is back-lit and dark, the wide shot is mostly empty grass.
- After the line the engine has no movement; the viewer brakes every horse at ~0.67 g to a stop in
  ~44 m; Trackside snaps to a standing pose, 3D freezes mid-gallop; the live clock freezes ~1.4 s at
  the data edge then jumps back.
- Trackside squeezes gaps to keep the field on screen (fix in progress: wider shot + honest gap markers).

## Phase A: one race stage, both views (fixes "doesn't feel like the same race")

1. `packages/race-viewer/src/stage/buildRaceStage(course, race)` → `RaceStage` (pure, tested): lanes,
   elevation profile (Harrowgate uphill, Larkspur downhill), ONE lighting look from weather + post
   hour (sky, sun azimuth/elevation, fog, grade, tint, rain), landmarks in world metres (stalls,
   numbered colour-coded distance poles on the far rail, 200 m / 100 m boards, winning post and judge's
   box, finish line), scenery in world metres (far panorama, midground items placed along the course,
   field and rail colours, rail decor, the course's stand centred ~30 m before the line, crowd spans).
   Both scenes keep only their projection.
2. Shared runner motion `runnerState(sample, t, finish)` → x, lane, speed, gait (gallop / canter /
   trot / walk / stand): after the line, decelerate ~0.8 m/s² to a canter, then a walk, over 150-250 m
   and 15-20 s; both views pick the strip/rig from the gait (uses the new ease-up/celebrate/pull-up art).
3. Live clock keeps running past the data edge with the same pull-up model (no freeze, no jump back).
4. Shared shot intent from the Director (whole field / group around x / the line / pull-up follow)
   that both views honour, so switching keeps the same subject and roughly the same framing. 3D gets
   an establishing whole-field shot at ~10-12° with scenery in frame, front light, the near rail below
   the lens line in close shots, and the post shot tracks the winner.
5. Guard test: for each course, both scenes register the same landmark set, scenery set, look id and sun
   side from the stage.

## Phase B: the finish as an event

1. **Photo finish** when the first two cross within a head (engine 1.4.0 makes these common): the
   broadcast holds on "Photograph", then shows a line-scan strip built from the exact crossing times
   (x = time, as the real camera works; deterministic, no new randomness), the judge's line slides from
   nose to nose, the verdict (nose / short head / head / neck / dead heat) within a few seconds. The strip
   doubles as the shareable result image.
2. **Slow-motion replay** of the last ~100 m from the side camera, then "Weighed in" (the existing seal
   check, shown as the official all-clear).
3. **Top-3 slides**: each placed horse slides in in turn (3rd, 2nd, then the winner): its genetic 3/4
   portrait close up, name, stable name and stable photo, silks, jockey, margin and time; the winner's
   card holds with the jockey's celebration behind it. Your own horse gets its card even if it finished
   outside the top 3 ("Your horse: 6th, beaten 4 lengths").
4. Then the result board and credits (purse count-up), unchanged.

## Phase C: calling the race

1. Numbered, colour-coded distance poles and a large distance-to-go readout; the HUD clears down to
   essentials in the final furlong.
2. Gaps in lengths everywhere, plus a "battle" graphic when two or three horses are within half a
   length in the final 200 m.
3. A structured race call built from engine events and positions (templates, many variants): name
   every runner early, sectional times, moves and challenges, your horse called by name, building to
   the line; no spoilers (only what the broadcast has shown).
4. Director framing rules: in the final furlong everything within 2 lengths of the leader stays in
   frame; never hold a shot that hides your horse in the closing stages.

## Phase D: before the off

Parade in the paddock (existing), going down to post (canter), loading into the stalls one by one
(the gate-break art), the off. Short and skippable.

Built (2026-10-31), `packages/race-viewer/src/stage/preoff.ts`, pure and deterministic from the locked
field (stall numbers), the distance and race time only (never the result or the seed):

| Race time (s) | Step | Both views |
|---|---|---|
| < -18 | Paddock | The host's paddock scene as an overlay (the race page's `PaddockParade`), else a runner list |
| -18 to -10 | Going down to post | The field canters in pairs past the stands (left to right, the race direction; centre passes the stand mid-way), ease-up canter frames; director shot `topost` |
| -10 to -1.2 | Loading | Odd stalls first, then even, each led in from ~6-7.5 m behind the stalls over 1.8 s (trot frames); waiting horses idle; in the bay: break frame 0. Lower third "Loading · n of N in" + the horse being led in |
| -1.2 to 0 | Under starter's orders | All in, gates shut |

The going-to-post and stall shots are a cut in both views at the same moment. On by default for live
feeds (the race page mounts the viewer 32 s before the off; a late arrival joins wherever the broadcast
clock is; it never delays the off), off for replays unless `preOff` is set. One tap skips it and is
remembered per viewer (`rv:preoff` in localStorage, try/catch); reduced motion skips it. Harness:
`/dev/viewer?preoff=1&t=-24` (replay) or `?live=24` (live).

## Order and dependencies

The Trackside gap fix and the race-day animation art land first, then A (one builder), then B and C,
then D. Each phase ships with matching screenshots of both views at all six courses at 390 and
1440 px. Everything stays deterministic and spoiler-free; old replays play unchanged.
