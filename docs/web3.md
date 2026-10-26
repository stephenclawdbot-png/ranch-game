# Web3 on Robinhood Chain (optional layer)

**Status (2026-10-26):** closed-beta money is built: PrizePool + PremiumStore (native ETH,
30 % to the pool, 2-level affiliates), deploy from the owner's wallet on `/admin/chain`, ETH
checkout, Prize Pool epochs and claims, `/invite`. Tested locally end to end on Hardhat.
**Nothing is deployed.** `WEB3_ENABLED` is off by default, and **the game works fully without
a chain.** Start with §0.

This doc covers:
- the research findings, with sources and how each fact was checked;
- the architecture we chose;
- the threat model;
- the phased rollout, with legal gates.

Code: `packages/contracts` (contracts, tests, `adapter/`, `scripts/deploy.ts`).
Agent skills: `.claude/skills/{solidity-dev,robinhood-chain,web3-game-economy}`.

---

## 0. Beta money flow (closed beta, user decision 2026-10-26)

> **User decision (overrides "web3 off for beta" and, for the closed beta only, the earlier
> "no prize money / money flows one way" rules):** ~50 invited testers buy Premium Packs with
> real **ETH on Robinhood Chain**. **30 % of every sale funds an on-chain Prize Pool** paid out
> weekly by skill rank; the rest goes to the owner's treasury, minus a **2-level affiliate
> commission** (10 % / 3 %) when the buyer was invited. **Stable Credits remain never
> convertible.** The owner's fear, "players drain the pot and leave", is answered by the
> contract itself (see "Why the pot can't be drained").

### Money flow

```mermaid
flowchart LR
  B[Buyer wallet] -- "purchaseWithEth (exact wei, signed quote)" --> S[PremiumStore]
  S -- "30% (poolBps, 10-50%)" --> P[PrizePool]
  S -- "10% L1 / 3% L2 (only if invited, eligible)" --> R[Referrer wallets]
  S -- "rest (≈57-70%)" --> T[Treasury]
  P -- "claim (vested, Merkle proof)" --> W[Winner wallets]
  O[Owner wallet] -- "fund() top-up (optional)" --> P
```

| Step | Who | What happens |
|---|---|---|
| Link wallet | player | `/me` (or `/beta`): connect an injected wallet (EIP-6963: MetaMask, Rabby, Coinbase Wallet, Robinhood Wallet when injected) and sign an **EIP-4361 (SIWE)** message. Free, no gas. One verified wallet per stable, one stable per wallet (partial unique index). The link feeds linked-account detection (§4b) as a `wallet` signal. |
| Quote | server | `POST /api/checkout/quote {sku, quantity}`: checks web3 on, verified wallet, geo (`PREMIUM_BLOCKED_COUNTRIES`), **weekly cap 10** (pulls this week + open quotes), free stalls, foal crop; prices `$4.99 × qty` in wei with the **median ETH/USD**; picks eligible referrers; **writes the order row first**; signs an EIP-712 `EthQuote {orderId, buyer, sku, quantity, priceWei, usdCents, ref1, ref1Bps, ref2, ref2Bps, deadline}` valid **5 minutes** (contract hard limit 10). |
| Pay | player | The UI shows "$X ≈ Y ETH" with a countdown and re-quotes automatically when it expires. The wallet sends exactly `priceWei`. |
| Split | contract | `purchaseWithEth` checks buyer = sender, deadline (≤ 10 min ahead), single-use orderId (shared with the USDG path), SKU active, `msg.value == priceWei`, referral sanity, optional Chainlink tolerance, the signer role. Then: `poolBps` → `PrizePool.fund` (same tx; a revert undoes the sale), commissions → referrers (gas-limited call; on failure credited to `referralOwed`, pulled with `withdrawReferral`), the rest → treasury (on failure kept in `pendingTreasuryWei`, `withdrawEth` sends it to the treasury). The store never keeps ETH. |
| Confirm | server | `POST /api/checkout/confirm {orderId, txHash}` verifies the receipt: only logs from **our** store, `PurchasedWithEth` for this orderId, buyer, sku, quantity, exact amount, confirmations. Then **idempotently** grants one prepaid Premium pull per quantity (idempotency key `chain:<chain>:<store>:<orderId>:<i>`), records the pool/treasury split and the `ReferralCommission` events. A tx hash can belong to one order only; a wrong hash is forgotten so the right one (or the backstop) can still settle it. |
| Recover | both | `/packs` resumes open orders on load (`GET /api/checkout/orders`). The cron `/api/cron/chain` (daily, Bearer `CRON_SECRET`) settles submitted/paid orders, scans for paid quotes whose client vanished (`PurchasedWithEth` by indexed orderId), expires dead quotes, and grants affiliate activity rewards. Orders the server didn't create are never fulfilled. |
| Weekly epoch | admin | `/admin` → **Prize Pool**: compute the last week (scores = league race points, capped per week + Daily Cup points; eligible = verified wallet, ≥ 3 play days, no open linked-account flag; horses from Premium Packs don't score), split the budget (default 25 % of the free pool, ≤ the contract's `maxEpochBps`) over the top 10 by linear weights, cap **$20/person** converted at the median price (stored on the epoch), dust < $0.50 dropped, leftovers roll over. Review, then post the Merkle root with the server key (if granted `POSTER_ROLE` + gas) or from the owner wallet. The season-end bonus is the same flow with `kind: season` over the season's dates. |
| Claim | player | `/pool`: allocations with vested / claimed / claimable; **Claim** sends `PrizePool.claim(epoch, amount, vestStart, vestEnd, proof)` from the player's wallet (linear vesting, 14 days; claim any time, several times). |

