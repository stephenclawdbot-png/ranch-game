"use client";

import { useEffect } from "react";
import { refreshPlayer, usePlayerState } from "@/lib/player";

/** The bell rings this long before the off (the server's RACE_SOON_MS). */
const SOON_MS = 10 * 60_000;
/** Each alarm is a moment relative to the post time. */
const ALARMS_MS = [-SOON_MS + 3_000, -SOON_MS + 70_000, 3_000];

/**
 * "We'll ring the bell 10 minutes before and when it's off": the bell note is written by the
 * server the first time somebody asks it anything inside those ten minutes. A tab no longer
 * polls in the background (lib/attention), so for each Live race the player has entered this
 * sets three single alarms (ten minutes before, a minute later as a backstop, and at the off)
 * that refresh the player state once each. They also run in a hidden tab: this is the player's
 * own race about to run, and the same request sends the phone alert. Nothing else is asked for
 * in between, however long the race is away.
 */
export function RaceAlarms() {
  const state = usePlayerState();
  const key = (state?.active ?? [])
    .filter((a) => a.kind === "live")
    .map((a) => `${a.raceId}:${a.postTimeMs}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!key) return;
    const now = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const part of key.split(",")) {
      const post = Number(part.slice(part.lastIndexOf(":") + 1));
      if (!Number.isFinite(post)) continue;
      for (const offset of ALARMS_MS) {
        const at = post + offset;
        // setTimeout holds at most ~24.8 days; a race further away is re-armed by a later visit.
        if (at <= now || at - now > 2_000_000_000) continue;
        timers.push(setTimeout(() => void refreshPlayer().catch(() => undefined), at - now));
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [key]);
  return null;
}
