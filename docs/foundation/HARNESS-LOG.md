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

## Decisions (2026-10-29/30)

1. One Live race per horse per day (`MAX_LIVE_STARTS_PER_DAY`), Story keeps the all-races cap.
2. Features and the Weekend Feature need the National licence; the Season Final keeps Classics.
3. Stud fees capped at the stallion's appraisal; paid coverings between linked accounts refused.
4. Purses halved; every Live race charges 5% of its purse (`CARD_ENTRY_FEE_PERMILLE`).
5. Qualifiers open to every rating; the Weekend Feature's gate is qualifying, not a rating floor.
6. Calendar races published a day ahead (`CALENDAR_HORIZON_MS`) and shown in the race list.
7. Credit sinks (owner picks): weekly upkeep on horses used that week, race-day extras, jockeys,
   race sponsorship; upkeep set to 375 racing / 200 stud after sinks2.

## Open

- **Economy:** 81 spent per 100 earned (starter grants excluded) against a healthy 85-115.
  More upkeep is the wrong lever from here: it lands on grinders (median 1.4k in sinks2) and
  displaces optional spending, while casual and farmer stables keep 9-11k with nothing they need
  to buy. The last ~4 points need a hoarder sink (credit cosmetics) or a smaller fixed faucet
  (daily goals 3 × 60, an owner decision).
- **Undetected alt groups** still move ~6k a season through stud fees (under the fee cap).
- **Player share of Live runners** ~10% at 50 stables: fields are mostly Club runners at beta
  scale; rises with players.
- Casual stables rarely reach Saturday (10%): expected for one visit a day; watch in the beta.
