import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { FinanceCategory } from "@thoroughbred/db";
import { FinancesScreen } from "@/components/finances/FinancesScreen";

/** Categories a credit note can highlight (?highlight=). */
const FINANCE_CATEGORY_KEYS = ["prize", "sales", "stud_earned", "leasing", "goals_cup", "story", "training", "upkeep", "entry_fees", "race_day", "stud_paid", "purchases", "facilities", "fees", "tote", "other"] as const satisfies readonly FinanceCategory[];
import { db } from "@/server/db";
import { financesView, parseFinancePeriod } from "@/server/finances";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finances" };

/** The stable's books: ?period= this_week (default), last_week, season or all_time. */
export default async function FinancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const period = parseFinancePeriod(sp.period);
  const database = await db();
  const session = await getSession(database);
  if (!session) redirect("/play");
  const highlight = typeof sp.highlight === "string" && (FINANCE_CATEGORY_KEYS as readonly string[]).includes(sp.highlight) ? (sp.highlight as FinanceCategory) : null;
  return <FinancesScreen view={await financesView(database, session, period, new Date())} highlight={highlight} />;
}