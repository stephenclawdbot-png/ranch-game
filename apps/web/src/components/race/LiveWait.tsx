"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeTiles } from "@/lib/homeTypes";
import type { WaitAction } from "@/lib/whileYouWait";
import { useNow } from "@/lib/clock";
import { localClockText, utcClockText, waitText } from "@/lib/meetings";

/**
 * When a Live race runs, in the player's own clock, and what to do meanwhile (first-hour
 * follow-up: the wait made shorter and busier). Live races run in race meetings, so a new
 * player's first one can be a while away:
 *   - entered: when it runs, the other stables entered so far (while entries are open), and the
 *     bell 10 minutes before the off and at the off;
 *   - not entered: the soonest race a horse of yours can run (often a later race of a meeting in
 *     progress), not just the next meeting;
 *   - "Watch the 10:15 at Bellmont now": another Live race running or about to go off (the normal
 *     live broadcast: no spoilers);
 *   - up to three things to do meanwhile, from the stable's state, only when available.
 * Everything comes from GET /api/races/live-wait (outcome-free) and refreshes every minute.
 *
 * No hydration mismatch: the server and the first client render show the UTC time; local times
 * and the wait appear after mount. Nothing here is about the result (no spoilers).
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

/** GET /api/races/live-wait (lib types only: the server module stays server-side). */
export interface LiveWaitData {
  serverNowMs: number;
  race: { id: string; name: string; postTimeMs: number; entriesOpen: boolean; otherStables: number } | null;
  soonest: { raceId: string; raceName: string; postTimeMs: number; horseName: string; otherStables: number } | null;
  watchNow: { raceId: string; name: string; track: string; postTimeMs: number; running: boolean } | null;
  actions: WaitAction[];
}

/** Refresh the wait card this often (entries and the race to watch move). */
const REFRESH_MS = 60_000;
const cache = new Map<string, { at: number; data: Promise<LiveWaitData | null> }>();

function fetchWait(raceId: string | null): Promise<LiveWaitData | null> {
  const key = raceId ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < REFRESH_MS / 2) return hit.data;
  const data = fetch(`/api/races/live-wait${raceId ? `?raceId=${encodeURIComponent(raceId)}` : ""}`, { cache: "no-store" })
    .then(async (r) => (r.ok ? ((await r.json()) as LiveWaitData) : null))
    .catch(() => null);
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** The wait card's data, fetched after mount and every minute (null until then, or signed out). */
export function useLiveWait(raceId: string | null): LiveWaitData | null {
  const [data, setData] = useState<LiveWaitData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void fetchWait(raceId).then((d) => alive && d && setData(d));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [raceId]);
  return data;
}

/** "3 other stables entered so far" / "No other stables entered yet". */
export function othersText(n: number, entered: boolean): string {
  if (n <= 0) return entered ? "No other stables entered yet: the Club fills the field at the close" : "No stables entered yet";
  return `${n} ${entered ? "other " : ""}${n === 1 ? "stable" : "stables"} entered so far`;
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

/** Up to three things to do meanwhile, each one tap (only what the stable can do now). */
function WaitActions({ actions }: { actions: WaitAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="grid gap-1" data-testid="while-you-wait">
      <p className="text-sm font-bold text-cream-dim">While you wait</p>
      <ul className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="btn btn-sm" data-testid={`wait-${a.key}`}>
              {a.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Watch the 10:15 at Bellmont now" (local time after mount). */
function WatchNow({ w }: { w: NonNullable<LiveWaitData["watchNow"]> }) {
  const now = useNow(30_000);
  const at = now === null ? utcClockText(w.postTimeMs) : localClockText(w.postTimeMs, now);
  return (
    <Link href={`/race/${w.raceId}`} className="link inline-flex items-center gap-1.5 text-sm font-bold" data-testid="watch-now">
      {w.running && <span className="live-dot" />}
      Watch the {at}
      {w.track ? ` at ${w.track}` : ""} now
    </Link>
  );
}

/**
 * The wait card: entered ("Your Live race runs at …", the stables in so far) or pointing at the
 * soonest race for you ("Your soonest Live race runs at …"), a race to watch now and what to do
 * meanwhile. `watch={false}` where the page already offers the race running now.
 */
export function LiveWait({ postTimeMs, entered, raceId = null, watch = true, className }: { postTimeMs: number; entered: boolean; raceId?: string | null; watch?: boolean; className?: string }) {
  const data = useLiveWait(entered ? raceId : null);
  const mine = entered ? data?.race : null;
  const soonest = !entered ? data?.soonest : null;
  const post = mine?.postTimeMs ?? soonest?.postTimeMs ?? postTimeMs;
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`} data-testid="live-wait">
      <p className="text-sm text-cream-dim">
        {entered ? (
          <>
            Your Live race runs at <LocalPostTime postTimeMs={post} />. We&rsquo;ll ring the bell 10 minutes before and when it&rsquo;s off, and you can watch the finish or the replay later.
          </>
        ) : soonest ? (
          <span data-testid="soonest-live">
            Your soonest Live race: the {soonest.raceName} at <LocalPostTime postTimeMs={soonest.postTimeMs} />, for {soonest.horseName}. Enter now; we&rsquo;ll ring the bell before it&rsquo;s off.
          </span>
        ) : (
          <>
            The next Live race runs at <LocalPostTime postTimeMs={post} />. Enter now; we&rsquo;ll ring the bell when it&rsquo;s off, and you can watch the finish or the replay later.
          </>
        )}
      </p>
      {mine?.entriesOpen && (
        <p className="text-sm font-bold text-cream" data-testid="others-entered">
          {othersText(mine.otherStables, true)}.
        </p>
      )}
      {soonest && soonest.otherStables > 0 && (
        <p className="text-sm font-bold text-cream" data-testid="others-entered">
          {othersText(soonest.otherStables, false)}.
        </p>
      )}
      {watch && data?.watchNow && <WatchNow w={data.watchNow} />}
      {data ? <WaitActions actions={data.actions} /> : <WhileYouWait />}
    </div>
  );
}
