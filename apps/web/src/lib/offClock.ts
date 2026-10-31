import { BROADCAST_DELAY_S } from "@thoroughbred/shared";

/**
 * The off as the broadcast shows it, in this browser's clock: the viewer's build-up counts down
 * to the broadcast start (post time + the broadcast delay), so the race page's header pill and
 * tab title count to the same moment and the two countdowns never disagree. `feedStartMs` is
 * the live feed's broadcast start (already in this browser's clock) once the field is locked.
 */
export function broadcastOffAt(localPostMs: number, feedStartMs: number | null | undefined): number {
  return feedStartMs ?? localPostMs + BROADCAST_DELAY_S * 1000;
}

/** Milliseconds to the broadcast off, or null once it has gone (or before the clock is known). */
export function msToBroadcastOff(nowMs: number | null, offAtMs: number): number | null {
  if (nowMs === null || nowMs >= offAtMs) return null;
  return offAtMs - nowMs;
}
