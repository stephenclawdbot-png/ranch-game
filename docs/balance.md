# Balance (Milestone A demo)

How balanced the playable demo is, measured with Monte Carlo runs through the real code
(`demoData.ts` → `races.ts` → `@thoroughbred/racing-engine`), what was changed to hit the
targets, and recommendations for Milestones B and C.

All numbers are reproducible. The seeds are fixed, so a rerun prints the same tables.

```sh
# Full reports (about 3 min on 4 cores). Each one prints a table and writes
# tools/balance/out/<name>.<tag>.{txt,json}. BAL_TAG defaults to "current".
npx vitest run --config tools/balance/vitest.config.ts                # player, schedule, stats, engine, archetypes
BAL_RACES=20 npx vitest run --config tools/balance/vitest.config.ts player
BAL_FIT=1 npx vitest run --config tools/balance/vitest.config.ts fit && python3 tools/balance/fit_rating.py  # refit rating weights
python3 tools/balance/genetics_sim.py                                 # Milestone B ceiling proposal

# Regression bands (part of the normal test run, ~10 s)
pnpm --filter @thoroughbred/web test   # src/server/balance.test.ts, src/server/balance.schedule.test.ts
```

- **Harness:** `apps/web/src/server/balance/sim.ts`. It enters quick races exactly as
  `POST /api/races/quick` does and runs scheduled slots `s-N`.
- **Snapshots:** `tools/balance/out/*.before.txt` and `*.after.txt`.
- **How "before" was made:** the same harness ran on the original commit `e0ef977`. Its form-guide
  rating used that engine's constants, so favourite numbers compare like with like.

## Targets (and why)

| Area | Target | Reasoning |
|---|---|---|
| New player, quick races, default tactic | win ≈ 10% (7–15%), top-3 ≈ 30% (24–40%) | Fields have 8–12 runners, so a fair share is a 10% win and a 30% top-3. Starters are modest (see progression), so "average in maiden/novice company" is the right level. |
| First top-3 / first win | about 3–5 races / about 8–15 races | 1/p for the rates above. Early success comes fast, but a win still feels earned. |
| Best vs weakest starter | best in its niche wins ~20–30%; the weakest ~5–12%; none useless | Each archetype should have a niche, not raw power. |
| Classes (player) | maiden > novice > handicap win rate; handicap ≤ 10% | Handicaps are the stretch goal. Listed and graded are aspirational. |
| Classes (schedule) | field strength strictly ordered; handicaps competitive; graded hardest | The board should read like real racing. |
| Concentration | top rival ≤ 8% of all wins, top stable ≤ 22% | No rival horse or stable should own the results board. |
| Preferences | right trip and surface clearly better, but not decisive | "Visible, not absolute." |
| Tactics | an off-style tactic wins ≥ 50% as often as the natural one | The only choice a player makes in a quick race should not be a trap. |
| Feel | favourite (form-guide top rating) wins 25–35%; median winning margin 1–2.5 L; closers win ≥ 20% | Real betting favourites win ~33%. Our "favourite" ignores hidden day form, so it lands slightly lower. |
| Economy | no class, distance or tactic is a credit farm | Expected credits per minute are flat across what a player can steer. |

## Before → after

### New-player experience
Quick races, 10,800 races: 30 players × 6 starters × 3 tactics × 20. The "natural" rows use the
horse's own style, which is the UI default.

