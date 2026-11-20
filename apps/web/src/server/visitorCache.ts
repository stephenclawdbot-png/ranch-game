/**
 * Shared copies of public views, for visitors (requests without a stable).
 *
 * The database is billed for every minute it is awake, and it only falls asleep after several
 * minutes without a query. A visitor, a link preview or a crawler loading a public page must
 * therefore not reach it: one stray hit keeps it awake for minutes, and steady crawling keeps it
 * awake all day. So what a visitor sees of the race card, the results, finished races, the Hall
 * of Fame and the news comes from a shared copy (Next's data cache: on Vercel one copy for every
 * instance and region), refreshed at most once per `ttlS`. When a copy is older than that, the
 * visitor still gets it at once and the refresh happens after the response.
 *
 * Rules:
 *  - Only views that are the same for everyone go in here (built with no session). Anything
 *    that depends on the session cookie is computed per request, never cached.
 *  - A copy is made by the same server code as the live view, so it obeys the same no-spoiler
 *    rule at the moment it is made (nothing about a result before its broadcast is over), and a
 *    copy served later can only be behind the present, never ahead of it.
 *  - If the database is down, an existing copy keeps being served (the refresh fails quietly).
 *    With no copy at all the loader's error propagates: callers decide (server/outage.ts).
 */
import { unstable_cache } from "next/cache";
import { db, type Db } from "./db";

/** How old a visitor's copy may get before a visit refreshes it: at most 24 database wake-ups a day per view. */
export const VISITOR_TTL_S = 60 * 60;

/** For views that never change once made (a finished race): kept a week at a time, so a forgotten copy cannot live forever. */
export const VISITOR_KEEP_S = 7 * 24 * 60 * 60;

type Arg = string | number | null;

/**
 * Copies belong to one deployment: a new deployment (whose views may have a different shape)
 * starts with fresh ones instead of reading what older code stored.
 */
const DEPLOYMENT = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

/**
 * Wraps `load` (a public view built without a session) in the shared cache. `name` must be
 * unique per view ("hall-v1").
 */
export function visitorCached<A extends Arg[], T>(name: string, load: (database: Db, now: Date, ...args: A) => Promise<T>, ttlS: number = VISITOR_TTL_S): (...args: A) => Promise<T> {
  const run = async (...args: A): Promise<T> => load(await db(), new Date(), ...args);
  const cached = unstable_cache(run, ["visitor", name, DEPLOYMENT], { revalidate: ttlS, tags: ["visitor", `visitor:${name}`] });
  return async (...args: A): Promise<T> => {
    try {
      return await cached(...args);
    } catch (err) {
      // Outside a Next.js request (unit tests, scripts) there is no data cache: load directly.
      if (err instanceof Error && /incrementalCache missing/.test(err.message)) return run(...args);
      throw err;
    }
  };
}
