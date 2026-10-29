import { z } from "zod";
import { listHorseForUsdg } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** price in micro-USDG (1 USDG = 1_000_000); duration in days (fixed) or hours (auction). */
const Schema = z.object({ horseId: z.string().uuid(), kind: z.enum(["fixed", "auction"]), price: z.number().int().positive().max(1e15), duration: z.number().int().positive() });

/** Lists a registered horse for USDG (fixed price or auction); the horse is locked until sold, cancelled or closed. */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Choose a horse, a price and how long it runs." });
  return withUsdgPlayer((ctx, session, now) => listHorseForUsdg(ctx, session, parsed.data, now), { status: 201 });
}
