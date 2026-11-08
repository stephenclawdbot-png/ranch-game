"use client";

import { ApiFailure, retryPlayer } from "@/lib/player";
import { NETWORK_MESSAGE } from "@/lib/fetchTimed";
import { ErrorNote } from "./ErrorNote";

/**
 * A page that waits for the player (found a stable, sign in) when /api/me failed before any
 * answer: the usual error line and Try again, where the page used to stay blank.
 */
export function PlayerLoadFailed() {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-xl content-center gap-3" data-testid="player-load-failed">
      <ErrorNote error={new ApiFailure(0, "network", NETWORK_MESSAGE)} onRetry={retryPlayer} />
    </div>
  );
}
