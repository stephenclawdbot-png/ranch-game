import { z } from "zod";
import { resetPlaytest } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ confirm: z.string().max(40) });

/**
 * Wipes game progress (accounts, stables, horses, races, ledger...) and keeps testers, invite
 * codes, tester rewards, feedback, telemetry and beta rewards. Needs the typed confirmation.
 */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  return adminRoute(async (db, now) => ({ reset: await resetPlaytest(db, { confirm: parsed.data.confirm, now }) }));
}
