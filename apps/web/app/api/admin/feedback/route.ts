import { z } from "zod";
import { FEEDBACK_CATEGORIES, listFeedback, updateFeedback } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Filter = z.object({ status: z.enum(["new", "resolved"]).optional(), category: z.enum(FEEDBACK_CATEGORIES).optional() });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const f = Filter.safeParse({ status: q.get("status") || undefined, category: q.get("category") || undefined });
  return adminRoute(async (db) => ({ feedback: await listFeedback(db, f.success ? f.data : {}) }));
}

const Patch = z.object({ id: z.string().uuid(), status: z.enum(["new", "resolved"]).optional(), acceptBug: z.boolean().optional(), note: z.string().max(2000).nullable().optional() });

/** Resolve / reopen, note, or accept as a bug (creates the pending bug bounty). */
export async function PATCH(req: Request) {
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  return adminRoute(async (db, now) => ({ feedback: await updateFeedback(db, { ...parsed.data, now }) }));
}
