import { z } from "zod";
import { isAllowedPushEndpoint, isValidPushKeys, pushDeviceOf, removePushDevice, savePushDevice, setPushDeviceCategories } from "@thoroughbred/db";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { pushEnabled } from "@/server/push";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Endpoint = z
  .string()
  .min(10)
  .max(1024)
  .refine((e) => isAllowedPushEndpoint(e), "not a push service");
const Key = z.string().min(10).max(200);
const SubscribeSchema = z.object({ subscription: z.object({ endpoint: Endpoint, keys: z.object({ p256dh: Key, auth: Key }) }) });
const Category = z.enum(["races", "health", "breeding", "club"]);
const UpdateSchema = z.object({ endpoint: Endpoint, enabled: z.partialRecord(Category, z.boolean()).optional() });
const RemoveSchema = z.object({ endpoint: z.string().min(10).max(1024) });

const off = () => errorJson(404, "push_off", { message: "Phone alerts aren't available here." });

/** Saves this browser's push subscription for the signed-in account (alerts on for this device). */
export async function POST(req: Request) {
  if (!pushEnabled()) return off();
  const parsed = SubscribeSchema.safeParse(await readJson(req));
  if (!parsed.success || !isValidPushKeys(parsed.data.subscription.keys)) return errorJson(400, "invalid_body", { message: "That browser subscription isn't valid." });
  try {
    const database = await db();
    const session = await requireSession(database);
    const { endpoint, keys } = parsed.data.subscription;
    const device = await savePushDevice(database, { accountId: session.accountId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers.get("user-agent"), now: new Date() });
    return json({ device }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * This device's alert categories (`{ endpoint }`), or switches some (`{ endpoint, enabled: { races:
 * false } }`). `device: null` when this browser isn't subscribed for this account.
 */
export async function PATCH(req: Request) {
  if (!pushEnabled()) return off();
  const parsed = UpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    const { endpoint, enabled } = parsed.data;
    const device = enabled
      ? await setPushDeviceCategories(database, { accountId: session.accountId, endpoint, enabled, now: new Date() })
      : await pushDeviceOf(database, session.accountId, endpoint);
    return json({ device });
  } catch (err) {
    return handleError(err);
  }
}

/** Turns alerts off for this device (forgets its subscription). */
export async function DELETE(req: Request) {
  const parsed = RemoveSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    return json({ removed: await removePushDevice(database, { accountId: session.accountId, endpoint: parsed.data.endpoint }) });
  } catch (err) {
    return handleError(err);
  }
}
