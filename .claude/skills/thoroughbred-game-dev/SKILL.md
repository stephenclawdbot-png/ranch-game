---
name: thoroughbred-game-dev
description: Use for any development work on Project Thoroughbred (the browser horse-racing stable game in this pnpm monorepo) - race engine changes, live broadcast/viewer, HD pixel art and pixel-rig, game rules, DB, web app, tests, Vercel/Neon deploys - to follow the project's determinism, no-spoiler, art, testing and agent-coordination conventions and find the right design docs.
---

# Thoroughbred game development conventions

Branch `claude/thoroughbred-demo` (ahead of `main`). `main` is production on Vercel and only
gets tested milestones. **Start with `docs/HANDOFF.md`.**

## Docs map (read before deciding anything)

| Doc | Use it for |
|---|---|
| `docs/HANDOFF.md` | Current state, what's in flight, next steps, rules for agents |
| `docs/game-design.md` | All game systems. **§4a–4f are final user decisions**; §12 lists deviations |
| `docs/architecture.md` | System graphs, fairness pipeline, module graph, Vercel runtime |
| `docs/roadmap.md` | Phases 1–6, exit criteria, KPIs |
| `docs/balance.md` | Balance targets, faucets and sinks |
| `docs/art-direction.md` | HD-2D, the HD pixel standard v2, file contract, pixel-rig pipeline |
| `docs/design-research.md` | UI/UX research and the redesign spec |
| `docs/web3.md` | Optional Robinhood Chain layer (and the `solidity-dev`, `robinhood-chain` and `web3-game-economy` skills) |
| `packages/*/README.md` | Package APIs (racing-engine, db, contracts...) |

## Packages

- `shared`: zod contracts. Changing it touches everyone, so coordinate with the lead.
- `racing-engine`: deterministic simulation and fairness.
- `race-viewer`: Three.js HD-2D broadcast.
- `pixel-rig`: code-driven pixel horse.
- `art-pipeline`: manifest and PixelLab adapter.
- `game-core`: pure rules.
- `db`: Drizzle, with PGlite in dev and Neon in production.
- `contracts`: Solidity and the chain adapter. Optional.
- `apps/web`: Next.js 15 pages and `/api`.

## Determinism (racing-engine and game-core)

- Integer maths only: `+ - *`, floored division, bit ops, and
  `Math.min/max/abs/floor/trunc/imul`. Use the integer `isqrt`.
- **No `Date`, `Math.random`, transcendental maths, Node or DOM APIs** in engine sources.
  A test scans for them.
- Randomness comes from xoshiro128** streams seeded by sha256. Use one stream per
  (horse, purpose), so adding a roll never shifts other horses.
- **Any output change bumps `ENGINE_VERSION`** (currently 1.1.0 in `simulate.ts`) and
  updates the golden test values. Explain the change in the engine README.
- Fairness:
  - `seedCommitment = sha256(seed)` is published at entry open;
  - the seed and `resultHash` are revealed after the race;
  - `verifyReplay` re-simulates.

  Never change these formats without updating `packages/contracts/adapter/merkle.ts` and
  the parity tests.

## Live broadcast: no spoilers (hard rule)

- Live races are simulated once on the server. Clients get frames **only up to the live
  edge** (`apps/web/src/server/live.ts`: `sliceBroadcast`, `isBroadcastOver`).
- Before the finish is broadcast, never send the result, seed, `totalTicks`, finish times,
  later events, the winner or the end time. Replay and verify return **425** until then.
  `live.test.ts` holds the leak tests: extend them for every new endpoint or field.
- Story mode (solo vs AI) may skip to the result. Live races never have instant results.
- The same rule applies to on-chain anchors: a result batch reveals the seed, so only
  anchor races that are over.

## Server authority and the economy

- Clients send choices (horse, tactic, plan), **never outcomes**. Settlement happens on
  the server, idempotently, once.
- Every credit change goes through the **double-entry ledger** and is transactional and
  idempotent.
- Ethics: no cash-out, no prize money, no gambling mechanics, published odds and pity, no
  punishing absence, no streak shaming.
- Limits:
  - **stall cap:** 6 stalls, up to 24 with upgrades;
  - **career:** 40 starts, at most 3 starts per day;
  - **stable entries (§4f):** +10 at local midnight, bank cap 20, granted lazily and
    idempotently per (stable, local date).

## Art: HD pixel standard (v2)

- Horse and jockey frames are about 240×150 native, from 256×192 rig sources. World
  density is about 96 px per metre. Ground tiles are 128×128.
- **Nearest filtering, integer scales, no mipmaps on sprites, no blurred sprites.** Depth
  of field only touches the far background and near foreground; the field stays sharp.
  Pixel fonts are for titles and big numbers only.
- **PixelLab is source material.** Code finishes the art: recolouring through
  `race/palette.json` key ramps, outlines, normals and VFX. Raw generations and prompts go
  in `art-src/`. Served files and `manifest.json` go in `apps/web/public/art`, validated by
  `AssetManifestSchema`.
- Pixel rig (`packages/pixel-rig`):
  - a part-based skeletal gallop rendered to a low-res target;
  - lit with normals, then quantised to the palette ramp with Bayer dithering;
  - the look comes from genes;
  - opt in with `?rig=1`; studio at `/dev/rig`; viewer harness at `/dev/viewer`
    (`horses`, `t`, `camera`, `weather`, `live`).

  It becomes the default only after a real-GPU check.
- PixelLab budget: check `GET /v2/balance` before and after each batch, keep about $6 in
  reserve, and never commit the API key.

## Commands

```sh
pnpm dev                                         # http://localhost:3000 (PGlite when DATABASE_URL is unset)
pnpm -r test && pnpm -r typecheck                # everything
pnpm --filter @thoroughbred/racing-engine test   # determinism, golden, property, perf
pnpm --filter @thoroughbred/game-core test       # rules (sim reports: pnpm --filter @thoroughbred/game-core sim)
pnpm --filter @thoroughbred/db test              # PGlite-backed services
pnpm --filter @thoroughbred/contracts test       # Hardhat + viem (optional web3)
cd apps/web && npx vitest run && npx next build  # web unit tests and production build
```

## Vercel and Neon

- Vercel project `ranch-game` (team `meowdotfun`), root `apps/web`. Every branch gets a
  preview. The preview URL is in `README.md`.
- `DATABASE_URL` (Neon) is set for Preview and Production. **Preview and production share
  one database, so migrations are additive only.** Migrations auto-apply on first use;
  `DB_AUTO_MIGRATE=0` disables that.
- Settlement happens on request, with Vercel Cron as a backstop. There are no WebSockets:
  live viewing is synchronised playback of stored checkpoints.
- Secrets (`RACE_SEED_SECRET`, chain keys, the PixelLab key) live in Vercel env or outside
  the repo. **Never commit them.**

## Agent coordination

- Several agents work in parallel. **Only touch the paths you were assigned.** Stage
  explicit paths (`git add <paths>`), never `git add -A`.
- Don't run root `pnpm install` or add dependencies without the lead's OK; the lockfile is
  shared. Use `--frozen-lockfile` assumptions.
- Commit only when asked or at agreed milestones, on `claude/thoroughbred-demo`, with the
  session's attribution trailer. Push with `git push origin claude/thoroughbred-demo`.
- Shared contracts (`packages/shared`) and `docs/game-design.md` decisions belong to the
  lead or user. Propose changes in your report; don't silently change them.
- Report decisions taken without the user, so they can be flagged in `HANDOFF.md`.
- A container restart can lose uncommitted work. Commit at milestones when allowed.
