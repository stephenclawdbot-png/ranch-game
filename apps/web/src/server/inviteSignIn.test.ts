/**
 * Testing phase: the invite link as a way back in (POST /api/account/invite-sign-in,
 * src/server/devices.ts inviteSignInResponse). Signs in only for a used single-use admin code
 * whose tester has a live account; multi-use, personal and unknown codes keep their behaviour;
 * rate-limited by IP (shared with /link) and by code; audited; off outside the testing phase.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate, createAccount, createDb, ensureReferralCode, generateInviteCodes, linkTester, redeemInvite, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import { INVITE_SIGN_IN_PER_CODE, inviteSignInResponse, LINK_FAIL_LIMIT, linkDeviceResponse, resetInviteSignIns, resetLinkFailures } from "./devices";

const ENV = { PLAYTEST_MODE: "1", LOGIN_CODE_SECRET: "x".repeat(40) };
const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };
let h: DbHandle;
const saved = { ...process.env };
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  process.env = { ...saved, ...ENV };
  await resetLinkFailures(h.db);
  await resetInviteSignIns(h.db);
});
afterEach(() => {
  process.env = { ...saved };
});

async function tester(code: string, name: string) {
  const r = await redeemInvite(h.db, { code, cap: 60 });
  const acc = await createAccount(h.db, { stableName: name, silks: SILKS });
  await linkTester(h.db, { testerId: r.testerId, accountId: acc.accountId, stableName: name });
  return acc;
}

const signIn = (code: string, ip = "7.7.7.7", session: Awaited<ReturnType<typeof sessionOf>> | null = null, extra: Record<string, unknown> = {}) =>
  inviteSignInResponse(h.db, { body: { code, label: "Phone", ...extra }, ip, session });
async function sessionOf(accountId: string) {
  return { accountId, stable: await stableOf(h.db, accountId) };
}

describe("invite link as a way back in", () => {
  it("signs a fresh browser into the tester's stable (code typed any way), audited as invite sign-in", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    const acc = await tester(code!, "Invite Key Stable");
    for (const typed of [code!, ` ${code!.toLowerCase()} `]) {
      const res = await signIn(typed);
      expect(res.status).toBe(200);
      expect((await res.json()).stableName).toBe("Invite Key Stable");
      expect(await authenticate(h.db, res.cookies.get("tb_session")!.value)).toMatchObject({ accountId: acc.accountId });
    }
    const logs = (await h.db.select().from(schema.auditLog)).filter((l) => l.action === "account.invite_sign_in");
    expect(logs.filter((l) => l.actorAccountId === acc.accountId)).toHaveLength(2);
    // The raw code is never written to the audit log or the rate-limit keys.
    expect(JSON.stringify(logs)).not.toContain(code!);
    expect(JSON.stringify(await h.db.select().from(schema.rateLimits))).not.toContain(code!);
  });

  it("never signs in with a multi-use admin code, a personal code or an unknown code (one generic answer)", async () => {
    const [shared] = await generateInviteCodes(h.db, { count: 1, maxUses: 3 });
    await tester(shared!, "Shared Invite One");
    const owner = await createAccount(h.db, { stableName: "Personal Code Owner", silks: SILKS });
    const personal = await ensureReferralCode(h.db, owner.accountId);
    await tester(personal, "Personal Invitee");
    const [unused] = await generateInviteCodes(h.db, { count: 1 });
    for (const code of [shared!, personal, unused!, "TB-NOPE-NOPE", ""]) {
      const res = await signIn(code);
      expect(res.status).toBe(400);
      expect(res.cookies.get("tb_session")).toBeUndefined();
      expect(await res.json()).toMatchObject({ error: "invite_sign_in_invalid" });
    }
  });

  it("is off outside the testing phase or without the login-code secret", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    await tester(code!, "Later Invite Stable");
    process.env = { ...saved, PLAYTEST_MODE: "", LOGIN_CODE_SECRET: ENV.LOGIN_CODE_SECRET };
    expect((await signIn(code!)).status).toBe(404);
    process.env = { ...saved, PLAYTEST_MODE: "1", LOGIN_CODE_SECRET: "" };
    expect((await signIn(code!)).status).toBe(404);
  });

  it("is rate limited: failures share the /link budget per IP, and each code has its own hourly budget", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    await tester(code!, "Throttle Invite Stable");
    // Failed guesses from one IP, counted with failed /link codes.
    for (let i = 0; i < LINK_FAIL_LIMIT - 1; i++) expect((await signIn(`TB-BAD${i % 10}-CODE`, "5.5.5.5")).status).toBe(400);
    expect((await linkDeviceResponse(h.db, { body: { code: "BAD1-CODE" }, ip: "5.5.5.5", session: null })).status).toBe(400);
    const blocked = await signIn(code!, "5.5.5.5");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("3600");
    // Another IP still gets in, until the code's own budget is spent (from any IPs).
    await resetInviteSignIns(h.db);
    for (let i = 0; i < INVITE_SIGN_IN_PER_CODE; i++) expect((await signIn(code!, `6.6.6.${i}`)).status).toBe(200);
    expect((await signIn(code!, "6.6.7.1")).status).toBe(429);
  });

  it("a browser with another stable in play must confirm leaving it; the same stable is a no-op", async () => {
    const [code] = await generateInviteCodes(h.db, { count: 1 });
    const acc = await tester(code!, "Owner Invite Stable");
    const same = await signIn(code!, "4.4.4.4", await sessionOf(acc.accountId));
    expect(same.status).toBe(200);
    expect((await same.json()).alreadySignedIn).toBe(true);
    expect(same.cookies.get("tb_session")).toBeUndefined();
    // A brand-new other stable (no races, only starters) switches without a question.
    const other = await createAccount(h.db, { stableName: "Fresh Other Stable", silks: SILKS });
    expect((await signIn(code!, "4.4.4.4", await sessionOf(other.accountId))).status).toBe(200);
  });
});
