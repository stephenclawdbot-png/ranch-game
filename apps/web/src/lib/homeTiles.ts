/**
 * GET /api/home, shared across the page. Three components on Home read the same tiles (the
 * Today list, the wait card's "can the Cup still be run", the signed-in card); each used to
 * fetch its own copy, and one answer costs the server about 75 queries. They now share one
 * request: callers that ask while it is in flight, or within SHARE_MS of the answer, get the
 * same result. Nothing is kept longer than that, so a refresh after an action is always fresh.
 */
import type { HomeTiles } from "./homeTypes";

const SHARE_MS = 3_000;

let shared: { at: number; tiles: Promise<HomeTiles | null> } | null = null;

/** The home tiles, or null when they could not be loaded (signed out, offline, an error). */
export function fetchHomeTiles(): Promise<HomeTiles | null> {
  const now = Date.now();
  if (shared && now - shared.at < SHARE_MS) return shared.tiles;
  const tiles = fetch("/api/home", { cache: "no-store" })
    .then(async (res) => (res.ok ? ((await res.json()) as { tiles: HomeTiles }).tiles : null))
    .catch(() => null);
  const mine = { at: now, tiles };
  shared = mine;
  // The share window runs from the answer, not from the request.
  void tiles.then((t) => {
    if (shared !== mine) return;
    if (t === null) shared = null;
    else mine.at = Date.now();
  });
  return tiles;
}

/** Tests: forget the shared answer. */
export function resetHomeTilesForTests(): void {
  shared = null;
}
