# Season harness (`tools/season-harness`)

A wind tunnel for Post Time: simulated stables play a whole season through the **real game
code**, and every day of it is measured. Run it before and after a change (purses, race
spacing, genetics, competition rules) and compare the two reports.

- **Real code, not a model.** Players act only through the server functions the API routes
  call (`apps/web/src/server`: `foundStable`, `playerView`, `careAction`, `trainAction`,
  `vetAction`, `quickPickLive`, `raceList` / `entryOptions` / `enterLive`, `refill`,
  `createChapterRace`, `runCup`, `leagueView`, `pull`, `breedingView` / `coverMare` /
  `foalAndName` / `standAtStud`, `marketView` / `listForSale` / `buy`, `careerAction`,
  `facilityAction`), each with a fresh session the way `requireSession` gives a route. Races
  are published, locked (house runners fill the gates), simulated by the racing engine and
  settled by `driveCard` exactly as the cron route runs it. The database is the real schema on
  in-memory PGlite.
- **Schedule from code.** The clock steps one card slot (`RULES.slotMs`) at a time; the card
  horizon, entry close, limits and purses are whatever the code says at run time. Nothing about
  the schedule is hard-coded here.
- **Deterministic.** Every player decision comes from a seeded game-core `Rng`, and the game's
  own CSPRNG draws (race seeds, starter and pregnancy seeds, device tokens, Postgres
  `gen_random_uuid()`) are routed to a seeded stream for the run (`src/determinism.ts`; only
  inside the harness process). The same `HARNESS_SEED` gives the same season, byte for byte.

## Run

