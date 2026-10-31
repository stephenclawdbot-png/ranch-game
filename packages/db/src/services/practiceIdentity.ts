/**
 * Practice identity (testing phase only; docs/usdg-market.md "Practice mode", "Practice identity").
 *
 * While `USDG_MODE=practice`, an account without a verified wallet still gets a market identity:
 * a deterministic EVM address whose key only the server holds (derived in apps/web
 * `server/chain/practiceIdentity.ts` from the account id and LOGIN_CODE_SECRET, then registered
 * here with `setPracticeAddressResolver`; this package has no secp256k1). So every T-USDG feature
 * (the grant, the market and auctions, packs, stud fees, the tote) works without a wallet, and the
 * server signs what a wallet would (auction bids).
 *
 * - `marketWalletOf` is THE helper for T-USDG call sites: the real verified wallet when linked,
 *   else the practice address (practice mode only). Outside practice mode, or without the secret,
 *   it is exactly `verifiedWalletOf` (the practice identity does not exist).
 * - Real-money and real-chain paths (affiliates, the Prize Pool, ETH checkout, admin chain routes,
 *   beta money payouts, wallet sign-in / `accountForWallet`, SIWE) keep `verifiedWalletOf` and never
 *   see a practice address. An order for a real chain (`chain.market` not the practice market) is
 *   always written with `verifiedWalletOf` (`orderWalletOf`).
 * - Linking a real wallet later (the rule): money is per ACCOUNT (the T-USDG ledger account and the
 *   grant's idempotency key `usdg-practice:grant:<account>`), so a link changes no balance and gives
 *   no second grant. New listings, bids and orders use the real wallet. Rows made earlier under the
 *   practice address stay valid: the practice address is permanently the account's own (derived
 *   from its id, nobody else can sign for it), and `holdsMarketAddress` accepts either identity
 *   while practice mode is on (an open auction bid is still offered to its bidder at the close).
 *   Practice payments go account to account in the ledger, so the address on a practice row never
 *   decides where money goes. Once practice mode is off the practice identity is gone: practice
 *   rows can't be paid with real money (real orders need the seller's and bidder's current verified
 *   wallet), and the end-of-beta reset deletes them.
 */
import { gc } from "../gameCore";
import type { Executor } from "../types";
import { verifiedWalletOf } from "./betaMoney";
import { EVM_ADDRESS_RE } from "./playtest";

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== "undefined" ? process.env : {});
const lower = (a: string) => a.trim().toLowerCase();

/** Placeholder "market" written on practice orders (never a real contract; lowercase like stored orders). */
export const USDG_PRACTICE_MARKET = "0x0000000000000000000000000000000000007e57";

/** Maps an account to its practice address (checksummed), or null when the server can't derive one (no secret). */
export type PracticeAddressResolver = (accountId: string, env: Env) => string | null;

// On globalThis so every bundle / module instance of this package sees the one registered resolver.
const G = globalThis as typeof globalThis & { __tbPracticeAddressResolver?: PracticeAddressResolver | null };

/** Registers how practice addresses are derived (apps/web does this on import; tests may too). null unregisters. */
export function setPracticeAddressResolver(fn: PracticeAddressResolver | null): void {
  G.__tbPracticeAddressResolver = fn;
}

/**
 * The account's practice address, or null: outside practice mode (USDG_MODE=practice exactly), with
 * no resolver registered, or when the resolver can't derive one. Never a real wallet.
 */
export function practiceAddressOf(accountId: string, env: Env = processEnv()): string | null {
  if (!gc.isUsdgPracticeMode(env)) return null;
  const fn = G.__tbPracticeAddressResolver;
  if (!fn) return null;
  const a = fn(accountId, env);
  return a && EVM_ADDRESS_RE.test(a) ? a : null;
}

/** True when `address` is this account's practice address (practice mode only). */
export function isPracticeAddressOf(accountId: string, address: string | null | undefined, env: Env = processEnv()): boolean {
  if (!address) return false;
  const p = practiceAddressOf(accountId, env);
  return !!p && lower(p) === lower(address);
}

export type MarketIdentity = { kind: "wallet"; address: string } | { kind: "practice"; address: string };

/** Who the account trades as on the T-USDG market: its verified wallet, else (practice mode) its practice address. */
export async function marketIdentityOf(ex: Executor, accountId: string, env: Env = processEnv()): Promise<MarketIdentity | null> {
  const wallet = await verifiedWalletOf(ex, accountId);
  if (wallet) return { kind: "wallet", address: wallet };
  const p = practiceAddressOf(accountId, env);
  return p ? { kind: "practice", address: p } : null;
}

/**
 * The market wallet for T-USDG features: the verified wallet when linked, else the practice address
 * (practice mode only). Outside practice mode this is exactly `verifiedWalletOf`. Never use it on a
 * real-money or real-chain path.
 */
export async function marketWalletOf(ex: Executor, accountId: string, env: Env = processEnv()): Promise<string | null> {
  return (await marketIdentityOf(ex, accountId, env))?.address ?? null;
}

/**
 * Whether `address` is one of the account's market identities: its verified wallet, or (practice
 * mode only) its practice address. Rows made before a wallet link stay the account's own.
 */
export async function holdsMarketAddress(ex: Executor, accountId: string, address: string, env: Env = processEnv()): Promise<boolean> {
  const wallet = await verifiedWalletOf(ex, accountId);
  if (wallet && lower(wallet) === lower(address)) return true;
  return isPracticeAddressOf(accountId, address, env);
}

/** A practice order's chain reference (the placeholder market): only those may carry a practice address. */
export function isPracticeMarket(market: string): boolean {
  return lower(market) === USDG_PRACTICE_MARKET;
}

/**
 * The wallet written on an order: for a practice order the market wallet (practice address allowed),
 * for a real-chain order ONLY the verified wallet (a practice address never reaches a real order).
 */
export async function orderWalletOf(ex: Executor, accountId: string, market: string, env: Env = processEnv()): Promise<string | null> {
  return isPracticeMarket(market) ? marketWalletOf(ex, accountId, env) : verifiedWalletOf(ex, accountId);
}
