# Graphics audit: repeats and weak spots (31 Oct 2026)

Owner's ask: "make sure our graphics don't repeat and are beautiful". Example already fixed before
this audit: the mentor Wilf used a crop of the yard groom sprite; he now has his own portrait.

## Method

- Local production build (`next build` + `next start`, PGlite), four stables founded through the
  API (Hoops Hollow with "hoops" silks as the player, plus three rivals), nine Story races, a match
  race, the Daily challenge, a signed apprentice jockey, a published race card.
- Every route under `apps/web/app/**/page.tsx` (51 routes, dev and admin pages excluded) visited
  with Playwright at 390 px (DPR 2) and 1440 px; every `/art/` request and every CSS
  `background-image` / `<img>` that points into `/art/` recorded per page.
- Code grep of every art reference (`/art/`, `ART_SLOTS`, `SceneBand`/`PageHeader` scene props,
  diorama scene ids, `PixelIcon` maps for news and moments, wiki `Figure`s and section posters).

## Images per page (summary)

| Page(s) | Hero / backdrop | Other art |
|---|---|---|
| Home (`/`) | yard diorama | horse portraits, icons |
| Stable | pasture diorama (Ranch herd) | horse portraits, icons |
| Finances, Facilities | **yard** diorama | icons |
| Horse (+ care, career, log, training) | **barn** diorama / barn poster backdrop | genetic portrait |
| Breeding, Nursery | **barn** diorama | horse portraits |
| Stables/[id], Play | **barn** poster backdrop | silks |
| Race card, Hall of Fame, This week | **grandstand** diorama | icons |
| News, Tipsters, Quick races, Sponsor, Rival, Invite, Pool, Beta | **grandstand** poster, blurred | icons |
| League, Club, Daily Cup, Jockeys, Packs, Story | **paddock** diorama | icons, pack art |
| Legacy Farm | **paddock** poster, blurred; no scene | empty state without art |
| Jockey detail, Transfer window, Me, Me/races, Me/bets, Link, Wiki | **yard** poster, blurred | jockey "portrait" (see R1) |
| Market | sales-ring diorama (unique) | horse portraits |
| Trophies | trophy-room + trophies sheet (unique) | |
| Race, Quick race result, What-if | race viewer (out of scope) | course art |
| Wiki articles | diorama posters as figures | icons |

## REPEATS (ranked by how often a player sees them)

1. **Every jockey has the same portrait, cut from the horse sprite.** `JockeyPortrait` crops the
   rider out of frame 0 of `diorama/horse-walk-jockey.png` (72x64: helmet, goggles, torso, knee and
   the horse's back) and only recolours the silks. Niamh Upton (female apprentice) shows the same
   male race rider as every veteran; jockey lists (Jockeys, Transfer window, Your jockeys) show no
   face at all. Contact sheet: `graphics/offender-jockey-crop.png`.
2. **One paddock banner for six sections.** League, Club, Daily Cup, Jockeys, Packs and Story open
   on the identical paddock diorama crop (same crowd, same rail, same led horse);
   `graphics/offender-paddock-banner-1440.png`.
3. **Grandstand everywhere else in Racing/Club.** Race card, Hall of Fame and This week share the
   grandstand diorama; News, Tipsters, Quick races, Sponsor, Rival, Invite, Pool and Beta sit on the
   same blurred grandstand poster; `graphics/offender-grandstand-banner-1440.png`.
4. **Barn and yard reused.** Breeding, Nursery and the five horse pages share the barn; Home,
   Facilities and Finances share the yard, and every `PageHeader` without a scene (jockey pages,
   Me, Link, Wiki) falls back to the yard poster; `graphics/offender-barn-yard-banner-1440.png`.
5. **Eight named rival trainers have no face.** Story's rival stables (Eleanor Harrow, Cass Lark,
   Tom Penrose, Jory Salt, Rhea Kestrel, Marcus Bellamy, Ada Copperfield, Lady Helena Ashcombe) have
   bios, greetings and taunts but are drawn as a 16 px silks jersey only.
6. **News and moments share a handful of icons.** `silks-sash` stands for four jockey stories
   (signed, claim lost, retirement announced, retired); `coin` for sales, claims and record purses;
   `laurel` for champions, Hall of Fame, retirements and legacy; `papers` for scans and exact
   predictions. Photo finishes use the generic `flag`.
7. **Wiki figures are the diorama posters again.** `poster-yard` 5x, `poster-barn` 5x,
   `poster-pasture` 5x, `poster-paddock` 4x, `poster-track-dusk` 4x across 23 articles, and the
   seven section cards reuse the same seven posters.
8. **Empty states share the default horseshoe/flag icons** (No jockeys here, No free agents,
   No runners yet, No news yet...).

