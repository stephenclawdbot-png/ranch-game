/**
 * Sign in with a wallet (SIWE, EIP-4361) — no session needed. Step 1 issues a one-time
 * login-purpose challenge (purpose "login", no account bound yet, 10-minute expiry), and
 * only for a host on the site allowlist (APP_HOSTS + the Vercel URLs; localhost outside
 * production). Step 2 verifies the signature against the address IN THE STORED MESSAGE,
 * checks the message's domain and URI against the same allowlist, consumes the challenge
 * (single use) and then follows the request's intent:
 *
 *  - `signin` (/play, /link): the wallet's stable signs this device in (`replace: true`
 *    needed whenever this browser has any stable); an unknown wallet is never auto-linked,
 *    it can be linked to the current stable (an `intent: "link"` retry) or found a new one
 *    (`{ create: true }`, atomically under a per-wallet lock);
 *  - `link` (the /me button; needs a session): only ever links to the CURRENT stable —
 *    never switches stables, never signs in.
 *
 * EOA signatures always verify; ERC-1271 smart wallets too when the chain has an RPC
 * (EvmBetaChain.verifySignature). Challenge+verify are rate-limited per IP (30/hour, like
 * the device-link limiter), counted in the shared `rate_limits` table so every serverless
 * instance enforces one quota. The IP is never an identity signal; a stable switch is
 * written to the audit log as `account.switch`.
 */
import { randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { SilksSchema } from "@thoroughbred/shared";
import {
  accountForWallet,
  audit,
  clearRateLimits,
  consumeWalletChallenge,
  createDeviceSession,
  createWalletChallenge,
  DomainError,
  ensureAccountWallet,
  linkVerifiedWallet,
  lockWalletTx,
  runTx,
  stableOf,
  type Db,
} from "@thoroughbred/db";
import { betaChain } from "./chain/adapter";
import { ensurePracticeGrant } from "./chain/practice";
import { LOGIN_STATEMENT, siweAddress, siweMessage } from "./chain/wallet";
import { foundStable } from "./founding";
import { playerView } from "./game";
import { errorJson, json } from "./http";
import { trackEvent } from "./playtest";
import { sharedLimiter } from "./rateLimit";
import { setSessionCookie, type Session } from "./session";
import { StableNameSchema } from "@/lib/stableName";

const TTL_MS = 10 * 60_000;

export const WALLET_AUTH_LIMIT = 30;
/** Wallet challenge+verify attempts per IP per sliding hour. */
const authHits = sharedLimiter({ name: "wallet-auth", limit: WALLET_AUTH_LIMIT, windowMs: 3_600_000 });

/** Test hook: forget the counted requests. */
export function resetWalletAuthLimit(database: Db): Promise<number> {
  return clearRateLimits(database, { name: "wallet-auth" });
}

/**
 * Hosts a SIWE challenge may be issued and verified for: APP_HOSTS (comma-separated) plus
 * Vercel's own URLs; `localhost:*` only outside production, for local dev and preview.
 */
export function allowedHost(host: string, env: Record<string, string | undefined>): boolean {
  const h = host.trim().toLowerCase();
  if (env.NODE_ENV !== "production" && (h === "localhost" || /^localhost:\d+$/.test(h))) return true;
  return [env.APP_HOSTS, env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].some((v) =>
    (v ?? "")
      .split(",")
      .some((part) => part.trim().toLowerCase() === h),
  );
}

/** The signed message's domain (line 1) and URI must both point at an allowed host. */
function assertMessageHost(message: string, env: Record<string, string | undefined>): void {
  const domain = message.split("\n")[0]?.split(" wants you to sign in with your Ethereum account:")[0]?.trim() ?? "";
  const uri = (/^URI: (\S+)$/m.exec(message)?.[1] ?? "").trim();
  let uriHost = "";
  try {
    uriHost = new URL(uri).host;
  } catch {
    // unparseable: refused below
  }
  if (!domain || !allowedHost(domain, env) || !uriHost || !allowedHost(uriHost, env)) {
    throw new DomainError("INVALID_INPUT", "That sign-in request came from another site.");
  }
}

/** POST /api/auth/wallet/challenge (works signed out): a one-time SIWE message to sign. */
export async function walletAuthChallengeResponse(
  database: Db,
  input: { address: string; host: string; proto: string; ip: string; now: Date; env?: Record<string, string | undefined> },
) {
  if (await authHits.hit(database, input.ip, input.now.getTime())) {
    const res = errorJson(429, "too_many_tries", { message: "Too many wallet requests. Wait a few minutes, then try again." });
    res.headers.set("Retry-After", "3600");
    return res;
  }
  if (!isAddress(input.address, { strict: false })) throw new DomainError("INVALID_INPUT", "That isn't a wallet address.");
  const env = input.env ?? process.env;
  const host = input.host.replace(/[^A-Za-z0-9.:-]/g, "").slice(0, 120);
  if (!allowedHost(host, env)) throw new DomainError("INVALID_INPUT", "This site can't issue sign-in requests.");
  const nonce = randomBytes(12).toString("hex");
  const expiresAt = new Date(input.now.getTime() + TTL_MS);
  const message = siweMessage({ domain: host, uri: `${input.proto}://${host}`, address: getAddress(input.address), chainId: betaChain().chainId, nonce, issuedAt: input.now, expiresAt, statement: LOGIN_STATEMENT });
  await createWalletChallenge(database, { accountId: null, nonce, message, expiresAt, purpose: "login" });
  return json({ nonce, message, expiresAtMs: expiresAt.getTime() });
}

interface VerifyBody {
  nonce?: unknown;
  signature?: unknown;
  intent?: unknown;
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
  /** Host allowlist source; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * POST /api/auth/wallet/verify (works signed out): verify the signed SIWE message, then
 * follow `intent` — "link" (signed in) links the wallet to THIS stable only; "signin"
 * (default) signs the wallet's stable in, answers `{ needsStable }` for an unknown wallet,
 * and with `{ create: true }` founds the stable and links the wallet in one request.
 */
export async function walletAuthVerifyResponse(database: Db, input: WalletAuthVerifyInput) {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  if (await authHits.hit(database, input.ip, now.getTime())) {
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
  assertMessageHost(message, env);
  if (!(await betaChain().verifySignature(address, message, signature as Hex))) throw new DomainError("INVALID_INPUT", "The signature doesn't match that wallet.");

  if (body.intent === "link") return linkWalletToCurrentStable(database, { address, session: input.session, now });
  return signInWithWallet(database, { address, body, session: input.session, now });
}

/** intent "link" (/me, signed in): the wallet joins THIS stable — no switching, no session. */
async function linkWalletToCurrentStable(database: Db, input: { address: Address; session: Session | null; now: Date }) {
  if (!input.session) return errorJson(403, "signin_required", { message: "Sign in to your stable first." });
  const mine = input.session.accountId;
  const owner = await accountForWallet(database, input.address);
  if (owner && owner !== mine) return errorJson(409, "wallet_in_use", { message: "That wallet already signs in to another stable." });
  if (owner === mine) return json({ linked: true, address: input.address });
  const { tester } = await linkVerifiedWallet(database, { accountId: mine, address: input.address, stableName: input.session.stable.name, now: input.now });
  await ensurePracticeGrant(database, mine, input.now);
  await trackEvent(database, mine, "wallet_linked", { via: "link" });
  return json({ linked: true, address: tester.walletAddress });
}

/** intent "signin" (/play, /link): sign in, answer, or — with { create } — found atomically. */
async function signInWithWallet(database: Db, input: { address: Address; body: VerifyBody; session: Session | null; now: Date }) {
  const { body, session } = input;
  const accountId = await accountForWallet(database, input.address);
  if (accountId) {
    if (session && session.accountId === accountId) return json({ alreadySignedIn: true });
    // Any stable on this browser is left behind: the player confirms, progress or not.
    if (session && body.replace !== true) {
      return errorJson(409, "replace_required", { message: `This browser is signed in as ${session.stable.name}. Signing in with this wallet leaves that stable behind.`, currentStable: session.stable.name });
    }
    // Found via a tester row from before accounts carried the wallet: backfill the link.
    await ensureAccountWallet(database, { accountId, address: input.address, now: input.now });
    // Practice mode: the one-off T-USDG grant on (first) wallet sign-in. Idempotent, never fails a sign-in.
    await ensurePracticeGrant(database, accountId, input.now);
    const { token, stableName } = await createDeviceSession(database, { accountId, label: "Wallet sign-in", now: input.now });
    if (session && session.accountId !== accountId) await noteStableSwitch(database, session.accountId, accountId);
    await trackEvent(database, accountId, "wallet_sign_in", {});
    const stable = await stableOf(database, accountId);
    const res = json({ stableName, player: await playerView(database, { accountId, stable }, input.now) });
    setSessionCookie(res, token);
    return res;
  }

  if (body.create === true) {
    if (session && body.replace !== true) {
      return errorJson(409, "replace_required", { message: `This browser is signed in as ${session.stable.name}. Founding a new stable here leaves that stable behind.`, currentStable: session.stable.name });
    }
    const created = await createWalletStable(database, {
      address: input.address,
      stableName: body.stableName,
      silks: body.silks,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      now: input.now,
    });
    await ensurePracticeGrant(database, created.accountId, input.now);
    if (session && session.accountId !== created.accountId) await noteStableSwitch(database, session.accountId, created.accountId);
    await trackEvent(database, created.accountId, "signup", { playtest: created.playtest, wallet: true });
    await trackEvent(database, created.accountId, "wallet_sign_in", {});
    const res = json({ created: true, stableName: created.stableName, player: await playerView(database, { accountId: created.accountId, stable: created.stable }, input.now) }, { status: 201 });
    setSessionCookie(res, created.token);
    return res;
  }

  // Unknown wallet: never auto-linked. The client offers the current stable (a re-sign with
  // intent "link") or a new one; without a session there's nothing to link to.
  if (session) return json({ needsStable: true, canLinkCurrent: true, currentStable: session.stable.name });
  return json({ needsStable: true });
}

/** A browser changed stables: an audit row, not an identity signal or a fraud event. */
async function noteStableSwitch(database: Db, from: string, to: string): Promise<void> {
  await audit(database, { actor: to, action: "account.switch", entityType: "account", entityId: to, data: { from, to } });
}

/**
 * Founding with a wallet: one stable per wallet, atomically. A per-wallet advisory lock
 * serialises concurrent attempts (two tabs, two devices); under it the wallet is re-checked,
 * then the whole founding — invite seat, account, wallet link — runs in ONE transaction, so
 * any failure (e.g. the wallet got linked elsewhere mid-flight) consumes nothing.
 */
async function createWalletStable(
  database: Db,
  input: { address: Address; stableName: unknown; silks: unknown; timezone?: string; inviteCode: string | null; now: Date },
): Promise<{ accountId: string; token: string; stableName: string; stable: Awaited<ReturnType<typeof stableOf>>; playtest: boolean }> {
  const name = StableNameSchema.safeParse(input.stableName);
  const silks = SilksSchema.safeParse(input.silks);
  if (!name.success || !silks.success) throw new DomainError("INVALID_INPUT", "Check the stable name and colours.");
  const founded = await runTx(database, async (tx) => {
    await lockWalletTx(tx, input.address);
    if (await accountForWallet(tx, input.address)) throw new DomainError("LINKED_ACCOUNTS", "That wallet just founded a stable — sign in with it.");
    const res = await foundStable(tx, { stableName: name.data, silks: silks.data, timezone: input.timezone, inviteCode: input.inviteCode, now: input.now });
    await linkVerifiedWallet(tx, { accountId: res.accountId, address: input.address, stableName: res.stableName, now: input.now });
    const { token, stableName } = await createDeviceSession(tx, { accountId: res.accountId, label: "Wallet sign-in", now: input.now });
    return { ...res, token, stableName, stable: await stableOf(tx, res.accountId) };
  });
  return { accountId: founded.accountId, token: founded.token, stableName: founded.stableName, stable: founded.stable, playtest: founded.playtest };
}