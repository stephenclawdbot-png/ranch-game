/**
 * Sponsor a race: a prestige credit sink. A stable pays Stable Credits (burned, ledger kind
 * `race_sponsorship`) to have a future Live card race carry its name for that race:
 * "Ashcombe Handicap (0-55)" becomes "The Glenmorrow House Handicap (0-55)".
 *
 *   sponsorRace (one sponsor per slot, first come first served, idempotent per key)
 *     → slot already published and open: the race is renamed in place
 *     → not yet published: ensureRaceCard applies it on publication (applyPendingSponsorships)
 *   → settleRace: the sponsor gets an inbox note with the result (noteSponsorResult)
 *   → cancelRace: the price goes back (refundSponsorshipForRace)
 *
 * Only ordinary Live card slots are for sale (Maidens to hourly Features); calendar races
 * (Feature Qualifiers, the Weekend Feature, the Saturday Plate, Season Finals) are not. The
 * sponsor is stored on the original race row (`conditions.sponsor`), so replays and results keep
 * the name; sister courses of the slot keep their course name and show "sponsored by" from the
 * original (raceSponsor). Perks are cosmetic only: the name, the sponsor's silks on the
 * racecard header, the result note and a Trophy Room plaque.
 *
 * Lock order (as everywhere): race row → stable → ledger accounts.
 */
import { and, asc, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { inboxItems, raceSponsorships, races, type RaceRow, type RaceSponsorshipRow } from "../schema";
import type { Db, Executor, Tx } from "../types";
import { lockStableOf } from "./accounts";
import { defaultCardSlot, isCalendarSlot, slotIndexAt, slotIndexOf, slotPostTime } from "./card";
import { playerLedgerAccountId, post, spendCreditsTx, systemAccountId } from "./ledger";
import type { CreateRaceInput, RaceConditions, RaceKind } from "./races";
import { audit, runTx } from "./tx";

/**
 * Sponsorship knobs (docs/foundation/KNOBS.md §10b). The one place prices and limits are set.
 */
export const SPONSORSHIP = {
  /**
   * Price = the slot's purse × this. With the live purses: Maiden 3,000, Novice 3,750,
   * Handicaps 4,500 / 6,000 / 7,500, Listed 12,000, hourly Features 24,000 (Listed) and
   * 36,000 (Group 3). Priced off the purse so the bigger stage costs more, and well above what a
   * win in the race pays, so it is a prestige spend, never an investment.
   */
  purseMultiple: 3,
  /** Price floor (the cheapest race still costs as much as a new stable's starting credits). */
  minPrice: 3_000,
  /** How far ahead a slot can be sponsored (beyond the published card: applied on publication). */
  windowMs: 7 * 24 * 60 * 60 * 1000,
  /** Upcoming sponsorships one stable may hold at once, so one stable can't buy up a week's Features. */
  maxUpcomingPerStable: 3,
  /** Characters of the stable name kept in the race name (the stable name itself is at most 32). */
  maxNameChars: 32,
} as const;

/** Credits to sponsor a race with this purse. */
export function sponsorshipPrice(purse: number): number {
  return Math.max(SPONSORSHIP.minPrice, Math.round(purse * SPONSORSHIP.purseMultiple));
}

/** The sponsor as stored on the race row (`conditions.sponsor`). */
export interface RaceSponsor {
  sponsorshipId: string;
  stableId: string;
  stableName: string;
  /** The sponsor's silks at purchase (shown on the racecard header). */
  silks: unknown;
  /** The race's own name before sponsorship (sister courses are named from it). */
  baseName: string;
}

export function sponsorOf(race: Pick<RaceRow, "conditions">): RaceSponsor | null {
  const s = ((race.conditions ?? {}) as RaceConditions).sponsor as Partial<RaceSponsor> | undefined;
  return s && typeof s.stableName === "string" && typeof s.stableId === "string" ? (s as RaceSponsor) : null;
}

/** Conditions without the sponsor (what a sister course copies). */
export function withoutSponsor(c: RaceConditions): RaceConditions {
  const { sponsor: _s, ...rest } = c;
  return rest;
}

/** The race's name with its sponsor removed (sister courses and the race list use it). */
export function baseRaceName(race: Pick<RaceRow, "name" | "conditions">): string {
  return sponsorOf(race)?.baseName ?? race.name;
}

/** A stable name made safe for a race name: the validated character set, one space, no leading "The", length-limited. */
export function sanitiseSponsorName(name: string): string {
  let s = name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} '&.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/i, "");
  if (s.length > SPONSORSHIP.maxNameChars) s = s.slice(0, SPONSORSHIP.maxNameChars).trimEnd();
  return s || "Anonymous";
}

