import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FinancesScreen } from "@/components/finances/FinancesScreen";
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
  return <FinancesScreen view={await financesView(database, session, period, new Date())} />;
}