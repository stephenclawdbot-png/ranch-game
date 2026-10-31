import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HorsePortrait } from "@/components/HorsePortrait";
import { TributeCard } from "@/components/moments/TributeCard";
import { PageHeader } from "@/components/ui/Page";
import { db } from "@/server/db";
import { legacyFarmView } from "@/server/moments";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Legacy Farm" };

/**
 * The Legacy Farm: every horse the stable has retired for good, each with its tribute card (the
 * record and the best win, one tap from its replay). A horse lost to a race injury gets a quiet
 * memorial instead: no celebration, no gamified tone.
 */
export default async function LegacyFarmPage() {
  const database = await db();
  const session = await getSession(database);
  if (!session) redirect("/play");
  const view = await legacyFarmView(database, session, new Date());
  return (
    <div className="mx-auto grid max-w-4xl gap-6" data-testid="legacy-farm">
      <PageHeader
        scene="paddock"
        back={{ href: "/stable", label: "Stable" }}
        eyebrow={view.stableName}
        title="The Legacy Farm"
        meta="Retired for good: no racing, no breeding, no upkeep. Their records stay in your books and the Hall."
      />
      {view.horses.length === 0 ? (
        <p className="surface p-4 text-cream-dim" data-testid="legacy-empty">
          No horses here yet. A horse moves to the Legacy Farm from its Career page when its racing and breeding days are done (see the{" "}
          <Link href="/wiki/legacy-farm" className="link">
            wiki
          </Link>
          ).
        </p>
      ) : (
        <ul className="grid gap-4">
          {view.horses.map((h) => (
            <li key={h.id} id={`h-${h.id}`} className="surface grid scroll-mt-24 gap-3 p-4 sm:grid-cols-[8rem_minmax(0,1fr)]" data-testid="legacy-horse">
              <Link href={`/horse/${h.id}`} className="well grid h-[128px] place-items-center overflow-hidden" aria-label={h.name}>
                <HorsePortrait appearance={h.appearance} scale={1} />
              </Link>
              <div className="grid min-w-0 gap-2">
                <p>
                  <Link href={`/horse/${h.id}`} className="t-title text-lg hover:underline">
                    {h.name}
                  </Link>{" "}
                  <span className="t-meta">{h.regNo}</span>
                </p>
                <TributeCard name={h.name} tribute={h.tribute} memorial={h.died} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
