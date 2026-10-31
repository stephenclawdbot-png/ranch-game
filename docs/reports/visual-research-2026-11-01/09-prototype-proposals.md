# 09 · Three small, reversible prototype proposals

For approval before any code is written. Each prototype:
- sits behind a URL flag and a dev-harness param (default **off**), so production is unchanged
  until the owner says so;
- touches no engine file, no genome, no shared contract (except where noted as optional), no
  economy or chain code;
- has a measurable success test and a one-commit rollback (delete the flag branch);
- is timed against the viewer's own frame telemetry (`__rvFrameStats`, `perfReport`) on desktop
  and on at least one real phone before it can leave the flag.

---

## Prototype A · "Know them by their cloth" (runner identification)

**Problem (seen).** At whole-field zoom a runner is ~45-70 px long on desktop and ~30-40 CSS px on
a 390 px phone (`images/race-trackside-phone-mid-ashcombe.png`, `images/race-trackside-desktop-mid-ashcombe.png`).
The racecard and paddock already give every runner a coloured, numbered saddlecloth
(`apps/web/src/components/race/Saddlecloth.tsx`), but on the track every cloth is plain white, so
the only link between the HUD and a horse is its coat colour and the "my horse" chevron. Two bays
look identical. Both competitors whose race screenshots I viewed use numbered cloths (Rival Stars,
Sheep Meadow's Horse Racing Manager; both viewed), and real racing identifies runners by cloth
and cap.

**What.**
1. A `cloth` key for the saddle-cloth pixels in every race strip (`art/race/horse-*.png`, `-f`
   copies), found automatically from the existing coat geometry (white pixels in body space under
   the saddle; the rider's breeches stay `fixed.white`). Same approach as
   `art-src/coat-layers/fix-tail-keys.ts`; output is new keyed copies, originals kept.
2. Trackside shader and 3D CPU painter recolour `cloth` with the runner's gate colour (the same
   table as `Saddlecloth.tsx`, moved to `packages/shared` or duplicated with a parity test).
3. When a horse is drawn ≥ ~120 CSS px (close, finale, paddock), stamp the gate number in a 5×7
   pixel font on the cloth.
4. The HUD standings chips gain the same cloth colour square next to the silks.

**Flag.** `?cloth=1` (viewer prop `clothColours`).

**Success test.**
- Automated: every painted cloth pixel lies inside the horse's body space in every frame (reuse
  the coat audit's per-frame tests); chip colour = cloth colour for every runner.
- Human: 5 people shown 10 random mid-race frames (phone size) identify a named runner within 3 s
  in ≥ 80 % of trials with the flag vs a baseline without it.
- Perf: no new texture, no new draw call (LUT row only); frame median unchanged ±5 %.

**Risk.** British and Irish number cloths are commonly plain with sponsor branding (a general observation, not sourced here); colour coding by
gate is the common US Thoroughbred convention, and jurisdictions differ (Indiana and Pennsylvania
rules, per search summaries, use another order; Ohio requires caps to match the cloth) — sources in the appendix.
Owner decides whether Post Time adopts its own colour code (recommended, it already does on the
racecard). **Effort:** M (keying script + tests 2-3 days, shader/painter 1 day). **Rollback:**
flag off; keyed copies unused.

---

## Prototype B · "Race on a phone" (390 px layout and final-furlong framing)

**Problem (seen).** On a 390×844 phone the race stage is ~312-395 CSS px tall. The course map,
the standings chips, the commentary callout, the battle chip and the controls cover roughly half
of it, and mid-race the commentary callout sits directly on the horses' band
(`images/race-trackside-phone-mid-ashcombe.png`, `images/race-3d-phone-f200-ashcombe.png`). In natural 3D playback the
callout covered the leaders 21 m from the line, and in Trackside 16 m out (`images/play-phone-3d-21m-to-go.png`,
`images/play-phone-trackside-16m-to-go.png`). Whole-field framing
keeps every runner visible (a design principle the owner approved) but at ~30 CSS px a horse. The
first-hour playtest timed the phone race at 96-131 s, the longest part of the first session.

**What.**
1. ≤ 480 px wide: the course map collapses to a 32 px button (tap to peek); the commentary line
   moves **below** the stage (outside the canvas) as a one-line ticker; standings chips show top 3
   + mine.
2. Final 400 m on phones only: Trackside eases from "whole field" to the existing "group around a
   subject" intent (leaders + my horse if within 6 lengths), at the zoom ladder's next step, then
   back to whole field for the run-out. Uses the shared director intent; no new camera code paths.
   Never cuts; spring-eased as today.
3. Keep the "Whole field" toggle: a player who picks it keeps it (localStorage, as today).

**Flag.** `?phonehud=2`.

**Success test.**
- Screenshot test at 390×844 every 2 s of a replay: HUD overlays cover < 25 % of stage area and
  never the horses' band (bounding-box check against `__rvTrackside.rects()`).
- Median horse length in the last 400 m ≥ 60 CSS px (from `rects()`), and every horse within 2
  lengths of the leader stays in frame (existing director rule).
- Perf: unchanged (camera only).

**Risk.** Players who like the full field lose it in the final 400 m: keep the toggle and test
with 3-5 phone players. **Effort:** S-M (HUD layout 1-2 days, framing rule 1 day, tests 1 day).
**Rollback:** flag off.

---

## Prototype C · "Not every bay is a twin" (build and mane/tail from existing genes, Trackside only)

**Problem (seen + players).** Every runner, of every breed, has the same body and (except
feathered horses) the same mane and tail (`images/race-*`, coat audit §5). Across other horse
games "they all look the same" is the most specific appearance complaint (03 F1, 12 verified
reviews in 5 games; F3, 28 verified mane/tail reviews). Post Time's genome already carries
`legLength, neckLength, girth, height, headSize` alleles and 12 breeds, but no renderer reads them
(06 §1).

**What (spike, Trackside only).**
1. A pure game-core function `buildOf(genome, breed) → {leg, neck, girth, height}` in −2..+2
   (reads genes, writes nothing), passed as an **optional** `build` on the appearance object (old
   replays: absent → today's look). Needs the lead's OK for the optional shared field.
2. Trackside fragment shader: integer-texel offsets using the coat geometry's body/leg/neck spaces
   (legs ±1-2 rows below the knee/hock, barrel ±1 row, neck ±1-2 columns). No new art, no
   filtering, no non-integer scale.
3. `longHair.ts` generalised to three mane lengths and two tail fullnesses chosen from `markSeed`
   + breed (short fine for Akhal-Teke, high-carried for Arabian, long for Friesian).
4. A contact sheet at `/dev/coats?build=1` of 24 horses × 12 gallop frames for review.

**Flag.** `?build=1`.

**Success test.**
- Every stretched pixel stays inside the horse and hooves still touch the ground line in every
  frame (extend the coat geometry tests); no gaps at the knee/hock seams at 1×, 2×, 3×.
- Blind pairing test: 5 people match 6 horses' race sprites to their portraits ≥ 70 % (baseline:
  coat only).
- Perf: no new textures; shader cost measured on desktop and a phone, ≤ +0.3 ms GPU per frame.

**Risk.** Stretching a pixel-art strip can break silhouettes (knees, fetlocks); if the spike
fails the seam test, fall back to mane/tail only (still the more-requested item). 3D view and the
Ranch follow only after the spike passes. **Effort:** M (5-7 days for the spike). **Rollback:**
flag off; `build` is optional and ignored.

---

### Not chosen as prototypes (low technical risk; go straight to the backlog if approved)
Family-likeness foal reveal (10: V-05), coat classification tag (V-07), first-win owner's moment
(V-08), 3D gate and judge framing fixes (V-09, V-10).
