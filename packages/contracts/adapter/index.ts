// @thoroughbred/contracts/adapter: server-side chain integration (Robinhood Chain / any EVM).
// Lives inside packages/contracts because viem is only resolvable from this package without a
// fresh `pnpm install`. Import from server code only (route handlers, server actions, cron).
export * from "./types";
export * from "./merkle";
export * from "./voucher";
export * from "./config";
export { MockChainAdapter, MOCK_STORE_ADDRESS } from "./mock";
export { EvmChainAdapter, chainFor, type EvmChainAdapterOptions, type PurchaseFinality } from "./evm";
export { premiumStoreAbi, raceProofRegistryAbi } from "./abi";
export { idempotencyKey } from "./verify";
