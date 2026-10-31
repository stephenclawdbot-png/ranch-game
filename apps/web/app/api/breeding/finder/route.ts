import { STUD_FINDER_PAGE, studFinder } from "@/server/economy";
import { IdSchema, withPlayer } from "@/server/economyHttp";
import { errorJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The stallion finder for one mare (GET): every available stallion with the breeding preview's
 * outlook and nick in words, warnings in words, one possible look and the fee, a page at a time
 * (sort: "outlook", the default, ranked on the server by the public-facts outlook; or "fee").
 * No odds or numbers but the fee. The ranking is cached per (player, mare, day); fresh computes
 * are rate-limited, because every row runs the preview.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const mareId = IdSchema.safeParse(q.get("mareId") ?? "");
  if (!mareId.success) return errorJson(400, "invalid_body", { message: "Choose a mare." });
  const page = Math.trunc(Number(q.get("page") ?? 0));
  const pageSize = Math.trunc(Number(q.get("pageSize") ?? STUD_FINDER_PAGE));
  return withPlayer((db, session, now) =>
    studFinder(db, session, {
      mareId: mareId.data,
      sort: q.get("sort") ?? "outlook",
      page: Number.isFinite(page) ? page : 0,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
    }, now),
  );
}