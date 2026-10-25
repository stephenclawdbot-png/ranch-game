# @thoroughbred/game-core

The game rules for Project Thoroughbred, as pure and deterministic TypeScript. There is no I/O,
no clock and no `Math.random`. Time (`nowMs`) and seeds are always passed in. Randomness comes
from sha256/HMAC seeds and xoshiro128\*\*, and the maths uses only `+ − × ÷`, `floor` and
`sqrt`, so results are identical in Node and every browser. A test scans the sources to enforce
this.

The specs are `docs/game-design.md` (§3–§10, and §4a–§4f, which supersede the calendar ageing)
and `docs/balance.md`.

```sh
pnpm --filter @thoroughbred/game-core test        # unit + property tests (plus a reduced population sim)
pnpm --filter @thoroughbred/game-core typecheck
pnpm --filter @thoroughbred/game-core sim         # full population Monte Carlo (~80 s)
```

## Modules and key APIs

| Module | What it does | Key exports |
|---|---|---|
| `types.ts` | Zod schemas and types, all JSON-serialisable (`packages/db` stores them as jsonb) | `GenomeSchema`, `HorseStateSchema`, `RaceSlotSchema`, `LedgerTxSchema`, `PackPullSchema`, `RacePlanSchema`, `LeagueSchema`, … |
| `rng.ts` | Seeds and the PRNG. Matches the racing engine byte for byte | `Rng`, `seedFrom`, `commitSeed`, `deriveSeed` |
| `time.ts` | Real days and weeks (care, healing, counters) and competition seasons (4 weeks) | `dayIndex`, `weekIndex`, `seasonOf` |
| `genome.ts` | Stat loci, potentials, grades, rarity, aptitudes, breeds, launch and season ceilings, foundation minting | `potentialOf`, `meanPotential`, `gradeOf`, `rarityOf`, `generateFoundationGenome`, `potentialCeiling`, `meanCeiling` |
| `coat.ts` | Coat genetics (E, A/At/a, Cr, G, Rn, D, liver, Sb1), white markings, morphs → `HorseAppearance` + pixel-rig look knobs | `resolveCoat`, `resolveMarkings`, `rigLook`, `appearanceOf` |
| `genetics.ts` | Mendelian inheritance, bounded seeded mutation, kinship and COI, kin blocks | `inherit`, `coiOf`, `kinship`, `kinBlock` |
| `lifecycle.ts` | The career clock: stages, care (one counted session per day), retirement at 40 starts, pension, release, idle settlement | `stageOf`, `recordCare`, `settleIdle`, `raceBlock`, `pensionHorse`, `createHorseState` |
| `condition.ts` | Fatigue (real-time recovery), the freshness peak at 3–5 days, morale, injury risk before entry, injury rolls, healing | `injuryRisk`, `rollInjury`, `conditionReport`, `fatigueAt`, `treatInjury` |
| `phenotype.ts` | Potential → current stats → the shared `Horse` race snapshot. Maturity over starts, revealed ranges, quirks, handicap weight and ride hooks | `currentStats`, `raceSnapshot`, `toSharedHorse`, `revealedRanges`, `maturityAt`, `pedigreeScan` |
| `training.ts` | Weekly 3-slot plans (4 with a Trainer); sessions run only when the player triggers them | `train`, `WORKOUTS`, `realisationGain`, `allowedWorkouts` |
| `career.ts` | Race settlement per horse and per field (starts, record, OR, fatigue, experience, injuries, quirk reveals, retirement) | `applyRun`, `settleField` |
| `ratings.ts` | Elo-like official rating (0–140) and handicap weights | `updateRatings`, `handicapWeights` |
| `eligibility.ts` | Classes and bands, entry checks, the stable entry budget hook, matchmaking share | `entryBlock`, `eligibleTiers`, `classBand`, `ownerShareOk` |
| `breeding.ts` | Limits, kin blocks, fees (10% stud-fee burn), cover (24 h) and foal (nursery overflow), the exact preview | `pairingBlock`, `cover`, `deliverFoal`, `previewBreeding`, `breedingFees` |
| `packs.ts` | Paddock and Premium packs (foals): published odds, pity, commit–reveal pulls, weekly limits, crop cap | `pullPack`, `verifyPull`, `packBlock`, `PACK_ODDS`, `PACK_PITY` |
| `ledger.ts` | Double-entry credits ledger: zero-sum postings, no negative player or escrow balances, idempotency keys | `post`, `checkLedger`, `grantTx`, `spendTx`, `studFeeTx`, `escrowTx`, `settleSaleTx` |
| `economy.ts` | Faucet and sink constants, stalls, appraisal, market rules, linked-account hook, story rewards, weekly flow model | `PURSE_BY_TIER`, `appraise`, `listBlock`, `tradeBlock`, `storyReward`, `weeklyFlow`, `ACTIVE_PLAYER` |
| `entries.ts` | Stable entries (§4f): +10 per local day, bank cap 20, costs, refill | `grantFor`, `entryCost`, `canRefill`, `refill`, `spendEntries` |
| `seasons.ts` | The 3-minute calendar (entries close 1 min before the off), Weekend Features and qualifiers, the Season Final | `regularSlot(s)`, `nextOpenSlot`, `featureCalendar` |
| `dailyCup.ts` | One seeded fixed field per day and one Cup Run per player per day, ranked by time. Takes `simulateRace` as a parameter | `dailyCupDay`, `runDailyCup`, `rankCup` |
| `leagues.ts` | Weekly leagues of 30 with promotion and relegation. Absent owners are never relegated | `formLeagues`, `settleLeague` |
| `social.ts` | Achievements, Hall of Fame criteria, rivalry detection | `ACHIEVEMENTS`, `hallOfFameReasons`, `detectRivalries` |
| `onboarding.ts` | Starter stable (3 race-ready Club-bred horses), a competitive but honest first maiden, the day-2 gift foal | `createStarterStable`, `firstMaidenRace`, `createGiftFoal` |
| `field.ts` | Club (AI) runners for fixed fields | `clubRunner` |
| `sim/population.ts` | Population Monte Carlo using the real rules | `runPopulationSim`, `populationSteps` |

