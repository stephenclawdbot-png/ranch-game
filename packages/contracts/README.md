# @thoroughbred/contracts

Optional web3 layer for Project Thoroughbred, targeting **Robinhood Chain** (an Arbitrum-based
EVM L2). **Web3 is OFF by default** (`WEB3_ENABLED` unset): the game runs fully without a
chain, using `MockChainAdapter`. The architecture, the threat model and the rollout gates are in
[`docs/web3.md`](../../docs/web3.md). The chain facts are in `.claude/skills/robinhood-chain/SKILL.md`.

| Path | What |
|---|---|
| `contracts/RaceProofRegistry.sol` | Write-once Merkle roots of race seed commitments and results. Anyone can verify a race. |
| `contracts/PremiumStore.sol` | Checkout for premium SKUs: an allow-listed stablecoin (EIP-712 `Order`) **and native ETH** (EIP-712 `EthQuote`, closed beta): `poolBps` (10–50 %) to the PrizePool, 2-level affiliate commissions (≤ 15 % / 5 %) and the rest to the treasury, in the same tx. Optional Chainlink tolerance check. |
| `contracts/PrizePool.sol` | Closed-beta Prize Pool: ETH only from the store and owner top-ups; weekly Merkle epochs, never over-allocated (`total ≤ maxEpochBps × (balance − outstanding)`); per-account cap; linear vesting; revoke / cancel / expiry return funds **to the pool**; no withdraw or sweep. |
| `contracts/HorseMarket.sol` | USDG horse market (`docs/usdg-market.md`): `buy(SaleOrder, sig)` pays the seller `price − fee` and the treasury `fee` straight from the buyer in one tx (`Sold`); `register(RegistrationOrder, sig)` pays the registration fee to the treasury (`Registered`); `payStudFee(StudOrder, sig)` pays a registered stallion's USDG stud fee to his owner (`price − fee`) and the treasury (`fee`) for one covering (`StudFeePaid`). Never holds funds; USDG allow-list, exact amounts, fee ≤ 10 %, single-use orderId, pause. Deployed with `scripts/deploy-horse-market.ts` (not deployed yet). |
| `contracts/TotePools.sol` | **DORMANT** real-money pari-mutuel tote (`docs/usdg-tote.md`). Not deployed; no deploy script. The stake asset is per market: an allow-listed ERC-20 (only USDG at deployment) or native ETH (`address(0)`, off until an admin sets its limits and allow-lists it); each market settles in its own asset, no conversion, no oracle. Non-custodial: stakes sit only in the contract, pull-payment claims, no owner withdrawal of player funds, no upgrade path. Markets carry the seed commitment before betting opens; bets need a short-lived single-use EIP-712 `BetPermit` from the server and close `CLOSE_MARGIN` before `closeTime`; entropy from several future L2 block hashes, plus an optional randomness beacon (`lockEntropy` / `sealEntropy`, anyone); a result needs the operator's post and a matching attestation from an independent result attestor, and opens a guardian challenge window; the split runs on chain with game-core's rules; unsettled markets expire to refunds. |
| `contracts/ThoroughbredToken.sol` | OPTIONAL capped ERC20 + permit, with a genesis mint only. **Not deployed by default.** |
| `contracts/mocks/*` | Test-only: 6-decimal blocklist/fee stablecoin, reentrant tokens (transferFrom; transfer + transferFrom for the tote), an ArbSys block-read stand-in (with a failure switch), a randomness beacon, a TotePools harness that reports chain 46630, ETH receiver (accept/reject/re-enter), Chainlink-style price feed. |
| `scripts/export-web.ts` | Writes `apps/web/src/lib/chain/contracts.generated.ts` (ABIs + bytecode for the browser deploy on `/admin/chain`, EIP-712 types). `pnpm --filter @thoroughbred/contracts export:web` after any contract change; `test/export-web.test.ts` fails when stale. |
| `adapter/` | Server-side `ChainAdapter` (mock + viem EVM), Merkle batching and EIP-712 vouchers. Exported as `@thoroughbred/contracts/adapter`. |
| `scripts/deploy.ts` | Deploy and configure, then hand admin to a multisig. Tested against the in-process Hardhat network. |