### Why the pot can't be drained

- **No owner withdrawal.** PrizePool has no withdraw, sweep or transfer; ETH leaves only via
  `claim`, to the wallet named in a posted leaf. There is no upgradeability. (A timelocked
  `sweepToTreasury` was considered and **left out on purpose**: trust > flexibility. To wind the
  beta down, post final epochs; the owner can raise `maxEpochBps` to 100 % for that.)
- **Never over-promises.** `postEpoch` requires `total ≤ maxEpochBps × (balance − outstanding)`
  (default 50 %), and an epoch's claims can never exceed its `total`, whatever the root says.
  Invariant (property-tested): `outstanding ≤ balance`.
- **Per-player ceiling** `maxClaimPerEpoch` (wei, snapshotted per epoch) and **rate limit**
  (one epoch per `minEpochInterval`, default 6 days).
- **Vesting** (14 days) means a winner who leaves gets at most what vested; the admin can
  `revoke` an inactive or cheating account (unvested only, or everything unclaimed) and
  `cancelEpoch` a wrong/malicious root. **Both only return ETH to the pool.** Unclaimed
  allocations return to the pool after the claim window (56 days) via `expireEpoch` (anyone).
- **Payouts reward skill and activity, not money:** free players are equally eligible, runs by
  Premium-Pack horses don't score, a ≥ 3-active-days rule, linked-account flags hold a player
  back, $20/week cap.
- **A leaked server key** can sign quotes (but the server fulfils only its own orders and
  checks the exact amount) and, if it holds `POSTER_ROLE`, post one capped epoch a week, which
  the owner can cancel during vesting. It can never move funds. Keep it low-value, rotate by
  grant + revoke.

### Pricing (dynamic USD)

- `ETH_USD_PRICE_SOURCE=auto`: Coinbase, Kraken, Bitstamp and Binance spot in parallel; at least
  2 answers; **median**; refused when they diverge by more than **2 %** or leave the sanity
  bounds; cached ≤ 45 s; every fetch logs the per-source prices, and each order/epoch row stores
  the snapshot. Checkout pauses with "Pricing is temporarily unavailable, please retry".
- `/pool`, `/packs` and admin show live "≈ $" conversions refreshed every 60 s.
- Weekly caps and allocations are defined in USD and converted at epoch computation; the price
  is shown in the admin and `/pool` history.
- **On-chain oracle (optional hardening, off by default):** Robinhood Chain documents
  **Chainlink** as its price oracle ([Oracles & price feeds][rh-oracles]). The ETH/USD proxy
  address is not listed in the Robinhood docs; read it from data.chain.link (Robinhood network)
  before use. `PremiumStore.setPriceFeed(feed, maxDeviationBps ≤ 20 %, maxAge)` makes every
  quote's implied price (`usdCents` vs `priceWei`) match the feed within the tolerance (e.g.
  300 = 3 %) and rejects stale feeds; `feed = 0` disables it. No Pyth or RedStone deployment was
  found for Robinhood Chain (2026-10-26).

### Affiliates (2 levels, owner at the root)

