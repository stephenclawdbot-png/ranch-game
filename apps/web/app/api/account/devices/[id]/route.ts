import { db } from "@/server/db";
import { revokeDeviceResponse } from "@/server/devices";
import { handleError } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revokes a linked device: its token stops authenticating. The original browser token isn't a device and can't be revoked here. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const database = await db();
    const session = await requireSession(database);
    return await revokeDeviceResponse(database, session, id);
  } catch (err) {
    return handleError(err);
  }
}