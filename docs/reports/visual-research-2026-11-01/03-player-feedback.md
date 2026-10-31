# 03 · Player feedback report (primary sources)

Collected 2026-10-31. Every quote below is verbatim from a public review and linked to it.
Nothing was paraphrased into a quote, and no review was invented. Counts are counts of distinct
reviews (one review per account per game), never of words.

## 1. Method and its limits

| Source | Access | What was collected |
|---|---|---|
| Steam community review hub (`steamcommunity.com/app/<id>/homecontent/`, "most recent") | Worked | 1,807 English reviews across 9 horse games + 101 Japanese reviews of *Winning Post 10 2025* (a Steam title called "Photo Finish", app 943950, turned out to be a car-combat game and was excluded) |
| Steam store review API (`store.steampowered.com/appreviews`) | **Blocked** (302 to the store root from this container) | Totals were read from each store page's tooltip instead |
| Apple App Store (public iTunes RSS feed, US store, most recent, ≤500 per app) | Worked | 2,822 reviews across 8 apps |
| Google Play | Store page loads; review text is fetched dynamically and was **not collected** | none |
| Reddit | **403** from this container | none |
| YouTube comments, forums (Mane Quest forums, Discords) | Not attempted in the time available | none |

Scripts: `data/steam_fetch.py`, `data/apple_fetch.py`, `data/themes.py`, `data/desires.py`
(in this folder). Raw review text was kept outside the repo (scratchpad) because it carries
reviewers' profile links in bulk; every individual quote here keeps its link.

**How counts work.** Each theme is a keyword pattern run over the review text. A keyword count is
an **upper bound** (for example "mane" also matches "maneuver"). For the themes that matter most
to Post Time I read the matched reviews and give a **verified count** next to the keyword count.
Steam dates without a year are 2026 (the hub omits the current year).

**Bias.** App Store "most recent" skews to short, young-audience reviews (Rival Stars, Star
Stable, Equestrian); Steam skews to longer adult reviews. Photo Finish LIVE's 51 App Store reviews
are clustered on 2024-09-19..21 (launch); they are reported but weighted as low confidence.
Monetisation complaints dominate free-to-play titles but are out of scope for this visual brief
except where they gate **looks** (coats, breeds, manes).

### Sample per game

