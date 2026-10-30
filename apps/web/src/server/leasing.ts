/**
 * Sales > Lease (horse leasing): the board, the viewer's offers and leases, and the actions.
 * Rules, locks and money live in @thoroughbred/db leasing.ts; numbers in game-core leasing.ts.
 * Clients send choices (which horse, which terms, which offer), never outcomes.
 */
import * as gc from "@thoroughbred/game-core";
import {
  LEASE_BLOCK_TEXT,
  defaultAppraise,
  leaseBoard,
  leaseHorseBlock,
  lesseeEligibility,
  lesseeRecords,
  listStableHorses,
  myLeaseOffers,
  occupancy,
  offerLease,
  ownerLeaseCaps,
  rateLessee,
  recentFormOf,
  returnLease,
  stableLeases,
  sweepLeases,
  takeLease,
  withdrawLeaseOffer,
  type Db,
  type HorseLeaseRow,
  type LesseeRecord,
} from "@thoroughbred/db";
import type { LeaseConfigView, LeaseListingView, LeaseOfferable, LeaseRowView, LeaseView, LesseeRecordView } from "@/lib/economyTypes";
import { ecoHorse } from "./economy";
import { parseSilks } from "./horseView";
import type { Session } from "./session";

// The lease sweep (lapsed offers, terms over) runs lazily at most every 30 s per instance.
const SWEEP_EVERY_MS = 30_000;
const G = globalThis as typeof globalThis & { __tbLeaseSweepAt?: number };

/** Ends due leases and lapses offers (lazy; the maintenance cron is the backstop). Never throws. */
export async function maybeSweepLeases(db: Db, now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (G.__tbLeaseSweepAt !== undefined && nowMs - G.__tbLeaseSweepAt < SWEEP_EVERY_MS && nowMs >= G.__tbLeaseSweepAt) return;
  G.__tbLeaseSweepAt = nowMs;
  try {
    await sweepLeases(db, now);
  } catch (err) {
    G.__tbLeaseSweepAt = undefined;
    console.error("lease sweep", err);
  }
}

export function leaseConfig(): LeaseConfigView {
  return {
    terms: [...gc.LEASE_TERMS_DAYS],
    shareMin: gc.LEASE_OWNER_SHARE_MIN_PCT,
    shareMax: gc.LEASE_OWNER_SHARE_MAX_PCT,
    shareDefault: gc.LEASE_OWNER_SHARE_DEFAULT_PCT,
    weeklyMin: gc.LEASE_WEEKLY_STARTS_MIN,
    weeklyMax: gc.LEASE_WEEKLY_STARTS_MAX,
    weeklyDefault: gc.LEASE_WEEKLY_STARTS_DEFAULT,
    feeMax: gc.LEASE_FEE_MAX,
    offerDays: gc.LEASE_OFFER_DAYS,
    cooldownDays: gc.LEASE_RELIST_COOLDOWN_DAYS,
    maxLesseeLeases: gc.MAX_LEASES_PER_LESSEE,
    maxOpenOffers: gc.MAX_OPEN_LEASE_OFFERS,
    maxOutCap: gc.MAX_LEASES_OUT_PER_OWNER,
    outSharePct: gc.LEASES_OUT_SHARE_PERMILLE / 10,
    minAccountDays: gc.LESSEE_MIN_ACCOUNT_DAYS,
    minLiveStarts: gc.LESSEE_MIN_LIVE_STARTS,
    unratedStars: gc.LEASE_UNRATED_STARS,
    minStartsLeft: gc.LEASE_MIN_STARTS_LEFT,
  };
}

export function recordView(r: LesseeRecord | undefined): LesseeRecordView {
  return {
    leases: r?.leases ?? 0,
    races: r?.races ?? 0,
    injuries: r?.injuries ?? 0,
    avgFatigueAtEntry: r?.avgFatigueAtEntry ?? null,
    ratings: r?.ratings ?? 0,
    starsTenths: r?.starsTenths ?? null,
  };
}

function conditionLabelOf(c: unknown): string | null {
  const label = (c as { label?: unknown } | null)?.label;
  return typeof label === "string" ? label : null;
}

