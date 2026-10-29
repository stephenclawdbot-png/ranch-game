# Knobs registry

Every tunable value that shapes play and the economy in Post Time, with where it lives and what
it moves. Built for planning balance changes and wiring a simulation harness.

- **Source of truth:** the code at `de561a4` (2026-10-29), read directly. Commit `89e8d9a`
  ("Beta pacing") changed the Live card from one race every 3 minutes to one every 15 minutes
  and the published card from 30 minutes to 6 hours ahead. Where that changed a value, the
  pre-`89e8d9a` value is noted as "was". The beta loop commits that followed (`6420a5f` one Live
  start a day, National licence for the Weekend Feature, stud fee ceiling; `0110fe7` This week,
  Saturday Plate, League floors and best-20 scoring, Sunday recap; `3659516` Cup points settled
  daily) are folded in, and every file:line was re-checked against `3659516`. A companion map
  of loops and flows is [`GAME-SYSTEMS.md`](GAME-SYSTEMS.md).
- **Units:** credits are Stable Credits (never cashable). "permille" = parts per 1,000, "bps" =
  parts per 10,000. Stats, potentials and realisation are on a 0..1000 scale (650 = a plain
  horse in the engine). OR = official rating (0..140).
- **Live vs model:** game-core holds both live rules and a *model* (tier purses, `TIER_CYCLE`,
  `weeklyFlow`). The Live card is built by `packages/db/src/services/card.ts`, and its numbers
  win wherever they differ. See [Live vs model mismatches](#live-vs-model-mismatches).
- **Runtime overrides:** only the affiliate config (`economy_config` key `beta.affiliate`), the
  seller policy, playtest cap and chain settings (environment variables) can change without a
  deploy. `getConfig`/`setConfig` (`packages/db/src/services/competition.ts:178`) exist but no
  game rule reads them.

Paths are repo-relative. `gc` = `packages/game-core/src`, `db` = `packages/db/src`,
`web` = `apps/web/src/server`, `eng` = `packages/racing-engine/src`. Full paths are used in the
Where column.

---

## 1. Time and schedule

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `SEASON_DAYS` | 28 days | packages/game-core/src/time.ts:12 | Length of a competition season (leagues, Features, Final, titles, breeding cap, crop cap). | Season Final frequency, breeding covers per mare per year, foal crop per season, potential ceiling growth |
| `RULES.seasonEpochMs` | 2026-01-05 00:00 UTC (a Monday) | packages/db/src/rules.ts:86 | Start of season 1; slot indices and season numbers count from here. | Which season it is (mint ceilings), calendar alignment |
| `RULES.seasonMs` | 28 × 24 h (literal) | packages/db/src/rules.ts:87 | Season length on the database side. Duplicates `SEASON_DAYS`. | Same as `SEASON_DAYS` |
| `SLOT_INTERVAL_MS` | 15 min (was 3 min) | packages/game-core/src/seasons.ts:20 | Time between Live races; `RULES.slotMs` now reads it. | Races/day, credits created/day, field size (players spread over fewer or more races), house-horse minting |
| `RULES.slotMs` | `gc.SLOT_INTERVAL_MS` (was a literal 3 min) | packages/db/src/rules.ts:73 | Slot length the live card and slot keys use. | As above |
| `SLOTS_PER_DAY` | 96 (was 480) | packages/game-core/src/seasons.ts:22 | Derived races per day per course. | Credits created/day, entries demand |
| `ENTRY_CLOSE_BEFORE_MS` / `RULES.entriesCloseBeforePostMs` | 30 s | packages/game-core/src/seasons.ts:21, packages/db/src/rules.ts:74 | Entries close this long before the off; fields lock then. | Last-minute entries, field size |
| `RULES.cardHorizonMs` | 6 h (was 30 min) | packages/db/src/rules.ts:80 | How far ahead the card is published (entries open at publication). 6 h = 24 races at 15 min. | Field size (entries accumulate longer), how far ahead players plan |
| `RULES.settleAfterPostMs` | 150 s | packages/db/src/rules.ts:84 | Cron backstop settles races this long after the off (the web tick settles as soon as the broadcast ends). | Result latency |
| `TICK_EVERY_MS` | 4 s | apps/web/src/server/game.ts:219 | Per-instance throttle on the lazy card tick. | Server load, lock/settle latency |
| `RULES.minField` | 8 | packages/db/src/rules.ts:81 | Lowest target field for an ordinary card race (house horses fill to the target). | Field size, house-horse population, purse share per runner |
| `RULES.maxField` | 12 | packages/db/src/rules.ts:82 | Gate count of an ordinary card race; also the target for calendar races. | Field size, sister-course trigger |
| Target runners per slot | `8 + h[29] % 5` → 8..12 | packages/db/src/services/card.ts:260 | Each slot's target field is drawn from the slot hash. | Field size, expected prize per run |
| `CARD_CYCLE_SLOTS` | 20 | packages/db/src/services/card.ts:87 | Length of the class cycle (5 h at 15 min; was 1 h at 3 min). | Class mix per day |
| `CYCLE` (class pattern of each 5-hour cycle, live) | slot 0 Feature; Maiden ×6 (1,4,7,10,13,16); Novice ×6 (2,5,8,12,15,18); Hcp 0-55 ×2 (3,14); Hcp 50-75 ×2 (6,17); Hcp 70-95 ×2 (9,19); Listed ×1 (11) | packages/db/src/services/card.ts:82 | The live class rotation: 12 of 20 slots are juvenile-friendly (maiden/novice). | Field size per class, credits/day, League movement (tier bonus races), qualifier count |
| Feature class | 50% Listed / 50% Group 3 (`h[30] % 2`) | packages/db/src/services/card.ts:223 | Slot 0 of each cycle is a Feature of a random class. | Credits/day (Feature pays 2×), National licence (level 3) demand |
| `JUVENILE_TRIPS` | 1000, 1500, 2000, 2400 m | packages/db/src/services/card.ts:99 | Trips of maiden/novice slots; the k-th juvenile slot runs surface k mod 3, trip k mod 4, so 12 juvenile slots cover all 12 surface×trip pairs. | Form-guide fit for new horses, entries per horse |
| Juvenile going / weather | turf: good, good, firm; others good; weather clear, clear, overcast, dusk | packages/db/src/services/card.ts:229, :234 | Juvenile races never run soft/heavy or in rain. | Injury rate (going), upset rate (rain) |
| `OPEN_TRIPS` | 1000..3200 m (10 trips) | packages/db/src/services/card.ts:101 | Trips for handicaps, Listed and Features. | Distance-fit, stayers' opportunities |
| `GOING` (open races) | turf firm/good/good/soft/heavy; dirt good×3/heavy; synthetic good | packages/db/src/services/card.ts:102 | Going draw for non-juvenile races. | Injury rate (firm 1.3×, heavy 1.4×), quirk reveals (mudlark) |
| `WEATHER` (open races) | clear, clear, overcast, rain, dusk | packages/db/src/services/card.ts:103 | Weather draw; rain widens day-form noise by 25% in the engine. | Upset rate |
| Open-race surface | `SURFACES[(cycle*8 + pos + h[28]%3) % 3]` | packages/db/src/services/card.ts:239 | Surface of non-juvenile slots. | Surface-fit |
| `CARRY_LOOKBACK` | 16 slots | packages/db/src/services/card.ts:271 | A juvenile race displaced by a calendar race (Qualifier, Weekend Feature, Saturday Plate, Final; `isCalendarSlot`, :137) runs in the next ordinary handicap/Listed slot, looking back 16 slots. | Juvenile trip coverage on Feature/Final days |
| `TRACKS` | Ashcombe, Kestrel Downs, Saltmarsh, Bellmont, Larkspur, Harrowgate | packages/db/src/services/card.ts:92 | Course names; also the order sister courses are opened in. | Max sister courses (6 courses) |
| `SISTER_MAX` | 5 sisters per slot | packages/db/src/services/card.ts:319 | A slot can spawn up to 5 copies on other courses (6 races total). | Field size cap per slot (6 × 12 = 72 runners), credits/day (each sister pays a full purse) |
| Sister trigger | when entries reach `maxRunners − 1` | packages/db/src/services/races.ts:331 | A sister course opens when a race is one gate from full. | Field size, credits/day |
| Calendar track | Final/Weekend Feature/Saturday Plate at Ashcombe, Qualifiers at Bellmont | packages/db/src/services/card.ts:170, :141 | Course of calendar races. | Cosmetic |
| `featureCalendar` qualifiers | Mon-Fri 19:01:30 UTC, Listed, `PURSE_BY_TIER.listed` (model) | packages/game-core/src/seasons.ts:167 | Five Feature Qualifiers per week (not on the season's last day). | Qualifier count, Weekend Feature field |
| `featureCalendar` Weekend Feature | Saturday 19:01:30 UTC, G1, `WEEKEND_FEATURE_PURSE` (model) | packages/game-core/src/seasons.ts:169 | One Weekend Feature per week; division drawn per week. | League points (G1 bonus), credits |
| Feature division | one division per week, seeded | packages/game-core/src/seasons.ts:160 | Sprint/mile/middle/staying for that week's Qualifiers and Feature; trip = middle of the division's list. | Which horses can compete |
| Season Final times | last season day, 18:01:30 UTC + 30 min per division (4 races) | packages/game-core/src/seasons.ts:175 | Four championships (sprint, mile, middle, staying). | Season Final entrants, credits |
| Calendar surfaces | Final: sprint on dirt, others turf; Features/Qualifiers turf | packages/game-core/src/seasons.ts:132 | Surface of calendar races. | Which horses can win them |
| Calendar field size (model) | 14 for Final/Weekend Feature, else 12 | packages/game-core/src/seasons.ts:148 | `maxRunners` for calendar races (card caps at 16). | Field size |
| Calendar `targetRunners` (live) | `RULES.maxField` = 12 | packages/db/src/services/card.ts:189 | House horses fill calendar races to 12, not 14. | Field size |
| `CALENDAR_PURSE` (live) | Qualifier 16,000; Weekend Feature 48,000; Final 72,000 | packages/db/src/services/card.ts:63 | Live purses of calendar races (Listed ×2, G3 ×2 ×2, G3 ×2 ×3). | Credits created/week |
| Calendar min rating (live) | Final/Weekend Feature 95; Qualifier 85; Saturday Plate none | packages/db/src/services/card.ts:176 | Entry conditions of calendar races. A top-3 Qualifier finisher rated 85-94 is qualified for the Weekend Feature but still below its 95 band. | Who can enter, qualifier count |
| `PLATE_AFTER_SLOTS` | 2 slots (30 min at 15-min slots) | packages/db/src/services/card.ts:124 | The Saturday Plate runs this many slots after the Weekend Feature (`plateSlotAt`, :131; skipped if another calendar race holds that slot). | Second chance for qualifier runners, Saturday credits |
| Saturday Plate conditions (live) | kind `scheduled`, class Listed (1 entry, 120 fee, National licence), the Weekend Feature's trip, surface and going, `RULES.maxField` 12 runners, purse `CALENDAR_PURSE.feature_qualifier` 16,000 | packages/db/src/services/card.ts:139-164 | The consolation race for horses that ran in that week's Qualifiers and did not qualify (calendar kind `weekend_plate`). | Credits created/week, League points (Listed bonus) |
| `TIER_CYCLE` (model only) | 20-slot rotation incl. 4 Quick, G3 at slot 18 | packages/game-core/src/seasons.ts:25 | The model rotation used by `regularSlot`; not used by the live card. | Model only (economy-sim, tests) |
| `G2_HOURS` / `G1_HOURS` (model only) | 2, 8, 14, 20 / 21 UTC | packages/game-core/src/seasons.ts:48, :49 | Model upgrades slot 18 to G2/G1; the live card has no hourly G2/G1. | Model only |
| `DISTANCES` | sprint 1000-1200, mile 1400-1600, middle 1800-2200, staying 2400-3200 | packages/game-core/src/seasons.ts:51 | Division trip lists (calendar races, Daily Cup, model slots). | Distance-fit |
| Model weather/going | weather 3/7 clear, 2/7 overcast, 1/7 rain, 1/7 dusk; rain → heavy 40% else soft; firm 25% turf / 15% dirt | packages/game-core/src/seasons.ts:61-64 | Going for calendar races and the Daily Cup is drawn here. | Injury rate in calendar races |

## 2. Entries

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `ENTRY_DAILY_BASE` | 10 / local day | packages/game-core/src/entries.ts:16 | Live entries granted per local day (missed days still grant, up to the cap). | Starts per player/day, credits created/day, field size |
| `ENTRY_BANK_BASE` | 20 | packages/game-core/src/entries.ts:17 | Bank cap at tier 0 (unused entries roll over to this). | Catch-up after absence, starts/day |
| `ENTRY_DAILY_MAX` / `ENTRY_BANK_MAX` | 15 / 30 | packages/game-core/src/entries.ts:18, :19 | Ceilings after facility upgrades. | Starts/day for invested players |
| `ENTRY_FACILITY_TIERS` | 5 | packages/game-core/src/entries.ts:20 | Entry facility tiers: +1 allowance and +2 cap per tier. | Starts/day |
| Cap step per tier | +2 | packages/game-core/src/entries.ts:44 | Bank cap growth per tier. | Starts/day |
| `ENTRY_TIER_COST` | 4,000 / 7,000 / 11,000 / 16,000 / 22,000 (60,000 total) | packages/game-core/src/entries.ts:25 | Credit price of each entry tier (burned). | Credit sink, starts/day |
| `ENTRY_REFILL_AMOUNT` | +5 | packages/game-core/src/entries.ts:21 | One refill per local day. | Starts/day |
| `ENTRY_REFILL_BELOW` | bank < 5 | packages/game-core/src/entries.ts:22 | Refill only while the bank is low. | Refill sink volume |
| `ENTRY_REFILL_COST` | 250 credits | packages/game-core/src/entries.ts:23 | Refill price (burned). | Credit sink |
| `entryCost` (model) | Story/Cup/Trial 0; Weekend Feature, Final, G1-G3 2; else 1 | packages/game-core/src/entries.ts:66-70 | Entries a race costs in the model. | Starts/day |
| `entryCostFor` (live) | Story (`quick`), Cup, Trial 0; kind `feature`/`final` or class `graded` 2; else 1 | packages/db/src/services/races.ts:34 | Entries a Live race costs. The cycle's Listed Features cost 2 here. | Starts/day, Feature participation |
| `cardEntryFee` (credits, live) | Listed 120, Group 3 200, G1 (Weekend Feature, Final) 500; else 0 | packages/db/src/services/card.ts:70 | Credit entry fee on top of stable entries (burned; refunded if abandoned). | Credit sink |
| `ENTRY_FEE_BY_TIER` | listed 120, g3 200, g2 320, g1 500, others 0 | packages/game-core/src/economy.ts:42 | Fee table `cardEntryFee` reads. | Credit sink |
| `TZ_CHANGE_MIN_DAYS` | 30 days | packages/game-core/src/entries.ts:96 | Timezone (local-day boundary) change cooldown. | Daily-grant gaming |
| One horse per stable per Live race | rule | packages/db/src/services/races.ts:301 | A stable can enter one horse in each Live race. | Field diversity, starts/day |
| Half-field cap | stable ≤ `floor(targetRunners/2)` | packages/db/src/services/races.ts:306 | One stable may not fill more than half a field. | Field size |
| `STABLE_DAILY_ENTRIES` / refill size (dead proposal) | 10 / 5 | packages/game-core/src/eligibility.ts:117, :120 | Older per-day budget helper; not used by the live bank. | None (duplicate) |

## 3. Horse lifecycle

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `CARE_TO_WEAN` | 5 care sessions | packages/game-core/src/lifecycle.ts:26 | Foal → weanling. | Time to racing, foal quality reveal width |
| `CARE_TO_YEARLING` | 12 | packages/game-core/src/lifecycle.ts:27 | Weanling → yearling (light training allowed). | Time to racing |
| `CARE_TO_RACING` | 19 (one counted session per horse per local day) | packages/game-core/src/lifecycle.ts:28 | Yearling → juvenile: racing age. A pack or bred foal needs 19 real days. | Horse population entering racing, time-to-value of packs and foals |
| `CAREER_MAX_STARTS` | 40 rated starts | packages/game-core/src/lifecycle.ts:30 | Mandatory racing retirement (also a DB CHECK). | Horse population turnover, stud supply, appraisal |
| `JUVENILE_MAX_STARTS` | 6 | packages/game-core/src/lifecycle.ts:31 | Juvenile stage (0-6 starts); peak maturity windows key off starts. | Stage, appraisal factor |
| `PRIME_MAX_STARTS` | 28 | packages/game-core/src/lifecycle.ts:32 | Prime 7-28, veteran 29-40 (veteran injury ×1.2). | Injury rate, appraisal (veteran 75%) |
| `MAX_STARTS_PER_DAY` / `RULES.startsPerDay` | 3 per horse per UTC day | packages/game-core/src/lifecycle.ts:36, packages/db/src/rules.ts:31 | Hard cap on a horse's races per day, Live and Story together (enforced packages/db/src/services/races.ts:287; `startsOnDay` ignores scratched entries, packages/db/src/services/horses.ts:259). | Story races per day, injury rate (frequency factor) |
| `MAX_LIVE_STARTS_PER_DAY` / `RULES.liveStartsPerDay` | 1 Live race (kinds scheduled, feature, final) per horse per UTC day (new 2026-10-29; Live was limited only by the cap of 3) | packages/game-core/src/lifecycle.ts:44, packages/db/src/rules.ts:33 | One Live race a day; Story races don't count towards it but share the cap of 3. Enforced in `enterRace` (packages/db/src/services/races.ts:290) and shown on the entry sheet as "Already raced Live today" (apps/web/src/server/game.ts:667). The harness saw grinders run horses Live ~2× a day and burn a career in ~2.5 weeks. | Career length in days (40 Live starts ≥ 40 days), starts/day per horse, value of a bigger string, injury rate |
| `BREED_FROM_STARTS` | 25 | packages/game-core/src/lifecycle.ts:34 | Racing horses may breed from 25 starts; retired horses any time. | Stud supply, foal crop |
| `BREEDINGS_LIFETIME` | 4 | packages/game-core/src/lifecycle.ts:45 | Coverings per horse for life (also a DB CHECK). The last covering retires a stallion to pasture. | Foal crop, horse population, stud fees |
| `PREGNANCY_MS` | 24 h | packages/game-core/src/lifecycle.ts:46 | Covering → foal. | Foal crop timing |
| `INITIAL_OR` | 40 | packages/game-core/src/lifecycle.ts:48 | Starting rating of every new horse (incl. house horses and studs). | Class entry, sandbagging (ability floor counters it) |
| Display age | care <12 → 0, <19 → 1; starts ≤6 → 2, ≤14 → 3, ≤21 → 4, ≤28 → 5, ≤34 → 6, else 7 | packages/game-core/src/lifecycle.ts:87-97 | Age shown on the card (career clock, not calendar). | Cosmetic |
| Stage of a retired horse | stud while breedings remain, else pasture | packages/game-core/src/lifecycle.ts:61 | Retired horses with breedings left stay in the stable (stall) as stud/broodmare. | Stall pressure |
| Legacy Farm (pasture) | no stall; permanent | packages/game-core/src/lifecycle.ts:226, packages/db/src/services/accounts.ts:164 | Pensioned, spent or fatally injured horses leave the stall count. | Stall pressure, horse population (active) |
| `RELEASE_TO_CLUB_CREDITS` / `RULES.releasePayout` | 50 credits | packages/game-core/src/lifecycle.ts:240, packages/db/src/rules.ts:47 | Paid for releasing a horse to the Club (ledger kind `adjustment`). | Credits (small faucet), population |
| `RULES.starterHorses` | 3 (bound, racing age) | packages/db/src/rules.ts:50 | Starter horses per new stable. | Horse population per account |
| `STARTER_PLAN` | Quarter Horse common colt, Thoroughbred uncommon filly, Arabian common colt | packages/game-core/src/onboarding.ts:26 | Breed/rarity/sex of the starters. | Foal quality of first breedings |
| Gift foal | from the 2nd UTC day; 60% common / 40% uncommon; Club-bred | packages/game-core/src/onboarding.ts:90-111 | One free foal per account (needs a stall or the overflow slot). | Horse population |
| `RULES.nurseryOverflowSlots` | 1 | packages/db/src/rules.ts:54 | A covering (and the gift foal) may use one slot beyond the stalls. | Stall pressure |
| Foal binding | foal of a Club-bred parent: tradeable after 5 starts | packages/db/src/services/breeding.ts:303 | Free-pack, starter and gift lines are not sellable until bred on. | Market supply |

## 4. Care, condition and training

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `FEEDS` / recommended feed | growing → growth_mix; injured or fatigue > 400 → recovery; stud/pasture → maintenance; else performance | packages/game-core/src/lifecycle.ts:166, :173 | The "right" feed for a session. | Care quality → realised stats |
| Care quality per session | right feed 1000, maintenance 650, wrong 450 | packages/game-core/src/lifecycle.ts:181-183 | Quality of one session (rolling 3:1 average). | Realised stats (care bonus) |
| Care quality rolling average | `(q_old×3 + q)/4` | packages/game-core/src/lifecycle.ts:209 | How fast care quality moves. | Realised stats |
| `careBonus` | up to +50 permille realisation (quality × 50/1000) | packages/game-core/src/lifecycle.ts:188 | Care adds to training realisation. | Race strength |
| Bond per care / training / race | +6 / +2 / +4 (+10 for a win) | packages/game-core/src/lifecycle.ts:210, packages/game-core/src/training.ts:192, packages/game-core/src/career.ts:74 | Bond feeds morale (bond/40 up to +25). | Race strength (±1.5% via morale) |
| `CARE_HEAL_BONUS_H` | +12 h healing per counted care | packages/game-core/src/condition.ts:218 | Care shortens injury recovery. | Injury downtime |
| `FATIGUE_RECOVERY_PER_HOUR` | 12 per hour (1000 → 0 in ~3.5 days) | packages/game-core/src/condition.ts:19 | Real-time fatigue recovery. | Starts/day sustainable, injury rate |
| `TIRED_THRESHOLD` | 300 | packages/game-core/src/condition.ts:21 | Above this fatigue costs performance and raises injury risk. | Race strength, injury rate |
| `TIRED_MAX_PENALTY` | 80 permille at fatigue 1000 | packages/game-core/src/condition.ts:23 | Max performance loss from fatigue. | Race strength |
| `FRESHNESS_PEAK_BONUS` | +25 permille, 72-120 h after hard work (ramps from 48 h, gone by 192 h) | packages/game-core/src/condition.ts:25, :46-54 | Supercompensation peak. | Race strength, race timing |
| Fitness factor | 940 + 60 × fitness/1000 permille | packages/game-core/src/condition.ts:92 | Unfit horse runs at 94%. | Race strength |
| Morale | last 5 runs: win +20, 2nd-3rd +10, back half −8; + bond/40; clamp ±100; effect ±15 permille | packages/game-core/src/condition.ts:77-87 | Form loop. | Race strength |
| Race fatigue | `(150 + distance/10) × (1300 − 0.6×durability)/1000` | packages/game-core/src/career.ts:56 | Fatigue from one run (~350 at 2000 m for an average horse). | Starts/day, injury rate |
| Race fitness | +40 per run | packages/game-core/src/career.ts:73 | Racing keeps a horse fit. | Race strength |
| `WORKOUTS` speed_work | speed +30, burst +12; fatigue 260; fitness +60; hard; 90 credits | packages/game-core/src/training.ts:37 | Workout gains and cost. | Realised stats, credit sink |
| `WORKOUTS` stamina_gallops | stamina +30, durability +10; fatigue 240; +80; hard; 60 | packages/game-core/src/training.ts:38 | | Realised stats, credit sink |
| `WORKOUTS` gate_practice | temperament +24, burst +10; fatigue 90; +15; light; 40 | packages/game-core/src/training.ts:39 | | Realised stats, credit sink |
| `WORKOUTS` swimming | stamina +14, durability +14; fatigue 70; +50; light; 50 | packages/game-core/src/training.ts:40 | | Realised stats, credit sink |
| `WORKOUTS` rest | fatigue −200; free | packages/game-core/src/training.ts:41 | | Fatigue, injury rate |
| `WORKOUTS` race_prep | speed/stamina/burst/adaptability +10; fatigue 160; +70; hard; 70 | packages/game-core/src/training.ts:42 | | Realised stats, credit sink |
| `BASE_SLOTS` | 3 sessions / horse / week (+1 with any trainer level) | packages/game-core/src/training.ts:45, :52 | Weekly training cap per horse. | Credit sink volume, realised stats |
| `TRAINER_EFFICIENCY_PER_LEVEL` | +100 permille per level, max 2 levels (+20%) | packages/game-core/src/training.ts:47, :137 | Trainer facility boosts gains. | Realised stats |
| `REALISATION_CURVE` | 400 (gain = base × (1000 − r)/400) | packages/game-core/src/training.ts:49 | Diminishing returns near full realisation. | Realised stats ceiling speed |
| Starting realisation | 600 per stat | packages/game-core/src/lifecycle.ts:134 | New horses start 60% realised. | Race strength of new horses |
| `TRAINING_WEIGHT_PERMILLE` | 200 | packages/game-core/src/phenotype.ts:72 | Realisation moves the top 20% of a stat. | How much training matters |
| Overwork | hard work at fatigue > 600 gains half | packages/game-core/src/training.ts:136 | | Realised stats |
| Yearling efficiency | half; light work only | packages/game-core/src/training.ts:139 | | Realised stats |
| `OVERWORK_INJURY_MAX_PERMILLE` | 60 at fatigue 1000; starts above fatigue 500; scaled by (1500 − durability) | packages/game-core/src/training.ts:116, :146 | Chance of a minor training injury (capped at 4 days). | Injury rate |
| `RACE_EXPERIENCE` | speed/stamina/burst +6, durability +5, adaptability +12, temperament +10 (base gains per start) | packages/game-core/src/training.ts:212 | Racing realises stats. | Realised stats |
| `PEAK_WINDOW` | early 6-18, normal 10-28, late 16-34 starts | packages/game-core/src/phenotype.ts:33 | Maturity curve peak by type. | Race strength over a career |
| `JUVENILE_BASE` / `TYPE_BASE_SHIFT` | 820-900 permille of potential; early +40, late −50 | packages/game-core/src/phenotype.ts:37, :38 | Maturity before the peak. | Juvenile race strength |
| `CAREER_END_LEVEL` / `TYPE_END_SHIFT` | 860-1000; early −40, late +20 | packages/game-core/src/phenotype.ts:40, :41 | Decline after the peak. | Veteran race strength |
| Ride intensity | all_out: burst +25, temperament −20; conservative: burst −20, stamina +10 | packages/game-core/src/phenotype.ts:226-229 | Plan intensity changes the snapshot. | Race strength, injury rate (intensity factor) |
| `RIDE_MODIFIER_MAX_PERMILLE` | ±50 (dormant: `parsePlan` drops it) | packages/game-core/src/types.ts:326, apps/web/src/server/horseView.ts:21 | Hook for a skill-based ride bonus. | None live |
| `STABLE_HAND_COST` | 2,500 credits once | packages/db/src/services/horseLife.ts:44 | One-tap care for all horses. | Credit sink, care consistency |

## 5. Injury and insurance

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `BASE_INJURY_PERMILLE` | 4 (0.4% per start) | packages/game-core/src/condition.ts:118 | Base injury chance per rated start. | Injury rate |
| `MAX_INJURY_PERMILLE` | 80 (8%) | packages/game-core/src/condition.ts:119 | Cap after all factors. | Injury rate |
| Durability factor | `1600 − durability` permille (1.6× at 0, 0.6× at 1000) | packages/game-core/src/condition.ts:158 | Sound horses get hurt less. | Injury rate, value of durability breeding |
| Fatigue factor | 1 + 2 × (fatigue − 300)/700 (up to 3×) | packages/game-core/src/condition.ts:161 | Tired horses get hurt more. | Injury rate |
| Frequency factor | +0.4 per run already today; +0.1 per run over 6 in 7 days | packages/game-core/src/condition.ts:166 | Racing often is risky. | Injury rate, starts/day |
| `GOING_RISK` | firm 1.3, good 1.0, soft 1.1, heavy 1.4 | packages/game-core/src/condition.ts:120 | Going factor. | Injury rate |
| `INTENSITY_RISK` | conservative 0.7, normal 1.0, all_out 1.5 | packages/game-core/src/condition.ts:121 | Ride factor. | Injury rate |
| Distance factor | ×1.1 over 2400 m | packages/game-core/src/condition.ts:172 | Long trips are riskier. | Injury rate |
| `FRAGILE_RISK` | ×1.3 | packages/game-core/src/condition.ts:127 | Inherited fragile legs. | Injury rate |
| `IRON_LEGS_RISK` | ×0.8 | packages/game-core/src/genome.ts:211, packages/game-core/src/condition.ts:175 | Inherited iron legs (genetics v2, dominant). | Injury rate |
| Veteran factor | ×1.2 (29+ starts) | packages/game-core/src/condition.ts:176 | Older legs. | Injury rate |
| Risk labels | <5 low, <12 moderate, <25 elevated, else high | packages/game-core/src/condition.ts:183 | Entry-sheet label. | Player risk-taking |
| `CAREER_ENDING_SHARE` | 30 permille of injuries; +30 if fatigue > 700, +20 if all_out; cap 200 | packages/game-core/src/condition.ts:123, :182 | Share of injuries that end the career. | Career-ending rate, insurance payouts, population |
| Moderate share | 30% of non-career-ending injuries (rest minor) | packages/game-core/src/condition.ts:197 | Severity mix. | Injury downtime |
| `FATAL_SHARE_OF_CAREER_ENDING` | 200 permille (Live races only) | packages/game-core/src/condition.ts:125 | 20% of career-ending injuries in Live races are fatal. | Fatality rate, population |
| `INJURY_DAYS` | minor 2-4, moderate 6-12, career-ending 14-21, fatal 21 days | packages/game-core/src/condition.ts:187 | Recovery time by severity. | Starts/day, entries used |
| Vet healing | +25% speed per vet level (max 3) | packages/game-core/src/condition.ts:200, :206 | Vet facility speeds healing. | Injury downtime |
| `VET_HEAL_BONUS_H` / `VET_TREATMENT_COST` | +24 h per treatment / 150 credits (once per injury per local day) | packages/game-core/src/condition.ts:220, packages/game-core/src/economy.ts:68 | Paid treatment. | Credit sink, downtime |
| Story races | never fatal; unrated trials carry no injury roll | packages/game-core/src/career.ts (applyRun) | Fatal roll only when tier ≠ quick. | Fatality rate |
| `INSURANCE_PREMIUM_PERMILLE` | 50 (5% of appraisal), one-off, to treasury | packages/game-core/src/economy.ts:71, packages/db/src/services/horses.ts:237 | Insure a racing horse once. | Credit sink |
| `INSURANCE_PAYOUT_PERMILLE` | 600 (60% of appraisal) on career-ending or fatal injury | packages/game-core/src/economy.ts:72, packages/db/src/services/races.ts:664 | Payout minted to the owner. | Credits created |
| `RULES.insurancePremium` / `insurancePayout` | 300 / 2,000 flat | packages/db/src/rules.ts:36, :37 | Fallback for horses without a real genome only. | Legacy rows only |
| `RULES.careHealMs` | 12 h | packages/db/src/rules.ts:61 | Healing per care for rows without a genome (duplicate of `CARE_HEAL_BONUS_H`). | Legacy rows only |

## 6. Racing engine

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `ENGINE_VERSION` | "1.1.0" | packages/racing-engine/src/simulate.ts:19 | Replays verify against this; any model change must bump it. | Replay verification |
| `TICK_HZ` / `MAX_TICKS` | 20 Hz / 600 s | packages/racing-engine/src/model.ts:11, :16 | Simulation step and cap. | Determinism |
| `PAR_AT_1000` / `PAR_SLOPE` | 16,920 mm/s; −800 mm/s per 1000 m (+250/km beyond 2400 m) | packages/racing-engine/src/model.ts:20, :22, :77 | Par cruising speed by trip. | Race times, record times (Hall of Fame) |
| `SPEED_PER_100` | 105 mm/s per 100 speed above 650 | packages/racing-engine/src/model.ts:24 | Value of the speed stat. | Which stat wins races |
| `GOING_ADJ` | firm +120, good 0, soft −320, heavy −680 mm/s | packages/racing-engine/src/model.ts:26 | Track speed by going. | Race times |
| `GOING_HORSE_PEN` | soft 140, heavy 300 × (1 − adaptability) | packages/racing-engine/src/model.ts:27 | Going hurts non-adaptable horses. | Upsets on soft/heavy |
| Off-surface penalty | 40 + 110 × (1 − adaptability) mm/s | packages/racing-engine/src/model.ts:29, :30, :92 | Running on a non-preferred surface. | Surface-fit importance |
| Shorter than preferred trip | cruise − delta × (1100 − adaptability)/6000 | packages/racing-engine/src/model.ts:95 | Distance mismatch (too short). | Distance-fit importance |
| Longer than preferred trip | drain × (1 + delta × (1100 − adaptability)/3,000,000) | packages/racing-engine/src/model.ts:112 | Distance mismatch (too long) drains energy. | Distance-fit importance |
| Day form | triangular ± (220 + 200 × (1 − temperament)) mm/s; +25% in rain | packages/racing-engine/src/model.ts:32, :33, :102-104 | Main source of upsets; composed horses are steadier. | Upset rate, value of temperament |
| Style match | ±15 mm/s cruise, ∓6 permille drain | packages/racing-engine/src/model.ts:35, :36 | Riding the natural style helps. | Tactic choice |
| `KICK_BASE_M` | front 300, stalker 420, closer 660 m (scaled 0.82-1.4 by trip) | packages/racing-engine/src/model.ts:39, :121 | Where the kick starts. | Tactic outcomes |
| `KICK_STRENGTH` | front 800, stalker/closer 1000 permille | packages/racing-engine/src/model.ts:41 | Kick intensity. | Tactic outcomes |
| Top / floor speed | cruise + 800 + burst; floor = cruise × (840 + durability/20)/1000 | packages/racing-engine/src/model.ts:106, :107 | Burst and durability value. | Which stat wins races |
| Stamina drain | 1000 + (650 − stamina) × 0.45 × (distance − 800)/1000 permille | packages/racing-engine/src/model.ts:111 | Stamina matters more with distance. | Stayers vs sprinters |
| Durability drain | 1000 + (600 − durability)/6 | packages/racing-engine/src/model.ts:113 | | |
| Drain clamp | 450..2500 permille | packages/racing-engine/src/model.ts:119 | | |
| Gate break | react 2-5 ticks + temperament gap/250; slow start chance 1.5% + gap/10 permille (+6..14 ticks) | packages/racing-engine/src/model.ts:128-130 | Starts. | Upsets, value of temperament |
| Keen | temperament < 500: drain × (1 + (500 − t)/2000) in the first quarter | packages/racing-engine/src/model.ts:135, packages/racing-engine/src/simulate.ts:231 | Keen horses waste energy early. | Value of temperament |
| `DRAFT_MUL` | 870 permille drain in a slipstream | packages/racing-engine/src/simulate.ts:31 | Drafting saves energy. | Tactic outcomes |
| `BASE_BUDGET` / `TIRE_E` / `KICK_RESERVE` | 960,000 / 60,000 / 20,000 energy units | packages/racing-engine/src/simulate.ts:32, :36, :38 | Energy model. | Finishing order |
| `WIDE_COST_DIV` | 1 permille speed per lane wide | packages/racing-engine/src/simulate.ts:37 | Ground lost wide. | Draw bias |
| `PHOTO_FINISH_MM` | 150 mm | packages/shared/src/index.ts:369, packages/racing-engine/src/simulate.ts:527 | Margin that counts as a photo finish. | "By a Nose" achievement |
| `HORSE_LENGTH_MM` | 2,400 mm | packages/shared/src/index.ts:367 | Length unit (margins, rivalries). | Rivalry detection |
| `PRIZE_SPLIT_PCT` | 55 / 20 / 12 / 7 / 4 / 2 | packages/racing-engine/src/results.ts:25 | Engine's displayed purse split (same as `RULES.purseSplitBps`). | Credits per finish position |
| Quirk triggers / effects | mudlark +150 adaptability +15 speed on soft/heavy; gateShy −90 temperament; lateKick +45 burst; crowdShy −110 temperament in big crowds or fields ≥ 12 | packages/game-core/src/phenotype.ts:160, :165-169 | Hidden traits that fire on conditions. | Upsets |
| `QUIRK_REVEAL_PERMILLE` | 350 | packages/game-core/src/phenotype.ts:173 | Chance a triggered quirk is revealed. | Information, market value |
| Big crowd | kind feature/final or class graded | apps/web/src/server/horseView.ts:43 | Triggers crowdShy. | Upsets in Features |
| `HANDICAP_SPEED_PER_LB` / `HANDICAP_BURST_PER_LB` | 5 / 2 per lb | packages/game-core/src/phenotype.ts:180, :182 | Weight effect. Not applied live (see mismatches). | Handicap competitiveness (model only) |
| `TOP_WEIGHT_LB` / `BOTTOM_WEIGHT_LB` / `LEVEL_WEIGHT_LB` | 140 / 112 / 126 lb | packages/game-core/src/ratings.ts:79-81 | Handicap weight scale (1 OR = 1 lb). | Model only |
| Morale → temperament | +morale × 0.3 | packages/game-core/src/phenotype.ts:210 | | Race strength |

## 7. Ratings

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `OR_MIN` / `OR_MAX` | 0 / 140 | packages/game-core/src/ratings.ts:15, :16 | Rating range (also a DB CHECK). | Class access |
| `OR_SCALE` | 25 OR = 10:1 expected-score odds | packages/game-core/src/ratings.ts:18 | Elo curve. | Rating spread |
| `K_PROVISIONAL` / `K_ESTABLISHED` | 14 / 7 | packages/game-core/src/ratings.ts:19, :20 | Rating speed. | Class movement speed |
| `PROVISIONAL_RUNS` | 5 | packages/game-core/src/ratings.ts:21 | First 5 rated runs use K 14. | Class movement of new horses |
| `MAX_GAIN_PER_RACE` / `MAX_LOSS_PER_RACE` | +10 / −7 | packages/game-core/src/ratings.ts:22, :23 | Per-race clamp. | Rating inflation/deflation |
| `INITIAL_OR` | 40 | packages/game-core/src/lifecycle.ts:48 | | Class entry |
| `PEAK_DROP` | 10 | packages/game-core/src/eligibility.ts:64 | Band checks use max(OR, peak − 10, ability − 5). | Sandbagging, class access |
| `ABILITY_MARGIN` | 5 | packages/game-core/src/eligibility.ts:66 | Ability floor tolerance. | Class access of strong newcomers |
| `ABILITY_OR_TABLE` | score 300 → OR 18 … 900 → OR 97 (13 knots) | packages/game-core/src/ability.ts:36 | Settled OR for a given running ability (ability floor). | Class access, Story difficulty |
| Ability trip weights | stamina 25%→75% (1000→3200 m), burst 30%→5% | packages/game-core/src/ability.ts:23, :24 | Ability score blend. | Ability floor |
| `TIER_RULES` | maiden ≤0 wins; novice ≤2 wins; hcp 0-55, 50-75, 70-95; listed ≥88; g3 ≥95; g2 ≥102; g1 ≥108; quick rated; trial/cup unrated | packages/game-core/src/eligibility.ts:30-42 | Model class bands (game-core eligibility). | Class access (model; live uses card conditions) |
| `classBand` | ≥108 g1, ≥102 g2, ≥95 g3, ≥88 listed, ≥70 hcp 70-95, ≥50 hcp 50-75, else 0-55 | packages/game-core/src/eligibility.ts:49-55 | Band a rating belongs in (used in the entry-sheet hint). | Copy, class access hints |
| Live card bands | Maiden 0 wins, OR ≤60; Novice ≤2 wins, OR ≤70; Hcp 0-55; Hcp 50-75; Hcp 70-95; Listed ≥85; Group 3 ≥95 | packages/db/src/services/card.ts:47-53 | Live entry conditions (max checks use band rating). | Field size per class, League movement |
| Story difficulty band | band rating ±12 | apps/web/src/server/game.ts:945 | Open Story races draw house horses rated within ±12. | Story win rate, story credits |
| Unknown-runner default | OR 40, 10 rated runs | packages/game-core/src/career.ts:149 | Runners without a state. | Rating changes |
| Story races are rated | tier `quick` rated: true | packages/game-core/src/eligibility.ts:41 | Story results move OR (but not career starts). | Class access, farming |

## 8. Competition

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `LEAGUE_SIZE` | 30 (DB default capacity 30) | packages/game-core/src/leagues.ts:11, packages/db/src/schema.ts:824 | Owners per weekly league group. | League movement |
| `LEAGUE_TIERS` | bronze, silver, gold, platinum, champion | packages/game-core/src/types.ts:465 | Five tiers. | League movement |
| `PROMOTE` / `RELEGATE` | 5 / 5 | packages/game-core/src/leagues.ts:12, :13 | Top 5 with points go up; bottom 5 of those who raced go down (only if > 10 raced, and only from `RELEGATION_FROM_TIER` up). | League movement |
| `RELEGATION_FROM_TIER` | gold (new 2026-10-29; was: every tier above bronze relegated) | packages/game-core/src/leagues.ts:82, :95 | Lowest tier that relegates: Bronze and Silver are floors, so new stables never drop while learning. | League movement, churn of new stables |
| `RACE_POINTS` + `START_POINT` | 12, 8, 6, 4, 3, 2 + 1 per start (fields < 4: start point only) | packages/game-core/src/leagues.ts:17, :18 | League points per Live run. | League movement, Prize Pool score |
| Tier bonus | top 3: G1 +10, G2 +6, G3/Listed +3 | packages/game-core/src/leagues.ts:30-32 | Big races worth more. Live: Weekend Feature/Final = G1, any graded = G3, listed = listed. | League movement |
| `WEEKLY_RACE_POINTS_CAP` | 240 | packages/game-core/src/leagues.ts:20, packages/db/src/services/leagues.ts:109 | Volume cap per week, applied after the best-runs cut. | League movement |
| `BEST_RUNS_COUNTED` | 20 runs (new 2026-10-29; was: every run counted) | packages/game-core/src/leagues.ts:84, packages/db/src/services/leagues.ts:103 | A week's League score sums only a stable's best 20 run scores (then the cap): a bad race never costs points, extra volume helps little. Season tables add up the same weekly scores. | League movement, entries spent per week |
| Sunday recap | one inbox note (`week_recap`) per stable that raced, at the week's settlement: rank, move, points gap to the promotion line | packages/db/src/services/leagues.ts:155-179 | Tells each stable where its week ended and how far the line was. | Retention (weekly return) |
| League field size | counts every entered runner incl. house | packages/db/src/services/leagues.ts:59 | Fields ≥ 4 score placings. | League points |
| Starting tier | 1 (bronze) | packages/db/src/services/competition.ts:107 | New owners start at the bottom. | League movement |
| `CUP_FIELD_SIZE` | 7 Club runners + the entrant | packages/game-core/src/dailyCup.ts:19 | Daily Cup field. | Cup times |
| `CUP_FIELD_STRENGTH` | 470 mean stat, jitter −40..+60 per runner | packages/game-core/src/dailyCup.ts:24, :51 | Club field strength. | Cup positions |
| `CUP_ENTRANT_GATE` | 4 | packages/game-core/src/dailyCup.ts:21 | Fixed gate for fairness. | |
| Cup points | `max(1, 50 − percentile/20)` + 10 for beating the field | packages/game-core/src/dailyCup.ts:123, packages/db/src/services/dailyCup.ts:102 | Written once a UTC day is over (`settleCupDays`, lazily from the Cup view, apps/web/src/server/competition.ts:96; idempotent; up to 7 days per call). Entries hold 0 until then. | Prize Pool cup term |
| Cup badges | gold/silver/bronze, top10 = percentile ≤ 100 | packages/game-core/src/dailyCup.ts:122 | | "Cup Contender" achievement |
| `DAILY_CUP_CREDITS` / `CUP_PARTICIPATION_CREDITS` | 80 credits per UTC day | packages/game-core/src/economy.ts:61, packages/game-core/src/dailyCup.ts:129 | Paid for taking part. | Credits created/day |
| `STORY_CHAPTER_DEFS` | 4 chapters × 6 races; win 3 to complete | packages/game-core/src/story.ts:227, :235 | Story campaign and licences. | Licence access, story credits |
| Chapter strengths / field sizes | Club 318 (+3/race, final 334), 7 runners; County 368 (384), 8; National 405 (422), 9; Classics 440 (458), 10 | packages/game-core/src/story.ts:238, :257, :276, :295 | Rival strength (mean current stat) and field size. | Story win rate, licence pace |
| Rival spread | strength −15..+15, stat spread 50 | packages/game-core/src/story.ts:427, :428 | Rival variation. | Story win rate |
| `STORY_FIRST_WIN_REWARD` | club 400, county 700, national 1,100, classics 1,800 | packages/game-core/src/economy.ts:256 | Credits for a first win of a story race key. | Credits created |
| `STORY_REPLAY_REWARD` | 20 | packages/game-core/src/economy.ts:258 | Any other story finish. | Credits created |
| `STORY_CHAPTER_CAP` | 4,000 / 7,000 / 11,000 / 18,000 (40,000 lifetime) | packages/game-core/src/economy.ts:260 | Lifetime credits per chapter. | Credits created (bounded) |
| Open Story race keys | chapter × class × trip | apps/web/src/server/storyField.ts:95 | First-win keys of "race now" Story races (3 classes × 10 trips per chapter), so first wins are plentiful until the cap. | Credits created |
| Open Story race shape | 3-in-4 near the horse's trip and surface; 8-10 runners; class by wins; purse 0 | apps/web/src/server/game.ts:925-946 | Story race generator. | Story win rate |
| `LICENCES` / `licenceForTier` | 1 Club: maiden, novice, hcp 0-55; 2 County: hcp 50-75/70-95; 3 National: Listed, G3, the card's Features and the Weekend Feature (`feature = true`); 4 Classics: G1 and the Season Final (`feature = "final"`); 5 champion title | packages/game-core/src/story.ts:334, :354-370, apps/web/src/server/game.ts:637 | Live class gates, earned in Story. Changed 2026-10-29: Features and the Weekend Feature needed Classics, and no harness stable ever reached a Weekend Feature. | Who reaches the rich races, credits/day, Weekend Feature field size |
| `featureQualified` | OR ≥ 100 or a top-3 in any Qualifier in the 7 days before | packages/game-core/src/seasons.ts:181, packages/db/src/services/races.ts:185, :192 | Weekend Feature entry, enforced at entry (`featureQualificationReason`, `enterRace` and the entry sheet). | Qualifier count, Weekend Feature field size |
| Saturday Plate entry | ran in a Qualifier in the 7 days before and did not qualify (a qualified horse is sent to the Feature) | packages/db/src/services/races.ts:209-213 | The Plate's field: the week's near-misses. | Plate field size, qualifier entries |
| This week (`/week`) | Weekend Feature conditions from Monday, the week's Qualifiers with the stable's places, each horse's status (in / Plate / not yet), fit and raced-today, League gap to promotion, one headline | apps/web/src/server/week.ts:26, apps/web/src/components/competition/RoadToSaturday.tsx | Read-only view (Racing > This week, and the Road to Saturday tile on the Estate). | Qualifier participation |
| Season Final entry | OR ≥ 95 + Classics licence (the only race that needs it), 2 entries, 500 fee | packages/db/src/services/card.ts:176, :187 | No qualification beyond the band. | Final field size |
| Hall of Fame | champion: 2+ G1 or 1 G1 + 4 graded; season winner; record time; great racehorse: peak OR ≥ 115 or 20+ starts with 10+ wins; foundation sire/mare: 3+ graded-winning offspring; elite genetics: S-grade potential | packages/game-core/src/social.ts:77-85 | Permanent inductions. | Status |
| Hall candidates per sweep | 200 horses | packages/db/src/services/hall.ts:189 | Cap on candidates checked. | Induction latency |
| `ACHIEVEMENTS` | 16 plaques (1 race, 1/10 wins, photo win, graded/G1 win, foals, B/A/S bred, 20 Cup runs, Cup top 10%, promotion, Final win, Hall, 30 care days) | packages/game-core/src/social.ts:37-54 | Owner plaques. | Retention |
| `trophyTier` | Feature/Final/graded win = gold; listed = silver; other Live win = bronze; Story win = rosette | apps/web/src/server/competition.ts:340 | Trophy room. | Status |
| `RIVAL_MARGIN_MM` / `RIVAL_MIN_CLOSE` | 1 length / 3 close finishes | packages/game-core/src/social.ts:107, :108 | Rivalry detection. | Social |

## 9. Breeding and genetics

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `MARE_PER_SEASON` | 1 (DB unique index on dam + season) | packages/game-core/src/breeding.ts:33, packages/db/src/schema.ts:567 | A mare covers at most once per season. | Foal crop (≤ 1 per mare per 28 days) |
| `STALLION_PER_SEASON` | 4 | packages/game-core/src/breeding.ts:34 | Stallion cap per season (lifetime 4 makes it effectively "all at once"). | Stud supply |
| `BREEDING_BASE_FEE` | 1,500 credits (burned) | packages/game-core/src/breeding.ts:36 | Platform fee per covering. | Credit sink, foal crop |
| `STUD_FEE_BURN_PERMILLE` | 100 (10% of stud fee burned) | packages/game-core/src/breeding.ts:38 | Burn on player-to-player stud fees. | Credit sink |
| `MAX_STUD_FEE` | 100,000 credits | apps/web/src/server/economy.ts:362 | Upper bound the API accepts; the stallion's ceiling below is usually far lower. | Credit transfer between players |
| `studFeeCeiling` / `STUD_FEE_MIN_CEILING` | the stallion's appraisal, at least 500 credits (new 2026-10-29) | packages/game-core/src/economy.ts:151, :152, packages/db/src/services/horses.ts:250-253 | Highest stud fee a stallion may stand at. The harness caught linked accounts moving 143k credits through stud fees. | Credit transfer between players, stud fee income |
| Linked-account coverings | paid coverings between linked accounts refused (`LINKED_ACCOUNTS`) | packages/db/src/services/breeding.ts:134-137 | Same guard as market sales. Free coverings (own stallion) are unaffected. | RMT risk |
| `HOUSE_STUD_COUNT` | 4 Club stallions | packages/db/src/services/houseStuds.ts:28 | Standing Club studs (replaced as they retire). | Stud supply, foal quality floor |
| `HOUSE_STUD_FEES` | common 250, uncommon 400, rare 700 (rarity cycle uncommon, common, rare, uncommon) | packages/db/src/services/houseStuds.ts:30, :32 | Club stud fee; 90% to treasury, 10% burned. | Credit sink |
| `COI_WARN` | 62 permille | packages/game-core/src/breeding.ts:53 | Inbreeding warning in the preview. | Player behaviour |
| `COI_MAX_DEPTH` | 10 generations | packages/game-core/src/genetics.ts:234 | Pedigree depth for COI. | Inbreeding |
| `MUTATION_PERMILLE` | 60 per stat allele | packages/game-core/src/genetics.ts:14 | Base mutation chance. | Foal quality spread |
| `MUTATION_MAX` | ±1..30 | packages/game-core/src/genetics.ts:16 | Mutation step. | Foal quality spread |
| `MUTATION_COI_RATE_PER_100` | +30 permille per 100 COI (cap 400) | packages/game-core/src/genetics.ts:18, :129 | Inbreeding raises mutation rate. | Foal quality |
| `MUTATION_NEG_BASE` / `MUTATION_NEG_PER_100_COI` | 500 / +120 per 100 COI (cap 950) | packages/game-core/src/genetics.ts:20, :21, :130 | Share of negative mutations. | Foal quality |
| `VIGOUR_MUTATION_MAX` | ±1..10 (vigour clamp ±150) | packages/game-core/src/genetics.ts:141 | Vigour (class) locus mutation. | Foal quality |
| `DRIFT_PERMILLE` | 30 | packages/game-core/src/genetics.ts:23 | Cosmetic/aptitude drift. | Distance preference drift |
| `MORPH_SEGREGATION_SD` / `_MAX` | 60 / 208 | packages/game-core/src/genetics.ts:25, :27 | Polygenic segregation on every morph allele (body shape and polygenic height); the max bounds the preview's limits. | Foal size spread |
| `FAMILY_HEADROOM` / `_MIN` | 40 / 10 | packages/game-core/src/genetics.ts:72, :74 | Max allele above the best parent (less after a one-generation spike). | Breeding progress rate per generation |
| `FAMILY_FLOOR_DROP` | 40 | packages/game-core/src/genetics.ts:76 | Allele floor below the weakest parent. | Foal quality floor |
| `FAMILY_FLOOR_SPREAD` | 60 | packages/game-core/src/genetics.ts:82 | Strong families protect the floor (centre − 60). | Foal quality floor |
| `FAMILY_PULL_PER_100` | 60 permille more negative per 100 above the family centre | packages/game-core/src/genetics.ts:84 | Regression to the family mean. | Breeding progress rate |
| `FRAGILE_FROM_INJURY_PERMILLE` | 500 | packages/game-core/src/genetics.ts:47 | A parent retired by injury passes fragile legs 50% of the time. | Injury rate of foals |
| `FRAGILE_DURABILITY_PENALTY` | −100 durability potential | packages/game-core/src/genome.ts:126 | Fragile legs cost durability. | Injury rate |
| `DOMINANCE_PERMILLE` | 550 (500 additive, 1000 complete) | packages/game-core/src/genome.ts:47 | How the higher allele expresses. | Foal quality, hidden value |
| `INBREEDING_DEPRESSION_PERMILLE` | 800 on durability and temperament | packages/game-core/src/genome.ts:49, :50 | Potential × (1 − 0.8 × COI). | Injury rate, upset rate |
| `VIGOUR_MIN` / `VIGOUR_MAX` | −150 / +150 | packages/game-core/src/genome.ts:110, :111 | Class locus range, added to every stat. | Foal quality |
| `LAUNCH_MEAN_CEILING` | 600 mean potential | packages/game-core/src/genome.ts:57 | Mint ceiling (packs, starters, gifts, house). | Foal quality of minted horses |
| `LAUNCH_STAT_CEILING` | 700 per stat | packages/game-core/src/genome.ts:58 | | |
| `CEILING_STEP_PER_SEASON` / `CEILING_MAX_STEPS` | +10 per season, max 8 steps (680 mean / 780 stat by season 9) | packages/game-core/src/genome.ts:59, :60 | Potential ceilings per season. | Minted horse quality over time, house horse strength |
| `ALLELE_HEADROOM` | speed 200, others 250 above the stat ceiling | packages/game-core/src/genome.ts:68 | Hidden breeding value in minted alleles. | Breeding frontier |
| `GEM_LOCUS_PERMILLE` | 150 | packages/game-core/src/genome.ts:70 | Chance a minted locus hides a high allele. | Hidden value |
| `OVERALL_WEIGHTS` | all 1 (plain mean) | packages/game-core/src/genome.ts:96 | Headline grade / appraisal mean. | Appraisal, grades |
| `GRADE_FLOORS` | S 900, A 800, B 700, C 600, D 500, E 0 | packages/game-core/src/genome.ts:276 | Grade labels. | Achievements, Hall (S) |
| `RARITY_FLOORS` | uncommon 510, rare 540, epic 565, legendary 585 | packages/game-core/src/genome.ts:299 | Rarity from mean potential. | Pack value |
| `RARITY_MINT_BANDS` | common 470-510, uncommon 510-540, rare 540-565, epic 565-585, legendary 585+ | packages/game-core/src/genome.ts:301 | Mint target per rarity. | Pack foal quality |
| `NATURAL_RARITY_WEIGHTS` | 600 / 280 / 90 / 25 / 5 | packages/game-core/src/genome.ts:734 | Rarity of minted horses without a target (house horses). | House horse strength |
| `MINT_VIGOUR_MEAN` / `_SD` / `_GEM_PERMILLE` | −10 / 45 / 100 (gem allele 70-150) | packages/game-core/src/genome.ts:723-725, :856 | Minted vigour. | Hidden value |
| `MINT_HET_SD` / `MINT_STAT_FLOOR` | 150 / 150 | packages/game-core/src/genome.ts:728, :731 | Minted allele spread and floor. | Hidden value |
| Breed profile shaping | dev ×1.2 + N(0,45), clamp ±140 | packages/game-core/src/genome.ts:837, :838 | How strongly breeds shape stat profiles. | Niche horses |
| `BREED_PROFILES` | 12 breeds (genetics v2, docs/genetics-v2.md): stat means (sums 2,550-2,620), trip, turf %, style, maturity, coat and v2 allele frequencies, white, morph (morph.height = breed size), mint weight | packages/game-core/src/genome.ts:404 | Breed tendencies. Stat means were tuned 2026-10-29 with `tools/balance/breeds.report.ts` (Thoroughbred, Friesian, Marwari, Andalusian; every breed now wins 10.0-14.6% of fitted races, target 12.5% ± 3). The v1 mint reads the frozen `V1_STAT_MEANS` instead, so pack-pull proofs from before v2 still verify. | Trip/surface mix, breed balance, foal looks |
| Breed mint weights | Thoroughbred 500, Arabian 200, Quarter Horse 180, Akhal-Teke 120, the 8 new breeds 60 each; Club runners (`evenBreeds`) weight all 12 equally | packages/game-core/src/genome.ts:415-554 (mintWeight), packages/db/src/gameCore.ts:211 (houseHorse) | Breed mix of packs and starters vs Club fields. | How often players see each breed |
| Breed purity | 45% pure, else main 700-950 | packages/game-core/src/genome.ts:646, :652 | Breed shares of minted horses. | Aptitude spread |
| `BREEDS_V1` | thoroughbred, arabian, quarterHorse, akhalTeke | packages/game-core/src/genome.ts:639 | The only breeds `generateFoundationGenomeV1` draws (re-deriving pre-v2 pack pulls). | Pull-proof verification |
| `G2_LOCI` | 14 loci: allele frequency key, non-wild and wild allele | packages/game-core/src/genome.ts:660 | Minting of the v2 genes (own stream `seed|mint-g2`). | v2 gene prevalence |
| `SIZE_PER_HT_PERMILLE` | +30 (3%) per Ht copy | packages/game-core/src/genome.ts:138 | Height (LCORL) gene. | Size, speed vs burst |
| `SIZE_POLYGENIC_PERMILLE` | ±30 at a mean morph.height allele of ±1000 | packages/game-core/src/genome.ts:140 | Polygenic height. | Size spread |
| `SIZE_MIN_PERMILLE` / `SIZE_MAX_PERMILLE` | −120 / +120 (0.88-1.12) | packages/game-core/src/genome.ts:142, :143 | Size clamp. | Max size effect (±24 speed) |
| `SIZE_STAT_PER_PCT` | per whole 1%: speed +2, stamina +1, burst −2, durability −1 (sums to 0) | packages/game-core/src/genome.ts:148 | Size moves points between stats (potentials). Off for genomes upgraded from v1. Mints absorb it into their planned stats. | Breed race shape, foal spread, injury (durability) |
| `MSTN_STAT_SHIFT` | 15 | packages/game-core/src/genome.ts:150 | C/C: burst +15, stamina −15; T/T the reverse. | Sprint vs stay |
| `MSTN_TRIP_M` | 200 m | packages/game-core/src/genome.ts:152 | C/C best trip −200 m; T/T +200 m. | Distance fit, card coverage (`JUVENILE_TRIPS` sprint trip is 1,000 m for C/C sprinters) |
| `BIG_HEART_STAMINA` | +25 stamina potential (bh/bh, recessive) | packages/game-core/src/genome.ts:154 | The one v2 gene that adds strength. Shown on the horse page once raced or scanned. | Foal quality (rare) |
| `IRON_LEGS_RISK` | ×0.8 injury risk (IL dominant) | packages/game-core/src/genome.ts:211, packages/game-core/src/condition.ts:175 | Sound legs. | Injury rate |
| `PUREBRED_PERMILLE` | 875 (7/8 rule) | packages/game-core/src/geneticsSummary.ts:90 | "Purebred X" label. | Labels (G3 will hang signatures on it) |
| `NAMED_CROSS_MIN_PERMILLE` / `NAMED_CROSSES` | 250; Anglo-Arab, Appendix Quarter Horse, Hispano-Arabe | packages/game-core/src/geneticsSummary.ts:92, :94 | Named-cross labels. | Labels |
| v2 allele frequencies | e.g. Paint TO 550, Appaloosa LP 600 / PATN1 400, Friesian fe 1000, Marwari Ce 950, Warmblood Ht 850 | packages/game-core/src/genome.ts:404 (`genes2` per breed) | How common each new gene is per breed. | Looks, hidden-carrier surprises |
| `DISTANCE_CENTER_M` | sprint 1100, mile 1500, middle 2000, staying 2600 | packages/game-core/src/genome.ts:322 | Preferred trip from distance alleles (± distanceMod ± MSTN, clamp 1000-3200). | Distance-fit |
| `SURFACE_HET_ADAPT_BONUS` | +20 adaptability for synthetic (TD) types | packages/game-core/src/genome.ts:350 | | Surface-fit |
| `QUIRK_FREQ` / `QUIRK_DOMINANT` | mudlark 200 (recessive), gateShy 50 (dominant), lateKick 250 (recessive), crowdShy 40 (dominant) | packages/game-core/src/genome.ts:710, :369 | Quirk prevalence. | Upsets |
| `REVEAL_BASE_WIDTH` | foal 260, weanling 240, yearling 200, racing 160 | packages/game-core/src/phenotype.ts:97 | Width of the revealed potential range. | Market prices (appraisal uses midpoints) |
| `REVEAL_PER_START` / `REVEAL_EXACT_BELOW` | −12 per start / exact below 10 | packages/game-core/src/phenotype.ts:98, :101 | Racing reveals potential. | Market prices |
| `SCAN_WIDTH_PERMILLE` / `PEDIGREE_SCAN_COST` | 400 (narrows to 40%) / 400 credits | packages/game-core/src/phenotype.ts:100, packages/game-core/src/economy.ts:69 | Paid reveal (also reveals big heart). | Credit sink, market prices |
| Nick score | 25 + 60 × beats-both + 15 × trip coherence + 10 × surface coherence − COI/4 | packages/game-core/src/breeding.ts:519 | Preview label only. | Player behaviour |

## 10. Economy

### 10a. Faucets (credits minted)

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `STARTER_GRANT` / `RULES.startingCredits` | 3,000 | packages/game-core/src/economy.ts:62, packages/db/src/rules.ts:49 | Credits for a new stable (kind `starter_grant`). | Credits created per account, sybil value |
| Live purses (ClassDef, **live**) | Maiden 2,000; Novice 2,500; Hcp 0-55 3,000; Hcp 50-75 4,000; Hcp 70-95 5,000; Listed 8,000; Group 3 12,000 | packages/db/src/services/card.ts:47-53 | Purse of each Live race. | Credits created/day (the biggest faucet) |
| `FEATURE_PURSE_MULTIPLIER` | ×2 (Listed Feature 16,000; G3 Feature 24,000) | packages/db/src/services/card.ts:55, :257 | Cycle Feature pays double. | Credits created/day |
| `CALENDAR_PURSE` | Qualifier 16,000; Weekend Feature 48,000; Final 72,000 | packages/db/src/services/card.ts:63 | Calendar purses (live). | Credits created/week |
| Purse per 20-slot cycle | 79,000 (avg Feature 20,000) → 379,200/day at 15 min (was 1,896,000/day at 3 min), per course, before sisters | derived from card.ts:47-55, :82 | Gross purse posted. Only placed **player** runners are minted. | Credits created/day |
| `RULES.purseSplitBps` | 5500 / 2000 / 1200 / 700 / 400 / 200 | packages/db/src/rules.ts:35, packages/db/src/services/races.ts:595 | Split to the first 6; house runners' shares are not minted. | Credits per finish, expected prize = purse/field |
| `PURSE_BY_TIER` (**model**) | maiden 600, novice 750, quick 240, hcp 800/1,100/1,500, listed 2,600, g3 4,000, g2 6,000, g1 10,000 | packages/game-core/src/economy.ts:24 | Model purses (game-core `regularSlot`, `weeklyFlow`, economy-sim). Not paid live. | Model only |
| `WEEKEND_FEATURE_PURSE` / `SEASON_FINAL_PURSE` (**model**) | 20,000 / 30,000 | packages/game-core/src/economy.ts:38, :39 | Model calendar purses; the card overrides them. | Model only |
| `DAILY_GOAL_CREDITS` × `DAILY_GOALS_PER_DAY` | 60 × 3 (run a race, care, run the Cup) per local day | packages/game-core/src/economy.ts:58, :59, packages/db/src/services/dailyGoals.ts:43 | Paid automatically (kind `daily_goal`). | Credits created/day (180) |
| `DAILY_CUP_CREDITS` | 80 per UTC day | packages/game-core/src/economy.ts:61, packages/db/src/services/dailyCup.ts:86 | Kind `daily_cup`. | Credits created/day |
| Story rewards | first win 400-1,800, replay 20, cap 4k-18k per chapter | packages/game-core/src/economy.ts:256-260, packages/db/src/services/player.ts:222 | Kind `story_reward`. | Credits created (40,000 lifetime max) |
| Insurance payout | 60% of appraisal | packages/game-core/src/economy.ts:72, packages/db/src/services/races.ts:665 | Kind `insurance_payout`. | Credits created |
| Release payout | 50 | packages/db/src/rules.ts:47, packages/db/src/services/horses.ts:210 | Kind `adjustment`. | Credits created |
| Referral active reward | 250 credits to the inviter when an invitee has 5 races and 3 play days | packages/db/src/services/affiliates.ts:74, :437 | Kind `referral_reward`. Runtime-configurable. | Credits created, sybil value |
| Entry fee refund | full fee back when a race is abandoned | packages/db/src/services/races.ts:734 | Kind `entry_fee_refund` (burn → player). | Neutral |

### 10b. Sinks (credits burned, or sent to treasury)

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| Entry fees | Listed 120, G3 200, G1 500 | packages/db/src/services/card.ts:70, packages/db/src/services/races.ts:313 | Kind `entry_fee` (burn). | Credit sink |
| Entry refill | 250 | packages/game-core/src/entries.ts:23, packages/db/src/services/entries.ts:162 | Kind `entry_refill` (burn). | Credit sink |
| Training | 0-90 per session | packages/game-core/src/training.ts:37-42, packages/db/src/services/horseLife.ts:380 | Kind `training` (burn). | Credit sink |
| Vet treatment | 150 | packages/game-core/src/economy.ts:68, packages/db/src/services/horseLife.ts:423 | Kind `vet` (burn). | Credit sink |
| Pedigree scan | 400 | packages/game-core/src/economy.ts:69, packages/db/src/services/horseLife.ts:462 | Kind `pedigree_scan` (burn). | Credit sink |
| `BASE_STALLS` / `MAX_STALLS` | 6 / 24 | packages/game-core/src/economy.ts:80, :81 | Stable size limit (DB CHECK 1..24). | Horse population per stable |
| `stallCost(n)` | 2,000 + 400 × (n − 7): stall 7 = 2,000 … stall 24 = 8,800 (97,200 for all 18) | packages/game-core/src/economy.ts:84 | Kind `stall_slot` (burn). | Credit sink, population |
| `FACILITY_COSTS` | trainer 6,000 / 15,000; vet 3,000 / 8,000 / 16,000 | packages/game-core/src/economy.ts:86-89 | Kind `facility` (burn). | Credit sink |
| Entry tiers | 4,000-22,000 (60,000 total) | packages/game-core/src/entries.ts:25 | Kind `facility` (burn). | Credit sink |
| Stable hand | 2,500 | packages/db/src/services/horseLife.ts:44 | Kind `facility` (burn). | Credit sink |
| Breeding | 1,500 base (burn) + stud fee (10% burn, 90% to the stud owner or the Club treasury) | packages/game-core/src/breeding.ts:36, :38, packages/db/src/services/breeding.ts:131-154 | Kind `breeding_fee`. | Credit sink, player-to-player transfer |
| Paddock pack | 1,200 | packages/game-core/src/packs.ts:47, packages/db/src/services/packs.ts:177 | Kind `pack` (burn). | Credit sink |
| Premium pack (credit demo) | 2,500 (only with `PREMIUM_PACK_DEMO=1`) | packages/db/src/rules.ts:115 | Kind `pack`. | Demo only |
| Insurance premium | 5% of appraisal, one-off | packages/game-core/src/economy.ts:71, packages/db/src/services/horses.ts:237 | Kind `insurance_premium` → **treasury**, not burn. | Credit sink |
| Market fee | 5% of price (burn) | packages/game-core/src/economy.ts:73, packages/db/src/services/market.ts:164-172 | Kind `market_sale` (buyer → seller minus fee). | Credit sink, market prices |

### 10c. Ledger kinds as recorded

| Kind | Direction | Posted at |
|---|---|---|
| `starter_grant` | mint → player | packages/db/src/services/accounts.ts:61 |
| `purse` | mint → placed player runners (one transaction per race) | packages/db/src/services/races.ts:605 |
| `insurance_payout` | mint → owner | packages/db/src/services/races.ts:666 |
| `daily_goal` | mint → player | packages/db/src/services/dailyGoals.ts:41 |
| `daily_cup` | mint → player | packages/db/src/services/dailyCup.ts:86 |
| `story_reward` | mint → player | packages/db/src/services/player.ts:228 |
| `referral_reward` | mint → inviter | packages/db/src/services/affiliates.ts:437 |
| `adjustment` (release to Club) | mint → player | packages/db/src/services/horses.ts:210 |
| `entry_fee_refund` | burn → player | packages/db/src/services/races.ts:734 |
| `entry_fee` | player → burn | packages/db/src/services/races.ts:313 |
| `entry_refill` | player → burn | packages/db/src/services/entries.ts:162 |
| `training` | player → burn | packages/db/src/services/horseLife.ts:380 (also the older plan charge, packages/db/src/services/horses.ts:140) |
| `vet` | player → burn | packages/db/src/services/horseLife.ts:423 |
| `pedigree_scan` | player → burn | packages/db/src/services/horseLife.ts:462 |
| `facility` / `stall_slot` | player → burn | packages/db/src/services/horseLife.ts:110, packages/db/src/services/accounts.ts:254, packages/db/src/services/entries.ts:179 |
| `pack` | player → burn | packages/db/src/services/packs.ts:177 |
| `insurance_premium` | player → treasury | packages/db/src/services/horses.ts:237 |
| `breeding_fee` | player → burn + stud owner (or treasury for Club studs) | packages/db/src/services/breeding.ts:154 |
| `market_sale` | buyer → seller, fee → burn | packages/db/src/services/market.ts:165 |

### 10d. Balance model

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `ACTIVE_PLAYER` profile | 75 starts/wk (8 maiden, 10 novice, 12 quick, 20/15/6 hcp, 2 listed, 2 g3), field 10, 18 training sessions, 0.75 coverings, 2 packs, 1 scan, 3 refills, 2,500/wk facilities | packages/game-core/src/economy.ts:359 | The reference player for `weeklyFlow` (target spend ≈ earn ±15%). | Balance target |
| `weeklyFlow` insurance | 300 per insurance (flat) | packages/game-core/src/economy.ts:345 | Uses the flat fallback, not 5% of appraisal. | Model only |

## 11. Market

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| Appraisal base | 400 + (mean revealed potential − 300)² / 12 | packages/game-core/src/economy.ts:137 | Value from revealed ranges (midpoints), never the hidden genotype. | Market prices, insurance |
| Stage factor | foal 70%, weanling 75%, yearling 85%, juvenile/prime 100%, veteran 75%, stud 60%, pasture 10% | packages/game-core/src/economy.ts:139 | Stage discount. | Market prices |
| Appraisal adders | +150 per breeding left, +120 per win, + earnings/10, + peak OR × 15; min 100 | packages/game-core/src/economy.ts:142 | Record and breeding value. Earnings come from live purses (3x the model). | Market prices, insurance premium/payout |
| `LISTING_FLOOR_PERMILLE` | 700 (70% of appraisal) | packages/game-core/src/economy.ts:74 | Lowest list price. | Market prices |
| `LISTING_CEILING_PERMILLE` | 3000 (3× appraisal) | packages/game-core/src/economy.ts:76 | Highest list price (anti credit-transfer). | Market prices, RMT risk |
| `MARKET_FEE_PERMILLE` | 50 (5% burned) | packages/game-core/src/economy.ts:73 | Fee on each sale. | Credit sink |
| `RESALE_LOCK_MS` | 72 h | packages/game-core/src/economy.ts:78, packages/db/src/services/market.ts:77 | Bought horses can't be relisted for 3 days. | Flipping |
| `RULES.maxListingMs` / `LISTING_DAYS` | 14 days / UI offers 3, 7, 14 (default 7) | packages/db/src/rules.ts:43, apps/web/src/server/economy.ts:589 | Listing duration. | Market supply |
| `SELLER_MIN_AGE_DAYS` | 7 (env `MARKET_SELLER_MIN_ACCOUNT_DAYS`) | packages/game-core/src/economy.ts:171, packages/db/src/rules.ts:252 | Seller account age. | Market supply, sybil cost |
| `SELLER_MIN_RACES` | 20 (env `MARKET_SELLER_MIN_RACES`) | packages/game-core/src/economy.ts:172, packages/db/src/rules.ts:253 | Seller race count. | Market supply, sybil cost |
| Verified email to sell | game-core default true; DB default false (env `MARKET_REQUIRE_VERIFIED_EMAIL`) | packages/game-core/src/economy.ts:194, packages/db/src/rules.ts:254 | Live default is off (no email flow). | Market supply |
| Bindings | Club-bred (starters, gift, free packs) never; their foals after 5 starts | packages/game-core/src/economy.ts:207-208, packages/game-core/src/packs.ts:169 | Untradeable horses. | Market supply |
| Linked accounts | trades blocked; paid stud coverings blocked too | packages/game-core/src/economy.ts:231, packages/db/src/services/market.ts:149, packages/db/src/services/breeding.ts:136 | Anti credit-transfer. | RMT risk |

## 12. Packs

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `PADDOCK_PACK_PRICE` | 1,200 credits | packages/game-core/src/packs.ts:47 | Credit price. | Credit sink, horse population |
| `FREE_PADDOCK_EVERY_PLAY_DAYS` | 1 free per 3 play days (lifetime, non-consecutive) | packages/game-core/src/packs.ts:48 | Free pack cadence (Club-bred foal). | Horse population |
| `PADDOCK_CREDIT_BUYS_PER_WEEK` | 3 | packages/game-core/src/packs.ts:49 | Weekly bought cap. | Credit sink, population |
| `PACK_ODDS` paddock | common 70%, uncommon 30% | packages/game-core/src/packs.ts:23 | | Foal quality |
| `PACK_ODDS` premium | 35 / 35 / 22 / 6.5 / 1.5% | packages/game-core/src/packs.ts:24 | | Foal quality |
| `PACK_PITY` | Paddock: uncommon+ within 5; Premium: rare+ within 10, epic+ within 20 | packages/game-core/src/packs.ts:39 | Pity timers. | Foal quality |
| `PREMIUM_PER_WEEK` | 5 | packages/game-core/src/packs.ts:51 | Weekly Premium cap (beta). | ETH revenue, foal quality |
| `PREMIUM_BETA_LIFETIME_USD_CENTS` | $50 | packages/game-core/src/packs.ts:52, apps/web/src/server/chain/checkout.ts:110 | Lifetime beta spend per tester. | ETH revenue, Prize Pool size |
| `SEASON_FOAL_CROP_CAP` | 10,000 pack foals / season (global) | packages/game-core/src/packs.ts:53, packages/db/src/services/packs.ts:30 | Global mint ceiling (stored per season in `foal_crop`). | Horse population |
| Stall needed | a pack needs a free stall | packages/game-core/src/packs.ts:153 | Packs can't overflow. | Population per stable |
| Pack foal ceiling | `potentialCeiling(season)` | packages/game-core/src/packs.ts:120 | Disclosure: no stat above the season ceiling. | Foal quality |

## 13. Beta money

| Knob | Value | Where | What it does | Moves which outcomes |
|---|---|---|---|---|
| `PREMIUM_PACK_USD_CENTS` | 499 (env; allowed 50..100,000) | apps/web/src/server/chain/config.ts:58 | ETH price of a Premium Pack, quoted in USD. | ETH revenue |
| Pool share of sales (`poolBps`) | contract default 1000 (10%), contract range 1000-5000; admin UI default 10%; web fallback 1000 | packages/contracts/scripts/deploy.ts:104, packages/contracts/contracts/PremiumStore.sol:70, :71, apps/web/src/components/chain/admin/ChainAdmin.tsx:37, apps/web/src/server/chain/pool.ts:93 | Share of every ETH sale sent to the Prize Pool. | Prize Pool size |
| `DEFAULT_POOL_RULES.budgetBps` | 2,500 (25% of the free pool balance per weekly epoch) | packages/db/src/services/betaMoney.ts:477 | Weekly payout budget. | Prize payouts |
| `capUsdCents` | $10 per player per epoch | packages/db/src/services/betaMoney.ts:478 | Per-player cap. | Prize concentration |
| `minActiveDays` | 4 play days | packages/db/src/services/betaMoney.ts:479 | Eligibility. | Who gets paid |
| `paidRanks` | top 10, linear weights (rank 1 = 10 shares) | packages/db/src/services/betaMoney.ts:480, :654 | Payout ladder. | Prize concentration |
| `minPayoutUsdCents` | $0.50 | packages/db/src/services/betaMoney.ts:481 | Dust cutoff. | |
| `excludePremiumHorses` / `excludeFlagged` | true / true | packages/db/src/services/betaMoney.ts:482, :483 | Premium-pack horses don't score; flagged accounts held. | Pay-to-win guard |
| `vestDays` | 14 | packages/db/src/services/betaMoney.ts:484 | Linear vesting of each epoch. | Cash-out timing |
| Pool score | race term `points × 15 / max(runs, 8)` + cup term `best-3 Cup days × 5 / 3` | packages/db/src/services/betaMoney.ts:596, :597 | Rate-based skill score (league points uncapped per run). | Who gets paid |
| `DEFAULT_AFFILIATE_CONFIG.ref1Bps` / `ref2Bps` | 10% / 3% of ETH sales | packages/db/src/services/affiliates.ts:69, :70 | Affiliate commissions (runtime-configurable via `beta.affiliate`). | ETH outflow |
| `REF1_BPS_CAP` / `REF2_BPS_CAP` | 15% / 5% (contract caps the same) | packages/db/src/services/affiliates.ts:76, :77, packages/contracts/contracts/PremiumStore.sol:75, :76 | Upper bounds. | ETH outflow |
| `windowDays` | 90 | packages/db/src/services/affiliates.ts:71 | Referral attribution window. | ETH outflow |
| `weeklyCapUsdCents` / `ownerWeeklyCapUsdCents` | $50 per affiliate per week / none | packages/db/src/services/affiliates.ts:72, :73 | Commission caps. | ETH outflow |
| Quote TTL | 300 s (contract max 10 min) | apps/web/src/server/chain/config.ts:69, packages/contracts/contracts/PremiumStore.sol:73 | Price-quote lifetime. | Checkout |
| Blocked countries | BE, NL (env `PREMIUM_BLOCKED_COUNTRIES`) | apps/web/src/server/chain/config.ts:70 | Paid loot-box geo-block. | ETH revenue |
| ETH price service | divergence ≤ 200 bps, $100-$100,000 sanity band, 45 s TTL | apps/web/src/server/chain/price.ts:116-119 | Quote pricing safety. | Checkout availability |
| `PLAYTEST_TESTER_CAP` | 60 (env) | packages/db/src/services/playtest.ts:35 | Testers admitted. | Population |

---

## Values duplicated in more than one place

These must stay in sync (or be derived from one source).

| Value | Locations | Notes |
|---|---|---|
| Purse split 55/20/12/7/4/2 | packages/db/src/rules.ts:35, packages/racing-engine/src/results.ts:25, packages/game-core/src/economy.ts:325, tools/economy-sim/lib/constants.ts:83 | Four copies; the DB one pays. |
| Class rotation (20 slots) | packages/db/src/services/card.ts:82 (live `CYCLE`), packages/game-core/src/seasons.ts:25 (model `TIER_CYCLE`) | Different patterns; only the card is live. |
| Class rating bands | packages/game-core/src/eligibility.ts:30-55, packages/db/src/services/card.ts:47-53, packages/db/src/services/card.ts:176, apps/web/src/server/horseView.ts:48 (`raceTier` maps `maxRating` back to a tier) | Listed 88 vs 85, G1 108 vs 95, maiden/novice caps differ. |
| Entry cost per race | packages/game-core/src/entries.ts:66-70, packages/db/src/services/races.ts:34 | The cycle's Listed Feature: 1 vs 2. |
| Release payout 50 | packages/game-core/src/lifecycle.ts:240 (`RELEASE_TO_CLUB_CREDITS`), packages/db/src/rules.ts:47 (`releasePayout`, the one used) | Two literals. |
| Care healing 12 h | packages/game-core/src/condition.ts:218, packages/db/src/rules.ts:61 | |
| Bond per care | +6 packages/game-core/src/lifecycle.ts:210, +6 packages/db/src/services/horseLife.ts:236 (no-genome path), +10 packages/db/src/services/horses.ts:117 (older `recordCare`) | |
| Care quality fallback 650 | packages/game-core/src/lifecycle.ts:182, packages/db/src/services/horseLife.ts:201 | |
| Vet level cap 3 | packages/game-core/src/condition.ts:199, packages/db/src/services/horseLife.ts:182, packages/game-core/src/economy.ts:88 (3 vet levels) | |
| Insurance | permille rule packages/game-core/src/economy.ts:71-72; flat 300/2,000 packages/db/src/rules.ts:36-37; flat 300 in packages/game-core/src/economy.ts:345 | |
| Season length | packages/game-core/src/time.ts:12 (`SEASON_DAYS`), packages/db/src/rules.ts:87 (literal 28 × 24 h) | |
| Week length | packages/db/src/services/leagues.ts:24 (`WEEK_MS`), packages/db/src/services/races.ts:185 (qualifying window), packages/game-core/src/time.ts:11 | |
| Stalls 6 / 24 | packages/game-core/src/economy.ts:80-81, packages/db/src/schema.ts:240 (default 6), :260 (CHECK 1..24) | |
| Entry allowance / cap | packages/game-core/src/entries.ts:16-19, packages/db/src/schema.ts:250-251 (defaults 10/20), :256 (CHECK ≤15/≤30) | Raising the max needs a migration. |
| Breedings 4, mare 1/season | packages/game-core/src/lifecycle.ts:45, packages/game-core/src/breeding.ts:33, packages/db/src/schema.ts:384 (CHECK 0..4), :567 (unique dam+season) | Changing either needs a migration. |
| Career 40 starts | packages/game-core/src/lifecycle.ts:30, packages/db/src/schema.ts:391, :401 | Needs a migration. |
| OR 0..140 | packages/game-core/src/ratings.ts:15-16, packages/db/src/schema.ts:388, packages/db/src/gameCore.ts:101 | |
| Field size 12 / target 10 / max 16 | packages/db/src/rules.ts:82, packages/db/src/schema.ts:630 (default 12), :632 (default 10), :654 (CHECK ≤ 16), packages/db/src/services/races.ts:93 (default target 10), packages/db/src/services/card.ts:188 (`min(16, …)`), apps/web/src/server/game.ts:878 (Story 12) | |
| League size 30 | packages/game-core/src/leagues.ts:11, packages/db/src/schema.ts:824 | |
| Course names | packages/db/src/services/card.ts:92, apps/web/src/server/game.ts:812 | |
| Trip lists | packages/db/src/services/card.ts:101, apps/web/src/server/game.ts:814, packages/game-core/src/seasons.ts:51 | |
| Daily entry budget 10 / refill 5 | packages/game-core/src/entries.ts:16, :21 and packages/game-core/src/eligibility.ts:117, :120 (dead helper) | |
| Mutation step 30 | packages/game-core/src/genetics.ts:16, packages/game-core/src/breeding.ts:571 (preview literal) | |
| Affiliate and pool rules | packages/db/src/services/affiliates.ts:68-77, packages/db/src/services/betaMoney.ts:476-485, mirrored in tools/economy-sim/lib/constants.ts:90-130 (checked by `checkSync`) | |
| Referral caps 1500 / 500 | packages/db/src/services/affiliates.ts:76-77, packages/contracts/contracts/PremiumStore.sol:75-76 | |
| Slot cadence in copy | packages/game-core/src/seasons.ts:20 vs UI text apps/web/app/races/page.tsx:30, :49 and apps/web/app/layout.tsx:20 ("every 15 minutes") | Copy is hard-coded. |
| Card horizon in copy | packages/db/src/rules.ts:80 vs apps/web/src/components/competition/RoadToSaturday.tsx:96 ("published 6 hours ahead") | Copy is hard-coded. |
| Weekend Feature rating-by-right 100 | packages/game-core/src/seasons.ts:182 (`featureQualified`), apps/web/src/server/week.ts:63 (`row.rating >= 100`), apps/web/src/components/competition/RoadToSaturday.tsx:58 ("rating 100+") | The This week view re-derives qualification instead of calling `featureQualified`. |
| Market rules in copy | apps/web/src/components/economy/MarketScreen.tsx:60 (70%, 3x, 72 hours) | Copy is hard-coded. |
| Pregnancy in copy | apps/web/src/components/economy/BreedingBarn.tsx:48 ("24 hours") | |
| Refill size in copy | apps/web/src/components/ui/ErrorNote.tsx:40 ("+5 entries") | |
| Freshness window in copy | apps/web/src/components/horseLife/CarePanel.tsx:40, apps/web/src/components/horseLife/TrainingPlanner.tsx:218 ("3 to 5 days") | |
| Free pack cadence suffix | packages/db/src/services/packs.ts:159 ("every 3rd" built as `${n}rd`) | Breaks for other values. |

## Magic numbers not exported

Hard-coded inside functions or files, so a harness can't read them from an export.

| Number | Value | Where |
|---|---|---|
| Live class purses and conditions | `MAIDEN`…`GROUP3` ClassDefs (not exported) | packages/db/src/services/card.ts:47-53 |
| Feature multiplier | 2 | packages/db/src/services/card.ts:55 |
| Live class cycle | `CYCLE` (not exported) | packages/db/src/services/card.ts:82 |
| Feature Listed/G3 coin flip | `h[30] % 2` | packages/db/src/services/card.ts:223 |
| Target runners draw | `8 + h[29] % 5` | packages/db/src/services/card.ts:260 |
| Juvenile trips, open trips, going, weather, tracks | lists | packages/db/src/services/card.ts:92-103, :229, :234 |
| Sister cap | 5 | packages/db/src/services/card.ts:319 |
| Calendar min ratings | 95 / 85 | packages/db/src/services/card.ts:176 |
| Displaced-juvenile lookback | 16 slots | packages/db/src/services/card.ts:271 |
| House-horse rating when minted | band midpoint `(min + max(min, 40… max))/2` | packages/db/src/services/races.ts:399-403 |
| House pool scan | `limit(needed × 4)` | packages/db/src/services/races.ts:425 |
| House tactic | uniform front/stalker/closer | packages/db/src/services/races.ts:387, :458 |
| One-per-stable, half-field, sister trigger | rules | packages/db/src/services/races.ts:301, :306, :331 |
| Qualifying window | 7 days | packages/db/src/services/races.ts:185 |
| Recap points gap | line = rank `PROMOTE`, gap = line points − yours + 1 | packages/db/src/services/leagues.ts:158-161 |
| RULES literals | insurance 300/2,000; listing 14 d; release 50; starters 3; overflow 1; care heal 12 h; horizon 6 h; field 8/12; settle 150 s; epoch 2026-01-05; premium 2,500 | packages/db/src/rules.ts:36-87, :115 |
| Fallback appraisal | `(400 + OR × 40)(0.5 + career left) + 300 × breedings left`, min 100 | packages/db/src/rules.ts:218 |
| Story generator | trips list, 3-in-4 fit, OR ±12, 8-10 runners, class by wins, purse 0, max 12 | apps/web/src/server/game.ts:814, :877-878, :925-946 |
| Story Quick Pick | −40 per run today, −60 if tired | apps/web/src/server/game.ts:845 |
| Card list sizes | 6 upcoming, 8 slots back | apps/web/src/server/game.ts:459-460 |
| Tick throttle | 4 s | apps/web/src/server/game.ts:219 |
| Stud fee cap / listing days | 100,000 / 3, 7, 14 | apps/web/src/server/economy.ts:362, :589 |
| Trophy tiers | rule | apps/web/src/server/competition.ts:340 |
| Fallback risk view | 4 permille, 30 CE share | apps/web/src/server/horseView.ts:162 |
| Injury factor multipliers | durability, fatigue, frequency (+400/+100), distance 1.1, veteran 1.2 | packages/game-core/src/condition.ts:158-175 |
| Career-ending bumps / cap | +30 tired, +20 all-out, cap 200; moderate 30% | packages/game-core/src/condition.ts:181, :196 |
| Morale and fitness formulas | +20/+10/−8, bond/40, ×15/100; 940 + 60 × fitness | packages/game-core/src/condition.ts:77-92 |
| Race fatigue / fitness / bond | 150 + d/10, × (1300 − 0.6 dur); +40; +10/+4 | packages/game-core/src/career.ts:56, :73, :74 |
| Training thresholds | overwork > 600, injury from > 500, trainer max 2 levels, yearling ½, training injury ≤ 4 days, bond +2 | packages/game-core/src/training.ts:136-146, :192, :201 |
| Care values | 1000 / 650 / 450, ×50, 3:1 average, recovery feed > 400 fatigue | packages/game-core/src/lifecycle.ts:173-210 |
| Ride intensity effects | +25/−20, −20/+10 | packages/game-core/src/phenotype.ts:226-229 |
| Mutation caps | rate 400, negative share 950, lean clamp 50..950 | packages/game-core/src/genetics.ts:122, :129, :130 |
| Mint shaping | ×1.2, sd 45, ±140, pure 45%, main 700-950, vigour gem 70-150 | packages/game-core/src/genome.ts:646, :652, :837, :838, :856 |
| Nick score | 25 + 60 + 15 + 10 − COI/4 | packages/game-core/src/breeding.ts:519 |
| Appraisal formula | 400, /12, stage factors, 150, 120, /10, ×15, min 100 | packages/game-core/src/economy.ts:137-143 |
| Stall cost formula | 2,000 + 400 × (n − 7) | packages/game-core/src/economy.ts:84 |
| Daily Cup | jitter −40..+60, points formula, top-10 percentile 100, firm 20% | packages/game-core/src/dailyCup.ts:47, :51, :122, :123 |
| Story chapter bases | 318/368/405/440, +3 per race, fields 7-10, rival ±15 | packages/game-core/src/story.ts:224, :238, :257, :276, :295, :427 |
| Calendar times | 19:00 + 90 s; Final 18:00 + 30 min × i + 90 s | packages/game-core/src/seasons.ts:167-175 |
| League tier bonus | 10 / 6 / 3 | packages/game-core/src/leagues.ts:30-32 |
| Pool score formula | ×15 / max(runs, 8); best 3 Cup days × 5 / 3; linear weights | packages/db/src/services/betaMoney.ts:567, :596-597, :654 |
| Hall candidates | 200 | packages/db/src/services/hall.ts:189 |
| Engine model constants | `PAR_AT_1000` … `STYLE_MATCH_DRAIN` (module-private) | packages/racing-engine/src/model.ts:20-36 |
| Engine sim constants | `MIN_GAP_MM` … `KICK_RESERVE` (module-private) | packages/racing-engine/src/simulate.ts:24-39 |
| Chain defaults | 46630 chain id, 499 ¢, 300 s quote, BE/NL, 1 confirmation | apps/web/src/server/chain/config.ts:53-70 |

## Live vs model mismatches

1. **Purses: live is about 3x the model.** The live card is built by `defaultCardSlot`
   (packages/db/src/services/card.ts) because the web hooks pass no `cardSlot`
   (`raceHooks`, apps/web/src/server/game.ts:109; `tickRaceCard` at :244). Settlement pays
   `race.purse` (packages/db/src/services/races.ts:595). Live vs `PURSE_BY_TIER`:
   maiden 2,000 vs 600 (3.3x), novice 2,500 vs 750 (3.3x), Hcp 0-55 3,000 vs 800 (3.75x),
   Hcp 50-75 4,000 vs 1,100 (3.6x), Hcp 70-95 5,000 vs 1,500 (3.3x), Listed 8,000 vs 2,600
   (3.1x), Group 3 12,000 vs 4,000 (3.0x); Features pay 2x on top. Calendar: Qualifier 16,000
   vs 2,600 (6.2x), Weekend Feature 48,000 vs 20,000 (2.4x), Final 72,000 vs 30,000 (2.4x).
   Everything priced against the model is off by that factor:
   - `weeklyFlow(ACTIVE_PLAYER)` (packages/game-core/src/economy.ts:319) gives earned 9,708 vs
     spent 9,906 per week (ratio 1.02, on target). The same starts at live purses (Story
     "quick" starts paying 0) earn 25,820 per week, ratio 0.38: spend covers well under half
     of income.
   - The economy sim uses `gc.PURSE_BY_TIER` (tools/economy-sim/lib/constants.ts:22), so its
     credit results understate the purse faucet by about 3x.
   - Appraisal adds `earnings / 10` (packages/game-core/src/economy.ts:142), so live earnings
     push appraisals, listing floors/ceilings and insurance premiums/payouts up faster than
     modelled.
2. **The cadence change multiplies the gross faucet.** At 15-minute slots the card posts
   379,200 credits of purses per day per course (79,000 per 20-slot cycle); the old 3-minute
   slots posted 1,896,000. Only placed player runners are minted, so per-player income is
   bounded by entries (10-15/day) and Live starts (1 per horse per day since `6420a5f`, see 16),
   not by the card, but the number of rich races (Features, Listed) a player can reach per day
   falls 5x.
3. **Class pattern.** The model `TIER_CYCLE` has Quick races, a G3 each hour and G2/G1 hours
   (packages/game-core/src/seasons.ts:25-49). The live `CYCLE` has no Quick, G2 or hourly G1;
   slot 0 is a Listed or G3 Feature at double purse; 12 of 20 slots are maiden/novice
   (packages/db/src/services/card.ts:82).
4. **Rating bands.** Listed min OR 88 in `TIER_RULES`/`classBand`
   (packages/game-core/src/eligibility.ts:37, :52) vs 85 on the card (card.ts:52) and for
   Qualifiers (card.ts:176). G1 min 108 in game-core vs 95 for the Weekend Feature and Final
   (card.ts:176). Live maidens cap OR 60 and novices 70 (card.ts:47-48); game-core has no cap.
5. **Juvenile class rules are not enforced live.** `TIER_RULES.juvenileOk`/`juvenileOnly`
   only apply through `gc.entryBlock`, and the web filters those blocks out
   (`CLASS_BLOCKS`, apps/web/src/server/game.ts:642), then uses the card's conditions
   (`classEligibility`, packages/db/src/services/races.ts:167). Licences gate instead.
6. **Handicap weights are not applied live.** `handicapWeights` (packages/game-core/src/ratings.ts:94)
   is called only by tools/balance/ability.report.ts; `engineHorseFromSnapshot` passes no
   `extraWeightLb` (apps/web/src/server/horseView.ts:105-125). Handicaps run at level weights,
   while `ABILITY_OR_TABLE` (packages/game-core/src/ability.ts:36) was fitted on races with
   1 OR = 1 lb weights. The ability floor and band checks are calibrated to a race model the
   game doesn't run.
7. **Entry cost and licence of the card's Listed Features.** Live: 2 entries (kind `feature`,
   packages/db/src/services/races.ts:36). Model `entryCost`: 1 (tier listed,
   packages/game-core/src/entries.ts:69-70). The card's Features and the Weekend Feature need
   the National licence (level 3) since `6420a5f`; before, they needed Classics (level 4), and
   in the harness no stable ever reached a Weekend Feature (apps/web/src/server/game.ts:637,
   packages/game-core/src/story.ts:354). Only the Season Final needs Classics.
8. **Calendar field size.** Model 14 for the Weekend Feature and Final
   (packages/game-core/src/seasons.ts:148); live target 12 (card.ts:189), so house horses only
   fill to 12.
9. **Daily Cup points: resolved by `3659516`.** `runCupEntry` still writes `points: 0`
   (packages/db/src/services/dailyCup.ts:80), because `rankCup` points depend on the whole
   day's field (packages/game-core/src/dailyCup.ts:123). `settleCupDays`
   (packages/db/src/services/dailyCup.ts:102) now writes every finished day's points, lazily
   from the Cup view (apps/web/src/server/competition.ts:96), so the Prize Pool's cup term
   (packages/db/src/services/betaMoney.ts:558-567, :597) is no longer always 0. Today's entries
   still hold 0 until the day ends, so `dailyCupBoard`
   (packages/db/src/services/competition.ts:92) still sorts today's board on a zero column (the
   time tiebreak orders it).