The adapter lives here rather than in `packages/chain`. viem resolves only from this package
without a new `pnpm install`, and adding a workspace package would break
`pnpm install --frozen-lockfile` until the lockfile is regenerated. It can move to its own
package later without any change to its API.

## Commands

```sh
pnpm --filter @thoroughbred/contracts test        # hardhat test (mocha + viem), 70 tests
pnpm --filter @thoroughbred/contracts typecheck   # compile + tsc
pnpm --filter @thoroughbred/contracts coverage    # solidity-coverage (needs SOLIDITY_COVERAGE=true, set by the script)
pnpm --filter @thoroughbred/contracts compile

# Testnet deploy (NOT done yet; no keys in the repo). Requires the gates in docs/web3.md.
ROBINHOOD_RPC_URL=https://rpc.testnet.chain.robinhood.com ROBINHOOD_CHAIN_ID=46630 \
DEPLOYER_PRIVATE_KEY=0x... DEPLOY_ADMIN_ADDRESS=0xSafe... \
DEPLOY_PUBLISHER_ADDRESS=0x... DEPLOY_STORE_SIGNER_ADDRESS=0x... \
pnpm --filter @thoroughbred/contracts deploy:robinhood
npx hardhat verify --network robinhood <address> <constructor args...>   # Blockscout

# USDG horse market (testnet first; prints the app env block and the verify command)
ROBINHOOD_RPC_URL=https://rpc.testnet.chain.robinhood.com DEPLOYER_PRIVATE_KEY=0x... \
DEPLOY_ADMIN_ADDRESS=0x... DEPLOY_TREASURY_ADDRESS=0x... DEPLOY_STORE_SIGNER_ADDRESS=0x... \
pnpm --filter @thoroughbred/contracts deploy:horse-market
```

## Adapter API (server only)

```ts
import { createChainAdapter, buildCommitmentBatch, buildResultBatch, newOrderId, skuId } from "@thoroughbred/contracts/adapter";

const chain = createChainAdapter();               // Mock unless WEB3_ENABLED=true (then fails loudly if misconfigured)
const voucher = await chain.createPurchaseVoucher({ orderId: newOrderId(), buyer, sku: skuId("premium_pack"),
  quantity: 1, token, maxTotal, deadline });      // only after server-side checks (caps, geo, account)
const v = await chain.verifyPurchase(txHash, { orderId, sku, buyer, quantity, token, minTotal });
// v.status: "confirmed" (credit once, using v.purchase.idempotencyKey as a UNIQUE key) | "pending" (retry) | "rejected"
const batch = buildCommitmentBatch(races.map(r => ({ raceId: r.id, seedCommitment: r.seedCommitment })));
await chain.publishProofBatch({ kind: batch.kind, batchId, root: batch.root, leafCount: batch.leafCount });
await chain.getBalances(address);                 // display only
```

## Leaf encoding (TS ⇄ Solidity, tested for parity)

- `raceKey = keccak256(utf8(raceId))`
- `commitmentLeaf = keccak256(keccak256(abi.encode(uint8 1, raceKey, seedCommitment)))`
- `resultLeaf = keccak256(keccak256(abi.encode(uint8 2, raceKey, resultHash, revealedSeed)))`
- Pairs use OpenZeppelin's commutative keccak256. Leaves are sorted, and an odd node is promoted.
- `seedCommitment = sha256(seed bytes)`, which is the racing engine's `commitSeed`. The contract re-checks it with the sha256 precompile in `verifyRace`.

## What is tested (193 tests; coverage: 100% lines/functions on the 5 production contracts, 94–100% branches; TotePools coverage not yet measured)

