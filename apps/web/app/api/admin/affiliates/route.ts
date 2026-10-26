import { z } from "zod";
import { revokeReferral, setAffiliateConfig } from "@thoroughbred/db";
import { errorJson, readJson } from "@/server/http";
import { affiliatesAdmin } from "@/server/chain/affiliates";
import { withChainAdmin } from "@/server/chain/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ser = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Tree, top inviters, flags, owner stats, config. */
export async function GET() {
  return withChainAdmin(async (ctx) => ser(await affiliatesAdmin(ctx.db, ctx.chain)));
}

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), accountId: z.string().uuid(), reason: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("config"),
    ref1Bps: z.number().int().min(0).max(1500).optional(),
    ref2Bps: z.number().int().min(0).max(500).optional(),
    windowDays: z.number().int().min(1).max(3650).optional(),
    weeklyCapUsdCents: z.number().int().min(0).optional(),
    ownerWeeklyCapUsdCents: z.number().int().min(0).nullable().optional(),
    activeReward: z.object({ credits: z.number().int().min(0), minRaces: z.number().int().min(0), minPlayDays: z.number().int().min(0) }).partial().optional(),
  }),
]);

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Check the values (L1 <= 15%, L2 <= 5%)." });
  return withChainAdmin(async (ctx, now) => {
    const d = parsed.data;
    if (d.action === "revoke") {
      await revokeReferral(ctx.db, { accountId: d.accountId, reason: d.reason, now });
      return { ok: true };
    }
    const { action: _a, activeReward, ...rest } = d;
    return { config: await setAffiliateConfig(ctx.db, { ...rest, ...(activeReward ? { activeReward: activeReward as never } : {}) }) };
  });
}