### Typical server flow

```ts
// Entry sheet: the risk is shown before entry, and settlement uses the same function.
const risk = injuryRisk(horse, { nowMs, going, distanceM, intensity, stage: stageOf(horse) });
const block = entryBlock(horse, slot, nowMs, entriesSoFar, { entriesLeftToday: bank.balance });
// At entry lock: an immutable snapshot (handicap weight and plan go into the stats).
const w = handicapWeights(field.map((h) => ({ horseId: h.id, or: h.rating.or })), slot.handicap);
const snap = raceSnapshot(horse, { nowMs, silks, race: { going, fieldSize, bigCrowd, surface, distanceM }, extraWeightLb, plan });
// After the race (engine finishOrder): ratings, starts, fatigue, injuries, quirks, retirement.
const results = settleField(states, replay.result.finishOrder, cond, (id) => ({ intensity, vetLevel }));
```

## Design decisions (how the spec became numbers)

- **Genome.** Each stat has two alleles (0–1000). The higher one is partially dominant
  (h = 0.55), so potential = low + 0.55 × gap.
  - **Vigour.** One extra whole-horse "class" (vigour) locus, with alleles −150..150, adds its
    value to all six stats. Breeding needs a whole-horse segregation term: without one, the
    frontier stalls at about 760 (see below, and `docs/balance.md`).
  - **Other loci:** aptitude (distance ×4, surface T/D, style, maturity type), coat (8 loci),
    polygenic white, 5 morph loci, 4 part-variant loci, 4 quirk loci and breed shares.
  - **Inbreeding:** the foal's COI is stored in its genome. Each 100‰ of COI lowers durability
    and temperament potential by 8%, and raises both the mutation rate and the share of
    mutations that are negative.
- **Minting (packs, starters, gifts).**
  - **Ceiling:** mean potential ≤ 600 and any stat ≤ 700 at launch (`docs/balance.md`), +10
    per season up to +80.
  - **Hidden alleles:** minted alleles may sit above what the horse shows, by up to +250
    (speed +200). 15% of loci carry a hidden "gem" allele, and 10% of horses carry a high
    vigour allele.
  - **Rarity:** derived from mean potential: Common < 510 ≤ Uncommon < 540 ≤ Rare < 565 ≤
    Epic < 585 ≤ Legendary.