10. **Economy sim is out of sync and would abort.** `checkSync`
    (tools/economy-sim/lib/constants.ts:165-205) fails when `DAILY_GOAL_CREDITS` appears in the
    server, which it now does (packages/db/src/services/dailyGoals.ts:43, 3 × 60 paid per local
    day). The sim also assumes goals are unpaid (constants.ts:26-27) and mirrors a 30% deploy
    pool share (`BETA.poolBps` 3_000, constants.ts:116) while the admin UI default is 10%
    (apps/web/src/components/chain/admin/ChainAdmin.tsx:37). Both trip `checkSync`.
    (Static reading; the sim was not run here because its `tsx` runner isn't installed.)
11. **Seller policy default.** game-core `DEFAULT_SELLER_POLICY.requireVerifiedEmail` is true
    (packages/game-core/src/economy.ts:194); the DB default is false (packages/db/src/rules.ts:254).
    Live sellers need no verified email.
12. **Insurance in the model.** `weeklyFlow` charges 300 flat per insurance
    (packages/game-core/src/economy.ts:345); live charges 5% of appraisal once
    (packages/db/src/services/horses.ts:236).
13. **Story races are rated but pay no purse.** Story uses tier `quick` (rated: true,
    packages/game-core/src/eligibility.ts:41), so Story results move OR; `weeklyFlow` counts
    12 Quick starts a week at 240 credits each, but live Story races have purse 0
    (apps/web/src/server/game.ts:877) and pay Story rewards instead.
14. **House runners.** Their purse shares are never minted (packages/db/src/services/races.ts:597),
    and new house horses are minted on demand with a rating at the band midpoint, not their
    ability (packages/db/src/services/races.ts:399-432). The house population grows without a
    cap as fields lock short.
15. **Premium pack credit price.** 2,500 credits (packages/db/src/rules.ts:115) applies only
    with `PREMIUM_PACK_DEMO=1`; the real price is $4.99 in ETH (apps/web/src/server/chain/config.ts:58).
16. **Starts per day: resolved by `6420a5f`.** The economy model assumed 1-1.5 starts per
    horse per day (packages/game-core/src/lifecycle.ts:37-43), but Live races were limited only
    by the all-races cap of 3, and the season harness saw grinders run horses Live about twice
    a day, burning a 40-start career in about 2.5 weeks. `MAX_LIVE_STARTS_PER_DAY` = 1
    (packages/game-core/src/lifecycle.ts:44, enforced packages/db/src/services/races.ts:290) now
    matches the model: a career takes at least 40 days of Live racing. Still out of step: the
    economy sim's credits model gives each horse `GAME.startsPerDay` = `MAX_STARTS_PER_DAY` (3)
    starts a day (tools/economy-sim/lib/constants.ts:54, tools/economy-sim/models/credits.ts:190).
17. **Weekend Feature band vs qualifying. Resolved 2026-10-29:** the Weekend Feature has no rating floor now; qualifying is its only gate. Was: `featureQualified` lets a top-3 Qualifier finisher
    in (packages/game-core/src/seasons.ts:181), and Qualifiers are open from OR 85, but the
    Weekend Feature's own band is OR 95+ (packages/db/src/services/card.ts:176, checked by
    `classEligibility`, packages/db/src/services/races.ts:170). A horse rated 85-94 that finishes
    top 3 is qualified yet refused by the band; the This week page still lists it as "In for
    Saturday" (apps/web/src/server/week.ts:62-64). The Saturday Plate has no band.
