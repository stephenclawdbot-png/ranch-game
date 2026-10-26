import { listBetaRewards, listRewardRules, testerBetaProgress, testerForAccount } from "@thoroughbred/db";
import { db } from "@/server/db";
import { handleError, json } from "@/server/http";
import { explorerUrl, playtestConfig } from "@/server/playtest";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";

const MANUAL_RULES = new Set(["bug_bounty", "best_feedback"]);
export const dynamic = "force-dynamic";

/** The tester's beta page: reward rules, own progress, own (fallback) payouts and wallet. */
export async function GET() {
  try {
    const database = await db();
    const session = await requireSession(database);
    const tester = await testerForAccount(database, session.accountId);
    // Tester bonuses paid by hand (the fallback ledger). Weekly prizes are the on-chain Prize Pool (/pool).
    const rules = (await listRewardRules(database)).filter((r) => r.active && MANUAL_RULES.has(r.key)).map((r) => ({ key: r.key, label: r.label, amountUsdCents: r.amountUsdCents, config: r.config }));
    if (!tester) return json({ playtest: playtestConfig().enabled, tester: null, rules, explorer: explorerUrl() });
    const rewards = (await listBetaRewards(database, { testerId: tester.id }))
      .filter((r) => r.status !== "void")
      .map((r) => ({ id: r.id, ruleKey: r.ruleKey, period: r.period, amountUsdCents: r.amountUsdCents, status: r.status, txHash: r.txHash, notes: r.notes, createdAtMs: r.createdAt.getTime() }));
    return json({
      playtest: playtestConfig().enabled,
      tester: { joinedAtMs: tester.joinedAt.getTime(), walletAddress: tester.walletAddress },
      progress: await testerBetaProgress(database, { testerId: tester.id }),
      rules,
      rewards,
      explorer: explorerUrl(),
    });
  } catch (err) {
    return handleError(err);
  }
}
