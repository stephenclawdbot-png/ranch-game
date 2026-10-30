/**
 * Cache policy for the windowed live feed (GET /api/races/:id/live?w=<n>).
 *
 * The body of a window response depends only on (race, window, server time): nothing is
 * read from cookies or headers, so one response can serve every viewer. Frames are only
 * ever included up to the live edge at generation time, so a cached copy can lag the live
 * edge but never run ahead of it.
 *
 * Vercel CDN behaviour relied on (https://vercel.com/docs/caching/cache-control-headers,
 * https://vercel.com/docs/caching/cdn-cache, read 2026-10-30):
 *  - `CDN-Cache-Control` overrides `Cache-Control` for Vercel's cache, and when it is set
 *    Vercel forwards `Cache-Control` to the browser as is. So the CDN can hold a live window
 *    for 1 s while the browser keeps nothing.
 *  - A response is not cached if `Cache-Control` has `private`, `no-cache` or `no-store`, or
 *    it sets a cookie, so the browser side of a CDN-cacheable response uses
 *    `max-age=0, must-revalidate` (Vercel's own "don't cache" default) rather than no-store.
 *  - Only 200/404/410/30x are cacheable: a 425 is never cached. Errors also stay no-store.
 *  - Concurrent misses are only collapsed for framework-known ISR routes, but background
 *    revalidation of a STALE response is collapsed to one invocation per region. A short
 *    `stale-while-revalidate=1` therefore keeps the origin at about one hit per second per
 *    region for the live window instead of a stampede each time `s-maxage=1` expires,
 *    while a served copy is at most about 2 s old (the client re-polls quickly when the
 *    frames it got run out early, see lib/liveRaceFeed.ts).
 *  - The cache is per region and keyed on the full URL including the query string.
 */
import type { RaceBroadcastChunk } from "@thoroughbred/shared";
import { isWindowComplete } from "@/lib/liveWindow";

export type LiveWindowState = "final" | "complete" | "live" | "pre";

export function liveWindowState(w: number, chunk: RaceBroadcastChunk): LiveWindowState {
  if (chunk.final) return "final";
  if (chunk.liveEdgeFrame < 0) return "pre";
  return isWindowComplete(w, chunk.fromFrame, chunk.frames.length) ? "complete" : "live";
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const BROWSER_NO_REUSE = "public, max-age=0, must-revalidate";
const CDN_ONE_SECOND = "public, s-maxage=1, stale-while-revalidate=1";

/** Response headers for a window response in `state`. */
export function liveWindowHeaders(state: LiveWindowState): Record<string, string> {
  switch (state) {
    case "final": // the whole race is over: never changes again
    case "complete": // every frame of the window is behind the live edge: never changes again
      return { "Cache-Control": IMMUTABLE };
    case "live": // the window holds the live edge: share it for about a second
    case "pre": // field locked, gate countdown: only serverNowMs moves
      return { "Cache-Control": BROWSER_NO_REUSE, "CDN-Cache-Control": CDN_ONE_SECOND };
  }
}
