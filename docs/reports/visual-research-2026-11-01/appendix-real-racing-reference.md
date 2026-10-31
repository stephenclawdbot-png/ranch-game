# Appendix · Real racing visual reference (Phase 4)

Builds on `docs/reports/2026-10-30 race experience research.md` (67 sources on course design,
broadcast craft, the photo finish and the first 30 seconds after the line), which this pass did
not repeat. New sources opened for this report are listed with what they say. "Post Time" notes
say how the game compares (from code and captures).

## 1. Thoroughbred morphology and movement

| Fact | Source | Post Time |
|---|---|---|
| Typical height 15.2-17.0 hands, average 16 hands (163 cm); "well-chiseled head on a long neck, high withers, a deep chest, a short back, good depth of hindquarters, a lean body, and long legs" | [Wikipedia: Thoroughbred](https://en.wikipedia.org/wiki/Thoroughbred) | The HD gallop strip reads as a lean racehorse (`images/gallop-sheet.png`). All breeds share it (06). |
| Mean stride length 7.08 ± 0.39 m, 28.32 strides per 200 m, 0.43 s per stride, 16.63 m/s, across 33,459 starts (Tasmania, StrideMaster); speed and stride length fall as the race progresses | [Morrice-West et al., Equine Veterinary Journal, author manuscript](https://minerva-access.unimelb.edu.au/server/api/core/bitstreams/27f086c6-eb23-5494-9c86-6253673b2526/content) | `strideLengthM(v) = 2.2 + 0.32·v` → 7.5 m at 16.6 m/s, i.e. ~2.2 strides/s vs 2.33 measured (within ~6 %). |
| The gallop is four-beat; the non-leading hind strikes off first; "When all four feet are off the ground in the suspension phase of the gallop, the legs are bent rather than extended"; Muybridge's photographs corrected paintings with all four legs stretched | [Wikipedia: Horse gait](https://en.wikipedia.org/wiki/Horse_gait) | Frames 6-7 of the gallop strip show the gathered suspension (correct); frames 0-1 show a stretched pose with hooves at the ground line. A frame-by-frame footfall check is advised before any regeneration (not verified here). |
| Gallop speed averages about 40-48 km/h; canter 16-27 km/h | same | The viewer's gait thresholds pick gallop/drive/canter/trot/walk from speed (`stage/motion.ts`). |

## 2. Coat colour (registry view)

The Jockey Club (US), *Principal Rules and Requirements of The American Stud Book*, August 2025,
Section IV Color Guide ([PDF via CHRB](https://www.chrb.ca.gov/rule_law/Scientific_Material/The_Jockey_Club_RM.pdf)):
Bay, Dark Bay/Brown, Black, Chestnut, Gray/Roan (one category), Palomino, White, with verbatim
definitions in 06 §2. White markings on face and lower legs; multi-colour body patterns are not
recognised by mainstream registries ([Wikipedia: Thoroughbred](https://en.wikipedia.org/wiki/Thoroughbred)).
Dominant-white alleles occur in named Thoroughbred families (W2, W5, W14, W22, W27), several
"sabino-like" ([Wikipedia: Dominant white](https://en.wikipedia.org/wiki/Dominant_white)).

## 3. Raceday identification

| Fact | Source | Post Time |
|---|---|---|
| Saddle-pad colours by post position are set by rule in some US jurisdictions, and **jurisdictions differ**: Indiana (harness) and Pennsylvania rules order red, blue, white, green, black, yellow…; Ohio requires the cap to match "the corresponding standard-colored post-position saddle cloth" | [71 IAC 7-3-33 (Indiana)](https://d1tvxue8o4w0fl.cloudfront.net/regulation/indiana-administrative-code/title-71-indiana-horse-racing-commission/article-7-rules-of-the-race/rule-71-iac-7-3-driving-rules-and-violations/section-71-iac-7-3-33-standard-saddle-pad-colors), [58 Pa. Code 185.255](https://regulations.justia.com/states/pennsylvania/title-58/part-v/chapter-185/subchapter-l/section-185-255), [Ohio 3769-7-04](https://codes.ohio.gov/assets/laws/administrative-code/authenticated/3769/0/7/3769-7-04_20260607.pdf) (search summaries; rule texts not opened) | The racecard's `Saddlecloth.tsx` uses red, white, blue, yellow, green, black, orange, pink, turquoise, purple, grey, lime: the order commonly seen at US Thoroughbred tracks (not sourced to a rule here). On the track every cloth is white. |
| Real broadcasts identify runners by cloth number and silks; the main pan camera shows the whole field with few cuts; the finish is covered by high-motion and line-scan cameras | 2026-10-30 research §2-3 | Silks are per stable and drawn on every rider (seen); cloth colour is the missing link. |

## 4. Racecourse and broadcast (from the 2026-10-30 research, re-checked against captures)

| Element | Real reference (2026-10-30 sources) | Post Time now (seen) |
|---|---|---|
| Finish on a straight; judge's box in line with the post; grandstand facing the run-in | BHA track design; York | Judge's box and roundel on the far rail; stand before the line in both views |
| Distance poles counted back from the line | Illinois code; Del Mar | Furlong poles on the far rail; 200 m board; furlong badge + metres in the HUD |
| Pre-race ritual (parade, canter to post, loading) | Jockey Club guide; BHA | Built (build-up before the off, skippable) |
| Photo finish = line-scan, x is time | Wikipedia; BHA | Built (`images/finale-desktop-trackside-1-strip.png`) |
| After the line: run-on, pull-up, slow-motion replay, "weighed in" | Jockey Club; SVG Europe | Built: run-out, "THE FINISH AGAIN" slow motion, weighed-in step, slides |
| Weather and going change the look (soft ground, rain) | — | Rain/overcast/dusk looks in both views |

Not researched in this pass: turf wear patterns and dirt kickback reference footage (no
footage viewed), crowd density by course type, Japanese/Hong Kong broadcast graphics in detail.