/**
 * "The <Stable Name> <Class label>". The label is the race's own name without its course
 * ("Handicap (0-55)", "Maiden Stakes"); an hourly Feature drops the word Feature (the race
 * keeps its Feature kind) and a bare "Group 3" becomes "Group 3 Stakes".
 */
export function sponsoredRaceName(stableName: string, baseName: string, track?: string): string {
  let label = track && baseName.startsWith(`${track} `) ? baseName.slice(track.length + 1) : baseName;
  label = label.replace(/^Feature\s+/, "");
  if (/^Group \d+$/.test(label)) label = `${label} Stakes`;
  return `The ${sanitiseSponsorName(stableName)} ${label}`;
}

const slotKeyOf = (index: number) => `live:${index}`;
const isSponsorableKind = (kind: RaceKind) => kind === "scheduled" || kind === "feature";

/** A Live card slot on the sponsor list. */
export interface SponsorSlot {
  index: number;
  postTime: Date;
  entriesCloseAt: Date;
  /** The race's own (unsponsored) name. */
  name: string;
  kind: RaceKind;
  raceClass: string;
  track: string;
  distanceM: number | null;
  surface: string | null;
  purse: number;
  price: number;
  /** The published race, when the slot is on the card already. */
  raceId: string | null;
  sponsor: { stableId: string; stableName: string } | null;
  /** Why it can't be bought now (null: on sale). */
  block: "sponsored" | "closed" | null;
}

type CardSlotFn = (index: number) => CreateRaceInput;

function slotOf(index: number, published: RaceRow | undefined, sponsor: RaceSponsorshipRow | undefined, now: Date, make: CardSlotFn): SponsorSlot | null {
  if (isCalendarSlot(index) && !published) return null;
  const made = published ? null : make(index);
  const src: Pick<RaceRow, "name" | "kind" | "raceClass" | "conditions" | "postTime" | "entriesCloseAt" | "purse" | "status"> = published ?? {
    ...made!,
    purse: made!.purse ?? 0,
    status: "open",
  };
  const c = (src.conditions ?? {}) as RaceConditions;
  if (c.calendar || !isSponsorableKind(src.kind)) return null;
  const closed = src.status !== "open" || now >= src.entriesCloseAt;
  return {
    index,
    postTime: src.postTime,
    entriesCloseAt: src.entriesCloseAt,
    name: baseRaceName(src),
    kind: src.kind,
    raceClass: src.raceClass,
    track: String(c.track ?? ""),
    distanceM: typeof c.distanceM === "number" ? c.distanceM : null,
    surface: typeof c.surface === "string" ? c.surface : null,
    purse: src.purse,
    price: sponsorshipPrice(src.purse),
    raceId: published?.id ?? null,
    sponsor: sponsor && !sponsor.refundedAt ? { stableId: sponsor.stableId, stableName: sponsor.stableName } : null,
    block: sponsor ? "sponsored" : closed ? "closed" : null,
  };
}

/** First and last slot index on sale at `now` (the next slot to `now + windowMs`). */
export function sponsorWindow(now: Date): { first: number; last: number } {
  return { first: slotIndexAt(now) + 1, last: slotIndexAt(new Date(now.getTime() + SPONSORSHIP.windowMs)) };
}

/**
 * The sponsor list: every ordinary Live card slot from the next one to `windowMs` ahead (within
 * [from, to] when given), with its price and whether it is still on sale. Calendar races are
 * left out. `cardSlot` replaces the default card (tests).
 */
export async function listSponsorSlots(ex: Executor, now: Date, opts: { from?: Date; to?: Date; cardSlot?: CardSlotFn } = {}): Promise<SponsorSlot[]> {
  const w = sponsorWindow(now);
  const first = Math.max(w.first, opts.from ? slotIndexAt(new Date(opts.from.getTime() - 1)) + 1 : w.first);
  const last = Math.min(w.last, opts.to ? slotIndexAt(opts.to) : w.last);
  if (last < first) return [];
  const make = opts.cardSlot ?? defaultCardSlot;
  const published = await ex
    .select()
    .from(races)
    .where(and(gte(races.postTime, slotPostTime(first)), lte(races.postTime, slotPostTime(last)), sql`${races.slotKey} ~ '^live:[0-9]+$'`));
  const byIndex = new Map(published.map((r) => [slotIndexOf(r.slotKey)!, r]));
  const sold = await ex
    .select()
    .from(raceSponsorships)
    .where(and(gte(raceSponsorships.slotIndex, first), lte(raceSponsorships.slotIndex, last)));
  const soldBy = new Map(sold.map((s) => [s.slotIndex, s]));
  const out: SponsorSlot[] = [];
  for (let i = first; i <= last; i++) {
    const s = slotOf(i, byIndex.get(i), soldBy.get(i), now, make);
    if (s) out.push(s);
  }
  return out;
}

