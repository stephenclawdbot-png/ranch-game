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
| `contracts/HorseMarket.sol` | USDG horse market (`docs/usdg-market.md`): `buy(SaleOrder, sig)` pays the seller `price − fee` and the treasury `fee` straight from the buyer in one tx (`Sold`); `register(RegistrationOrder, sig)` pays the registration fee to the treasury (`Registered`). Never holds funds; USDG allow-list, exact amounts, fee ≤ 10 %, single-use orderId, pause. Deployed with `scripts/deploy-horse-market.ts` (not deployed yet). |
| `contracts/ThoroughbredToken.sol` | OPTIONAL capped ERC20 + permit, with a genesis mint only. **Not deployed by default.** |
| `contracts/mocks/*` | Test-only: 6-decimal blocklist/fee stablecoin, reentrant token, ETH receiver (accept/reject/re-enter), Chainlink-style price feed. |
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

## What is tested (136 tests; coverage: 100% lines/functions on the 5 production contracts, 94–100% branches)

**HorseMarket** (`test/horse-market.test.ts`)
- [x] buy: seller gets `price − fee`, treasury gets `fee`, buyer pays exactly `price`, the contract keeps 0; `Sold` fields; property test over random prices and fee rates
- [x] register: the fee goes to the treasury only; `Registered` fields; replay rejected
- [x] `hashSaleOrder` / `hashRegistrationOrder` equal viem's EIP-712 digests; `horseRef` encoding; the off-chain `Bid` signature recovers the bidder and is bound to chain and market
- [x] fee math: floor and ceiling of `price × feeBps` accepted, anything else `FeeMismatch`; fee > price; zero price; `feeBps` admin-only, capped at 10 %; a fee change kills old orders
- [x] single-use orderId across buy and register; front-running (`NotOrderBuyer`); self-trade; expired and over-long (> 4 days) orders
- [x] signature: tampered fields, non-signer, other contract/chain, garbage; signer rotation
- [x] token allow-list; fee-on-transfer rejected; frozen buyer/seller/treasury and a missing allowance revert without using the order; zero seller; plain ETH refused
- [x] reentrancy through a hostile token blocked; pause blocks both entry points, admin-only unpause; treasury changes; constructor validation
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
