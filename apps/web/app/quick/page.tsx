import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { QuickHub, type QuickTab } from "@/components/quick/QuickHub";
import { SceneBand } from "@/components/ui/Page";
import { db } from "@/server/db";
import { quickHub } from "@/server/quickRaces";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quick races" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Quick races: the daily challenge, match races and ghost races. Instant and unofficial: a race in
 * a two-minute visit, with nothing on the books moving.
 */
export default async function QuickRacesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const database = await db();
  const session = await getSession(database);
  const now = new Date();
  const view = await quickHub(database, session, now);
  const vs = UUID.test(one("vs")) ? one("vs") : undefined;
  const horse = UUID.test(one("horse")) ? one("horse") : undefined;
  const asked = one("tab");
  const tab: QuickTab = asked === "match" || asked === "ghost" || asked === "daily" ? asked : vs ? "match" : "daily";
  return (
    <div className="grid gap-4">
      {/* A new daily challenge is published at 00:00 UTC: refresh then. */}
      <AutoRefresh atMs={view.daily.closesAtMs} serverNowMs={now.getTime()} />
      <SceneBand scene="gallops-morning" alt="Horses working up the gallops in the morning mist" eyebrow="Racing" title="Quick races" meta="Instant and unofficial: no rating, fatigue, injuries or credits." />
      <QuickHub v={view} tab={tab} horse={horse} vs={vs} />
    </div>
  );
}