| Metric | Before | After |
|---|---|---|
| Win / top-3, natural tactic | 12.2% / 36.3% | **9.4% / 30.4%** |
| Win, off-style tactic | 6.4% (about half of natural) | **7.8% (83% of natural)** |
| First top-3, mean race # (rotating starters) | 1.9 | **3.2** |
| First win, mean race # | 7.1 | **11.7** (1/p = 10.7) |
| Maiden / novice / handicap win | 12.8 / 11.8 / 12.2% (class meant nothing) | **14.4 / 7.3 / 3.8%** |
| Listed quick races | 12.1% win at 4× the maiden purse | removed from quick races |
| Best / worst starter per stable (per-horse win rate) | 25.5% / 2.8% | 22.2% / 1.3% |
| Niche win rate by archetype, low to high | stayer 19.7% … sprinter 27.1% | sprinter 10.9% … frontrunner 20.5% (stayer 21.0%, closer 15.1%) |
| Overall win by archetype | stayer 7.8% … sprinter 16.3% | closer 7.3% … frontrunner/allrounder 11.2–11.5% |
| Right surface vs wrong surface | 20.2% vs 7.7% | 13.3% vs 7.2% |
| Right trip vs ±400 m off | 16.1% vs 9.4 / 11.4% | 11.9% vs 6.4 / 6.1% |

### Feel
The fairness and feel numbers come from scheduled races, 2,400 slots (5 days).

| Metric | Before | After |
|---|---|---|
| Favourite (top form-guide rating) wins | 36.3% | **24.3%** (maiden 30%, novice 23%, handicap 18.5%, listed 30%, graded 29%) |
| Upset (bottom-half rated winner) | 12.5% | 22.5% |
| Winning margin, median / mean | 4.12 L / 6.11 L | **1.92 L / 2.96 L** |
| Photo finish (< 150 mm, a nose) | 1.3% | 1.9% |
| Comeback (winner 5th or worse at 75% of the trip) | 5.0% | **17.6%** |
| Winners by tactic, front / stalker / closer | 44 / 34 / 22% | 43 / 28 / **30%** |
| Equal 650 field, 1600 m, median margin (engine) | 2.21 L | 1.11 L |

### Rival pool and scheduled races

| Metric | Before | After |
|---|---|---|
| Pool | 48 horses, uniform quality 390–700, random archetypes | 64 horses. Each stable has one horse per quality tier (460…720) and one per archetype |
| Field rating, maiden → graded | 568 / 564 / 567 / 566 / 566 (identical: class was cosmetic) | **528 / 597 / 661 / 749 / 825** |
| Top horse's share of all wins | 7.7% | 5.0% (fair share 1.6%) |
| Top-5 horses' share | 31.4% | 21.6% |
| Stable win share, min–max (fair 12.5%) | 8.5–18.7% | **9.2–15.3%** |
| Handicaps: distinct winners / favourite wins | 47 of 48 horses / 37.5% | 42 / **18.5%** |
| Graded: distinct winners / top horse share | 40 / 8.8% | 28 / 14.8% (a small elite, by design) |

### Stats and preferences (engine, controlled)
Test horse h1 against nine plain 650 horses, 240 paired seeds per cell. A fair win is 10%.

| +150 in one stat (650 → 800), gain in finishing positions at 1000 / 1600 / 2400 m | Before | After |
|---|---|---|
| speed | +1.19 / +1.27 / +1.34 | +1.86 / +2.01 / +2.27 |
| stamina | +0.11 / +0.28 / +0.75 | +0.16 / +0.67 / +1.33 |
| burst | +0.65 / +0.36 / +0.31 | +0.59 / +0.68 / +0.42 |
| durability | +0.11 / +0.12 / +0.12 (near-dead) | +0.29 / +0.30 / +0.39 |
| temperament | +0.50 / +0.30 / +0.34 | +0.37 / +0.47 / +0.17 |
| adaptability | 0 in ideal conditions (it is situational) | 0 in ideal conditions. On heavy ground: 3.3% win at 300 vs 21.3% at 900 |

| Preference at 1600 m | Before | After |
|---|---|---|
| Off-surface win, adaptability 300 / 650 / 900 (on-surface is 10–12%) | 0.4 / 1.3 / 2.9% (absolute) | 2.9 / 3.3 / 5.0% |
| Stamina 450 vs 850, 1000 m / 2400 m | 9.2 vs 12.5% / 2.5 vs 18.3% | 10.8 vs 13.3% / 0.4 vs 29.2% |
| Natural style ridden as-is vs off-style: front / stalker / closer | 11.7 vs 2.5–3.8 / 10.4 vs 2.5–4.6 / 7.5 vs 3.8–4.6% | 12.1 vs 2.9–6.3 / 10.0 vs 2.9–7.5 / 6.7 vs 6.3–7.5% |

