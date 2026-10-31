---
name: web3-game-economy
description: Use when designing or implementing anything that touches Project Thoroughbred's economy together with money, crypto or chain features - premium store SKUs and pricing, premium currency, packs (odds, pity, caps, geo-blocking), tokens, wallets, anti-multi-account rules, purchase fulfilment, or legal/compliance gates - to ensure on-chain pieces respect the game's economy and ethics rules (Stable Credits never cashed out, no prize money, no gambling mechanics).
---

# Web3 and game economy rules

The source of truth is `docs/game-design.md` (§8 economy, §4b anti-multi-account, §4f
entries, and the ethics rule at the top). The web3 design is in `docs/web3.md`. If a request
conflicts with a rule below, **stop and ask the user**. These are user decisions, not
defaults.

## Closed-beta exception (user decision, 2026-10-26)

For the closed beta (~50 invited testers) the user approved **real ETH purchases of Premium
Packs on Robinhood Chain**, a **Prize Pool** (a fixed ~$40/week owner top-up plus 10 % of every sale since 2026-10-26, was 30 %; paid weekly by skill rank,
claimable on-chain) and **2-level affiliate commissions** (10 % / 3 %, from the treasury's
share). This overrides rules 2 and 3 below *for that scope only*; everything else stands, in
particular: **Stable Credits are never cashed out**, paid-pack horses don't score for the pool, nobody needs to buy anything to win or to earn.

**Owner decision (2026-10-26), against the audit's advice:** Premium foals stay **tradeable** on the
credits market in the beta (no binding, no extra limits beyond the general 3× appraisal price ceiling
and 72 h resale lock that apply to every horse). So in this scope an ETH-bought foal *can* be sold for
Stable Credits; the pulled horse itself still doesn't score for the pool, its offspring do. The
audit (`docs/economy/AUDIT.md` risk 1) flags this as the main gambling / pay-to-win exposure. Don't
re-litigate it; do flag it in legal review before any real-money launch.
Design, safeguards and open legal points: `docs/web3.md` §0. Code: `packages/contracts`
(`PrizePool`, `PremiumStore.purchaseWithEth`), `apps/web/src/server/chain`,
`packages/db` `services/betaMoney.ts` + `services/affiliates.ts`.

## Non-negotiables

1. **Stable Credits are never cashed out.**
   - Never bridged, tokenised, withdrawn, sold for crypto or transferable between accounts.
   - No direct credit transfers between players (§4b).
2. **No prize money.** Races pay credits only. No stablecoin or token rewards for racing,
   leagues, the Daily Cup or rankings. Ranked rewards are cosmetic.
3. **Money flows one way:** buyer → `PremiumStore` → treasury.
   - No user balances in contracts, no payouts, no on-chain refunds.
   - An exceptional refund is a support action from the treasury.
4. **No gambling mechanics.**
   - Nothing bought with money can be converted back to money.
   - No wagering on races with money. Owner exception (2026-10-31): the tote (`packages/db` tote.ts,
     game-core tote.ts) is spectator pool betting in Stable Credits, and in T-USDG only while
     `USDG_MODE=practice`. It must never accept real USDG or anything bought with money; real-money
     betting would need gambling licences and a separate legal decision.
   - No paid entry with a money prize.
   - Pack outputs are game items under the genetic ceiling, with published odds and pity.
5. **No pay-to-win in rated races.** Purchases are cosmetics, convenience, pack pulls (foals
   that still need 19 care days and are capped by the genetic ceiling) or a season pass.
   Never stat boosts and never Stable Credits.
6. **No dark patterns.**
   - No streak shaming, fake scarcity timers or purchase push notifications.
   - Show prices in the user's currency next to the token amount.
7. **Web3 is optional.** Every feature has a non-chain path, and `WEB3_ENABLED` defaults to
   false. The mock adapter must keep the whole game playable.

## Packs (paid and free)

- **Paddock Pack** (credits):
  - 1 free every 3rd play day;
  - up to 3 per week bought with credits;
  - Common or Uncommon.
- **Premium Pack** (paid):
  - **≤ 10 per week per account**, enforced by the server **before signing the voucher**;
  - geo-blocked where paid loot boxes are restricted (e.g. Belgium since 2018; confirm the
    current list with counsel).
