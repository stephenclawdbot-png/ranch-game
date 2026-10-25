# Handoff / resume notes (lead)

Read this first when resuming. The branch is `claude/thoroughbred-demo`. `main` gets updated
only at tested milestones, because main auto-deploys to Vercel production.

Preview URL: https://ranch-game-git-claude-thoroughbred-demo-meowdotfun.vercel.app
(Vercel project `ranch-game`, team `meowdotfun`; Neon is connected with `DATABASE_URL` for
Preview and Production.)

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

- **DB agent** (`packages/db`): schema, services, PGlite/Neon, deploy-time migrations,
  shared race card (entries, field lock with AI fill, settlement), stable entries. Check its
  report or the repo state.
- **Viewer agent:** TV-style camera director, track minimap and camera picker, plus the
  RaceViewer props `hudTitle=false` and `resultsCard=false`, used by the race page. It should
  also stop probing for art files that don't exist.
- **Web3 agent: STOPPED early** to save budget. Restart it with the same brief: Robinhood
  Chain research → `docs/web3.md`; `.claude/skills` (solidity-dev, robinhood-chain,
  web3-game-economy, thoroughbred-game-dev); `packages/contracts` (RaceProofRegistry,
  PremiumStore, optional token, Hardhat tests); `packages/chain` adapter with mock mode,
  `WEB3_ENABLED=false`. The Hardhat toolchain is installed and verified. It found that viem 2.57 includes `robinhood` (chain id 4663) and `robinhoodTestnet` (46630). Check what it
  already wrote first.

## Next steps (in order)

1. **Core integration:**
   - accounts (anonymous cookie);
   - a DB-backed stable that replaces localStorage;
   - Story races settled on the server;
   - the Live shared race card (enter, Quick Pick into the next suitable race, AI fill, live
     broadcast, settlement);
   - inbox and stable entries (§4f).
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
