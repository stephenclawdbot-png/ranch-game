import { z } from "zod";
import { generateInviteCodes, listInviteCodes } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";
import { errorJson, readJson } from "@/server/http";
import { playtestConfig } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return adminRoute(async (db) => ({ config: playtestConfig(), codes: await listInviteCodes(db) }));
}

const Schema = z.object({ count: z.number().int().min(1).max(500), maxUses: z.number().int().min(1).max(1000).optional(), note: z.string().max(200).optional() });

/** Generates invite codes in bulk. */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Generate 1 to 500 codes." });
  return adminRoute(async (db, now) => ({ codes: await generateInviteCodes(db, { ...parsed.data, now }) }), 201);
}