**TotePools** (`test/tote-pools.test.ts`, 47 tests; dormant, never deployed). Each finding of the security review has its own test, the reviewer's exploits included (A–E below).
- [x] full lifecycle: bets, entropy lock and seal (the stored entropy is keccak256 of the race key and `ENTROPY_BLOCKS` consecutive block hashes), result with the revealed seed (`sha256(seed)` = the engine's `commitSeed`), `finalSeed = sha256(seed ‖ entropy)` equals the adapter's `toteFinalSeed`, the attestor's matching hash (`resultHashOf` = the adapter's `toteResultHash`), challenge window, finalize, claims; every payout equals the game-core rules (`test/toteReference.ts`, a copy proven identical to game-core `settleTotePool` by game-core's `tote.parity.test.ts`); `claimable` previews `claim`; payouts + take + remainder = stakes; the contract holds 0 after all claims and `withdrawTreasury`
- [x] deployment: each role its own key (the attestor, operator, guardian and permit signer must differ: `SharedRoleKey`), zero addresses, unsafe timing, `ENTROPY_BLOCKS` 3–16; an ArbSys address without code refused; on chain 4663 / 46630 ArbSys required (a test-only harness reports chain 46630)
- [x] late bets: accepted 1 s before `closeTime − CLOSE_MARGIN`, refused at exactly the margin and after the close
- [x] permits: missing/garbage signature, tampered fields, a non-signer key, another bettor's permit, another race's permit, above `maxAmount`, expired, reused nonce; **(A)** a permit for runner 0 / WIN can't be used on runner 5 / PLACE (runner and pool are signed); **(E)** a long-dated permit is refused (lifetime counted from `issuedAt`, max 10 min; not valid before `issuedAt`)
- [x] caps (per asset): min stake, max per bet, max per wallet per race (across pools), max pool (per pool); bad runner; no place pool; unknown market; pause blocks bets only (claims work while paused); fee-on-transfer token refused
- [x] entropy: not before the close, locked once, sealed once, only after its last block exists; a missed 256-block window voids the market (refunds); the ArbSys path (block number and hashes from the precompile; its out-of-range error → void; any other ArbSys failure reverts instead of voiding); the optional randomness beacon (off by default; fixed per market at creation; requested at lock; the block part stored while it is awaited; mixed in at seal)
- [x] results: operator only, entropy sealed first, seed mismatch, malformed finishes; **(D)** an operator-only fake result can't finalize: no attestation → `NotAttested`, a mismatching attestation freezes the market (`ResultDisputed`, sticky until the guardian acts), a stale attestation after a correction → `AttestationMismatch`; **(C)** a correction at `challengeEnd − 1` reopens the full window; at most 2 corrections, then only void; after an attested window no correction or void; **(B)** the operator can't cancel once the entropy block is picked (only the guardian voids); anyone expires an unsettled market after `MAX_SETTLE_DELAY`, and a posted result never matched by an attestation `MAX_SETTLE_DELAY` after its window; a late result is refused
- [x] settlement: stakes back first, then the profit by place; dead heat for first (WIN), dead heat for the last paying place (PLACE), unbacked paying runner's share to the others, no-winner pro-rata refund of the net pool, non-runners refunded in full, too few runners for a place pool → refunded; minimum pool (one wallet on two runners, two wallets on one runner → refunded, no take); winners never lose (the take cut to 5, and to 0); L4: `entitledStake` counts only runners with a share and the last claim sweeps the dust
- [x] claims: once per wallet, never before finalize, a frozen winner can claim to another address, `NothingToClaim`; tokens sent directly stay unaccounted; admin-only stake limits, treasury and beacon; the ABI has no function that sends tokens anywhere but a claimant's address or the treasury
- [x] reentrancy through a hostile token blocked on `bet`, `claim` and `withdrawTreasury`
- [x] randomized pools (24 rounds, up to 24 runners, random dead heats and non-runners, thin pools, heavy favourites, takeouts 0 / 15 / 12.34 / 25 %): payouts equal the reference, conservation holds, the contract empties
- [x] stake assets: only USDG allow-listed at deployment (ETH off, no limits); markets in a non-allow-listed token or ETH refused; allow-listing needs limits first; an ETH market end to end; ETH void refunds; a USDG market refuses ETH; plain ETH transfers refused; a recipient that refuses ETH fails only its own claim; re-entry from the ETH receive hook blocked; de-listing stops new markets and bets but not refunds or claims
- [x] gas printed (bet ≈ 260k on a runner's first bet, finalize ≈ 318k for 12 runners, claim ≈ 105k); deployed size ≈ 24.2 KB (under the 24,576-byte limit)

**HorseMarket** (`test/horse-market.test.ts`)
- [x] buy: seller gets `price − fee`, treasury gets `fee`, buyer pays exactly `price`, the contract keeps 0; `Sold` fields; property test over random prices and fee rates
- [x] register: the fee goes to the treasury only; `Registered` fields; replay rejected
- [x] `hashSaleOrder` / `hashRegistrationOrder` equal viem's EIP-712 digests; `horseRef` encoding; the off-chain `Bid` signature recovers the bidder and is bound to chain and market
- [x] fee math: floor and ceiling of `price × feeBps` accepted, anything else `FeeMismatch`; fee > price; zero price; `feeBps` admin-only, capped at 10 %; a fee change kills old orders
- [x] single-use orderId across buy and register; front-running (`NotOrderBuyer`); self-trade; expired and over-long (> 4 days) orders
- [x] signature: tampered fields, non-signer, other contract/chain, garbage; signer rotation
- [x] token allow-list; fee-on-transfer rejected; frozen buyer/seller/treasury and a missing allowance revert without using the order; zero seller; plain ETH refused
- [x] reentrancy through a hostile token blocked; pause blocks both entry points, admin-only unpause; treasury changes; constructor validation
- [x] payStudFee: stallion owner gets `price − fee`, treasury `fee`, contract keeps 0; `StudFeePaid` fields; `hashStudOrder` equals viem's digest; orderId single-use across all three order kinds; deadline / TTL; wrong payer, self-pay, zero owner; fee math (floor/ceiling, property test); tampered fields, other signer/contract/chain, a SaleOrder signature over the same fields; pause, allow-list, fee-on-transfer and frozen accounts leave the order unused; reentrancy
- [x] `deployHorseMarket` (deploy script) against the in-process network

**PrizePool** (`test/prize-pool.test.ts`)
- [x] funding only via `fund()` by FUNDER_ROLE (store/admin); plain transfers refused; funding works while paused
- [x] cannot over-allocate: `total ≤ maxEpochBps × (balance − outstanding)`, across epochs; property test: `outstanding ≤ balance` over random fund/post/claim sequences
- [x] epochs sequential, rate-limited (`minEpochInterval`), validated, POSTER_ROLE only, blocked while paused
- [x] linear vesting math (matches the TS mirror), several partial claims, full amount at vestEnd, double claim → `NothingToClaim`
- [x] wrong proof / other account / tampered amount or vesting / unknown epoch / above the per-account cap
- [x] a bad root can never pay more than the epoch total (`EpochExhausted`)
- [x] leaves bound to epoch, chain and pool contract; golden leaf vector shared with apps/web
- [x] pause blocks claims, admin-only unpause; reentrancy from a malicious claimer blocked
- [x] revoke (keep vested / take all unclaimed), cancelEpoch (works while paused), expiry after the claim window (anyone) — all return ETH to the pool only
- [x] bounded, admin-only params snapshotted per epoch; zero admin rejected; no withdraw/sweep function exists

**PremiumStore native ETH** (`test/premium-store-eth.test.ts`)
- [x] exact split 30 % pool (Funded event, ref = orderId) / 70 % treasury, nothing left in the store; property test over random prices and bps
- [x] `hashEthQuote` equals viem's EIP-712 digest; exact `msg.value`; zero price; single-use orderId (shared with the ERC20 path); front-running
- [x] expired quotes and quotes valid > 10 min rejected; tampered price/quantity/referrer, wrong signer, other contract/chain, garbage signature
- [x] inactive SKU, quantity bounds, pause; a pool that refuses funding undoes the whole sale
- [x] a treasury that refuses ETH: sale succeeds, share deferred, `withdrawEth` pays it later; hostile treasury reentrancy blocked
- [x] affiliates: L1 10 % + L2 3 % paid instantly out of the treasury share (pool untouched); L1 only; refusing referrer credited + `withdrawReferral`; reentrant referrer; validation (ceilings, self, duplicate, L2 without L1); admin ceilings with hard caps 15 % / 5 %
- [x] optional Chainlink check: within tolerance passes, under/over price and stale/zero feed rejected, disabled again with `feed = 0`
- [x] poolBps bounded [1000, 5000], admin-only, evented; the pool address is immutable

**RaceProofRegistry**
- [x] publish stores root/leafCount/timestamp and emits `BatchPublished` (with manifest URI); gas is constant per batch (~76k)
- [x] a batch id is write-once per kind; the same id under the other kind is independent
- [x] validation: invalid kind, zero root, zero leaf count; zero-address constructor args
- [x] access control: only `PUBLISHER_ROLE` publishes; admin rotates the publisher key
- [x] pause blocks publishing, not verification; only the admin unpauses
- [x] every proof verifies for batch sizes 1, 2, 3, 5, 8, 13, 33
- [x] negatives: wrong commitment, wrong race, tampered/empty proof, other batch, unknown batch, kind confusion
- [x] `verifyRace`: both inclusions, `sha256(seed) == commitment`, a wrong seed/result fails, and a commitment anchored *after* the result fails
- [x] on-chain sha256 matches the racing engine's `commitSeed` golden vector

**PremiumStore**
- [x] happy path: payment taken, order marked fulfilled, `Purchased` event fields; quantity × price
- [x] `hashOrder` equals viem's EIP-712 digest (parity with the server signer)
- [x] a replayed orderId reverts, even with a freshly signed voucher (no double fulfilment)
- [x] front-running: another address cannot submit the buyer's voucher
- [x] signature: tampered fields, a non-signer key, another contract, another chain id, garbage bytes
- [x] expired deadline; signer rotation (a revoked key's vouchers die)
- [x] wrong token (not accepted / no price), inactive or unknown SKU, price raised above `maxTotal`, quantity 0 or 101
- [x] ERC20 quirks: fee-on-transfer rejected; a blocklisted buyer and a missing allowance revert and leave the order unused; plain ETH refused
- [x] reentrancy through a hostile token is blocked
- [x] pause/unpause roles; price/SKU/token admin roles; `PriceSet(old,new)` event
- [x] withdraw only to the treasury, only by `TREASURER_ROLE`, works while paused; treasury change is admin-only and non-zero

**ThoroughbredToken (optional)**
- [x] metadata, cap and zero initial supply; genesis mint only by the minter, up to the cap; length mismatch
- [x] `finalizeGenesis` is admin-only, one-time and permanently disables minting
- [x] EIP-2612 permit works, and a replayed permit fails

**Adapter**
- [x] TS leaves equal the Solidity leaves (50 random cases); domain separation; commutative pairs
- [x] the tree root is order-independent; proofs verify for 1–31 leaves; the odd-node promotion is hand-checked; duplicates and empty input are rejected
- [x] hand-written ABIs match the compiled artifacts (selectors, outputs, mutability, indexed flags)
- [x] config: the flag is off by default leading to the mock (testnet chain id); validation; enabled-but-misconfigured throws; key values are never echoed in errors
- [x] Mock: confirm + idempotency key, replay/maxTotal/quantity mirror the contract, each mismatch reason, unknown tx pending, confirmations, write-once batches, balances
- [x] EVM (on Hardhat): a server-signed voucher is accepted on-chain → `verifyPurchase` confirms; mismatches; identical events from a fake store are ignored; unknown tx/confirmation/finality pending; wrong chain; idempotent batch publishing + conflict + on-chain proof check; no publisher key; balances
- [x] the deploy script configures the catalogue, keeps the token opt-in, and hands admin to a multisig, renouncing the deployer
