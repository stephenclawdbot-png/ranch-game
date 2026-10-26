import { z } from "zod";
import { FEEDBACK_CATEGORIES, isDomainError, submitFeedback } from "@thoroughbred/db";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { trackEvent } from "@/server/playtest";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  message: z.string().trim().min(1).max(4000),
  /** Route path only (no query string). */
  route: z.string().max(200).optional(),
  viewport: z.string().max(40).optional(),
  errors: z.array(z.string().max(500)).max(10).optional(),
});

/** In-game feedback: stored with the route, stable, viewport, user agent and recent client errors. Rate limited. */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Pick a category and write a message (up to 4,000 characters)." });
  try {
    const database = await db();
    const session = await getSession(database);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    const route = parsed.data.route?.split("?")[0]?.split("#")[0] ?? null;
    const row = await submitFeedback(database, {
      accountId: session?.accountId ?? null,
      stableId: session?.stable.id ?? null,
      anonKey: ip,
      category: parsed.data.category,
      rating: parsed.data.rating ?? null,
      message: parsed.data.message,
      route,
      viewport: parsed.data.viewport ?? null,
      userAgent: req.headers.get("user-agent"),
      clientErrors: parsed.data.errors ?? [],
    });
    await trackEvent(database, session?.accountId ?? null, "feedback", { category: parsed.data.category });
    return json({ ok: true, id: row.id }, { status: 201 });
  } catch (err) {
    if (isDomainError(err) && (err.details as { rateLimited?: boolean } | undefined)?.rateLimited) return errorJson(429, "rate_limited", { message: err.message });
    return handleError(err);
  }
}
