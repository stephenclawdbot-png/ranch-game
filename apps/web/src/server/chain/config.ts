/**
 * Closed-beta chain configuration (server only). See apps/web/.env.example and docs/web3.md
 * "Beta money flow". Nothing here is NEXT_PUBLIC_: the browser receives the chain id and the
 * contract addresses inside API responses.
 *
 *   WEB3_ENABLED               "true" turns real ETH checkout on. Anything else: mock chain,
 *                              Premium shows "coming soon", the game is fully playable.
 *   CHAIN_ID                   46630 testnet (default) | 4663 mainnet | 31337 local Hardhat.
 *                              (ROBINHOOD_CHAIN_ID is accepted as a fallback name.)
 *   ROBINHOOD_RPC_URL          JSON-RPC URL (a provider URL in production).
 *   PREMIUM_STORE_ADDRESS      from /admin/chain after deploying.
 *   PRIZE_POOL_ADDRESS         from /admin/chain after deploying.
 *   QUOTE_SIGNER_PRIVATE_KEY   SECRET, Vercel env only. A DEDICATED LOW-VALUE key: it signs
 *                              price quotes (SIGNER_ROLE) and, if the owner grants it
 *                              POSTER_ROLE and a little gas, posts epoch roots. It can never
 *                              move pool or treasury funds.
 *   ETH_USD_PRICE_SOURCE       auto | coinbase,kraken,bitstamp,binance | fixed:3000
 *   PREMIUM_PACK_USD_CENTS     price of one Premium Pack in USD cents (default 499).
 *   CHAIN_MIN_CONFIRMATIONS    default 1 (soft confirmation is fine for packs).
 *   PREMIUM_BLOCKED_COUNTRIES  ISO codes where paid packs are not sold (default "BE,NL").
 *   CHAIN_LOG_LOOKBACK_BLOCKS  how far back the backstop scans for a paid order (default 200000).
 *   USDG_MODE                  "practice": beta test money only (see usdgConfig.ts). Forces the
 *                              beta money OFF whatever WEB3_ENABLED says (`enabled` false, mock
 *                              chain, no RPC): no real purchase, no payout, no commission.
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { isUsdgPracticeMode } from "@thoroughbred/game-core";

export interface BetaChainConfig {
  enabled: boolean;
  /** USDG_MODE=practice: no real money anywhere (checkout, Prize Pool, commissions refused). */
  practice: boolean;
  chainId: number;
  rpcUrl: string | null;
  store: Address | null;
  pool: Address | null;
  signerKey: Hex | null;
  minConfirmations: number;
  premiumUsdCents: number;
  quoteTtlSec: number;
  blockedCountries: string[];
  logLookbackBlocks: bigint;
}

export class BetaConfigError extends Error {
  override name = "BetaConfigError";
}

type Env = Record<string, string | undefined>;

function addr(env: Env, k: string): Address | null {
  const v = env[k]?.trim();
  if (!v) return null;
  if (!isAddress(v, { strict: false })) throw new BetaConfigError(`${k} is not an address`);
  return getAddress(v);
}

/**
 * USDG_MODE=practice, exactly (game-core `isUsdgPracticeMode`, the same switch as the tote's
 * T-USDG pools). A near miss ("Practice", " practice") is a configuration error, never a silent
 * fallback to real money; any other value (unset, live, mock, off) means practice mode is off.
 */
export function isPracticeEnv(env: Env = process.env): boolean {
  if (isUsdgPracticeMode(env)) return true;
  const v = (env.USDG_MODE ?? "").trim().toLowerCase();
  if (v === "practice") throw new BetaConfigError(`USDG_MODE must be exactly "practice" (got "${(env.USDG_MODE ?? "").slice(0, 20)}")`);
  return false;
}

export function readBetaConfig(env: Env = process.env): BetaChainConfig {
  const practice = isPracticeEnv(env);
  const chainId = Number(env.CHAIN_ID?.trim() || env.ROBINHOOD_CHAIN_ID?.trim() || 46630);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new BetaConfigError("CHAIN_ID must be a positive integer");
  const key = env.QUOTE_SIGNER_PRIVATE_KEY?.trim() || null;
  // Never echo key material in errors.
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new BetaConfigError("QUOTE_SIGNER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  const cents = Number(env.PREMIUM_PACK_USD_CENTS?.trim() || 499);
  if (!Number.isInteger(cents) || cents < 50 || cents > 100_000) throw new BetaConfigError("PREMIUM_PACK_USD_CENTS must be 50..100000");
  return {
    enabled: !practice && env.WEB3_ENABLED?.trim().toLowerCase() === "true",
    practice,
    chainId,
    rpcUrl: env.ROBINHOOD_RPC_URL?.trim() || null,
    store: addr(env, "PREMIUM_STORE_ADDRESS"),
    pool: addr(env, "PRIZE_POOL_ADDRESS"),
    signerKey: key as Hex | null,
    minConfirmations: Math.max(1, Number(env.CHAIN_MIN_CONFIRMATIONS?.trim() || 1) || 1),
    premiumUsdCents: cents,
    quoteTtlSec: 300,
    blockedCountries: (env.PREMIUM_BLOCKED_COUNTRIES ?? "BE,NL").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
    logLookbackBlocks: BigInt(env.CHAIN_LOG_LOOKBACK_BLOCKS?.trim() || 200_000),
  };
}

/** Throws unless every setting the real checkout needs is present. */
export function assertLiveConfig(c: BetaChainConfig): asserts c is BetaChainConfig & { rpcUrl: string; store: Address; pool: Address; signerKey: Hex } {
  const missing = [!c.rpcUrl && "ROBINHOOD_RPC_URL", !c.store && "PREMIUM_STORE_ADDRESS", !c.pool && "PRIZE_POOL_ADDRESS", !c.signerKey && "QUOTE_SIGNER_PRIVATE_KEY"].filter(Boolean);
  if (missing.length) throw new BetaConfigError(`WEB3_ENABLED=true requires ${missing.join(", ")}`);
}