- **Grades.** They use the mean of the six stat potentials: E < 500 ≤ D < 600 ≤ C < 700 ≤ B
  < 800 ≤ A < 900 ≤ S. The mean, not a weighted sum, keeps breeders aiming at balanced horses
  rather than speed alone. Speed's dominance in the engine (balance.md) is also handled
  another way: speed has less hidden headroom, and speed work costs 90 credits a session
  against 60 for stamina.
- **Phenotype.** Current = potential × maturity × training factor.
  - **Maturity** runs on care sessions (foal 30% → juvenile base) and then on starts. It peaks
    at starts 6–18 for early types, 10–28 for normal and 16–34 for late, shifted per stat. The
    decline to start 40 hits speed first; temperament and adaptability never decline.
  - **Training factor** = 1 − 0.2 × (1 − realisation), so the design's 60%→100% realisation
    shows as 92%→100%. Care adds up to +5% to realisation. An untrained racing-age starter is
    at about 82% of potential, which puts starters at about 450–520 current: maiden level on
    the engine's scale.
- **Condition.**
  - **Fatigue** recovers 12 per hour (derived on read).
  - **Freshness** gives +2.5% from 3 to 5 days after hard work.
  - **Racing tired** costs up to −8%.
  - **Morale** is ±1.5%, and fitness is −6% at worst.
  - **Injury risk:** 0.4% base, multiplied by durability, fatigue, runs today and this week,
    going, ride intensity, trip and veteran age, and capped at 8%. About 3% of injuries end a
    racing career; never a life.
- **Training.** Gain = base × (1000 − r) / 400 (diminishing). A tired horse (fatigue > 600)
  gains half and risks a minor injury, at most 4 days. Yearlings may do light work only.
- **Ratings.** Elo, with 25 OR = 10:1 expected-score odds. K is 14 for the first 5 rated runs,
  then 7. A race moves a rating by at most +10/−7. Handicaps give top weight to the top
  rating and 1 lb less per OR point, from 10st 0lb down to a floor of 8st 0lb. The snapshot
  loses 5 speed and 2 burst points per extra lb.
- **Economy.** There are no time-based fees. Every cost comes from an activity.

## Tuning results

### Breeding frontier and population (`pnpm sim`)

**Setup:**
- 400 players at launch, +10% a season. The mix is 50% casual, 35% active and 15% dedicated
  breeders.
- All rules are real: packs (free every 3rd play day, plus bought ones), care-gated growth,
  the 40-start career, 4 breedings per horse, mares 1 a season, kin blocks and COI, stalls 6 →
  24 plus one nursery slot, the Legacy Farm and release to the Club.
- Pack foals are capped at 3 per player per season, which is ≈ 10,000 for ~3,300 players.
- Breeders use the exact preview (expected value + 1.5 sd) over the top 150 stallions, and
  buy better mares on the market.

| Season | Players | Active horses/player (max) | Legacy Farm/player | Foals bred (cumulative) | Pack foals | Best mean potential (gen) | Top-1% mean | Population mean |
|---|---|---|---|---|---|---|---|---|
| 1 | 400 | 5.0 (9) | 0.6 | 368 | 1,200 | 689 (g1) C | 645 | 507 |
| 2 | 440 | 7.1 (13) | 2.0 | 1,121 | 2,520 | 765 (g3) B | 676 | 513 |
| 3 | 480 | 8.2 (17) | 4.6 | 2,231 | 3,960 | 765 (g3) B | 681 | 518 |
| 4 | 520 | 9.1 (20) | 7.4 | 3,456 | 5,520 | 765 (g3) B | 694 | 521 |
| 5 | 560 | 9.5 (24) | 10.6 | 4,923 | 7,200 | **802 (g6) A** | 702 | 524 |
| 6 | 600 | 9.5 (24) | 14.2 | 6,469 | 9,000 | 802 (g6) A | 706 | 526 |
| 8 | 680 | 9.5 (24) | 20.4 | 9,786 | 12,960 | 802 (g6) A | 710 | 527 |
| 10 | 760 | 9.5 (24) | 26.2 | 13,531 | 17,400 | 809 (g11) A | 711 | 528 |

