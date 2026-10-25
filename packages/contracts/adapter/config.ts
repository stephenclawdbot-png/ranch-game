import { getAddress, isAddress, type Address, type Hex } from "viem";
import { ChainConfigError, type ChainAdapter } from "./types";
import { MockChainAdapter } from "./mock";
import { EvmChainAdapter, type PurchaseFinality } from "./evm";

/**
 * Environment (server only; see apps/web/.env.example and docs/web3.md):
 *
 *   WEB3_ENABLED                  "true" to use the real chain. Anything else = MockChainAdapter (default).
 *   ROBINHOOD_RPC_URL             JSON-RPC URL (provider URL in production; public RPC is rate-limited).
 *   ROBINHOOD_CHAIN_ID            46630 testnet (default) | 4663 mainnet.
 *   PREMIUM_STORE_ADDRESS         PremiumStore contract.
 *   RACE_PROOF_REGISTRY_ADDRESS   RaceProofRegistry contract.
 *   PAYMENT_TOKEN_ADDRESS         Stablecoin used for display balances (e.g. USDG).
 *   CHAIN_MIN_CONFIRMATIONS       default 1.
 *   CHAIN_PURCHASE_FINALITY       latest (default) | safe | finalized.
 *   CHAIN_PUBLISHER_PRIVATE_KEY   SECRET. Holds PUBLISHER_ROLE on the registry. Set in Vercel env, never commit.
 *   STORE_SIGNER_PRIVATE_KEY      SECRET. Holds SIGNER_ROLE on the store. Set in Vercel env, never commit.
 */
export interface ChainConfig {
  enabled: boolean;
  chainId: number;
  rpcUrl?: string;
  premiumStore?: Address;
  raceProofRegistry?: Address;
  paymentToken?: Address;
  minConfirmations: number;
  purchaseFinality: PurchaseFinality;
}

export interface ChainSecrets {
  publisherKey?: Hex;
  storeSignerKey?: Hex;
}

type Env = Record<string, string | undefined>;

export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4663;

export function isWeb3Enabled(env: Env = process.env): boolean {
  return env.WEB3_ENABLED?.trim().toLowerCase() === "true";
}

function optAddress(env: Env, name: string): Address | undefined {
  const v = env[name]?.trim();
  if (!v) return undefined;
  if (!isAddress(v, { strict: false })) throw new ChainConfigError(`${name} is not a valid address`);
  return getAddress(v);
}

function optKey(env: Env, name: string): Hex | undefined {
  const v = env[name]?.trim();
  if (!v) return undefined;
  // Never echo the value in errors.
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new ChainConfigError(`${name} must be a 0x-prefixed 32-byte hex key`);
  return v as Hex;
}

export function readChainConfig(env: Env = process.env): ChainConfig {
  const chainId = Number(env.ROBINHOOD_CHAIN_ID?.trim() || ROBINHOOD_TESTNET_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new ChainConfigError("ROBINHOOD_CHAIN_ID must be a positive integer");
  const minConfirmations = Number(env.CHAIN_MIN_CONFIRMATIONS?.trim() || 1);
  if (!Number.isInteger(minConfirmations) || minConfirmations < 1) throw new ChainConfigError("CHAIN_MIN_CONFIRMATIONS must be >= 1");
  const finality = (env.CHAIN_PURCHASE_FINALITY?.trim() || "latest") as PurchaseFinality;
  if (!["latest", "safe", "finalized"].includes(finality)) throw new ChainConfigError("CHAIN_PURCHASE_FINALITY must be latest|safe|finalized");
  return {
    enabled: isWeb3Enabled(env),
    chainId,
    rpcUrl: env.ROBINHOOD_RPC_URL?.trim() || undefined,
    premiumStore: optAddress(env, "PREMIUM_STORE_ADDRESS"),
    raceProofRegistry: optAddress(env, "RACE_PROOF_REGISTRY_ADDRESS"),
    paymentToken: optAddress(env, "PAYMENT_TOKEN_ADDRESS"),
    minConfirmations,
    purchaseFinality: finality,
  };
}

export function readChainSecrets(env: Env = process.env): ChainSecrets {
  return { publisherKey: optKey(env, "CHAIN_PUBLISHER_PRIVATE_KEY"), storeSignerKey: optKey(env, "STORE_SIGNER_PRIVATE_KEY") };
}

/**
 * The one entry point the app should use. Feature flag OFF (default) -> MockChainAdapter,
 * so the game never needs a chain. Flag ON but misconfigured -> throws (fail loudly at boot,
 * never silently fall back to the mock in production).
 */
export function createChainAdapter(env: Env = process.env): ChainAdapter {
  const config = readChainConfig(env);
  if (!config.enabled) return new MockChainAdapter({ chainId: config.chainId, minConfirmations: config.minConfirmations });
  if (!config.rpcUrl) throw new ChainConfigError("WEB3_ENABLED=true requires ROBINHOOD_RPC_URL");
  if (!config.premiumStore && !config.raceProofRegistry) {
    throw new ChainConfigError("WEB3_ENABLED=true requires PREMIUM_STORE_ADDRESS and/or RACE_PROOF_REGISTRY_ADDRESS");
  }
  return EvmChainAdapter.fromConfig(config, readChainSecrets(env));
}
