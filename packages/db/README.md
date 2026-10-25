# @thoroughbred/db

Server-authoritative persistence for Project Thoroughbred: the Drizzle schema, versioned SQL
migrations, a client factory (Neon or embedded PGlite) and transactional, idempotent
services. Server-only: never import it from client components.

## Environments

| Where | `DATABASE_URL` | Driver | Migrations |
|---|---|---|---|
| Vercel Production + Preview | set by the Neon integration | Neon serverless (WebSocket Pool) | `pnpm build` runs `scripts/migrate.mjs` with `DATABASE_URL_UNPOOLED` |
| `next dev` | unset | PGlite, persisted in `node_modules/.cache/thoroughbred-pglite` | automatic on first use |
| tests | unset | PGlite in memory | automatic |
| local `next start` | unset | refuses to start unless `ALLOW_EMBEDDED_DB=1` (or `PGLITE_DIR`) | automatic |

Live races are shared, so a production server without `DATABASE_URL` throws at startup
instead of silently using a per-instance PGlite database.

## Migrations

- Edit `src/schema.ts`, then run `pnpm --filter @thoroughbred/db generate`. This runs
  `drizzle-kit generate` (a new `migrations/NNNN_*.sql`) and re-bundles them into
  `src/migrations.generated.ts`, which the runtime migrator uses with no filesystem access. A
  test fails if the bundle is stale.
- For triggers or functions, run `pnpm --filter @thoroughbred/db generate:custom` and fill in
  the empty SQL file.
- `0001_integrity_guards.sql` holds the database-level invariants:
  - the ledger is append-only, every transaction is balanced, and balances change only
    through postings;
  - horses are never deleted, Pasture is permanent and retirement is final;
  - bound horses and horses in a race or in foal can't be transferred.
- Bookkeeping uses `drizzle.__drizzle_migrations`, the same as drizzle-kit. Everything runs
  in one transaction under an advisory lock, so concurrent builds and cold starts are safe.

**Preview and Production share one Neon database.** Every migration must be strictly
additive and backward-compatible. That means:

- new tables, new nullable columns, or columns with defaults;
- new indexes;
- never a rename, drop or type change that running code depends on.

A preview build migrates the shared database before its code is promoted. Destructive
changes need a separate database first: a Neon branch per preview, configured through the Neon
Vercel integration's preview branching. Use expand/contract: add the new shape, deploy,
backfill, and drop the old shape in a later release.

## Services (all transactional; `now` is passed in)

- **Ledger:** double-entry credits.
  - `post`, `grantCredits`, `spendCredits`, `getBalance`, `ledgerHealth`.
  - Each transaction has a unique idempotency key. Balances can't go negative.
  - There are no player-to-player transfers.
- **Accounts:**
  - `createAccount` creates an anonymous device token (only its hash is stored), the stable,
    starter credits, 3 bound starter horses and day one's entries.
  - Also `authenticate`, `verifyEmail`, `recordAccountSignal` (account links), `areLinked`,
    `recordPlayDay`, `occupancy` and `upgradeStalls` (6 stalls up to 24).
- **Horses:**
  - `recordCare`: one session per horse per UTC day.
  - `setTrainingPlan`, `retireHorse`, `moveToLegacyFarm`, `releaseToClub`, `renameHorse`,
    `buyInsurance`, `setStudFee`.
- **Stable entries (§4f):**
  - `getEntryBank` grants the allowance lazily at local midnight. It's unique per
    (stable, local date).
  - Also `refillEntries`, `upgradeEntryTier`, `setTimezone` and `localDate`.
- **Live races (§4d):**
  - `ensureRaceCard` and `tickRaceCard` publish and drive the 3-minute card, with
    `defaultCardSlot` as the calendar.
  - `enterRace` and `scratchEntry` handle entries.
  - `lockField` runs at entry close. It's idempotent, fills the field with house horses
    and draws gates from the seed.
  - Then `getRaceForSimulation`, `settleRace` (idempotent; writes the inbox) and
    `cancelRace` (refunds).
