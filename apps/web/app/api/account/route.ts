import { z } from "zod";
import { SilksSchema } from "@thoroughbred/shared";
import { createAccount, linkTester, recordReferral, redeemInvite, stableOf, updateStableProfile } from "@thoroughbred/db";
import { db } from "@/server/db";
import { playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { playtestConfig, trackEvent } from "@/server/playtest";
import { getSession, requireSession, setSessionCookie } from "@/server/session";
import { StableNameSchema } from "@/lib/stableName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  stableName: StableNameSchema,
  silks: SilksSchema,
  /** IANA timezone from the device: the daily entry allowance lands at local midnight. */
  timezone: z.string().max(64).optional(),
  /** Closed playtest (PLAYTEST_MODE=1): the invite code. Outside the playtest: an optional referral code. */
  inviteCode: z.string().max(40).optional(),
});

/**
 * Creates an anonymous device account: the stable, starter horses, credits and today's
 * entries (one transaction). The raw token goes into an httpOnly cookie; only its hash is
 * stored. A browser that already has a stable gets it back instead of a second one.
 */
export async function POST(req: Request) {
  const parsed = CreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Check the stable name and colours.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  try {
    const database = await db();
    const existing = await getSession(database);
    if (existing) return json({ created: false, player: await playerView(database, existing, new Date()) });
    const now = new Date();
    // Closed playtest: reserve a tester for the invite code first (re-links a tester after a reset).
    const playtest = playtestConfig();
    let testerId: string | null = null;
    if (playtest.enabled) {
      if (!parsed.data.inviteCode?.trim()) return errorJson(403, "invite_required", { message: "The playtest is invite only. Enter your invite code." });
      testerId = (await redeemInvite(database, { code: parsed.data.inviteCode, cap: playtest.testerCap, now })).testerId;
    }
    const acc = await createAccount(database, { stableName: parsed.data.stableName, silks: parsed.data.silks, timezone: parsed.data.timezone, now });
    if (testerId) await linkTester(database, { testerId, accountId: acc.accountId, stableName: parsed.data.stableName, now });
    // Affiliate tree (beta money): inviter = the code's owner (root/admin codes -> the owner account).
    if (parsed.data.inviteCode?.trim()) {
      try {
        await recordReferral(database, { accountId: acc.accountId, code: parsed.data.inviteCode, now });
      } catch (err) {
        console.error("referral", err);
      }
    }
    await trackEvent(database, acc.accountId, "signup", { playtest: playtest.enabled });
    const session = { accountId: acc.accountId, stable: await stableOf(database, acc.accountId) };
    const res = json({ created: true, player: await playerView(database, session, now) }, { status: 201 });
    setSessionCookie(res, acc.token);
    return res;
  } catch (err) {
    return handleError(err);
  }
}

const PatchSchema = z.object({ stableName: StableNameSchema.optional(), silks: SilksSchema.optional() });

/** Renames the stable and/or changes its silks. */
export async function PATCH(req: Request) {
  const parsed = PatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Check the stable name and colours." });
  try {
    const database = await db();
    const session = await requireSession(database);
    await updateStableProfile(database, { accountId: session.accountId, name: parsed.data.stableName, silks: parsed.data.silks });
    const fresh = await requireSession(database);
    return json({ player: await playerView(database, fresh, new Date()) });
  } catch (err) {
    return handleError(err);
  }
}
