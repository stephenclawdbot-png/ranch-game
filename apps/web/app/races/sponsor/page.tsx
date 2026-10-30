import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SponsorBoard } from "@/components/race/SponsorBoard";
import { HowItWorks, PageHeader } from "@/components/ui/Page";
import { formatCredits } from "@/lib/format";
import { db } from "@/server/db";
import { getSession } from "@/server/session";
import { sponsorView } from "@/server/sponsor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sponsor a race · Kestrel Downs" };

export default async function SponsorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const date = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const database = await db();
  const session = await getSession(database);
  if (!session) redirect("/play");
  const view = await sponsorView(database, session, new Date(), { date: date ?? null });
  return (
    <div className="grid gap-6">
      <PageHeader scene="grandstand" back={{ href: "/races", label: "Race card" }} eyebrow="Kestrel Downs" title="Sponsor a race" meta={`${formatCredits(view.credits)} credits`} />
      <HowItWorks>
        <p>
          Put your stable&rsquo;s name on a Live race up to {view.rules.windowDays} days ahead: the race becomes &ldquo;The {view.stableName} Handicap&rdquo; or whatever its class is, with your
          silks on the racecard, a note with the result and a plaque in your Trophy Room.
        </p>
        <p>
          It costs {view.rules.purseMultiple}&times; the race&rsquo;s purse (at least {formatCredits(view.rules.minPrice)} credits), spent for good. One sponsor per race, first come first served;
          up to {view.rules.maxUpcoming} at a time. It changes nothing about the race itself. Calendar races aren&rsquo;t for sale.
        </p>
      </HowItWorks>
      <SponsorBoard view={view} />
    </div>
  );
}
