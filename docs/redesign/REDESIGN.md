# Post Time redesign: audit, direction, architecture (lead, 2026-10-29)

The owner's brief is "AAA game experience redesign", pasted 2026-10-29: make it feel like a
premium horse-racing game, not a web app, and keep every gameplay, data and economy rule. Crypto
is out of scope for now (the owner said to disregard it). This document covers phases 1–3 of the
brief: the audit, the creative direction and the experience architecture. It also has mockups
of the three benchmark screens. **Phase 4 (building) starts when the owner says go.**

Mockups (HTML using the game's own art, rendered at 390 and 1440): `docs/redesign/mockups/`
`hub-*.png`, `profile-*.png`, `raceday-*.png`.

## 1. Audit: what players see today

All 26 player screens were screenshotted signed-in at 390 and 1440 (scratchpad `audit/`).

**What works and stays:**
- The pixel art is genuinely good and consistent: the dioramas (yard, barn, paddock,
  grandstand, track at dusk), the painted 3/4 portraits, the Trackside race view and the
  UI icon set.
- The racing-green, cream and brass palette.
- Every gameplay system: Live card, Story, care, training, breeding, market, leagues, Daily
  Cup and Hall.
- Honest copy and no dark patterns.

**What fails the brief:**

1. **Every screen is the same template:** a 140 px scene band, then a stack of identical cream
   cards on dark green. This is the brief's "collection of identical cards". The world appears
   for one band and then disappears.
2. **The stable is a menu, not a place.** Home ("Your yard") is a list. Navigation is 5 tabs
   plus sub-tab rows (Horses / Nursery / Breeding / Facilities; League / Daily Cup / Hall).
3. **The horse isn't the hero.** The horse page shows a 128 px portrait in a card, then stat
   bars. Switching horses means going back to a list.
4. **Race day has no build-up and no payoff.** Before the off there's a dark box ("They're
   under starter's orders"). The viewer is a framed box on phones. The result is a plain
   table with a reward card; nothing is shareable as an image.
5. **Desktop wastes the screen:** a narrow centred column in a dark void, and scenes don't
   use the width.
6. **New players hit dead ends:** empty Hall, League and Nursery panels, each saying "no X yet".
7. **The pixel display font everywhere** (titles, nameplates) reads "retro web game", not
   "prestige". The HD-2D games we're closest to (Octopath Traveler, Sea of Stars) pair pixel
   art with a refined serif interface.
8. Several screens show long loading skeletons on cold start (market, packs, pool, invite).

## 2. Creative direction: Cinematic Equestrian Prestige, in HD-2D

**The horse is the hero. The race is the spectacle. The yard is home. The economy supports
the fantasy.**

- **The world is the screen.** Every primary screen is a full-bleed living scene: the
  existing diorama engine, animated, with parallax. The interface sits on top of it in
  framed **glass panels** (dark baize at 72 % opacity, a blurred backdrop, hairline cream
  borders, 14 px radius). No more cream cards on flat green.
- **Two modes, one language** (the brief's correction):
  - **Showcase mode** (Estate, Champion profile, Race day, Foal reveal, Results): cinematic,
    big art, few words, theatrical moments.
  - **Ledger mode** (Market, Training planner, Breeding planner, Club tables): calm and dense,
    with the same glass panels and type over a dimmed scene.
- **Type:**
  - Titles, horse names, race names: **Cormorant Garamond** (600/700), the heritage serif.
  - Body: **Nunito**.
  - Every number, clock and scoreboard: **Jersey 10**, our pixel numerals, the
    broadcast-graphics voice.
  - Pixelify Sans stays only in the wordmark.
- **Colour:** keep the palette. Brass is for primary actions and live data only, not borders
  everywhere. Accent colour comes from the scenes and the time of day. Never black and gold
  everywhere.
- **Light and time:** the Estate scene follows the player's local time of day (morning, noon,
  dusk, night lanterns). The engine already has the posters and lighting for this.
- **Motion:**
  - Routine taps get 150 ms fades.
  - Switching horses slides the portrait across the stage (300 ms, with a parallax offset).
  - Theatre is reserved for the off, the finish line, photo finishes, foal reveals and
    trophies.
  - `prefers-reduced-motion` turns all of it into fades.

## 3. Experience architecture

**Navigation, 5 destinations.** Bottom tab bar on phones, top bar on desktop; sub-tab rows
are removed:

| Destination | Replaces | What it is |
|---|---|---|
| **Estate** | Home | The yard scene full-bleed, with **destination plaques in the scene** (The Barn, Gallops, Racecourse, Sales Ring, Trophy Room, Breeding Barn). Overlay: the featured horse, the next race with a countdown and one primary action, and today's news. Mockup: `hub`. |
| **Stable** | Stable, Nursery, Facilities, horse pages | The roster is a **showcase**: one horse on stage, others as a portrait strip. Swipe or arrows change horse. Nursery foals and pastured horses are filters of the same strip. Facilities live at The Barn plaque. Mockup: `profile`. |
| **Racing** | Races, Story, race pages | The race card as a broadcast schedule, the Story campaign as a map of courses, and race day (paddock, then race, then result). Mockup: `raceday`. |
| **Club** | Club, League, Daily Cup, Hall | Leagues, the Cup and the **Trophy Room** (Hall of Fame as a room of plaques and silverware, the Hall discoveries, legendary bloodlines). |
| **Sales** | Market, Packs | An auction-house look: big portraits, pedigree and form on every lot, filters in a drawer on phones. Packs are a counter in the Sales Ring. |

Profile, settings, device link, wallet and invite live behind the silks button in the top
bar, never as a destination.

**First session (onboarding), as in the brief:**
1. Land on the Estate at dusk, showing a race in progress over the wall.
2. "Found your stable" (stable name and silks on one sheet; the name can be skipped).
3. Your first three horses walk out of the barn one by one (their genetic portraits).
4. Pick one: the profile opens in Showcase mode.
5. Race now: the paddock, then the race.
6. The result card.
7. Back on the Estate with one clear next goal ("Your filly can race again in 2 h; train her
   at the Gallops").

**Casual vs power players:** Estate gives one primary action. Power players get the Racing
schedule's filters, Ledger-mode tables, and keyboard shortcuts on desktop later.

## 4. The three benchmark screens (build these first)

### 4.1 Estate hub (`mockups/hub-390.png`, `hub-1440.png`)

- **Phone:** the scene fills the top 62 % (the diorama engine, integer pixel scale, never
  fractional). The greeting is serif with a time-of-day eyebrow. **Destination plaques**: a
  serif label on a glass chip with a caps status line ("Off in 2:14", "3 horses", "1 session
  left") and a pin. A glass sheet overlaps the scene's lower edge, holding:
  - the **featured horse** card (genetic portrait 112 px, name, one-line identity, readiness
    chips);
  - the **next race** card (race name, conditions, a countdown in Jersey numerals, and one
    brass button: "Enter <horse>");
  - a **news row** of chips (wins, foals due, league moves).
- **Desktop:** the scene is full-viewport. Glass panels stack on the right (400 px), the
  greeting is top-left, and plaques sit on scene landmarks.
- **Rules:**
  - The featured horse is the best-fit ready horse, the same logic as Quick Pick.
  - The next race is the one Quick Join would pick.
  - The primary button does exactly what Quick Join does.
  - Every plaque status is real data or absent.

### 4.2 Champion profile (`mockups/profile-*.png`)

- **Stage:** the barn interior dimmed, with a warm key light behind the horse. **The genetic
  3/4 portrait at 2× (phone) or 3× (desktop).** A portrait strip of the stable's horses sits
  above, with arrows and swipe.
- **Nameplate:**
  - caps registry line: reg. no. and stable;
  - serif name: 40 px on phones, 72 px on desktop;
  - identity line: age, colour, sex, breed %;
  - chips: running style, best trip, breed signature.
- **Readiness row:** four glass tiles (Condition, Fitness, Rating, Form) in Jersey numerals.
- **Actions:** "Race <name>" (brass, wide), then Train and Care.
- **Tabs:** Overview / Training / Care / Career / Pedigree. Today's pages, restyled as glass
  panels in Ledger mode. The Overview has abilities "now vs potential" (a filled bar plus a
  dashed potential marker and a serif grade letter), "Last time out" with ▶ Watch the
  finish, and runs, wins and earnings.

### 4.3 Race day (`mockups/raceday-1440.png`, three phone frames)

1. **Paddock (before the off):**
   - The paddock scene with the race title on a scrim.
   - A big Jersey countdown.
   - The field as a racecard: gate, silks, name, stable, style, form, rating. Your runner is
     highlighted with "fits trip ✓ ground ✓".
   - "Watch from the stands", and the plan editable until 0:30.
   - This replaces the dark "under starter's orders" box.
2. **The race:**
   - **The viewer gets the full width and about half the height on phones.**
   - Broadcast HUD: the top-3 ticker with margins, metres to go, a progress rail with
     furlong poles.
   - The Follow mine toggle (already built).
   - A **commentary line generated only from real race events** (lead changes, moves,
     the final furlong), never invented.
   - A landscape full-screen option on phones.
3. **Result:**
   - A **photo-finish card**: a sepia still of the real finish frame with the line, a serif
     headline from the real margin ("wins by a short head"), and the real time, field size,
     prize, and the rating change.
   - Share (Web Share with a rendered PNG card; the link opens the replay at the finish,
     already built).
   - Replay, and Back to the yard.

## 5. Asset plan (PixelLab, no new pipeline)

**Have:**
- 5 diorama posters plus live scenes (yard, barn, paddock, grandstand, track at dusk);
- 4 scene backdrops;
- 10 painted portraits, now recoloured from genes;
- race strips;
- 70 UI icons.

**Need (lead writes a spec for each before any generation):**
1. An **Estate panorama**, 2–3× the yard's width: barn, gallops, sales ring, trophy room and
   breeding barn as landmarks for the plaques, in 4 times of day.
2. A **Trophy Room** interior.
3. A **Sales Ring** interior.
4. A **Gallops** scene for training feedback.
5. Photo-finish frame dressing: winning-post close-up and a camera-flash overlay.
6. The 4 breed head families (already specced).

All generated once, cached and atlased, never at runtime. **Blocker:** `PIXELLAB_API_KEY` in
the environment settings.

## 6. Delivery plan (after the owner's go)

Design rule (2026-10-27): the lead architects, workers implement exactly.

1. **Design system v3** (GLM):
   - tokens and the serif title face;
   - glass panel, plaque, readiness tile, broadcast ticker and countdown components;
   - Showcase and Ledger layouts;
   - reduced-motion.
   - Applied first to the three benchmark screens only.
2. **Estate hub** (Kimi): the hub mockup with the current yard diorama (the panorama comes
   later), plus the new 5-tab navigation.
3. **Champion profile** (Kimi): the stage, strip and nameplate; the tabs keep today's
   content, restyled.
4. **Race day** (Kimi, viewer parts by the lead): the paddock, the viewer at full width on
   phones, the HUD and commentary from events, and the photo-finish card with PNG share.
5. Owner review of the three benchmark screens on a preview deploy. Then propagate Ledger mode
   to Market, Club, Training and Breeding, then onboarding.
6. Art: Estate panorama, Trophy Room, Sales Ring and Gallops, once the key is set.

Every step ships with 390 and 1440 screenshots side by side with these mockups, the e2e smoke
test passing, and no gameplay, data or economy change.

## 7. Honest limits

- This is HD-2D pixel art with a premium interface, not painted AAA art. The quality bar is
  cohesion and polish (Octopath / Sea of Stars), not photoreal.
- Commentary and photo-finish cards only ever use real simulation data.
- Visuals don't guarantee virality. The bet is attachment to individual horses plus shareable
  finishes; measure it with the race_perf and funnel metrics already in the dashboard.
