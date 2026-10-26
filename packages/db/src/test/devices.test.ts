import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { hashToken } from "../crypto";
import { accountDevices, linkCodes, stables } from "../schema";
import { authenticate } from "../services/accounts";
import { createLinkCode, listDevices, normalizeLinkCode, redeemLinkCode, revokeDevice, stableHasProgress } from "../services/devices";
import { memoryDb, newPlayer, makeHorse, settledAll, count, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const HOUR = 3_600_000;
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

describe("link codes", () => {
  it("creates a code from the unambiguous alphabet, valid 10 minutes, stored only as a hash", async () => {
    const p = await newPlayer(h.db);
    const { code, expiresAt } = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    expect(code).toMatch(CODE_RE);
    expect(expiresAt.getTime()).toBe(T0.getTime() + 10 * 60_000);
    const [row] = await h.db.select().from(linkCodes).where(eq(linkCodes.accountId, p.accountId));
    expect(row!.codeHash).toBe(hashToken(code));
    expect(row!.codeHash).not.toContain(code);
  });

  it("redeems once, links the device (hashed token) and names the stable", async () => {
    const p = await newPlayer(h.db, { starters: 0 });
    const { code } = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    const linked = await redeemLinkCode(h.db, { code: ` ${code.toLowerCase()} `, label: "iPhone · Safari  ", now: T0 });
    const [stable] = await h.db.select().from(stables).where(eq(stables.accountId, p.accountId));
    expect(linked!.accountId).toBe(p.accountId);
    expect(linked!.stableName).toBe(stable!.name);
    const [device] = await h.db.select().from(accountDevices).where(eq(accountDevices.accountId, p.accountId));
    expect(device!.tokenHash).toBe(hashToken(linked!.token));
    expect(device!.tokenHash).not.toContain(linked!.token);
    expect(device!.label).toBe("iPhone · Safari");
    expect(await authenticate(h.db, linked!.token)).toMatchObject({ accountId: p.accountId });
    // Single use: the second device gets nothing, and the attempt is counted.
    const second = await redeemLinkCode(h.db, { code, now: T0 });
    expect(second).toBeNull();
    const [row] = await h.db.select().from(linkCodes).where(eq(linkCodes.codeHash, hashToken(code)));
    expect(row!.usedAt).not.toBeNull();
    expect(row!.attempts).toBe(1);
  });

  it("dies after 10 minutes", async () => {
    const p = await newPlayer(h.db);
    const { code } = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    expect(await redeemLinkCode(h.db, { code, now: new Date(T0.getTime() + 10 * 60_000 + 1) })).toBeNull();
  });

  it("creating a new code expires the account's previous unused ones", async () => {
    const p = await newPlayer(h.db);
    const first = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    const second = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    expect(await redeemLinkCode(h.db, { code: first.code, now: T0 })).toBeNull();
    expect(await redeemLinkCode(h.db, { code: second.code, now: T0 })).not.toBeNull();
  });

  it("two devices racing one code: exactly one wins", async () => {
    const p = await newPlayer(h.db);
    const { code } = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    const { ok, errors } = await settledAll([redeemLinkCode(h.db, { code, now: T0 }), redeemLinkCode(h.db, { code, now: T0 })]);
    // The loser either sees the code used (null) or fails cleanly; what must never happen
    // is both devices linking.
    expect(ok.length + errors.length).toBe(2);
    expect(ok.filter(Boolean)).toHaveLength(1);
    expect(await count(h.db, "account_devices", `account_id = '${p.accountId}'`)).toBe(1);
  });

  it("rejects anything that isn't an 8-character code from the alphabet", async () => {
    expect(normalizeLinkCode("abcd-0o1i")).toBeNull(); // 0/O/1/I are not in the alphabet
    expect(normalizeLinkCode("ab2d-ef4h-i")).toBeNull();
    expect(normalizeLinkCode("  ab2d ef4h ")).toBe("AB2D-EF4H");
    expect(await redeemLinkCode(h.db, { code: "nope", now: T0 })).toBeNull();
  });
});

describe("linked devices", () => {
  it("authenticate works through a linked device token and throttles last_seen to hourly", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
    const p = await newPlayer(h.db, { now: twoHoursAgo });
    const { code } = await createLinkCode(h.db, { accountId: p.accountId, now: twoHoursAgo });
    const linked = (await redeemLinkCode(h.db, { code, now: twoHoursAgo }))!;
    const [before] = await h.db.select().from(accountDevices).where(eq(accountDevices.accountId, p.accountId));
    expect(await authenticate(h.db, linked.token)).toMatchObject({ accountId: p.accountId });
    const [after] = await h.db.select().from(accountDevices).where(eq(accountDevices.accountId, p.accountId));
    expect(after!.lastSeenAt.getTime()).toBeGreaterThan(before!.lastSeenAt.getTime());
    // Within the hour the write is skipped.
    const again = await authenticate(h.db, linked.token);
    expect(again!.accountId).toBe(p.accountId);
    const [steady] = await h.db.select().from(accountDevices).where(eq(accountDevices.accountId, p.accountId));
    expect(steady!.lastSeenAt.getTime()).toBe(after!.lastSeenAt.getTime());
    expect(await authenticate(h.db, "not-a-token")).toBeNull();
  });

  it("lists devices with the requesting one marked, and revoking stops that token", async () => {
    const p = await newPlayer(h.db);
    const { code } = await createLinkCode(h.db, { accountId: p.accountId, now: T0 });
    const linked = (await redeemLinkCode(h.db, { code, label: "Spare phone", now: T0 }))!;
    const mine = await listDevices(h.db, p.accountId, hashToken(linked.token));
    expect(mine.original).toBe(false);
    expect(mine.devices).toHaveLength(1);
    expect(mine.devices[0]).toMatchObject({ label: "Spare phone", current: true });
    const fromHome = await listDevices(h.db, p.accountId, hashToken(p.token));
    expect(fromHome.original).toBe(true);
    expect(fromHome.devices[0]!.current).toBe(false);

    await revokeDevice(h.db, { accountId: p.accountId, deviceId: mine.devices[0]!.id });
    expect(await authenticate(h.db, linked.token)).toBeNull();
    expect(await authenticate(h.db, p.token)).toMatchObject({ accountId: p.accountId }); // the original token can't be revoked this way
    // Someone else's device is not ours to revoke.
    const q = await newPlayer(h.db);
    const qCode = await createLinkCode(h.db, { accountId: q.accountId, now: T0 });
    const qLinked = (await redeemLinkCode(h.db, { code: qCode.code, now: T0 }))!;
    const qDevice = (await listDevices(h.db, q.accountId, hashToken(qLinked.token))).devices[0]!;
    await expect(revokeDevice(h.db, { accountId: p.accountId, deviceId: qDevice.id })).rejects.toThrow();
    expect(await authenticate(h.db, qLinked.token)).toMatchObject({ accountId: q.accountId });
  });
});

describe("the replace guard", () => {
  it("a fresh starter stable has no progress; races or bought horses do", async () => {
    const fresh = await newPlayer(h.db, { starters: 3 });
    expect(await stableHasProgress(h.db, fresh.accountId)).toBe(false);
    const buyer = await newPlayer(h.db, { starters: 0 });
    await makeHorse(h.db, buyer.stableId, { origin: "admin" });
    expect(await stableHasProgress(h.db, buyer.accountId)).toBe(true);
  });
});