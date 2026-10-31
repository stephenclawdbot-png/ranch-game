"use client";

import Link from "next/link";
import { useState } from "react";
import type { CareerStoryEntryView, CareerStoryView } from "@/lib/types";
import { PixelIcon, type IconName } from "../icons";
import { EmptyState } from "../ui/Page";

/** One icon per kind of line (game-core StoryKind). */
const STORY_ICON: Record<string, IconName> = {
  debut: "flag",
  first_win: "rosette",
  biggest_win: "trophy",
  big_win: "trophy",
  upset: "star",
  photo_win: "binoculars",
  photo_loss: "binoculars",
  rating_peak: "medallion",
  quirk: "binoculars",
  injury: "cross",
  comeback: "horseshoe",
  rival: "silks-sash",
  hall_of_fame: "plaque",
  retired: "laurel",
  legacy: "laurel",
  memorial: "lantern",
  foal_first_win: "horse-head",
  foal_big_win: "trophy",
};

/** The kinds a story is proudest of: their dot is brass. */
const BIG = new Set(["first_win", "biggest_win", "big_win", "upset", "photo_win", "hall_of_fame", "foal_big_win", "retired"]);

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Entry({ e }: { e: CareerStoryEntryView }) {
  const quiet = e.kind === "memorial";
  const other = e.horseId && (e.kind === "rival" || e.kind.startsWith("foal_"));
  return (
    <li className="relative grid grid-cols-[2rem_1fr] gap-x-3 pb-4 last:pb-0" data-testid="story-entry" data-kind={e.kind}>
      <span aria-hidden className={`relative z-10 grid h-8 w-8 place-items-center border-2 bg-inset ${quiet ? "border-line" : BIG.has(e.kind) ? "border-brass" : "border-line"}`}>
        <PixelIcon name={STORY_ICON[e.kind] ?? "star"} size={16} />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={`max-w-[70ch] text-[0.9375rem] leading-snug ${quiet ? "text-cream-dim" : "text-cream"}`}>{e.text}</p>
        <p className="t-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num">{day(e.atMs)}</span>
          {e.raceId && (
            <Link href={`/race/${e.raceId}`} className="link font-bold" data-testid="story-replay">
              <span aria-hidden>▶ </span>
              {e.kind === "rival" ? "Last meeting" : "Replay"}
            </Link>
          )}
          {other && (
            <Link href={`/horse/${e.horseId}`} className="link font-bold" data-testid="story-horse">
              {e.kind === "rival" ? "The rival" : "The foal"}
            </Link>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * The career story: the noteworthy moments of a horse's career, oldest first, one line each.
 * The best lines show first; "show full career" opens every line.
 */
export function CareerStory({ story, name, female }: { story: CareerStoryView; name: string; female: boolean }) {
  const [all, setAll] = useState(false);
  const entries = story.entries;
  const highlights = entries.filter((e) => e.highlight);
  const shown = all ? entries : highlights;
  const hidden = entries.length - highlights.length;
  return (
    <section className="grid gap-3" aria-labelledby="story-h" data-testid="career-story">
      <div>
        <h2 id="story-h" className="t-h2">
          Career story
        </h2>
        {entries.length > 0 && <p className="t-meta">The moments that made {name}, from the first race on.</p>}
      </div>
      {entries.length === 0 ? (
        <EmptyState icon="flag" title={`${female ? "Her" : "His"} story starts with ${female ? "her" : "his"} first race`} text="Wins, close finishes, rivals and foals will show here as they happen." testId="story-empty" />
      ) : (
        <div className="surface p-4">
          <ol className="relative before:absolute before:bottom-4 before:left-[0.9375rem] before:top-4 before:border-l-2 before:border-dotted before:border-line" aria-label={`${name}'s career story`}>
            {shown.map((e) => (
              <Entry key={e.key} e={e} />
            ))}
          </ol>
          {hidden > 0 && (
            <button type="button" className="btn btn-outline btn-sm mt-4 w-full sm:w-fit" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="story-toggle">
              {all ? "Show the highlights" : `Show full career (${hidden} more)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
