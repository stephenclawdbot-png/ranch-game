import { z } from "zod";
import { setTesterWallet } from "@thoroughbred/db";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ address: z.string().trim().max(64).nullable() });

/** Saves (or clears) the tester's EVM address on Robinhood Chain for the tester item and payouts. */
export async function PUT(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Enter an address like 0x… (42 characters)." });
  try {
    const database = await db();
    const session = await requireSession(database);
    const t = await setTesterWallet(database, { accountId: session.accountId, address: parsed.data.address || null });
    return json({ walletAddress: t.walletAddress });
  } catch (err) {
    return handleError(err);
  }
}
