import { db } from "@/server/db";
import { clientIp } from "@/server/devices";
import { errorJson, handleError, readJson } from "@/server/http";
import { walletAuthChallengeResponse } from "@/server/walletAuth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** Step 1 of wallet sign-in (no session needed): a one-time EIP-4361 message to sign (free, no transaction). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Connect a wallet first." });
  try {
    const database = await db();
    const u = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
    const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
    return await walletAuthChallengeResponse(database, { address: parsed.data.address, host, proto, ip: clientIp(req), now: new Date() });
  } catch (err) {
    return handleError(err);
  }
}