In real fields (the quick-race tables above) the surface gap is about 2×, because many rivals are
off their surface too. In the all-on-surface lab field it is about 3.5×.

### Economy
Quick races. One race cycle is 10 s at the gate, ~102 s of racing and ~20 s of results/re-entry,
about 27 races per hour.

| Metric | Before | After |
|---|---|---|
| Credits per race, natural tactic | 466 | 263 |
| Credits per hour of active play | 12,500 | **7,200** |
| Credits per hour by distance, 1000 m … 2400 m | 23,951 … 9,890 (**sprints paid 2.4×**) | 8,572 … 7,149 (1.2×) |
| Expected credits per race by class | maiden 283, novice 391, handicap 590, listed 978 (**listed paid 3.5×** for the same win chance) | maiden 274, novice 263, handicap 242 (flat) |
| Best archetype in its niche, if it could be farmed | 803 per race | 507 per race (the player cannot choose the conditions) |

## What changed and why

### `apps/web/src/server/races.ts`
- **Class-graded fields (the main fix).** Before, every class drew a random field from the whole
  pool, so class only changed the purse.
  - `classField()` now ranks the rival pool by `raceRating` for the race's own distance, surface
    and going.
  - It draws from a rank window per class (`CLASS_WINDOW`): graded takes the top 30%, listed
    8–50%, handicap a tight 30–60%, novice 30–85% and maiden the bottom 55%.
  - Windows overlap, so a horse races in different classes as conditions change. A stayer is
    graded class at 2400 m and maiden class at 1000 m.
  - Quick-race rivals come from the same windows.
- **`raceRating()`, the form-guide rating.**
  - It is on the stat scale (a plain 650 horse in ideal conditions rates 650) and mirrors the
    engine's deterministic terms.
  - Weights come from the controlled stat experiments and a Plackett-Luce fit (`fit_rating.py`).
    It picks the winner 49% of the time in random wide fields. The fitted model also gets 49%, so
    a better linear rating does not exist.
  - It is used for field selection, favourites and the tests. The simulation never reads it.
  - `apps/web/src/lib/aptitude.ts` (another workstream) mirrors this formula. Keep them in sync.
- **Quick-race templates.**
  - Maiden and novice at every distance, plus 3 handicaps as a stretch. Listed is gone: it paid 4×
    for the same field.
  - The trip is drawn near the horse's preferred trip 3 times in 4 (weights 4/3/1 for an exact,
    200 m or 400 m match), and otherwise uniformly.
- **Purse scales with race time:** ×0.78 at 1000 m, ×1.0 at 1600 m and ×1.3 at 2400 m (`purseFor`).
  Credits per minute no longer favour sprints.

### `apps/web/src/server/demoData.ts`
- **Rival pool: 8 stables × 8 horses.**
  - Each stable has one horse per quality tier (460–720, ±25) and one per archetype, matched by a
    seeded shuffle.
  - The tiers make classes possible and stop any stable being stacked.
  - The pool seed is now `v2`, so names and ids changed. They are deterministic as before.
- **Archetype modifiers rebalanced** so each archetype rates about the same at its own trips (530–605
  at quality 550; `tools/balance/out/archetypes.after.txt`).
  - Before, sprinters (+170 speed) peaked at 666, while stayers (−110 speed) never got past 475.
  - Speed is the dominant stat at every trip, and stamina is worth only about 0.5 speed points per
    point even at 2400 m.
  - Milers and allrounders also got small trade-offs, because a flat statline isn't a niche.
