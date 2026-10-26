/**
 * Device linking: playing the same stable on another browser or phone with a one-time
 * code (no email, no passwords). The other device redeems the code, gets its own device
 * token (only the hash is stored, like accounts.token_hash) and is recorded in
 * account_devices. Codes live 10 minutes, work once, and are stored hashed.
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { hashToken, newDeviceToken } from "../crypto";
import { DomainError } from "../errors";
import { accountDevices, accounts, horses, linkCodes, raceEntries, type StableRow } from "../schema";
import type { Db } from "../types";
import { stableOf } from "./accounts";
import { audit, runTx } from "./tx";

export const LINK_CODE_TTL_MS = 10 * 60_000;
/** No 0/O/1/I/L: codes are read aloud and typed on phones (same alphabet as invite codes). */
const LINK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export interface LinkCode {
  /** Raw code, shown once as XXXX-XXXX; only its hash is stored. */
  code: string;
  expiresAt: Date;
}

export interface LinkedDevice {
  /** Raw device token for the httpOnly cookie. Shown once; only its hash is stored. */
  token: string;
  accountId: string;
  stableName: string;
}

export interface DeviceEntry {
  id: string;
  label: string;
  createdAtMs: number;
  lastSeenAtMs: number;
  /** The device making the request. */
  current: boolean;
}

function newLinkCode(): string {
  // randomInt is uniform (a byte % 31 would favour the first 8 characters).
  let out = "";
  for (let i = 0; i < 8; i++) out += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Case- and dash-insensitive normal form "XXXX-XXXX", or null when it can't be a code. */
export function normalizeLinkCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 8 || [...c].some((ch) => !LINK_ALPHABET.includes(ch))) return null;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Creates a fresh one-time code and expires the account's previous unused ones. */
export async function createLinkCode(db: Db, input: { accountId: string; now?: Date }): Promise<LinkCode> {
  const now = input.now ?? new Date();
  const code = newLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await runTx(db, async (tx) => {
    await tx
      .update(linkCodes)
      .set({ expiresAt: now })
      .where(and(eq(linkCodes.accountId, input.accountId), isNull(linkCodes.usedAt), gt(linkCodes.expiresAt, now)));
    await tx.insert(linkCodes).values({ codeHash: hashToken(code), accountId: input.accountId, createdAt: now, expiresAt });
    await audit(tx, { actor: input.accountId, action: "account.link_code", entityType: "account", entityId: input.accountId });
  });
  return { code, expiresAt };
}

/**
 * Redeems a link code in one transaction: exactly one device can win, because the code is
 * marked used by a conditional UPDATE (`used_at is null` and still fresh) — under READ
 * COMMITTED the losing transaction re-checks the committed row and matches nothing, so the
 * row lock alone is not load-bearing. Null for every failure (unknown, expired, used):
 * callers answer with the same generic wording either way.
 */
export async function redeemLinkCode(db: Db, input: { code: string; label?: string | null; now?: Date }): Promise<LinkedDevice | null> {
  const normalized = normalizeLinkCode(input.code);
  if (!normalized) return null;
  const now = input.now ?? new Date();
  const label = input.label?.trim().slice(0, 40) || null;
  return runTx(db, async (tx) => {
    const hash = hashToken(normalized);
    const used = await tx
      .update(linkCodes)
      .set({ usedAt: now })
      .where(and(eq(linkCodes.codeHash, hash), isNull(linkCodes.usedAt), gt(linkCodes.expiresAt, now)))
      .returning({ accountId: linkCodes.accountId });
    if (!used.length) {
      // Known but expired or already used: count the attempt for review.
      const [row] = await tx.select().from(linkCodes).where(eq(linkCodes.codeHash, hash)).for("update");
      if (row) await tx.update(linkCodes).set({ attempts: row.attempts + 1 }).where(eq(linkCodes.codeHash, hash));
      return null;
    }
    const accountId = used[0]!.accountId;
    const token = newDeviceToken();
    await tx.insert(accountDevices).values({ accountId, tokenHash: hashToken(token), label, createdAt: now, lastSeenAt: now });
    await audit(tx, { actor: accountId, action: "account.link_device", entityType: "account", entityId: accountId, data: { label } });
    const stable = await stableOf(tx, accountId);
    return { token, accountId, stableName: stable.name };
  });
}

/** The account's linked devices; `currentTokenHash` marks the requesting device. `original`: the request came from the browser that founded the stable (not in the list). */
export async function listDevices(db: Db, accountId: string, currentTokenHash: string): Promise<{ devices: DeviceEntry[]; original: boolean }> {
  const [account] = await db.select({ tokenHash: accounts.tokenHash }).from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new DomainError("NOT_FOUND", "account not found");
  const rows = await db.select().from(accountDevices).where(eq(accountDevices.accountId, accountId)).orderBy(desc(accountDevices.createdAt));
  return {
    original: account.tokenHash === currentTokenHash,
    devices: rows.map((d) => ({
      id: d.id,
      label: d.label ?? "Device",
      createdAtMs: d.createdAt.getTime(),
      lastSeenAtMs: d.lastSeenAt.getTime(),
      current: d.tokenHash === currentTokenHash,
    })),
  };
}

/** Removes a linked device: its token stops authenticating on the next request. */
export async function revokeDevice(db: Db, input: { accountId: string; deviceId: string }): Promise<void> {
  await runTx(db, async (tx) => {
    const gone = await tx
      .delete(accountDevices)
      .where(and(eq(accountDevices.id, input.deviceId), eq(accountDevices.accountId, input.accountId)))
      .returning({ id: accountDevices.id });
    if (!gone.length) throw new DomainError("NOT_FOUND", "device not found");
    await audit(tx, { actor: input.accountId, action: "account.revoke_device", entityType: "account_device", entityId: input.deviceId });
  });
}

/**
 * True once the stable has entered races or owns horses beyond the starters (bought, bred,
 * gifted): those browsers don't switch accounts without the explicit replace confirmation.
 */
export async function stableHasProgress(db: Db, accountId: string): Promise<boolean> {
  const stable: StableRow = await stableOf(db, accountId);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(raceEntries).where(eq(raceEntries.stableId, stable.id));
  const [h] = await db.select({ n: sql<number>`count(*)::int` }).from(horses).where(and(eq(horses.ownerStableId, stable.id), ne(horses.origin, "starter")));
  return Number(r?.n ?? 0) + Number(h?.n ?? 0) > 0;
}