- **Odds published** in the UI. **Pity:** Rare or better within 10 pulls, Epic within 50.
- Pulls are **seeded and committed** like races. Seed commitments can be anchored in
  `RaceProofRegistry` with a namespaced id (`pack:<pullId>`); reveal after the pull.
- There's a seasonal global foal crop cap (e.g. 10,000), with the remaining count shown
  publicly. It applies to pack foals.

## The store and SKUs

| SKU (`skuId(name)` = keccak256) | Grants | Status |
|---|---|---|
| `premium_pack` | 1 premium pull per quantity | active on testnet; geo/cap-gated |
| `season_pass` | season cosmetics track | active on testnet |
| `cosmetic.<slug>` | one cosmetic | add per item |
| `entry_refill` | +5 Live entries | **deployed inactive**: §4f defines the refill as a *credits* sink (once per local day, only when the bank is below 5). Needs a user decision |

Server rules, in `apps/web` when integrating:

- **Checkout** (the server signs a voucher):
  - verified account, linked wallet (SIWE), 18+ (ToS);
  - weekly caps, geo rule, linked-account flags;
  - write the pending order row first;
  - the voucher has a short deadline (about 10 min) and `maxTotal = quoted total`.
- **Fulfil** only after `verifyPurchase(...) === "confirmed"`:
  - in one DB transaction, insert the purchase with `UNIQUE(idempotencyKey)`, mark the
    order fulfilled and grant the entitlement through the double-entry ledger;
  - **never fulfil an orderId that has no pending order row** (that means a leaked signer
    key: alert).
- Run a backstop cron that scans `Purchased` events for paid-but-unconfirmed orders.
- Prices are in token base units (**USDG has 6 decimals**). Price changes emit `PriceSet`.
  Buyers are protected by `maxTotal`.

## Tokens

- **Default: no token.** `ThoroughbredToken` exists for review only and is not deployed.
- If one is ever approved:
  - fixed genesis supply, then `finalizeGenesis()`;
  - **no mint-on-gameplay**, no play-to-earn emissions;
  - **no staking, yield, rebasing or buyback promises** (these look like an investment
    contract: securities/MiCA risk, and they invite speculation);
  - premium currency use only;
  - legal opinion first;
  - never use Robinhood marks in the name or symbol (Robinhood Chain ToS).

## Anti-multi-account and wallets

- One wallet links to one account. Wallet links count toward linked-account detection
  (§4b) along with device, fingerprint and IP.
- Trades between linked accounts are blocked; leaderboards get reviewed.
- Starter and free-pack horses are **bound** (not tradeable). Never mint them as NFTs.
  There are no horse NFTs at all without a user decision.
- Ranked rewards require a verified account and are cosmetic.

## Fairness proofs: no spoilers

- Commitments (`sha256(seed)`) are anchored **at entry open, before entry close**.
- Result leaves include the **revealed seed**. Only batch races where `isBroadcastOver`
  (`apps/web/src/server/live.ts`). On-chain data is permanent: an early anchor is an
  unfixable spoiler.

## Legal gates

Track these as checklist items in PRs. Before mainnet money, see `docs/web3.md` §7:

- [ ] Paid loot boxes: the per-market list, a geo-block implementation and a published
      odds page.
- [ ] Consumer law: digital-content withdrawal-right waiver, refunds policy, price
      display.
- [ ] Tax/VAT on digital goods paid in stablecoin; invoicing.
- [ ] Sanctions screening at checkout, in addition to the sequencer's exclusion.
- [ ] Age 18+ for web3 features; privacy (no PII on-chain; wallet ↔ account in Postgres
      only).
- [ ] Robinhood Chain ToS: the "lawful testing / development" clause and branding.
- [ ] Token (if ever): securities/MiCA opinion.

## Quick review questions for any economy PR

1. Can anything bought with money turn back into money or into Stable Credits?
   → Must be **no**.
2. Can a player gain rated-race strength by paying? → Must be **no**.
3. Is every random paid outcome seeded, committed, with odds and pity published?
4. Does it still work with `WEB3_ENABLED=false`?
5. Is fulfilment idempotent, and is it keyed by an order the server created?
