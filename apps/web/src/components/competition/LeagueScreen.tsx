import Link from "next/link";
import type { LeagueView, LeagueRowView, SeasonRowView } from "@/lib/competitionTypes";
import { SURFACE_LABEL, formatDistance, ordinal } from "@/lib/format";
import { LocalTime, TimeLeft } from "./LocalTime";
import { StableBadge } from "../StableBadge";
import { PixelIcon } from "../icons";
import { tierLabel } from "./bits";
import { DateBlock } from "./LocalTime";
import { HowItWorks, SceneBand } from "../ui/Page";

function zoneText(z: LeagueRowView["zone"]): string {
  return z === "promote" ? "▲ Promotion" : z === "relegate" ? "▼ Relegation" : "";
}

function LeagueRow({ r }: { r: LeagueRowView }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${r.mine ? "yours bg-paper-2" : ""}`} data-testid="league-row" data-mine={r.mine || undefined} data-zone={r.zone ?? undefined}>
      <span className="num w-8 shrink-0 text-right text-lg text-cream">{r.rank}</span>
      <StableBadge silks={r.silks} photoUrl={r.photoUrl} cap={false} className="h-[26px] w-8 shrink-0" />
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
      <StableBadge silks={r.silks} photoUrl={r.photoUrl} cap={false} className="h-[26px] w-8 shrink-0" />
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

/**
 * The not-yet-joined state: the rules in three lines (their own numbers), the tier the viewer
 * will start in, the runs they've already made that would score, and who leads each tier —
 * never a blank column. (Playtest fix 6: the first competitive screen showed a vacuum.)
 */
function LeagueProspect({ view, signedIn }: { view: LeagueView; signedIn: boolean }) {
  const p = view.prospect;
  const scored = view.tiersTop.some((t) => t.points > 0);
  return (
    <div className="grid gap-4" data-testid="league-prospect">
      <section className="surface grid gap-3 p-4" aria-labelledby="prospect-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="prospect-h" className="t-h2">
              You&rsquo;re not in a league yet
            </h3>
            <p className="t-meta" data-testid="prospect-start">
              {signedIn ? "Enter any Live race this week and you join one. Every stable starts in the Bronze league." : "Found a stable and enter any Live race: every stable starts in the Bronze league."}
            </p>
          </div>
          <Link href={signedIn ? "/races" : "/play"} className="btn btn-sm shrink-0">
            {signedIn ? "See the race card" : "Found your stable"}
          </Link>
        </div>
        <ol className="grid gap-1.5 border-t-2 border-dotted border-line pt-3 text-[0.9375rem]">
          <li>
            Leagues are groups of up to {view.capacity} owners in one tier. Only Live races score: {view.rules.startPoint} point for starting, plus {view.rules.racePoints.join(" / ")} for 1st down to {view.rules.racePoints.length}th (fields of 4 or more).
          </li>
          <li>
            At most {view.rules.weeklyCap} points a week, and only your best {view.rules.bestRuns} runs count — racing more can&rsquo;t buy a league.
          </li>
          <li>
            When the week ends, the top {view.promote} go up a tier and the bottom {view.relegate} who raced go down; {view.rules.floorTiers.length ? `${view.rules.floorTiers.map(tierLabel).join(" and ")} are floors, so being away never drops you` : "the bottom tier never relegates"}.
          </li>
        </ol>
      </section>

      {p && (
        <section className="surface grid gap-2 p-4" aria-labelledby="prospect-runs-h" data-testid="prospect-runs">
          <h3 id="prospect-runs-h" className="t-h2">
            Your runs so far this season
          </h3>
          {p.best.length ? (
            <>
              <ul className="grid gap-1">
                {p.best.map((r) => (
                  <li key={r.label} className="flex items-baseline justify-between gap-2 border-t-2 border-dotted border-line pt-1 text-sm">
                    <span className="font-bold">{r.label}</span>
                    <span className="num shrink-0 text-cream">
                      {r.points} {r.points === 1 ? "pt" : "pts"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="caption">
                {p.runsThisSeason} Live {p.runsThisSeason === 1 ? "run" : "runs"} this season, {p.seasonPoints} season {p.seasonPoints === 1 ? "point" : "points"} — exactly these would count in your league.
              </p>
            </>
          ) : (
            <p className="caption">No Live runs yet this season: Story races don&rsquo;t score, Live races do. Your first one joins the week&rsquo;s league.</p>
          )}
        </section>
      )}

      <section className="surface grid gap-2 p-4" aria-labelledby="prospect-tiers-h" data-testid="prospect-tiers">
        <h3 id="prospect-tiers-h" className="t-h2">
          Top of each tier this week
        </h3>
        {view.tiersTop.length && scored ? (
          <ul className="grid gap-1">
            {view.tiersTop.map((t) => (
              <li key={t.tierName} className="flex items-center gap-3 border-t-2 border-dotted border-line pt-1">
                <span className={`tier-badge tier-${t.tierName} shrink-0`} aria-hidden>
                  <PixelIcon name={t.tierName === "bronze" ? "badge-bronze" : t.tierName === "silver" ? "badge-silver" : "badge-gold"} size={32} />
                </span>
                <span className="w-14 shrink-0 font-extrabold text-cream-dim">{tierLabel(t.tierName)}</span>
                <StableBadge silks={t.silks} photoUrl={t.photoUrl} cap={false} className="h-[26px] w-8 shrink-0" />
                <span className="t-title min-w-0 flex-1 truncate text-cream">{t.stableName}</span>
                <span className="num shrink-0 text-cream">
                  {t.points} {t.points === 1 ? "pt" : "pts"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-meta" data-testid="prospect-no-points">
            <b>Season starts Monday.</b> Nothing has been scored yet — league weeks run Monday to Sunday, and the first settled Live race puts the first owner on the board.
          </p>
        )}
      </section>
    </div>
  );
}

export function LeagueScreen({ view, signedIn }: { view: LeagueView; signedIn: boolean }) {
  const rows = view.rows;
  const mine = rows.find((r) => r.mine);
  const lastWeek = view.history[0];
  return (
    <div>
      <SceneBand scene="club-lawn" alt="Members on the clubhouse lawn beside the league board" eyebrow={`Club · season ${view.season.number}`} title="League" />

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
              {view.joined ? `Tier ${view.tier} of ${view.tierCount} · week of ${view.weekStart}` : `You'll start in ${tierLabel(view.tierName)} (tier ${view.tier} of ${view.tierCount}) · week of ${view.weekStart}`}
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
            <LeagueProspect view={view} signedIn={signedIn} />
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
