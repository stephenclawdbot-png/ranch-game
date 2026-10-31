"use client";
/**
 * Tipsters: the weekly table of winners picked (points only, resets Monday 00:00 UTC), last
 * week's top 10 with their badge, the best weeks ever, and your own line. Points can never be
 * exchanged for anything.
 */
import { UsdgText } from "@/components/chain/UsdgMode";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, HowItWorks, PageHeader, Section } from "../ui/Page";

interface Row {
  position: number;
  stableId: string;
  stableName: string;
  points: number;
  wins?: number;
  picks?: number;
  badge: boolean;
}
interface TipstersView {
  weekStartMs: number;
  week: Row[];
  lastWeek: { weekStartMs: number; top: Row[] };
  allTime: { stableId: string; stableName: string; points: number; weekStartMs: number }[];
  me: { week: { points: number; wins: number; picks: number; position: number | null }; bestWeek: number; allTimePoints: number; streak: { current: number; best: number }; badges: number } | null;
  myStableId: string | null;
  rules: { top: number; outsider: number; badgeTop: number };
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function TipstersScreen() {
  const [v, setV] = useState<TipstersView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/tipsters", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setV(await r.json());
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  const myId = v?.myStableId ?? null;

  return (
    <div className="grid gap-5" data-testid="tipsters">
      <PageHeader scene="grandstand" eyebrow="Club" title="Tipsters" meta="Pick the winner of any Live race. Points only: nothing to stake, nothing to win but bragging rights." />
      {err && <p className="surface p-3 text-negative">{err}</p>}
      {!v && !err && <p className="surface caption p-3" aria-busy>Loading…</p>}
      {v && (
        <>
          {v.me && (
            <section className="surface grid grid-cols-2 divide-x-2 divide-dotted divide-paper-rule p-2 sm:grid-cols-4" aria-label="Your tipster line" data-testid="tipster-me">
              <Stat label="This week" value={`${v.me.week.points} pts`} sub={v.me.week.position ? `${v.me.week.position}${suffix(v.me.week.position)} · ${v.me.week.wins}/${v.me.week.picks} won` : `${v.me.week.picks} scored`} />
              <Stat label="Best week" value={`${v.me.bestWeek} pts`} sub={`${v.me.allTimePoints} pts all time`} />
              <Stat label="Winners in a row" value={String(v.me.streak.current)} sub={`best run ${v.me.streak.best}`} />
              <Stat label="Top-10 badges" value={String(v.me.badges)} sub="weekly top 10" />
            </section>
          )}

          <Section id="week-h" title={`This week (from ${day(v.weekStartMs)})`} testId="tipster-week">
            {v.week.length === 0 ? (
              <EmptyState icon="binoculars" title="No winners picked yet this week" text="Open a race on the card and pick a runner before the off." action={<Link href="/races" className="btn btn-sm">Race card</Link>} />
            ) : (
              <Table rows={v.week} myId={myId} showRecord />
            )}
          </Section>

          {v.lastWeek.top.length > 0 && (
            <Section id="last-h" title={`Last week's top ${v.rules.badgeTop}`} testId="tipster-last">
              <Table rows={v.lastWeek.top} myId={myId} />
            </Section>
          )}

          {v.allTime.length > 0 && (
            <Section id="best-h" title="Best weeks ever" testId="tipster-best">
              <ol className="surface rows !p-0">
                {v.allTime.map((r, i) => (
                  <li key={r.stableId} className={`flex items-center gap-3 px-4 py-2 text-sm ${r.stableId === myId ? "bg-brass/10" : ""}`}>
                    <span className="num w-6 text-cream-dim">{i + 1}</span>
                    <Link href={`/stables/${r.stableId}`} className="min-w-0 flex-1 truncate font-bold underline-offset-2 hover:underline">
                      {r.stableName}
                    </Link>
                    <span className="caption shrink-0">week of {day(r.weekStartMs)}</span>
                    <span className="num shrink-0 font-bold">{r.points} pts</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          <HowItWorks>
            <p>
              Open any Live race on the card and pick one runner to win. Picks open when the race is published and close at the off; you can change your mind until then.
            </p>
            <p>
              A winning pick scores by how unlikely it looked: runners are ranked by official rating within the field at the off. The top-rated runner scores {v.rules.top} points, the lowest-rated {v.rules.outsider}, and the rest in between. A losing pick scores nothing and costs nothing. A pick on a runner that doesn&apos;t run doesn&apos;t count.
            </p>
            <p>Points are added once the race&apos;s result is public, after the broadcast. The table resets every Monday at 00:00 UTC; the week&apos;s top {v.rules.badgeTop} get a badge.</p>
            <p className="font-bold">
              Points are just for fun. <UsdgText>They can never be exchanged for credits, USDG, money or anything else, and there is nothing to stake.</UsdgText>{" "}
              <Link href="/wiki/picks-and-tipsters" className="link">
                More in the wiki
              </Link>
              .
            </p>
          </HowItWorks>
        </>
      )}
    </div>
  );
}

const suffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));

function Table({ rows, myId, showRecord = false }: { rows: Row[]; myId: string | null; showRecord?: boolean }) {
  return (
    <ol className="surface rows !p-0" data-testid="tipster-table">
      {rows.map((r) => (
        <li key={r.stableId} className={`flex items-center gap-3 px-4 py-2 text-sm ${r.stableId === myId ? "bg-brass/10" : ""}`} data-testid="tipster-row">
          <span className="num w-6 shrink-0 text-cream-dim">{r.position}</span>
          <Link href={`/stables/${r.stableId}`} className="min-w-0 flex-1 truncate font-bold underline-offset-2 hover:underline">
            {r.stableName}
          </Link>
          {r.badge && <span className="tag tag-good shrink-0">Top 10</span>}
          {showRecord && r.picks !== undefined && (
            <span className="caption hidden shrink-0 sm:inline">
              {r.wins}/{r.picks} won
            </span>
          )}
          <span className="num shrink-0 font-bold">{r.points} pts</span>
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="grid place-items-center gap-0.5 px-2 py-2 text-center">
      <span className="eyebrow">{label}</span>
      <span className="num text-lg font-extrabold text-cream">{value}</span>
      {sub && <span className="caption">{sub}</span>}
    </div>
  );
}
