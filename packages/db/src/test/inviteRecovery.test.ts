/**
 * Testing phase: the invite link as a way back in (inviteRecoveryAccount, checkInvite's
 * `recovery` option). Only a used single-use admin code whose one tester has a live account
 * names that account; multi-use, personal (referral), revoked, unused and unknown codes, and
 * codes whose tester has no account, keep their old answers.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { inviteCodes, testers } from "../schema";
import { createAccount } from "../services/accounts";
import { ensureReferralCode } from "../services/affiliates";
import { checkInvite, generateInviteCodes, inviteRecoveryAccount, linkTester, redeemInvite } from "../services/playtest";
import { memoryDb, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const silks = { primary: "#112233", secondary: "#445566", pattern: "solid", cap: "#778899" };

async function join(code: string, name: string) {
  const r = await redeemInvite(h.db, { code, cap: 60, now: T0 });
  const acc = await createAccount(h.db, { stableName: name, silks, starterHorses: 0, now: T0 });
  await linkTester(h.db, { testerId: r.testerId, accountId: acc.accountId, stableName: name, now: T0 });
  return { ...acc, testerId: r.testerId };
}

describe("invite as a way back in", () => {
  it("a used single-use admin code with a live tester account names that account (any case, spaces forgiven)", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    // Unused: nobody to sign in as; the normal join path.
    expect(await inviteRecoveryAccount(h.db, code!)).toBeNull();
    expect(await checkInvite(h.db, code!, 60, { recovery: true })).toEqual({ ok: true, rejoin: false });
    const t = await join(code!, "Back Again Stable");
    for (const typed of [code!, ` ${code!.toLowerCase()} `]) {
      expect(await inviteRecoveryAccount(h.db, typed)).toEqual({ accountId: t.accountId, testerId: t.testerId, stableName: "Back Again Stable" });
    }
    expect(await checkInvite(h.db, code!, 60, { recovery: true })).toEqual({ ok: false, problem: "SIGN_IN" });
    // Recovery off (outside the testing phase / no login-code secret): the old USED answer.
    expect(await checkInvite(h.db, code!, 60)).toEqual({ ok: false, problem: "USED" });
  });

  it("never for a multi-use admin code", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1, maxUses: 2 });
    await join(code!, "Shared Code One");
    await join(code!, "Shared Code Two");
    expect(await inviteRecoveryAccount(h.db, code!)).toBeNull();
    expect(await checkInvite(h.db, code!, 60, { recovery: true })).toEqual({ ok: false, problem: "USED" });
    // Even a multi-use code that one tester used once (still open) is no key.
    const [open] = await generateInviteCodes(h.db, { count: 1, maxUses: 5 });
    await join(open!, "Open Code One");
    expect(await inviteRecoveryAccount(h.db, open!)).toBeNull();
    expect(await checkInvite(h.db, open!, 60, { recovery: true })).toEqual({ ok: true, rejoin: false });
  });

  it("never for a personal (referral) code, even one squeezed to a single use", async () => {
    const owner = await createAccount(h.db, { stableName: "Referrer Stable", silks, starterHorses: 0, now: T0 });
    const personal = await ensureReferralCode(h.db, owner.accountId);
    await join(personal, "Referred Stable");
    expect(await inviteRecoveryAccount(h.db, personal)).toBeNull();
    await h.db.update(inviteCodes).set({ maxUses: 1 }).where(eq(inviteCodes.code, personal));
    expect(await inviteRecoveryAccount(h.db, personal)).toBeNull();
    expect(await checkInvite(h.db, personal, 60, { recovery: true })).toEqual({ ok: false, problem: "USED" });
  });

  it("never for unknown, revoked or tester-without-account codes (those keep INVALID / rejoin)", async () => {
    expect(await inviteRecoveryAccount(h.db, "TB-NOPE-NOPE")).toBeNull();
    expect(await inviteRecoveryAccount(h.db, "")).toBeNull();
    expect(await checkInvite(h.db, "TB-NOPE-NOPE", 60, { recovery: true })).toEqual({ ok: false, problem: "INVALID" });

    const [revoked] = await generateInviteCodes(h.db, { count: 1 });
    await join(revoked!, "Revoked Code Stable");
    await h.db.update(inviteCodes).set({ revokedAt: T0 }).where(eq(inviteCodes.code, revoked!));
    expect(await inviteRecoveryAccount(h.db, revoked!)).toBeNull();
    expect(await checkInvite(h.db, revoked!, 60, { recovery: true })).toEqual({ ok: false, problem: "INVALID" });

    // A reset unlinks the tester from its (deleted) account: the code is the rejoin path again.
    const [orphaned] = await generateInviteCodes(h.db, { count: 1 });
    const t = await join(orphaned!, "Orphan Stable");
    await h.db.update(testers).set({ accountId: null }).where(eq(testers.id, t.testerId));
    expect(await inviteRecoveryAccount(h.db, orphaned!)).toBeNull();
    expect(await checkInvite(h.db, orphaned!, 60, { recovery: true })).toEqual({ ok: true, rejoin: true });
  });
});
