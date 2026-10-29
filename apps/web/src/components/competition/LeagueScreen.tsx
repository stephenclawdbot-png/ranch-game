import Link from "next/link";
import type { LeagueView, LeagueRowView, SeasonRowView } from "@/lib/competitionTypes";
import { SURFACE_LABEL, formatDistance, ordinal } from "@/lib/format";
import { LocalTime, TimeLeft } from "./LocalTime";
import { Silks } from "../Silks";
import { PixelIcon } from "../icons";
import { tierLabel } from "./bits";
import { DateBlock } from "./LocalTime";
import { EmptyState, HowItWorks, SceneBand } from "../ui/Page";

function zoneText(z: LeagueRowView["zone"]): string {
  return z === "promote" ? "▲ Promotion" : z === "relegate" ? "▼ Relegation" : "";
}

function LeagueRow({ r }: { r: LeagueRowView }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${r.mine ? "yours bg-paper-2" : ""}`} data-testid="league-row" data-mine={r.mine || undefined} data-zone={r.zone ?? undefined}>
      <span className="num w-8 shrink-0 text-right text-lg text-cream">{r.rank}</span>
      <Silks silks={r.silks} cap={false} className="h-[26px] w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="t-title truncate text-cream">
          {r.stableName}
          {r.mine && <span className="you-tag ml-2 align-middle">You</span>}
        </p>
        <p className="t-meta">
          {r.runs} {r.runs === 1 ? "run" : "runs"} · {r.wins} {r.wins === 1 ? "win" : "wins"}
          {r.zone && <span className={`ml-2 font-extrabold ${r.zone === "promote" ? "text-positive" : "text-negative"}`}>{zoneText(r.zone)}</span>}
        </p>
      </div>
      <span className="num shrink-0 text-xl text-cream">{r.points}</span>
    </li>
  );
}

function SeasonRow({ r }: { r: SeasonRowView }) {
  return (
    <li className={`flex items-center gap-3 px-2 py-2 ${r.mine ? "yours bg-paper-2" : ""}`} data-testid="season-row">
      <span className="num w-8 shrink-0 text-right text-lg text-cream">{r.rank}</span>
      <Silks silks={r.silks} cap={false} className="h-[26px] w-8 shrink-0" />
      <p className="t-title min-w-0 flex-1 truncate text-cream">
        {r.stableName}
        {r.mine && <span className="you-tag ml-2 align-middle">You</span>}
      </p>
      <span className="caption shrink-0 text-cream-dim">{r.wins}W</span>
      <span className="num w-12 shrink-0 text-right text-xl text-cream">{r.points}</span>
    </li>
  );
}

const KIND_LABEL: Record<LeagueView["calendar"][number]["kind"], string> = {
  weekend_feature: "Weekend Feature",
  feature_qualifier: "Qualifier",
  season_final: "Season Final",
};

export function LeagueScreen({ view, signedIn }: { view: LeagueView; signedIn: boolean }) {
  const rows = view.rows;
  const mine = rows.find((r) => r.mine);
  const lastWeek = view.history[0];
  return (
    <div>
      <SceneBand scene="paddock" alt="The paddock at Kestrel Downs" eyebrow={`Club · season ${view.season.number}`} title="League" />

      <section className="frame-hero mt-4 grid gap-3 p-4 sm:p-5" aria-labelledby="my-league-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`tier-badge tier-${view.joined ? view.tierName : "none"}`} aria-hidden>
              <PixelIcon name={view.tierName === "bronze" ? "badge-bronze" : view.tierName === "silver" ? "badge-silver" : "badge-gold"} size={64} />
            </span>
            <div className="min-w-0">
            <h2 id="my-league-h" className="t-hero" data-testid="league-title">
              {view.joined ? `${tierLabel(view.tierName)} League · group ${view.group}` : "Your league"}
            </h2>
            <p className="t-meta">
              Tier {view.tier} of {view.tierCount} · week of {view.weekStart}
              {mine ? ` · you're ${ordinal(mine.rank)} with ${mine.points} pts` : ""}
            </p>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="label">Week ends in</p>
            <p className="score text-[2.5rem] leading-none">
              <TimeLeft targetMs={view.weekEndsAtMs} />
            </p>
          </div>
        </div>
        {lastWeek && lastWeek.movement !== null && (
          <p className="text-cream" data-testid="league-last-week">
            Last week: {lastWeek.finalRank ? `${ordinal(lastWeek.finalRank)} place` : "finished"} in {tierLabel(lastWeek.tierName)} with {lastWeek.points} pts
            {lastWeek.movement > 0 ? ": promoted ▲" : lastWeek.movement < 0 ? ": relegated ▼" : ": stayed put"}
          </p>
        )}
      </section>

      <HowItWorks className="mt-3">
        <p>
          Owners race in leagues of up to {view.capacity}. Points come from your Live races; at the end of the week the top {view.promote} go up and the bottom {view.relegate} who
          raced go down. If you&rsquo;re away, you never drop.
        </p>
        <p>
          Every settled Live race scores {view.rules.startPoint} for starting, plus {view.rules.racePoints.join(" / ")} for 1st to {view.rules.racePoints.length}th (fields of 4 or more).
          Listed and Group places score extra. At most {view.rules.weeklyCap} points a week, so racing more can&rsquo;t buy a league.
        </p>
      </HowItWorks>

      <div className="section grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="table-h" className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="table-h" className="t-h2">
              This week
            </h2>
            <p className="eyebrow">▲ up · ▼ down</p>
          </div>
          {view.joined ? (
            <ol className="surface rows" data-testid="league-table">
              {rows.map((r) => (
                <LeagueRow key={`${r.rank}-${r.stableName}`} r={r} />
              ))}
            </ol>
          ) : (
            <EmptyState
              icon="badge-bronze"
              testId="league-empty"
              title="You're not in a league yet"
              text={signedIn ? "Race in any Live race this week to join one. You start in Bronze." : "Found a stable and race Live to join a league."}
              action={
                <Link href={signedIn ? "/races" : "/play"} className="btn btn-sm">
                  {signedIn ? "See the race card" : "Found your stable"}
                </Link>
              }
            />
          )}
        </section>

        <aside className="grid content-start gap-4">
          <section className="surface p-4" aria-labelledby="season-h">
            <h2 id="season-h" className="t-h2 mb-1">
              Season {view.season.number}
            </h2>
            <p className="caption mb-2 text-cream-dim">
              {view.season.owners} {view.season.owners === 1 ? "owner has" : "owners have"} scored. Ends <LocalTime ms={view.season.endsAtMs} withDate />.
            </p>
            {view.season.rows.length ? (
              <ol className="rows" data-testid="season-table">
                {view.season.rows.map((r) => (
                  <SeasonRow key={`${r.rank}-${r.stableName}`} r={r} />
                ))}
                {view.season.mine && !view.season.rows.some((r) => r.mine) && <SeasonRow r={view.season.mine} />}
              </ol>
            ) : (
              <p className="t-meta">No Live results this season yet. The first Live race you finish puts you on this table.</p>
            )}
          </section>
          <section aria-labelledby="cal-h">
            <h2 id="cal-h" className="t-h2 mb-3">
              Big days
            </h2>
            <ul className="surface rows" data-testid="league-calendar">
              {view.calendar.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <DateBlock ms={c.postTimeMs} />
                  <div className="min-w-0">
                    <p className="t-title">{c.name}</p>
                    <p className="t-meta">
                      {KIND_LABEL[c.kind]} · {formatDistance(c.distanceM)} {SURFACE_LABEL[c.surface].toLowerCase()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="caption mt-2">Features and Finals need a Classics licence; qualifiers a National licence.</p>
          </section>
          {view.history.length > 0 && (
            <section className="surface p-4" aria-labelledby="hist-h">
              <h2 id="hist-h" className="t-h2 mb-2">
                Past weeks
              </h2>
              <ul className="grid gap-1">
                {view.history.map((h) => (
                  <li key={h.weekStart} className="flex justify-between gap-2 text-sm">
                    <span className="text-cream-dim">{h.weekStart}</span>
                    <span className="text-cream">
                      {tierLabel(h.tierName)} · {h.finalRank ?? "–"} · {h.points} pts {h.movement && h.movement > 0 ? "▲" : h.movement && h.movement < 0 ? "▼" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
