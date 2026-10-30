/**
 * Shared live-feed windows: GET /api/races/:id/live?w=<n> serves frames
 * [n * LIVE_WINDOW_FRAMES, (n + 1) * LIVE_WINDOW_FRAMES) up to the server's live edge.
 *
 * Every viewer of a race asks for the same few URLs, so the CDN can answer them all from
 * one origin response (see server/liveCache.ts for the headers). Imported by the client
 * feed and by the server, so it must stay free of server-only imports.
 */

/** Frames per window: 5 s of broadcast at 10 frames/s (TICK_HZ 20 / SAMPLE_EVERY 2). */
export const LIVE_WINDOW_FRAMES = 50;
/** Highest accepted window index (far beyond any race; keeps the URL space small). */
export const MAX_LIVE_WINDOW = 9_999;

export function liveWindowOf(frame: number): number {
  return Math.floor(Math.max(0, frame) / LIVE_WINDOW_FRAMES);
}

export function liveWindowStart(w: number): number {
  return w * LIVE_WINDOW_FRAMES;
}

/** True when a chunk for window `w` holds every frame of that window (so it can never change). */
export function isWindowComplete(w: number, fromFrame: number, frameCount: number): boolean {
  return fromFrame === liveWindowStart(w) && frameCount === LIVE_WINDOW_FRAMES;
}
