---
name: solidity-dev
description: Use when writing, changing, testing, reviewing or securing Solidity contracts in packages/contracts (Solidity 0.8.28, OpenZeppelin 5.7, Hardhat 2.29 + hardhat-toolbox-viem, mocha tests with viem), or when touching the TypeScript chain adapter in packages/contracts/adapter that must stay byte-compatible with the contracts (leaf hashing, EIP-712, ABIs).
---

# Solidity development in this repo

Package: `packages/contracts`. Design and threat model: `docs/web3.md`. Network facts: the
`robinhood-chain` skill. Economy constraints: the `web3-game-economy` skill. Read them before
changing behaviour.

## Toolchain

- Hardhat **2.29.1**, `@nomicfoundation/hardhat-toolbox-viem` 3, viem **2.57.11**,
  OpenZeppelin **5.7.0**, solc **0.8.28** (cached), `evmVersion: "cancun"`, optimizer at 200
  runs.
- **Foundry is not installed.** Don't plan on `forge`. Fuzz with property loops in mocha.
- **No chai-as-promised.** Use `expectRevert(promise, "CustomErrorName")` and
  `expectAnyRevert` from `test/helpers.ts`.
- **Don't run root `pnpm install` or add dependencies** without the lead's OK. viem is only
  resolvable from `packages/contracts`, which is why the adapter lives in `adapter/`.

```sh
pnpm --filter @thoroughbred/contracts test        # all 70 tests
pnpm --filter @thoroughbred/contracts typecheck   # hardhat compile + tsc
pnpm --filter @thoroughbred/contracts coverage    # sets SOLIDITY_COVERAGE=true (required with hardhat-viem)
cd packages/contracts && npx hardhat test test/premium-store.test.ts   # one file
npx hardhat run scripts/deploy.ts                 # deploy script against the in-process network
```

## Conventions

- `pragma solidity 0.8.28;` (pinned). Use named imports
  (`import {X} from "@openzeppelin/contracts/..."`).
- Use **custom errors**, never revert strings. Emit an event for every state change an
  indexer or the server cares about.
- Use `AccessControl` roles named for one power each (`PUBLISHER_ROLE`, `SIGNER_ROLE`,
  `TREASURER_ROLE`...). The admin is a multisig in production. `unpause` needs the admin;
  `pause` needs `PAUSER_ROLE`.
- Make writes **idempotent or write-once** (orderId, batchId) so server retries are safe.
- **No upgradeability** unless the lead decides otherwise: keep contracts small and
  redeploy instead.
- Test-only contracts go in `contracts/mocks/` with a `TEST ONLY` NatSpec line.
- Mirror every change to an event, function or struct in `adapter/abi.ts`.
  `test/abi-sync.test.ts` fails otherwise.
- Leaf, EIP-712 or SKU hashing changes must be made in **both** the `.sol` file and
  `adapter/merkle.ts` / `adapter/voucher.ts`. The parity tests (`merkle.test.ts`, and
  `hashOrder` in `premium-store.test.ts`) must stay green.

## Security checklist (run it on every PR)

The OWASP Smart Contract Top 10 (2025) plus our specifics:

- [ ] **Access control:** each external state-changing function has the narrowest role;
      the constructor rejects `address(0)`; the deploy script renounces the deployer.
- [ ] **CEI + `nonReentrant`** on anything that calls a token; mark state *before* the
      external call (see `PremiumStore.purchase`).
- [ ] **SafeERC20** for every transfer; check the **received amount** (fee-on-transfer and
      rebasing tokens); assume the stablecoin can **blocklist any address** and is an
      **upgradeable proxy** (USDG is).
- [ ] **Decimals:** stablecoins here have 6 decimals. Prices are base units. Never assume 18.
- [ ] **Signatures:** EIP-712 with chainId and verifyingContract in the domain (OZ
      `EIP712`); bind to `msg.sender`; single-use id; deadline; `ECDSA.tryRecover` (OZ
      rejects malleable `s`); a role check on the signer; rotation by grant then revoke.
- [ ] **Merkle:** double-hash leaves and include a kind tag (second-preimage and
      cross-kind safe); write-once roots; `MerkleProof.verifyCalldata`.
- [ ] **No on-chain randomness** (`block.prevrandao` is constant on Arbitrum chains).
      Commit-reveal with the server seed plus external entropy.
- [ ] **No `block.number` timing.** On Arbitrum it's an L1 estimate; use
      `block.timestamp` or ArbSys.
- [ ] **No oracle/price manipulation surface.** Prices are admin-set, and buyers are
      protected by `maxTotal`.
- [ ] **DoS:** no unbounded loops over user-controlled arrays in state-changing paths;
      O(1) storage per batch.
- [ ] **Money flows one way** (buyer → store → treasury). No function sends funds to an
      arbitrary address or to users (the `web3-game-economy` skill).
- [ ] Pausing stops new value flows but **never** blocks verification or treasury rescue.
- [ ] Every revert path has a test; coverage stays at 100% of lines on production contracts.

## Gas and L2 cost

- On Robinhood Chain, cost = L2 gas plus an **L1 data fee driven by calldata size**. Keep
  calldata small: `bytes32` ids instead of strings, emit long strings only in events (as
  `manifestURI` does), and batch (one Merkle root per many races).
- Prefer `calldata` arrays, custom errors and `uint64`/`uint32` packing in structs read
  together (see `RaceProofRegistry.Batch`, one slot).
- Measured: `publishBatch` ≈ 76k gas, `purchase` ≈ 115k gas (printed by the tests).

## Test patterns (viem + mocha)

```ts
import hre from "hardhat";
import { loadFixture, time, mine } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
const [admin, user] = await hre.viem.getWalletClients();
const c = await hre.viem.deployContract("PremiumStore", [admin.account.address, admin.account.address, admin.account.address]);
const asUser = await hre.viem.getContractAt("PremiumStore", c.address, { client: { wallet: user } });
await expectRevert(asUser.write.pause(), "AccessControlUnauthorizedAccount");
const [ev] = await c.getEvents.PriceSet({ sku }, { fromBlock });   // compare addresses via getAddress()
```

- Wrap setup in a fixture and use `loadFixture` (snapshots keep it fast).
- hardhat-viem returns **lowercase** contract addresses; event args are checksummed. Wrap
  with `getAddress()` before `deep.equal`.
- Server-like keys: `localServerWallet()` generates a key at runtime (never commit keys,
  even test ones) and funds it.
- Sign EIP-712 with `wallet.signTypedData({ account, ...orderTypedData(order, chainId, store) })`.
- Cover each negative case: wrong role, paused, replay, tampered signature, other
  chain/contract, wrong token, wrong amount, quirky tokens (`MockStablecoin.setFeeBps`,
  `setBlocked`), and reentrancy (`MockReentrantToken`).
- After adding tests, update the "What is tested" list in `packages/contracts/README.md`.

## Before any deploy

Follow the gates in `docs/web3.md` §7 (testnet → hardening → audit → legal → mainnet).
**Never deploy to mainnet from an agent session.** Never put a private key in a file,
command line history or test. Use env vars only.