- **Modest starters** (the progression decision):
  - Quality is 500–570, down from 520–620, and no stat goes above `STARTER_STAT_CAP` = 700. That is
    a mean of about 54% of max, with one strength stat at no more than 70%.
  - Starters rate at maiden/novice level: their mean ideal rating sits below the handicap field
    mean. A test enforces this.

### `packages/racing-engine` (`ENGINE_VERSION` 1.0.0 → **1.1.0**)
Two real model problems showed up in the numbers:

1. **Luck swamped racing.** In a field of identical horses, the median winning margin was 2.2 L at
   a mile and 3.7 L at 2400 m. Photo finishes happened in about 1% of races. The day-form draw
   (±450 mm/s plus up to ±350 more for a nervous horse) was ~1.4% of speed per horse per race.
   - It is now ±220 plus up to ±200 (`FORM_AMP_*`, ~0.9% of speed).
   - An equal field now finishes 0.8–1.6 L apart (median). Ability matters more, which is what
     training and breeding need.
2. **Choosing a tactic was a trap, and wrong ground was hopeless.**
   - Riding against the natural style cost ~65% of a horse's win chance. The tactic is a quick-race
     player's only decision. The style bonus is now ±15 mm/s and ±0.6% drain, down from ±40 mm/s
     and ±2%.
   - Off its surface, a horse won 0.4–2.9% against on-surface rivals. The penalty is now
     40 + 110 × (1 − adaptability) mm/s, down from 110 + 260 × (1 − adaptability).

Smaller changes:
- Durability's drain term is now (600 − dur)/6 instead of (500 − dur)/10, because it was almost
  dead weight.
- Closers sit a little closer mid-race (cr − 180 instead of cr − 220), because they won only ~22%
  of races.

All 29 engine tests pass with their original thresholds (realistic times, ability vs upsets, no
dominant tactic, the style bonus "helps a little", conditions, determinism, performance). Only the
golden literals and the version were updated. Old replays (1.0.0) will no longer verify. Quick-race
ids issued before this change decode to a different template.

### Regression tests (new)
- `apps/web/src/server/balance.test.ts` (quick races, 1,200 races) asserts:
  - win and top-3 bands;
  - first-win and first-top-3 expectations;
  - class ordering;
  - no useless or dominant archetype;
  - the trip and surface effect;
  - the off-style tactic band;
  - the starter cap;
  - favourite, margin and photo bands;
  - no credit farm by class or distance.
- `apps/web/src/server/balance.schedule.test.ts` (480 slots) asserts:
  - class strength ordering;
  - starters below handicap level;
  - horse and stable concentration;
  - handicap competitiveness;
  - favourite, margin, comeback and tactic shares;
  - purse ordering.

## Open issues
- **Sprinters convert less.** In their niche, sprinters have the best top-3 rate (39%) but the lowest
  win rate (~11%).
  - Sprints are inherently noisier: there is less time for ability to separate the field. The
    engine's 1000 m equal-field margin is 0.8 L.
  - Real sprints are chaotic too. If sprinters feel weak in playtests, give them a little more
    speed. Don't change the engine for this.
- **Front-running is the strongest intrinsic tactic.** Front-runners win 41–50% of equal mixed
  fields, against a fair 33%. Closers win 17–36%. It is within the engine test bands (12–60%) and
  realistic, but it is worth watching once players choose tactics deliberately.
- **Favourite rate is 24%, below the 30–35% ideal.**
  - The form guide cannot see day form, and class windows deliberately make fields tight. Handicaps
    are 18.5%, which is competitive by design.
  - To raise it, widen the maiden, novice and listed windows. Don't cut noise further: margins are
    already realistic.
- **Graded races are a closed shop** (28 distinct winners, top horse 15% of graded wins). That
  suits "aspirational", but with player horses in the mix later, the graded window may need
  qualification rules instead of rating rank.
- **Per-horse sample noise.** 20 races per horse cannot separate a 5% horse from a 10% one. Judge
  archetype-level and class-level numbers, not single horses.
