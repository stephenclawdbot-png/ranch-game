/**
 * Starting a Live card race early (owner, 2026-11-01: "if an event is full just start it").
 *
 * A race's post time and entry close move forward; nothing else changes: the field is still drawn
 * and sealed at the (new) close, the seed commitment stands, and the result is decided only when
 * the race runs. Every entrant gets a bell note with the new time. Calendar races (Features,
 * Finals, the Saturday Plate) keep their published times and are never moved.
 */
import { and, eq, ne } from "drizzle-orm";
import { raceEntries, races, stables, type RaceRow } from "../schema";
import type { Db, Executor } from "../types";
import { notify } from "./notifications";
import { audit, runTx } from "./tx";

/** How long after filling (or being brought forward) a race goes off. */
export const START_EARLY_LEAD_MS = 10 * 60_000;

export type StartEarlyReason = "full" | "admin";

const isCalendar = (r: Pick<RaceRow, "conditions">) => !!(r.conditions as { calendar?: unknown } | null)?.calendar;
const isLiveCard = (r: Pick<RaceRow, "slotKey">) => typeof r.slotKey === "string" && r.slotKey.startsWith("live");

/** The race's new post time, or null when it can't (or needn't) start early. */
export function earlyPostTime(race: Pick<RaceRow, "status" | "field" | "entriesCloseAt" | "postTime" | "conditions" | "slotKey">, now: Date, leadMs = START_EARLY_LEAD_MS): Date | null {
  if (race.status !== "open" || race.field || now >= race.entriesCloseAt) return null;
  if (!isLiveCard(race) || isCalendar(race)) return null;
  const at = new Date(Math.ceil((now.getTime() + leadMs) / 60_000) * 60_000);
  return at < race.postTime ? at : null;
}

/** Inside a transaction that holds the race row: move it forward and tell the entrants. */
export async function startRaceEarlyTx(tx: Executor, race: RaceRow, now: Date, reason: StartEarlyReason, leadMs = START_EARLY_LEAD_MS): Promise<Date | null> {
  const post = earlyPostTime(race, now, leadMs);
  if (!post) return null;
  const gap = Math.max(0, race.postTime.getTime() - race.entriesCloseAt.getTime());
  const close = new Date(Math.max(now.getTime(), post.getTime() - gap));
  await tx.update(races).set({ postTime: post, entriesCloseAt: close }).where(eq(races.id, race.id));
  const entrants = await tx
    .selectDistinct({ accountId: stables.accountId })
    .from(raceEntries)
    .innerJoin(stables, eq(stables.id, raceEntries.stableId))
    .where(and(eq(raceEntries.raceId, race.id), ne(raceEntries.status, "scratched")));
  const mins = Math.round((post.getTime() - now.getTime()) / 60_000);
  const why = reason === "full" ? "the field is full" : "brought forward";
  for (const e of entrants) {
    await notify(tx, {
      accountId: e.accountId,
      kind: "race_moved",
      dedupeKey: `race-moved:${race.id}:${post.getTime()}`,
      title: `The ${race.name} now goes off in ${mins} minutes (${why})`,
      data: { href: `/race/${race.id}`, postTimeMs: post.getTime(), was: race.postTime.getTime(), reason },
      raceId: race.id,
      now,
    });
  }
  await audit(tx, { actor: null, action: "race.start_early", entityType: "race", entityId: race.id, data: { reason, from: race.postTime.toISOString(), to: post.toISOString(), entrants: entrants.length } });
  return post;
}

/** Admin: bring a Live card race forward to `minutes` from now (5-60). */
export async function startRaceEarly(db: Db, input: { raceId: string; now: Date; minutes?: number }): Promise<{ postTime: Date } | null> {
  const minutes = Math.min(60, Math.max(5, Math.round(input.minutes ?? 10)));
  return runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) return null;
    const post = await startRaceEarlyTx(tx, race, input.now, "admin", minutes * 60_000);
    return post ? { postTime: post } : null;
  });
}
