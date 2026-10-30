/**
 * "Sponsor a race" (packages/db sponsorship.ts): the sponsor list for one of the viewer's local
 * days in the next week, the viewer's own sponsorships, and the purchase. Prices, the window
 * and the per-stable cap come from SPONSORSHIP (one config place, in the db package).
 */
import {
  SPONSORSHIP,
  getBalance,
  listSponsorSlots,
  listStableSponsorships,
  localDate,
  sponsorRace,
  sponsoredRaceName,
  timezoneOf,
  type Db,
  type SponsorSlot,
} from "@thoroughbred/db";
import type { RaceClass, Surface } from "@thoroughbred/shared";
import type { MySponsorshipView, SponsorSlotView, SponsorView } from "@/lib/sponsorTypes";
import { driveCard } from "./game";
import type { Session } from "./session";

const CLASSES: readonly RaceClass[] = ["maiden", "novice", "handicap", "listed", "graded"];
const SURFACES: readonly Surface[] = ["turf", "dirt", "synthetic"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function slotView(s: SponsorSlot, stableName: string, viewerStableId: string): SponsorSlotView {
  return {
    slot: s.index,
    postTimeMs: s.postTime.getTime(),
    entriesCloseAtMs: s.entriesCloseAt.getTime(),
    name: s.name,
    sponsoredName: s.sponsor ? sponsoredRaceName(s.sponsor.stableName, s.name, s.track) : sponsoredRaceName(stableName, s.name, s.track),
    feature: s.kind === "feature",
    raceClass: (CLASSES as readonly string[]).includes(s.raceClass) ? (s.raceClass as RaceClass) : "handicap",
    track: s.track,
    distanceM: s.distanceM,
    surface: (SURFACES as readonly string[]).includes(s.surface ?? "") ? (s.surface as Surface) : null,
    purse: s.purse,
    price: s.price,
    published: s.raceId !== null,
    raceId: s.raceId,
    sponsoredBy: s.sponsor?.stableName ?? null,
    mine: s.sponsor?.stableId === viewerStableId,
    block: s.block,
  };
}

/** The sponsor screen for one local day (`date`, default: the first day with a slot on sale). */
export async function sponsorView(db: Db, session: Session, now: Date, opts: { date?: string | null } = {}): Promise<SponsorView> {
  await driveCard(db, now);
  const tz = await timezoneOf(db, session.accountId);
  const all = await listSponsorSlots(db, now);
  const byDay = new Map<string, SponsorSlot[]>();
  for (const s of all) {
    const d = localDate(tz, s.postTime);
    const list = byDay.get(d);
    if (list) list.push(s);
    else byDay.set(d, [s]);
  }
  const days = [...byDay.entries()].map(([date, slots]) => ({ date, onSale: slots.filter((s) => s.block === null).length }));
  const wanted = opts.date && DATE_RE.test(opts.date) && byDay.has(opts.date) ? opts.date : (days.find((d) => d.onSale > 0) ?? days[0])?.date ?? localDate(tz, now);
  const mine = await listStableSponsorships(db, session.stable.id, 50);
  const mineView: MySponsorshipView[] = mine.map((m) => ({
    id: m.id,
    raceId: m.raceId,
    raceName: m.raceName,
    postTimeMs: m.postTime.getTime(),
    price: m.price,
    status: m.refunded ? "refunded" : m.postTime > now ? "upcoming" : "run",
  }));
  return {
    credits: await getBalance(db, session.accountId),
    stableName: session.stable.name,
    days,
    date: wanted,
    slots: (byDay.get(wanted) ?? []).map((s) => slotView(s, session.stable.name, session.stable.id)),
    mine: mineView,
    rules: {
      purseMultiple: SPONSORSHIP.purseMultiple,
      minPrice: SPONSORSHIP.minPrice,
      windowDays: Math.round(SPONSORSHIP.windowMs / 86_400_000),
      maxUpcoming: SPONSORSHIP.maxUpcomingPerStable,
      upcoming: mineView.filter((m) => m.status === "upcoming").length,
    },
  };
}

/** Buys a slot's sponsorship (idempotent per key). */
export async function sponsorAction(db: Db, session: Session, input: { slot: number; key: string }, now: Date) {
  const r = await sponsorRace(db, { accountId: session.accountId, slotIndex: input.slot, idempotencyKey: input.key, now });
  return { sponsorshipId: r.sponsorship.id, slot: r.sponsorship.slotIndex, raceId: r.raceId, raceName: r.raceName, price: r.sponsorship.price, duplicate: r.duplicate };
}
