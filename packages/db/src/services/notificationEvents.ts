/**
 * The notification events that have no other home (services/notifications.ts writes them):
 *
 *   injury          settleRace / runTrainingSession: a horse was injured (not a fatal one: that is
 *                   the memorial moment). A race injury waits until that result has been watched.
 *   back_in_race    a horse's injury has healed and it can race again: the throttled sweep
 *                   (sweepNotifications, lazily on reads) and healInjuries (the daily backstop).
 *   training_ready  a new training week for horses that used every session of the last one
 *                   (the player trains them): one digest per stable per week.
 *   race_suits      the card published a meeting with races that suit one of the player's horses
 *                   (trip, surface, class and rating band): one digest per meeting (ensureRaceCard).
 *   race_off        the field of a Live card race the player entered has locked: it goes off in
 *                   moments ("we'll ring the bell when it's off"); one per entered horse, at the
 *                   lock (lockField). Neutral: nothing about how it went.
 *   listing_expired a credits or T-USDG listing ran out, or an auction closed without a sale
 *                   (market.ts expireListings, usdgMarket.ts): in the expiry's transaction.
 *
 * Every event has a dedupe key, so whichever path runs first writes it and the rest are no-ops.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, like, lte, sql } from "drizzle-orm";
import { horses, races, stables, type HorseRow, type RaceRow } from "../schema";
import { RULES } from "../rules";
import { gc, genomeOf, isInjury } from "../gameCore";
import type { Db, Executor } from "../types";
import { notify } from "./notifications";
import { facilityLevels } from "./horseLife";
import { classEligibility, featureQualificationReason, type RaceConditions } from "./races";
import { LIVE_SLOT_KEY_LIKE } from "./card";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** "about 3 days" / "about 5 hours" until a time. */
function untilText(fromMs: number, toMs: number): string {
  const ms = Math.max(0, toMs - fromMs);
  if (ms >= 36 * HOUR_MS) {
    const d = Math.round(ms / DAY_MS);
    return `about ${d} ${d === 1 ? "day" : "days"}`;
  }
  const h = Math.max(1, Math.round(ms / HOUR_MS));
  return `about ${h} ${h === 1 ? "hour" : "hours"}`;
}

/** The account racing a horse day to day (its lessee, else its owner), or null for a Club horse. */
async function keeperAccountOf(ex: Executor, h: Pick<HorseRow, "ownerStableId" | "lesseeStableId">): Promise<string | null> {
  const stableId = h.lesseeStableId ?? h.ownerStableId;
  if (!stableId) return null;
  const [s] = await ex.select({ accountId: stables.accountId }).from(stables).where(eq(stables.id, stableId));
  return s?.accountId ?? null;
}

// ---------------------------------------------------------------------------
// "Your horse has been injured"
// ---------------------------------------------------------------------------

export interface InjuryNote {
  horse: Pick<HorseRow, "id" | "name">;
  /** The race it happened in (the note waits until that result is watched), or null (training). */
  raceId: string | null;
  /** Unique per injury: the race id, or the training session's key. */
  source: string;
  name: string;
  severity: string | null;
  careerEnding: boolean;
  backAt: Date | null;
  now: Date;
  /** The player was there (a training session): the note is written already seen. */
  seen?: boolean;
}