- Every account has a personal code (`R-XXXX-XXXX`, an `invite_codes` row of kind `referral`)
  and link `/play?invite=CODE`; in playtest mode it also passes the invite gate (tester cap still
  applies). Admin codes are **roots owned by the owner account** (claimed on `/admin/chain`
  with the owner's own stable + verified wallet). Inviter = the code's owner; upstream = the
  inviter's inviter. Written once at signup; no cycles; 2 levels max.
- **Money only from real purchases:** the quote names the eligible L1/L2 wallets; the store
  pays **10 % / 3 %** (admin-configurable; on-chain ceilings `maxRef1Bps`/`maxRef2Bps` with
  hard caps 15 % / 5 %) out of the **treasury's** share. A missing or ineligible referrer's
  share stays with the treasury, **never** the pool.
- Eligibility (server, at signing): referral not revoked; purchase within **90 days** of the
  invitee's signup; referrer has a verified wallet different from the buyer's and from the
  other referrer; **not linked** to the buyer (device / fingerprint / IP hash / wallet: dropped
  and flagged as a `referral_linked` fraud event); **weekly per-inviter cap** ($50 default,
  counting paid commissions and open quotes). The owner is exempt from the weekly cap
  (optional separate owner cap) and from link checks.
- In-game reward: when an invitee becomes active (≥ 5 races, ≥ 3 play days) the inviter gets
  250 credits through the ledger and the "referrer" badge, once (idempotent).
- `/invite`: link + copy/share, invitees (L1/L2) with activity, earnings with explorer links,
  the rules ("you never need to buy anything to invite or earn"). Admin → **Affiliates**: owner
  stats (sales in the tree, owner L1/L2, treasury income, pool contributions), config, top
  inviters, flags, the tree, revoke (future commissions off; on-chain payments are final).
  Keep the **treasury separate from the owner's affiliate wallet** (warned when equal).

### What the owner must do

1. Create a **dedicated low-value key** for the server and put it in Vercel env as
   `QUOTE_SIGNER_PRIVATE_KEY` (Production + Preview). Also set `ROBINHOOD_RPC_URL`
   (a provider URL), `CHAIN_ID=46630` first, `ADMIN_SECRET`, `CRON_SECRET`.
2. Open `/admin` → sign in → `/admin/chain`. Connect **your** wallet holding a little ETH on
   Robinhood Chain (testnet ETH from the Alchemy faucet first). Choose the network, the
   treasury (a different address from your affiliate wallet), the server signer (pre-filled),
   pool share (30 %), per-player cap ($25), whether the server may post roots. Press Deploy
   and confirm ~7 transactions. Nothing else needs funding (the pool fills from sales).
3. Copy the shown block (`WEB3_ENABLED=true`, `CHAIN_ID`, `PREMIUM_STORE_ADDRESS`,
   `PRIZE_POOL_ADDRESS`) into Vercel env (**Preview first**), redeploy.
4. In the game, on your own stable: Profile → verify your wallet; then `/admin/chain` → "Make
   the stable on this browser the owner".
5. Weekly: `/admin` → Prize Pool → Compute → review → Post (server key or your wallet).
6. Mainnet only after the testnet run, with the legal checklist below signed off.

### Risks and open legal points (flag to the user)

- **Gambling / lottery / sweepstakes law:** paid loot boxes + a cash pool paid by rank is close
  to "consideration + chance + prize" in many jurisdictions. Mitigations built in: no purchase
  needed to win, paid horses don't score, skill ranking, caps, geo-block list. **Needs counsel
  per market before mainnet**, plus age 18+ and KYC/AML/tax (prize payouts may be reportable).
- **Affiliate law:** a 2-level commission on sales can fall under multi-level-marketing /
  pyramid-scheme rules in some markets. Commissions are only from real product sales, nobody
  pays to join and buying is never required, but get counsel. Robinhood Chain ToS ("lawful
  testing…") still applies (open question 7).
- **Playtest reset** wipes purchased foals (pack pulls) while orders/earnings/pool data stay:
  don't reset after real money flows, or re-grant by hand. The affiliate tree is wiped with
  accounts (testers rejoin with their codes; admin-code testers get the owner as inviter again).
- **Daily cron only** (Hobby plan): a buyer who closes the tab before confirm is settled when
  they reopen `/packs` or by the next cron run.
- Contracts are **unaudited** (internal tests, 100 % line coverage). Keep beta amounts small.

[rh-oracles]: https://docs.robinhood.com/chain/oracles-and-price-feeds

---

## 1. What Robinhood Chain is (research, dated 2026-10-25)

"Verified" means we checked the fact ourselves against the public RPC on 2026-10-25. Every
other fact comes from the source cited.

| Fact | Value | Source / check |
|---|---|---|
| Stack | Arbitrum chain (Offchain Labs, Nitro), L2 settling to Ethereum; Ethereum blobs for data availability; part of the Arbitrum Expansion Program | [Connecting][rh-connect], [ArbitrumDAO factsheet][arb-fact] |
| Status | **Mainnet live since 2026-07-01.** Public testnet opened in February 2026 | [Cointelegraph][ct], [factsheet][arb-fact] |
| Chain IDs | Mainnet **4663**, testnet **46630** | [Connecting][rh-connect]; **verified**: `eth_chainId` returned 0x1237 / 0xb626 |
| Gas token | ETH (testnet: Sepolia-bridged ETH) | [Connecting][rh-connect] |
| Public RPC (rate-limited, "not for production") | `https://rpc.mainnet.chain.robinhood.com`, `https://rpc.testnet.chain.robinhood.com` | [Connecting][rh-connect], [ToS §2.1][rh-tos] |
| Provider RPC | Alchemy (recommended by Robinhood): `https://robinhood-{mainnet,testnet}.g.alchemy.com/v2/<key>`; also Chainstack, QuickNode, dRPC, Blockdaemon and others | [Connecting][rh-connect] |
| Explorers (Blockscout) | `https://robinhoodchain.blockscout.com`, `https://explorer.testnet.chain.robinhood.com` | [Connecting][rh-connect], [Deploy][rh-deploy] |
| Verification | Blockscout API (`<explorer>/api`), `hardhat verify` with `customChains`, apiKey `"empty"` | [Deploy][rh-deploy] |
| Faucet | Alchemy faucet: 0.1 ETH/24h, needs mainnet ETH activity. BitGo lists `faucet.testnet.chain.robinhood.com`, which returned 429 to us | [Alchemy faucet][alchemy-faucet], [BitGo][bitgo] |
| Bridging | Canonical Arbitrum bridge: about 10 min deposits, 7-day withdrawal challenge. Also LayerZero/Stargate (USDG), CCIP, Relay, Across, LiFi | [Bridging][rh-bridge] |
| Finality | Soft confirmation from the sequencer, sub-second (about 100 ms preconfirmations). Then posted to L1 within minutes. Then Ethereum finality about 13 min after posting | [Finality][rh-final], [factsheet][arb-fact] |
| Block tags | `safe` and `finalized` answer on the testnet RPC | **verified** |
| Fees | L2 execution plus an L1 data fee. Gas price observed: 0.02 gwei mainnet, 0.01 gwei testnet | [Gas & fees][rh-gas]; **verified** `eth_gasPrice` |
| Node version | `nitro/v3.12.1-rc.2` (mainnet `web3_clientVersion`) | **verified** |
| EVM differences | `block.number` is an L1 estimate (use ArbSys `arbBlockNumber()` for the L2 number); `prevrandao` is constant, so it's **not randomness**; 96 KB code size limit; L1-to-L2 messages alias `msg.sender`; ordering is first come, first served (raising the fee doesn't jump the queue); **the sequencer excludes transactions from sanctioned addresses** | [Differences][rh-diff] |
| Opcodes | Cancun opcodes (PUSH0, MCOPY, TSTORE/TLOAD) since ArbOS 20. Robinhood docs list EIP-7702 support. We compile for `evmVersion: cancun` | [ArbOS 20][arbos20], [AA][rh-aa] |
| Account abstraction | ERC-4337 EntryPoint v0.6, v0.7 and v0.8 deployed; EIP-7702 supported; gas sponsorship through Alchemy Gas Manager and ZeroDev; Privy and Dynamic for embedded wallets | [AA][rh-aa] |
| Stablecoin | **USDG** (Paxos). Mainnet `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, testnet `0x7E955252E15c84f5768B83c41a71F9eba181802F`. **6 decimals, symbol USDG** (verified on both chains). The mainnet token is an upgradeable ERC-1967 proxy | [Paxos mainnet][paxos-main], [Paxos testnet][paxos-test], [RH contracts][rh-contracts]; **verified** `decimals()`, `symbol()` and the implementation slot |
| USDC | **No primary source found for native USDC on Robinhood Chain.** Treat it as unavailable until Circle lists it | Search, 2026-10-25 |
| Deploy permissioning | No allowlist or KYC is described for deployers. The ToS calls the chain "permissionless" | [Deploy][rh-deploy], [ToS §2.1][rh-tos] |
| ToS points that matter | Users must be 18+ and not a sanctioned person; no VPN evasion; Robinhood can block addresses; services are "for lawful testing, experimentation, evaluation, and development purposes" (it's unclear how this applies to mainnet apps, so we **ask Robinhood**); **no Robinhood marks in token names or NFTs**; "Built on Robinhood Chain" wording is pre-approved under conditions | [ToS][rh-tos] |
| viem | `robinhood` (4663) and `robinhoodTestnet` (46630) are built into `viem/chains` 2.57 (multicall3 at `0xca11…ca11`) | Local `node_modules/viem` |

**Unknown or unverified:**
- the exact ArbOS version, and Prague opcode support beyond EIP-7702;
- block time;
- whether USDG supports EIP-2612 `permit`;
- the USDG freeze/blocklist semantics (Paxos tokens historically have an asset-protection
  freeze, so we **assume it can freeze any address, including our store**);
- the official faucet's availability.

Everything chain-specific is configuration (env), not code.

## 2. What we put on-chain, and what we don't

| On-chain | Off-chain (Postgres, the source of truth) |
|---|---|
| **Fairness anchors:** Merkle roots of race seed commitments (at entry open) and of results plus revealed seeds (after settlement) | Races, entries, horses, the credits ledger, the market, packs, everything else |
| **Premium checkout:** stablecoin payments for premium SKUs, as `Purchased` events | Entitlements granted after verifying the event; pending orders; caps; geo rules |
| *(Optional, not deployed)* a capped ERC20 with a genesis distribution only | Stable Credits: **never on-chain, never cashed out** |

We do **not** do any of the following:
- no on-chain credits;
- no token rewards for racing (play-to-earn);
- no staking or yield;
- no horse NFTs (they would break the bound-horse and anti-multi-account rules in §4b);
- no withdrawals to users;
- no on-chain randomness (`prevrandao` is constant on Arbitrum).

## 3. Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Store / Verify UI] --> W["Wallet: EOA, EIP-7702 or 4337 smart account<br/>(gas optionally sponsored)"]
  end
  subgraph Vercel["Next.js on Vercel (server only)"]
    API["/api/store/checkout · /api/store/confirm<br/>/api/proofs/:kind/:batchId"]
    AD["ChainAdapter<br/>Mock (default) | EvmChainAdapter (viem)"]
    CRON["Cron: publish proof batches<br/>+ purchase backstop scan"]
    API --> AD
    CRON --> AD
  end
  DB[("Neon Postgres<br/>orders · ledger · proof batches")]
  subgraph RH["Robinhood Chain (4663 / testnet 46630)"]
    PS[PremiumStore]
    RPR[RaceProofRegistry]
    USDG[USDG ERC20]
  end
  W -->|approve + purchase(voucher)| PS
  PS -->|transferFrom| USDG
  AD -->|"read receipts / events"| PS
  AD -->|publishBatch (publisher key)| RPR
  API --> DB
  CRON --> DB
```

### 3.1 Premium purchase flow

1. **Checkout.** `POST /api/store/checkout {sku, quantity}`. The server checks
   `WEB3_ENABLED`, a verified account, a linked wallet (SIWE), geo rules (Premium Packs are
   geo-blocked where paid loot boxes are restricted), weekly caps (Premium Pack ≤ 10 per
   week) and linked-account flags. It then:
   - writes a **pending order** row `(orderId, accountId, wallet, sku, qty, token, quotedTotal, deadline)`;
   - returns `createPurchaseVoucher(order)`, an EIP-712 `Order` signed by `STORE_SIGNER_PRIVATE_KEY`.
2. **Pay.** The wallet sends `approve(store, total)` and `purchase(order, signature)`. A
   smart account can batch both into one sponsored operation. The contract checks:
   - buyer == sender;
   - deadline, signature role and single-use `orderId`;
   - SKU active, token accepted, `price × qty ≤ maxTotal`;
   - received amount == total.

   It then emits `Purchased`.
3. **Confirm.** `POST /api/store/confirm {orderId, txHash}`. The server calls
   `verifyPurchase(txHash, expected-from-pending-row)`. It only counts logs from **our**
   store address, matches on orderId, and checks buyer, sku, qty, token, the minimum total
   and confirmations/finality. On `confirmed`, **one DB transaction** inserts
   `chain_purchases(idempotency_key UNIQUE)`, marks the order fulfilled and grants the
   entitlement. A retry is a no-op.
4. **Backstop.** A cron job scans `Purchased` logs since the last processed block and
   fulfils orders whose client never called confirm. **Events for unknown orderIds are
   never fulfilled.** They're flagged instead, because they mean the signer key leaked.

What a purchase grants is a **premium entitlement** (pack pulls, season pass, cosmetics):
- never Stable Credits;
- never anything that changes rated-race strength (no pay-to-win in rated races).

The `entry_refill` SKU exists but **is deployed inactive**, because §4f defines the refill as
a credits sink. This needs a product decision.

### 3.2 Fairness proof anchoring

Each race already has `seedCommitment = sha256(seed)` and `resultHash` from the racing engine
(see `packages/racing-engine/README.md`).

- **Commitment batches.** When a slice of the live card is published (entries open), the
  server builds `buildCommitmentBatch([{raceId, seedCommitment}])` and calls
  `publishProofBatch({kind: 1, batchId, root})`. The commitment must be anchored **before
  entries close**. That's easy, because soft confirmation takes under a second.
- **Result batches.** Every N minutes, the settled races go into
  `buildResultBatch([{raceId, resultHash, revealedSeed}])`, which is anchored with `kind: 2`.
- **No-spoiler rule (hard).** A result leaf contains the revealed seed. Anyone holding the
  seed can re-simulate the race, so a result batch may include a race **only once
  `isBroadcastOver`** (`apps/web/src/server/live.ts`). On-chain data is public and
  permanent, so a premature anchor is an unfixable spoiler. The `/api/proofs` manifest
  follows the same 425 rule as the replay endpoint. Commitment batches carry only
  `sha256(seed)`, so they're safe at entry open.
- **Manifest.** The DB stores each race's `(batchId, proof)`, and
  `/api/proofs/:kind/:batchId` serves the leaf list (`manifestURI` is in the event).
- **Verify.** Anyone can call `RaceProofRegistry.verifyRace(...)` (free `eth_call`). It
  checks:
  - both inclusions;
  - `sha256(revealedSeed) == seedCommitment`;
  - that the commitment batch was anchored strictly before the result batch.

  Off-chain verifiers should also compare the commitment batch's `publishedAt` with the
  race's published entry-close time, and re-run `verifyReplay`.
- **Cost.** About 76k L2 gas per batch, whatever the batch size, plus the L1 data fee.
  Storage is one root per batch, never per race. At the gas prices observed, that's
  fractions of a cent per batch.
- **Reuse.** Pack pulls are "seeded and committed like races" (§8). They can reuse the same
  registry with a namespaced id (`pack:<pullId>`).

### 3.3 Server adapter (`@thoroughbred/contracts/adapter`)

| Member | Purpose |
|---|---|
| `createChainAdapter(env)` | Returns the Mock unless `WEB3_ENABLED=true`. When enabled but misconfigured, it **throws** and never silently falls back. |
| `createPurchaseVoucher(order)` | Signs the EIP-712 Order (server key). |
| `verifyPurchase(txHash, expected)` | Returns `confirmed` (with an `idempotencyKey`), `pending` (`unknown_tx`, `not_mined`, `confirmations` or `finality`), or `rejected` (with a reason). |
| `publishProofBatch(batch)` / `getProofBatch` | Idempotent for the same root. Throws `ProofBatchConflictError` if the batch was anchored with a different root. |
| `getBalances(address)` | ETH and payment-token balance, for display. |

The Merkle helpers are `raceKey`, `commitmentLeaf`, `resultLeaf`, `buildMerkleTree`,
`verifyMerkleProof`, `buildCommitmentBatch` and `buildResultBatch`. A test proves their
leaves are byte-identical to the Solidity ones.

Env vars (server only, in `apps/web/.env.example`):

- `WEB3_ENABLED`
- `ROBINHOOD_RPC_URL`
- `ROBINHOOD_CHAIN_ID`
- `PREMIUM_STORE_ADDRESS`
- `RACE_PROOF_REGISTRY_ADDRESS`
- `PAYMENT_TOKEN_ADDRESS`
- `CHAIN_MIN_CONFIRMATIONS`
- `CHAIN_PURCHASE_FINALITY` (`latest`, `safe` or `finalized`)
- secrets, kept in Vercel env and never in the repo: `CHAIN_PUBLISHER_PRIVATE_KEY` and
  `STORE_SIGNER_PRIVATE_KEY`

The checkout response hands the browser the store address and chain id, so there are no
`NEXT_PUBLIC_` chain secrets.

## 4. Contracts

| Contract | Roles | Key properties |
|---|---|---|
| `RaceProofRegistry` | `DEFAULT_ADMIN` (multisig), `PUBLISHER` (server hot key), `PAUSER` | Roots are write-once per `(kind, batchId)`; double-hashed, kind-tagged leaves; verification works while paused; only the admin unpauses |
| `PremiumStore` | `DEFAULT_ADMIN`, `PRICE_MANAGER`, `PAUSER`, `TREASURER`, `SIGNER` | EIP-712 vouchers bound to buyer, chain and contract; single-use orderId; `maxTotal`; fee-on-transfer rejected; checks-effects-interactions plus `nonReentrant`; withdraw **only to `treasury`**; no payable entry points |
| `ThoroughbredToken` *(optional)* | `DEFAULT_ADMIN`, `MINTER` | Capped, with permit; `mintGenesis` until `finalizeGenesis()` (irreversible); no fees, blocklist, staking, yield or upgradeability |

Stack: Solidity 0.8.28, OpenZeppelin 5.7.0, Hardhat 2.29.1 with hardhat-toolbox-viem, viem 2.57.

Tests: 70, all passing. Coverage is 100% of lines and functions on the 3 production
contracts. The list is in `packages/contracts/README.md`.

### Token: deliberately boring

If a token ever exists:
- it is a premium currency at most;
- it never comes from gameplay (no emissions) and pays no yield.

Staking or "earn by holding" turns a game currency into something that looks like an
investment contract. That's a securities and MiCA risk, and it pulls players toward
speculation, against our ethics rule ("no cash prizes", "credits never cashed out"). The
token is not deployed and not on the roadmap until legal review says yes.

## 5. Threat model

| Asset / property | Threat | Mitigation |
|---|---|---|
| Race fairness | Operator picks a seed after seeing entries | Commitment anchored before entry close; `verifyRace` ordering check; off-chain check against card times |
| Race fairness | Operator grinds seeds before committing | Final seed = H(server seed ‖ external entropy fixed after commit), per `architecture.md` §2. Never `prevrandao`. Candidate entropy: a future drand round or L1 block hash, chosen at commit time (open item) |
| Race fairness | Operator withholds results | Missing result leaves are publicly detectable; the commitment is public |
| Proof roots | Publisher key leak | Key holds only `PUBLISHER_ROLE` and a little ETH; it can't alter existing roots; admin multisig revokes and rotates; pause |
| Payments | Signer key leak | The attacker still pays the on-chain price, so they can only bypass caps or geo rules. The server **fulfils only orders that exist in the DB**, and unknown orderIds raise an alert. Rotate the key with grant and revoke |
| Payments | Admin key leak (prices, treasury) | Safe multisig as admin (deploy script hands over and renounces); buyers protected by `maxTotal`; sweep the treasury often; add a timelock before GA |
| Payments | Fake `Purchased` event from another contract | Adapter filters logs by our store address (tested) |
| Payments | Double fulfilment | Contract: single-use orderId. DB: `UNIQUE(idempotency_key)` plus transactional grant (tested at the contract and adapter layers) |
| Payments | Same tx hash claimed by another account | The order row binds `orderId → accountId → wallet`; the expectation checks the buyer |
| Payments | Front-running a voucher | Voucher bound to `buyer == msg.sender`; FCFS sequencer, no priority-fee auctions |
| Payments | Reorg / sequencer equivocation | `CHAIN_MIN_CONFIRMATIONS`; `CHAIN_PURCHASE_FINALITY=safe` or `finalized` for higher-value SKUs. Entitlements are revocable game items |
| Payments | Stablecoin freezes our store | Withdraw to the treasury regularly; the treasury is a multisig. Withdraw works while paused |
| Payments | Token quirks (decimals, fees, rebasing, upgrades) | Prices in base units, with decimals set at configuration (USDG has 6); exact-amount received check; allow-list of tokens; monitor `Upgraded` on USDG |
| Contracts | Reentrancy, unchecked calls | `nonReentrant`, CEI and SafeERC20 (hostile-token test) |
| Players | Approval phishing / over-approval | UI asks for an exact-amount approval, or a batched approve+purchase in a smart account; we never ask for unlimited approvals |
| Anti-multi-account | Wallet farms | Wallet links feed the linked-account flags (§4b); no direct transfers of anything game-valued on-chain |
| Compliance | Sanctioned users | The sequencer already excludes sanctioned addresses. Add our own screening at checkout before GA (open item) |
| Privacy | Leaking PII on-chain | Only hashes (raceKey, orderId), the buyer address and amounts go on-chain. The account ↔ wallet link stays in Postgres |

Solidity checklist applied, mapped to the OWASP Smart Contract Top 10 (2025) [owasp]:

| OWASP item | How it's covered |
|---|---|
| SC01 access control | Role per power; the deployer renounces |
| SC02 oracle manipulation | No price oracles |
| SC03 logic errors | Exhaustive tests and coverage |
| SC04 input validation | Zero-address, quantity, kind, root and count checks |
| SC05 reentrancy | Guard plus CEI |
| SC06 unchecked external calls | SafeERC20 |
| SC07 flash loans | No balance-based logic |
| SC08 overflow | 0.8 checked math |
| SC09 insecure randomness | No on-chain RNG |
| SC10 DoS | No unbounded loops over user data. Batch publishing is O(1) |

Merkle second-preimage is avoided by double-hashed leaves [rareskills].

## 6. Economy and compliance rules on-chain code must respect

These come from `docs/game-design.md` §8 and §4b–4f, and are expanded in the
`web3-game-economy` skill.

- **Stable Credits are never cashed out**, never bridged and never tokenised. No prize money.
- **One-way money flow:** buyer → store → treasury. No user balances, no payouts, no refunds
  on-chain. Exceptional refunds go through support, from the treasury.
- **Packs:**
  - published odds and pity (Rare within 10 pulls, Epic within 50);
  - pulls seeded and committed;
  - Premium Pack ≤ 10 per week per account;
  - **geo-blocked where paid loot boxes are restricted.** Belgium has treated paid loot
    boxes as gambling since 2018 [be-lootbox]; this needs current legal confirmation per
    market.
- **No pay-to-win in rated races;** purchases are cosmetic or convenience, or pack pulls
  under the genetic ceiling.
- **Anti-multi-account:** linked wallets are flagged; ranked rewards are cosmetic.
- **Age 18+** (the Robinhood Chain ToS requires it of chain users); no dark patterns; no
  push notifications about purchases.

## 7. Phased rollout (each step is a gate)

| Step | What | Gate to enter |
|---|---|---|
| 6.0 ✅ | Contracts, tests, adapter; mock by default | none |
| 6.1 Testnet (46630) | Deploy with throwaway keys and Paxos testnet USDG; anchor proofs in **shadow mode**; internal store dogfood; `/verify` page | Product sign-off on SKUs and prices; runbook for keys and pausing |
| 6.2 Hardening | Static analysis (Slither/Aderyn), invariant fuzzing (needs Foundry; not installed here); Safe multisig admin; KMS/HSM for server keys; event monitoring and alerts; purchase backstop cron | Zero high/medium findings internally |
| 6.3 Audit | External audit of about 300 SLOC; fix and re-audit | Audit report published |
| 6.4 **Legal review** (in parallel from 6.1) | Paid loot boxes per market, consumer law and refunds, VAT on digital goods paid in stablecoin, sanctions screening, ToS and privacy, Robinhood ToS (the "lawful testing" clause, branding), token (if ever): securities/MiCA | Written counsel sign-off |
| 6.5 Mainnet: proofs only | Fairness anchoring on 4663. No money involved, so it's the lowest risk | 6.2 and 6.3 done |
| 6.6 Mainnet: store beta | Allow-listed accounts, low caps; cosmetics and season pass first; premium packs per market after legal clears loot boxes | 6.4 signed off |
| 6.7 GA | Open to all eligible regions; timelock on admin | Beta KPIs, no incidents |
| Token | Not planned. A separate decision only after a legal opinion | Legal plus user decision |

## 8. Open questions for the user

1. **Stablecoin:** USDG is the native, verified option on Robinhood Chain. USDC isn't
   confirmed there. Go with USDG?
2. **Token:** keep it undeployed (recommended)?
3. **What purchases grant:** premium currency (a separate gem-style balance) or direct
   entitlements only? Should the `entry_refill` SKU exist at all, given that §4f makes it a
   credits sink?
4. **Wallet UX:** an embedded wallet (Privy or Dynamic) with sponsored gas, or
   bring-your-own wallet only?
5. **Entropy source** for the final seed (drand or an L1 block hash).
6. **Legal counsel and target markets** for the store, including the geo-block list.
7. **Ask Robinhood** (`chain-developers-group@robinhood.com`) whether the ToS "lawful
   testing, experimentation, evaluation and development" clause restricts production
   consumer apps on mainnet.

## Sources

[rh-connect]: https://docs.robinhood.com/chain/connecting
[rh-deploy]: https://docs.robinhood.com/chain/deploy-smart-contracts
[rh-final]: https://docs.robinhood.com/chain/transaction-finality
[rh-diff]: https://docs.robinhood.com/chain/differences-from-ethereum
[rh-gas]: https://docs.robinhood.com/chain/gas-and-fees
[rh-bridge]: https://docs.robinhood.com/chain/bridging
[rh-contracts]: https://docs.robinhood.com/chain/contracts
[rh-aa]: https://docs.robinhood.com/chain/account-abstraction
[rh-tos]: https://docs.robinhood.com/chain/terms-of-service
[arb-fact]: https://forum.arbitrum.foundation/t/arbitrumdao-factsheet-robinhood-chain-mainnet-launch/31041
[ct]: https://cointelegraph.com/news/robinhood-public-blockchain-mainnet-launch
[paxos-main]: https://docs.paxos.com/guides/stablecoin/usdg/mainnet
[paxos-test]: https://docs.paxos.com/guides/stablecoin/usdg/testnet
[alchemy-faucet]: https://www.alchemy.com/faucets/robinhood-testnet
[bitgo]: https://developers.bitgo.com/docs/robinhood-chain
[arbos20]: https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos20
[owasp]: https://owasp.org/www-project-smart-contract-top-10/
[rareskills]: https://rareskills.io/post/merkle-tree-second-preimage-attack
[be-lootbox]: https://pcgamer.com/belgiums-gambling-commission-rules-against-loot-boxes-in-overwatch-fifa-18-and-csgo/

- Robinhood Chain docs: [Connecting][rh-connect] · [Deploy][rh-deploy] · [Finality][rh-final] ·
  [Differences from Ethereum][rh-diff] · [Gas & fees][rh-gas] · [Bridging][rh-bridge] ·
  [Token contracts][rh-contracts] · [Account abstraction][rh-aa] · [Terms of service][rh-tos]
- Launch: [ArbitrumDAO factsheet][arb-fact] · [Cointelegraph][ct]
- USDG: [Paxos mainnet][paxos-main] · [Paxos testnet][paxos-test]
- Faucets: [Alchemy][alchemy-faucet] · [BitGo][bitgo]
- Arbitrum: [ArbOS 20 Atlas (Cancun)][arbos20]
- Security: [OWASP Smart Contract Top 10][owasp] · [Merkle second preimage (RareSkills)][rareskills]
- Loot boxes: [Belgium Gaming Commission, 2018 (PC Gamer)][be-lootbox]
- Own RPC checks (2026-10-25): `eth_chainId`, `eth_gasPrice`, `web3_clientVersion`,
  `eth_getBlockByNumber(safe|finalized)`, USDG `decimals()`, `symbol()` and the EIP-1967
  implementation slot, all against the public RPCs.