From the repository root (vitest is in the root `node_modules`; the config resolves the
workspace packages and the web app's `@/` alias):

```sh
# a full season: 28 days, 50 stables -> tools/season-harness/out/dev/
npx vitest run --config tools/season-harness/vitest.config.ts season

# named run, quick mode (3 days, 12 stables, about 1.5 min)
HARNESS_TAG=quick HARNESS_QUICK=1 npx vitest run --config tools/season-harness/vitest.config.ts season

# baseline, then a change, then compare (the change's report shows both)
HARNESS_TAG=baseline HARNESS_DAYS=7 npx vitest run --config tools/season-harness/vitest.config.ts season
#   ... edit purses / spacing / rules ...
HARNESS_TAG=purses-up HARNESS_DAYS=7 HARNESS_COMPARE=baseline npx vitest run --config tools/season-harness/vitest.config.ts season

# re-render a report (e.g. to compare two finished runs) without simulating
HARNESS_TAG=purses-up HARNESS_COMPARE=baseline HARNESS_REPORT_ONLY=1 npx vitest run --config tools/season-harness/vitest.config.ts season

# smoke test (about 40 s): 12 simulated hours, twice; sanity + credits conserved + determinism
npx vitest run --config tools/season-harness/vitest.config.ts smoke
```

`pnpm exec vitest ...` works the same. Nothing here runs in `pnpm -r test` or the web app's
suite: the files are `*.harness.ts` under `tools/`, which no package's vitest config includes.
The smoke test takes longer than the 20 s budget for the default suites, so it stays here.

Type-check with `npx tsc -p tools/season-harness`.

### Knobs (environment)

| Variable | Default | Meaning |
|---|---|---|
| `HARNESS_TAG` | `dev` (`quick` with `HARNESS_QUICK`) | Output folder `out/<tag>/` |
| `HARNESS_SEED` | `season-harness-1` | Seeds every decision and the game's random draws |
| `HARNESS_DAYS` | 28 (3 quick) | Simulated days |
| `HARNESS_STABLES` | 50 (12 quick) | Stables in total, split 40 / 24 / 20 / 16 % casual / grinder / breeder / farmer |
| `HARNESS_COHORTS` | | Exact counts, e.g. `casual=20,grinder=12,breeder=10,farmer=8` |
| `HARNESS_ALTS` | 3 (2 quick) | Alt accounts per farmer main (farmer count must be a multiple of alts + 1) |
| `HARNESS_DETECTED_GROUPS` | 1 | Farmer groups that share a wallet signal (visible to the linked-account guard) |
| `HARNESS_START` | the season starting 2026-11-09 | ISO start instant (UTC) |
| `HARNESS_STEP_MIN` | `RULES.slotMs` | Clock step in minutes |
| `HARNESS_COMPARE` | | Tag of an earlier run to overlay and diff |
| `HARNESS_REPORT_ONLY` | | `1` re-renders from `out/<tag>/metrics.json` |
| `HARNESS_VERBOSE` | on | `0` silences the per-day progress lines |

Runtime is roughly 60–90 s per simulated day for 50 stables with the 15-minute card (half of
it is the card itself: publishing, locking, engine runs and settlement), so a 7-day baseline is
about 10 minutes and a full season 45–60 minutes. `meta.timing` in metrics.json splits it.

## Outputs (`out/<tag>/`, git-ignored)

- `metrics.json`: `meta` (seed, cohorts, slot and horizon read from the code, engine version,
  runtime), `days[]` (one sample per simulated day), `totals`, `outcomes` (per cohort),
  `farmers`, `checks`, `activity` (attempted actions, refusals by DomainError code, counters),
  `errors` (unexpected exceptions).
- `summary.md`: plain-English key numbers, flags worth a look, cohort table, farmer channels.
- `report.html`: self-contained (inline SVG, no external scripts or fonts), light and dark,
  one chart per series with a hover crosshair; in compare mode the other run is dashed on every
  chart and a delta table follows the tiles.

### What is measured, daily

- **Credits**: created by source and destroyed by sink (ledger transaction kinds posting from
  the mint or to the burn / Club treasury), player-to-player volume by kind (stud fees, market),
  players' total; balance median / p90 / max per cohort.
- **Horses**: player population by stage (plus retired and Legacy Farm), born (bred, pack,
  gift), retired by reason, moved to the Legacy Farm, died, stallions at stud.
- **Races**: Live races run, field size, share of player runners, races with players, sister
  courses, Story races, Daily Cup runs, purses; Live entries used and starts per stable.
- **Competition**: league points per stable (the game's `weekScore`), tiers, promotions and
  relegations; Feature Qualifier and Weekend Feature runners and top-3 qualifiers per cohort,
  horses rated 100+; Story licence per cohort.
- **Injuries** by severity (Live and Story results) and training injuries.
- **Breeding**: covers, foals, foal potential against the parents (below both / between /
  above both, game-core `overallPotential`).
- **Market**: listings, sales, median price, volume, expiries.
- **Ratings**: official rating of racing-age horses per cohort (median, p90, best).
- **End of run, per cohort** (retention-ish proxies): share of stables that won a Live race,
  ran a qualifier, qualified for a Weekend Feature, ran one, bred, sold, reached licence 3, were
  promoted, ended above their starting credits; average Live starts and visits.

### Checks

`checks.ok` needs the game's `ledgerHealth` clean (postings sum to zero, no drifted or
negative accounts), credits conserved (Σ created − Σ destroyed = players' total, from the
ledger by kind) and no unexpected exceptions. A server refusal (a `DomainError`, e.g. "no
entries left") is normal play and is counted in `activity.refused`, not as an error.

## Cohorts (`src/agents.ts`)

| Cohort | Visits | Behaviour |
|---|---|---|
| casual | 1 a day in the local evening, skips ~15% of days | care, Daily Cup (70%), a Story race (50%), 1–3 Live Quick Picks, the free Paddock Pack |
| grinder | every 2 h, 07:00–23:00 local | care, vet, Cup, league, free pack, facility upgrades, occasional market buy; 2 Story first-win attempts a day until licence 4; every free horse into the best-fitting race of the next 3 h (`entryOptions` fit loss, fresh horses first), Feature Qualifiers and the Weekend Feature whenever eligible, Quick Pick for the rest; refill at the last visit; one training session per fresh horse a day |
| breeder | 3 a day | care, Cup, free pack; retires racing mares to the paddock and covers every mare the season allows (best-rated affordable stud); foals and names; retires a colt with 8+ starts to stud (fee 600–1,500); buys a paid Paddock foal when over 5,000 credits; sells up to 2 tradeable horses a day at appraisal +0–30% once the seller rules allow; moves spent breeders to the Legacy Farm when the stalls are full; 2 Quick Picks a visit |
| farmer | main as grinder; alts 2 a day | alts race (Quick Pick), care, Cup, Story to licence 2, and pass value to the main: the main's stallion covers their mares with the fee set to what the alt holds (then reset), they buy the main's paid-pack foals at the listing ceiling, and sell their tradeable horses to the main at the floor. One group (`HARNESS_DETECTED_GROUPS`) shares a wallet signal, so the market's linked-account guard can see it |

House and Club runners fill fields exactly as the game does at field lock.

## Files

| File | |
|---|---|
| `vitest.config.ts` | Aliases, one process per file, long timeouts |
| `season.harness.ts` | Entry: env config → run → outputs |
| `smoke.harness.ts` | Smoke test (sanity, ledger, determinism) |
| `src/config.ts` | Env parsing, defaults, cohort split |
| `src/determinism.ts` | Seeded replacement of the process's random sources |
| `src/agents.ts` | The simulated players |
| `src/run.ts` | The clock loop |
| `src/metrics.ts` | Daily samples, outcomes, farmer channels, checks |
| `src/report.ts` | `summary.md` and `report.html` (charts, compare mode) |

## Notes and limits

- One process per run: the server keeps per-instance caches in module scope (e.g. the Daily
  Cup of the day); the smoke test reloads the modules between its two runs.
- Simulated players don't scratch, don't buy Premium Packs (no payments), and don't use
  insurance or Pedigree Scans. Telemetry events (`trackEvent`) are not recorded.
- Wall-clock fields (`runtimeMs`, `timing`, `finishedAt`) are the only parts of
  `metrics.json` that change between two runs with the same seed.
