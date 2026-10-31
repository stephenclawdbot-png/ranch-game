import { z } from "zod";
import { SilksSchema } from "@thoroughbred/shared";
import { stableOf, updateStableProfile } from "@thoroughbred/db";
import { db } from "@/server/db";
import { foundStable } from "@/server/founding";
import { playerView } from "@/server/game";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { trackEvent } from "@/server/playtest";
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
  /** "Bring a rival": the invite code came from a rival invite link. */
  rival: z.boolean().optional(),
  /** This browser's random id (anti-alt device signal). */
  deviceId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
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
    // The founding flow wallet sign-in shares (invite seat first, then the account).
    const acc = await foundStable(database, {
      stableName: parsed.data.stableName,
      silks: parsed.data.silks,
      timezone: parsed.data.timezone,
      inviteCode: parsed.data.inviteCode ?? null,
      rival: parsed.data.rival,
      deviceId: parsed.data.deviceId ?? null,
      now,
    });
    await trackEvent(database, acc.accountId, "signup", { playtest: acc.playtest, ...(acc.rival ? { rival: acc.rival.ok ? acc.rival.welcome : acc.rival.problem } : {}) });
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