# Design QA pass + small polish fixes (new player, phone first)

App: local dev (`next dev -p 3107`, PGlite). Played as a brand-new player: founded a stable at `/play`, watched the "your first race" Story race to its result, then walked every tab (Home, Stable, horse page, Races, Story, Club → league/cup/hall, Market, Packs, Nursery, Facilities). Read against `docs/brand-and-design-v2.md` §4–§5 and `docs/art-direction.md`.

Viewports: 390×844 throughout; 1440×900 spot-check on home/stable/races/packs.

Before-screenshots: `scratch-qa/shots/` (uncommitted, names `NN-page[-sN].png`). After-screenshots: `/tmp/agent-workers/polish-1.png` … `polish-7.png`.

## Passed

- **Flow:** register → stall reveal → race now → live race → result → home works end to end on a phone, no console errors, no dead ends.
- **Pages:** all 12+ pages load at 390px, no horizontal scroll anywhere, every page has exactly one pixel title, banner scenes render on every tab.
- **Type/contrast:** pixel/serif roles are used consistently; meta lines stay at ≤3 facts; dark baize and paper tokens match the design doc.
- **Touch:** primary actions are the 52px brass buttons; chips and row links are ≥44px.
- **Empty states:** stable/roster, nursery, market and hall all have real empty states.

## Fixed (7 issues)

1. **Cosmetic, `/play` at 390px (first screen a new player sees):** the POST TIME wordmark appeared twice — once in the top banner and again inside the registration form header — so the brand shouted twice above the fold. Removed the form copy. Before: `scratch-qa/shots/02-play.png`. After: `polish-1.png`.

2. **Minor, floating ActionBar on phones (any page, e.g. race page "Watching…", welcome reveal):** when the bar floats, its scrim gradient only reached ~0.92 alpha at 30% height, so list content — and the 50%‑opacity disabled button's own text — read through the button's shadow zone. Scrim now hits 0.94 at 22% and is solid for the button's full height. Before: `scratch-qa/shots/04-race-live.png` (+ `_crop-actionbar.png`). After: `polish-2.png`.

3. **Minor, `/facilities` at 390px:** the Stalls progress bar rendered ~empty while its tag said "6 OF 24 STALLS" — the bar subtracted the free starting stalls from both value and max, wiping the fill and making the first buy look like level 0. Bar now shows the true 6/24 fill. Before: `scratch-qa/shots/21-facilities.png`. After: `polish-3.png`.

4. **Cosmetic, `/stable` roster at 390px:** the row meta `Colt · Front-runner · 1,050 m` wrapped between the number and the unit, leaving a bare "m" alone on line 2 ("1,050\nm"). The distance is now `whitespace-nowrap`, so it wraps as one readable unit. Before: `scratch-qa/shots/11-stable.png`. After: `polish-4.png`.

5. **Minor, Home "Your races" (inbox) at 390px:** unread-result lines truncated mid-sentence with "…" — "Hope Springs finished 2nd in the …" — hiding the race name, which the design says never to cut. Now wraps to two lines (`line-clamp-2`). Before: `scratch-qa/shots/10-home-s1.png`. After: `polish-5.png`.

6. **Minor, Home "On the course" live strip at 390px:** the live race name truncated ("Ashcombe Feature …"). Now wraps to two lines. Before: `scratch-qa/shots/10-home-s3.png`. After: `polish-6.png`.

7. **Minor, race result board + full result table at 390px:** podium stable names truncated ("Old Vicarage Stabl…") and the full-results horse name column could clip. Podium and table names now wrap (`line-clamp-2` / block link). Before: `scratch-qa/shots/08-race-end-s1.png`. After: `polish-7.png`.

## Noted, left for the lead (none blocking)

- **Minor, welcome reveal eyebrow at 390px:** "REGISTERED AT KESTREL DOWNS · 3,000 CREDITS · 10 / LIVE ENTRIES" wraps inside the last fact. Fix needs a small eyebrow meta treatment in the scene band component.
- **Minor, race HUD (race-viewer package) at 390px:** the standings chip over the canvas clips the margin figure ("2 Hope Springs 3" with the trailing stat cut). Ticker clipping at race end matches the earlier production-visitor note. Out of scope for this pass.
- **Cosmetic, race page sticky header at 390px:** the strip truncates the race name ("Ashcombe Club Maid…") — the strip is single-line by design; decide whether the race name deserves wrap or an abbreviated form.
- **Cosmetic, `/packs` sealed hash and `/cup` fingerprint hash at 390px:** hex strings `break-all` mid-hash; fine technically, but the cards may read better in a monospace token or collapsed by default.
- **Cosmetic, "Odds & pity ×" disclosure on `/races`:** the `×` glyph sits high in its line box at 390px.
- **Design note, desktop signed-out:** `/stable` and `/packs` show one large flat empty card with much dead space at 1440px; could use the yard illustration as the empty state.

## Checks

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 69 passed, 1 skipped.
