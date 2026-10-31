# 05 · Visual gap report (rendered Post Time vs the best examples)

How to read this: scores are **my judgement** on a 1-10 scale, made from the captures in
`images/` (local production build, swiftshader WebGL, 1440×900 and 390×844) against the
competitor evidence in 02/03. They are not survey data. **Styles are separated**: Post Time is
judged against the best *in its own lane* (HD pixel art, side-on, watched races, management
first) and, separately, against what 3D games deliver to the same *player need*. Copying any
competitor's look is out of scope; the benchmark column names the need and who meets it.

Capture caveats: headless swiftshader renders at 7-20 fps, so spring cameras and live timing are
not representative of a real GPU; still frames from seeks show the director's framing *after* a
seek. Natural-playback frames (`images/play-*.png`, `.gif`) were taken without seeks.

## Side-by-side (links, not embeds)

| Need | Post Time (capture) | Benchmark (owner's page, linked) |
|---|---|---|
| Pixel-art racing field | `images/race-trackside-desktop-finish-saltmarsh.png` | Horse Racing Manager (Sheep Meadow Road) store screenshots: [Steam](https://store.steampowered.com/app/2740170/) |
| Race readability, identifying runners | `images/race-trackside-phone-mid-ashcombe.png` | Rival Stars "Final stretch" with numbered cloths: [Steam](https://store.steampowered.com/app/1166860/) |
| Watched-race broadcast | `images/play-desktop-3d.gif` | F1 Manager 2024 Helicam: [Frontier](https://frontier.co.uk/node/1330) |
| Horse individuality | `images/phone-stable.png`, `images/phone-starters.png` | RDR2 coat/mane styling: [GamesRadar](https://gamesradar.com/red-dead-redemption-2-has-more-than-200-animals-in-it-and-you-can-style-your-horses-mane) |

## Scorecard

| # | Category | Now | Evidence (Post Time) | Benchmark & evidence | Gap | Proposed improvement → backlog | Effort (why) | Player value | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Horse fidelity | **7** | 12-frame HD gallop with normal maps; drive/break/ease-up/pull-up/celebrate strips; 3/4 portrait with breed heads (`images/gallop-sheet.png`, race captures) | In the pixel lane, the only direct competitor is criticised for "awkwardly limping" runs (03 F7); in 3D, Rival Stars claims mocap | Small in lane; large vs 3D (not a goal) | Keep; footfall review of frames 0-1 before any regeneration | — | High (protect) | High |
| 2 | Visual diversity | **6** | Coat system draws every gene in every view (pintos, greys, roans seen). **One body and one mane/tail for every runner and breed** (schema + captures); two bays read as twins on the starters screen and pasture | Players' most specific appearance complaint elsewhere (03 F1, 12 verified; F3, 28 verified) | Body/hair sameness | Build from existing morph genes + mane/tail variety → V-04, V-05 (Prototype C) | M (shader/geometry work, tests per frame) | High | High |
| 3 | Animation | **7** | Cadence tracks speed (stride 7.5 m at 16.6 m/s vs 7.08 m measured); run-out with ease-up, pull-up and celebrating jockey (`images/race-trackside-desktop-post12-harrowgate.png`); stall break | Unbridled/RSHR praised for gait realism; riders check gaits (03 F7) | No canter strip (gallop slowed), one mane swing | Mane/tail per horse (V-05); winner's walk back (V-14) | M | Medium | Medium |
| 4 | Atmosphere | **8** | Six painted courses (dunes and beach huts, terraces, gorse, heather), golden/dusk/overcast/rain looks shared by both views, crowd strips, judge's box, roundel (`images/race-3d-desktop-*`, `images/play-desktop-3d-01.png`) | Painterly pixel backdrops are also Sheep Meadow's strength; Post Time's are richer (seen) | Small | Seasonal light (V-18) | — | Medium | High |
| 5 | Cinematic racing | **7** | Build-up (paddock, to post, loading, off), run-out, slow-motion "THE FINISH AGAIN" replay (`images/play-desktop-3d-07.png`), line-scan photo, finale slides, results card | Umamusume's phase structure and cut-ins; NBC "few cuts" | 3D gate shot weak (`images/race-3d-desktop-start-ashcombe.png`: field is a sliver behind a big green stall block); 3D judge shot stacks the two leaders (`images/race-3d-desktop-finish-saltmarsh.png`, `images/race-3d-phone-finish-saltmarsh.png`) | V-09, V-10 | S each | Medium | High |
| 6 | Camera direction | **6** | Never cuts; whole field keeps everyone visible; group/close shots in 3D. In the final 200 m the 3D director held a wide frame with horses ~35-45 px long on a 1,100 px stage (`images/play-desktop-3d-01.png`) | Broadcast rule: tighter on the battle, keep the field readable (2026-10-30 research) | Climax too wide on 3D and on phones | Final-400 m group framing on phones (V-02); battle-aware tighter 3D framing in the last furlong (part of V-10) | S | High | Medium (headless fps) |
| 7 | Broadcast UI | **7 desktop / 4 phone** | Desktop HUD is clear: standings in lengths, furlong badge + metres, call line, battle chip, course map. On a 390 px phone the overlays cover about half the stage and the call line sits on the horses (`images/race-trackside-phone-mid-ashcombe.png`); in natural playback the callout hid the leaders 21 m from the line in 3D and 16 m out in Trackside (`images/play-phone-3d-21m-to-go.png`, `images/play-phone-trackside-16m-to-go.png`) | Players punish desktop UIs on phones (03 F18) | Phone layout | V-01 (Prototype B) | S-M | High (first session) | High |
| 8 | Stable | **7** | Ranch pasture shows the player's own horses with name tags (`images/phone-stable.png`); stall scenes; 68 non-repeating scene bands | Horse Tales players ask to "see my horses hang out" (03 F15): Post Time already does | Horses on the pasture are twins | V-04/V-05/V-12 | M | Medium | High |
| 9 | Breeding | **6** | New stable: no mare of breeding age, so only the explainer was seen (`images/pages-phone-breeding.png`); preview shows possible looks in words (code) | Horse Reality shows patterns prominently on foals; Rival Stars visible/hidden genes | Inheritance not *shown* | V-20 | S | Medium | Medium |
| 10 | Foal | **5** | 1.3 s stall-door reveal with foal-head portrait, sex, colour, breed and rarity (seen for a pack foal: `images/pages-phone-foal-reveal-end.png`); foal/yearling **heads** on portraits; young horses on the Ranch are a smaller copy of the adult (`images/pages-desktop-stable.png`) | "the cutest foal. My heart melted" (03 F5) | No parents, no "from her dam"; adult body on sprites | V-06, V-12 | S-M | High | High |
| 11 | Emotional identity | **6** | Names called on radio; verdict card ("Wilf says"); finale slides with portraits; first-win result is a text card with a +credits count-up (`images/pages-desktop-result.png`) | Rival Stars' announcer naming is loved (03 F12); research: owner's moment / leading in | First win and milestones under-staged | V-08 | S-M | High | Medium |
| 12 | Consistency | **8** | One appearance object per horse across Trackside, 3D, photo strip, paddock, Ranch, portrait; 3D/Trackside mismatches from 2026-10-30 fixed (seen) | — | Build/mane must follow the same rule | Test in 06 §6 | — | High | High |
| 13 | Mobile readability | **3** | Horses ~30-40 CSS px at whole field on 390 px; the call line hid the leaders in the last 20 m in both views (`images/play-phone-*-to-go.png`); markings invisible; starters carousel shows two identical bay heads (`images/phone-starters.png`) | Rival Stars uses a chase cam + numbered cloths (viewed) | Largest gap | V-01, V-02, V-03 | S-M | Very high | High |
| 14 | Performance | **? (6 provisional)** | Headless CPU-only: JS work per frame median 0.9-2.1 ms in every mode; Trackside ~56 draw calls, 110 triangles, 142 textures; 3D low 39-46 calls, ~15.5k triangles; 3D high ≈48-60 calls and ≈29-41k triangles per frame including the shadow pass; JS heap 123-139 MB in the harness (07) | Players punish lag/crashes (03 F20) | Unknown on real phones | V-00 first | S | High | **Low** (no real device) |
| 15 | Shareability | **7** | Share image, share clip (vertical, in-browser), photo strip, replay links that open on the finish | GT7 photo from replays | No HUD-free owner photo | V-15 | S-M | Medium | Medium |

## UI screens (desktop and phone)

From the page tour (`images/pages-*`, `images/landing-desktop.png`, `images/phone-*`). See 08 for the unified direction.

| Screen | Seen | Works | Weak | Action |
|---|---|---|---|---|
| Landing | `images/landing-desktop.png` | Four painted bands, brass CTA, distinctive 1920s British racing look | Copy promises a horse's "build" that races do not show yet | Keep; align after V-04 |
| First-run starters | `images/phone-starters.png` | One brass action ("Race Brave Heart now") | Two identical bay heads; card carousel mid-transition clips text in the capture | V-03/V-04; check carousel |
| Race page (phone) | `images/race-page-phone.png` | Race card readable, saddlecloth tiles, plain-words explainer | Long page; overlays on the stage | V-01 |
| Result (desktop) | `images/pages-desktop-result.png` | Verdict first, "Wilf says", sealed/verify panel, share image | First win not celebrated beyond text | V-08 |
| Stable (phone) | `images/phone-stable.png` | Ranch with own horses; clear list; floating race button | Twins on the pasture; breed traits named ("Curled ears · Dished face") but not drawn | V-04/V-05 |
| Stable (desktop) | `images/pages-desktop-stable.png` | Wide Ranch pasture, tags with leaders, the new foal grazing | Foal is a small adult; three brown horses read alike | V-04/V-05/V-12 |
| Home (desktop) | `images/pages-desktop-home.png` | Estate map with signposts (Trophy Room, Racecourse, Barn, Gallops), off-time on the clock | The "Ready to race" card covers the led horse's head and neck | Move focal point (08 §3) |
| Horse page (phone) | `images/pages-phone-horse_da33814a_ccfe_49bb_8300_81bbc046fced.png` | Large portrait in a stall, breed share, stats tiles, one brass action | Thumbnail strip of three similar brown heads | V-04/V-05 then portraits |
| Breeding (phone) | `images/pages-phone-breeding.png` | Study scene, Wilf's pointers, barn / finder / stud book tabs | Nothing to see for a new stable (no mare of breeding age): expected | V-20 later |
| Nursery (phone) | `images/pages-phone-nursery.png` | Foaling-barn scene, clear empty state with two actions | — | — |
| Foal reveal (phone, pack) | `images/pages-phone-foal-reveal-end.png` | Stall door, foal head, rarity, verify | Beam stripes stay over the foal; no parents; a seal/seed line at the emotional peak | V-06, V-21 |
| Hall of Fame, Legacy Farm, Market (phone) | `images/pages-phone-hall.png`, `pages-phone-legacy.png`, `pages-phone-market.png` | Distinct painted scenes per page; honest empty states with one-meaning icons | Empty for a new stable (expected) | — |
| Finale (desktop) | `images/finale-desktop-trackside-*.png` | Photograph → line-scan strip with a time axis → slow-motion replay → weighed in → slides (yours, 3rd, 2nd, winner) with portraits | Slide cards cover the right half of the track; the winner eyebrow is low-contrast in the capture (possibly mid-fade) | Keep |