- **Speed dominates stat value** (+150 speed ≈ 3.5× win odds; +150 of anything else ≤ 1.6×).
  - Fine for racing, but for training and breeding, speed will be the obvious pick.
  - Milestone B should price stats differently: training cost by stat value, or speed with a lower
    genetic ceiling or a slower training curve.

## Economy: credits-only faucet and sink model (Milestone C)

Decisions from the lead and user:
- Races pay only in-game **Stable Credits**. There is no prize money.
- Credits are the currency for everything: training, upkeep, entry fees, facilities, the shop and
  the player-to-player horse market. The market has a **5% fee that is burned**.
- Credits **never** convert to the token. The optional token can buy credits one way, with a weekly
  cap, plus cosmetics, a season pass and a stable licence.

Today there are **no sinks**:
- A new player starts with 3,000 credits (`STARTER_GRANT` in game-core, granted through the ledger).
- One hour of quick races adds about 7,200, with nothing to spend them on.

### Faucet model (after this pass)
- **Starters:** ~260 credits per quick race, ~7,200 per hour of active play.
- **Classes:** the expected prize per runner is about 10% of the purse (the split is 55/20/12/7/4/2
  over 8–12 runners). A horse that climbs a class earns about 1.5× per race (novice 3,000 →
  handicap 4,500 → listed 8,000 → graded 15,000 purse).
- **Weekly gross for a developed stable:**

  | Player | Play time | Weekly gross |
  |---|---|---|
  | Casual | 2 h/week | ~15k |
  | Active | 7 h/week (1 h/day) | ~50k |
  | Grinder | 20 h/week | ~145k (before the caps below) |

### Sinks
The target is sinks ≈ 0.9–1.0 × faucet for the active player over a week.

| Sink | Proposal | Active player per week |
|---|---|---|
| Upkeep (stall fee) | 120 credits per horse per day. It scales with stable size, not play time, so casual players aren't drained. | 6 horses → ~5k |
| Entry fees | maiden 0; novice 2%, handicap 4%, listed 6%, graded 8% of the purse. Higher classes pay off only for above-average horses. | ~6k |
| Training | 200 + current stat / 2 per session, with diminishing gains near potential (see Milestone B), at most 2 sessions per horse per day | ~18k |
| Foal care | 80 credits per daily care session (feed) | ~2k |
| Breeding | house stud fee 2–20k (all sink). Player stud fees are transfers with a 10% burn (game-design §7). | ~8k |
| Facilities and shop | one-off upgrades (extra stall 15k, trainer slot 25k, …) and cosmetics (0.5–5k) | ~6k |
| Market fee | 5% of every sale, burned. A 50-credit listing fee is not refunded. | volume-dependent |
| **Total** | | **~45k** (ratio ~0.9) |

Rules:
- Fixed sinks (upkeep) stay small.
- Variable sinks (entry fees, training) scale with play and with class, so the ratio holds as
  horses improve.
- Upkeep should also scale with a horse's class or rating, so an elite stable costs more to run.

### Anti-farming (bots grinding quick races to feed the horse market)
Quick races are stateless in the demo, so every rule below needs the Milestone C ledger.
1. **Diminishing purse per horse per real day.**
   - Full purse for a horse's first 6 quick races, 50% for races 7–12, 10% after that.
   - An active player (~27 races/h across 6 horses) stays at full rate for about the first 1.3 h a
     day.
   - Scheduled races are exempt: the clock already limits them.
2. **One race at a time per horse, plus recovery.** A horse is busy until its race finishes, then
   rests 5 min of real time. Later this becomes a fatigue meter that lowers day form when a horse
   is raced tired.
3. **Account daily soft cap** on quick-race credits, for example 20k per day. Beyond it, purses pay
   10%.
4. **Market guards.**
   - Accounts under 7 days or 50 races can't sell, or buy above a cap.
   - A bought horse can't be resold for 72 h.
   - Sales far outside a rating-based price band are flagged; that pattern signals off-platform
     real-money trading.
   - Trades between linked accounts are flagged (game-design §8).
