/**
 * Road to Saturday (beta loop): the week's target race and how to get in. Monday shows
 * Saturday's trip and the likely going (the real going once the race is on the card); Mon-Fri Feature Qualifiers (a top 3 gets a horse in, or a rating of
 * 100+); the Saturday Plate catches the horses that tried and missed; the League line shows the
 * gap to promotion. Honest near-misses: real places and points, nothing manufactured.
 */
import Link from "next/link";
import { CARD_HORIZON_MS, MS_PER_HOUR } from "@thoroughbred/game-core";
import type { WeekView } from "@/lib/competitionTypes";
import { formatCredits, formatDistance } from "@/lib/format";
import { PixelIcon } from "../icons";
import { SceneBand } from "../ui/Page";
import { GroundWeather } from "./GroundWeather";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

const STATUS: Record<WeekView["horses"][number]["status"], { text: string; cls: string }> = {
  qualified: { text: "In for Saturday", cls: "chip chip-brass" },
  plate: { text: "Saturday Plate", cls: "chip chip-cream" },
  not_yet: { text: "Not qualified yet", cls: "chip" },
};

export function RoadToSaturday({ view }: { view: WeekView }) {
  const f = view.feature;
  return (
    <div className="grid gap-5" data-testid="road-to-saturday">
      <SceneBand scene="grandstand" alt="The grandstand on Feature day" eyebrow="This week" title="Road to Saturday" testId="week-band" />

      <p className="surface p-4 text-lg font-bold text-cream" data-testid="week-headline">
        {view.headline}
      </p>

      <section className="surface grid gap-3 p-4" aria-labelledby="wf-h">
        <h2 id="wf-h" className="t-h2 flex items-center gap-2">
          <PixelIcon name="trophy" size={32} />
          {f ? f.name : view.finalDay ? "Season Final day" : "No Feature this week"}
        </h2>
        {f && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4" data-testid="week-conditions">
            <div>
              <dt className="label">When</dt>
              <dd className="font-bold">
                {day(f.postTimeMs)} · {clock(f.postTimeMs)}
              </dd>
            </div>
            <div>
              <dt className="label">Trip</dt>
              <dd className="font-bold">
                {formatDistance(f.distanceM)} · {f.surface}
                {f.going ? ` · ${f.goingSettled ? "" : "likely "}${f.going}` : ""}
              </dd>
            </div>
            <div>
              <dt className="label">Purse</dt>
              <dd className="font-bold">{formatCredits(f.purse)} cr</dd>
            </div>
            <div>
              <dt className="label">How to get in</dt>
              <dd className="font-bold">Top 3 in a Qualifier, or rating 100+</dd>
            </div>
          </dl>
        )}
        {view.plate && (
          <p className="caption">
            Missed it? The <b>Saturday Plate</b> runs at {clock(view.plate.postTimeMs)} for horses that ran in this week&rsquo;s Qualifiers ({formatCredits(view.plate.purse)} cr).
          </p>
        )}
        {!view.licenceOk && (
          <p className="caption text-claret">
            Your stable needs the {view.licenceNeeded} for Saturday: earn it in <Link href="/story" className="link">Story mode</Link>.
          </p>
        )}
      </section>

      {view.qualifiers.length > 0 && (
        <section className="surface grid gap-2 p-4" aria-labelledby="q-h">
          <h2 id="q-h" className="t-h2">
            Feature Qualifiers
          </h2>
          <ol className="grid gap-1.5" data-testid="week-qualifiers">
            {view.qualifiers.map((q) => (
              <li key={q.postTimeMs} className={`flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-dotted border-line pt-1.5 ${q.done ? "text-cream-dim" : ""}`}>
                <span className="font-bold">
                  {day(q.postTimeMs)} · {clock(q.postTimeMs)}
                </span>
                <span className="text-sm">
                  {q.mine.length
                    ? q.mine.map((m) => `${m.horseName}: ${m.position ? ordinal(m.position) : "running"}`).join(" · ")
                    : q.done
                      ? "No runner"
                      : "Open: a top 3 qualifies"}
                </span>
              </li>
            ))}
          </ol>
          <p className="caption">
            Enter from the <Link href="/races" className="link">race card</Link>: Qualifiers are published {CARD_HORIZON_MS / MS_PER_HOUR} hours ahead, with the rest of the evening meeting.
          </p>
        </section>
      )}

      <GroundWeather ground={view.ground} />

      <section className="surface grid gap-2 p-4" aria-labelledby="h-h">
        <h2 id="h-h" className="t-h2">
          Your horses for Saturday
        </h2>
        {view.horses.length === 0 ? (
          <p className="caption">No horses racing yet.</p>
        ) : (
          <ul className="grid gap-1.5" data-testid="week-horses">
            {view.horses.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-dotted border-line pt-1.5">
                <Link href={`/horse/${h.id}`} className="link font-bold">
                  {h.name}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="t-meta">OR {h.rating}</span>
                  {h.fit && <span className="chip" title="Fit for Saturday's trip, surface and going">Fit {h.fit}</span>}
                  {h.bestQualifierFinish && <span className="t-meta">best qualifier {ordinal(h.bestQualifierFinish)}</span>}
                  <span className={STATUS[h.status].cls}>{h.via === "rating" ? "In by rating" : STATUS[h.status].text}</span>
                  {!h.canRaceToday && <span className="t-meta">raced today</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="caption" data-testid="week-upkeep">
        {view.upkeep.horses > 0
          ? `Upkeep this week so far: ${formatCredits(view.upkeep.due)} cr for ${view.upkeep.horses} ${view.upkeep.horses === 1 ? "horse" : "horses"} you used (charged after Sunday; horses you leave alone are free).`
          : "No upkeep this week yet: you pay only for horses you race, train or breed."}
      </p>

      {view.league && (
        <section className="surface grid gap-1 p-4" aria-labelledby="l-h" data-testid="week-league">
          <h2 id="l-h" className="t-h2">
            League this week
          </h2>
          <p className="font-bold">
            {ordinal(view.league.rank)} of {view.league.of} in {view.league.tierName[0]!.toUpperCase() + view.league.tierName.slice(1)} · {view.league.points} points
          </p>
          <p className="caption">
            {view.league.gapToPromotion === 0
              ? "In the promotion places: hold on until Sunday."
              : view.league.gapToPromotion !== null
                ? `${view.league.gapToPromotion} points from the promotion places. Only your best results count, so one good run can do it.`
                : "Race Live to score points."}
            {view.league.floor ? " No relegation from this tier." : ""}
          </p>
          <Link href="/league" className="link text-sm">
            Full table
          </Link>
        </section>
      )}
    </div>
  );
}
