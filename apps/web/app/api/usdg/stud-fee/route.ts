import { z } from "zod";
import { standAtStudForUsdg } from "@/server/chain/usdg";
import { withUsdgPlayer } from "@/server/chain/usdgHttp";
import { breedingView } from "@/server/economy";
import { errorJson, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** fee: micro-USDG (1 USDG = 1,000,000), or null to stop standing him for USDG. */
const Schema = z.object({ horseId: z.string().uuid(), fee: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() });

/** Stand your registered stallion at stud for a USDG fee instead of credits (or drop the USDG fee). */
export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "A USDG stud fee is a positive amount." });
  return withUsdgPlayer(async (ctx, session, now) => {
    await standAtStudForUsdg(ctx, session, parsed.data, now);
    return { view: await breedingView(ctx.db, session, now) };
  });
}