export async function leaseView(db: Db, session: Session, now: Date): Promise<LeaseView> {
  await maybeSweepLeases(db, now);
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const board = await leaseBoard(db, now);
  const form = await recentFormOf(db, board.map((b) => b.horse.id));
  const eligibility = await lesseeEligibility(db, { accountId: session.accountId, stableId: session.stable.id, now });
  const myRecord = (await lesseeRecords(db, [session.stable.id])).get(session.stable.id);
  const occ = await occupancy(db, session.stable);
  const boardView: LeaseListingView[] = board.map((b) => {
    const ownerSilks = parseSilks(b.ownerSilks);
    const mine = b.listing.ownerStableId === session.stable.id;
    const meetsRating = gc.meetsMinRating(myRecord?.ratingSum ?? 0, myRecord?.ratings ?? 0, b.listing.minLesseeRating);
    const takeBlock = mine
      ? "Your own horse"
      : !eligibility.ok
        ? `You need ${eligibility.problems.join("; ")}`
        : !meetsRating
          ? `The owner asks for lessees rated ${b.listing.minLesseeRating}★ or better`
          : occ.free <= 0
            ? "No free stall"
            : null;
    return {
      ...ecoHorse(b.horse, ownerSilks, nowMs),
      listingId: b.listing.id,
      ownerStableName: b.ownerStableName,
      ownerSilks,
      termDays: b.listing.termDays,
      ownerSharePct: b.listing.ownerSharePct,
      lesseeSharePct: 100 - b.listing.ownerSharePct,
      fee: b.listing.fee,
      allowAllOut: b.listing.allowAllOut,
      maxLiveStartsPerWeek: b.listing.maxLiveStartsPerWeek,
      minLesseeRating: b.listing.minLesseeRating,
      form: form.get(b.horse.id) ?? [],
      wins: b.horse.wins,
      expiresAtMs: b.listing.expiresAt.getTime(),
      newOwner: b.newOwner,
      club: b.listing.club,
      mine,
      takeBlock,
    };
  });

  const rows = await stableLeases(db, session.stable.id, now);
  const records = await lesseeRecords(
    db,
    rows.filter((r) => r.role === "owner").map((r) => r.lease.lesseeStableId),
  );
  const leaseRow = (r: (typeof rows)[number]): LeaseRowView => {
    const l: HorseLeaseRow = r.lease;
    return {
      leaseId: l.id,
      role: r.role,
      horse: ecoHorse(r.horse, silks, nowMs),
      otherStableName: r.otherStableName,
      status: l.status === "active" ? "active" : "ended",
      endReason: l.endReason,
      startsAtMs: l.startsAt.getTime(),
      endsAtMs: l.endsAt.getTime(),
      endedAtMs: l.endedAt?.getTime() ?? null,
      ownerSharePct: l.ownerSharePct,
      allowAllOut: l.allowAllOut,
      maxLiveStartsPerWeek: l.maxLiveStartsPerWeek,
      races: l.races,
      ownerEarned: l.ownerEarned,
      lesseeEarned: l.lesseeEarned,
      returnPending: l.status === "active" && !!l.endRequestedAt,
      startCondition: conditionLabelOf(l.startCondition),
      endCondition: conditionLabelOf(l.endCondition),
      ownerRating: l.ownerRating,
      canRate: r.role === "owner" && l.status === "ended" && l.ownerRating === null,
      lesseeRecord: r.role === "owner" ? recordView(records.get(l.lesseeStableId)) : null,
    };
  };

  const offers = await myLeaseOffers(db, session.stable.id);
  const offerByHorse = new Map(offers.map((o) => [o.horseId, o.id]));
  const horses: LeaseOfferable[] = [];
  for (const h of await listStableHorses(db, session.stable.id)) {
    if (h.ownerStableId !== session.stable.id || h.careerStatus !== "racing") continue;
    const blocked = offerByHorse.has(h.id) ? null : await leaseHorseBlock(db, h, session.stable.id, now);
    horses.push({
      ...ecoHorse(h, silks, nowMs),
      block: blocked
        ? blocked.block === "cooldown" && blocked.until
          ? `Back from a lease: can be offered again ${blocked.until.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
          : LEASE_BLOCK_TEXT[blocked.block]
        : null,
      offerId: offerByHorse.get(h.id) ?? null,
      feeCap: gc.leaseFeeCap(defaultAppraise(h)),
    });
  }
  horses.sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1) || b.rating - a.rating);

  return {
    board: boardView,
    offers: offers.map((o) => ({
      listingId: o.id,
      horseId: o.horseId,
      horseName: o.horseName,
      termDays: o.termDays,
      ownerSharePct: o.ownerSharePct,
      lesseeSharePct: 100 - o.ownerSharePct,
      fee: o.fee,
      allowAllOut: o.allowAllOut,
      maxLiveStartsPerWeek: o.maxLiveStartsPerWeek,
      minLesseeRating: o.minLesseeRating,
      expiresAtMs: o.expiresAt.getTime(),
    })),
    leases: rows.map(leaseRow),
    horses,
    me: {
      eligible: eligibility.ok,
      problems: eligibility.problems,
      accountAgeDays: eligibility.accountAgeDays,
      liveStarts: eligibility.liveStarts,
      activeLeases: eligibility.activeLeases,
      record: recordView(myRecord),
      caps: await ownerLeaseCaps(db, session.stable.id),
    },
    config: leaseConfig(),
    stalls: { used: occ.used, slots: occ.slots, free: occ.free },
    serverNowMs: nowMs,
  };
}

export interface OfferInput {
  horseId: string;
  termDays: number;
  ownerSharePct: number;
  allowAllOut: boolean;
  maxLiveStartsPerWeek: number;
  minLesseeRating: number | null;
}

export async function offerForLease(db: Db, session: Session, input: OfferInput, now: Date) {
  const l = await offerLease(db, { accountId: session.accountId, ...input, fee: 0, now });
  return { listingId: l.id, expiresAtMs: l.expiresAt.getTime() };
}

export async function withdrawOffer(db: Db, session: Session, listingId: string, now: Date) {
  await withdrawLeaseOffer(db, { accountId: session.accountId, listingId, now });
}

export async function takeOffer(db: Db, session: Session, listingId: string, now: Date) {
  const r = await takeLease(db, { accountId: session.accountId, listingId, now });
  return { leaseId: r.lease.id, horseId: r.lease.horseId, endsAtMs: r.lease.endsAt.getTime(), duplicate: r.duplicate };
}

export async function handBack(db: Db, session: Session, leaseId: string, now: Date) {
  return returnLease(db, { accountId: session.accountId, leaseId, now });
}

export async function rate(db: Db, session: Session, leaseId: string, stars: number, now: Date) {
  const l = await rateLessee(db, { accountId: session.accountId, leaseId, stars, now });
  return { ownerRating: l.ownerRating };
}