- **Grades.** The first B-grade horse appears in season 2, at generation 2. **The first
  A-grade appears in season 5 (about 4.5 months), at generation 6**, which is on the design
  target of gen 4–6. No S-grade appears in 10 seasons: the frontier levels off at about 800,
  and going further takes mutation and many more generations. That fits "S much later".
- **Pace of the top end.** The top 1% rises about +30 per season in the first seasons, then
  +5–10. Mean COI stays below 1‰, because the kin blocks and the 4-breeding limit spread the
  bloodlines.
- **Population.**
  - Active horses per player settle at about **9.5**: a 6-stall casual player has about 5–6,
    and a breeder has the cap of 24, plus one nursery foal.
  - The **Legacy Farm** grows by about 3 horses per player per season. It needs no stall,
    so there is no pressure to discard horses.
  - About 8 horses per player have been released to the Club after 10 seasons. These are
    breeders' weakest non-bound youngsters.
- **Without the vigour locus**, using the same model, the frontier stalled at 744–765 by
  generation 4 and never reached A in 10 seasons.

### Economy at target (`weeklyFlow(ACTIVE_PLAYER)`)

The active player makes about 11 Live entries a day, which fits within 10 a day plus the bank
and one refill.

| Faucets / week | Credits | Sinks / week | Credits |
|---|---|---|---|
| Live purses (77 starts, fields of 10) | 6,988 | Training (18 sessions) | 1,116 |
| Story (1 first win, 10 replays) | 900 | Entry fees (Listed/G3) | 640 |
| Daily goals (3/day × 120) | 2,520 | Breeding (0.75 covers × (1,500 + 800)) | 1,725 |
| Daily Cup participation | 560 | Paddock packs (2 × 1,200) | 2,400 |
| | | Scans, vet, refills, insurance | 1,525 |
| | | Facilities (stalls, entry tiers, trainer, vet) | 2,500 |
| **Earned** | **10,968** | **Spent** | **9,906 (ratio 0.90)** |

An idle week costs 0 credits.

### Other checks
- **The first maiden is honest but competitive.** Over 40 seeded runs with the real engine,
  the starter wins more than 15% and finishes top-3 more than 50% of the time. It is never
  guaranteed to win.
- **Packs.** The observed rates match the published odds, and the pity guarantees hold for
  any sequence (a property test).

## Contract changes proposed (not made here)

1. **`RaceEntry.weightLb?: number`** (or `speedModPermille`) in `@thoroughbred/shared`, applied
   by the engine as a cruise and top-speed penalty. Today the handicap weight and the ride hook
   (`RacePlan.rideModifierPermille`, ±50‰) are folded into the snapshot stats
   (`raceSnapshot`). That works, but it is invisible in the replay, and the engine's speed
   scale (1.05 mm/s per point) makes the penalty mild.
2. **`CoatSchema` additions:** `cremello`, `perlino`, `smoky_black`, `smoky_cream`, `bay_dun`,
   `red_dun`, `grullo`. Today they render as the nearest coat plus `maneColor`, with the true
   name in `resolveCoat(...).coatName`.
3. **Optional `HorseAppearance.look?: RigLook`**, so the viewer can pass
   `variants/morph/seed/sabino` to `factory.create(appearance, look)` without game-core.
   `rigLook(genome)` already produces it.
4. **`LifeStage`:** the shared enum has no `stud` or `pasture` stage, so game-core maps its
   stages onto `development` and `retired`. `deceased` is never used, because there is no
   death in the design.

## Notes for `packages/db`

- **Genomes.** A genome has `vigour` and `coi`. Store the full `Genome` as jsonb and validate
  it with `GenomeSchema`.
- **Horse state.**
  - `HorseState` has `location` (stable, nursery, legacy_farm or club) and `binding` (free,
    club_bred or until_5_starts).
  - `career.starts` runs from 0 to 40.
  - `condition.fatigue` is stored together with `fatigueAtMs` and recovers when it is read.
  - `pregnancy.coi` is fixed at covering.
- **Ledger.** The ledger maps 1:1 onto a postings table. Use a unique constraint on
  `idempotencyKey` and a check that each transaction's postings sum to zero.
- **Entries bank.** `EntryBank` (in `entries.ts`) is a per-stable row. Grants are idempotent
  per local date.