| Game | Source | Reviews read (newest .. oldest) | Negative (Steam "not recommended" / App Store ≤3★) |
|---|---|---|---|
| [Rival Stars Horse Racing (mobile)](https://apps.apple.com/us/app/id1215477266) | App Store US | 500 (2026-10-26 .. 2025-10-18) | 89 |
| [Rival Stars Horse Racing: Desktop Edition](https://steamcommunity.com/app/1166860/reviews/?browsefilter=mostrecent) | Steam | 600 (2026-10-30 .. 2025-09-27) | 82 |
| [Rival Stars Horse Racing: VR Edition](https://steamcommunity.com/app/2937440/reviews/?browsefilter=mostrecent) | Steam | 39 (2026-08-02 .. 2025-04-17) | 7 |
| [Photo Finish LIVE](https://apps.apple.com/us/app/id6504777327) | App Store US | 51 (2026-06-30 .. 2024-09-19) | 5 |
| [Horse Racing Manager 2026 (Third Time)](https://apps.apple.com/us/app/id1275199710) | App Store US | 225 (2026-07-01 .. 2018-05-02) | 107 |
| [Horse Racing Manager (Sheep Meadow Road, EA)](https://steamcommunity.com/app/2740170/reviews/?browsefilter=mostrecent) | Steam | 179 (2026-10-30 .. 2025-10-24) | 23 |
| [Winning Post 10 2025](https://steamcommunity.com/app/3187290/reviews/?browsefilter=mostrecent) | Steam (Japanese) | 101 (dates not parsed) | 26 |
| [Starters Orders 7](https://steamcommunity.com/app/978960/reviews/?browsefilter=mostrecent) | Steam | 158 (2026-10-22 .. 2019-05-02) | 38 |
| [Horse Tales: Emerald Valley Ranch](https://steamcommunity.com/app/1474740/reviews/?browsefilter=mostrecent) | Steam | 400 (2026-10-25 .. 2022-12-09) | 142 |
| [Unbridled: That Horse Game](https://steamcommunity.com/app/1938050/reviews/?browsefilter=mostrecent) | Steam | 330 (2026-10-30 .. 2025-02-19) | 48 |
| [Horse Club Adventures](https://steamcommunity.com/app/1518820/reviews/?browsefilter=mostrecent) | Steam | 75 (2026-09-30 .. 2021-05-27) | 13 |
| [Horse Racing 2016](https://steamcommunity.com/app/655610/reviews/?browsefilter=mostrecent) | Steam | 19 | 13 |
| [Glory Horse Racing](https://steamcommunity.com/app/1273180/reviews/?browsefilter=mostrecent) | Steam | 7 | 4 |
| [Equestrian the Game](https://apps.apple.com/us/app/id1468871996) | App Store US | 500 (2026-10-27 .. 2025-07-24) | 193 |
| [Star Stable Online (mobile)](https://apps.apple.com/us/app/id1445695988) | App Store US | 500 (2026-10-30 .. 2026-07-12) | 157 |
| [Howrse (mobile)](https://apps.apple.com/us/app/id684830457) | App Store US | 500 (2026-10-28 .. 2017-08-03) | 337 |
| [Umamusume: Pretty Derby](https://apps.apple.com/us/app/id6480433538) | App Store US | 500 (2026-10-28 .. 2025-09-24), excluded from the horse-appearance pool | 127 |
| [Pocket Horse: Racing Champions](https://apps.apple.com/us/app/id6751256352) | App Store US | 46 (2026-10-23 .. 2026-06-22) | 20 |

Totals: **4,129 English reviews** (1,807 Steam + 2,322 App Store) in the horse-game pool used for the theme counts (Umamusume
excluded from horse-appearance themes; Winning Post counted separately in Japanese).

## 2. Findings by area (verified facts first, interpretation after)

Format: *finding* · praise/concern · evidence (count, games) · spread · relevance to Post Time.

### 2.1 Horse appearance

**F1. "They all look the same" is about bodies and breeds, not colours.** Concern.
Verified 12 reviews in 5 games (Unbridled 5, Rival Stars 3, Horse Tales 2, Horse Racing Manager
2026 1, Sheep Meadow HRM 1 "horses look like ponies"). Widespread across 3D titles; isolated
volume. Relevance: **high** (Post Time draws every breed with one race body; see 04/06).
- "Horses look the same except having different splotches." ([Unbridled, 2025-07-06](https://steamcommunity.com/id/FlutterCry/recommended/1938050/))
- "why do the drafts look the exact same to the ponies? why do all the horses look the SAME?" ([Unbridled, 2026-01-03](https://steamcommunity.com/profiles/76561199061597612/recommended/1938050/))
- "there are only a couple horse models, which means most breeds either look like slightly modified Thoroughbreds, Quarter horses, or Arabians (ex., Friesians lack their signature arched necks and look like Quarter horses, Akhal Tekes lack their roached manes and look like Arabs with slightly less dishes faces)" (Rival Stars App Store, 2026-03-13, review id 13846027423)
- "all the breeds feel and look the same, maybe slight diffrences but not much" ([Rival Stars Desktop, 2026-07-29](https://steamcommunity.com/profiles/76561199262439357/recommended/1166860/))
- "It's extremely frustration to have a full stable of brown horses that look the same." (Horse Racing Manager 2026 App Store, 2020-07-13, id 6194104577)

**F2. Coat colour and genetics are the most praised part of these games.** Praise.
Keyword "genetics/coat/breeding + positive word": 97 reviews in 13 games (upper bound). Strongest in
the pixel-art manager most like Post Time:
- "the only horse racing game that I know of with realistic color genetics" ([Sheep Meadow HRM, 2025-10-31](https://steamcommunity.com/profiles/76561198337340769/recommended/2740170/))
- "The amount of care that has gone into the coat generation is stellar, I find myself getting attached to my favorite pixel horses." ([Sheep Meadow HRM, 2026-05-19](https://steamcommunity.com/id/Lootsweeper/recommended/2740170/))
- Players notice wrong genetics: "Can someone for the love of God explain to me how dominant white can be a base color?… your horse can only have one of those at a time for whatever reason, so no dunskins for me." ([Rival Stars Desktop, 2025-12-15](https://steamcommunity.com/id/peelov3r/recommended/1166860/))
Relevance: **high**: Post Time's genetics are already real-gene based (06); the opportunity is to
*show* them.

**F3. Mane and tail are a recurring, specific ask.** Mixed. Keyword 41, **verified 28** in 7
games. Two kinds: styling/variety wanted (about 12: braids, mane styler, "more variation in coat
colors, mane, tail") and realism/physics criticised (about 9).
- "the horses tails and mane they could be a bit more realistic… The tails just move the same way constantly" (Rival Stars App Store, 2026-05-25, id 14105133177)
- "You can't change the horse's tail or mane style, and the 'long mane' looks pretty goofy imho -- and worse is it's genetic" ([Rival Stars Desktop, 2026-05-17](https://steamcommunity.com/profiles/76561198119813196/recommended/1166860/))
- "I love the little details like they lick their mouths and their tails can get stuck around their hind legs." ([Unbridled, 2025-09-21](https://steamcommunity.com/profiles/76561198333267864/recommended/1938050/))
Relevance: **high** (Post Time: one mane/tail shape per sheet, except feathered horses; coat audit §5).

**F4. Realistic-looking horses earn love; stylisation is accepted.** Praise. Keyword 102 reviews
in 10 games. "Graphics dated/poor" only 13 (upper bound). Interpretation: fidelity is not the
complaint; sameness and broken details are.

**F5. Foals are an emotional peak, and players want to see them grow and resemble parents.**
Praise/desire. Keyword 117 (upper bound).
- "The moment that sold me was when I bred my first mare with a stud and got the cutest foal. My heart melted." ([Rival Stars VR, 2025-04-19](https://steamcommunity.com/id/FastLawyer/recommended/2937440/))
- "you only get to see the 'Foal' after its birth in the breeding station. Why letting us build a Paddock if we can't select horses to show up there?" ([Horse Tales, 2022-12-24](https://steamcommunity.com/id/snowtuft7/recommended/1474740/))
- "the foal always ends up looking the same! Reddish brown with white main and tail." (Horse Racing Manager 2026 App Store, 2018-06-20, id 2734795511)
- Horse Reality's art director reports players asked for "displaying the pattern prominently on foals in-game to make it easier to identify" ([PreMortem, 2024-12-20](https://premortem.games/2024/12/20/horse-reality-by-studio-deloryan-strikes-the-right-balance-between-science-and-gameplay/)).

**F6. Paying for looks breeds resentment.** Concern. Many reviews in Rival Stars, Equestrian
the Game and Star Stable tie coats/breeds to premium currency ("everything costs e-coins,
including… most coat colors", Equestrian, 2025-07-29, id 12951300272). Relevance: confirms the
owner's rule that rare colours come only from inheritance and natural frequency.

### 2.2 Animation

**F7. Equestrian players check gaits.** Mixed. Keyword 35 reviews in 9 games.
- "I ride horses and am tied of the cheesy horse games where the gaits are not realistic" (Rival Stars App Store, 2026-07-16, id 14312288095)
- "horse animations are pretty alright, though the walk is weird, looks almost 2-beat" ([Unbridled, 2025-02-19](https://steamcommunity.com/id/lialice/recommended/1938050/))
- On the pixel competitor: "you could have at least gotten decent run animations for the horses they look like they are awkwardly limping all over the place rather than running" ([Sheep Meadow HRM, 2025-10-30](https://steamcommunity.com/profiles/76561198252134524/recommended/2740170/))
Relevance: **high**: Post Time's 12-frame HD gallop is its strongest asset vs the closest
competitor; protect cadence and add transitions (05, 07).

**F8. Idles and small life signs are noticed.** "I wish we could see some idle animations like
tail swishing when looking at them in the stable" ([Sheep Meadow HRM, 2025-10-26](https://steamcommunity.com/id/Sona205/recommended/2740170/));
"They could use more idle animations." ([Unbridled, 2025-02-19](https://steamcommunity.com/profiles/76561198096587096/recommended/1938050/)). Isolated (≈5).

### 2.3 Racing presentation

**F9. Repetition is the top racing complaint.** Concern. Keyword 201 reviews in 14 games (upper
bound; includes "grind"). Rival Stars Desktop alone: 72 of 600.
- "the first few hours were great, the next few tedious, and my final few a pointless repetition" ([Rival Stars Desktop, 2026-05-25](https://steamcommunity.com/profiles/76561198025420530/recommended/1166860/))

**F10. Watched-race cameras are watched "only at the start".** Concern (Japanese, Winning Post 10
2025):
- "レースカメラ充実じゃねーよ。んなもん最初しか見ねーんだよ。あとは残ってる化石UIと向き合ってるだけなんだよ" ("Richer race cameras? Nobody watches that past the start. After that you're just facing the fossil UI.") ([review](https://steamcommunity.com/profiles/76561198112620332/recommended/3187290/))
- "レース中のカメラはランダムチェンジですが騎手アングルのカメラが臨場感ありです" ("cameras change randomly in a race, but the jockey angle has presence") ([review](https://steamcommunity.com/profiles/76561198180898827/recommended/3187290/))
- "レースシーンは一見同じに見えるかもしれません" ("race scenes may look the same at first glance") ([review](https://steamcommunity.com/profiles/76561198364016772/recommended/3187290/))
- Praise for the 2025 graphics: "グラフィックはダントツによくなっている" ("graphics are by far better") ([review, not recommended overall](https://steamcommunity.com/profiles/76561198074407374/recommended/3187290/)); 12 of 101 mention graphics/visuals (5 negative).

**F11. Camera that moves too much makes players sick.** Concern. Camera keyword 34 reviews,
**verified ≈27 camera complaints or wishes**, 6 explicit motion-sickness/headache reports, all
Horse Tales.
- "The camera jumping is awful. Borderline unplayable at points because of the motion sickness" ([Horse Tales, 2024-10-25](https://steamcommunity.com/id/thetamar/recommended/1474740/))
Relevance: **high** for any new camera move (owner rule: no excessive shake/zoom/cuts).

**F12. Hearing your horse's name called is loved.** Praise. Commentary keyword 21 reviews.
- "I like the race announcer calling your name (if it fits within the naming parameters)" ([Rival Stars Desktop, 2026-05-25](https://steamcommunity.com/profiles/76561198025420530/recommended/1166860/))
- "Horse names can be funny, especially when read aloud by commentators." ([Rival Stars Desktop, 2026-03-26](https://steamcommunity.com/id/thetamar/recommended/1166860/))
- Wish: famous names "commentary friendly" (Rival Stars App Store, 2026-04-11, id 13948620194).

**F13. Close finishes matter; spread-out fields read as broken.** "horses never finish close to
each other but miles apart" ([Sheep Meadow HRM, 2025-10-29](https://steamcommunity.com/profiles/76561198526938079/recommended/2740170/)). Isolated in reviews; strongly supported by the
2026-10-30 research (69% replay narrow wins).

**F14. Finding your horse in a race:** almost no direct review mentions (7 keyword hits, ≈0
verified about races). Interpretation: in ridden games the player *is* the horse; for a watched
game like Post Time this is an internal-evidence issue (see 05), not a review-backed one.

### 2.4 Ownership

**F15. Players want to see their horses in the yard.** Desire. "I'd love to be able to see my
horses hang out in the stable/fields. Otherwise, the estate is just empty" ([Horse Tales, 2023-08-07](https://steamcommunity.com/id/dementedtoaster/recommended/1474740/)); same wish in
[2023-08-25](https://steamcommunity.com/id/MamaTopsToppings/recommended/1474740/) and
[2023-03-13](https://steamcommunity.com/profiles/76561198313074021/recommended/1474740/). Post Time's Ranch already does this (verified, 04).

**F16. Backstory, roles, photo mode.** "I would love to write out a backstory for my horse (and
this doesn't have to affect the game in any way.)" (Rival Stars App Store, 2025-11-20, id
13421157485); "I want to take pretty pictures of this beautiful game but I always have to crop out
the GUI" ([Horse Tales, 2023-03-13](https://steamcommunity.com/profiles/76561198313074021/recommended/1474740/)). Photo/share keyword 12 (small).

**F17. Customisation of stable and tack is the biggest "free" desire in the collector games**
(Star Stable 105/500, Equestrian 78/500, Horse Tales 104/400 keyword). Relevance: medium (Post
Time is racing-first; silks are its customisation).

### 2.5 Interface and technical

**F18. Mobile ports of desktop UIs are punished.** "The app is now the desktop website, on a 5
inch touch screen… Text is tiny" (Howrse App Store, 2026-08-01, id 14374760557); Rival Stars
Desktop called "a mobile port" (UI, camera). UI keyword 234 (130 negative) across 15 games.

**F19. Clunky management UI is the pixel competitor's main criticism**: "the UI is very clunky and
extremely convoluted… FM26 UI feels like a masterpiece in comparison" ([Sheep Meadow HRM, 2026-05-12](https://steamcommunity.com/id/Lolzor32/recommended/2740170/)).

**F20. Bugs and performance dominate negatives everywhere** (bugs keyword 420/4,129, 192
negative; performance 195, 113 negative). Relevance: any new visual must not cost frame rate on
phones (07).

## 3. Ranked top 30 complaints and desired improvements (relevance to Post Time)

Rank = evidence strength × relevance to a watched, pixel-art, breeding-first racing game. "K" =
keyword count (upper bound), "V" = verified by reading.

| # | Complaint / desire | Evidence | Spread | Post Time relevance |
|---|---|---|---|---|
| 1 | Breeds/horses share one body ("look the same apart from splotches") | V 12, 5 games | widespread, low volume | High: one race body for 12 breeds |
| 2 | Races feel repetitive | K 201, 14 games | widespread | High |
| 3 | Want mane/tail variety and styling | V ≈12 of 28 mane/tail | several games | High |
| 4 | Mane/tail motion unrealistic (same swing) | V ≈9 | several games | Medium |
| 5 | Want realistic coat genetics (and notice errors) | K 8 explicit + many praise | several games | High (already strong) |
| 6 | Coats/breeds/looks behind paywalls | K 314 (broad) | F2P titles | Rule already respected |
| 7 | Foal moment is emotional; want to see foals grow and show parents' traits | K 117; 4 quotes | several | High |
| 8 | Gait realism checked by riders | K 35 | several | High (protect) |
| 9 | Camera motion sickness / bad camera | V ≈27 (6 sickness) | Horse Tales mainly | High as a constraint |
| 10 | Clunky/overwhelming UI | K 234 | widespread | High (mobile) |
| 11 | Performance/crashes/loading | K 195 | widespread | High |
| 12 | Hearing your horse's name in commentary | K 21 | several | Built (radio call): keep |
| 13 | Close finishes; spread finishes feel fake | 1 review + research | isolated | Built (photo) |
| 14 | See my horses at home (yard/pasture) | 3 reviews | isolated | Built (Ranch): keep |
| 15 | Idle animations / life in the stable | ≈5 | isolated | Medium |
| 16 | Desktop/port versions abandoned vs mobile | K 76 | RSHR mostly | Low (web-only) |
| 17 | Wants more breeds with breed-true looks (Friesian feathers, Akhal-Teke sheen) | K 69 | RSHR, Equestrian | High |
| 18 | Tack/outfits customisation | K 191 (broad) | collector games | Low-medium (silks) |
| 19 | Stable decoration | K 29 | collector games | Low |
| 20 | Photo mode / screenshots without GUI | K 12 | several | Medium (share) |
| 21 | Backstory/roles for a horse | 1-2 | isolated | Medium (career log exists) |
| 22 | Horse ageing / retirement / lifecycle | K 91 (broad) | several | Medium (Legacy Farm exists) |
| 23 | Breeding outcome feels opaque/unfair | K 17 | RSHR, HRM2026 | Medium (preview exists) |
| 24 | Weather/time of day | K 15 | few | Low (built) |
| 25 | Crowd/atmosphere | K 10 | few | Low-medium |
| 26 | More tracks/locations, tracks that look different | K 34; "almost all the tracks… look the same" (SO7) | several | Medium (6 courses) |
| 27 | Helmet/jockey cam, more camera views | 3-4 | isolated | Low (watched race; avoid) |
| 28 | Pre-race warm-up (walk/trot before a flat race) | 1 ("can we do a warm up where we walk, trot, or canter around the track before we do the race like a real flat race?", RSHR App Store 2026-10-17, id 14678375021) | isolated | Built (build-up) |
| 29 | Horses that "look like ponies" in 2D | 1 (Sheep Meadow HRM) | isolated | Medium (proportions) |
| 30 | Winning Post: race cameras watched only at first; UI is what you live in | 1 + "races look the same" 1 (JP) | isolated | High as a principle |

## 4. Verified vs interpretation

Verified: every quote, every count (with the keyword/verified distinction), every sample size.
Interpretation (mine): that players forgive stylisation but not sameness (F1+F4); that the
owner's moment and the foal are the emotional peaks to invest in (F5+F12+research); that
watched-race presentation should go into the last 200 m and the result rather than more
cameras (F10). These are labelled as interpretation in 01 and 05.

## 5. Not covered (unavailable)

Reddit (403), Google Play review text (dynamic), YouTube comments (not attempted), Photo Finish
LIVE independent reviews beyond launch week, Star Stable's PC client reviews, Horse Reality
player reviews beyond one blog. These gaps mean the **Photo Finish LIVE row has the weakest
evidence** of the major competitors.
