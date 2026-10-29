# Handoff / resume notes (lead)

Read this first when resuming. The branch is `claude/thoroughbred-demo`. `main` gets updated
only at tested milestones, because main auto-deploys to Vercel production.

Preview URL: https://ranch-game-git-claude-thoroughbred-demo-meowdotfun.vercel.app
(Vercel project `ranch-game`, team `meowdotfun`; Neon is connected with `DATABASE_URL` for
Preview and Production.)

## Start here in a new session (2026-10-26)

- **How we work now:** read [`docs/AGENT-PIPELINE.md`](AGENT-PIPELINE.md). The Claude session is
  the lead. New hands-on work goes to Ollama Cloud workers: `glm-5.3` for code, `kimi-k3` for
  design, since Kimi can see screenshots. **Tell the owner the plan and wait for "go" before
  starting new work, and for "ship" before updating `main`.**
- **Keys** come from the environment settings (`OLLAMA_API_KEY`, `PIXELLAB_API_KEY`, optionally
  `ANTHROPIC_API_KEY`), never from the repo or the chat.
- **Production** (`main` = `5dabac1`, 2026-10-28; the branch is ahead with metrics, the MetaMask fallback and coat v2, not shipped yet):
  - Post Time rebrand and Design v2;
  - HD-2D diorama scene bands, including the barn with horses leaning out over the stall doors;
  - **Trackside** as the default race view;
  - the horse registry;
  - QA fixes.
- **Owner picks** on [`docs/economy/AUDIT.md`](economy/AUDIT.md) are all recorded now (§6 rows
  and §7): premium foals stay tradeable, no extra limits; pool 10 % + a fixed ~$40/week
  top-up; affiliates unchanged; the four beta fixes done (2026-10-26); **the beta runs 4
  weeks** (2026-10-27, see the Prize Pool section below).
- **Open, smaller:**
  - public boards list test accounts: run the `/admin` reset before testers arrive (owner's
    call on timing: it wipes production and preview);
  - check Trackside and the dioramas for fps on a real GPU and phone;
  - **owner (2026-10-26): "Going down to post" is too long, make it a bit shorter.** Fixed
    (worker/post): entries now close at post − 30 s (`ENTRY_CLOSE_BEFORE_MS` in game-core,
    `RULES.entriesCloseBeforePostMs` reads it), so the gap to "Gates loading" (last 10 s) is
    ~20 s. "Give the wait something to watch" stays open as an idea;
  - Trackside has no dun dorsal stripe: `HorseAppearance` carries no dun gene (add it to
    the shared appearance if wanted).
- **Parked ideas:** the hangout plot (`docs/roadmap.md` Phase 5); Grok for X marketing only, not
  the pipeline.

## Coat v2, sister courses, My races, race queue, follow cam (lead + workers, 2026-10-29)

- **Coat colours v2 (merged, Kimi):** `HorseAppearance.colour` (optional: base, cream 0–2,
  dun, roan, grey stage, sabino 0–2) is filled by `appearanceOf`; every renderer resolves it
  through `coatPaletteOf` (art-pipeline) to the lead's anchors in
  `docs/brand-v2/coats/coat-anchors-v2.png`. Roan ticks over the horse's own colour, the dun
  stripe uses the palette's stripe colour, two-cream coats get a pink muzzle and blue eye.
  Appearances without `colour` (old replays) render exactly as before. Review page:
  `/dev/coats`. Next: sabino white patterning (ticket written: legs, belly splash, blaze;
  max sabino mostly white).
- **Owner (2026-10-29): overflow races must not sound like tiers.** When a Live race is
  nearly full a **sister course** opens: the same race at the same time at another of the six
  courses (`live:<index>:<n>`, own seed commitment). Never "division".
- **Quick Join** prefers races with real players, and falls back to a **race queue** (until the
  player's local midnight; the entry is charged only on a match; first come, first served;
  matched on every `driveCard` and by the cron).
- **My races** (`/me/races`: filters by horse, Live or Story, wins; summary line) and replay
  share links that open on the finish (`/race/<id>?at=finish`; ignored before the race
  ends, so no spoilers).
- **Follow my horse:** a "Whole field" or "Follow mine" toggle in Trackside.
- Status: sister courses and My races run on GLM, follow cam on Kimi; the queue starts after
  sister courses are merged; sabino after the follow cam (both change the Trackside shader).

## Prize Pool: rate scoring, 4 active days, $10 cap; beta is 4 weeks (worker/econ1, 2026-10-27)

Owner approved the audit's recommendation 3 (AUDIT §6 rows marked done 2026-10-27):

- **Rate scoring** in `betaMoney.poolScores`: points per Live run × 15 at full weight from
  8 runs (weight `min(1, runs/8)` folds into the divisor `max(runs, 8)`, integer maths,
  rounded down) plus the mean of the best 3 Daily Cup days × 5 (fewer Cup days count as 0).
  Per-run points keep the league table (`leagues.runPoints`, new shared helper); the weekly
  points cap no longer applies to pool scoring. 0 Live runs scores from the Cup term only.
- **Rules**: `minActiveDays` 3 → 4, `capUsdCents` $20 → $10 (admin compute form prefills
  10/4 too). Premium-pulled horse exclusion unchanged (owner: foals stay tradeable).
- `/pool` rules copy and the `docs/web3.md` scoring rows say it in plain words.
- **Owner decision (2026-10-27): the beta runs 4 weeks** (AUDIT §7 records it; the
  beta-length question is closed).
