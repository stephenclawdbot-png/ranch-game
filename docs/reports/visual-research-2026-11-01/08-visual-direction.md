# 08 · Visual direction proposal

## 1. What Post Time already is (keep it)

From the captures (landing, Home, Stable, race, result): an **HD-2D pixel racing programme from
the inter-war British turf**: forest green and brass, cream racecard paper, period riders in
silk caps, painted courses with real character (Saltmarsh's beach huts and dunes, Harrowgate's
heather and dry-stone walls), a 1920s mentor, a radio caster. Nothing else in the genre looks
like this (02 §C): Sheep Meadow's *Horse Racing Manager* is pixel art but modern American and
dashboard-led; Rival Stars, Photo Finish LIVE, Winning Post and Star Stable are 3D. This is an
asset to defend, not to dilute toward any of them, and certainly not toward a crypto dashboard.

Rules already in force and worth restating as the direction's spine (art-direction.md, HD pixel
standard v2): nearest filtering, whole-number scales, no blurred sprites, depth of field only on
far scenery, pixel fonts only for titles and big numbers, PixelLab as source material finished in
code.

## 2. Direction: "The owner's racing programme"

One sentence: **every screen is a page of your horse's racing programme, and every horse is
recognisable at a glance on every page.**

Three pillars, each tied to evidence:

1. **Recognisable horses.** A horse is its coat *plus* its build, mane and tail, markings, and its
   saddle cloth on raceday. Evidence: players elsewhere tolerate stylisation but not sameness (03
   F1, F3); Post Time's own stable shows twins today (05 #2).
   - Race scale: cloth colour + coat mass + (later) build silhouette.
   - Close scale (paddock, finale, portrait): markings, mane, eye, head shape.
2. **A readable race on a phone.** The phone is the primary screen for a first session (first-hour
   playtest). Evidence: overlays on the horses' band, 30-40 px horses (05 #7, #13).
   - Stage first: on phones nothing overlays the horses' band; the call goes under the stage.
   - Final furlong frames the battle, never a field of specks.
3. **Moments staged like the real paddock and winner's enclosure.** Foal, first win, photo,
   retirement each get a short, skippable staged moment built from existing assets (portraits,
   vignettes, finale slides). Evidence: 03 F5, F12; 2026-10-30 research §4 ("leading in").

## 3. UI visual language audit (every significant screen seen)

| Screen | Keep | Change (small) |
|---|---|---|
| Top bar (desktop/phone) | Brass pixel wordmark, wallet/credits pills, silks avatar | — |
| Landing | Four painted bands, brass CTA | When V-04 lands, the "its build" promise becomes visible; until then, consider rewording |
| Home (yard diorama with signposts) | The estate-as-map with labelled buildings is distinctive | At 1440 px the "Ready to race" card covers the led horse's head and neck (`images/pages-desktop-home.png`): shift the horse's focal point left or the card right so the player's horse is never hidden on Home |
| Starters (first run) | One brass action | Make the three starters visibly different (cloth/build/mane) before anything else, since this is the "meet your horses" moment |
| Stable (Ranch + list) | Own horses on the pasture, tags with leader lines, sort chips | Show the gate-independent "stable colour" on the pasture tag (silks chip) so tags match race chips |
| Race page | Racecard with saddlecloth tiles and plain-words explainer | Phone HUD (V-01); the long phone race page could start with the stage pinned (owner decision) |
| Result | Verdict first, Wilf, sealed/verify, share image | First-win staging (V-08) |
| Horse page, breeding, nursery, market, packs, hall, trophies, legacy | see the page tour in `images/pages-*` and 05 | Coat class tag and family line (V-07); foal reveal (V-06) |

General UI rules to adopt (all already mostly true):
- **One accent for actions** (brass), one for "yours" (gold ring/chevron), one for warnings
  (racing red). Do not add more accent colours with the cloth colours: cloth colours appear only
  on cloths, racecard tiles and HUD chips.
- **Programme typography:** pixel display font for titles and numbers only; the humanist sans for
  reading (as today).
- **No dashboard tiles on racing screens.** Numbers live in racecard tables and chips, not cards
  of KPIs.
- **Every picture means one thing** (graphics audit round 2 rule) — keep the page-scenes test.

## 4. What to avoid

- Imitating any competitor's style (3D realism, Sheep Meadow's look, anime race cut-ins).
- Camera shake, rapid cuts, zoom pulses (03 F11).
- Glow/fantasy coat traits (Rival Stars' "glowing mane"), paid cosmetics on horses (03 F6).
- Crypto-feeling UI on racing screens (tickers, price charts) — keep those on wallet pages.
