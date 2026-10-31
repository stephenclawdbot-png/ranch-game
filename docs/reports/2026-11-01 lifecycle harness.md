# Life clock change: season harness, old vs new (2026-11-01)

Owner decision: foals race after 12 care days (was 19), careers last 34 starts (was 40, stage
bands and peak windows scaled 34/40), racing horses breed from 16 starts (was 25). Checked with
the season harness before shipping: 28 days, 50 stables, seed season-harness-1, engine 1.4.0,
same code otherwise (life-base = dev before the change, life-new = with it).

| | life-base | life-new |
|---|---:|---:|
| Destroyed per 100 created (target 85-115) | 85.3 | 89.5 |
| Credits held by players at the end | 276,060 | 250,566 |
| Live races run | 482 | 506 |
| Player share of Live runners | 58.2% | 65.0% |
| Live races with a player won by a player | 51.1% | 56.8% |
| Player win rate per Live start | 8.6% | 8.6% |
| Feature Qualifier player runners / top-3 | 176 / 39 | 224 / 48 |
| Foals bred | 31 | 32 |
| Horses retired from racing | 57 | 64 |
| Live race injuries / deaths | 16 / 0 | 17 / 0 |
| Entry fees / upkeep sunk | 261,058 / 196,000 | 310,433 / 227,563 |
| Checks (ledger, conservation, exceptions) | pass, pass, 0 | pass, pass, 0 |

Reading: more horses reach the track sooner, so more player runners, more entry fees and upkeep
(the sink ratio moves from the bottom edge of the band into it), and less credit inflation.
Foals bred barely moves inside 28 days (the harness breeders still mostly breed retired horses);
the earlier breeding gate matters more over a longer season. No regressions found.