- **Breeding:**
  - `breed` enforces lifetime 4, a mare once per season, a stallion's book, kinship, stud
    fees and the overflow stall.
  - Also `foal` (idempotent), `estimateCoiBp` and `insertLineage`.
- **Packs:** `getPackState` and `pullPack`.
  - The seed is committed before the pull.
  - Pity, weekly limits and the free Paddock Pack every 3rd play day apply.
  - Each pull draws atomically from the seasonal global foal crop.
- **Market:**
  - `listHorse` checks seller requirements and the 70% appraisal floor.
  - `buyListing` is atomic: 5% burned, stalls checked, linked accounts blocked.
  - Also `cancelListing` and `expireListings`.
- **Competition:**
  - `ensureSeason`, `enterDailyCup` (once per day) and `dailyCupBoard`.
  - `joinWeeklyLeague` and `addLeaguePoints`.
  - `awardAchievement`, `induct` (Hall of Fame), and `getConfig` / `setConfig`.
- **Maintenance:** `runMaintenance` heals injuries, foals due mares and expires listings.
  Nothing else ever changes with elapsed time.

### Rules come from game-core

The game rules come from `@thoroughbred/game-core`. These services handle locking,
idempotency and persistence, and inside their transactions they call game-core on the locked
rows. `src/gameCore.ts` is the bridge:

- `toHorseState(row)` builds a game-core `HorseState` from a row.
- `statePatch(state)` writes a state back into columns.
- `gameCoreHooks` is the default `GameHooks`.

What each service takes from game-core:

| Service | game-core |
|---|---|
| `breed` | `pairingBlock` (kin, sexes, 25 starts or retired, Legacy Farm, lifetime and season limits, in foal), `breedingFees`, `coiOf` over a `PedigreeIndex` loaded from the lineage closure |
| `foal` | `inherit` with the pregnancy's COI |
| `pullPack` | `pullPack` (published odds, pity, foundation genome); the account's pre-committed seed is the server seed |
| `listHorse` / `buyListing` | `listBlock`, `listingFloor`, `appraise`, `marketFee` |
| `recordCare` | `recordCare` (feed quality, bond, healing bonus) |
| insurance | `insurancePremium`, `insurancePayout` |
| entry bank | `grantFor`, `refill`, `refundEntries`, `dailyAllowance` / `bankCap`, `canChangeTimezone` |
| `settleRace` | accepts each runner's post-race game-core `state` (from `settleField`) |
| constants (`RULES`) | taken from game-core |

The database's own bookkeeping stays authoritative for counters and ownership: starts,
record, breeding count, owner, career status and locks.

Where a row has no valid genome (legacy rows), each service falls back to its own simple
rule.

Hooks (pass your own to override): `starterHorse`, `packHorse`, `breedFoal`, `houseHorse`,
`raceEligibility` and `appraise`. Field hooks: `engineHorse`, `cardSlot`.

Known differences from game-core, both deliberate:

- **Local midnight.** Here it uses the account's IANA timezone, so DST is handled. game-core's
  `localDate` takes a fixed offset; the bank maths is the same.
- **Half the field.** Here the owner-share limit is half of the field the lock fills to
  (`targetRunners`, 8–12). game-core's `ownerShareOk` uses half of `maxRunners`.

Errors are `DomainError` with a stable `code`. `httpStatusFor(code)` maps a code to an HTTP
status.

## Concurrency model

- Every service runs in a transaction and takes row locks in one global order:
  race → listing / pregnancy → stable → horse(s) in id order.
- Unique indexes and CHECK constraints back every rule, so a missed check still can't corrupt
  state:
  - one care session per day, one Daily Cup run per day, one mare cover per season;
  - one carrying pregnancy, one active listing, one race per slot;
  - entry grants;
  - breeding count ≤ 4, balances ≥ 0, foal crop ≤ cap, starts ≤ 40.
- Serialization failures and deadlocks are retried.
- The tests run on PGlite, which serialises transactions. Real-Postgres races are covered by
  the same locks and constraints.
