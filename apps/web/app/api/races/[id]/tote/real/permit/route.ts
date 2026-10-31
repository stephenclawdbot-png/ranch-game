import { z } from "zod";
import { db } from "@/server/db";
import { errorJson, handleError, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";
import { RealToteGeoError, RealToteOffError, realToteOn, requestBetPermit } from "@/server/chain/toteChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PermitSchema = z.object({
  horseId: z.string().regex(UUID_RE),
  pool: z.enum(["win", "place"]),
  /** USDG base units, as a decimal string (the exact amount the wallet will send). */
  amount: z.string().regex(/^[1-9]\d{0,12}$/),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/**
 * POST /api/races/:id/tote/real/permit {horseId, pool, amount, wallet} -> a signed, single-use,
 * short-lived BetPermit for exactly `amount` after every check (DORMANT: 503 while off). The
 * wallet then sends the bet to TotePools itself; no money passes through this server.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!realToteOn()) return errorJson(503, "real_tote_off", { message: "Real-money betting is off." });
  const { id } = await ctx.params;
  const parsed = PermitSchema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  try {
    const database = await db();
    const session = await requireSession(database);
    const signed = await requestBetPermit(database, session, { raceId: decodeURIComponent(id), horseId: parsed.data.horseId, pool: parsed.data.pool, amount: Number(parsed.data.amount), wallet: parsed.data.wallet, country: req.headers.get("x-vercel-ip-country"), now: new Date() });
    return json(signed);
  } catch (err) {
    if (err instanceof RealToteOffError) return errorJson(503, "real_tote_off", { message: "Real-money betting is off." });
    if (err instanceof RealToteGeoError) return errorJson(451, "geo_blocked", { message: err.message });
    return handleError(err);
  }
}
