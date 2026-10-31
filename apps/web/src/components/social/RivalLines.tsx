"use client";

import { useEffect, useState } from "react";

/**
 * Under a race result: what it meant against your rivals ("You beat Thistle Mead's Copper Comet
 * for the first time in 4 meetings"). Fetched only once the result is on screen; the server
 * answers 425 until the broadcast is over, so it never runs ahead of the race.
 */
export function RivalLines({ raceId }: { raceId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`/api/races/${raceId}/rivals`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ lines: string[] }>) : { lines: [] }))
      .then((v) => live && setLines(v.lines))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [raceId]);
  if (!lines.length) return null;
  return (
    <section className="surface grid gap-1 p-3 sm:p-4" aria-label="Rivals" data-testid="rival-lines">
      {lines.map((l) => (
        <p key={l} className="flex items-start gap-2 text-sm font-bold">
          <span className="tag shrink-0">Rival</span>
          <span>{l}</span>
        </p>
      ))}
    </section>
  );
}
