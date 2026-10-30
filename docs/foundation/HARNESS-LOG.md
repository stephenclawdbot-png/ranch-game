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

## Decisions (2026-10-29/30)

1. One Live race per horse per day (`MAX_LIVE_STARTS_PER_DAY`), Story keeps the all-races cap.
2. Features and the Weekend Feature need the National licence; the Season Final keeps Classics.
3. Stud fees capped at the stallion's appraisal; paid coverings between linked accounts refused.
4. Purses halved; every Live race charges 5% of its purse (`CARD_ENTRY_FEE_PERMILLE`).
5. Qualifiers open to every rating; the Weekend Feature's gate is qualifying, not a rating floor.
6. Calendar races published a day ahead (`CALENDAR_HORIZON_MS`) and shown in the race list.

## Open

- **Economy:** 61 spent per 100 earned against a healthy 85-115. Remaining faucets after
  purses: daily goals (~227k a season), Story rewards (~174k), Daily Cup (~93k). Casual stables
  end the season on ~19k with nothing they need to buy. Next lever is an owner decision
  (recurring upkeep, credit cosmetics, or smaller fixed rewards).
- **Undetected alt groups** still move ~6k a season through stud fees (under the fee cap).
- **Player share of Live runners** ~10% at 50 stables: fields are mostly Club runners at beta
  scale; rises with players.
- Casual stables rarely reach Saturday (10%): expected for one visit a day; watch in the beta.
