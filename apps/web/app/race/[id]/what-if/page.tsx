import type { Metadata } from "next";
import Link from "next/link";
import { isDomainError } from "@thoroughbred/db";
import { WhatIfReplay } from "@/components/whatIf/WhatIfReplay";
import type { WhatIfView } from "@/lib/whatIf";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { whatIfSummary } from "@/server/whatIf";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "What if? (not official)", robots: { index: false } };

/**
 * Watch a what-if: the counterfactual re-run of a settled race (one change to your runner, same
 * seed) in the race viewer, badged "WHAT IF", with the comparison under it. Only a re-run your
 * stable has already made (the sheet makes it); never official, no finale, no credits.
 */
export default async function WhatIfPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const raceId = decodeURIComponent(id);
  let view: WhatIfView | null = null;
  let message = "We couldn't find that what-if.";
  try {
    const database = await db();
    const session = await getSession(database);
    if (!session) message = "Found a stable to try what-ifs with your horses.";
    else view = await whatIfSummary(database, session, raceId, one("horse"), one("change"), new Date());
  } catch (err) {
    if (!isDomainError(err)) throw err;
    message = err.message && err.message !== err.code ? `${err.message.charAt(0).toUpperCase()}${err.message.slice(1)}.` : message;
  }
  if (!view) {
    return (
      <div className="surface grid gap-3 p-4" data-testid="what-if-missing">
        <p className="eyebrow">What if?</p>
        <p className="font-bold">{message}</p>
        <Link href={`/race/${raceId}`} className="btn w-fit">
          ‹ The race
        </Link>
      </div>
    );
  }
  return <WhatIfReplay v={view} />;
}
