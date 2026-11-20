# First-week pacing and new-player balance (2026-11-20)

Week-one data from 112 testers: 92% ran a first race within about 40 seconds, 24% came back the
next day, almost nobody by day 7. One tester of 108 ever bred a horse; nobody leased or claimed.
Players held 329k of the 424k credits created. First results often read "Rating 40 → 37, down 3".

This pass changes pacing knobs only, each justified by a measurement through the real server code
(`tools/season-harness`) and each one constant to revert. The racing engine is untouched.

## What was wrong, measured

**Breeding was out of reach.** A racing horse could breed after `BREED_FROM_STARTS` = 16 starts. A
start is a **Live** race: Story races never use the career clock (`packages/db` `settleRace`), and a
horse runs one Live race a day. So 16 starts were at least 16 days for a stable that enters its
filly every day, and about seven weeks for one that enters one Live race a day (its filly runs
every third day). Then 24 hours in foal and 12 care days. In the first-week scenario nobody could
cover a mare in the first 12 days without retiring her. (The pure rules in game-core count a
Story race as a start; the database layer is what keeps Story off the clock. A value of 5 would
still have meant day 5 at the earliest and about two weeks for a casual stable.)

**The first results were stacked against a new horse, twice.**

1. Every debutant was rated 40. A starter's real ability mark averages 32, and Club runners have
   been rated at their real mark since the Club fill work. On the ratings a new horse was expected
   to beat fields it could not, so its rating fell whatever it did: −1.1 after one start, −2.5
   after two, −3.4 after three (mean of 2,548 horses; 66% were lower after three starts).
2. A Club runner is a seasoned horse. At the same ability mark it out-runs a debutant: the mark
   counts speed, stamina and burst, and the Club horse's temperament, soundness and adaptability
   are a grown horse's (mean of all six stats: Club 430, starter 410, in fields drawn 4 marks
   *below* the starter). Head to head a starter finished ahead of a Club runner of its own mark
   52% of the time, and ahead of one 8 marks lower 61%. The first race's window (8 below to 2
   above) was therefore about level, not kind, in a field of 8-10.

## What changed

| Knob | Was | Now | Where |
|---|---|---|---|
| `BREED_FROM_STARTS` | 16 | 1 (one Live race) | game-core `lifecycle.ts` |
| `CARE_TO_WEAN` / `CARE_TO_YEARLING` / `CARE_TO_RACING` | 3 / 7 / 12 | 2 / 5 / 8 | game-core `lifecycle.ts` |
| Debut rating | flat `INITIAL_OR` 40 | the horse's real ability mark (`debutRating`) | game-core `phenotype.ts`; db `gameCore.ts`, `horseLife.ts`, `races.ts` |
| `STORY_OPEN_BELOW` (open Story races in chapter 1) | 8 marks below the horse | 10 | game-core `story.ts` |
| `STORY_FIRST_BELOW` (a stable's first race) | 8 | 12 | game-core `story.ts` |
| `STORY_CLUB_OPEN_RUNNERS` (field size in chapter 1) | 8-10 | 7-8, the first race 7 | game-core `story.ts` |
| `STORY_OPEN_EASE_FROM_LOSSES` / `STORY_OPEN_MARKS_PER_STEP` | eases from 2 losses in a row, 2 marks a step | from 1 loss, 3 marks a step (at most 3 steps) | game-core `story.ts` |
| Colt/filly → stallion/mare (`sexLabel`) | at `BREED_FROM_STARTS` starts | out of the juvenile stage (6 starts) or retired | game-core `lifecycle.ts` |
| First-week list order | breeding second to last, behind a Feature Qualifier | stallion finder and "Breed your first foal" right after the Daily Cup | game-core `onboarding.ts` |
| Bloodline nudge | day 3: "retire your filly to the broodmares" | the day a racing filly has run a Live race (or day 3): "pick her a stallion", or "she needs a Live race"; never asks to retire | game-core `onboarding.ts`, `BloodlineNudge.tsx` |
| Story Quick Pick | could pick a mare in foal (the entry then failed) | leaves mares in foal out | web `horseView.ts`, `story.ts`, `game.ts` |

Not changed: the engine, purses, fees, the starter grant (3,000), the covering fee (1,500), the
Club's house stud fees (250 / 400 / 700), one covering per mare per season, four breedings for
life, 24 hours in foal, the season's foal crop cap, stalls, and Story chapter races (already
pitched from the runner, 2026-11-01).

## Goal 1: breeding inside the first week

First-week scenario (`firstWeek.harness.ts`): new stables through 12 days, the Live card driven as
the cron does. Casual: one visit a day (care, the Daily Cup, one Story race, one Live Quick Pick).
Engaged: two visits (15-20 minutes in all; up to three Story races a visit, three Live entries a
day). Both cover a mare as soon as the barn allows and they can pay. Day 1 is the founding day.

FIRSTWEEK_TABLE

