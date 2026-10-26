/**
 * Device-linking HTTP layer for the account routes: creating a one-time link code, redeeming
 * one (which sets the session cookie), and listing / revoking linked devices. The handlers
 * under app/api/account delegate here, so tests drive the logic without Next's cookie jar.
 *
 * Abuse limit: failed redemptions are counted per IP over a sliding hour in memory (codes are
 * random and short-lived, so there is no per-code lockout); at 20 failures the endpoint
 * answers 429. Successful links are recorded as an account signal (kind "device", the IP is
 * only ever stored hashed by recordAccountSignal) so anti-multi-account sees one person.
 */
import { createLinkCode, hashToken, listDevices, recordAccountSignal, redeemLinkCode, revokeDevice, stableHasProgress, stableOf, type Db } from "@thoroughbred/db";
import { playerView } from "./game";
import { errorJson, json } from "./http";
import { setSessionCookie, type Session } from "./session";

export const LINK_FAIL_LIMIT = 20;
const HOUR_MS = 3_600_000;
/** Process-local failure timestamps per IP (sliding hour). Serverless instances are interchangeable. */
const linkFailures = new Map<string, number[]>();

/** Test hook: forget the counted failures. */
export function resetLinkFailures(): void {
  linkFailures.clear();
}

function linkFailureCount(ip: string, now: number): number {
  const fresh = (linkFailures.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
  if (fresh.length) linkFailures.set(ip, fresh);
  else linkFailures.delete(ip);
  return fresh.length;
}

function noteLinkFailure(ip: string, now: number): void {
  const stamps = linkFailures.get(ip) ?? [];
  stamps.push(now);
  linkFailures.set(ip, stamps);
}

/** The client's IP (first hop of x-forwarded-for); only ever used hashed or as a counter key. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim() || "local";
}

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
  if (linkFailureCount(input.ip, now) >= LINK_FAIL_LIMIT) {
    const res = errorJson(429, "too_many_tries", { message: "Too many tries. Wait a few minutes, then get a fresh code." });
    res.headers.set("Retry-After", "3600");
    return res;
  }
  if (input.session && !replace && (await stableHasProgress(database, input.session.accountId))) {
    return errorJson(409, "replace_required", { message: "This browser already has a stable with races or horses. Linking this device leaves that stable behind." });
  }
  const linked = await redeemLinkCode(database, { code, label });
  if (!linked) {
    noteLinkFailure(input.ip, now);
    return errorJson(400, "link_code_invalid", { message: "That code didn't work. Check it and try again." });
  }
  await recordAccountSignal(database, { accountId: linked.accountId, kind: "device", value: input.ip });
  if (input.session && input.session.accountId !== linked.accountId) {
    await recordAccountSignal(database, { accountId: input.session.accountId, kind: "device", value: input.ip });
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
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deviceId)) return errorJson(404, "NOT_FOUND");
  await revokeDevice(database, { accountId: session.accountId, deviceId });
  return json({ ok: true });
}