import type { Metadata } from "next";
import Link from "next/link";
import { isDomainError } from "@thoroughbred/db";
import { QuickReplay } from "@/components/quick/QuickReplay";
import type { QuickRaceView } from "@/lib/quickRaces";
import { db } from "@/server/db";
import { quickRaceView } from "@/server/quickRaces";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quick race (unofficial)", robots: { index: false } };

/** A quick race (match, ghost or daily challenge attempt) in the viewer, with its result. Never official. */
export default async function QuickRacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view: QuickRaceView | null = null;
  let message = "We couldn't find that quick race.";
  try {
    const database = await db();
    const session = await getSession(database);
    view = await quickRaceView(database, session, decodeURIComponent(id), new Date());
  } catch (err) {
    if (!isDomainError(err)) throw err;
    message = err.message && err.message !== err.code ? `${err.message.charAt(0).toUpperCase()}${err.message.slice(1)}.` : message;
  }
  if (!view) {
    return (
      <div className="surface grid gap-3 p-4" data-testid="quick-missing">
        <p className="eyebrow">Quick races</p>
        <p className="font-bold">{message}</p>
        <Link href="/quick" className="btn w-fit">
          ‹ Quick races
        </Link>
      </div>
    );
  }
  return <QuickReplay v={view} />;
}
