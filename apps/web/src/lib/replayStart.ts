/**
 * `?at=` on a race page decides where a shared replay opens: "finish" starts FINISH_LEAD_SEC
 * before the winning time, a number starts at that race second. Only races that are over
 * honour it — a live or upcoming race ignores the param entirely, so a shared link can
 * never spoil a result that hasn't been broadcast (the live.ts rules stay untouched).
 */

/** How many seconds before the winning time `?at=finish` starts the replay. */
export const FINISH_LEAD_SEC = 4;

/**
 * The pure part: `over` is decided server-side (broadcast clock), `winnerTimeSec` is only
 * passed once the result is public. Returns the replay start in seconds, or undefined to
 * open the page as normal.
 */
export function replayStartSec(at: string | null | undefined, over: boolean, winnerTimeSec: number | null): number | undefined {
  if (!over || at == null) return undefined;
  if (at === "finish") return winnerTimeSec === null ? undefined : Math.max(0, winnerTimeSec - FINISH_LEAD_SEC);
  if (!/^\d+(\.\d+)?$/.test(at)) return undefined;
  return Number(at);
}