# @thoroughbred/contracts

Optional web3 layer for Project Thoroughbred, targeting **Robinhood Chain** (an Arbitrum-based
EVM L2). **Web3 is OFF by default** (`WEB3_ENABLED` unset): the game runs fully without a
chain, using `MockChainAdapter`. The architecture, the threat model and the rollout gates are in
[`docs/web3.md`](../../docs/web3.md). The chain facts are in `.claude/skills/robinhood-chain/SKILL.md`.

| Path | What |
|---|---|
| `contracts/RaceProofRegistry.sol` | Write-once Merkle roots of race seed commitments and results. Anyone can verify a race. |
| `contracts/PremiumStore.sol` | One-way checkout for premium SKUs in an allow-listed stablecoin, using server-signed EIP-712 vouchers. There are no user balances and no payouts. |
| `contracts/ThoroughbredToken.sol` | OPTIONAL capped ERC20 + permit, with a genesis mint only. **Not deployed by default.** |
| `contracts/mocks/*` | Test-only tokens: 6-decimal blocklist/fee stablecoin, reentrant token. |
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

## What is tested (70 tests; coverage: 100% lines/functions on the 3 production contracts, 96–100% branches)

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