- `tools/economy-sim` mirrors updated: `current` = the rate formula, `volume` = the old
  capped formula kept for comparison. **Not rerun** — this worktree has no `tsx`, and the
  sim's `checkSync` has a pre-existing daily-goals error (goals are paid since 2026-10-26
  but `GOALS_IMPLEMENTED` is still false). `docs/economy/results/` is still the 2026-10-26
  audit run; recalibrate and rerun before the next economy decision.

## Accounts across devices, wallet sign-in, shorter post wait, design pass (2026-10-26, later)

- **Device linking** (`packages/db/src/services/devices.ts`, `/me` card, `/link`): one-time
  `XXXX-XXXX` codes (10 min, single use via conditional UPDATE, hashed), extra device tokens in
  `account_devices`, list/revoke, 20 failures/IP/hour → 429, replace guard for browsers with progress.
- **Wallet sign-in** (`apps/web/src/server/walletAuth.ts`, `/api/auth/wallet/*`, `WalletSignIn`):
  SIWE login challenges (`wallet_challenges.purpose = 'login'`), real signature checks even with the
  mock chain, login wallet = `accounts.wallet_address`; signs in, links, or founds a stable; 18+
  checkbox. WalletConnect (`@walletconnect/ethereum-provider` 2.26.0, lazy) shows only when
  **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`** is set in Vercel (owner: create it at cloud.reown.com).
  Founding a stable with a wallet asks for a second signature (the first nonce is consumed).
- **Going to post:** `ENTRY_CLOSE_BEFORE_MS` 60 → 30 s (db rules read it); stored races keep theirs.
- **Design pass** (Kimi): see `docs/qa/2026-10-26-design-pass.md` (7 fixed, 6 noted for later).
- e2e `apps/web/e2e/beta-polish.mjs` passes on the merged branch.

## Beta economy picks, daily goals, genetics, race markings (lead + Ollama workers, 2026-10-26)

Owner picks on `docs/economy/AUDIT.md`: pool **10 % + fixed ~$40/week top-up** (deploy default
`poolBps` 1000; checkout no longer sells the pot); **premium foals stay tradeable, no extra
limits** (against the audit: recorded in the economy skill and `docs/web3.md`, flag in legal
review); **affiliates unchanged** (10 % / 3 %); all four beta fixes done: Epic pity 20, Story races
don't use career starts or the record, market ceiling 3× appraisal + 72 h resale lock, daily
goals (race / care / Daily Cup, 60 credits each, paid in the action's transaction, key
`daily-goal:<account>:<localDate>:<goal>`, table `daily_goals`, card on Home). Beta length:
**the beta runs 4 weeks** (owner decision 2026-10-27).

- After a race on phones the fresh result scrolls into view and "Race X again" floats above the
  tab bar (`.fade-up` now fills `backwards`: a held transform trapped `position: fixed`).
- Countdowns render real time on first paint (no "–:––" flash).
- **Genetics** (`gc.geneticsSummary`, never sends ability alleles, vigour, aptitudes or unrevealed
  quirks; unit-tested): Genetics section on horse pages, one-line `genetics-line` on stable,
  nursery, packs and foal reveal.
- **Trackside markings**: per-runner leg (coronet/sock/stocking) and face marks, roan ticking and
  dapples, from a derived mask strip + LUT flags (`strips.ts buildMarkMasks`).
- Ollama Max has a **session usage limit** (hit after ~8 worker runs incl. 3 parallel; resets
  in a few hours). Run at most 2 workers at once and keep tickets small.

## Viewer polish: ticker, phone crowding, starting stalls (lead + Ollama workers, 2026-10-26)

Branch `claude/intelligent-ride-rkrz3i` (from `8fa8146`); not yet on `claude/thoroughbred-demo`
or `main`.

- **Standings strip** (GLM; lead fix): whole chips only plus a "+N" chip, measured in the
  browser (`fitCount` in `hud/Hud.tsx`, unit tested). The leader and the highlighted horse
  always show; on narrow stages names ellipsize (60 px) so leader + me + "+N" fit at 390.
  Mask fade and horizontal scroll removed. Closes QA #5.
- **12 runners on phones** (Kimi; lead tuning): `crowding(W, runners)` in `trackside/layout.ts`
  (0 on wide stages or ≤ 8 runners, so desktop and small fields are byte-identical) adds lane
  falloff, crane height and a 75 % readable-size floor. `FieldLayout.k` carries the falloff;
  horses, ground, props and the gate use it. **Decision (flag):** phones get a ~1:1 stage
  (`min(w × 1.05, 48 % of the screen)`) on the race page and the Cup run screen (was 0.82 ×
  and 0.62 × width). 390×844, 12 runners: horses 40–55 px, the most-covered horse 20–40 %
  visible (was 7–20 %). Harness: `/dev/viewer?h=<px>` sets the stage height.
- **Starting stalls** (Kimi; lead fix): `trackside/gate.ts`, one open bay per lane (no truss or
  number board, low rails so every jockey shows), world-anchored at the start, doors swing
  open over 0.22 s at the off. Art: `art-src/race/gen-stalls.mjs` (2 PixelLab generations) →
  `art-src/finish-stall.py` → `public/art/race/starting-stall{,-front,-door}.png`. Thin parts
  use their own LOD (they stop at 2:1).
- One `apps/web` vitest run failed once and passed on four reruns (name not captured);
  watch for a flaky test.
- **Pipeline notes:** `glm-5.3` crashes if it Reads a PNG (text-only), so tell it not to open
  screenshots and to report measurements instead. Kimi's first passes needed lead review
  both times: it met the numeric criteria but missed the look, so always check its
  screenshots.

## Trackside race view (race-viewer agent, 2026-10-26)

Owner decision: the **Trackside** view (the "track-dusk" diorama look applied to the real
race) is the **default race view** everywhere the viewer runs (Story, Live, replays, Daily
Cup). The classic 3D broadcast stays one tap away: the **3D view / Trackside** button in the
viewer controls, or `?view=classic` (`?view=trackside` forces Trackside); the choice is
remembered in `localStorage["rv:view"]` (try/catch guarded). Code: `packages/race-viewer/src/trackside/`
(see the race-viewer README "Trackside view"). No apps/web changes were needed: the viewer
reads `?view=` itself, and `data-testid="viewer"` still holds a canvas.

- Three.js screen-space layers (orthographic): baked diorama backdrop (sky, hills, trees with
  DOF blur + haze, rails), perspective world-anchored turf/dirt with the winning line and
  motion blur, furlong poles + winning post, horses from palette-index strips + per-runner
  LUT (real coat and silks colours and pattern) with normal-map rim light and exact
  palette-preserving LOD copies, hoof dust, motes, light shafts, rain, grade, photo flash.
  Dusk by default; clear daytime posts = golden hour; overcast/rain dim and desaturate.
- **All runners visible on every frame** (`layout.ts`, unit tested): springs ease zoom
  (resting on a pixel-perfect ladder) and centre to fit leader..last horse between a
  close-up cap and a minimum readable size; `placeField` hard-clamps the zoom for the lanes
  and squeezes the gaps behind the leader when the field is wider than the frame (order kept,
  props and the winning line squeezed the same way). Verified per frame with the
  `window.__rvTrackside.rects()` dev hook (`debug` or `?rvdebug`).
- Screenshots / GIFs: `docs/brand-v2/trackside/`.
- **Decisions taken without the user (flag):** golden hour for clear races with a local post
  hour 7–16 (dusk otherwise); minimum readable horse length = 14 % of the stage width
  (84–180 px), close-up cap 34 %; strung-out fields are squeezed rather than shown tiny (the
  minimap and standings keep the true gaps); the camera buttons are hidden in Trackside (the
  framing is automatic); no PiP in Trackside (everyone is always in frame).
- **Open:** real-device fps check (headless numbers are SwiftShader); the idle strip is used
  before the off, so the field stands stacked at the start (no stalls prop yet).

## HD-2D dioramas (diorama agent, 2026-10-26)

`<Diorama scene="yard" | "paddock" | "grandstand" | "barn" | "track-dusk" />` in
`apps/web/src/components/diorama/` (harness: `/dev/diorama`, `?scene=`, `motion=still|live`,
`quality=low`, `h=<px>`). Live in every page-kit scene band (`SceneBand` → `DioramaSlot`:
stable→yard, barn→barn, grandstand→grandstand, paddock→paddock), so Home, /stable, /races and
the Club/Story/Facilities bands are animated.

- **Renderer:** Canvas2D, not three.js (apps/web doesn't depend on three and the lockfile is
  shared). Layers are baked once (DOF blur, aerial haze, bloom); per frame it is a few
  drawImages, sprites at integer scale with nearest filtering, rays/motes/grade on top. Picks
  ~720 art px across (integer device px per art px), splits the scale into backing × CSS
  upscale to cap the backing store; drops to the light path (art-res backing, no bloom) if it
  runs < 40 fps. Pauses offscreen and when hidden; still frame under reduced motion; SSR shows
  the poster `<img>` (`public/art/diorama/poster-*.png`), which also stays if anything fails.
- **Scenes** are data (`scenes.ts`): layers with depth/blur/haze/bloom, items (y = bottom
  edge), anims (walkers, grooms, stall heads, flags), rays, motes, grade, `focusY` for short
  bands. Horses recolour from `race/palette.json` keys (`recolor.ts`).
- **Art pipeline:** `art-src/diorama/gen-diorama.mjs` (PixelLab jobs) → `process_diorama.py`
  (clean, mirror-tile, 2:1/3:1 palette-snapped downsamples, holes/props → `atlas.generated.ts`)
  → `make-posters.mjs` + `finish-posters.py` (needs a dev server) → `register.py` (manifest)
  → `node apps/web/scripts/art-index.mjs`.
- **Polish pass (owner feedback):** sprites marked `lod` swap to exact 2:1/3:1 copies so the
  walking/galloping horses always fit the band with headroom (`frame.ts` `computeFrame`,
  shared with the poster `<img>`, which is now placed at the same integer scale as the
  canvas). Stall horses lean OUT over the half-door (head, neck, chest; coats recoloured in
  code) in front of lit stall interiors (hay net, straw, light); a full-body horse idles in
  the barn aisle when the band is tall enough. Ground tiles are min-cut quilted (no mirror
  seams). `track-dusk` is the race page's pre-race backdrop (`PreRace` in RaceExperience).
- Screenshots / motion GIFs: `docs/brand-v2/diorama/`.
- **Follow-ups:** real-device fps check (headless numbers are software-rendered); more
  variants (time of day, weather); a groom grooming the aisle horse (one PixelLab attempt
  didn't take).

## POST TIME rebrand + Design System v2 + horse registry (design agent, 2026-10-26)

User decisions: the game is now **POST TIME** (user-facing everywhere; internal packages stay
`@thoroughbred/*`); the home racecourse stays **Kestrel Downs**. Implemented the "racecard at
golden hour" Design System v2 from `docs/brand-and-design-v2.md` (§4 spec, §5 checklist, §6
order). Commits: "Horse registry…", "Design v2: tokens…", "Design v2: copy pass and page-by-page…",
"Design v2: polish…".

- **Brand files** (`apps/web/public/brand/`, generated by `apps/web/scripts/brand/wordmark.py`,
  integer grid, nearest-neighbour only): `post-time-wordmark.svg` (+ `@1x…@8x.png`; the O is a
  brass race stopwatch, hand at the off), square marks `post-time-mark.svg` (32) and
  `post-time-mark-16.svg`, `icon-16/32/192/512.png`, `apple-touch-icon.png` (32×5 on a 180
  canvas), `og.png`. App-router files: `app/icon.svg`, `app/apple-icon.png`,
  `app/opengraph-image.png`, `app/twitter-image.png`, `app/manifest.ts`. Metadata title
  template `%s · Post Time`.
- **Design system** (`apps/web/app/globals.css`): materials as scopes that re-point the role
  colours (`text-cream` = main text: cream on baize, ink on paper), so every legacy class
  works on both. Paper cards are a pixel 9-slice (`--fr-paper`, notched corners, hard 4-px
  drop); the hero is `--fr-hero` (the one brass ring). One tab style (`.tabs`, also used by
  the legacy `.segmented`), filter chips (`.fchip`), tags (`.tag-*`), status dots, `.well`
  for pixel art, `.track-tile` (race rows), `.meter`, `.pip`, date blocks, rosette grid.
  Pixel display font only for the page title (`.t-page`, 32/48); `.t-display-m/-l` are now
  Nunito (`.t-h2`, `.t-hero`).
- **UI kit** (`src/components/ui/Page.tsx`): `SceneBand` (full-bleed PixelLab scene at 1×/2×/3×,
  **`data-slot="diorama"`**: the HD-2D diorama agent swaps the `<img>` for `<Diorama/>` there;
  Home = full hero band, Stable/Races = banners), `PageHeader`, `Section`, `HowItWorks`,
  `EmptyState`. `ActionBar` is now one element that sits in the hero and floats above the tab
  bar on phones only when the hero spot is off screen (labels always agree; never a copy).
  `HorseNameInput` + `useHorseNameCheck` (live name checks).
- **Pages:** every page got the v2 pass (scene bands per area: Home/Facilities = stable yard,
  Stable/Nursery/Breeding/horse = barn, Races/Hall = grandstand, Club/Market/Packs = paddock).
  Rules moved into "How it works" disclosures; empty states with a next step; no disabled
  primary buttons; Feedback moved from the top bar to `/me` (+ a floating "?" on `/beta`);
  `/pool`, `/invite`, `/beta` left the Club sub-nav and are linked from Profile → "Beta &
  wallet" (collapsed unless a wallet is linked or you're a tester). `/invite` copy softened
  ("Invite friends to the beta, and earn a share when they buy packs"; levels and
  percentages in a disclosure). The race viewer is unchanged; only its page chrome moved.
- **Art:** 64-px portrait thumbnails (`public/art/portraits/thumb/`, exact 2:1 box downsample,
  `scripts/make-thumbs.py`); PixelLab pack art `ui/pack-paddock.png`, `ui/pack-premium.png`
  (`art-src/gen-packs.mjs`, 20 subscription generations, $0 credit).
- **Horse registry** (migration **0006_horse_registry**, additive):
  - `horses.reg_no` from sequence `horse_reg_seq` (column default, so old code paths get one),
    backfilled in creation order, unique. Shown as `G<generation>-<reg_no 5+ digits>` (game-core
    `registrationNumber`) on the roster, horse page, pedigree and onboarding.
  - Names: game-core `validateHorseName` (2–18 characters incl. spaces, letters/space/'/./-,
    starts with a letter, small local profanity list with a Scunthorpe allow-list).
  - Uniqueness (db `services/naming.ts`): a name is taken while any horse **not on the Legacy
    Farm** carries it (horses never die here, so a Legacy Farm Legend frees its name), and
    **Hall of Fame names are retired forever**. Enforced transactionally under a per-name
    advisory lock (not a unique index: production and preview share the DB, old code still
    inserts, and historical duplicates are grandfathered). Player-chosen names (foals,
    renames before the first start, starters renamed on the welcome screen) get
    `NAME_TAKEN` / friendly `INVALID_INPUT`; system names (starters, packs, Club horses) take
    a free deterministic alternative. `GET /api/names/check?name=` for live checks.
- **Decisions taken without the user (flag):** "living" = not on the Legacy Farm; existing
  duplicate names are grandfathered; the DB still allows 1–32 characters; the profanity list
  is deliberately small; the Story entry form stays on `/races` (the smoke e2e drives it)
  under a "Race the Club now" section; pack art chosen from 4 PixelLab variants each.
- **e2e changes:** feedback is sent from `/me`; the foal is renamed to a random unique name;
  breeding asserts there is no *enabled* Cover button for an ineligible pair; Premium "coming
  soon" is a line of text, not a disabled button. Web test foal renamed "Dawn Chorus".
- **Verified (2026-10-26):** `pnpm -r typecheck` green; `pnpm -r test` green (racing-engine's
  60 ms perf test is flaky only when run during a build); production build green; all six e2e
  scripts PASS against `next start` (fresh PGlite, `ALLOW_TEST_FIXTURES=1`; playtest and
  beta-money on `PLAYTEST_MODE=1` servers). Screenshots of every page at 390×844 and
  1280×800 plus before/after sheets were taken (see `docs/brand-v2/v2-before-after.png`).
- **Open:** the remaining sloppiness risks are the race viewer's control row (still monospace
  caps; the viewer is out of scope), admin pages (lighter touch), and pages whose bands now run
  the live diorama (owned by the diorama agent). Loading states use stepped paper skeletons
  (`.skel`).

## Beta money on Robinhood Chain (web3 agent, 2026-10-26)

User decision: the closed beta sells Premium Packs for **real ETH on Robinhood Chain**; **30 %
of every sale funds an on-chain Prize Pool** paid weekly by skill rank; **2-level affiliates**
(10 % / 3 % from the treasury's share, owner at the root). Credits stay non-convertible.
Full design, safeguards and owner steps: **`docs/web3.md` §0**.

- **Contracts** (`packages/contracts`, 110 tests, 100 % lines): `PrizePool` (no withdraw/sweep;
  `total ≤ maxEpochBps × free balance`; per-account cap; vesting; revoke/cancel/expiry back to
  the pool) and `PremiumStore.purchaseWithEth` (EIP-712 `EthQuote`, exact wei, pool share,
  affiliate commissions, treasury fallbacks, optional Chainlink check). ABIs + bytecode are
  exported to `apps/web/src/lib/chain/contracts.generated.ts` (`export:web`).
- **DB** (migrations **0004_beta_money**, **0005_affiliates**): verified wallet on `testers`
  (`wallet_verified_at`, unique when verified), `wallet_challenges`, `chain_orders`,
  `pool_epochs`, `pool_allocations`, `referrals`, `referral_earnings`, `invite_codes.kind/owner_account_id`.
  Money tables survive the playtest reset; `referrals` is wiped with accounts. Services:
  `services/betaMoney.ts`, `services/affiliates.ts`; `pullPack({prepaid})` for paid pulls.
- **Server** (`apps/web/src/server/chain`): median ETH/USD (`price.ts`), adapter (mock + viem),
  SIWE (`wallet.ts`), checkout (`checkout.ts`), pool (`pool.ts`), affiliates.
  APIs: `/api/wallet{,/challenge,/link}`, `/api/checkout/{quote,confirm,orders}`, `/api/price`,
  `/api/pool{,/proof}`, `/api/referrals`, `/api/cron/chain` (vercel.json, daily),
  `/api/admin/{chain,chain/owner,pool,pool/[id],affiliates}`. Signup records the referral.
- **Pages**: `/pool`, `/invite`, `/admin/chain`; admin tabs **Prize Pool** and **Affiliates**;
  wallet link on `/me` and `/beta` (unsigned address kept only as an unverified fallback);
  ETH checkout on `/packs` (only when `WEB3_ENABLED=true`).
- **Tests**: contracts `pnpm --filter @thoroughbred/contracts test`; db `beta-money.test.ts`;
  web `src/server/chain/*.test.ts` (mock chain) and **`pnpm --filter @thoroughbred/web test:chain`**
  (real Hardhat node: deploy → quote → buy → confirm → pool +30 % / L1 +10 % / L2 +3 % →
  backstop → epoch → claim); browser e2e `apps/web/e2e/beta-money.mjs`.
- **Owner must do** (nothing is deployed): dedicated `QUOTE_SIGNER_PRIVATE_KEY` +
  `ROBINHOOD_RPC_URL` + `CHAIN_ID=46630` in Vercel → `/admin/chain`: deploy from your wallet
  (a little testnet ETH) → paste `WEB3_ENABLED=true`, `PREMIUM_STORE_ADDRESS`,
  `PRIZE_POOL_ADDRESS` into Vercel (Preview first) → verify your wallet on Profile and claim the
  owner root → weekly: Admin → Prize Pool → compute → post. Mainnet only after counsel.
- **Decisions taken without the user (flag):** horses from Premium Packs don't score for the
  pool; pool score = league race points (weekly cap) + Daily Cup points; top 10 paid by linear
  weights, 25 % of the free pool per week, $20 cap, $0.50 dust floor, 14-day vesting, 56-day
  claim window, 6-day minimum epoch interval, on-chain max 50 % of the free pool per epoch; no
  sweep function at all; poolBps bounded 10–50 %; premium pack $4.99; blocked countries BE, NL
  (to confirm with counsel); affiliate weekly cap $50 and 250-credit activity reward; the owner
  is exempt from link checks; personal referral codes never re-link orphan testers after a reset.
- **NAV suggestions** (nav is the release agent's): `/pool` and `/invite` under Club (already
  present in the Club sub-nav), `/admin/chain` linked from the admin Prize Pool tab.

## Release: Phase 1 wiring + closed playtest (release agent)

**Status:** every Phase-1 feature is wired into one product, and the closed-playtest layer is
in. `pnpm -r typecheck`, `pnpm -r test` and the production build are green. All five e2e
scripts pass against a local production build (`next start` with PGlite).

- **Navigation:** five destinations: Home · Stable · Races · Club · Market. Phones get a
  bottom tab bar; desktop gets text tabs in the top bar. Each area's index screens share a
  one-row sub-nav (`SECTIONS` in `src/components/SiteNav.tsx`):
  - Stable: Horses / Nursery / Breeding / Facilities;
  - Races: Race card / Story;
  - Club: League / Daily Cup / Hall of Fame / Prize Pool / Invite;
  - Market: Horses for sale / Packs.

  Detail pages are the second and last level. `/club` redirects to `/league`. The top bar has
  a Feedback button.
- **Home "Today" tiles:** `GET /api/home` (`src/server/home.ts`) drives them, in this order:
  Daily Cup (countdown, entrants, your rank or "Take your Cup Run (+80)"), the gift foal,
  "Care today: n horses", free Paddock Pack, mare ready to foal, next Story chapter race
  (and a mare in foal). The hero action is unchanged.
- **Horse page:** "Plan a cover" (eligible mare), "Stand at stud", "Sell" (tradeable),
  pedigree names with links, and a "Plan a cover with…" card for horses standing at stud.
  The nursery empty state links to Packs and Breeding. A foal's roster row shows "Care"
  instead of a disabled "Race".
- **Gaps fixed:**
  - **Seller policy:** `sellerPolicy()` in `packages/db/src/rules.ts` is env-configurable:
    - `MARKET_REQUIRE_VERIFIED_EMAIL` (default **off**: there is no email flow);
    - `MARKET_SELLER_MIN_ACCOUNT_DAYS` (7);
    - `MARKET_SELLER_MIN_RACES` (20).

    The UI lists only the requirements that apply.
  - **Club house stallions at stud:** `services/houseStuds.ts`:
    - there are always 4 available;
    - genomes are deterministic (serial n) at the season's launch ceiling (common, uncommon
      or rare), with fees of 250, 400 or 700;
    - they are owned by the Club and racing-retired, so they never fill Live fields;
    - the normal breeding rules apply (4 per lifetime). Exhausted stallions go to the Legacy
      Farm and the next serial replaces them;
    - fees go through the ledger: the base fee and 10% of the stud fee are burned, and the
      rest goes to the `treasury` system account.
  - **Vet level:** race settlement now passes each owner's vet facility level (it was `0`).
  - **Day-2 gift foal (§10):** `services/onboarding.ts`, granted on `/api/me` from the
    account's second UTC day:
    - it is a bound game-core `createGiftFoal`;
    - it is idempotent through the inbox dedupe key `gift-foal` and the stable lock;
    - it uses a free stall or the nursery overflow slot, and waits when neither is free;
    - the grant is audited.
  - `tsconfig.json`: the `.next-*` include is removed. Note that `NEXT_DIST_DIR=... next
    build` re-adds it, so revert it after local QA builds.
- **Closed playtest** (the lead's brief). Migration **0003_playtest** (additive):
  - **Tables:** `invite_codes`, `testers`, `tester_rewards`, `feedback`, `telemetry_events`,
    `beta_reward_rules`, `beta_rewards`. Services are in `packages/db/src/services/playtest.ts`.
  - **Invite gate:** with `PLAYTEST_MODE=1`, `POST /api/account` needs `inviteCode`.
    - `/play` shows an invite-only screen; `?invite=CODE` prefills and checks the code.
    - The tester cap is `PLAYTEST_TESTER_CAP` (60).
    - Code validation lives in `redeemInvite` / `checkInvite`. The web3 agent extends it for
      referral codes.
  - **Feedback:** a top-bar button on every page opens a dialog (category, optional rating,
    message). It attaches the route, viewport, user agent and recent client errors.
    `POST /api/feedback` allows 10 per sender per hour.
  - **Telemetry:** first-party, stored in our database, with routes only. Events:
    session_start, page_view, race_watched (client, `POST /api/events`), plus signup,
    race_entered (live, story or cup), care, train, breed, foal, pack_pull and market_*
    (server).
  - **`/beta` (testers):**
    - progress (days played, feedback, accepted bugs);
    - wallet address, EVM-validated and stored on `testers` so it survives the reset;
    - tester bonuses and their payouts, with tx links to `ROBINHOOD_EXPLORER_URL`;
    - a link to `/pool`.

    The weekly prize computation is the web3 agent's on-chain Prize Pool. Only the manual
    fallback payout ledger is here.
  - **`/admin`** (`ADMIN_SECRET`, sent in the `x-admin-secret` header or through the login
    form, which sets the httpOnly `tb_admin` cookie):
    - tabs come from the registry `src/components/admin/sections.tsx`;
    - Metrics: day-1 and day-7 retention, funnel, daily actives, sessions, races per day;
    - Invites: bulk generate, copyable links;
    - Testers;
    - Feedback: filter, resolve, "accept as bug" creates a pending bounty;
    - Payouts (manual): rules, approve, void, paid with a tx hash, CSV, budget against
      `BETA_BUDGET_USD`;
    - Reset: type `RESET PLAYTEST` to confirm; it is idempotent. It wipes `RESET_TABLES`
      and keeps testers, wallets, codes, feedback, telemetry and rewards. Testers re-join
      with their own code.
- **Env to set on Vercel:**
  - `PLAYTEST_MODE=1` and `ADMIN_SECRET` (secret, 12+ characters).
  - Optional: `PLAYTEST_TESTER_CAP`, `BETA_BUDGET_USD`, `ROBINHOOD_EXPLORER_URL`.
  - The `MARKET_*` variables keep their defaults.
  - `CRON_SECRET` as before.
- **e2e:**
  - `smoke`, `economy`, `horse-life` and `competition` run against `next start` with
    `ALLOW_TEST_FIXTURES=1`, which lets the seller fixture run locally; it is never allowed
    on Vercel.
  - `playtest.mjs` needs `PLAYTEST_MODE=1 ADMIN_SECRET=...` and resets that server's
    database.
  - `beta-polish.mjs` (daily goals, post-race phones, Story starts, genetics, pity,
    standings) runs against a plain dev server (`npx next dev`, PGlite).
- **Decisions taken without the user (flag them):**
  - verified email is off by default for selling;
  - the house stallion roster and fees: 4 stallions at 250, 400 or 700, with the fee share
    going to the treasury;
  - the gift foal arrives on the account's second UTC day, granted lazily on `/api/me`;
  - Club is the `/league` landing page;
  - testers re-join after a reset with their own invite code. Accounts are wiped, the tester
    record is kept;
  - a reserved but unlinked tester is re-claimable after 10 minutes;
  - `/beta` shows only the manual bonus rules (bug bounty, best feedback). The seeded
    participation, weekly and cup rules stay in the table, unused, for the Prize Pool to
    replace.
- **QA bug list.** The release agent found and fixed all of these:
  1. **PixelLab art missing on Vercel.** Functions can't read `public/`, so `listArt()` came
     back empty and every portrait, scene and icon fell back to code drawing (the flat
     side-view head). Fix: a build-time `src/lib/art.index.json` (`scripts/art-index.mjs`,
     run by `pnpm build`), with a test that it stays in sync and that every coat maps to a
     3/4 portrait.
  2. The feedback dialog was trapped under the mobile tab bar (the header's stacking
     context). It now renders in a portal.
  3. Phone content hid behind the sticky action bar plus the tab bar, e.g. the "Care today"
     tile. Fix: `main:has([data-action-bar])` bottom padding.
  4. The race stage on phones was short and the director cut to tiny-horse aerials. Fix:
     the stage is now up to `min(82vw, 48vh)` and `Director.compact` avoids aerials on
     phones.
  5. The horse page showed raw sire and dam UUIDs. It now shows names with links.
  6. Foals were described as "0-year-old" and their strengths were graded from a growing
     foal's low stats. Both are reworded.
  7. Foals showed a disabled "Race" button in the roster. It now says "Care".
  8. A double period in the trip-bands caption.
  9. Selling was impossible because of the email requirement with no email flow (now
     configurable).
  10. The stud book was empty (house stallions added).
  11. The vet level was ignored at settlement.
  12. The site description said "Six horses" (starters are 3).
  13. A smoke e2e locator became ambiguous when two of your horses ran in one race.
  14. The test-seller fixture couldn't run on a local production build (now
      `ALLOW_TEST_FIXTURES=1`, never on Vercel).
  15. The `/pool` prefetch from `/beta` was a 404 (prefetch is off until the page ships).
  16. Non-testers saw the beta rules list.
- **Known issues / follow-ups:**
  - `/pool` and `/invite` are linked from the Club sub-nav. They 404 until the web3 agent
    ships them.
  - The race viewer's director and stage are being reworked by the viewer agent. The release
    agent added `Director.compact` (no aerials on phones) and a taller phone stage.

## Done (committed)

- **Engine:** `packages/racing-engine` v1.1.0, deterministic, with a balance pass.
- **Live broadcast:** no spoilers. See `apps/web/src/server/live.ts` and
  `src/lib/liveRaceFeed.ts`.
- **HD-2D viewer:** `packages/race-viewer` (Three.js). It has a live-feed mode, broadcast
  framing and the HD pass.
- **Pixel rig:** `packages/pixel-rig`, opt-in with `?rig=1`. It needs a real-GPU check
  before becoming the default.
- **Art:** the PixelLab HD art drop is in `apps/web/public/art` (manifest with 149
  entries).
- **Redesign:** `apps/web` redesigned from `docs/design-research.md`: Home, Story Quick
  Pick, stable roster, horse page, race page, staged results, `/me`.
- **Game rules:** `packages/game-core` (160 tests). Genetics with a vigour locus, career
  clock (40 starts), condition, training, ratings, breeding, packs, ledger, economy, stable
  entries, seasons, Daily Cup, leagues, social.
- **Docs:** `game-design.md` (§4a–4f decisions and §12 deviations), `balance.md`,
  `roadmap.md`, `art-direction.md`, `design-research.md`, `architecture.md`.

## In flight when budget ran low

- **DB agent: DONE.** packages/db (56 tests): schema+triggers, Neon/PGlite client, build-time migrations, services (accounts, entry bank, live card enter/lock/settle, breeding, packs, market, daily cup...). See packages/db README + "What the web app needs" in its report: POST /api/account cookie auth, card flow, cron /api/cron/race-card.
  shared race card (entries, field lock with AI fill, settlement), stable entries. Check its
  report or the repo state.
- **Viewer agent: DONE.** TV director, minimap, camera picker, PiP, hudTitle/resultsCard props.
  RaceViewer props `hudTitle=false` and `resultsCard=false`, used by the race page. It should
  also stop probing for art files that don't exist.
- **Web3 agent: DONE.** docs/web3.md (Robinhood Chain: L2 Arbitrum, ids 4663/46630, USDG stablecoin), contracts (70 tests), adapter `@thoroughbred/contracts/adapter`, 4 skills in .claude/skills. Open user questions listed in its section of docs/web3.md.
  Chain research → `docs/web3.md`; `.claude/skills` (solidity-dev, robinhood-chain,
  web3-game-economy, thoroughbred-game-dev); `packages/contracts` (RaceProofRegistry,
  PremiumStore, optional token, Hardhat tests); `packages/chain` adapter with mock mode,
  `WEB3_ENABLED=false`. The Hardhat toolchain is installed and verified. It found that viem 2.57 includes `robinhood` (chain id 4663) and `robinhoodTestnet` (46630). Check what it
  already wrote first.

## Core integration: DONE (web app runs on the database end-to-end)

`apps/web` no longer keeps any game state in the browser. Everything below is in Postgres
(`packages/db`) and settled on the server; the browser holds only an httpOnly session cookie.

- **Accounts:** `POST /api/account` → `createAccount` (device timezone) → httpOnly, SameSite=Lax
  cookie `tb_session` (Secure in production). `src/server/session.ts` resolves it with
  `authenticate()` on every request. `/play` imports the stable name + silks once from the old
  localStorage demo (`thoroughbred:v1`), then removes that key. `src/lib/player.ts` is now a
  server-backed store (`GET /api/me`) with a localStorage paint cache only.
- **Stable:** credits (`getBalance`), horses (`listStableHorses` → game-core `toSharedHorse`,
  with condition, career starts, injury and pre-entry injury risk), entry bank (`getEntryBank`,
  shown in the header as entries left / cap, refill offer when out).
- **Live card (§4d):** `src/server/game.ts`. `tickRaceCard` runs lazily on reads (throttled per
  instance) and from the cron; at entry close `lockField` fills the field with house horses and the
  `engineHorse` hook turns every entry snapshot into the engine Horse with game-core
  `raceSnapshot` (plan intensity, quirks, condition folded in), so the field hash covers exactly
  what races. At post time `getRaceForSimulation` → `simulateRace`; `live.ts` slices the broadcast
  (unchanged no-leak guarantees; header-only before the off, built from the locked field);
  `settleRace` runs once the broadcast is over (purses, game-core `settleField` ratings/careers/
  injuries, inbox). Quick Pick Live = best-fit fresh eligible horse (game-core `entryBlock` +
  rating band + form-guide fit) into the next suitable race.
- **Story (§4e):** `POST /api/races/quick` creates a `quick` race against house horses, enters,
  locks, simulates and settles it in the same request (capped `storyReward` via the ledger,
  idempotent per race). Watching only shows it; `instant` back-dates it. Free (no entries).
- **Inbox:** `inbox_items` on Home ("Your races": entered / live / result ready — unread results
  never show the position — then seen results). Viewing a result marks it read.
- **Cron:** `GET /api/cron/race-card` (Bearer `CRON_SECRET`) in `apps/web/vercel.json` at
  `17 4 * * *` (once a day: the Hobby plan only allows daily crons). Lazy driving on reads is the
  primary path; on Pro, change the schedule to `* * * * *` for a per-minute backstop.
  **Set `CRON_SECRET` in Vercel (Production + Preview)**; without it the route answers 503.
- **Removed:** the stateless demo (`repository.ts`, signed quick-race ids, deterministic schedule,
  `demoData.ts` starters, client-side settlement, `/api/stable/[playerId]`, `useStable`). The old
  demo code and its balance regression bands moved to `tools/balance/legacy` (reports still run).
- **APIs:** `POST/PATCH /api/account`, `DELETE /api/account/session`, `GET /api/me`,
  `POST /api/entries/refill`, `GET /api/races`, `GET /api/races/:id` (+ `/live`, `/replay`,
  `/verify`, `/options`, `/me`), `POST /api/races/:id/enter` `{horseId, plan}`,
  `POST /api/races/:id/scratch`, `POST /api/races/quick` (Story), `POST /api/races/live-pick`,
  `POST /api/inbox/read`, `GET /api/horses/:id`, `GET /api/cron/race-card`.
- **Deviations (flag to the user):** the DB purse split now equals the engine's (55/20/12/7/4/2)
  so the result board and the ledger agree; handicap weights are not applied to Live fields yet
  (the lock hook sees one runner at a time); Story races use the "club" chapter for every race
  until chapters land (story key = class + distance).
- **Tests:** `apps/web/src/server/game.test.ts` (PGlite: accounts, Story settle-once, Live
  enter → lock → no-leak broadcast → settle after broadcast → inbox), `packages/db` player
  services; e2e `apps/web/e2e/smoke.mjs` covers the full flow in a browser.

## Next steps (in order)

1. ~~Core integration~~ (done, above). Verify on the Vercel preview with Neon once `CRON_SECRET`
   is set.
2. **Feature screens:**
   - care, nursery, training, injuries and career;
   - breeding preview, packs, market, Legacy Farm and release to the Club;
   - Daily Cup, leagues and Hall of Fame;
   - Story chapters with named rivals.
3. **QA:** full e2e on the Vercel preview with Neon, a bug bash, a real-device performance
   check. Then merge to `main`.
4. **Pending contract changes** (from game-core):
   - `RaceEntry.speedModPermille` (handicap and ride);
   - extra coat values;
   - `HorseAppearance.look` for rig knobs;
   - `stud` and `pasture` life stages.

## Decisions taken without the user (flag them in the summary)

- A whole-horse "vigour" gene, so that A-grade horses appear around generation 6.
- The Daily Cup doesn't count as a career start.
- The foal-crop cap applies to pack foals only.
- Stable entries use a daily refill at local midnight, with rollover capped at 20.

## For other agents and teammates working on this repo

- **Latest code** is on the branch `claude/thoroughbred-demo`, which is ahead of `main`.
  Branch from it, or merge it in, before starting. `main` only receives tested milestones.
- **Read first:**
  - `docs/game-design.md`: the user's design decisions. §4a–4f are final.
  - `docs/architecture.md`: canonical. The old MVP architecture doc was removed on purpose.
  - `docs/roadmap.md`
  - `docs/art-direction.md`
  - `docs/design-research.md`
  - `docs/balance.md`
- **Rules that must not break:**
  - The race engine is deterministic: integer maths only. Any output change needs an
    `ENGINE_VERSION` bump and new golden values.
  - Live races never reveal the outcome before the finish is broadcast. There are leak
    tests in `apps/web/src/server/live.test.ts`.
  - Credits are never cashed out. No prize money and no gambling mechanics.
  - Inactivity never harms a horse.
  - Art follows the HD pixel standard v2: nearest filtering and integer scales only.
  - Web3 is optional and `WEB3_ENABLED=false` by default. It targets Robinhood Chain
    (EVM), not Solana.
- **Ownership** (to avoid conflicts):
  - `packages/shared` is the contract. Change it deliberately and tell its consumers.
  - `packages/db` and the race-viewer camera may still be changing (see "In flight"
    above).
- **Secrets:**
  - The PixelLab key lives only in `~/.config/pixellab/key` on the dev box. Never commit
    keys.
  - Neon env vars are managed by Vercel.
- **Checks before pushing:**
  - `pnpm -r typecheck`
  - `pnpm -r test`
  - `cd apps/web && npx next build`
