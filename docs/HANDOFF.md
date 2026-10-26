# Handoff / resume notes (lead)

Read this first when resuming. The branch is `claude/thoroughbred-demo`. `main` gets updated
only at tested milestones, because main auto-deploys to Vercel production.

Preview URL: https://ranch-game-git-claude-thoroughbred-demo-meowdotfun.vercel.app
(Vercel project `ranch-game`, team `meowdotfun`; Neon is connected with `DATABASE_URL` for
Preview and Production.)

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
