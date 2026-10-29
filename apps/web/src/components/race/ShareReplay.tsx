"use client";

import { useState } from "react";
import type { RaceCard } from "@/lib/types";

/**
 * Share a finished race: the link is /race/<id>?at=finish, which opens the replay a few
 * seconds before the line. Phones use the Web Share API; everywhere else the URL is copied
 * to the clipboard and the button confirms it.
 */
export function ShareReplay({ card, horseName }: { card: RaceCard; horseName: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/race/${card.id}?at=finish`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `${horseName} in the ${card.config.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* the user dismissed the share sheet, or the clipboard was blocked */
    }
  }

  return (
    <button type="button" className="btn btn-sm shrink-0" onClick={() => void share()} data-testid="share-replay">
      {copied ? "✓ Link copied" : "Share"}
    </button>
  );
}