import { z } from "zod";
import { awardBetaReward, budgetSummary, listBetaRewards, listRewardRules, setBetaRewardStatus, updateRewardRule } from "@thoroughbred/db";
import { adminRoute } from "@/server/adminHttp";
import { errorJson, readJson } from "@/server/http";
import { betaBudgetCents, explorerUrl } from "@/server/playtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The manual (fallback) payout ledger: rules, rewards, budget. The weekly Prize Pool is on-chain. */
export async function GET() {
  return adminRoute(async (db) => ({
    rules: await listRewardRules(db),
    rewards: await listBetaRewards(db),
    budget: await budgetSummary(db, betaBudgetCents()),
    explorer: explorerUrl(),
  }));
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rule"), key: z.string().max(60), label: z.string().max(120).optional(), amountUsdCents: z.number().int().min(0).max(1_000_000).optional(), active: z.boolean().optional() }),
  z.object({ action: z.literal("award"), testerId: z.string().uuid(), ruleKey: z.string().max(60), period: z.string().min(1).max(80), notes: z.string().max(500).optional() }),
  z.object({ action: z.enum(["approve", "void", "pending"]), id: z.string().uuid() }),
  z.object({ action: z.literal("paid"), id: z.string().uuid(), txHash: z.string().max(80) }),
]);

export async function POST(req: Request) {
  const parsed = Action.safeParse(await readJson(req));
  if (!parsed.success) return errorJson(400, "invalid_body");
  const a = parsed.data;
  return adminRoute(async (db, now) => {
    if (a.action === "rule") return { rule: await updateRewardRule(db, a) };
    if (a.action === "award") {
      await awardBetaReward(db, { ...a, now });
      return { ok: true };
    }
    return { reward: await setBetaRewardStatus(db, { id: a.id, action: a.action, txHash: a.action === "paid" ? a.txHash : null, now }) };
  });
}
