# Post Time economy and finance audit (closed beta)

**Date:** 2026-10-26.
**Scope:**
- the Stable Credits economy;
- the closed-beta money loop: Premium Packs for ETH, the PrizePool and the 2-level
  affiliates;
- prize distribution and anti-drain;
- legal and ethics flags.

**Method:**
- a reproducible simulation in `tools/economy-sim/`. It imports the real game-core rules,
  mirrors the db/web money rules and checks the mirrored values against the source on every
  run;
- result tables are in `docs/economy/results/`;
- rerun with `pnpm exec tsx tools/economy-sim/main.ts`.

**Status:** this audit changes no game, contract or app code. Every change below is a
recommendation for the owner to decide on.

Behavioural inputs (tester mix, spend, decay) are **assumptions**: there is no telemetry yet.
They are listed in `tools/economy-sim/README.md` and swept in `results/sensitivity.md`. The
structural findings (what the rules allow, where money goes, what the score measures) don't
depend on them. The dollar amounts do.

---

## Executive summary

At ~50 testers the money is small. The model gives about **$413 of pack sales over the
2-week beta**:

| Destination | Amount |
|---|---|
| Prize Pool | $124 |
| Owner (treasury + the owner's own commissions) | $276 (67%) |
| Other testers' commissions | $13 |
| Gas | $0.43 (negligible) |

Prizes are tiny: rank 1 gets **$3.54 in week 1 and $4.76 in week 2**, and the $20 cap never
binds. **64% of the pool is still unallocated when the beta ends.**

The contracts themselves are sound. The pot cannot be drained: payouts are at most 25% of
the free balance a week and $20 per player, with no owner withdrawal. **No buying strategy
is positive-EV.** The best case, a colluding group at the contract maximums that wins 100% of
the prizes, gets back **$0.77 per $1**.

The real problems sit around the contracts, in five places:
- a red-line leak from ETH into credits and back into prizes;
- a score that measures time spent, not skill;
- a 2-week beta in which purchased foals can never race;
- an affiliate tree that mostly pays the owner and reads as multi-level marketing;
- a pack product that loses its breeding value by season 2.

### Top 5 risks

1. **ETH turns into credits, and credits turn into prize points (red-line breach).**
   - Premium foals are tradeable: `packs.ts` sets `bound: !!input.free`. A tester can sell
     one on the credits market, which breaks *"nothing bought turns back into credits"*.
   - Pool scoring only excludes the exact horse pulled from a pack (`pack_pulls.horse_id`).
     Its offspring, and horses bought with the credits it sold for, do score.
   - Over 12 weeks this lifts whales from **16% to 25% of all prize money** (6% of testers)
     and raises their prize recapture from 14% to **22% of spend**.
   - Paying gives better odds at real money. This is the clearest gambling and pay-to-win
     flag.
2. **The Prize Pool rewards activity and luck, not skill.**
   - **81%** of the variance in weekly scores is explained by volume (Live runs, play days),
     **11%** is pure race luck, and only **4%** is horse ability plus race-selection skill.
   - Starters are near-identical: the best starter's mean potential is 524 ± 8, against race
     noise of 83 rating points.
   - Daily Cup points (up to 420 a week, uncapped) outweigh race points (capped at 240).
   - **Casual players are paid 0% of the time.** About 14 of 50 accounts win anything, and
     the top 3 take 38%.
   - Under a "dominant factor" skill test this is a game of chance and volume. Combined with
     purchases that fund the pot, it looks like a lottery.
3. **The 2-week beta sells things testers can't use.**
   - A Premium foal needs **19 real days of care** before it can race, so no foal bought in
     the beta races in the beta. Pool scoring excludes them anyway, and the playtest reset
     wipes them.
   - Racing itself runs dry. Story races count as career starts, so engaged, grinder and
     whale stables **run out of racing-age horses on days 14–15**, with **6–7 days of no
     racing** until foals mature. Week-2 Live starts fall 28–39%, and week 3 is nearly empty
     (engaged players make 38 → 27 → 2.5 Live starts a week).
   - The Epic pity (50 pulls) is **unreachable** under the beta cap of 20 pulls:
     **P(no Epic in 20) = 18.9%**.
   - The expected Premium foal (mean potential **522**) equals your best starter (**524**).
     Only 31% of pulls beat it.
4. **Affiliates: a 2-level scheme with the owner at the root.**
   - The owner collects **71% of all commission money** ($32 of $45) because the owner is
     everyone's L1 or L2. That is just treasury revenue relabelled, but the shape is
     multi-level.
   - The owner is exempt from the link checks and the cap.
   - The $50/week cap never binds: it would take 100 packs a week of invitee sales.
   - The credit reward for an active invitee (250) has no linked-account check, and counts
     instant Story races toward its 5 races.
5. **The credits market is an open credit-transfer pipe.**
   - There is **no listing price ceiling**, so an alt can buy the main account's junk horse
     at any price.
   - One alt playing Story and the Cup moves **~16,350 credits in 14 days** (44% of an
     engaged player's 28-day faucets). Three alts move 49,000 (131%).
   - The same mechanism allows off-platform real-money trading of credits ("pay me ETH,
     I'll buy your horse"). That undermines "credits are never cashed out".

### Top 5 recommendations

1. **Close the leak before any money flows.**
   - Make Premium foals account-bound during the beta.
   - Exclude premium lineage from pool scoring (horse, sire or dam pulled from a Premium
     Pack), plus horses bought within 14 days of the buyer selling a premium foal.
   - Add a market price ceiling (≤ 3× appraisal) and a 72 h resale lock.
2. **Decouple prizes from purchases.**
   - Set `poolBps` to the 10% contract minimum (or 20% at most).
   - Pre-fund a **fixed weekly prize budget** (about $40 a week in the beta) with
     `PrizePool.fund()`. Never present "30% of your purchase grows the pot" at the point of
     sale.
   - Publish official rules: no purchase necessary, equal eligibility, 18+, void where
     prohibited.
   - Prefer USDG over ETH for prizes in the first real season.
3. **Make the score measure skill.**
   - Score on rate, not volume: points per Live run (full weight from 8 runs) plus the mean
     of your best 3 Cup days. Cap Cup points.
   - Raise the activity floor to ≥ 4 days.
   - In a 2-week beta of near-identical starters, skill can't be measured; the rate scoring
     only lifts the skill share from 4% to 7%. So **frame the beta's prizes as a small
     tournament thank-you**, keep them small, and run the beta for 4+ weeks if prizes matter.
4. **Affiliates.**
   - In the beta, pay **0% money commissions** and keep the 250-credit badge reward (add a
     link check, and require Live races, not Story races).
   - Delete level 2 permanently.
   - Root (admin) codes should record no inviter, so the owner never "earns commissions".
   - After counsel: a single level at 5–10%, a 30-day window, held 14 days, only on
     activated invitees, at most $10 a week per inviter and $25 lifetime per invitee.
5. **Make the sustainable loop recurring, not loot-box-driven.**
   - Run seasonal **fresh-blood bloodline drops**. The drop line must also be earnable free
     at lower odds, so it is not pay-to-win.
   - Add a **season pass** and **cosmetics**.
   - Bring in sponsored race naming for **external** prize money.
   - At 45% decay these levers take 12-week revenue from **$563 to $1,521** for 50 players,
     or $5.6k → $15.2k at 500. Week-12 revenue goes from **$0 to $28**.

### The sustainable loop

```mermaid
flowchart LR
  subgraph Free play
    P[Players] -- "race, care, Story, Daily Cup" --> C[(Stable Credits)]
    C -- "training, stalls, entries, breeding, paddock packs" --> SINK[Burned sinks]
    C -- "breeding (credits only)" --> BRED[Bred stock]
    BRED -- "better horses" --> P
  end
  subgraph Paid, deterministic first
    SP[Season pass] --> STORE
    COS[Cosmetics: silks, yard decor, hangout plot] --> STORE
    DROP["Season drop: new bloodline\n(Premium odds; also free at lower odds)"] --> STORE
    STORE[PremiumStore] -- "operations" --> T[Treasury]
    STORE -- "min 10% (contract floor)" --> POOL
  end
  DROP -. "outcross / seasonal traits, not stats" .-> BRED
  T -- "fixed weekly prize budget (fund)" --> POOL[(Prize budget, USDG later)]
  SPON[Sponsored race names] -- "external money" --> POOL
  POOL -- "vested prizes by skill RATE,\nverified, premium lineage excluded" --> P
  X1[["No credit cash-out · premium foals bound · no ETH stud fees, horse sales or paid entry"]]
```

### "When people stop buying packs and just breed, where does the pot come from?"

**The problem is quantified.**
- game-core's own population Monte Carlo at 50 players puts the **top 1% of bred stock at a
  mean potential of 609 in season 1 and 639–701 by season 2–3 (seed-dependent)**. The best Premium foal can
  never exceed the pack ceiling: **600, +10 a season**.
- So from season 2 a pack can't improve a serious breeder's stable at all. The *expected*
  pack foal (522) is only a population-average horse (503–509).
- With packs as the only product, revenue at 45% weekly decay is **$0 a week by week 8–9**.
  The pool lives on its reserve and rank-1 prizes shrink from $4.76 to about **$1.09 by
  week 12**.

**The answer: the pot should not come from packs.**

1. **Recurring deterministic products: the season pass and cosmetics.**
   - They are about 28% of revenue in the all-levers case.
   - They don't decay with breeding, and they carry no chance.
2. **Seasonal fresh blood.**
   - Each 4-week season, packs carry a new bloodline: new coat genes, quirks and an outcross
     line with zero kinship to the existing population. These are sidegrades, not stats.
   - Each drop restarts demand: a sawtooth that recaptures ~75% each season.
   - At a small population, COI pressure will make outcross lines genuinely useful.
     (game-core keeps COI < 1‰ at 400+ players, so at scale the value must come from novelty
     and traits.)
   - The same line drops at lower odds in free Paddock packs and Story gift foals. Otherwise
     it is pay-to-win.
3. **External money: sponsored race names, at a $25/week sponsor in the model.**
   - This is the cleanest prize funding, because no player consideration is involved.
4. **A fixed operator prize budget, sized as marketing.**
   - It replaces "30% of every loot box".

Whatever happens to sales, the pool should be **sized to a budget, not to revenue**. At 500
players the 30% rule fills the pool far faster than the payout throughput (10 ranks ×
$20 = at most $200 a week). That leaves **$1.7k–$2.9k stranded** in a contract the owner can
never withdraw from.

### Affiliate verdict

**Not exploitable for profit, but not worth its legal shape.**
- No wash or ring strategy breaks even. The return per $1 is $0.02–0.24 in the beta and
  ≤ $0.50 over 12 weeks, including the leak.
- The economic effect is small: testers get **3% of revenue**.
- The structure carries the MLM optics: two levels, commissions on recruits' spending, the
  owner as root of every tree, and the owner exempt from the controls.

**Recommendation:**
- no money commissions in the closed beta;
- remove level 2;
- return later as single-level referral marketing (5–10%) with holds, activation and caps,
  only after counsel.

The owner's effective take is **66.9%** today. It is **80%** with no money affiliates and a
20% pool. It is **90%** with a 10% pool, where the owner funds the fixed prize budget from
that take.

---

## 1. Stable Credits economy

Full tables: `results/credits.md`, `results/population.md`.

### 1.1 Faucets and sinks in code

| Faucet | Constant | Sink | Constant |
|---|---|---|---|
| Starter grant | **3,000** (docs/balance.md still says 5,000) | Training | 40–90 per session (speed 90) |
| Live purses | maiden 600, novice 750, quick 240, hcp 800/1,100/1,500, listed 2,600, G3–G1 4k–10k; split 55/20/12/7/4/2 | Entry fees | listed 120, G3 200, G2 320, G1 500 |
| Feature / Final | 20,000 / 30,000 | Refill | 250 for +5 entries (once a day, bank < 5) |
| Story first wins | 400 / 700 / 1,100 / 1,800 × 6 races = **24,000** | Stalls 7..24 | 2,000 + 400 (n − 7) = **97,200** total |
| Story replays / caps | 20; caps 4k / 7k / 11k / 18k (40k lifetime) | Trainer / vet / entry tiers | 21,000 / 27,000 / 60,000 |
| Daily Cup | 80 a day | Paddock Pack | 1,200 (≤ 3 a week) |
| **Daily goals** | **3 × 120 defined, never paid** | Breeding | 1,500 base + stud fee (10% burned) |
| Referral activation | 250 per invitee | Scan / vet | 400 / 150 |
| Insurance payout | 60% of appraisal | Insurance premium | 5% of appraisal |
| Release to Club | 50 | Market fee | 5% burned, floor 70% of appraisal, **no ceiling** |

### 1.2 Archetype flows (28 days, mean of 40 runs)

| Archetype | Earned | Spent | Ratio | Story share of income | First day with no racer | Days with no racer |
|---|---|---|---|---|---|---|
| Casual (60% of days, 3 Live a day) | 18,650 | 7,201 | 0.39 | 34% | — | 0 |
| Engaged (6 Live + 3 Story a day) | 38,111 | 32,080 | 0.84 | 29% | day 15 | 7.1 |
| Grinder (max entries) | 53,909 | 51,890 | 0.96 | 31% | day 14 | 6.0 |
| Breeder | 35,848 | 33,616 | 0.94 | 33% | day 18 | 2.8 |
| Whale (engaged + ETH packs) | 45,432 | 43,647 | 0.96 | 30% | day 15 | 6.2 |
| Story-only skipper | 19,722 | 0 | 0.00 | 76% | day 18 | 7.1 |

**Findings:**

- **Deflationary early, inflationary late.**
  - Active players spend 84–96% of what they earn. Stalls and facilities, a one-off
    **205,200** of sinks, absorb the surplus. A grinder's gross faucet exhausts them in about
    **16 weeks**.
  - After that, recurring sinks (training, entries, breeding, paddock packs) cover about
    60–70%, and surplus credits flow into horse prices on the market.
  - This is fine for the beta. For live seasons, add a recurring prestige sink: cosmetics
    for credits, Hall of Fame plaques, stud-book listings.
- **Daily goals aren't implemented.** The documented target in game-core's README (ratio
  0.90 with 2,520 a week of goals) isn't what ships. Paying 3 × 120 would move the engaged
  ratio from 0.84 to **0.74** (inflationary). If goals are added, pay **3 × 60**.
- **Story is the biggest early faucet** (29–34%), and it is instant (skip).
  - It can't be farmed: replays pay 20, and every Story race costs a career start.
  - The chapter caps (40k) never bind first wins (24k), so they are decorative. The real cap
    is the 24k of first wins.
- **The binding constraint in the beta is career starts, not entries.** Three starters have
  120 career starts between them.
  - The 10-a-day entry bank and the 250-credit refill rarely bind: 3 racers × 3 starts a day
    is 9 starts, below the 10-a-day allowance.
  - Grinders burn their starters by **day 14**. There is a racing drought until the gift foal
    and pack foals mature (19 care days).
  - Options:
    - Story races don't consume career starts (they are solo AI races);
    - or a 4th starter;
    - or the gift foal arrives weaned.
- **Refill arbitrage: none.** The refill only works below 5 entries, can't be resold, and is
  rarely needed.
- **Bound horses can't be listed** (Club-bred). Their foals become tradeable after 5 starts.
  That's fine.
- **Breeding chains flooding the market.**
  - The population sim gives **4.1 new horses per player per season** (bred + pack), and
    ~3 a season move to the unbounded Legacy Farm.
  - The 70%-of-appraisal floor stops a price crash but creates illiquidity, so surplus is
    released to the Club for 50 credits.
  - The stall cap (24) is the real population sink. Retirement removes nothing.
- **Insurance is a −EV sink**, not an exploit.
  - Baseline career-ending risk over 40 starts is **0.48%**: the payout is worth 0.29% vs a
    5% premium.
  - Even deliberate abuse (tired, all-out, 3rd start of the day, heavy going, veteran) gives
    ~5.6% over the last 12 starts: 3.4% of appraisal vs 5%. Keep it, and show the risk
    number at the point of sale.
- **Multi-account.** One alt yields ~17,200 credits in 14 days (3,000 starter + Story + Cup).
  95% of that can be moved to the main through an overpriced listing, plus 250 for the
  activation reward with no link check.

### 1.3 Population vs sinks (game-core population sim, 50 players)

| Season | Active horses per player (max) | Legacy Farm per player | Top-1% bred mean potential | Pack ceiling |
|---|---|---|---|---|
| 1 | 4.9 (8) | 0.4 | 609 | 600 |
| 2 | 7.1 (13) | 1.7 | 639 | 610 |
| 3 | 8.5 (17) | 4.3 | 643 | 620 |

The active population is bounded by stalls, and nothing is ever destroyed. Breeding overtakes
packs in season 1–2.

---

## 2. Real-money loop

Tables: `results/pool_beta.md`, `results/money_season.md`, `results/chain.md`,
`results/packs.md`.

### 2.1 Where one $4.99 pack goes (current: pool 30%, L1 10%, L2 3%)

| Buyer invited by | Pool | Testers | Owner's commission | Treasury | Owner total |
|---|---|---|---|---|---|
| Nobody / owner code | $1.50 | $0 | $0.50 (owner-direct) | $2.99–3.49 | **$3.49 (70%)** |
| A tester (owner is L2) | $1.50 | $0.50 | $0.15 | $2.84 | $2.99 (60%) |
| A tester's invitee (two testers) | $1.50 | $0.65 | $0 | $2.84 | $2.84 (57%) |

Gas on Robinhood Chain:

| Action | Cost |
|---|---|
| Purchase | $0.033 (0.7% of a pack) |
| Claim | $0.027 |
| Epoch post | $0.03 |

The real friction is **getting ETH onto the chain**: about $2.50 per tester through a bridge or
exchange withdrawal, which is 13% of a $20 budget.

### 2.2 The 2-week beta (agent-based, 50 testers, 400 seeds)

| | Week 1 | Week 2 | Total |
|---|---|---|---|
| Pack revenue | $260 | $153 | **$413** |
| Pool inflow (30%) | $78 | $46 | $124 |
| Epoch budget (25% of the free balance) | $19.51 | $26.19 | |
| Allocated | $19.11 | $25.79 | $45 (36% of inflow) |
| Rank-1 prize | **$3.54** | **$4.76** | |
| Eligible (≥ 3 days, verified wallet) | 41.5 | 41.4 | |

- **Spending caps in practice.**
  - Every foal needs a free stall **at quote time**. There are 2 free stalls at the start
    (6 − 3 starters − the gift foal); after that, stalls cost 2,000+ credits each.
  - So the real week-1 cap is about 2–5 packs, not 10.
  - Whales who **release** foals to the Club (free and instant) remove that limit: the
    classic "pull and discard the commons" gacha loop. The weekly cap of 10 ($49.90) then
    binds.
- **Pack value.**

  | Premium rarity | Mean potential |
  |---|---|
  | Common | 489 |
  | Uncommon | 524 |
  | Rare | 552 |
  | Epic | 576 |
  | Legendary | 592 |

  The expected pull is **522**, compared with 501 for a Paddock foal, 501 for a starter and
  524 for a stable's best starter.
- **Pity.**
  - Effective rates are Rare+ 30.8% and Epic+ 8.1%. The mean is **12.3 pulls ($61.50) to a
    first Epic**.
  - The Epic-at-50 pity is unreachable in a beta capped at 20 pulls, and P(no Epic in 20)
    is 18.9%. **Epic pity within 20** makes it reachable, and costs only +1.4 pp of Epic
    rate.

### 2.3 Twelve weeks: decay and levers (50 players; `results/money_season.md`)

| Weekly decay | Packs only: 12-week revenue | Packs only: week 12 | All levers: 12-week revenue | All levers: week 12 | Pool left at week 12 (all levers) |
|---|---|---|---|---|---|
| 30% | $788 | $2 | $1,799 | $51 | $193 |
| 45% | $563 | $0 | $1,521 | $28 | $157 |
| 60% | $431 | $0 | $1,307 | $14 | $129 |

Single levers at 45% decay:

| Lever | 12-week revenue |
|---|---|
| Fresh-blood drops | **$1,093** (×1.9) |
| Season pass | $865 |
| Cosmetics | $689 |

At 500 players the all-levers case brings in $15.2k, but the pool's payout throughput
(≤ $200 a week) strands **$2.9k**.

---

## 3. Affiliates (`results/affiliates.md`)

**Gaming it.** Return per $1 of wash buying (break-even needs ≥ $1.00):

| Strategy | Beta, group wins 100% of prizes | 12 weeks + leak, 100% | Contract maximum (50% pool, 15/5%), 100%, all paid out |
|---|---|---|---|
| Solo buyer | $0.11 | $0.37 | $0.58 |
| Self-referral through an undetected alt | $0.21 | $0.47 | $0.73 |
| Alt chain (main → alt1 → alt2) | $0.24 | $0.50 | **$0.77** |
| 3-friend chain, all buying | $0.19 | $0.44 | $0.69 |

There is never a break-even. The foal has no cash value, which is the hard rule. The
self-referral checks work: different wallets, link checks (device, fingerprint, IP, wallet)
and the 90-day window. The gaps are:
- the owner is exempt from link checks and caps;
- the activation credit reward has no link check;
- link detection is the only sybil defence, and wallets are free.

**Pyramid or MLM?**

| Indicator | Present? |
|---|---|
| Payment to join | No |
| Purchase required to earn | No |
| Commissions only on real sales | Yes |
| Commissions on recruits' recruits (level 2) | **Yes** |
| Income concentrated at the top | **Yes**: the owner takes 71% of all commission money |
| Incentive framed around recruiting | Yes: the `/invite` earnings page |

This is not a pyramid scheme (there is no buy-in). It **is** multi-level compensation, which
is regulated or restricted in some markets. EU UCPD Annex I #14 covers pyramid promotional
schemes, and some countries ban multi-level selling. Affiliates promoting it must disclose the
material connection (FTC Endorsement Guides).

**Recommended percentages.**
- **Beta:** L1 = 0%, L2 = 0%. Keep the 250 credits + badge, with a link check and Live races
  required.
- **First real season (after counsel):** L1 5%, at most 10%, single level. A 30-day window;
  commissions held 14 days and voided on refund or flag; only for invitees with ≥ 3 play days
  and ≥ 5 Live races; $10 a week per inviter and $25 lifetime per invitee; KYC-lite (verified
  email + unique device + wallet age) for anyone earning more than $50 in a season.
- **The owner never earns commissions.** Admin codes set `inviter = null`, and the 10% stays
  in the treasury. This changes nothing economically and removes the "owner at the top of the
  pyramid" shape.

---

## 4. Prize distribution and anti-drain (`results/pool_beta.md`, `pool_season.md`, `sybil.md`)

**As implemented:**
- the score is race points (start point + 12/8/6/4/3/2 + a tier bonus, capped at 240 a week)
  plus Daily Cup points (1–50 by percentile, +10 for beating the house field, uncapped);
- eligibility is ≥ 3 active days, a verified wallet and no open flag, and Premium-pulled
  horses don't score;
- the budget is 25% of the free balance, split over the top 10 by linear weights (rank 1 gets
  18.2%), capped at $20, with dust under $0.50 dropped;
- vesting is 14 days linear, with a 56-day claim window; then expiry returns funds to the
  pool;
- the contract allows at most one epoch every 6 days and ≤ 50% of the free balance an epoch.

| Metric | Beta (2 weeks) | 12 weeks (current) |
|---|---|---|
| Distinct winners (of 50) | 14.3 | 23.3 |
| Top-3 share of prizes | 38% | 32% |
| Gini | 0.80 | 0.73 |
| Casual testers ever paid | 0% | 8% |
| Score variance from volume / + ability and skill / luck | 81% / 85% / 11% | 78% / 87% / 8% |
| Week-1 vs week-2 rank persistence | 0.71 | |
| Whale prize recaptured per $ spent | 5.7% | 22% (14% with the leak closed) |
| Whale share of prizes (6% of testers) | 15% | **25%** (16% with the leak closed) |

- **Is buying positive-EV?** No, for anyone.
  - The best payer recaptures ≤ 22% of spend in prizes.
  - The marginal $ of spending adds at most 0.3 × (your share of payouts), plus the leak.
  - Keep it that way: close the leak. Otherwise buying keeps raising your odds of real
    money.
- **Can a small group farm the pool?**
  - Sybils scale linearly. One person with 5 undetected grinder accounts takes **6.5× an
    honest grinder's prizes** ($6.97 vs $1.06 in the beta); at 30% weekly detection it is
    4.5×.
  - At beta sizes that is pocket change, but it scales with the pool (and with owner
    top-ups).
  - Defence for 50 known testers: a **hand-reviewed wallet allowlist**. At scale: KYC-lite on
    prize claims above a threshold.
- **Skill vs spending.**
  - Under the fixed rules prizes are *not* tied to spending: within an archetype, the
    spend/prize correlation is 0.14, which is engagement.
  - They are not tied to skill either.
  - Rate scoring moves the skill share from 4% to 7% (beta) and from 6% to 10% (12 weeks),
    and pays casuals 9% / 29% of the time instead of 0% / 9%. It also raises the luck share.
  - Honest framing: at this population and horse spread, the pool is a participation and
    consistency prize.
- **"They drain the pot and move on."**
  - Impossible by contract: 25% a week of the *free* balance, $20 per person, and no owner
    exit.
  - The opposite happens: **64% of beta inflow is still unallocated at the end**.
  - Vesting doesn't stop a winner from leaving (vested ETH stays claimable). Use `revoke`
    (unvested only) for accounts inactive for 7+ days, as a published rule.
  - Plan a **final distribution** epoch (`maxEpochBps` up to 100%, more ranks) at the end of
    the beta.

---

## 5. Legal and ethics flags (not legal advice; counsel per market before mainnet)

| # | Mechanic | Looks like | Why | Safer alternative |
|---|---|---|---|---|
| L1 | Premium Pack (paid, random rarity) + tradeable foal + premium offspring that score for ETH prizes | **Gambling** (consideration + chance + prize) | Paying raises your odds of winning money through the leak | Premium foals account-bound; premium lineage excluded from scoring; published odds and pity; geo-block (BE, NL, …) |
| L2 | "30% of every sale funds the Prize Pool" | **Lottery / sweepstakes with consideration** | Purchases visibly grow a cash pot that players win; the score is mostly volume + luck (only 4% skill) | Fixed operator-funded prize budget (`poolBps` at the 10% minimum, the rest via `fund`); "no purchase necessary" official rules with free entry at equal dignity; prizes framed as a tournament thank-you |
| L3 | Score = activity volume + Daily Cup percentile luck | Game of **chance** under dominant-factor tests | 81% volume, 11% luck, 4% skill | Rate-based scoring, a minimum sample, capped Cup points, longer events; or run it as a free sweepstakes with official rules |
| L4 | 2-level commissions with the owner as root | **MLM / pyramid** optics | Commissions on recruits' recruits; income concentrated at the root | No money referrals in the beta; single level later; owner never earns commissions; disclosure |
| L5 | Pool grows with sales; ETH-denominated; affiliate "earnings" page | **Investment / securities** expectation | Rewards that rise with others' purchases and with ETH price | Prizes in USDG, a fixed budget, no "earn" marketing, no transferable claims |
| L6 | Selling foals in a 2-week beta that can't race in it and may be wiped by the reset | **Consumer protection** | Paying for something unusable in the period sold | Disclose the 19-day care at checkout; never reset after money; refund policy; or shorten foal care for the beta |
| L7 | Credits market with no price ceiling | **Credit cash-out by the back door (real-money trading)** | Off-platform ETH-for-credits deals settle through overpriced listings | Price ceiling ≤ 3× appraisal, 72 h resale lock, buyer account ≥ 7 days for large buys, flag outliers |
| L8 | Prize payouts to identifiable people | **Tax / KYC** | Prizes may be reportable income; sanctions | Keep per-person totals small (≤ $600 a year in the US); a sanctions check at claim; collect country |
| L9 | Robinhood Chain ToS: "lawful testing / development"; 18+ | **Platform terms** | Real-money prizes on a chain whose ToS frames apps as testing | Get written confirmation from Robinhood; enforce 18+ |

---

## 6. Parameter table (current → recommended)

| Parameter | Where | Current | Recommended | Reason |
|---|---|---|---|---|
| Premium foal binding | `db/services/packs.ts` (`bound: !!input.free`) | tradeable | **account-bound** (beta); later tradeable only after 5 starts and never pool-scoring | Closes ETH → credits (red line) |
| Pool scoring exclusion | `betaMoney.poolScores` | the pulled horse only | the horse **plus its offspring**, and horses bought within 14 days of selling a premium foal | Leak: whales 16% → 25% of prizes |
| `poolBps` | PremiumStore (deploy) | 3,000 | **1,000** (contract minimum) + a fixed funded budget (~$40/week beta); at most 2,000 | Decouples prizes from purchases; 64% sits unallocated anyway. **Owner chose this (2026-10-26): deploy default 1,000 + weekly top-up; done** |
| Pool applies to every SKU | design | yes | packs only (deterministic SKUs carry no prize link), or one uniform minimum | Prizes not funded by sales of chance items |
| `budgetBps` | `DEFAULT_POOL_RULES` | 2,500 | 2,500 weekly + a **final distribution** epoch at 100% at beta end | Avoid stranded ETH |
| `capUsdCents` | `DEFAULT_POOL_RULES` | 2,000 | **1,000** | Never binds in the beta (rank 1 gets $3.5–4.8); protects at scale |
| `paidRanks` | `DEFAULT_POOL_RULES` | 10 | 10 in the beta; at scale, top 3 per 30-player league (≈ 10%) | Fixed top 10 pays 2% of 500 players and concentrates prizes |
| `minActiveDays` | `DEFAULT_POOL_RULES` | 3 | **4** | Fewer drive-by sybils |
| Score formula | `poolScores` / `weekScore` | capped volume + uncapped Cup | **rate**: points per run × 15 (full from 8 runs) + mean of the best 3 Cup days × 5 | Skill share 4 → 7% (beta), 6 → 10% (12 weeks); casuals can win |
| Prize currency | PrizePool | ETH | USDG (first real season) | No ETH-price exposure or "investment" feel; caps stay in USD |
| `ref1Bps` / `ref2Bps` | `DEFAULT_AFFILIATE_CONFIG` / store ceilings | 1,000 / 300 | **0 / 0** in the beta; later 500 / 0 | MLM optics, owner-root, no economic upside |
| Owner commissions | `recordReferral` (admin codes → owner) | owner is inviter | inviter = null | The owner shouldn't be the top of a tree |
| `weeklyCapUsdCents` / `windowDays` | affiliates | $50 / 90 | $10 / 30 (+ 14-day hold, $25 lifetime per invitee) | The cap never binds today |
| Activation reward | `settleReferralActivations` | 250, no link check, Story races count | 250, link check, ≥ 5 **Live** races | Alt farming |
| `PREMIUM_PER_WEEK` | game-core | 10 | **5** in the beta + a $50 lifetime beta cap per tester | "Real small money" |
| Premium price | `PREMIUM_PACK_USD_CENTS` | $4.99 | keep $4.99 | Revenue is flat to rising up to $7.99 at elasticity −1.5, but small money matters more |
| Epic pity | `PACK_PITY.premium` | 50 | **20** (beta) | Otherwise unreachable under the cap (18.9% never see Epic) |
| Market price ceiling | `db/services/market.ts` | none | ≤ 3× appraisal; 72 h resale lock | Credit transfers / real-money trading |
| Daily goals | game-core constant | defined, not paid | implement at **3 × 60**, or drop from the docs | The documented balance assumes them |
| Story career cost | `races.ts` settle (starts +1 for quick) | Story = career start | Story doesn't consume career starts (or a 4th starter) | Racing drought days 14–20 |
| `STARTER_GRANT` docs | `docs/balance.md` | says 5,000 | fix the docs to 3,000 | Stale |
| Insurance | game-core | 5% / 60% | keep; show the career-ending odds at purchase | −EV sink, not an exploit |

---

## 7. Phased plan

### Before the beta (blocking)

1. Make premium foals account-bound, and exclude premium lineage from pool scoring. These are
   two small server changes.
2. Set affiliate money to 0/0 in `/admin/chain`, which needs no code. Admin codes stop
   assigning the owner as inviter. The activation reward gets a link check.
3. Deploy with `poolBps` = 10–20% and pre-fund a fixed beta prize budget with `fund()`.
   Publish official rules: no purchase necessary, eligibility, scoring, 18+, geo list,
   vesting and the revoke rule.
4. Cap the beta: 5 Premium Packs a week, $50 per tester in total. Epic pity at 20.
5. Disclose at checkout: "this foal needs 19 days of care before it can race". Commit to
   **no playtest reset after money flows**.
6. Add the market price ceiling and resale lock.
7. Switch pool scoring to the rate formula, or at least cap Cup points at 5 days a week.
8. Approve the wallet allowlist by hand (the known 50 testers). Run a sanctions check on
   claim wallets.

### During the beta (weekly)

- **Before posting each epoch, review:** linked-account flags, top-10 overlap with invite
  chains, and scores per run.
- **Track these KPIs:**
  - conversion, packs a week and decay;
  - pool inflow vs allocated;
  - distinct winners and top-3 share;
  - share of Story vs Live starts;
  - racer-drought days;
  - credits ratio by cohort;
  - market price / appraisal outliers.
- **Revoke** unvested allocations of accounts inactive for 7+ days.
- **At the end:** a final distribution epoch, then publish a short transparency note (inflow,
  paid, left).

### First real season

- Launch the **season pass + cosmetics**: silks, yard decor, then the hangout plot.
- Launch **seasonal bloodline drops**, available free at lower odds.
- Bring in **sponsored race names** paid into the pool.
- Move prizes to USDG, sized as a fixed budget. Scale prize tiers per league. Keep
  `poolBps` at the minimum, or apply it to packs only.
- **Legal review per market:** loot boxes, sweepstakes vs skill contest, MLM/referral rules,
  tax.
- Single-level referrals only after counsel.
- Recalibrate `tools/economy-sim` with beta telemetry and rerun the audit before setting
  season prices.

---

## 8. Limits of this audit

- Race outcomes use a calibrated abstract model (sigma = 83 rating points), not the engine.
  Live points assume class windows absorb half of an ability edge (phi = 0.5). The
  conclusions hold for phi from 0.2 to 0.8 (`sensitivity.md`).
- Purchase behaviour, retention and lever uptake are assumptions, swept in
  `sensitivity.md`.
- The 12-week model treats the 50 testers as the whole market. The 500-player rows only scale
  revenue.
- Only behaviour the code allows today was modelled. The recommendations were not
  implemented or re-tested in the app.
