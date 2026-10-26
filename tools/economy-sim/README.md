# Economy simulation (`tools/economy-sim`)

Reproducible Monte Carlo and agent-based models behind `docs/economy/AUDIT.md`. They cover
Stable Credits, the closed-beta money loop (Premium Packs for ETH, Prize Pool, affiliates),
the pool's prize distribution, sybil farming and parameter sensitivity.

## Run

```sh
pnpm exec tsx tools/economy-sim/main.ts                 # full run, ~3 min, rewrites docs/economy/results/
pnpm exec tsx tools/economy-sim/main.ts --quick         # fewer seeds (~25 s), same tables
pnpm exec tsx tools/economy-sim/main.ts --only=pool_beta,affiliates
```

`tsx` is already in the root `node_modules/.bin`. If it ever goes missing, use `npx tsx@4`.
The sim has no dependencies of its own and is not a workspace package, so it never touches
the lockfile. Reports: `credits`, `population`, `packs`, `pool_beta`, `pool_season`, `sybil`,
`money_season`, `affiliates`, `sensitivity`, `chain`, plus `summary.json`.

Runs are deterministic: every random stream is seeded from a fixed string, so a rerun
prints the same tables.

## Staying in sync with the game

- **Game rules are imported**, not copied, from `packages/game-core/src` (purses, entry
  rules, story rewards and caps, training costs, stalls, facilities, breeding, pack odds and
  pity, league points, Cup points, starter generation, the mint, appraisal). The population
  report runs game-core's own `runPopulationSim`. Starter and pack horses come from the real
  `createStarterStable` and `pullPack`.
- **Beta money rules are mirrored.** They live in `packages/db` and `apps/web`, which pull in
  Postgres and viem. `lib/constants.ts` copies them: pool rules, affiliate config, pack price,
  contract limits and deploy defaults. `checkSync()` then re-reads the source files on every
  run. A mismatch aborts the run with the file and value, so stale numbers never reach
  `docs/economy/results`.
- `checkSync()` also fails the day someone wires `DAILY_GOAL_CREDITS` into the server. The
  audit found that goals are not paid today, and the credits model would then need
  `setGoalsImplemented(true)`.

## Models

| File | What it models |
|---|---|
| `lib/race.ts` | Thurstone race outcomes. Noise sigma is calibrated to the engine's measured "+150 speed ≈ 3.5× win odds" (`docs/balance.md`); it comes out at 83 rating points. Class fields have a 25-point spread. |
| `models/credits.ts` | 28-day, day-by-day credits flow per archetype (casual, engaged, grinder, breeder, whale, Story-only skipper). It covers entries, the bank and refills, 3 starts per horse per day, 40-start careers, Story first wins (a rational choice by expected value), caps and career starts, the Cup, training, stalls, facilities, packs, breeding and scans. Also the multi-account transfer and the one-off sink capacity. |
| `models/packs.ts` | A fast pity model (same algorithm as `gc.pullPack`, cross-checked against it), pity variants, and pack value from the real mint compared with starters. |
| `models/testers.ts` | The 50-tester population: archetype mix, spend segments, invite-tree positions, wallets and real starter abilities. |
| `models/pool.ts` | The agent-based Prize Pool. It mirrors `betaMoney.poolScores` and `allocateUsd`: race points capped at 240 a week, Cup percentile points, eligibility, linear top-10 weights, the $20 cap, dust, the 25% budget of the free balance, vesting and the claim lag. It adds the stall-limited purchases, the affiliate split, the premium-lineage "leak", sybils, scoring variants (`current`, `bestN`, `rate`) and a variance decomposition (activity vs ability and skill vs race luck). |
| `models/money.ts` | The per-sale split, gas, and a 12-week revenue and pool model with levers: fresh-blood season drops, season pass, cosmetics, sponsors and owner top-ups, under weekly purchase decay. |
| `models/affiliates.ts` | Splits by tree position, the owner's effective take, and the wash and ring marginal return. |

## Assumptions (no telemetry yet)

Every behavioural number is an assumption. Each one is listed here and swept in
`sensitivity.md`:

- **Tester mix:** casual 15, engaged 15, grinder 5, breeder 5, whale 3, Story-only 7.
- **Spenders:** 30% minnows (Poisson 1.2 packs a week, at most 6 in total) and 15% dolphins
  (Poisson 4 a week). The 3 whales want 10 a week.
- **Weekly purchase decay:** 45%, swept from 30% to 60%.
- **Stalls:** each foal needs a free stall when it is quoted, which caps week 1 at 2, 3 or 5
  packs. Whales that release foals to the Club lift the cap to 10.
- **Invite tree:** 70% owner-direct, 25% invited by a tester, 5% two levels deep.
- **phi = 0.5:** the share of a horse-ability edge that still reaches Live points. Live
  classes are rating-windowed, so a better horse mostly moves up a class. Swept from 0.2 to
  0.8.
- **Leak:** premium offspring add +45 rating from week 6, and horses bought with credits from
  selling premium foals add +15 from week 3. Both scale with the number of premium pulls (full
  effect at 20 pulls).
- **12-week money model:** retention is 35% core + 65% × 0.8^(w−1). The season pass costs
  $9.99, taken up by 25% at season start plus 5% mid-season. Cosmetics bring $0.40 per active
  player per week. Each fresh-blood drop recaptures 75% of the previous drop's demand. Breeding
  displaces packs from week 5, down to a 35% floor.
- **Gas:** 0.02 gwei L2 plus about $0.02 L1 data per transaction, with ETH at $3,000. Getting
  ETH onto Robinhood Chain costs $2.50, once per tester.

When beta telemetry exists, replace these with measured values (`checkout_paid` events, play
days, race entries) and rerun.