5. **Rate limits** on quick-race creation per account and per IP. Settlement only after the
   replay was fetched after post time (already true).

Already done in this pass:
- Class and distance farms are removed: credits per minute are flat across what a player can
  steer.
- Listed quick races are gone.

## Progression: "from the ground up" (Milestone B recommendations)

### Where the demo stands
- Starters average ~54% of max, with one niche stat up to 70%.
- To move up, a starter (rating ~540) needs about +60 rating for novice, +120 for handicap, +210 for
  listed and +285 for graded. Class field means are 528 / 597 / 661 / 749 / 825.
- Rating points ≈ speed points. As a rule of thumb, +100 effective rating ≈ one class.

### Genetic ceiling proposal
`tools/balance/genetics_sim.py` uses a 2,000-horse population, the top 10% bred best-to-best and a
4-breeding limit per horse.

| Parameter | Proposal |
|---|---|
| Launch cap (starters, packs, studio releases) | mean potential ≤ 600; any single stat ≤ 700 |
| Foal potential per stat | midparent + 5% regression toward the population mean + segregation variance ("nick") of ±80 for the whole horse + ±40 per stat |
| Over-parent bound | foal stat ≤ max(sire, dam) + 40; hard cap 1000 |
| Result | best horse reaches B (700) in gen 2, **A (800) in gen 6**, S (900) in gen 10. The population mean rises ~+15 per generation. |

**Implemented (2026-10-29): family limits** (game-core `familyRange`, owner ask "a possible lower
and upper limit of breeding with consideration to lineage and family"). Per stat allele, from the
parents and the four grandparents:
- **Upper limit:** best parent allele + 40 for an established line; a rising line (parents well
  above their own parents) keeps only +10..+40 (`40 − spike/5`).
- **Lower limit:** weakest parent allele − 40; a strong family (centre − 60 above that) protects it
  up to the weakest parent allele; inbreeding lowers it by COI/10.
- **Lean:** mutations lean back toward the family centre (parents 2/3, grandparents 1/3): +6%
  negative share per 10 above it. Mendelian segregation is unchanged.
- The breeding preview shows the reachable extremes ("lowest / highest possible", per stat and
  overall) and the line type (established / rising / foundation stock).
- A best-to-best selection test bounds the frontier at +40 per generation.

**Important:** with only the rare ±0–30 mutation (game-design §3) and no segregation variance, the
frontier **stalls**: +5 per generation, best horse 634 after 10 generations. The two-allele genome
must supply real segregation variance, or A-grade horses never appear.

**Pace:**
- Pregnancy takes 24–48 h.
- A foal needs ~14 counted care days to become racing-ready, plus a week proving itself.
- So a generation takes ~3–4 weeks: first A-grade horses ~4–6 months after launch, S-grade much
  later.

### Foal care (user decision)
- A foal grows only through **daily care sessions**: one counted per real day per horse.
- A missed day **pauses** growth and never harms the foal.
- Pregnancy waits 24–48 h. Breeding is limited to **4 per horse**.
- Suggested: 14 counted sessions to maturity, and care quality adds up to +5% of potential realised
  (game-design §4).

### Aging, growth and training
- **Current stat** = potential × maturity curve × training. Suggested maturity curve:
  - 2-year-old: 80%;
  - 3-year-old: 95%;
  - 4–5: 100%;
  - 6: 97%;
  - veteran: −3% a year.
- **Training** closes 3–5% of the gap to potential per session. It never exceeds potential, so the
  ceiling is genetic and training only realises it.
- **Breeding inheritance balance.** Speed dominates race value, so breeders will select for speed
  alone. Options:
  - give speed lower segregation variance;
  - charge more to train speed;
  - make stamina and adaptability matter more on class-defining races (staying graded races, soft
    ground).

  Re-run `stats.report.ts` after any engine change. It shows each stat's value in speed points.
