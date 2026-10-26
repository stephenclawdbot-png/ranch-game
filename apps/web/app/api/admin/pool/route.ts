import { z } from "zod";
import { errorJson, readJson } from "@/server/http";
import { withChainAdmin } from "@/server/chain/http";
import { computeEpochDraft, epochHistory } from "@/server/chain/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Epoch history (drafts and posted). */
export async function GET() {
  return withChainAdmin(async (ctx) => ({ epochs: await epochHistory(ctx) }));
}

const Schema = z.object({
  kind: z.enum(["weekly", "season"]).default("weekly"),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rules: z
    .object({
      budgetBps: z.number().int().min(1).max(10_000),
      capUsdCents: z.number().int().min(1).max(1_000_000),
      minActiveDays: z.number().int().min(0).max(366),
      paidRanks: z.number().int().min(1).max(200),
      minPayoutUsdCents: z.number().int().min(0).max(100_000),
      excludePremiumHorses: z.boolean(),
      excludeFlagged: z.boolean(),
      vestDays: z.number().int().min(0).max(365),
    })
    .partial()
    .optional(),
});

/** Computes (or recomputes) the next epoch's draft: scores, eligibility, USD caps -> wei, Merkle root. */
export async function POST(req: Request) {
  const parsed = Schema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return errorJson(400, "invalid_body", { message: "Check the period and rules." });
  return withChainAdmin((ctx, now) => computeEpochDraft(ctx, { ...parsed.data, now }));
}
