import type { Metadata } from "next";
import Link from "next/link";
import { JockeyRow } from "@/components/jockeys/JockeyBits";
import { JockeyTable } from "@/components/jockeys/JockeyTable";
import { EmptyState, HowItWorks, SceneBand, Section } from "@/components/ui/Page";
import { JOCKEY_POOL_PER_ACTIVE_STABLE, JOCKEYS_PER_STABLE_MAX } from "@thoroughbred/game-core";
import { db } from "@/server/db";
import { jockeysPage, type JockeyFilter } from "@/server/jockeys";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jockeys" };

const FILTERS: { key: JockeyFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "freelancers", label: "Freelancers" },
  { key: "prospects", label: "Prospects" },
  { key: "mine", label: "My jockeys" },
];

export default async function JockeysPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? "all") as JockeyFilter;
  const database = await db();
  const session = await getSession(database);
  const view = await jockeysPage(database, session, filter, new Date());
  return (
    <div>
      <SceneBand scene="paddock" alt="Jockeys in the paddock" eyebrow={`Season ${view.season}`} title="Jockeys" testId="jockeys-band" />
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <nav className="-mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-3" aria-label="Filter jockeys">
            {FILTERS.filter((f) => f.key !== "mine" || view.signedIn).map((f) => (
              <Link key={f.key} href={f.key === "all" ? "/jockeys" : `/jockeys?filter=${f.key}`} className="fchip" aria-pressed={filter === f.key} aria-current={filter === f.key ? "page" : undefined}>
                {f.label}
              </Link>
            ))}
          </nav>
          {view.jockeys.length ? (
            <JockeyTable jockeys={view.jockeys} />
          ) : (
            <EmptyState icon="horseshoe" title="No jockeys here" text={filter === "mine" ? "Every stable starts with an apprentice; sign a freelancer from the Club pool." : "Check back after the weekly intake."} />
          )}
          <HowItWorks className="mt-4">
            <p>
              Jockeys are riders with careers of their own: an apprentice season, a prime of about three seasons, then a veteran stage before they retire (announced two weeks ahead). Skills grow
              with rides, fastest in bigger races, up to a hidden potential that narrows as they ride.
            </p>
            <p className="mt-2">
              A stable holds up to {JOCKEYS_PER_STABLE_MAX}. Your own jockeys ride your horses free; Club freelancers ride for a fee by grade and purse. New apprentices join each week to keep about{" "}
              {JOCKEY_POOL_PER_ACTIVE_STABLE} jockeys per active stable. <Link href="/wiki/jockeys" className="underline">More in the wiki</Link>.
            </p>
          </HowItWorks>
        </div>
        <aside className="min-w-0">
          {/* Before this season's first winner the season table is all zeros: lead with career
              winners instead of an empty column (playtest fix 13). */}
          {view.leaderboard.length && view.leaderboard.some((b) => b.wins > 0) ? (
            <Section title="Leading jockeys" className="!mt-0">
              <ol className="surface rows" data-testid="jockey-leaderboard">
                {view.leaderboard.map((b) => (
                  <JockeyRow key={b.jockey.id} j={b.jockey} extra={`${b.wins}/${b.rides}`} caption="this season" />
                ))}
              </ol>
            </Section>
          ) : (
            <Section title="Leading jockeys · career" className="!mt-0">
              {view.careerLeaders.length ? (
                <ol className="surface rows" data-testid="jockey-career-board">
                  {view.careerLeaders.map((j) => (
                    <JockeyRow key={j.id} j={j} extra={j.wins} caption="career wins" />
                  ))}
                </ol>
              ) : (
                <EmptyState icon="laurel" title="No winners yet" text="The table fills as this season's races are run." />
              )}
              <p className="caption mt-2">No winner this season yet: the career table leads until the first one crosses the line.</p>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
