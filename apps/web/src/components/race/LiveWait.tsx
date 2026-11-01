"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeTiles } from "@/lib/homeTypes";
import { useNow } from "@/lib/clock";
import { localClockText, utcClockText, waitText } from "@/lib/meetings";

/**
 * When a Live race runs, in the player's own clock, and what to do meanwhile. Live races run in
 * race meetings, so a new player's first one can be a couple of hours away: say when, say the
 * bell will ring, and offer a Quick race and the Daily Cup (when this stable can still run it
 * today) so the wait feels planned.
 *
 * No hydration mismatch: the server and the first client render show the UTC time; the local
 * time and the wait appear after mount. Nothing here is about the result (no spoilers).
 */

/** The race's post time in the player's clock: "9:00 pm (in 2 h 40 min)"; "21:00 UTC" before mount. */
export function LocalPostTime({ postTimeMs, relative = true }: { postTimeMs: number; relative?: boolean }) {
  const now = useNow(30_000);
  if (now === null) return <span data-testid="local-post-time">{utcClockText(postTimeMs)}</span>;
  const wait = postTimeMs - now;
  return (
    <span data-testid="local-post-time" data-local="1">
      <b className="text-cream">{localClockText(postTimeMs, now)}</b>
      {relative && wait > 0 ? ` (in ${waitText(wait)})` : ""}
    </span>
  );
}

let cupCache: { at: number; canRun: Promise<boolean> } | null = null;

/** The stable can still run today's Daily Cup (GET /api/home; cached for a minute across the page). */
function useCupOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!cupCache || Date.now() - cupCache.at > 60_000) {
      cupCache = {
        at: Date.now(),
        canRun: fetch("/api/home", { cache: "no-store" })
          .then(async (r) => (r.ok ? (((await r.json()) as { tiles: HomeTiles }).tiles.cup?.canRun ?? false) : false))
          .catch(() => false),
      };
    }
    void cupCache.canRun.then((v) => alive && setOpen(v));
    return () => {
      alive = false;
    };
  }, []);
  return open;
}

/** "While you wait: a Quick race or the Daily Cup." (the Cup only when it can still be run today). */
export function WhileYouWait({ className }: { className?: string }) {
  const cup = useCupOpen();
  return (
    <p className={`text-sm text-cream-dim ${className ?? ""}`} data-testid="while-you-wait">
      While you wait:{" "}
      <Link href="/quick" className="link" data-testid="wait-quick">
        a Quick race
      </Link>
      {cup && (
        <>
          {" "}
          or{" "}
          <Link href="/cup" className="link" data-testid="wait-cup">
            the Daily Cup
          </Link>
        </>
      )}
      .
    </p>
  );
}

/**
 * The full line: entered ("Your Live race runs at …") or pointing at the next one ("The next Live
 * race runs at … Enter now; …"), then the Quick race / Daily Cup line.
 */
export function LiveWait({ postTimeMs, entered, className }: { postTimeMs: number; entered: boolean; className?: string }) {
  return (
    <div className={`grid gap-1 ${className ?? ""}`} data-testid="live-wait">
      <p className="text-sm text-cream-dim">
        {entered ? "Your Live race runs at " : "The next Live race runs at "}
        <LocalPostTime postTimeMs={postTimeMs} />. {entered ? "We'll ring the bell when it's off" : "Enter now; we'll ring the bell when it's off"}, and you can watch the finish or the replay later.
      </p>
      <WhileYouWait />
    </div>
  );
}
