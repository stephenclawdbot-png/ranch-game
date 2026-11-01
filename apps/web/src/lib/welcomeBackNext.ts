/**
 * The "Welcome back, <Stable>" strip on Home after a sign-in: its one button is the most
 * relevant next thing, in this order (owner's ask):
 *  1. a result waiting to be watched (never says how it went);
 *  2. your Live race up next (entered, not yet over);
 *  3. continue your Story chapter (once you've run a Story race);
 *  4. the next first-week job;
 *  else your best horse's next race, or the stable.
 */
import type { ActiveEntry, InboxView, RunView } from "./types";

export type BackActionKind = "result" | "live" | "story" | "first_week" | "race" | "stable";

export interface BackAction {
  kind: BackActionKind;
  label: string;
  href: string;
}

export interface BackInput {
  nowMs: number;
  inbox: Pick<InboxView, "raceId" | "horseId" | "read" | "kind">[];
  active: Pick<ActiveEntry, "raceId" | "kind" | "horseName" | "raceName" | "postTimeMs">[];
  runs: Pick<RunView, "kind">[];
  horseName: (horseId: string | null) => string | null;
  /** Home's Story tile (GET /api/home), or null while it loads / when every chapter is done. */
  story: { chapter: number; raceName: string } | null;
  /** The first-week list's next job (title and where it's done), or null when the list is hidden or done. */
  firstWeek: { title: string; href: string } | null;
  /** The recommended fresh horse, if any. */
  ready: { name: string } | null;
}

/** A Live race you're in counts as "up next" until a few minutes after the off. */
export const LIVE_UP_NEXT_WINDOW_MS = 4 * 60_000;

/** Inbox kind of a sponsored race's note (not a run of yours). */
const SPONSOR_NOTE = "race_sponsor";

export function welcomeBackNext(i: BackInput): BackAction {
  const result = i.inbox.find((x) => !x.read && x.raceId && x.kind !== SPONSOR_NOTE);
  if (result?.raceId) {
    const name = i.horseName(result.horseId);
    return { kind: "result", label: name ? `Watch ${name}'s race` : "Watch your result", href: `/race/${result.raceId}` };
  }
  const live = [...i.active].filter((a) => a.kind === "live" && a.postTimeMs > i.nowMs - LIVE_UP_NEXT_WINDOW_MS).sort((a, b) => a.postTimeMs - b.postTimeMs)[0];
  if (live) return { kind: "live", label: `Watch ${live.horseName} in the ${live.raceName}`, href: `/race/${live.raceId}` };
  if (i.story && i.runs.some((r) => r.kind === "story")) return { kind: "story", label: `Continue Story chapter ${i.story.chapter}: ${i.story.raceName}`, href: "/story" };
  if (i.firstWeek) return { kind: "first_week", label: i.firstWeek.title, href: i.firstWeek.href };
  if (i.ready) return { kind: "race", label: `Race ${i.ready.name}`, href: "/story" };
  return { kind: "stable", label: "Go to your stable", href: "/stable" };
}
