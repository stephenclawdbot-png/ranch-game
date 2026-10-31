/**
 * No spoilers on a live broadcast: the viewer reads the official result (and builds the
 * finale from it) only through this gate, i.e. once the feed carries `final` (the server
 * sends it only after the finish has been broadcast) AND the playhead has reached the end of
 * the broadcast data. A viewer that rewound keeps watching without the result until it
 * catches up again.
 */
import type { LiveRaceFeed, RaceReplay } from "@thoroughbred/shared";

export function officialHandoff(feed: Pick<LiveRaceFeed, "final" | "liveEdgeFrame" | "header">, playhead: number): RaceReplay | null {
  const fin = feed.final;
  if (!fin || feed.liveEdgeFrame < 0) return null;
  const dt = feed.header.sampleEvery / feed.header.tickHz;
  return playhead >= feed.liveEdgeFrame * dt - dt - 1e-6 ? fin : null;
}
