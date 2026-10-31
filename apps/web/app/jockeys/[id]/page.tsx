import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/competition/LocalTime";
import { JockeyActions } from "@/components/jockeys/JockeyActions";
import { JockeyOffer } from "@/components/jockeys/JockeyOffer";
import { ContractRows } from "@/components/jockeys/JockeyBits";
import { SkillBar, STAGE_LABEL } from "@/components/jockeys/JockeyBits";
import { JockeyPortrait } from "@/components/jockeys/JockeyPortrait";
import { GradeBadge } from "@/components/StatBars";
import { PageHeader, Section } from "@/components/ui/Page";
import { db } from "@/server/db";
import { jockeyPage } from "@/server/jockeys";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jockey" };

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export default async function JockeyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = await db();
  const session = await getSession(database);
  const view = await jockeyPage(database, session, decodeURIComponent(id), new Date());
  if (!view) notFound();
  const j = view.jockey;
  return (
    <div>
      <PageHeader back={{ href: "/jockeys", label: "Jockeys" }} eyebrow={`${STAGE_LABEL[j.stage]} · ${j.stableName ?? "Club freelancer"}`} title={j.name} />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="surface flex items-center gap-4 p-4" data-testid="jockey-header">
            <span className="well grid shrink-0 place-items-center overflow-hidden p-1">
              <JockeyPortrait silks={j.silks} scale={2} />
            </span>
            <span className="grid min-w-0 gap-1">
              <span className="flex items-center gap-2">
                <GradeBadge grade={j.grade} size="lg" />
                <span className="t-meta">potential {j.potential}</span>
              </span>
              <span className="t-meta">
                {j.wins} wins from {j.rides} rides · {j.winsThisSeason} this season
              </span>
              {j.claimLb > 0 && <span className="t-meta">Claims {j.claimLb} lb in handicaps</span>}
              <span className="t-meta" title={j.personality.blurb}>
                {j.personality.label}: {j.personality.blurb}
              </span>
              {!j.retired && view.market.wants.length > 0 && (
                <span className="t-meta" data-testid="jockey-wants">
                  <b>Wants:</b> {view.market.wants.join(" · ")}
                </span>
              )}
              {view.market.developedAt && (
                <span className="t-meta" data-testid="jockey-developed">
                  Developed at <Link href={`/stables/${view.market.developedAt.stableId}`} className="underline">{view.market.developedAt.name}</Link>
                </span>
              )}
              {j.retired ? (
                <span className="tag">Retired</span>
              ) : j.retiring ? (
                <span className="tag" data-testid="jockey-retiring">
                  Retires <LocalTime ms={Date.parse(j.retireAt)} withDate />
                </span>
              ) : null}
            </span>
          </div>
          {view.market.freeAgent && (
            <p className="tag mt-3" data-testid="jockey-free-agent">
              Free agent: the <Link href="/jockeys/window" className="underline">transfer window</Link> closes <LocalTime ms={view.market.deadlineMs} withDate />
            </p>
          )}
          <div className="mt-3">
            <JockeyActions id={j.id} name={j.name} {...view.actions} />
          </div>
          {view.market.freeAgent && view.signedIn && (
            <div className="mt-3">{view.market.offerBlock && !view.market.myOffer ? <p className="t-meta">{view.market.offerBlock}</p> : <JockeyOffer id={j.id} name={j.name} market={view.market} />}</div>
          )}
          {view.market.contract && (
            <Section title="Contract">
              <ul className="surface rows" data-testid="jockey-contract">
                <ContractRows c={view.market.contract} mine={j.mine} />
              </ul>
            </Section>
          )}
          <Section title="Skills">
            <ul className="surface rows">
              {j.skills.map((s) => (
                <SkillBar key={s.key} s={s} />
              ))}
            </ul>
          </Section>
        </div>
        <div className="min-w-0">
          <Section title="Recent rides" className="md:!mt-0">
            {view.rides.length ? (
              <ul className="surface rows" data-testid="jockey-rides">
                {view.rides.map((r) => (
                  <li key={r.raceId}>
                    <Link href={`/race/${r.raceId}`} className="row-link gap-3 px-3 py-2">
                      <span className="score w-10 shrink-0 text-center text-[1.25rem]">{r.position ? ordinal(r.position) : "–"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="t-title block truncate">{r.horseName}</span>
                        <span className="t-meta block truncate">
                          {r.raceName}
                          {r.stableName ? ` · ${r.stableName}` : " · Club"}
                          {r.claimLb > 0 ? ` · claimed ${r.claimLb} lb` : ""}
                        </span>
                      </span>
                      <span className="chev">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta">No rides yet.</p>
            )}
          </Section>
          <Section title="Career">
            <ol className="surface rows" data-testid="jockey-career">
              {view.career.map((e, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className="t-meta w-28 shrink-0">
                    <LocalTime ms={Date.parse(e.at)} withDate />
                  </span>
                  <span className="min-w-0 flex-1">{e.text}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
