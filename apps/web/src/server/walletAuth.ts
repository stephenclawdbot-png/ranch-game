/**
 * Sign in with a wallet (SIWE, EIP-4361) — no session needed. Step 1 issues a one-time
 * login-purpose challenge (purpose "login", no account bound yet, 10-minute expiry); step 2
 * verifies the signature against the address IN THE STORED MESSAGE, consumes the challenge
 * (single use) and then either signs this device in (a device session + cookie), links the
 * wallet to this browser's stable, or reports that the wallet has no stable yet ({ create }
 * founds one in the same request). Signing is free: no transaction, no gas.
 *
 * EOA signatures always verify; ERC-1271 smart wallets too when the chain has an RPC
 * (EvmBetaChain.verifySignature). Challenge+verify are rate-limited per IP (30/hour, like
 * the device-link limiter).
 */
import { randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  accountForWallet,
  consumeWalletChallenge,
  createAccount,
  createDeviceSession,
  createWalletChallenge,
  DomainError,
  ensureAccountWallet,
  linkTester,
  linkVerifiedWallet,
  recordAccountSignal,
  recordReferral,
  redeemInvite,
  stableHasProgress,
  stableOf,
  type Db,
} from "@thoroughbred/db";
import { SilksSchema } from "@thoroughbred/shared";
import { z } from "zod";
import { betaChain } from "./chain/adapter";
import { LOGIN_STATEMENT, siweAddress, siweMessage } from "./chain/wallet";
import { playerView } from "./game";
import { errorJson, json } from "./http";
import { playtestConfig, trackEvent } from "./playtest";
import { setSessionCookie, type Session } from "./session";
import { StableNameSchema } from "@/lib/stableName";

const TTL_MS = 10 * 60_000;

export const WALLET_AUTH_LIMIT = 30;
const HOUR_MS = 3_600_000;
/** Process-local request timestamps per IP (sliding hour); serverless instances are interchangeable. */
const authHits = new Map<string, number[]>();

/** Test hook: forget the counted requests. */
export function resetWalletAuthLimit(): void {
  authHits.clear();
}