The first sensible pair for a starter stable (colt, filly, colt) is its own Thoroughbred filly and
one of its own colts: a colt that has run a Live race covers for the covering fee alone, 1,500 of
the 3,000 starter credits. A Club house stud costs 1,750 to 2,200 (1,500 plus his fee). In the
scenario SIRES.

Why 1 and not 5 (the proposed starting point): starts are Live races. At 5 the engaged stable
covers on day 5 at the earliest and the casual one, whose filly runs every third day, about day
13; the home-bred runner would arrive in week three or four. At 2 the engaged stable covered on
day 2 but the casual one on day 8 (median of 10 stables, range 4-11), outside the week most
testers play. One Live race is also what the first-week list already asks for ("Enter a Live
race", "Watch your Live race"), so the rule reads "race her once on the Live card".

## Goal 2: first results that feel fair

First races probe (`firstRaces.harness.ts`): 2,000 seeded new stables before and 2,000 after, each
tapping "Race now" (Story Quick Pick) five times on the founding day; half of them four more the
next day so every starter has three starts. Read back from `race_entries`: what the result page
showed.

FIRSTRACES_TABLE

The rating fix is the debut rating, not the fields: the same after-change races replayed from a
flat 40 still lose 3.3 points over three starts. Races stay honest simulations: only the field
(who the Club sends, how many) and the mark a horse starts on changed.

What happens to horses already in the database (no migration):

- A horse that has raced keeps its rating.
- An unraced horse of racing age still stored at 40 shows its ability mark on the stable and horse
  pages at once and is seated at it when it enters its first race (`ratingOf`, `enterRace`).
- A youngster is seated the day it reaches racing age. One with 8-11 care sessions is of racing
  age at once and appears as "ready to race" in the nursery.
- A racing horse with at least one start may breed. Colts and fillies with 6-15 starts are now
  called stallions and mares.

## Goal 3: a first week where credits matter

Same scenario, medians per persona, credits.

CREDITS_TABLE

Before, a new stable had nothing it wanted: by day 7 the casual stable had spent 1,327 (900 of it
the week's upkeep) and held 5,884; the engaged one held 7,834. That is the tester data (329k of
424k held). After, the first covering is the first real purchase on day 1-3, and an engaged
stable that also buys a Paddock Pack and the first vet upgrade is down to about 2,000-3,000 for
most of the week. It can afford, in order: a covering from day 1 (1,500 of 3,000), a Paddock Pack
the same day (1,200) but then nothing else until day 4-5, the vet (3,000) around day 5, a seventh
stall (2,000) instead of the vet; the trainer (6,000) not inside the first week. Covering, a pack
and one upgrade cannot all be had in week one: a choice, neither trivial nor out of reach. So the
starter grant and the covering fee stay as they are.

Standard season (28 days, 50 stables, seed `season-harness-1`): SEASON_LINE

## Goal 4: other findings

- **Fixed: Story Quick Pick picked a mare in foal.** The pick ignored pregnancies, so "Race now"
  and the Story screen could choose her and the entry then failed ("mares in foal do not race").
  Rare while only retired mares bred; with racing mares in foal it showed up in the scenario at
  once (8 refusals in 20 stables over 12 days). Quick Picks now leave her out.
- **Listed: injuries in an engaged first week.** INJURY_LINE A race or a training session costs
  about a day's recovery (fatigue +250 to +420; recovery 288 a day), the game lets a horse run
  three times a day, and risk doubles when tired. A minor injury is 2-4 days and a moderate one
  6-12 with three horses in the yard. Not changed here (it is a rule, not a knob); a gentler first
  week (for example no moderate injuries in Story races while in chapter 1) is worth a decision.
- **Listed: a new starter's care quality starts at 0.** The row's column default is 0 while
  game-core assumes 600, so starters begin without any care bonus and climb from the first care
  session. Small (about 1% of a stat at most); noted because the two layers disagree.
- **Listed: a mare covers once a season.** After the first foal the starter filly cannot be
  covered again until the next season (up to four weeks). The second covering needs a second
  mare: the day-2 gift foal is a filly half the time and races on day 9. Left alone: it bounds the
  horse population and the base-fee sink.
- **Listed: stalls fill in week one.** Three starters, the gift foal, a pack foal and the first
  home-bred foal make six. The free Paddock Pack every third play day then needs a seventh stall
  (2,000): the next natural purchase.
- **Listed: three `finances.test.ts` cases fail on any date after 2026-11-10** (they compare ledger
  rows stamped with the wall clock against a fixed "now"). They fail the same way at 396ab71.
- Daily goals (race, care, the Daily Cup: 3 × 45) can all be done on day 1. Story rewards do not
  stall in week one (casual about 1,400 over seven days, engaged about 3,000).

## Reverting

Each change is one constant: `BREED_FROM_STARTS`, the three `CARE_TO_*`, the `STORY_*` knobs above,
and `debutRating` (return `INITIAL_OR` to get the flat 40 back; horses already seated keep their
ratings). The list order is `FIRST_WEEK_ORDER`. Nothing was migrated, so nothing has to be undone
in the database.