Not counted as repeats (by design): horse portraits are one genetic painting recoloured per horse
(two plain bays do look alike, which is correct); stable avatars are the stable's own silks; the
in-race horse and jockey sprites are shared and recoloured (out of scope).

## UGLY / WEAK spots

1. Jockey "portrait" is clipped mid-thigh and includes the horse's back and saddle (R1).
2. Legacy Farm has no scene at all, only a blurred paddock backdrop and a text-only empty state.
3. Top-bar avatar draws the 16x13 silks grid into 24x24 CSS px (1.5x, non-integer); fine on DPR 2,
   uneven on DPR 1 desktops. Low.
4. Empty states draw 32 px icons at 2x in a 64 px slot: crisp but generic.
5. Between 689 and 767 px wide, 1x scene art (688 px) leaves a few px of band colour at the sides
   (integer scale by design). Low.

No blurry or non-integer upscales were found in the served art: portraits, dioramas and icons are
all drawn with `image-rendering: pixelated` at 1x/2x/3x.

## Plan (most visible first)

1. A cast of distinct jockey busts (about 24+, apprentices young, veterans older, men and women,
   varied skin tones), keyed silks recoloured to each jockey's stable, assigned by jockey id;
   faces in every jockey list.
2. A scene per section that currently borrows another's (Club lawn, Winners' enclosure, Weighing
   room, Stud at dawn, Hall of Fame, Press room, Form on the rail, Foaling barn, Estate office,
   Retirement meadow, Morning gallops, Club library, Yard works).
3. Portraits for the eight rival trainers.
4. Vignettes per news/moment kind.
5. Wiki figures and section cards spread over the new scenes (plus vet room, grooming aisle,
   farrier, stud book, starting stalls).

## What was done (same day)

| Finding | Fix |
|---|---|
| R1 jockeys | 27 PixelLab busts (`portraits/jockeys`, 7 apprentices, 13 prime, 7 veterans; men and women; many skin tones), silks keyed to `race/palette.json` and painted in the jockey's stable colours (Club grey for freelancers). `lib/cast.ts` picks one per jockey id within the jockey's stage and the presentation their first name implies; the jockey page shows the 128 px bust, jockey tables and Your jockeys a 56 px head. |
| R2-R4 banners | 14 still scenes (`scenes/<id>.png`, shown at 1x/2x/3x): League club lawn, Daily Cup winners' enclosure, Jockeys weighing room, Packs stud at dawn, Hall of Fame hall, News press room, Tipsters form on the rail, Quick races morning gallops, Nursery foaling barn, Breeding stud book, Facilities yard works, Finances estate office, Legacy Farm retirement meadow (it had no scene), Wiki library. Road to Saturday uses the dusk diorama; Bring a rival sits on the paddock. The paddock diorama is now Story's, the grandstand the race card's, the barn the horse pages', the yard Home's. |
| R5 trainers | Eight trainer busts on the Story rival cards, dressed in their stable colours. |
| R6 news | 23 framed vignettes, one per news and moment kind (`vignettes/`), on Racing news, Home's stable news and horse highlights; also on the Legacy Farm, Nursery, Transfer window empty states and the injury card. |
| Plaques | The Trophy Room's 17 achievements each have their own engraved plaque (`trophies/plaques.png`) instead of one shared plaque. |
| R7 wiki | 13 articles moved to their own scenes (plus vet room, grooming aisle, farrier, pedigree wall, starting stalls); the wiki hero is the library. |
| Weak spots | Wiki figures, wiki cards and the Trophy Room banner were `object-fit: cover` (non-integer scaling): now drawn at whole-number scales. Top-bar silks avatar now 2x (was 1.5x). |

