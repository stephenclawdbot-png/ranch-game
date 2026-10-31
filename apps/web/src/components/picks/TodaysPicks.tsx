"use client";
/**
 * Home's "Today's picks": the next Live races still open for picks (your pick if made), your
 * latest scored picks and your week on the tipster table. Points only; outcomes appear only once
 * a race's result is public.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ordinal } from "@/lib/format";
import { LocalTime } from "../competition/LocalTime";
import { Section } from "../ui/Page";

interface HomePicks {
  upcoming: { raceId: string; name: string; postTimeMs: number; runners: number; mine: { horseName: string } | null }[];
  recent: { raceId: string; raceName: string; horseName: string; outcome: "won" | "lost" | "void"; points: number }[];
  week: { points: number; wins: number; picks: number; position: number | null };
}

export function TodaysPicks() {
  const [v, setV] = useState<HomePicks | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/picks/today", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<HomePicks>) : null))
      .then((d) => live && setV(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!v || (!v.upcoming.length && !v.recent.length)) return null;
  return (
    <Section id="picks-h" title="Today's picks" href="/tipsters" linkLabel="Tipsters" testId="home-picks">
      <div className="surface grid gap-2 p-3 sm:p-4">
        <p className="t-meta">
          Pick a winner in any Live race for points (never money).{" "}
          {v.week.picks > 0 ? `This week: ${v.week.points} pts${v.week.position ? `, ${ordinal(v.week.position)} on the table` : ""}.` : ""}
        </p>
        {v.upcoming.length > 0 && (
          <ul className="rows !p-0" data-testid="home-picks-upcoming">
            {v.upcoming.map((r) => (
              <li key={r.raceId}>
                <Link href={`/race/${r.raceId}`} className="row-link gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-cream">{r.name}</span>
                    <span className="caption block">
                      Off <LocalTime ms={r.postTimeMs} /> · {r.runners} declared{r.mine ? ` · your pick: ${r.mine.horseName}` : ""}
                    </span>
                  </span>
                  <span className={r.mine ? "tag tag-good shrink-0" : "btn btn-sm shrink-0"}>{r.mine ? "Picked ✓" : "Pick"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {v.recent.length > 0 && (
          <ul className="caption grid gap-0.5" aria-label="Your latest picks">
            {v.recent.map((r) => (
              <li key={r.raceId}>
                {r.raceName}: {r.horseName} {r.outcome === "won" ? `won, +${r.points} pts` : r.outcome === "lost" ? "didn't win" : "didn't run (void)"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
