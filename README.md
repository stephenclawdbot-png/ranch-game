# Thoroughbred: racing stable game

A **live, multiplayer horse-racing stable game** that runs in the browser. You breed, raise,
train and manage horses that race live against other players' horses on a shared race card.
Alongside that there's a single-player **Story mode** against named AI rival stables. The
races are shown as an **HD-2D broadcast**: pixel-art horses in a real 3D racecourse.

> Breed it like Photo Finish, manage it like Football Manager, raise it like a ranch sim,
> ride it like Rival Stars. Simple on the surface, deep underneath. It never punishes you
> for being away.

**Status:** Phase 1 (core feel) is in progress. See [`docs/roadmap.md`](docs/roadmap.md) and
[`docs/HANDOFF.md`](docs/HANDOFF.md).
**Live preview** (latest work):
https://ranch-game-git-claude-thoroughbred-demo-meowdotfun.vercel.app

---

## How the game works

| Area | How it works |
|---|---|
| **Races** | **Live:** a shared card with a race every 3 minutes. Entries close 1 minute before the off, AI horses fill empty gates, and the race is broadcast live with no spoilers. **Story:** solo races against AI rivals, which you can skip to the result. **Quick Pick** enters your best-fit horse in one tap. |
| **Fairness** | Races are simulated deterministically on the server from a committed seed. Anyone can verify the seed commitment and result hash. The outcome is never sent to clients before the finish is broadcast. |
| **Horses** | Genetics: a two-allele genome, a vigour gene, real coat-colour genetics, markings, breeds and body shape. Every horse's look is generated in code from its genes. Potential is revealed over time. |
| **Career clock** | Horses age by **career starts, not calendar time**: 40 starts, running juvenile → prime → veteran → retirement → stud → Legacy Farm. Freshness recovers in real time, with at most 3 starts per day. Injuries are visible before entry and never fatal. |
| **Breeding** | 4 breedings per horse, kinship blocks, inbreeding penalties, and a breeding preview with odds. Foals grow only through daily **care sessions**. Missing a day pauses growth and never harms the foal. |
| **Economy** | **In-game Stable Credits only. Never cashed out, and no prize money.** Credits come from purses, daily goals and capped Story rewards. They're spent on training, entries, breeding, packs, facilities and a credits-only market with a 5% fee that's burned. |
| **Limits** | **Stable entries:** +10 per day at local midnight, rolling over up to a bank of 20, with one credit refill per day. **Stall cap:** 6 stalls, up to 24 with upgrades. **Packs** give foals, with published odds and pity. Starter horses are bound to the account. Anti-multi-account rules apply. |
| **Retention** | Daily Cup, weekly leagues of 30, seasons and the Season Final, rivalries, Hall of Fame. All ethical: no streak shaming, no punishment for absence. |
| **Web3 (optional, later)** | Robinhood Chain (EVM): on-chain fairness proofs and a premium store paid in USDC. **Off by default.** The game works fully without a chain. |

All the decisions are in [`docs/game-design.md`](docs/game-design.md). Sections 4a–4f are
final user decisions; §12 lists deviations made during implementation.

---

## Repository map

```
apps/web                Next.js 15 app (pages + /api route handlers), deployed on Vercel
packages/shared         Contract: shared types and zod schemas (race input/replay, live broadcast)
packages/racing-engine  Deterministic integer race simulation, seed commitments, verification
packages/race-viewer    HD-2D race broadcast (Three.js): camera, HUD, live-feed mode
packages/pixel-rig      Code-driven pixel horse rig: parts, skeletal gait, lighting, genetic looks
packages/art-pipeline   Asset manifest schema, coat palettes, PixelLab adapter interfaces
packages/game-core      Pure game rules: genetics, career, breeding, packs, ledger, economy, seasons
packages/db             Postgres schema and services (Drizzle). PGlite locally, Neon in production
packages/contracts      Solidity (Hardhat + OpenZeppelin) for Robinhood Chain (optional, WIP)
apps/web/public/art     PixelLab-generated HD pixel art (see manifest.json, STATUS.md)
art-src                 Art generation scripts, prompts and raw sources (reproducible)
tools/balance           Balance simulations and reports
docs/                   Design, architecture, research, balance, roadmap, handoff
```

## Docs index

| Doc | What's in it |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **Start here:** current state, what's in flight, next steps, rules for agents |
| [`docs/game-design.md`](docs/game-design.md) | Game systems, loops and the user's final decisions |
| [`docs/architecture.md`](docs/architecture.md) | System graphs, race fairness pipeline, module graph, Vercel runtime decisions |
| [`docs/roadmap.md`](docs/roadmap.md) | Phases 1–6, exit criteria, KPI targets |
| [`docs/design-research.md`](docs/design-research.md) | UI/UX research with sources, and the redesign spec |
| [`docs/art-direction.md`](docs/art-direction.md) | HD-2D and HD pixel standard, file contract, pixel-rig pipeline |
| [`docs/balance.md`](docs/balance.md) | Balance targets, before/after numbers, economy faucets and sinks |

## Quickstart

Requirements: Node 20+ (22 recommended) and pnpm 10.

```bash
pnpm install
pnpm dev              # http://localhost:3000. Uses embedded PGlite when DATABASE_URL is unset
pnpm -r test          # all package tests
pnpm -r typecheck
cd apps/web && npx next build
```

- **Environment:** see `apps/web/.env.example`. Use `RACE_SEED_SECRET` in production.
  Vercel provides `DATABASE_URL` from Neon. The web3 variables are off by default.
- **Dev pages:**
  - `/dev/viewer`: the race viewer harness. Query params: `horses`, `t`, `camera`,
    `weather`, `live`.
  - `/dev/rig`: the pixel-rig studio.
  - `?rig=1` on any race page tries the experimental pixel rig.

## Engineering rules

1. **Determinism:** the race engine uses integer maths only, with no `Date` and no
   `Math.random`. Any change to its output needs an `ENGINE_VERSION` bump and new golden
   test values.
2. **No spoilers:** live endpoints never reveal the result, seed or finish times before the
   finish is broadcast. Leak tests enforce this.
3. **The server is authoritative:** clients send choices (horse, plan), never outcomes.
   Every financial change is ledgered (double-entry, idempotent).
4. **Pixel integrity:** nearest filtering and integer scales. Pixel fonts are for titles
   and big numbers only.
5. **Ethics:** no cash-out, no gambling mechanics, no punishing absence, published odds.
6. **Secrets:** never commit keys. The PixelLab key lives outside the repo; Neon and Vercel
   secrets are managed by Vercel.

## Deploy

- **Vercel project:** `ranch-game` (team `meowdotfun`), root directory `apps/web`.
- **Branches:** every branch gets a preview deploy. `main` is production and only receives
  tested milestones.
- **Database:** Neon Postgres, connected for Preview and Production. Migrations are
  additive only, because preview and production share one database.
