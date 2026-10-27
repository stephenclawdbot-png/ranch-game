/**
 * The shared founding flow (src/server/founding.ts, used by POST /api/account and wallet
 * sign-in's create): one place for the invite seat, the account + starter horses, and the
 * tester / referral links.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, createDb, ensureReferralCode, schema, type DbHandle } from "@thoroughbred/db";
import { foundStable } from "./founding";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("foundStable", () => {
  it("creates the account, stable, starter horses and today's entries; the token authenticates", async () => {
    const acc = await foundStable(h.db, { stableName: "One Place Stable", silks: SILKS, inviteCode: null, now: T0 });
    expect(acc.stableName).toBe("One Place Stable");
    expect(acc.playtest).toBe(false);
    const session = await authenticate(h.db, acc.token);
    expect(session).toMatchObject({ accountId: acc.accountId });
    const horses = (await h.db.select().from(schema.horses)).filter((x) => x.ownerStableId === acc.stableId);
    expect(horses.length).toBeGreaterThanOrEqual(1);
    expect(horses.every((x) => x.origin === "starter" && x.bound)).toBe(true);
  });

  it("records the referral for the invite code's owner", async () => {
    const inviter = await foundStable(h.db, { stableName: "Inviter Stable", silks: SILKS, inviteCode: null, now: T0 });
    const code = await ensureReferralCode(h.db, inviter.accountId);
    const invited = await foundStable(h.db, { stableName: "Invited Stable", silks: SILKS, inviteCode: code, now: T0 });
    const referral = (await h.db.select().from(schema.referrals)).find((r) => r.accountId === invited.accountId);
    expect(referral?.inviterAccountId).toBe(inviter.accountId);
  });

  it("rejects a bad stable name or colours before consuming anything", async () => {
    await expect(foundStable(h.db, { stableName: "x", silks: SILKS, inviteCode: null, now: T0 })).rejects.toThrow(/Check the stable name/);
    await expect(foundStable(h.db, { stableName: "Fine Name", silks: { pattern: "nope" }, inviteCode: null, now: T0 })).rejects.toThrow(/Check the stable name/);
    expect((await h.db.select().from(schema.stables)).filter((s) => s.name === "Fine Name")).toHaveLength(0);
  });
});