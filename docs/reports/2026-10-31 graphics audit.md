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