export interface SponsorRaceInput {
  accountId: string;
  slotIndex: number;
  /** Client key for this purchase (a retry with the same key is a no-op). */
  idempotencyKey: string;
  now: Date;
  cardSlot?: CardSlotFn;
}

export interface SponsorRaceResult {
  sponsorship: RaceSponsorshipRow;
  /** The published race now carrying the name (null until the slot is published). */
  raceId: string | null;
  /** The name the race carries (or will carry when published). */
  raceName: string;
  duplicate: boolean;
}

/**
 * Buys a slot's sponsorship. One sponsor per slot (unique slot index: the first purchase wins,
 * the rest get ALREADY_SPONSORED); the same key returns the original purchase without charging
 * twice. Refused for calendar races, slots outside the window, and races whose entries have
 * closed. A published, open race is renamed at once.
 */
export async function sponsorRace(db: Db, input: SponsorRaceInput): Promise<SponsorRaceResult> {
  const { now, slotIndex: index } = input;
  if (!Number.isSafeInteger(index)) throw new DomainError("INVALID_INPUT", "no such race slot");
  if (!input.idempotencyKey) throw new DomainError("INVALID_INPUT", "idempotency key required");
  return runTx(db, async (tx) => {
    const replay = await byKey(tx, input.accountId, input.idempotencyKey);
    if (replay) return duplicateOf(tx, replay, index);

    const w = sponsorWindow(now);
    if (index < w.first) throw new DomainError("RACE_CLOSED", "that race has already gone");
    if (index > w.last) throw new DomainError("NOT_ELIGIBLE", `races can be sponsored up to ${Math.round(SPONSORSHIP.windowMs / 86_400_000)} days ahead`);
    const [published] = await tx.select().from(races).where(eq(races.slotKey, slotKeyOf(index))).for("update");
    const make = input.cardSlot ?? defaultCardSlot;
    const slot = slotOf(index, published, undefined, now, make);
    if (!slot) throw new DomainError("NOT_ELIGIBLE", "calendar races (Feature Qualifiers, the Weekend Feature, the Saturday Plate and Season Finals) can't be sponsored");
    if (slot.block === "closed") throw new DomainError("RACE_CLOSED", "entries for that race have closed");

    const stable = await lockStableOf(tx, input.accountId);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(raceSponsorships)
      .where(and(eq(raceSponsorships.stableId, stable.id), gt(raceSponsorships.postTime, now), isNull(raceSponsorships.refundedAt)));
    if (Number(n) >= SPONSORSHIP.maxUpcomingPerStable) {
      throw new DomainError("NOT_ELIGIBLE", `a stable can sponsor at most ${SPONSORSHIP.maxUpcomingPerStable} upcoming races at a time`);
    }

    const [row] = await tx
      .insert(raceSponsorships)
      .values({
        slotIndex: index,
        postTime: slot.postTime,
        accountId: input.accountId,
        stableId: stable.id,
        stableName: stable.name,
        silks: stable.silks,
        price: slot.price,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      // Lost the race for the slot, or a concurrent retry with this key won it.
      const again = await byKey(tx, input.accountId, input.idempotencyKey);
      if (again) return duplicateOf(tx, again, index);
      throw new DomainError("ALREADY_SPONSORED", "another stable has already sponsored that race");
    }
    const paid = await spendCreditsTx(tx, {
      accountId: input.accountId,
      amount: slot.price,
      idempotencyKey: `race-sponsorship:${row.id}`,
      kind: "race_sponsorship",
      memo: `Sponsored ${sponsoredRaceName(stable.name, slot.name, slot.track)}`,
    });
    let sponsorship: RaceSponsorshipRow = { ...row, ledgerTransactionId: paid.transactionId };
    await tx.update(raceSponsorships).set({ ledgerTransactionId: paid.transactionId }).where(eq(raceSponsorships.id, row.id));
    let raceName = sponsoredRaceName(stable.name, slot.name, slot.track);
    if (published && (await applyToRace(tx, sponsorship, published, now))) {
      sponsorship = { ...sponsorship, raceId: published.id };
    }
    await audit(tx, { actor: input.accountId, action: "race.sponsor", entityType: "race_sponsorship", entityId: row.id, data: { slot: index, price: slot.price, raceId: published?.id ?? null } });
    if (published) raceName = (await tx.select({ name: races.name }).from(races).where(eq(races.id, published.id)))[0]?.name ?? raceName;
    return { sponsorship, raceId: sponsorship.raceId, raceName, duplicate: false };
  });
}

async function byKey(ex: Executor, accountId: string, key: string): Promise<RaceSponsorshipRow | null> {
  const [r] = await ex.select().from(raceSponsorships).where(and(eq(raceSponsorships.accountId, accountId), eq(raceSponsorships.idempotencyKey, key)));
  return r ?? null;
}

async function duplicateOf(ex: Executor, s: RaceSponsorshipRow, index: number): Promise<SponsorRaceResult> {
  if (s.slotIndex !== index) throw new DomainError("IDEMPOTENCY_CONFLICT", "that key was used to sponsor another race");
  const [race] = s.raceId ? await ex.select({ name: races.name }).from(races).where(eq(races.id, s.raceId)) : [];
  const slot = race ? null : defaultCardSlot(s.slotIndex);
  return { sponsorship: s, raceId: s.raceId, raceName: race?.name ?? sponsoredRaceName(s.stableName, slot!.name, String(slot!.conditions.track ?? "")), duplicate: true };
}

/**
 * Names a locked (FOR UPDATE) original race after its sponsor. False when the race can no
 * longer take a name (entries closed): the caller refunds.
 */
async function applyToRace(tx: Tx, s: RaceSponsorshipRow, race: RaceRow, now: Date): Promise<boolean> {
  const existing = sponsorOf(race);
  if (existing) return existing.sponsorshipId === s.id;
  if (race.status !== "open" || now >= race.entriesCloseAt) return false;
  const c = (race.conditions ?? {}) as RaceConditions;
  const sponsor: RaceSponsor = { sponsorshipId: s.id, stableId: s.stableId, stableName: s.stableName, silks: s.silks ?? null, baseName: race.name };
  await tx
    .update(races)
    .set({ name: sponsoredRaceName(s.stableName, race.name, String(c.track ?? "")), conditions: { ...c, sponsor } })
    .where(eq(races.id, race.id));
  await tx.update(raceSponsorships).set({ raceId: race.id }).where(eq(raceSponsorships.id, s.id));
  await audit(tx, { actor: null, action: "race.sponsor.apply", entityType: "race", entityId: race.id, data: { sponsorshipId: s.id } });
  return true;
}

/** Gives a sponsorship's price back (burn → player) once, with an inbox note. */
async function refundTx(tx: Tx, s: RaceSponsorshipRow, now: Date, why: string): Promise<void> {
  if (s.refundedAt) return;
  await post(tx, {
    idempotencyKey: `race-sponsorship-refund:${s.id}`,
    kind: "race_sponsorship_refund",
    postings: [
      { ledgerAccountId: await systemAccountId(tx, "burn"), amount: -s.price },
      { ledgerAccountId: await playerLedgerAccountId(tx, s.accountId), amount: s.price },
    ],
  });
  await tx.update(raceSponsorships).set({ refundedAt: now }).where(eq(raceSponsorships.id, s.id));
  await tx
    .insert(inboxItems)
    .values({
      accountId: s.accountId,
      kind: "race_sponsor",
      dedupeKey: `sponsor-refund:${s.id}`,
      title: `Your race sponsorship was refunded: ${why}`,
      data: { sponsorshipId: s.id, refunded: s.price, raceId: s.raceId },
      // an abandoned race has no page to link to
      raceId: null,
      createdAt: now,
    })
    .onConflictDoNothing();
  await audit(tx, { actor: null, action: "race.sponsor.refund", entityType: "race_sponsorship", entityId: s.id, data: { why, price: s.price } });
}

/**
 * Applies sponsorships bought before their slot was published (ensureRaceCard calls it for the
 * slots it publishes). Idempotent; a race whose entries already closed (a purchase that raced
 * publication and missed every tick) refunds instead.
 */
export async function applyPendingSponsorships(db: Db, firstIndex: number, lastIndex: number, now: Date): Promise<number> {
  const pending = await db
    .select({ id: raceSponsorships.id, slotIndex: raceSponsorships.slotIndex })
    .from(raceSponsorships)
    .where(and(gte(raceSponsorships.slotIndex, firstIndex), lte(raceSponsorships.slotIndex, lastIndex), isNull(raceSponsorships.raceId), isNull(raceSponsorships.refundedAt)))
    .orderBy(asc(raceSponsorships.slotIndex));
  let applied = 0;
  for (const p of pending) {
    await runTx(db, async (tx) => {
      const [race] = await tx.select().from(races).where(eq(races.slotKey, slotKeyOf(p.slotIndex))).for("update");
      if (!race) return;
      const [s] = await tx.select().from(raceSponsorships).where(eq(raceSponsorships.id, p.id)).for("update");
      if (!s || s.raceId || s.refundedAt) return;
      if (await applyToRace(tx, s, race, now)) applied++;
      else await refundTx(tx, { ...s, raceId: race.id }, now, `entries for the ${race.name} closed before it could carry your name`);
    });
  }
  return applied;
}

/** The sponsorship of a race (none for unsponsored or refunded ones). */
async function sponsorshipOfRace(ex: Executor, raceId: string): Promise<RaceSponsorshipRow | null> {
  const [s] = await ex.select().from(raceSponsorships).where(and(eq(raceSponsorships.raceId, raceId), isNull(raceSponsorships.refundedAt)));
  return s ?? null;
}

/** settleRace: the sponsor's result note (once per race). */
export async function noteSponsorResult(tx: Tx, race: RaceRow, winner: { horseId: string; name: string; stableName: string | null } | null, fieldSize: number, now: Date): Promise<void> {
  if (!sponsorOf(race)) return;
  const s = await sponsorshipOfRace(tx, race.id);
  if (!s) return;
  await tx
    .insert(inboxItems)
    .values({
      accountId: s.accountId,
      kind: "race_sponsor",
      dedupeKey: `sponsor:${race.id}`,
      title: winner ? `Your race: ${winner.name} won ${race.name}` : `Your race: ${race.name} has been run`,
      data: { sponsorshipId: s.id, winnerHorseId: winner?.horseId ?? null, winnerName: winner?.name ?? null, winnerStable: winner?.stableName ?? null, fieldSize },
      raceId: race.id,
      // not the sponsor's horse: the home screen's "your horse has run" cards skip this note
      horseId: null,
      createdAt: now,
    })
    .onConflictDoNothing();
}

/** cancelRace: an abandoned sponsored race gives its sponsor the price back. */
export async function refundSponsorshipForRace(tx: Tx, race: RaceRow, now: Date): Promise<void> {
  if (!sponsorOf(race)) return;
  const s = await sponsorshipOfRace(tx, race.id);
  if (s) await refundTx(tx, s, now, `the ${race.name} was abandoned`);
}

/**
 * The sponsor of any Live card race: its own (`conditions.sponsor`), or for a sister course the
 * original's (sisters keep their course name and show "sponsored by").
 */
export async function raceSponsor(ex: Executor, race: Pick<RaceRow, "conditions" | "slotKey">): Promise<RaceSponsor | null> {
  const own = sponsorOf(race);
  if (own) return own;
  const index = slotIndexOf(race.slotKey);
  if (index === null || race.slotKey === slotKeyOf(index)) return null;
  const [original] = await ex.select({ conditions: races.conditions }).from(races).where(eq(races.slotKey, slotKeyOf(index)));
  return original ? sponsorOf(original) : null;
}

export interface StableSponsorship {
  id: string;
  slotIndex: number;
  postTime: Date;
  price: number;
  raceId: string | null;
  /** The race's current name (null until published). */
  raceName: string | null;
  raceStatus: RaceRow["status"] | null;
  refunded: boolean;
}

/** A stable's sponsorships, newest race first (the sponsor page and the Trophy Room plaques). */
export async function listStableSponsorships(ex: Executor, stableId: string, limit = 200): Promise<StableSponsorship[]> {
  const rows = await ex
    .select({ s: raceSponsorships, raceName: races.name, raceStatus: races.status })
    .from(raceSponsorships)
    .leftJoin(races, eq(races.id, raceSponsorships.raceId))
    .where(eq(raceSponsorships.stableId, stableId))
    .orderBy(desc(raceSponsorships.postTime))
    .limit(limit);
  return rows.map(({ s, raceName, raceStatus }) => ({
    id: s.id,
    slotIndex: s.slotIndex,
    postTime: s.postTime,
    price: s.price,
    raceId: s.raceId,
    raceName: raceName ?? null,
    raceStatus: raceStatus ?? null,
    refunded: !!s.refundedAt,
  }));
}