/** Tells each account (owner, and the lessee racing it) that a horse was injured. */
export async function noteInjuryTx(ex: Executor, accountIds: readonly (string | null | undefined)[], n: InjuryNote): Promise<number> {
  const title = n.careerEnding
    ? `${n.horse.name} was injured (${n.name}) and can't race again`
    : `${n.horse.name} has been injured: ${n.name}${n.backAt ? `, ${untilText(n.now.getTime(), n.backAt.getTime())} to recover` : ""}`;
  let sent = 0;
  for (const accountId of new Set(accountIds.filter((a): a is string => !!a))) {
    const id = await notify(ex, {
      accountId,
      kind: "injury",
      dedupeKey: `injury:${n.horse.id}:${n.source}`,
      title,
      data: { href: `/horse/${n.horse.id}`, injury: n.name, severity: n.severity, careerEnding: n.careerEnding, backAtMs: n.backAt?.getTime() ?? null, ...(n.raceId ? { raceId: n.raceId } : {}) },
      horseId: n.horse.id,
      now: n.now,
      seen: n.seen,
    });
    if (id) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// "Back in the race"
// ---------------------------------------------------------------------------

/**
 * Racing horses whose injury has healed by `now` get a "back in the race" note (once per injury).
 * Reads only rows with injured_until set (partial index), which healInjuries clears daily; `since`
 * narrows the lazy sweep to recent recoveries (healInjuries passes none and catches the rest).
 */
export async function noteRecoveriesTx(ex: Executor, now: Date, opts: { since?: Date } = {}): Promise<number> {
  const rows = await ex
    .select()
    .from(horses)
    .where(and(isNotNull(horses.injuredUntil), lte(horses.injuredUntil, now), opts.since ? gt(horses.injuredUntil, opts.since) : undefined, eq(horses.careerStatus, "racing")))
    .orderBy(asc(horses.id));
  let sent = 0;
  for (const h of rows) {
    const injury = (h.injury ?? null) as { severity?: string; kind?: string; atMs?: number; source?: string; raceId?: string } | null;
    if (injury?.severity === "fatal" || injury?.severity === "career_ending") continue;
    const accountId = await keeperAccountOf(ex, h);
    if (!accountId) continue;
    const raceId = injury?.raceId ?? (injury?.source && injury.source !== "training" ? injury.source : null);
    const key = injury?.atMs ?? injury?.raceId ?? h.injuredUntil!.getTime();
    const name = isInjury(h.injury) ? gc.injuryName(h.injury) : gc.injuryNameOf(injury?.severity, injury?.kind);
    const id = await notify(ex, {
      accountId,
      kind: "back_in_race",
      dedupeKey: `back:${h.id}:${key}`,
      title: `${h.name} is over the ${name.toLowerCase()} and can race again`,
      data: { href: `/horse/${h.id}`, injury: name, ...(raceId && /^[0-9a-f-]{36}$/i.test(raceId) ? { raceId } : {}) },
      horseId: h.id,
      now,
    });
    if (id) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// "Training session available"
// ---------------------------------------------------------------------------

/**
 * Once a training week has started: one note per stable for its racing horses that used every
 * session of the week before (horses the player really trains), now that their sessions are back.
 */
export async function noteTrainingWeekTx(ex: Executor, now: Date): Promise<number> {
  const week = gc.weekIndex(now.getTime());
  const rows = await ex
    .select({ horse: horses, facilities: stables.facilities, accountId: stables.accountId })
    .from(horses)
    .innerJoin(stables, eq(stables.id, sql`coalesce(${horses.lesseeStableId}, ${horses.ownerStableId})`))
    .where(
      and(
        eq(horses.careerStatus, "racing"),
        sql`(${horses.dynamics}->'training'->>'week')::int = ${week - 1}`,
        sql`coalesce((${horses.dynamics}->'training'->>'sessionsThisWeek')::int, 0) >= ${gc.slotsFor(0)}`,
        sql`(${horses.injuredUntil} is null or ${horses.injuredUntil} <= ${now})`,
      ),
    )
    .orderBy(asc(horses.name));
  const byAccount = new Map<string, HorseRow[]>();
  for (const r of rows) {
    const used = Number((r.horse.dynamics as { training?: { sessionsThisWeek?: number } }).training?.sessionsThisWeek ?? 0);
    if (used < gc.slotsFor(facilityLevels({ facilities: r.facilities }).trainer)) continue;
    if (r.horse.lockKind === "market" || r.horse.lockKind === "stud") continue;
    byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r.horse]);
  }
  let sent = 0;
  for (const [accountId, hs] of byAccount) {
    const first = hs[0]!;
    const id = await notify(ex, {
      accountId,
      kind: "training_ready",
      dedupeKey: `training-week:${week}`,
      title:
        hs.length === 1
          ? `${first.name} can train again: a new training week has started`
          : `${hs.length} horses can train again: ${hs
              .slice(0, 3)
              .map((h) => h.name)
              .join(", ")}${hs.length > 3 ? " and more" : ""}`,
      data: { href: hs.length === 1 ? `/horse/${first.id}` : "/stable", week, horses: hs.map((h) => ({ id: h.id, name: h.name })) },
      horseId: hs.length === 1 ? first.id : null,
      now,
    });
    if (id) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// "A new race has opened that suits your horse"
// ---------------------------------------------------------------------------

/** How far a race's trip may be from the horse's best trip and still suit it. */
export const SUITS_TRIP_MARGIN_M = 200;

/** True when the race suits the horse (public facts only: best trip and surface, class and rating band). */
export function raceSuits(h: HorseRow, race: Pick<RaceRow, "raceClass" | "conditions" | "postTime">): boolean {
  if (h.careerStatus !== "racing" || h.starts >= RULES.maxStarts || h.careSessions < RULES.careToRacing) return false;
  if (h.lockKind === "market" || h.lockKind === "stud") return false;
  if (h.injuredUntil && h.injuredUntil > race.postTime) return false;
  const c = (race.conditions ?? {}) as RaceConditions & { claiming?: boolean };
  if (c.claiming) return false; // never suggest a race the horse could be claimed out of
  const genome = genomeOf(h.genome);
  if (!genome || typeof c.distanceM !== "number" || typeof c.surface !== "string") return false;
  if (gc.preferredSurface(genome) !== c.surface) return false;
  if (Math.abs(gc.preferredDistanceM(genome) - c.distanceM) > SUITS_TRIP_MARGIN_M) return false;
  return classEligibility(h, race) === null;
}

/** Matches listed in one digest (the title still counts them all). */
const SUITS_LIST_MAX = 8;
/**
 * At most one "races that suit" digest per account in each window of this length (by the
 * meeting's first post time): with a meeting every 3 hours, two a day instead of eight.
 */
export const SUITS_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * One digest per account for a just-published meeting ([fromMs, toMs] post times): its open
 * races that suit one of the player's racing horses. Idempotent, and at most one per account in
 * each SUITS_WINDOW_MS window (the first meeting of the window with a match sends it).
 */
export async function noteRacesThatSuit(db: Db, input: { meeting: number; fromMs: number; toMs: number; now: Date }): Promise<number> {
  const card = await db
    .select()
    .from(races)
    .where(and(eq(races.status, "open"), gte(races.postTime, new Date(input.fromMs)), lte(races.postTime, new Date(input.toMs)), like(races.slotKey, LIVE_SLOT_KEY_LIKE)))
    .orderBy(asc(races.postTime), asc(races.slotKey));
  if (!card.length) return 0;
  const rows = await db
    .select({ horse: horses, accountId: stables.accountId })
    .from(horses)
    .innerJoin(stables, eq(stables.id, sql`coalesce(${horses.lesseeStableId}, ${horses.ownerStableId})`))
    .where(and(eq(horses.careerStatus, "racing"), sql`${horses.starts} < ${RULES.maxStarts}`, sql`${horses.careSessions} >= ${RULES.careToRacing}`))
    .orderBy(asc(horses.name));
  type Match = { raceId: string; raceName: string; postTimeMs: number; horseId: string; horseName: string };
  const byAccount = new Map<string, Match[]>();
  for (const { horse: h, accountId } of rows) {
    for (const r of card) {
      if (!raceSuits(h, r)) continue;
      if (await featureQualificationReason(db, h, r)) continue;
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), { raceId: r.id, raceName: r.name, postTimeMs: r.postTime.getTime(), horseId: h.id, horseName: h.name }]);
    }
  }
  let sent = 0;
  for (const [accountId, matches] of byAccount) {
    const first = matches[0]!;
    const racesN = new Set(matches.map((m) => m.raceId)).size;
    const horsesN = new Set(matches.map((m) => m.horseId)).size;
    const at = new Date(first.postTimeMs).toISOString().slice(11, 16);
    const id = await notify(db, {
      accountId,
      kind: "race_suits",
      dedupeKey: `race-suits:w${Math.floor(input.fromMs / SUITS_WINDOW_MS)}`,
      title:
        matches.length === 1
          ? `A new race suits ${first.horseName}: the ${first.raceName} (${at} UTC)`
          : horsesN === 1
            ? `${racesN} new races suit ${first.horseName} at the meeting from ${at} UTC`
            : `${racesN} new races suit ${horsesN} of your horses at the meeting from ${at} UTC`,
      data: { href: racesN === 1 ? `/race/${first.raceId}` : "/races", meeting: input.meeting, total: matches.length, matches: matches.slice(0, SUITS_LIST_MAX) },
      horseId: horsesN === 1 ? first.horseId : null,
      now: input.now,
    });
    if (id) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// "Your race is off"
// ---------------------------------------------------------------------------

/**
 * The bell for a locked Live card race: one note per player runner to the account racing it
 * (the entering stable), linking to the race. Written inside the lock's transaction, so a field
 * that locks once rings once. Pre-race and outcome-free (no spoiler); the result note follows at
 * settlement as before.
 */
export async function noteRaceOffTx(ex: Executor, race: Pick<RaceRow, "id" | "name" | "postTime">, runners: readonly { horseId: string; stableId: string | null }[], now: Date): Promise<number> {
  const mine = runners.filter((r): r is { horseId: string; stableId: string } => !!r.stableId);
  if (!mine.length) return 0;
  const names = new Map((await ex.select({ id: horses.id, name: horses.name }).from(horses).where(inArray(horses.id, mine.map((r) => r.horseId)))).map((h) => [h.id, h.name]));
  const accounts = new Map((await ex.select({ id: stables.id, accountId: stables.accountId }).from(stables).where(inArray(stables.id, [...new Set(mine.map((r) => r.stableId))]))).map((s) => [s.id, s.accountId]));
  let sent = 0;
  for (const r of mine) {
    const accountId = accounts.get(r.stableId);
    if (!accountId) continue;
    const name = names.get(r.horseId) ?? "Your horse";
    const id = await notify(ex, {
      accountId,
      kind: "race_off",
      dedupeKey: `race-off:${race.id}:${r.horseId}`,
      title: `${name} is going to post in the ${race.name}: watch it live`,
      data: { href: `/race/${race.id}`, postTimeMs: race.postTime.getTime() },
      raceId: race.id,
      horseId: r.horseId,
      now,
    });
    if (id) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// "Your market listing expired"
// ---------------------------------------------------------------------------

/** The seller's note for a listing that ended unsold (credits, T-USDG / USDG, or an auction). */
export async function noteListingExpiredTx(
  ex: Executor,
  input: { accountId: string; listingId: string; horseId: string; market: "credits" | "usdg"; auction?: boolean; hadBids?: boolean; now: Date },
): Promise<string | null> {
  const [h] = await ex.select({ name: horses.name }).from(horses).where(eq(horses.id, input.horseId));
  const name = h?.name ?? "Your horse";
  const title = input.auction
    ? `${name}'s auction ended without a sale${input.hadBids ? "" : " (no bids)"}: ${name} is back in your stable`
    : `${name}'s listing expired unsold: ${name} is back in your stable`;
  return notify(ex, {
    accountId: input.accountId,
    kind: "listing_expired",
    dedupeKey: `listing-expired:${input.market}:${input.listingId}`,
    title,
    data: { href: `/horse/${input.horseId}`, listingId: input.listingId, market: input.market, auction: !!input.auction },
    horseId: input.horseId,
    now: input.now,
  });
}

// ---------------------------------------------------------------------------
// The sweep (lazily on reads, throttled by the caller; and in the daily maintenance)
// ---------------------------------------------------------------------------

export interface NotificationSweep {
  backInRace: number;
  trainingReady: number;
}

/** The lazy sweep looks back this far for healed injuries (it runs every minute or so; the daily heal catches the rest). */
export const SWEEP_LOOKBACK_MS = 6 * HOUR_MS;

/** The training week each database was last swept for (the week's set of horses is fixed once it starts). */
const trainingSwept = new WeakMap<object, number>();

/** Time-driven notes: horses back from injury, and the new training week (once per week per process). Idempotent. */
export async function sweepNotifications(db: Db, now: Date): Promise<NotificationSweep> {
  const backInRace = await noteRecoveriesTx(db, now, { since: new Date(now.getTime() - SWEEP_LOOKBACK_MS) });
  const week = gc.weekIndex(now.getTime());
  let trainingReady = 0;
  if (trainingSwept.get(db) !== week) {
    trainingReady = await noteTrainingWeekTx(db, now);
    trainingSwept.set(db, week);
  }
  return { backInRace, trainingReady };
}