Left as is, by design: horse portraits (one genetic painting per horse), stable avatars (the
stable's own silks), the race viewer's sprites, the wiki section cards (each reuses a figure from
its own section as a cover), and blurred backdrops behind Invite, Pool, Beta and the Me pages.

## Round 2 (same day): an independent review, then everything it found

An independent reviewer went over the dev build after round 1 (every page at 390 and 1440, a
network log of `/art/` per page) and found 13 problems; the owner added four more (the Ranch,
riders that look like their jockeys, a cast that grows with the player base, one stored gender).
All were fixed; screenshots at 390 and 1440 of every page, with the `/art/` URLs each page loads,
were taken again afterwards (`graphics2/`, outside the repo) and checked by script and by eye.

| # | Found | Fixed |
|---|---|---|
| 1 | 19 jockeys on /jockeys shared 14 faces (ids hashed into small pools; male apprentices had 3). | 126 base faces (at least 21 per stage and gender, period kit: soft silk caps, no helmets), keyed for skin, lips, hair and silks. A **look** (face, skin of 8, hair of 8, freckles / spectacles / moustache) and a **gender** are stored on each jockey at creation (migration 0030, additive), least-worn face first, then the freest combination; backfilled oldest first, active jockeys first. The bust wears the stable's silks *pattern* on the jacket and the cap. Tests: no two active jockeys share a face while their pool has an unused one; no two share a full look; name gender = stored = bust = rider. |
| B | Every rider in the race and the paddock was the same generic man. | The rider sprites take the jockey's skin, hair cue, silks pattern and cap from the look (locked field and replay carry it, never hashed; old replays unchanged), in the paddock parade, the post parade, Trackside and 3D. Women ride women's copies of every rider strip (same frames, edited with PixelLab: slimmer back, a ponytail in the jockey's hair colour). |
| C | A fixed set of faces runs out. | Looks give thousands of distinct riders per pool; `art-src/grow-jockey-faces.mjs` generates, keys and catalogues more base faces when a pool's worn share passes a threshold (data only, no code change). |
| 2 | Transfer window "no free agents" used the jockey-signed news picture. | Its own vignette: an empty weighing-room bench. |
| 3 | Story used the paddock diorama as its band and its chapter cards (and the race card's crowd strip). | Its own band (an owner and trainer at a gate, the road to the course) and a meeting per chapter (village point-to-point, county course, national course, Classic day), full width on desktop, badge placed on the art. |
| 4 | Wiki cards and figures reused blurred page backdrops. | 28 wiki-only scenes for the 7 section cards and every figure that was a page's picture (`page-scenes.test.ts`: no wiki picture is a page backdrop, none repeats in the wiki). |
| 5 | Barn on 11 pages, yard on 6, grandstand on 5. | A scene per page family: owners' office (Profile, Link, My races/bets, Betting limits), club entrance (Invite), prize-giving (Pool, Beta), sponsor's marquee (Sponsor), stable arch (stable profiles), registration desk (Found a stable), owners' bar (Bring a rival), the eve of Saturday (This week), and a hero per horse sub-page (grooming bay, the gallops, trophy shelf, logbook desk). `page-scenes.test.ts`: no backdrop is used by two families. |
| 6 | Horseshoe, stopwatch, shield and ticket each meant several things. | 16 new icons, one per meaning: grooming brush, empty stall, empty starting stall, telephone (link a device), race diary (my races / runs), results board, record plaque, race clock, training chart, licence, locked purse (betting limits), wax seal (sealed seed), invitation, cap on a peg, door key, lead rope, sale board. |
| 7 | Horse portraits all looked alike; the foal had an adult head. | A head per breed (12), a yearling's and a foal's head while young, per-horse nudges from the genes, bolder small markings, deeper coat contrast; deterministic (a warp through the genetic recolour). |
| 8 | Bad crops (Daily Cup jockey's head, Nursery mare and foal, Quick races horses at the neck, a Land Rover in the 1920s). | A focal point per scene (`STILL_SCENES` fx/fy) and taller still bands at 3x; the gallops repainted without the vehicle. |
| 9 | Eyebrows on bright clouds / crowd / window; the Daily Cup "Gold" chip dark on dark. | Ink outline on every band eyebrow and the wiki label; brass chip with ink text (a later `.chip` rule had overridden it). |
| 10 | Icons at 20 / 16 px from 32 px art; racecourse art at 0.43x. | A hand-tuned 16 px drawing of every icon; icons draw at 16 or whole multiples of 32 only; course scenery at 1x / 2x, cropped by its frame. |
| 11 | Market (locked) and What-if "not found" had no art. | The sales ring band over a "closed doors" vignette; a lost racecard vignette. |
| 12 | Layout: stable name truncated, stat row under the arrow, plaques at 1x (locked ones blobs), sub-tabs cut off. | Name wraps; the plate clears the arrow; plaques at 2x with a legible pewter locked style; tab rows show a wider fade and a chevron where more tabs hide. |
| 13 | Three trainers in modern clothes (puffer gilet, beanie, zip jacket). | Repainted: cloche hat and tweed, flat cap and reefer jacket, tailored jacket and silk scarf. |
| A | Ranch: a horse cut in half at the phone's edge, tags overlapping. | Every horse and its whole roaming beat stay inside the visible pasture (margin, re-clamped on resize); tags are laid out so none covers another or leaves the stage, with a leader line to their horse; the rest are counted "in the barn". Checked at 360 / 390 / 430 / 768 / 1440 with 1 / 4 / 8 / 12 horses. |

PixelLab: 3,340 generations (126 keyed base faces and 2 redraws, a first natural-hair batch of
jockeys that keying replaced, 46 scenes, 16 icons, 3 vignettes, 3 trainers, 10 rider-strip
edits). Raws: chosen ones only, prompts and seeds in `art-src/assets.json`.
