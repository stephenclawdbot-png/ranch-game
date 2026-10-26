# Post Time production bug bash (visitor, report-only)

Site: https://ranch-game-meowdotfun.vercel.app (alias works). Founding a stable is blocked: `/start` redirects to `/play`, which shows "Closed playtest, invite only". I did not test signed-in flows (stable, nursery, breeding, facilities, market, packs and Daily Cup entry), only what a visitor sees.

Screenshots are in `(local QA run, not kept)/`. Names are `m_*.png` (390px) and `d_*.png` (1440px).

## Passed
- **Pages:** all 20 URLs load at both viewports. These are home, stable, nursery, breeding, facilities, races, story, league, cup, hall, market, packs, `/club` (redirects to `/league`), pool, beta, start, play, me, invite and a 404.
- **Scroll:** no horizontal scroll at 390px on any page.
- **Branding and copy:** no "Thoroughbred", lorem ipsum, `undefined`, `NaN` or `null` found in visible text. I only read the pages for typos by eye, not exhaustively.
- **Live races:** I watched one live race on each viewport, from the card to the result.
  - The canvas rendered and every horse appeared.
  - The result showed only after the finish.
  - There were no console errors and no 4xx/5xx during the race, and the page stayed responsive.
  - While live, mobile showed only TV/LIVE and desktop showed only DIRECTOR/LEADER/WIDE/LIVE. The 0.5×–4× speed buttons appeared only after the finish.
  - Verify and "How sealing works" are present on the finished race page.
- **Banner scenes:** canvases appeared after scrolling on races, story, league, cup and hall. Rendering looked fine.

## Issues

1. **Minor, `/pool` at 390px and 1440px:** a visitor sees a console error and a failed request. `GET /api/pool/proof` returns 401 on every load. Expected: the page doesn't call an authenticated endpoint for visitors, or handles it silently. The page also never reaches network idle (my 45s `networkidle` wait timed out), so something polls continuously. Screenshot: `m_pool.png`.

2. **Minor, `/pool` at both viewports:** the live "This week" leaderboard on production lists internal test accounts ("Design Review Lodge" twice, "QA Bot 052607", "Preview Peek Lodge"), all with 0 points. Expected: test data is hidden from the public board. Screenshot: `m_pool.png`.

3. **Minor, `/story` at both viewports:** every chapter row says "None of your horses can race right now. Story races are free whenever one is ready." to a visitor with no stable. The page also shows a "No stable yet" panel. Expected: the per-race message says to found a stable, or the rows are hidden. Screenshot: `m_story.png`.

4. **Minor, `/races` at 390px:** on first paint the countdown badges and "closes in" text show a placeholder (`–:—`) until the page hydrates. Screenshot: `m_races_top.png`. This is brief, but it flashes visibly.

5. **Cosmetic, race viewer at 1440px, finished race `Kestrel Downs Handicap (50-75)`:** the finish-order ticker over the canvas is clipped on the right, and "7 Midnight Promise" fades out. At 390px the ticker also cuts off "Morning Crown". Expected: the ticker wraps or scrolls, or the cut-off is visibly intentional. Screenshots: `d_race_end.png`, `m_race_end.png`.

6. **Cosmetic, 404 page at 390px:** the pixel-font heading "Not on the card" renders the "c" so it reads "oard". This is likely a font glyph problem. Screenshot: `m_does_not_exist.png`.

7. **Cosmetic, `/nursery` at 1440px, plus `/facilities` at 390px:** the console shows a warning that a CSS file was preloaded but not used within a few seconds. This comes from Next preload tags. It is harmless but noisy. The crawl log didn't record which page-and-viewport pair each warning came from.

8. **Cosmetic, `/hall` at both viewports:** the "Record times" section is a long list of 20+ seeded records above three empty states (Inductees, Champions, Season winners, Famous bloodlines). Expected: the empty states are first or the records are collapsed. This is a design note, not a defect.

## Not reproduced
- Race results appearing early (none seen).
- A fast-forward control while live (none seen).
- Overlapping text, or empty panels without a loading or empty state (every empty panel I saw had an empty-state message).
