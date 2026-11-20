/**
 * The race card as a visitor sees it, derived from a shared copy that may be up to an hour old
 * (server/visitorCache.ts). Pure: only post times and the copy's own phases are used, so nothing
 * about a result can appear that the copy did not already hold (and the copy only holds a result
 * once that race's broadcast was over).
 */
import type { RaceSummary } from "./types";

/** How long after its post time a race still counts as "running now" for a visitor's teaser (the longest broadcast). */
const RUNNING_FOR_MS = 4 * 60_000;

export interface VisitorRaceLists {
  upcoming: RaceSummary[];
  recent: RaceSummary[];
  /** A race that is probably running right now (it had player entries and its post time has just passed), for "Watch live". */
  live: RaceSummary | null;
}

/**
 * The race card for a visitor at `now`, from the shared copy:
 *  - upcoming: races whose post time is still ahead (a race whose entries closed since the copy
 *    was made is kept only if a stable had entered it: otherwise it was called off);
 *  - recent: the results in the copy; a race the copy caught mid-broadcast is left out once its
 *    window has passed (its result is not in the copy, and is never guessed);
 *  - live: a race going on now, for the landing page's "Watch live".
 */
export function visitorListsAt(copy: { upcoming: RaceSummary[]; recent: RaceSummary[] }, nowMs: number): VisitorRaceLists {
  const upcoming = copy.upcoming.filter((r) => r.postTimeMs > nowMs && (r.entriesCloseAtMs > nowMs || r.stables > 0 || r.phase === "closed"));
  const recent = copy.recent.filter((r) => r.phase === "finished" || (r.phase === "live" && r.postTimeMs + RUNNING_FOR_MS > nowMs));
  const stillLive = recent.find((r) => r.phase === "live") ?? null;
  // Went off since the copy was made, with player stables in it: it is running (no outcome is known here).
  const wentOff = copy.upcoming.filter((r) => r.postTimeMs <= nowMs && r.postTimeMs + RUNNING_FOR_MS > nowMs && r.stables > 0).sort((a, b) => b.postTimeMs - a.postTimeMs)[0];
  const live = stillLive ?? (wentOff ? { ...wentOff, phase: "live" as const } : null);
  return { upcoming, recent, live };
}
