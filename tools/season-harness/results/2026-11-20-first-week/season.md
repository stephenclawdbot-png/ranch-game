# Season regression (2026-11-20)

The standard season: 28 simulated days, 50 stables (20 casual, 12 grinder, 10 breeder, 8 farmer),
seed `season-harness-1`.

**After the change, the full 28 days** (`HARNESS_TAG=firstweek1`, 58.8 minutes; the harness's own
summary is `season-after-summary.md`, its daily lines `season-after-days.txt`): all checks passed,
**87.7 credits destroyed per 100 created** (starter grants excluded; target 85-115).

**Before, the first 14 days only** (396ab71, `HARNESS_DAYS=14`): the machine was restarted three
times during this work, so the baseline was run for the longest stretch that fitted. The table
compares it with the first 14 days of the full after-change run (its daily samples).

| Days 1-14 | Before (396ab71) | After |
|---|---:|---:|
| Destroyed per 100 created (starter grants excluded) | 81.5 | 84.4 |
| Credits created | 611,678 | 644,418 |
| of which purses | 200,065 | 227,553 |
| of which Story rewards | 98,440 | 99,900 |
| Credits destroyed | 376,355 | 417,465 |
| of which entry fees / upkeep / coverings | 112,529 / 91,400 / 46,522 | 129,847 / 113,500 / 53,700 |
| Live races run | 263 | 284 |
| Player runners in Live races | 1,379 | 1,656 |
| Live races won by a player | 124 | 142 |
| Player horses at racing age, unretired (juvenile + prime) on day 14 | 153 | 227 |
| Youngsters in the nursery on day 14 | 124 | 48 |
| Coverings | 28 | 31 |
| Live injuries (minor / moderate) | 8 / 3 | 7 / 4 |
| Median rating of racing horses on day 14: casual / grinder / breeder / farmer | 41 / 43 / 39.5 / 40 | 36.5 / 37 / 35 / 34 |
| Best player rating on day 14 | 57 | 54 |
| Median balance: casual / grinder / breeder / farmer | 6,222 / 2,550 / 3,019 / 4,298 | 5,981 / 2,571 / 3,027 / 5,522 |

What it shows: foals reach the track four days sooner, so there are more player runners, more
purses won by players (+14%), and more entry fees and upkeep (+15%, +24%); spending per 100 earned
moves up 2.9 points, the same direction as the 2026-11-01 life-clock change (85.3 → 89.5 over 28
days). Ratings sit 4.5-6 points lower: debutants start on their real mark, not 40.

What it does not show: a like-for-like 28-day baseline (the ratio rises through the season as
weekly upkeep and facilities come in: 84.4 at day 14, 87.7 at day 28 after the change), and
run-to-run noise is about 0.5% a day (two runs of the same code differ: the harness is not
bit-for-bit repeatable any more). The harness's breeders still retire a mare to breed her, so the
earlier breeding rule itself is exercised by the first-week scenario, not here.

Follow-up: a 28-day baseline at 396ab71 for the full comparison (about an hour of machine time).
