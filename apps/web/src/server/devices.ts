/**
 * Device-linking HTTP layer for the account routes: creating a one-time link code, redeeming
 * one (which sets the session cookie), and listing / revoking linked devices. The handlers
 * under app/api/account delegate here, so tests drive the logic without Next's cookie jar.
 *
 * Abuse limit: failed redemptions are counted per IP over a sliding hour in the shared
 * `rate_limits` table (codes are random and short-lived, so there is no per-code lockout);
 * at 20 failures the endpoint answers 429. The client IP is a counter key only — it is
 * never an identity signal, so testers on one Wi-Fi aren't linked. A browser that switches
 * stables (this device now belongs to another account) is written to the audit log as
 * `account.switch`.
 */
import { audit, clearRateLimits, createLinkCode, hashToken, listDevices, redeemLinkCode, revokeDevice, stableHasProgress, stableOf, type Db } from "@thoroughbred/db";
import { playerView } from "./game";
import { errorJson, json } from "./http";
import { clientIp, sharedLimiter } from "./rateLimit";
import { setSessionCookie, type Session } from "./session";

export const LINK_FAIL_LIMIT = 20;
/** Failed redemptions per IP per sliding hour. */
const linkFailures = sharedLimiter({ name: "link-failures", limit: LINK_FAIL_LIMIT, windowMs: 3_600_000 });

/** Test hook: forget the counted failures. */
export function resetLinkFailures(database: Db): Promise<number> {
  return clearRateLimits(database, { name: "link-failures" });
}

export { clientIp };

/** POST /api/account/link-code (signed in): a fresh one-time code, shown once, valid 10 minutes. */
export async function createLinkCodeResponse(database: Db, session: Session) {
  const { code, expiresAt } = await createLinkCode(database, { accountId: session.accountId });
  return json({ code, expiresAtMs: expiresAt.getTime() });
}

export interface LinkDeviceInput {
  body: unknown;
  ip: string;
  /** The stable this browser already has, if any (left behind when linking). */
  session: Session | null;
}

/**
 * POST /api/account/link: redeems the code and signs this device in. Without a session it
 * links a fresh browser; a browser that already has a stable in play needs `replace: true`.
 * Every failure answers the same generic wording, so nothing is revealed about codes.
 */
export async function linkDeviceResponse(database: Db, input: LinkDeviceInput) {
  const now = Date.now();
  const body = (input.body ?? {}) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : "";
  const replace = body.replace === true;
  const label = typeof body.label === "string" ? body.label : null;
  if ((await linkFailures.count(database, input.ip, now)) >= LINK_FAIL_LIMIT) {
    const res = errorJson(429, "too_many_tries", { message: "Too many tries. Wait a few minutes, then get a fresh code." });
    res.headers.set("Retry-After", "3600");
    return res;
  }
  if (input.session && !replace && (await stableHasProgress(database, input.session.accountId))) {
    return errorJson(409, "replace_required", { message: "This browser already has a stable with races or horses. Linking this device leaves that stable behind." });
  }
  const linked = await redeemLinkCode(database, { code, label });
  if (!linked) {
    await linkFailures.fail(database, input.ip, now);
    return errorJson(400, "link_code_invalid", { message: "That code didn't work. Check it and try again." });
  }
  if (input.session && input.session.accountId !== linked.accountId) {
    // A stable switch, not a shared identity: the audit log tells the story, no signal is inferred.
    await audit(database, { actor: linked.accountId, action: "account.switch", entityType: "account", entityId: linked.accountId, data: { from: input.session.accountId, to: linked.accountId } });
  }
  const stable = await stableOf(database, linked.accountId);
  const res = json({ stableName: linked.stableName, player: await playerView(database, { accountId: linked.accountId, stable }, new Date()) });
  setSessionCookie(res, linked.token);
  return res;
}

/** GET /api/account/devices (signed in): the linked devices, the requesting one marked. */
export async function listDevicesResponse(database: Db, session: Session, token: string | null) {
  const { devices, original } = await listDevices(database, session.accountId, token ? hashToken(token) : "");
  return json({ devices, original });
}

/** DELETE /api/account/devices/:id (signed in): revokes another device's token. */
export async function revokeDeviceResponse(database: Db, session: Session, deviceId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) return errorJson(404, "NOT_FOUND");
  await revokeDevice(database, { accountId: session.accountId, deviceId });
  return json({ ok: true });
}