/**
 * Practice identity, server side (testing phase only: USDG_MODE=practice; docs/usdg-market.md
 * "Practice identity"). Server only: never import from a client component.
 *
 * A tester without a verified wallet gets a deterministic EVM key the server holds, so every T-USDG
 * feature works without a wallet and the server signs what their wallet would (auction bids; the
 * player just taps). The key is HMAC-SHA256(LOGIN_CODE_SECRET, "post-time-practice-wallet:<account>")
 * taken as a secp256k1 scalar (rehashed with a counter in the ~2^-128 case that it is 0 or >= n).
 *
 * - The key never leaves this module: callers get the address, or a signature over EIP-712 data.
 *   It is never stored, logged or sent to a client, and the address is never shown to players
 *   (the UI shows the stable name; a linked wallet's address is shown as before).
 * - It exists only while practice mode is on and LOGIN_CODE_SECRET (32+ characters) is set:
 *   otherwise `practiceAddressFor` is null and @thoroughbred/db `marketWalletOf` is exactly
 *   `verifiedWalletOf`.
 * - Real-money paths (affiliates, the Prize Pool, ETH checkout, admin chain routes, beta money
 *   payouts, wallet sign-in / SIWE) use `verifiedWalletOf` and never see this address.
 *
 * Importing this module registers the derivation with @thoroughbred/db (server/db.ts imports it, so
 * every route that touches the database has it).
 */
import { createHmac } from "node:crypto";
import type { Address, Hex, TypedData, TypedDataDefinition } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { setPracticeAddressResolver } from "@thoroughbred/db";
import { isUsdgPracticeMode } from "@thoroughbred/game-core";

type Env = Record<string, string | undefined>;

/** The secp256k1 group order: a private key is an integer in [1, n - 1]. */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const LABEL = "post-time-practice-wallet";

function secret(env: Env): string | null {
  const s = env.LOGIN_CODE_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

/** Whether practice identities exist right now (practice mode + the server secret). */
export function practiceIdentityEnabled(env: Env = process.env): boolean {
  return isUsdgPracticeMode(env) && secret(env) !== null;
}

/** The scalar for an account (deterministic; domain-separated from the login code's HMAC). */
function practiceKey(key: string, accountId: string): Hex {
  for (let i = 0; ; i++) {
    const msg = i === 0 ? `${LABEL}:${accountId}` : `${LABEL}:${accountId}:${i}`;
    const k = BigInt(`0x${createHmac("sha256", key).update(msg).digest("hex")}`);
    if (k > 0n && k < SECP256K1_N) return `0x${k.toString(16).padStart(64, "0")}`;
  }
}

// Deriving the public key costs a scalar multiplication: keep recent accounts (bounded).
const CACHE_MAX = 2_000;
const cache = new Map<string, PrivateKeyAccount>();

/** The account's practice signer, or null when practice identities are off. Module-private on purpose. */
function practiceSigner(accountId: string, env: Env): PrivateKeyAccount | null {
  const key = secret(env);
  if (!key || !isUsdgPracticeMode(env) || !accountId) return null;
  // The cache key binds the secret (hashed), so a rotated secret never serves a stale signer.
  const ck = `${createHmac("sha256", key).update("cache").digest("hex").slice(0, 16)}:${accountId}`;
  let acct = cache.get(ck);
  if (!acct) {
    acct = privateKeyToAccount(practiceKey(key, accountId));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(ck, acct);
  }
  return acct;
}

/** The account's practice address (checksummed), or null outside practice mode / without the secret. Never show it to players. */
export function practiceAddressFor(accountId: string, env: Env = process.env): Address | null {
  return practiceSigner(accountId, env)?.address ?? null;
}

/**
 * Signs EIP-712 data as the account's practice identity (what its wallet would sign: an auction bid).
 * Refused outside practice mode or without the secret. Returns the signature and the signing address.
 */
export async function signTypedDataAsPractice<const T extends TypedData | Record<string, unknown>, P extends keyof T | "EIP712Domain" = keyof T>(
  accountId: string,
  data: TypedDataDefinition<T, P>,
  env: Env = process.env,
): Promise<{ address: Address; signature: Hex }> {
  const signer = practiceSigner(accountId, env);
  if (!signer) throw new Error("practice identities are off (USDG_MODE=practice and LOGIN_CODE_SECRET are required)");
  return { address: signer.address, signature: await signer.signTypedData(data) };
}

setPracticeAddressResolver((accountId, env) => practiceAddressFor(accountId, env));
