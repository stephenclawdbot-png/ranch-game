# Design meeting: empty races (2026-10-30)

Participants: Claude (lead), GLM and Kimi (outside models, read-only on the repo). Two rounds:
independent proposals, then a cross-critique to agree one plan. Full answers were kept out of the
repo; this is the record.

## The risk

Harness sinks2 (50 stables, 28 days): 39.8% of Live races had any player runner, players were
10.4% of runners, the horse market made 0 sales, casuals ran 0 Weekend Features. The card has
~960 runner places a day against ~100 player starts, so the share can't rise much by adding
demand: the fix is concentrating supply.

## Agreed plan

**Ship first (all three proposed it independently)**

1. **Race meetings.** Publish 3 meetings a day (07:00, 13:00, 19:00 UTC; rotate weekly for time
   zones) of 8 races at the 15-min spacing: 24 Live races a day instead of 96. Keep the 6 h
   horizon, calendar races and sister courses (the overflow when meetings fill, the path to
   5,000 players). Field minimum 8 → 5 and Club horses filled at the lock, so 4 players + 3 Club
   shows as that, not 10 Club.
2. **Fold playerless races forward.** A non-calendar race with no player runner at the lock is
   quietly folded into the next same-class slot (existing refund path).
3. **Show other players.** "N stables entered" on the race list, busiest races first, stable
   names on cards.

**Next**

4. **Claiming races.** One claiming slot a day in the evening meeting, rotating handicap bands:
   the owner posts a price within the market's 70-300% appraisal band; any stable with a free
   stall can claim before the lock; the horse moves after the race; 5% burned; 72 h resale lock;
   linked accounts refused. The race is the market.
5. **Casual Qualifier access.** Qualifiers at 19:00 and 21:00 UTC (one horse per stable a day,
   best result counts).
6. **Club seeds the markets.** 2-3 Club horses listed a day (~110% of appraisal) and 4 Club lease
   offers, withdrawn as player supply grows.

**Later / gated:** leasing gate 7 days/10 starts → 3/3 once Club lease offers exist; standing
orders (auto-entry) only if meetings don't fix casual starts.

## Rejected

- More entries or Live starts a day: burns 40-start careers again and feeds farmers.
- Bonus purses for empty races: pays the emptiness; alts would park horses in lonely slots.
- A standing Club buyout bid: a credit faucet and a price floor that only farmers and quitters sell into.
- Unbinding starters/gift foals: reopens farming free horses for credits.
- Opening the USDG market for liquidity in the beta: no registered stock yet, and money on the
  line before the guards are tested.

## Acceptance (harness, same seed)

- Live races with a player runner >= 85% (from 39.8%)
- Player share of runners >= 35% (from 10.4%)
- Credits created a day within ±10%; turn-aways <= 1% of entry attempts
- After claiming: >= 10 sales a season; casual Qualifier runs >= 40%, casual Weekend Feature >= 5%