/** Counts one request; true when the IP is over the limit and must be answered 429. */
function noteWalletAuthHit(ip: string, now: number): boolean {
  const fresh = (authHits.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
  fresh.push(now);
  authHits.set(ip, fresh);
  return fresh.length > WALLET_AUTH_LIMIT;
}

/** POST /api/auth/wallet/challenge (works signed out): a one-time SIWE message to sign. */
export async function walletAuthChallengeResponse(database: Db, input: { address: string; host: string; proto: string; ip: string; now: Date }) {
  if (noteWalletAuthHit(input.ip, input.now.getTime())) {
    const res = errorJson(429, "too_many_tries", { message: "Too many wallet requests. Wait a few minutes, then try again." });
    res.headers.set("Retry-After", "3600");
    return res;
  }
  if (!isAddress(input.address, { strict: false })) throw new DomainError("INVALID_INPUT", "That isn't a wallet address.");
  const host = input.host.replace(/[^A-Za-z0-9.:-]/g, "").slice(0, 120) || "thoroughbred";
  const nonce = randomBytes(12).toString("hex");
  const expiresAt = new Date(input.now.getTime() + TTL_MS);
  const message = siweMessage({ domain: host, uri: `${input.proto}://${host}`, address: getAddress(input.address), chainId: betaChain().chainId, nonce, issuedAt: input.now, expiresAt, statement: LOGIN_STATEMENT });
  await createWalletChallenge(database, { accountId: null, nonce, message, expiresAt, purpose: "login" });
  return json({ nonce, message, expiresAtMs: expiresAt.getTime() });
}

interface VerifyBody {
  nonce?: unknown;
  signature?: unknown;
  replace?: unknown;
  create?: unknown;
  stableName?: unknown;
  silks?: unknown;
  timezone?: unknown;
  inviteCode?: unknown;
}

export interface WalletAuthVerifyInput {
  body: unknown;
  ip: string;
  /** The stable this browser already has, if any. */
  session: Session | null;
  now?: Date;
}

/**
 * POST /api/auth/wallet/verify (works signed out): verify the signed SIWE message, then
 *  - the wallet belongs to a stable → a device session + cookie for it ({ replace: true }
 *    needed when this browser's own stable is in play);
 *  - the wallet is unknown but this browser has a stable → link it to that stable;
 *  - unknown and no stable → { needsStable: true }; { create: true } founds the stable in
 *    the same request and links the wallet to it.
 */
export async function walletAuthVerifyResponse(database: Db, input: WalletAuthVerifyInput) {
  const now = input.now ?? new Date();
  if (noteWalletAuthHit(input.ip, now.getTime())) {
    const res = errorJson(429, "too_many_tries", { message: "Too many wallet requests. Wait a few minutes, then try again." });
    res.headers.set("Retry-After", "3600");
    return res;
  }
  const body = (input.body ?? {}) as VerifyBody;
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!/^[A-Za-z0-9]{8,64}$/.test(nonce) || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 4000) {
    throw new DomainError("INVALID_INPUT", "The signature is missing.");
  }
  // Single use: the conditional UPDATE inside refuses a second try, expired or replayed.
  const message = await consumeWalletChallenge(database, { accountId: null, nonce, now, purpose: "login" });
  const address = siweAddress(message);
  if (!address) throw new DomainError("INVALID_INPUT", "Malformed sign-in message.");
  if (!(await betaChain().verifySignature(address, message, signature as Hex))) throw new DomainError("INVALID_INPUT", "The signature doesn't match that wallet.");

  const accountId = await accountForWallet(database, address);
  if (accountId) {
    // Signing in as that stable; a browser whose own stable is in play must confirm the switch.
    if (input.session && input.session.accountId !== accountId && body.replace !== true && (await stableHasProgress(database, input.session.accountId))) {
      return errorJson(409, "replace_required", { message: "This browser already has a stable with races or horses. Signing in with this wallet leaves that stable behind." });
    }
    // Found via a tester row from before accounts carried the wallet: backfill the link.
    await ensureAccountWallet(database, { accountId, address, now });
    const { token, stableName } = await createDeviceSession(database, { accountId, label: "Wallet sign-in", now });
    await recordAccountSignal(database, { accountId, kind: "device", value: input.ip });
    if (input.session && input.session.accountId !== accountId) {
      await recordAccountSignal(database, { accountId: input.session.accountId, kind: "device", value: input.ip });
    }
    await trackEvent(database, accountId, "wallet_sign_in", {});
    const stable = await stableOf(database, accountId);
    const res = json({ stableName, player: await playerView(database, { accountId, stable }, now) });
    setSessionCookie(res, token);
    return res;
  }

  if (input.session) {
    // Unknown wallet on a browser that has a stable: same free signature links it there
    // (payouts and sign-in, one wallet per stable).
    const { tester } = await linkVerifiedWallet(database, { accountId: input.session.accountId, address, stableName: input.session.stable.name, now });
    await trackEvent(database, input.session.accountId, "wallet_linked", { via: "sign_in" });
    return json({ linked: true, address: tester.walletAddress });
  }

  if (body.create === true) {
    const created = await createWalletStable(database, {
      address,
      stableName: body.stableName,
      silks: body.silks,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      now,
    });
    await recordAccountSignal(database, { accountId: created.accountId, kind: "device", value: input.ip });
    await trackEvent(database, created.accountId, "wallet_sign_in", {});
    const res = json({ created: true, stableName: created.stableName, player: await playerView(database, { accountId: created.accountId, stable: created.stable }, now) }, { status: 201 });
    setSessionCookie(res, created.token);
    return res;
  }

  return json({ needsStable: true });
}

/** The same founding flow POST /api/account uses, plus the wallet link — one transaction each. */
async function createWalletStable(
  database: Db,
  input: { address: Address; stableName: unknown; silks: unknown; timezone?: string; inviteCode: string | null; now: Date },
): Promise<{ accountId: string; token: string; stableName: string; stable: Awaited<ReturnType<typeof stableOf>> }> {
  const name = StableNameSchema.safeParse(input.stableName);
  const silks = SilksSchema.safeParse(input.silks);
  if (!name.success || !silks.success) throw new DomainError("INVALID_INPUT", "Check the stable name and colours.");
  // Closed playtest: reserve a tester for the invite code first (same as /api/account).
  const playtest = playtestConfig();
  let testerId: string | null = null;
  if (playtest.enabled) {
    if (!input.inviteCode?.trim()) throw new DomainError("NOT_ELIGIBLE", "The playtest is invite only. Enter your invite code.");
    testerId = (await redeemInvite(database, { code: input.inviteCode, cap: playtest.testerCap, now: input.now })).testerId;
  }
  const acc = await createAccount(database, { stableName: name.data, silks: silks.data, timezone: input.timezone, now: input.now });
  if (testerId) await linkTester(database, { testerId, accountId: acc.accountId, stableName: name.data, now: input.now });
  if (input.inviteCode?.trim()) {
    try {
      await recordReferral(database, { accountId: acc.accountId, code: input.inviteCode, now: input.now });
    } catch (err) {
      console.error("referral", err);
    }
  }
  await linkVerifiedWallet(database, { accountId: acc.accountId, address: input.address, stableName: name.data, now: input.now });
  await trackEvent(database, acc.accountId, "signup", { playtest: playtest.enabled, wallet: true });
  const { token, stableName } = await createDeviceSession(database, { accountId: acc.accountId, label: "Wallet sign-in", now: input.now });
  return { accountId: acc.accountId, token, stableName, stable: await stableOf(database, acc.accountId) };
}