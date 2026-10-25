---
name: robinhood-chain
description: Use when connecting to, configuring, deploying to, verifying on, or reasoning about Robinhood Chain (Arbitrum-based EVM L2; mainnet 4663, testnet 46630) for Project Thoroughbred, including RPC/explorer/faucet/bridge facts, finality and confirmation choices, USDG stablecoin details, env vars, and chain-specific gotchas (block.number, prevrandao, sequencer, ToS limits).
---

# Robinhood Chain

**These facts are dated 2026-10-25.** Re-check anything that has moved (versions, endpoints,
token lists) at https://docs.robinhood.com/chain before relying on it. The sources and the
full research are in `docs/web3.md` §1. Our code keeps every chain fact in **env/config**, so
a change needs no code edit.

## Network facts

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | **4663** (`0x1237`) | **46630** (`0xb626`) |
| Status | Live since 2026-07-01 | Public since Feb 2026 |
| Public RPC (rate-limited, not for production) | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Provider RPC (Alchemy, recommended) | `https://robinhood-mainnet.g.alchemy.com/v2/<KEY>` | `https://robinhood-testnet.g.alchemy.com/v2/<KEY>` |
| Explorer (Blockscout) | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Verify API | `https://robinhoodchain.blockscout.com/api` | `https://explorer.testnet.chain.robinhood.com/api` |
| USDG (Paxos, **6 decimals**) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | `0x7E955252E15c84f5768B83c41a71F9eba181802F` |
| Gas token | ETH | Sepolia-bridged ETH |

- **Stack:** an Arbitrum (Nitro) chain settling to Ethereum, with blob data availability.
  Cancun opcodes work (we compile for `cancun`). EIP-7702 is supported. ERC-4337
  EntryPoints v0.6, v0.7 and v0.8 are deployed.
- **viem:** `import { robinhood, robinhoodTestnet } from "viem/chains"`. The adapter's
  `chainFor(id, rpcUrl)` overrides the RPC with ours. Don't use the third-party RPC that
  viem's mainnet definition also lists.
- **Testnet ETH:** the Alchemy faucet (0.1 ETH a day; needs mainnet ETH activity), or
  bridge Sepolia ETH through the Arbitrum bridge. `faucet.testnet.chain.robinhood.com`
  rate-limited us.
- **Testnet USDG:** the Paxos faucet (`faucet.paxos.com`). Token availability can change.
- **USDC:** **not confirmed** on Robinhood Chain. USDG is the stablecoin to plan for.

## Env vars

Server only. Hardhat reads the first group; the app adapter reads the second.

```sh
# hardhat (packages/contracts/hardhat.config.ts): network "robinhood" exists only if the URL is set
ROBINHOOD_RPC_URL=https://rpc.testnet.chain.robinhood.com
ROBINHOOD_CHAIN_ID=46630                # 4663 for mainnet
ROBINHOOD_EXPLORER_URL=https://explorer.testnet.chain.robinhood.com
DEPLOYER_PRIVATE_KEY=                   # never commit; throwaway on testnet
DEPLOY_ADMIN_ADDRESS= DEPLOY_TREASURY_ADDRESS= DEPLOY_PUBLISHER_ADDRESS= DEPLOY_STORE_SIGNER_ADDRESS=
PAYMENT_TOKEN_ADDRESS=                  # defaults to testnet USDG on 46630

# app (apps/web/.env.example): adapter/config.ts
WEB3_ENABLED=false                      # default; anything but "true" = MockChainAdapter
PREMIUM_STORE_ADDRESS= RACE_PROOF_REGISTRY_ADDRESS= PAYMENT_TOKEN_ADDRESS=
CHAIN_MIN_CONFIRMATIONS=1  CHAIN_PURCHASE_FINALITY=latest   # latest | safe | finalized
CHAIN_PUBLISHER_PRIVATE_KEY= STORE_SIGNER_PRIVATE_KEY=      # SECRETS: Vercel env only
```

## Deploy and verify flow

Testnet only, until the gates in `docs/web3.md` §7 are passed.

1. `pnpm --filter @thoroughbred/contracts test` must be green.
2. Fund a **fresh throwaway** deployer with testnet ETH. Choose the admin (a Safe
   multisig on mainnet), the treasury, and the publisher and signer server addresses.
3. Run:
   ```sh
   ROBINHOOD_RPC_URL=... DEPLOYER_PRIVATE_KEY=... DEPLOY_ADMIN_ADDRESS=... \
   pnpm --filter @thoroughbred/contracts deploy:robinhood
   ```
   This deploys the registry and store, configures USDG prices (base units, 6 decimals),
   hands admin over and renounces the deployer, and writes `deployments/<chainId>.json`.
4. Verify on Blockscout:
   ```sh
   npx hardhat verify --network robinhood <address> <ctor args>
   ```
   The apiKey is `"empty"`, and `customChains` is already configured.
5. Put the addresses in Vercel env (not in the repo), then set `WEB3_ENABLED=true` on
   **Preview only** first.

## Finality: which setting to use

The stages are:
- **Soft confirmation:** sub-second (about 100 ms preconfirmations). The sequencer orders
  it, and only sequencer equivocation could reorder it.
- **Posted to L1:** within minutes.
- **Ethereum-final:** about 13 minutes after posting.

| Use | Setting |
|---|---|
| Proof anchoring | `latest` is fine (the data is public; we re-check it with `getProofBatch`) |
| Cheap SKUs (cosmetics, packs) | `CHAIN_PURCHASE_FINALITY=latest`, 1 confirmation |
| Higher-value SKUs (season pass) | `safe` (the batch is posted to L1) |
| Anything irreversible and high-value | `finalized` |

Canonical bridge withdrawals to L1 take 7 days. That's irrelevant to us: we never withdraw
for users.

## Gotchas

- `block.number` returns an **L1 block estimate**. Use `block.timestamp`, or ArbSys
  `arbBlockNumber()` at `0x…64`.
- `block.prevrandao` / `difficulty` are **constant**. There's no on-chain randomness.
- Fees = L2 gas plus an **L1 calldata fee**. Minimise calldata and batch. Observed gas
  price: 0.01–0.02 gwei.
- Ordering is **first come, first served** at the sequencer. Priority fees don't buy
  position, so there's no mempool front-running auction (but still bind vouchers to the
  sender).
- **The sequencer drops transactions from sanctioned addresses.** Robinhood may block
  addresses (ToS §6). The checkout UX must handle "tx never lands" (`pending/unknown_tx`
  → time out).
- USDG mainnet is an **upgradeable proxy**, and Paxos tokens can freeze addresses. Sweep
  store proceeds to the multisig treasury regularly.
- The public RPC is rate-limited and "not intended for production". Use a provider key
  (Alchemy etc.) for anything real, and an **archive** endpoint for historical log scans.
- L1-to-L2 messages alias `msg.sender`. We don't use them; if you ever do, account for
  the offset in access control.
- The contract size limit is 96 KB (not 24 KB). Don't rely on it: we stay
  Ethereum-portable.
- **ToS:**
  - users must be 18+ and not sanctioned, with no VPN evasion;
  - **no Robinhood marks** in token or NFT names;
  - "Built on Robinhood Chain" wording is conditionally pre-approved;
  - the services are described for "lawful testing… and development". Open question in
    `docs/web3.md` §8.

## Health check

```sh
curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' https://rpc.testnet.chain.robinhood.com
# expect {"result":"0xb626"}; mainnet "0x1237"
```
