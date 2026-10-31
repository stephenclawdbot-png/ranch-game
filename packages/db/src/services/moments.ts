/**
 * Moments (experience review item 7): discoveries and milestones as inbox items with a short
 * "what this means", a link, and a one-time highlight on the horse page.
 *
 *   settleRace     → first win, first Feature, quirk revealed, improver step, ranges exact,
 *                    retirement (tribute) or a fatal injury (memorial)
 *   scanPedigree   → the scan's result
 *   retireHorse    → retirement tribute
 *   moveToLegacyFarm → Legacy Farm tribute
 *
 * game-core `moments.ts` decides what is a moment and what it says; this file stores them.
 * Idempotent: each moment has a dedupe key (unique per account in inbox_items), so a moment is
 * never sent twice, whichever path runs again. Moments are only ever written by the server
 * path where the event happens, never on page view.
 *
 * No spoilers: a moment that came from a race (data.raceId) stays hidden until the owner has
 * seen that race's result (its race_result inbox item is read). `readAt` on a moment is the
 * owner dismissing its horse-page highlight.
 */
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { horses, inboxItems, raceEntries, races, type HorseRow } from "../schema";

type InboxItemRow = typeof inboxItems.$inferSelect;
import { gc } from "../gameCore";
import type { Executor } from "../types";

/** inbox_items.kind of every moment. */
export const MOMENT_KIND = "moment";

/** What a moment stores in inbox_items.data. */
export interface MomentData {
  moment: gc.MomentKind;
  horseName: string;
  body: string;
  href: string;
  /** The race it came from: hidden until that result has been seen. */
  raceId?: string;
  tribute?: gc.Tribute;
}

export interface Moment {
  id: string;
  kind: gc.MomentKind;
  horseId: string | null;
  horseName: string;
  title: string;
  body: string;
  href: string;
  raceId: string | null;
  tribute: gc.Tribute | null;
  createdAt: Date;
  /** The horse-page highlight was dismissed. */
  dismissed: boolean;
}

/** Stores moments for an account (each at most once, by dedupe key). Returns how many were new. */
export async function sendMomentsTx(ex: Executor, input: { accountId: string; horseName: string; drafts: readonly gc.MomentDraft[]; now: Date }): Promise<number> {
  let sent = 0;
  for (const d of input.drafts) {
    const data: MomentData = { moment: d.kind, horseName: input.horseName, body: d.body, href: d.href, ...(d.raceId ? { raceId: d.raceId } : {}), ...(d.tribute ? { tribute: d.tribute } : {}) };
    const rows = await ex
      .insert(inboxItems)
      // raceId stays null on purpose: markInboxRead (viewing a result) must not dismiss a moment
      .values({ accountId: input.accountId, kind: MOMENT_KIND, dedupeKey: d.dedupeKey, title: d.title, data, horseId: d.horseId, createdAt: input.now })
      .onConflictDoNothing()
      .returning({ id: inboxItems.id });
    sent += rows.length;
  }
  return sent;
}

/** Pronoun-ready identity of a horse row for game-core moments. */
export function momentHorse(row: Pick<HorseRow, "id" | "name" | "sex">): { id: string; name: string; sex: string } {
  return { id: row.id, name: row.name, sex: row.sex };
}

/** The tribute card: the career record and the richest race won (Story races don't count on the record). */
export async function careerTribute(ex: Executor, row: HorseRow): Promise<gc.Tribute> {
  const [best] = await ex
    .select({ raceId: races.id, raceName: races.name, purse: races.purse, postTime: races.postTime })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, row.id), eq(raceEntries.status, "entered"), eq(raceEntries.finishPosition, 1), notInArray(races.kind, ["quick", "trial"])))
    .orderBy(desc(races.purse), races.postTime)
    .limit(1);
  const peak = Math.max(row.rating, Number((row.dynamics as { peakOr?: number } | null)?.peakOr ?? 0));
  return {
    starts: row.starts,
    wins: row.wins,
    places: row.places,
    shows: row.shows,
    earnings: row.earnings,
    peakOr: peak,
    bestWin: best ? { raceId: best.raceId, raceName: best.raceName, purse: best.purse, atMs: best.postTime.getTime() } : null,
  };
}

