import Link from "next/link";
import type { LeagueView, LeagueRowView, SeasonRowView } from "@/lib/competitionTypes";
import { SURFACE_LABEL, formatDistance, ordinal } from "@/lib/format";
import { LocalTime, TimeLeft } from "./LocalTime";
import { Silks } from "../Silks";
import { PixelIcon } from "../icons";
import { tierLabel } from "./bits";

function zoneText(z: LeagueRowView["zone"]): string {
  return z === "promote" ? "▲ Promotion" : z === "relegate" ? "▼ Relegation" : "";
}

function LeagueRow({ r }: { r: LeagueRowView }) {
  return (
    <li className={`flex items-center gap-3 px-3 py-2 ${r.mine ? "surface-2" : ""}`} data-testid="league-row" data-mine={r.mine || undefined} data-zone={r.zone ?? undefined}>
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
    <li className={`flex items-center gap-3 px-3 py-2 ${r.mine ? "surface-2" : ""}`} data-testid="season-row">
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
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Weekly · season {view.season.number}</p>
        <h1 className="t-display-xl">League</h1>
        <p className="mt-1 max-w-2xl text-lg text-cream-dim">
          Owners race in leagues of up to {view.capacity}. Points come from your Live races; the top {view.promote} go up at the end of the week and the bottom {view.relegate} who
          raced go down. If you&rsquo;re away, you never drop.
        </p>
      </header>

      <section className="frame-hero grid gap-3 p-3 sm:p-4" aria-labelledby="my-league-h">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="my-league-h" className="t-display-m" data-testid="league-title">
              {view.joined ? `${tierLabel(view.tierName)} League · group ${view.group}` : "Your league"}
            </h2>
            <p className="t-meta">
              Tier {view.tier} of {view.tierCount} · week of {view.weekStart}
              {mine ? ` · you're ${ordinal(mine.rank)} with ${mine.points} pts` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="label text-cream-dim">Week ends in</p>
            <p className="score text-[2.5rem] leading-none text-cream">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="table-h" className="min-w-0">
          <div className="mb-2 flex items-end justify-between gap-2">
            <h2 id="table-h" className="t-display-m">
              This week
            </h2>
            <p className="caption">▲ promotion · ▼ relegation zone</p>
          </div>
          {view.joined ? (
            <ol className="surface rows" data-testid="league-table">
              {rows.map((r) => (
                <LeagueRow key={`${r.rank}-${r.stableName}`} r={r} />
              ))}
            </ol>
          ) : (
            <div className="surface grid gap-3 p-4" data-testid="league-empty">
              <p className="text-cream">
                {signedIn ? "Race in any Live race this week to join a league. You start in Bronze." : "Found a stable and race Live to join a league."}
              </p>
              <Link href={signedIn ? "/races" : "/play"} className="btn btn-brass w-fit">
                <PixelIcon name="flag" size={20} /> {signedIn ? "See the race card" : "Found your stable"}
              </Link>
            </div>
          )}
          <details className="surface mt-3">
            <summary className="flex min-h-12 items-center px-3 font-extrabold">How points work</summary>
            <div className="border-t-2 border-line p-3 text-cream-dim">
              <p>
                Every settled Live race scores {view.rules.startPoint} for starting, plus {view.rules.racePoints.join(" / ")} for 1st to {view.rules.racePoints.length}th (fields of 4 or
                more). Listed and Group places score extra. At most {view.rules.weeklyCap} points a week, so racing more can&rsquo;t buy a league.
              </p>
            </div>
          </details>
        </section>

        <aside className="grid content-start gap-4">
          <section className="surface p-3" aria-labelledby="season-h">
            <h2 id="season-h" className="t-display-m mb-1">
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
              <p className="text-cream-dim">No Live results this season yet.</p>
            )}
          </section>
          <section className="surface p-3" aria-labelledby="cal-h">
            <h2 id="cal-h" className="t-display-m mb-1">
              Big days
            </h2>
            <p className="caption mb-2 text-cream-dim">On the Live card. Weekend Features and Season Finals need a Classics licence; qualifiers a National licence.</p>
            <ul className="grid gap-2" data-testid="league-calendar">
              {view.calendar.map((c) => (
                <li key={c.id} className="inset px-3 py-2">
                  <p className="font-extrabold text-cream">{c.name}</p>
                  <p className="t-meta">
                    {KIND_LABEL[c.kind]} · <LocalTime ms={c.postTimeMs} withDate /> · {formatDistance(c.distanceM)} {SURFACE_LABEL[c.surface].toLowerCase()}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {view.history.length > 0 && (
            <section className="surface p-3" aria-labelledby="hist-h">
              <h2 id="hist-h" className="t-display-m mb-2">
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
