import type { Metadata } from "next";
import Link from "next/link";
import { JOCKEY_CONTRACT_LENGTH_LABELS, JOCKEY_OPEN_OFFERS_PER_STABLE, JOCKEYS_PER_STABLE_MAX, type JockeyContractLength } from "@thoroughbred/game-core";
import { LocalTime } from "@/components/competition/LocalTime";
import { JockeyRow } from "@/components/jockeys/JockeyBits";
import { EmptyState, HowItWorks, PageHeader, Section } from "@/components/ui/Page";
import { formatCredits } from "@/lib/format";
import { db } from "@/server/db";
import { transferWindowPage } from "@/server/jockeys";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transfer window" };

const STATUS: Record<string, string> = { open: "Open", won: "Signed", lost: "Not taken", withdrawn: "Withdrawn" };

export default async function TransferWindowPage() {
  const database = await db();
  const session = await getSession(database);
  const view = await transferWindowPage(database, session, new Date());
  const last = view.last;
  return (
    <div>
      <PageHeader back={{ href: "/jockeys", label: "Jockeys" }} eyebrow="Jockeys" title="Transfer window" />
      <p className="t-meta" data-testid="window-deadline">
        Closes <LocalTime ms={view.deadlineMs} withDate /> (Sunday 20:00 UTC). Free agents choose between offers then.
      </p>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Section title={`Free agents this week (${view.freeAgents.length})`} className="!mt-0">
            {view.freeAgents.length ? (
              <ul className="surface rows" data-testid="window-free-agents">
                {view.freeAgents.map((f) => (
                  <JockeyRow
                    key={f.jockey.id}
                    j={{ ...f.jockey, stableName: f.from ? `${f.why} at ${f.from}` : f.why }}
                    extra={
                      <span>
                        {f.offers}
                        <span className="caption block">{f.offers === 1 ? "offer" : "offers"}</span>
                      </span>
                    }
                  />
                ))}
              </ul>
            ) : (
              <EmptyState icon="horseshoe" title="No free agents yet" text="Contracts ending, released jockeys and new apprentices appear here during the week." />
            )}
          </Section>
          <HowItWorks className="mt-4">
            <p>
              Free agents are jockeys whose contracts end this week, jockeys released or let go by idle stables, jockeys who couldn&apos;t be paid or were promised rides they didn&apos;t get,
              and the week&apos;s new apprentices. Open one to make an offer: a weekly wage, a length, rides promised a week and a buyout price. You can have {JOCKEY_OPEN_OFFERS_PER_STABLE} offers
              open; each holds the jockey&apos;s signing fee until the window closes and returns it if the jockey goes elsewhere.
            </p>
            <p className="mt-2">
              At the deadline every jockey takes the best offer it can get by its own personality (money-minded: the wage; ambitious: your horses and standing; loyal: time together; workhorse: the
              rides), with each stable filling at most its free places ({JOCKEYS_PER_STABLE_MAX} jockeys a stable). Exact ties are settled by a draw from the week&apos;s seed, published below in advance.
              Free agents with no taker join the Club pool. <Link href="/wiki/jockeys" className="underline">More in the wiki</Link>.
            </p>
          </HowItWorks>
        </div>
        <aside className="min-w-0">
          {view.signedIn && (
            <Section title={`Your offers (${view.openOffers} of ${view.maxOffers} open)`} className="!mt-0">
              {view.myOffers.length ? (
                <ul className="surface rows" data-testid="window-my-offers">
                  {view.myOffers.map((o) => (
                    <li key={`${o.jockeyId}-${o.status}-${o.thisWeek}`}>
                      <Link href={`/jockeys/${o.jockeyId}`} className="row-link gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="t-title block truncate">{o.jockeyName}</span>
                          <span className="t-meta block">
                            {formatCredits(o.wage)} cr/wk · {o.length} · {o.promisedRides} rides/wk{o.fee ? ` · ${formatCredits(o.fee)} cr held` : ""}
                          </span>
                        </span>
                        <span className={o.status === "won" ? "tag tag-good" : o.status === "open" ? "tag tag-ready" : "tag"}>{STATUS[o.status] ?? o.status}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="t-meta">No offers this week.</p>
              )}
            </Section>
          )}
          <Section title="Last window">
            {last ? (
              <div data-testid="window-last">
                <p className="t-meta">
                  Closed <LocalTime ms={Date.parse(last.closedAt)} withDate />: {last.freeAgents} free agents, {last.offers} offers, {last.signings.length} signed ({last.moves} moved), {last.unmatched} to the
                  Club pool.
                </p>
                {last.signings.length > 0 && (
                  <ul className="surface rows mt-2">
                    {last.signings.map((s) => (
                      <li key={s.jockeyId}>
                        <Link href={`/jockeys/${s.jockeyId}`} className="row-link gap-3 px-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="t-title block truncate">
                              {s.name} {s.fromStableId === s.toStableId ? "re-signs for" : "signs for"} {s.toStableName}
                            </span>
                            <span className="t-meta block">
                              {formatCredits(s.wage)} cr/wk · {JOCKEY_CONTRACT_LENGTH_LABELS[s.length as JockeyContractLength] ?? s.length} · {s.promisedRides} rides/wk
                              {s.fromStableName && s.fromStableId !== s.toStableId ? ` · from ${s.fromStableName}` : ""}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="caption mt-2 break-all">Seed {last.seed} · commitment {last.commitment}</p>
              </div>
            ) : (
              <p className="t-meta">No window has closed yet.</p>
            )}
            {view.commitment && <p className="caption mt-2 break-all">This week&apos;s seed commitment: {view.commitment}</p>}
          </Section>
        </aside>
      </div>
    </div>
  );
}
