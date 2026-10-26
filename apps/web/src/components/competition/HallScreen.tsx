import Link from "next/link";
import type { HallView } from "@/lib/competitionTypes";
import { SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { Silks } from "../Silks";
import { PixelIcon, type IconName } from "../icons";
import { EmptyState, SceneBand } from "../ui/Page";
import { LocalTime } from "./LocalTime";
import { RaceTime } from "./bits";

const CATEGORY: Record<string, string> = {
  champion: "Champion",
  season_winner: "Season winner",
  record_time: "Record holder",
  great_racehorse: "Great racehorse",
  foundation_sire: "Foundation sire",
  foundation_mare: "Foundation mare",
  elite_genetics: "Elite genetics",
};

function Empty({ children, title = "Nothing here yet", icon = "laurel" as IconName }: { children: React.ReactNode; title?: string; icon?: IconName }) {
  return <EmptyState icon={icon} title={title} text={children} />;
}

export function HallScreen({ view }: { view: HallView }) {
  const mine = view.mine;
  return (
    <div>
      <SceneBand scene="grandstand" alt="The grandstand at Kestrel Downs" eyebrow="Club · permanent honours" title="Hall of Fame" />
      <div className="mt-6 grid gap-8 md:gap-12">
      <section aria-labelledby="inducted-h">
        <h2 id="inducted-h" className="t-h2 mb-3">
          Inductees
        </h2>
        {view.inducted.length ? (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="hall-inducted">
            {view.inducted.map((e) => (
              <li key={e.key} className="surface flex items-start gap-3 p-3">
                <PixelIcon name="rosette" size={32} className="shrink-0" />
                <div className="min-w-0">
                  <p className="label text-brass-text">{CATEGORY[e.category] ?? e.category}</p>
                  <p className="t-title break-words text-cream">{e.horseId ? <Link href={`/horse/${e.horseId}`} className="hover:underline">{e.title}</Link> : e.title}</p>
                  <p className="caption text-cream-dim">
                    {e.stableName ? `${e.stableName} · ` : ""}
                    {e.season ? `Season ${e.season} · ` : ""}inducted <LocalTime ms={e.atMs} withDate />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No inductees yet" icon="medallion">
            Win Group races or a Season Final, or set a record time, to be the first. Inducted names are retired for good.
          </Empty>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="records-h" className="min-w-0">
          <h2 id="records-h" className="t-h2 mb-3">
            Record times
          </h2>
          {view.records.length ? (
            <ul className="surface rows" data-testid="hall-records">
              {view.records.map((r) => (
                <li key={`${r.surface}-${r.distanceM}`}>
                  <Link href={`/race/${r.raceId}`} className="row-link gap-3 px-3 py-2">
                    <span className="w-24 shrink-0">
                      <span className="block font-extrabold text-cream">{formatDistance(r.distanceM)}</span>
                      <span className="caption block text-cream-dim">{SURFACE_LABEL[r.surface]}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-title block truncate text-cream">{r.horseName}</span>
                      <span className="t-meta block truncate">{r.stableName}</span>
                    </span>
                    <RaceTime us={r.timeUs} className="shrink-0 font-extrabold text-brass-bright" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No records yet" icon="stopwatch">Records are set in Live races. The first winner at each trip and surface sets the time to beat.</Empty>
          )}
        </section>

        <section aria-labelledby="champs-h" className="min-w-0">
          <h2 id="champs-h" className="t-h2 mb-3">
            Champions
          </h2>
          {view.champions.length ? (
            <ol className="surface rows" data-testid="hall-champions">
              {view.champions.map((c, i) => (
                <li key={c.horseId}>
                  <Link href={`/horse/${c.horseId}`} className="row-link gap-3 px-3 py-2">
                    <span className="num w-7 shrink-0 text-right text-lg text-cream">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="t-title block truncate text-cream">
                        {c.name}
                        {c.retired && <span className="caption ml-2 text-cream-dim">retired</span>}
                      </span>
                      <span className="t-meta block truncate">
                        {c.stableName} · {c.liveWins} {c.liveWins === 1 ? "win" : "wins"} from {c.liveRuns}
                        {c.gradedWins ? ` · ${c.gradedWins} black-type` : ""} · {formatCredits(c.earnings)} cr
                      </span>
                    </span>
                    <span className="chip shrink-0">OR {c.rating}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="No champions yet" icon="trophy">The winningest Live horses appear here. Every Live win counts.</Empty>
          )}
        </section>

        <section aria-labelledby="seasons-h" className="min-w-0">
          <h2 id="seasons-h" className="t-h2 mb-3">
            Season winners
          </h2>
          {view.seasonWinners.length ? (
            <ul className="surface rows" data-testid="hall-seasons">
              {view.seasonWinners.map((s) => (
                <li key={s.season} className="flex items-center gap-3 px-3 py-2">
                  <PixelIcon name="trophy" size={24} className="shrink-0" />
                  <span className="min-w-0 flex-1 t-title truncate text-cream">{s.stableName}</span>
                  <span className="caption shrink-0 text-cream-dim">
                    Season {s.season} · {s.points} pts
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No season winners yet" icon="trophy-silver">The owner with the most league points in a season is inducted when it ends.</Empty>
          )}
        </section>

        <section aria-labelledby="blood-h" className="min-w-0">
          <h2 id="blood-h" className="t-h2 mb-3">
            Famous bloodlines
          </h2>
          {view.bloodlines.length ? (
            <ul className="surface rows" data-testid="hall-bloodlines">
              {view.bloodlines.map((b) => (
                <li key={b.horseId}>
                  <Link href={`/horse/${b.horseId}`} className="row-link gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="t-title block truncate text-cream">{b.name}</span>
                      <span className="t-meta block truncate">
                        {b.sex === "female" ? "Dam" : "Sire"} · {b.stableName}
                      </span>
                    </span>
                    <span className="caption shrink-0 text-right text-cream-dim">
                      {b.winners}/{b.offspring} winners
                      <br />
                      {b.wins} wins
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No famous bloodlines yet" icon="horse-head">Breed winners and their sires and dams are remembered here.</Empty>
          )}
        </section>
      </div>

      {mine && (
        <section aria-labelledby="honours-h" className="grid gap-4" data-testid="hall-mine">
          <div>
            <h2 id="honours-h" className="t-h2">
              {mine.stableName}&rsquo;s honours
            </h2>
            {mine.titles.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {mine.titles.map((t) => (
                  <li key={t} className="chip chip-brass">
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul className="surface grid grid-cols-3 gap-x-2 gap-y-4 p-4 sm:grid-cols-4 lg:grid-cols-6" data-testid="achievements">
            {mine.achievements.map((a) => (
              <li key={a.id} className="grid justify-items-center gap-1 text-center" data-earned={a.earned || undefined} title={a.description}>
                <span className={`rosette-well ${a.earned ? "" : "locked"}`}>
                  <PixelIcon name={a.earned ? "rosette" : "rosette-green"} size={64} />
                </span>
                <p className={`text-[0.8125rem] font-extrabold leading-4 ${a.earned ? "" : "text-sage"}`}>
                  {a.title}
                  <span className="sr-only">{a.earned ? " (earned)" : " (not yet)"}: {a.description}</span>
                </p>
                {a.earned && a.earnedAtMs ? (
                  <p className="caption text-positive">
                    ✓ <LocalTime ms={a.earnedAtMs} withDate />
                  </p>
                ) : (
                  <p className="caption hidden sm:block">{a.description}</p>
                )}
              </li>
            ))}
          </ul>
          <section aria-labelledby="rivals-h">
            <h3 id="rivals-h" className="t-h2 mb-3">
              Your rivals
            </h3>
            {mine.rivals.length ? (
              <ul className="surface rows" data-testid="rivals">
                {mine.rivals.map((r) => (
                  <li key={r.stableName} className="flex items-center gap-3 px-3 py-2">
                    <Silks silks={r.silks} cap={false} className="h-[26px] w-8 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="t-title block truncate text-cream">{r.stableName}</span>
                      <span className="t-meta block">
                        {r.closeFinishes} close finishes · you came out ahead {r.yourWins}×
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No rivals yet" icon="silks-sash">Finish within a length of the same stable three times in Live races and they become your rival.</Empty>
            )}
          </section>
        </section>
      )}
      </div>
    </div>
  );
}
