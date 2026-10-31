# Betting rules research: our tote vs real-world practice (2026-10-31)

Question from the owner: "How does betting work in horse racing? Research whether we're doing it
correctly." Sources: UK Tote rules, ARCI model rules (US), Victoria TAB national tote rules,
NYRA, Hong Kong Jockey Club, JRA, Maryland COMAR, UK Gambling Commission LCCP and RTS, BHA.

## Main finding

Our place pools and dead heats split the whole net pool into equal parts per paying place (as the
UK Tote does). With that maths the new rule "winners never get back less than their stake" cannot
hold: in an 8-runner place pool with stakes 900/50/50 on the three placed horses, the favourite's
backers get 0.314x at 15% take and still only 0.370x at 0% take. The US "profit split"
(ARCI-004-105) returns the stakes on every paying runner first and splits only the profit, so
reducing the take always reaches 1.00 and the house never pays in. **Adopted.**

## Real practice in brief

| Topic | Real operators | Ours |
|---|---|---|
| Take (win/place) | UK Tote 19.25-20%, NYRA 16%, HK 17.5%, JRA 20%, NZ/PMU ~15%; exotics 18.5-30% | 15% (low end of normal) |
| Minimum dividend | US $1.05 (track pays "minus pools"); HK win 1.05, place 1.01; JRA floor 1.00 (+10 only from surplus) | 1.00, funded only by reducing that pool's take (no house pay-in) |
| Rounding ("breakage") | US down to 10c/5c, kept by the track; UK to 10p | each bet rounded down to 1 unit (more generous; keep) |
| No winning tickets | US/HK: pay 2nd, then 3rd, then refund; UK carryover; JRA pro-rata refund minus take | pro-rata refund minus take (JRA style) |
| Place terms | UK: 1 place 2-4 runners, 2 for 5-7, 3 for 8-15, 4 for 16+ handicaps; no place pool under 5 | 2 for 5-7, 3 for 8+, none under 5 (match) |
| Non-runner / abandoned | refund (fixed odds use Rule 4 deductions) | refund (match) |
| Close | at the off; odds can still move after as last bets are counted; NYRA throttles computer bets 1 min before post | close at the off under a DB lock (match) |
| Settlement | on "official"/"weighed in"; later changes don't alter payouts; operator bears overpayment errors | after the broadcast result is public; error policy to be written |
| Connections | BHA: owners may back, never lay; trainers may not lay; pro jockeys may not bet | no betting at all on races where you, a lease partner or a linked account runs (stricter; fine) |
| Responsible gambling (UKGC) | time-outs 24h-6 weeks; self-exclusion 6m-5y; limit raises wait 24h then need confirmation; reality checks; age verified before any bet | limits, 18+ self-declaration, breaks (being aligned) |

## Changes adopted (being built in the tote fix)

1. Profit split for place pools and all dead heats, mirrored in game-core, the reference copy and
   the TotePools contract.
2. Keep the 1.00 floor funded only by reducing the take; no house-funded minimum dividends
   (avoids minting credits and "bridge jumper" farming, keeps the contract liability-free).
3. Minimum pool: linked accounts count as one bettor; a fraud event when linked accounts back
   different runners in one pool.
4. A written "declared dividends stand" rule and error policy.
5. Responsible play: confirm limit raises after 24h; "time-outs" vs self-exclusion of 6 months,
   1 year, 5 years; prompt for a limit at the 18+ step; reality checks.
6. Pool disclosure: pool total, bettors, refund status line, "estimate, final at the off", place
   shown as a range or pool amounts.
7. Integrity: admin/staff accounts can't bet; a test that nothing exposes a locked result early.

## Later

Each-way as a one-tap win + place pair; quinella/exacta only once pools are larger; no separate
show pool. Before any real-money launch: age/identity verification, and legal review of the
credits loop (horses bought with ETH can be sold for credits, and the tote pays credits).