/** True when this is the horse's first run in a Feature or Season Final (this race aside). */
export async function isFirstFeatureRun(ex: Executor, horseId: string, raceId: string): Promise<boolean> {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .where(and(eq(raceEntries.horseId, horseId), eq(raceEntries.status, "entered"), ne(races.id, raceId), inArray(races.kind, ["feature", "final"]), eq(races.status, "settled")));
  return Number(row?.n ?? 0) === 0;
}

function toMoment(i: InboxItemRow): Moment {
  const d = (i.data ?? {}) as Partial<MomentData>;
  return {
    id: i.id,
    kind: (d.moment ?? "quirk") as gc.MomentKind,
    horseId: i.horseId,
    horseName: d.horseName ?? "Your horse",
    title: i.title,
    body: d.body ?? "",
    href: d.href ?? (i.horseId ? `/horse/${i.horseId}` : "/stable"),
    raceId: d.raceId ?? null,
    tribute: d.tribute ?? null,
    createdAt: i.createdAt,
    dismissed: !!i.readAt,
  };
}

/**
 * The account's moments, newest first. A moment from a race is left out until the owner has
 * seen that race's result (no spoilers). `undismissed` = only highlights still to show.
 */
export async function listMoments(ex: Executor, accountId: string, opts: { horseId?: string; undismissed?: boolean; limit?: number } = {}): Promise<Moment[]> {
  const rows = await ex
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.accountId, accountId),
        eq(inboxItems.kind, MOMENT_KIND),
        opts.horseId ? eq(inboxItems.horseId, opts.horseId) : sql`true`,
        opts.undismissed ? isNull(inboxItems.readAt) : sql`true`,
      ),
    )
    .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
    .limit(opts.limit ?? 20);
  const moments = rows.map(toMoment);
  const raceIds = [...new Set(moments.map((m) => m.raceId).filter((x): x is string => !!x))];
  if (!raceIds.length) return moments;
  const unseen = await ex
    .select({ raceId: inboxItems.raceId })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), ne(inboxItems.kind, MOMENT_KIND), inArray(inboxItems.raceId, raceIds), isNull(inboxItems.readAt)));
  const hidden = new Set(unseen.map((u) => u.raceId));
  return moments.filter((m) => !m.raceId || !hidden.has(m.raceId));
}

/** Dismisses a moment's horse-page highlight (idempotent). True when it changed. */
export async function dismissMoment(ex: Executor, input: { accountId: string; id: string; now: Date }): Promise<boolean> {
  const rows = await ex
    .update(inboxItems)
    .set({ readAt: input.now })
    .where(and(eq(inboxItems.id, input.id), eq(inboxItems.accountId, input.accountId), eq(inboxItems.kind, MOMENT_KIND), isNull(inboxItems.readAt)))
    .returning({ id: inboxItems.id });
  return rows.length > 0;
}

export interface LegacyFarmHorse {
  row: HorseRow;
  tribute: gc.Tribute;
  /** Set for a horse that died of a race injury: shown as a memorial. */
  died: { atMs: number; raceId: string | null; raceName: string | null } | null;
}

/** The stable's horses on the Legacy Farm, most recent first, each with its tribute. */
export async function legacyFarm(ex: Executor, stableId: string): Promise<LegacyFarmHorse[]> {
  const rows = await ex
    .select()
    .from(horses)
    .where(and(eq(horses.ownerStableId, stableId), eq(horses.careerStatus, "pasture")))
    .orderBy(desc(horses.pasturedAt), horses.name);
  const out: LegacyFarmHorse[] = [];
  for (const row of rows) {
    const dyn = (row.dynamics ?? {}) as { diedAtMs?: number; diedAtRaceId?: string };
    let died: LegacyFarmHorse["died"] = null;
    if (dyn.diedAtMs) {
      const [r] = dyn.diedAtRaceId ? await ex.select({ name: races.name }).from(races).where(eq(races.id, dyn.diedAtRaceId)) : [];
      died = { atMs: dyn.diedAtMs, raceId: dyn.diedAtRaceId ?? null, raceName: r?.name ?? null };
    }
    out.push({ row, tribute: await careerTribute(ex, row), died });
  }
  return out;
}

/** The account's latest Sunday League recaps (leagues.ts `week_recap`), newest first. */
export async function listWeekRecaps(ex: Executor, accountId: string, limit = 2) {
  return ex
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "week_recap")))
    .orderBy(desc(inboxItems.createdAt))
    .limit(limit);
}
