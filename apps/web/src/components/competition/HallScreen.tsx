import Link from "next/link";
import type { HallView } from "@/lib/competitionTypes";
import { SURFACE_LABEL, formatCredits, formatDistance } from "@/lib/format";
import { Silks } from "../Silks";
import { PixelIcon } from "../icons";
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="surface p-4 text-cream-dim">{children}</p>;
}

export function HallScreen({ view }: { view: HallView }) {
  const mine = view.mine;
  return (
    <div className="grid gap-8">
      <header>
        <p className="eyebrow">Permanent · never forgotten</p>
        <h1 className="t-display-xl">Hall of Fame</h1>
        <p className="mt-1 max-w-2xl text-lg text-cream-dim">Champions, season winners, record times and the bloodlines behind them. Entries here are permanent.</p>
      </header>

      <section aria-labelledby="inducted-h">
        <h2 id="inducted-h" className="t-display-m mb-2">
          Inductees
        </h2>
        {view.inducted.length ? (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="hall-inducted">
            {view.inducted.map((e) => (
              <li key={e.key} className="surface flex items-start gap-3 p-3">
                <PixelIcon name="rosette" size={32} className="shrink-0" />
                <div className="min-w-0">
                  <p className="label text-brass-bright">{CATEGORY[e.category] ?? e.category}</p>
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
          <Empty>No inductees yet. Win Group races, a Season Final or set a record time to be the first.</Empty>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="records-h" className="min-w-0">
          <h2 id="records-h" className="t-display-m mb-2">
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
            <Empty>Records are set in Live races. The first winner at each trip and surface sets the time to beat.</Empty>
          )}
        </section>

        <section aria-labelledby="champs-h" className="min-w-0">
          <h2 id="champs-h" className="t-display-m mb-2">
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
            <Empty>The winningest Live horses will appear here.</Empty>
          )}
        </section>

        <section aria-labelledby="seasons-h" className="min-w-0">
          <h2 id="seasons-h" className="t-display-m mb-2">
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
            <Empty>The owner with the most league points in a season is inducted when it ends.</Empty>
          )}
        </section>

        <section aria-labelledby="blood-h" className="min-w-0">
          <h2 id="blood-h" className="t-display-m mb-2">
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
            <Empty>Breed winners and your sires and dams will be remembered here.</Empty>
          )}
        </section>
      </div>

      {mine && (
        <section aria-labelledby="honours-h" className="grid gap-4" data-testid="hall-mine">
          <div>
            <h2 id="honours-h" className="t-display-m">
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
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="achievements">
            {mine.achievements.map((a) => (
              <li key={a.id} className={`flex items-start gap-3 p-3 ${a.earned ? "surface" : "inset opacity-80"}`} data-earned={a.earned || undefined}>
                <PixelIcon name={a.earned ? "star" : "horseshoe"} size={24} className={`shrink-0 ${a.earned ? "" : "opacity-50"}`} />
                <div className="min-w-0">
                  <p className="font-extrabold text-cream">
                    {a.title}
                    <span className="sr-only">{a.earned ? " (earned)" : " (not yet)"}</span>
                  </p>
                  <p className="caption text-cream-dim">{a.description}</p>
                  {a.earned && a.earnedAtMs && (
                    <p className="caption text-positive">
                      ✓ <LocalTime ms={a.earnedAtMs} withDate />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <section aria-labelledby="rivals-h">
            <h3 id="rivals-h" className="t-display-m mb-2">
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
              <Empty>Finish within a length of the same stable three times in Live races and they become your rival.</Empty>
            )}
          </section>
        </section>
      )}
    </div>
  );
}
