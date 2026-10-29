/**
 * USDG horse market configuration (server only; docs/usdg-market.md). The market knobs (fee,
 * registration fee, Live starts, windows...) live in game-core `usdgMarket.ts` with env
 * overrides (`usdgPolicy()` in @thoroughbred/db); this file is only the chain side.
 *
 *   HORSE_MARKET_ADDRESS   the deployed HorseMarket (packages/contracts deploy:horse-market).
 *                          With WEB3_ENABLED=true and this set, the market runs on-chain.
 *   USDG_TOKEN_ADDRESS     the stablecoin; defaults to Paxos USDG on Robinhood testnet (46630).
 *   USDG_MOCK_PAY          "1" lets a production build without WEB3 run the market on the mock
 *                          chain (payments simulated). Never set it where real players are: a
 *                          simulated payment moves a horse for free. Dev and tests always mock.
 *   Shared with the beta money: WEB3_ENABLED, CHAIN_ID, ROBINHOOD_RPC_URL,
 *   QUOTE_SIGNER_PRIVATE_KEY (signs HorseMarket orders; grant it SIGNER_ROLE),
 *   CHAIN_MIN_CONFIRMATIONS, CHAIN_LOG_LOOKBACK_BLOCKS.
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { BetaConfigError, readBetaConfig } from "./config";

/** Paxos USDG on Robinhood Chain Testnet (verified decimals() = 6 on 2026-10-25). */
export const ROBINHOOD_TESTNET_USDG: Address = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
/** Placeholder addresses for the mock chain (never real contracts). */
export const MOCK_MARKET: Address = "0x00000000000000000000000000000000004d4b54";
export const MOCK_USDG: Address = "0x0000000000000000000000000000000000005d6e";

/** live: real HorseMarket on-chain · mock: simulated payments (dev, tests, opted-in previews) · off: "coming soon". */
export type UsdgMode = "live" | "mock" | "off";

export interface UsdgConfig {
  mode: UsdgMode;
  chainId: number;
  market: Address;
  token: Address;
  rpcUrl: string | null;
  signerKey: Hex | null;
  minConfirmations: number;
  logLookbackBlocks: bigint;
}

type Env = Record<string, string | undefined>;

function addr(env: Env, k: string): Address | null {
  const v = env[k]?.trim();
  if (!v) return null;
  if (!isAddress(v, { strict: false })) throw new BetaConfigError(`${k} is not an address`);
  return getAddress(v);
}

export function readUsdgConfig(env: Env = process.env): UsdgConfig {
  const beta = readBetaConfig(env);
  const market = addr(env, "HORSE_MARKET_ADDRESS");
  const mockPay = ["1", "true"].includes((env.USDG_MOCK_PAY ?? "").trim().toLowerCase());
  const production = (env.NODE_ENV ?? "") === "production";
  let mode: UsdgMode;
  if (beta.enabled) mode = market ? "live" : "off";
  else mode = !production || mockPay ? "mock" : "off";
  const token = addr(env, "USDG_TOKEN_ADDRESS") ?? (beta.chainId === 46630 ? ROBINHOOD_TESTNET_USDG : null);
  const cfg: UsdgConfig = {
    mode,
    // Same chain id in mock mode: wallets sign typed data only for their active chain.
    chainId: beta.chainId,
    market: mode === "live" ? market! : MOCK_MARKET,
    token: mode === "live" ? (token ?? MOCK_USDG) : MOCK_USDG,
    rpcUrl: beta.rpcUrl,
    signerKey: beta.signerKey,
    minConfirmations: beta.minConfirmations,
    logLookbackBlocks: beta.logLookbackBlocks,
  };
  if (mode === "live") {
    const missing = [!cfg.rpcUrl && "ROBINHOOD_RPC_URL", !cfg.signerKey && "QUOTE_SIGNER_PRIVATE_KEY", !token && "USDG_TOKEN_ADDRESS"].filter(Boolean);
    if (missing.length) throw new BetaConfigError(`HORSE_MARKET_ADDRESS is set: the USDG market also needs ${missing.join(", ")}`);
  }
  return cfg;
}
