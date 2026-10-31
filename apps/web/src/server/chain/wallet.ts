/**
 * Wallet linking with Sign-In with Ethereum (EIP-4361). The server issues a one-time message
 * (nonce, domain, chain, 10-minute expiry); the wallet signs it; the server checks the
 * signature against the address in the STORED message and saves a verified link on the
 * tester row (one wallet per account, one account per wallet). Signing is free: no
 * transaction, no gas.
 */
import { randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { consumeWalletChallenge, createWalletChallenge, linkVerifiedWallet, loginWalletOf, testerOfAccount, type Db } from "@thoroughbred/db";
import { DomainError } from "@thoroughbred/db";
import type { BetaChain } from "./adapter";
import { ensurePracticeGrant, practiceOn } from "./practice";
import type { Session } from "../session";

const TTL_MS = 10 * 60_000;

/** SIWE statement for linking a payout wallet (signed in on /me). */
export const LINK_STATEMENT = "Link this wallet to my Post Time stable. One wallet per stable; it receives Prize Pool payouts and affiliate commissions. Signing is free and sends no transaction.";
/** Practice mode (T-USDG test money): nothing is paid to the wallet, so the statement says so. */
export const PRACTICE_LINK_STATEMENT = "Link this wallet to my Post Time stable. One wallet per stable. During the beta it only signs: T-USDG is test money, nothing is paid or charged. Signing is free and sends no transaction.";
/** SIWE statement for wallet sign-in (no session): different wording, so a link signature can never be replayed as a sign-in. */
export const LOGIN_STATEMENT = "Sign in to Post Time with this wallet. Signing is free and sends no transaction.";

export function siweMessage(input: { domain: string; uri: string; address: Address; chainId: number; nonce: string; issuedAt: Date; expiresAt: Date; statement?: string }): string {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    input.statement ?? (practiceOn() ? PRACTICE_LINK_STATEMENT : LINK_STATEMENT),
    "",
    `URI: ${input.uri}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

/** Pulls the signed address out of an EIP-4361 message (line 2). */
export function siweAddress(message: string): Address | null {
  const line = message.split("\n")[1]?.trim() ?? "";
  return isAddress(line, { strict: false }) ? getAddress(line) : null;
}

export async function walletChallenge(db: Db, session: Session, input: { address: string; host: string; proto: string; chainId: number; now: Date }) {
  if (!isAddress(input.address, { strict: false })) throw new DomainError("INVALID_INPUT", "That isn't a wallet address.");
  const host = input.host.replace(/[^A-Za-z0-9.:-]/g, "").slice(0, 120) || "thoroughbred";
  const nonce = randomBytes(12).toString("hex");
  const expiresAt = new Date(input.now.getTime() + TTL_MS);
  const message = siweMessage({ domain: host, uri: `${input.proto}://${host}`, address: getAddress(input.address), chainId: input.chainId, nonce, issuedAt: input.now, expiresAt });
  await createWalletChallenge(db, { accountId: session.accountId, nonce, message, expiresAt });
  return { nonce, message, expiresAtMs: expiresAt.getTime() };
}

export async function linkWallet(db: Db, chain: BetaChain, session: Session, input: { nonce: string; signature: Hex; now: Date }) {
  const message = await consumeWalletChallenge(db, { accountId: session.accountId, nonce: input.nonce, now: input.now });
  const address = siweAddress(message);
  if (!address) throw new DomainError("INVALID_INPUT", "Malformed sign-in message.");
  if (!(await chain.verifySignature(address, message, input.signature))) throw new DomainError("INVALID_INPUT", "The signature doesn't match that wallet.");
  const { tester, linkedAccounts } = await linkVerifiedWallet(db, { accountId: session.accountId, address, stableName: session.stable.name, now: input.now });
  // Practice mode: the one-off T-USDG grant (idempotent; never fails the link).
  await ensurePracticeGrant(db, session.accountId, input.now);
  return { address: tester.walletAddress!, verifiedAtMs: tester.walletVerifiedAt!.getTime(), linkedAccounts: linkedAccounts.length };
}

export async function walletStatus(db: Db, session: Session) {
  const t = await testerOfAccount(db, session.accountId);
  return {
    address: t?.walletVerifiedAt ? t.walletAddress : null,
    verifiedAtMs: t?.walletVerifiedAt?.getTime() ?? null,
    /** An address saved earlier without a signature (old /beta form): must be re-linked by signing. */
    unverifiedAddress: t?.walletAddress && !t.walletVerifiedAt ? t.walletAddress : null,
    /** The sign-in wallet on the account itself (accounts.wallet_address): sign in on other devices with it. */
    loginAddress: await loginWalletOf(db, session.accountId),
  };
}
