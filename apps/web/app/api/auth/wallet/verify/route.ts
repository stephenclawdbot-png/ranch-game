import { z } from "zod";
import { SilksSchema } from "@thoroughbred/shared";
import { db } from "@/server/db";
import { clientIp } from "@/server/devices";
import { errorJson, handleError, readJson } from "@/server/http";
import { getSession } from "@/server/session";
import { StableNameSchema } from "@/lib/stableName";
import { walletAuthVerifyResponse } from "@/server/walletAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  nonce: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4000),
  /** What the wallet is signing for: "signin" (/play, /link; default) or "link" to the current stable (/me). */
  intent: z.enum(["signin", "link"]).optional(),
  /** Confirm leaving this browser's stable behind when the wallet belongs to another one. */
  replace: z.boolean().optional(),
  /** No stable anywhere yet: found one here (name + colours), linked to the wallet. */
  create: z.boolean().optional(),
  stableName: StableNameSchema.optional(),
  silks: SilksSchema.optional(),
  timezone: z.string().max(64).optional(),
  inviteCode: z.string().max(40).optional(),
});

/**
 * Step 2 of wallet sign-in: verify the signature, then sign this device in (device session +
 * cookie), link the wallet to this browser's stable, or — with { create: true } — found the
 * stable and link the wallet in the same request. Rate-limited per IP like the challenge.
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "The signature is missing." });
  try {
    const database = await db();
    return await walletAuthVerifyResponse(database, { body: parsed.data, ip: clientIp(req), session: await getSession(database), now: new Date() });
  } catch (err) {
    return handleError(err);
  }
}