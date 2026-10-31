# Season harness log: runs and the decisions they drove

Every run: 28 simulated days, 50 stables (20 casual, 12 grinder, 10 breeder, 8 farmer in two
alt groups, one detectable), seed `season-harness-1`, the real server code
(`tools/season-harness`). Reports: `tools/season-harness/out/<tag>/` (not committed; rerun to
regenerate).

| Run | Change under test | Spent per 100 earned | Qualifier runners / top 3 | Weekend Feature runners | Notes |
|---|---|---:|---:|---:|---|
| baseline | 15-min card, genetics v2 | 52.4 | 6 / 2 | 0 | careers burned in ~2.5 weeks; stud-fee wash 143k; Weekend Feature needed the Classics licence |
| fixes1 | 1 Live start/day, National licence for Features, stud fee cap + linked-account block, training pad fix | 46.1 | 0 / 0 | 0 | wash gone; retirements halved; nobody rated 85+ for Qualifiers |
| fixes2 | purses halved, 5% entry fee, Qualifiers open to all ratings | 55.1 | 5 / 1 | 0 | player balances -39% |
| fixes3 | calendar races published 24 h ahead | 55.6 | 4 / 0 | 0 | still invisible: the race list showed only 6 h |
| fixes4 | race list shows calendar races | **60.8** | **182 / 51** | **20** | every grinder qualified and ran on Saturday; casuals 10% |
| sinks1 | weekly upkeep 250 / 150, race-day extras, jockeys, race sponsorship | 77.6 | 170 / 46 | 23 | credits held -33%; upkeep 176k, extras 67k, sponsorship 50k, jockeys 30k |
| sinks2 | upkeep 375 racing / 200 stud | 81.3 | 189 / 52 | 28 | upkeep 262k, but sponsorship (-22k) and stall purchases (-17k) fell; grinder median balance 3.3k → 1.4k while casuals keep 11k |
| goals45 | daily goals 3 × 45 (was 3 × 60); horse leasing live | **85.2** | 195 / – | 25 | in the healthy range; created -73k; casual median 11.0k → 9.2k, grinders unchanged (1.5k); leasing: 15 offers, 2 leases |
| meetings1 | race meetings: 3 a day × 8 races (07:00, 13:00, 19:00 UTC), card 24 h ahead, field minimum 5, playerless ordinary races called off; harness entry sheets look at the next meeting(s) | 85.1 | 207 / 55 | 27 | **97.2% of Live races run had a player (was 39.9%), player share of runners 58.1% (was 10.4%)**; 500 races run + 297 called off (61% of published races had a player at the close); avg field 9.8; created 1,181,002 (-5.2% vs goals45); casuals ran a Qualifier 35% (was 20%) and the Weekend Feature 10% (was 0%); grinder median 1.5k → 0.7k; Live injuries 13 → 23; foals above both parents 11 of 31 → 2 of 25 (not explained yet) |
| courses1 | weather and ground per course, course character (engine 1.3.0), Club market seeding | 88.1 | 205 / 57 | 26 | 97% of races run had a player, share 58%; injuries 13 → 16 (no deaths) on the wetter ground; **grinder median 23 credits** (upkeep + 5% entry fee + extras with players now beating each other); 48 Club lots listed, 0 sold (harness casuals' stalls are full and they never sell or retire to make room); 1 lease taken. Racing upkeep 375 → 300 after this run |
| courses2 | racing upkeep 375 → 300 | 85.6 | 214 / – | 26 | grinder median 23 → 1.2k credits, spending still in range; injuries 18 (no deaths); 2 leases taken, Club lots still unsold (harness stalls full) |
| clubfill0 | the same run as courses2 (66ba616), rerun with the new player-win and field-spread metrics: the baseline for the Club fill runs | 85.6 | 214 / 60 | 26 | players won 67.3% of the Live races they ran in and 11.5% of their starts; purses 602k; Live winner-to-last 48.2 m, winning margin 6.3 m (medians) |
| clubfill1 | honest Club runners from the top half of the race (game-core `clubFill.ts`): seasoned, fully trained Club horses rated at their real ability, window [band middle, max] or [players' median, +12] in open races; old Club ratings recalibrated once | 89.5 | 208 / 38 | 16 | **players won 34.7% of the races they ran in (was 67.3%) and 6.0% of starts (was 11.5%)**; purses 602k → 336k (-44%), credits created -21% and destroyed -21% vs clubfill0; Qualifier top-3s 60 → 38, Weekend Feature runners 26 → 16; median OR casual 46.5 → 44, breeder 42.5 → 40, farmer 43.5 → 40, grinder 44 → 45; best player OR 64 → 81; stables with a Live win: casual 100% → 85%, farmer 100% → 75%; grinder median balance 1.2k → 218; Live injuries 18 → 24 (minor 13 → 20, borderline at these counts) |
| clubfill2 | window anchored on the entered players: [P − 2, P + 10] with P = their median `bandRatingOf`, clipped to the band; targets lean to P (cubed slices) | 88.1 | 184 / 36 | 15 | players won 41.6% of their races, 7.1% of starts; purses 357k (-41%). The band rating runs well above real ability (a new horse is OR 40 at ~30-35), so the Club sat too high |
| clubfill3 | as clubfill2 with [P − 4, P + 8] | 85.7 | 177 / 33 | 17 | 40.7% / 7.1% per start, purses 349k: no better, so the anchor, not the width, was the problem |
| clubfill4 | P = the players' median real ability mark (`abilityMark`), [P − 2, P + 10] (engine 1.3.0) | 87.9 | 205 / 48 | 20 | 48.5% / 8.1% per start; purses 430k (-28%); winner-to-last 48.2 → 44.3 m, winning margin 6.3 → 4.8 m |
| dev140 | dev at 2fc2bb7 (engine 1.4.0: close finishes, Live handicap weights, ability table refit), no Club fill: the merged baseline | 84.7 | 164 / 53 | 26 | players won 68.8% of their races, 11.3% of starts; purses 577k; winner-to-last 35.8 m, winning margin 3.5 m; injuries 12 |
| clubfill7 | clubfill4's Club fill merged with engine 1.4.0 (final: [P − 2, P + 10] on real marks) | 88.1 | 199 / 44 | 19 | **players won 50.3% of their races, 8.2% of starts**; purses 600k (courses1) → 421k (-30%; -27% vs dev140); credits created -16%, destroyed -19% vs courses1; **winner-to-last 32.2 m** (courses-era 48.2, dev140 35.8), winning margin 3.1 m; median balances casual 7.4k, grinder 775, breeder 2.9k, farmer 6.0k; injuries 23 (moderate 10; dev140 12) |
| clubfill8 | as clubfill7 with [P − 4, P + 6] (a softer Club) | 83.9 | 177 / 43 | 17 | 55.9% / 8.9% per start; purses 452k (-25%); winner-to-last 32.2 m; injuries 17. Purses within -20% would need the Club centred below the players' median: an honest Club takes place money the old one never did |
| dev140s, clubfill7s | dev140 and clubfill7 rerun with the race-day runner states (`runnerStates`: fitness, fatigue, training, care, extras and injury risk of every Live runner) | 84.7 / 88.1 | – | – | players' median race day: fitness 700 (mark ≤35) / 1,000 (36+), fatigue 175 / 310, realisation 633 / 691, condition 974 / 983, 43% tired, 63% on their own surface; the Club ran fit (1,000), fresh (fatigue 0), fully trained (1,000) and always on its own surface: condition 1,000. Injuries vs the risk model's expectation: 12 / 20.0 (dev140s), 23 / 19.3 |
| clubfill9 | Club race-day parity: realisation and care like the median player horse of its mark at mint; fitness, fatigue (the raw median) and bond at the lock; 37% off their own surface; non-ability stats no longer lifted | 85.4 | 197 / 43 | 16 | 50.7% / 8.1% per start; purses 399k (-33%); Club condition still 995 vs players' 978 (the raw median fatigue misses the ~43% who race tired): fatigue reset to match the median condition (975 / 985) for clubfill11; injuries 28 / 18.5 expected |
| clubfill10 | clubfill9 with [P − 4, P + 8] | 85.7 | 203 / 49 | 27 | 55.3% / 9.0%; purses 483k (-20%); grinder median 954; injuries 17 / 19.3 |
| clubfill11 | **final**: [P − 2, P + 10], race-day parity with matched condition (Club 985 / players 978 overall; 975 / 985 by mark) | 86.5 | 191 / 40 | 22 | **players won 52.8% of their races, 8.6% of starts**; purses 426k (-29% vs courses1, -26% vs dev140); created 1.01M (-15%), destroyed 745k (-18%); winner-to-last 31.5 m (courses era 48.2), winning margin 3.3 m; median balances casual 8.7k, grinder 649, breeder 3.2k, farmer 6.0k; injuries 18 / 18.7 expected |
| clubfill12 | clubfill11 with [P − 4, P + 8] | 83.9 | 222 / 55 | 25 | 57.1% / 9.1%; **purses 491k (-18%)**; created 1.08M, destroyed 778k; winner-to-last 32.8 m; grinder median 715; injuries 18 / 19.5 |

Injuries with Club fill (2026-10-31): over the six runs with runner states, Live injuries per player start
match the risk model (`injuryRisk` at the off): Club fill runs 104 injuries vs 95.3 expected, dev140s 12 vs
20.0. The exposure did not change: mean risk 6.7-6.9 ‰ per start vs 7.1 ‰ on dev, vet checks 4.3-5.1% vs
5.0%, tired at the off 40-43% vs 45%, nobody rides all out, starts within 3%. The rolls are seeded per
(race seed, horse) and the risk ignores the rest of the field; Club horses' own injuries are never counted
(no inbox). The rise from courses1 (16) and dev140 (12) is noise, not the house-horse path.

## Decisions (2026-10-29/30)

1. One Live race per horse per day (`MAX_LIVE_STARTS_PER_DAY`), Story keeps the all-races cap.
2. Features and the Weekend Feature need the National licence; the Season Final keeps Classics.
3. Stud fees capped at the stallion's appraisal; paid coverings between linked accounts refused.
4. Purses halved; every Live race charges 5% of its purse (`CARD_ENTRY_FEE_PERMILLE`).
5. Qualifiers open to every rating; the Weekend Feature's gate is qualifying, not a rating floor.
6. Calendar races published a day ahead (`CALENDAR_HORIZON_MS`) and shown in the race list.
7. Credit sinks (owner picks): weekly upkeep on horses used that week, race-day extras, jockeys,
   race sponsorship; upkeep set to 375 racing / 200 stud after sinks2.
8. Daily goals trimmed to 3 × 45 (owner, 2026-10-30): goals45 lands at 85.2.
9. Race meetings (owner-approved plan, 2026-10-30): the Live card concentrates into three meetings of
   eight races a day, published a day ahead, minimum field 5, ordinary races with no player called
   off at the close (calendar and sponsored races always run). meetings1 meets the targets (85%+
   races with a player, 35%+ player share, credits created within ±10%).

## Open

- **Economy:** 85.2 spent per 100 earned (goals45), inside 85-115 but at its bottom edge.
  Grinders end the season on ~1.5k: if beta players feel squeezed, ease racing upkeep (375)
  before touching anything else. Credit cosmetics remain the next hoarder sink if needed.
- **Empty races:** fixed by the race meetings (meetings1: 97% of races run have a player, 58% of
  runners are players). 37% of published meeting races are still called off at 50 stables: watch
  it in the beta, and the next steps of the plan (claiming races, Club-seeded markets) in
  `docs/reports/2026-10-30 empty races meeting.md`.
- **After the meetings (meetings1), lead's read:**
  - *Grinders 1.5k → 0.7k* is the meetings working: with 58% of runners players, grinders now
    beat each other for purses instead of beating Club horses (purses paid -66k, -10%). If beta
    grinders feel squeezed, ease racing upkeep (375) first.
  - *Foals above both parents 11/31 → 2/25:* no breeding code, breeding agent or genetics changed
    (the metric reads genomes only); the pairings differ because balances and stud choices differ.
    25 foals is too few to read; rerun with another seed before acting.
  - *Live injuries 13 → 23:* borderline at these counts (Poisson). Watch in the next run; if it
    holds, look at tired entries (grinders enter with `tiredOk`) and the going at meeting times.
- **Undetected alt groups** still move ~6k a season through stud fees (under the fee cap).
- Casual stables rarely reach Saturday (10%): expected for one visit a day; watch in the beta.

## 2026-10-31 decision: Club fill stays at [P-2, P+10] (owner chose option A)

Compared after clubfill11 (the merged Club fill with race-day parity):

| Option | Purses vs courses1 | Players win races they enter | Per start | Spent per 100 |
|---|---|---|---|---|
| **A: [P-2, P+10] (kept)** | −29% | 52.8% | 8.6% | 86.5 |
| B: [P-4, P+8] (clubfill12) | −18% | 57.1% | 9.1% | 83.9 |
| C: A + everyday card purses ×1.2 (purse120) | −22% | 51.4% | 8.4% | 86.0 |

C only lifts purses ~10% net because card entry fees are 5% of the purse. The owner wants Club
fields to be a real challenge for players ("median and above"), so A stays; revisit purses if
the beta shows stables going broke (grinder median balances swing 145-954 between runs).
