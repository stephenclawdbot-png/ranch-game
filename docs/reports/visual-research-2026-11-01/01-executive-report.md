# 01 · Executive report: Post Time visual research (2026-11-01)

**Research only.** No source file was changed, nothing was implemented, no graphics were
rewritten. Everything below is a proposal for the owner's approval. The deliverables are
02-10 in this folder; captures are in `images/`; scripts and measured data in `data/`.

## How this was done

- **The game, rendered:** a local production build of `6d67231` (`next build` + `next start`,
  embedded PGlite, PLAYTEST_MODE, a fresh stable founded through the invite flow, Story races run).
  Captures at 1440×900 and 390×844 (DPR 2) of the race viewer (Trackside and 3D, three courses,
  six moments each, natural-playback strips, finale, build-up), the first-hour flow, Home, Stable,
  horse, breeding, nursery, packs, hall, legacy. Headless Chromium with ANGLE/SwiftShader, so all
  frame-time numbers are **CPU-only** and labelled as such. The live site was not used.
- **The code:** race viewer, stage, director, art pipeline, coat genetics, appearance contract,
  portrait renderer, foal reveal, asset folders and build output; the recent audits were verified
  against the captures rather than repeated (graphics audit 2026-10-31, coat rendering audit and
  first-hour playtest 2026-11-01, Trackside-vs-3D audit and race-experience research 2026-10-30).
- **Competitors:** 15 genre titles and 4 adjacent references, each checked against a store,
  publisher or press page (02). Competitor images are linked, never embedded.
- **Players:** 4,129 English reviews (Steam community hub + App Store RSS) and 101 Japanese
  *Winning Post 10 2025* reviews, read by keyword theme with verified counts for the visual themes
  (03). Reddit (403), Steam's review API (302) and Google Play review text were not accessible.
- **Real racing:** The Jockey Club's 2025 colour guide (primary PDF), a 33,459-start stride study,
  Thoroughbred conformation and white-gene references, and the 2026-10-30 broadcast research
  (67 sources) built upon rather than redone.

## The headline

Post Time's art is **distinctive and already strong**: inter-war British racing in HD pixel art,
painted courses with real character, a 12-frame normal-mapped gallop whose cadence matches
measured racehorse strides within ~6 %, one shared race stage for both views (the 2026-10-30
mismatches are fixed in the captures), and the deepest *rendered* coat genetics among the pixel
games. It needs **no engine change and no art replacement**.

The gaps are where the player meets the horse:
1. **On a phone the race is hard to read.** Horses are ~30-40 CSS px long at whole-field, and the
   course map, call line and chips cover about half the stage. In natural playback of the 3D view
   on a 390 px phone, **the commentary callout covered the leading horses 21 m from the line in 3D
   and 16 m out in Trackside** (`images/play-phone-3d-21m-to-go.png`,
   `images/play-phone-trackside-16m-to-go.png`): the climax of the race was hidden in both views.
2. **Runners are hard to tell apart.** Every saddle cloth is white; the racecard's coloured cloths
   never reach the track; markings vanish at race scale.
3. **Every horse has the same body and (except feathered horses) the same mane and tail.** The
   genome carries leg, neck, girth, height and head genes and 12 breeds, but no race, ranch or
   paddock sprite reads them. In other horse games "they all look the same" is the most specific
   appearance complaint (12 verified reviews in 5 games; 28 verified mane/tail reviews).
4. **The emotional beats are under-staged.** The foal reveal shows the foal but not where its looks
   came from; a first win is a text card with a count-up.

## Top recommendations (P0/P1)

| # | Pri | Recommendation | Effort | Evidence |
|---|---|---|---|---|
| 1 | P0 | Phone race layout: collapse the map, move the call line under the stage, top 3 + mine (V-01, Prototype B) | S-M | Strong (captures + first-hour + 03 F18) |
| 2 | P0 | Runner identity: gate-coloured saddle cloths on the sprites, number at close scale, same colour on HUD chips (V-03, Prototype A) | M | Strong (captures; racecard already does it; viewed competitor screenshots) |
| 3 | P0 | Phones: final-400 m group framing around the leaders and my horse, whole-field elsewhere, toggle kept (V-02) | S | Medium-strong (captures; broadcast research) |
| 4 | P0 | Real-device performance baseline before adding any visual cost (V-00) | S | Required (only CPU-only numbers exist; HANDOFF lists real-GPU check as open) |
| 5 | P1 | Build from existing morph genes in race and ranch sprites (V-04, Prototype C) | M | Strong (schema + captures + 03 F1) |
| 6 | P1 | Mane and tail variety per horse from the existing long-hair code (V-05) | M | Strong (03 F3, coat audit "left open") |
| 7 | P1 | Foal reveal with dam and sire and "family likeness" lines (V-06) | S-M | Medium-strong (code + 03 F5 + Horse Reality practice) |
| 8 | P1 | First-win owner's moment reusing finale slides, portrait and a vignette (V-08) | S-M | Medium (capture + research on "leading in") |
| 9 | P1 | 3D gate and judge-shot framing fixes (V-09, V-10) | S each | Strong (captures) |
| 10 | P1 | Coat class tag ("Thoroughbred colour" / "rare in Thoroughbreds" / breed colour) and family line on the horse page (V-07) | S | Strong (Jockey Club colour guide) |

## Three prototypes proposed (09)

- **A "Know them by their cloth"**: saddle-cloth colours from the racecard on every runner
  (`?cloth=1`).
- **B "Race on a phone"**: 390 px HUD layout plus final-400 m group framing (`?phonehud=2`).
- **C "Not every bay is a twin"**: build and mane/tail variety from existing genes, Trackside
  only, as a spike (`?build=1`).

Each is flag-gated, reversible in one commit, measured with the viewer's own telemetry, and has
a written success test.

## What could not be verified

- Real-GPU and real-phone performance (all numbers are SwiftShader CPU-only).
- Photo Finish LIVE's in-game visuals (no footage viewed; its 51 App Store reviews cluster at
  launch).
- Reddit, Google Play review text, YouTube comments; Horse Reality's own site (403); Winning Post's
  Steam store page (region-blocked; its reviews were read).
- Whether gallop frames 0-1 follow a real footfall sequence (needs a frame-by-frame review against
  a reference).
- Audio (radio commentary) and share-clip encoding were not exercised in headless capture.
- Some competitor platform claims (Rival Stars on PlayStation) rest on trade press only.

## Decisions for the owner

1. **Saddle-cloth colour code.** British racing commonly uses plain numbered cloths (general observation, not sourced); colour-by-gate is the
   common US convention and the racecard already uses it. Adopt it on the track as Post Time's own
   code? (Recommended.)
2. **Optional `build` field on the shared appearance** (lead/owner call, `packages/shared`): needed
   for Prototype C; old replays unaffected.
3. **Phone final-400 m framing** changes the "always whole field" principle on phones only in the
   closing stages (toggle kept). Approve for a test?
4. **Greying by career starts** (game rule) vs by age (reality): keep and explain on the wiki, or
   change? (No change recommended; it is readable.)
5. **Licences:** PixelLab's terms grant ownership and commercial use (ToS updated 2026-10-30);
   copyright protection of AI-generated art and the commentary voice/font licences were not
   assessed here.
