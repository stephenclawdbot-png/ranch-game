"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { runWhenAttentive } from "@/lib/attention";

/** Never two automatic refreshes closer than this (a page whose data is a few seconds old would otherwise spin). */
const MIN_GAP_MS = 5_000;
let lastRefreshAt = 0;

/**
 * Re-renders the server component tree when the next scheduled change happens (server clock),
 * if the player is here to see it (tab visible, active in the last few minutes: lib/attention).
 * A hidden or idle tab waits and refreshes the moment the player is back.
 */
export function AutoRefresh({ atMs, serverNowMs }: { atMs: number | null; serverNowMs: number }) {
  const router = useRouter();
  useEffect(() => {
    if (atMs === null) return;
    const delay = Math.max(1000, atMs - serverNowMs + 750, lastRefreshAt + MIN_GAP_MS - Date.now());
    return runWhenAttentive(Date.now() + delay, () => {
      lastRefreshAt = Date.now();
      router.refresh();
    });
  }, [atMs, serverNowMs, router]);
  return null;
}
