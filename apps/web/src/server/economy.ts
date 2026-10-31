/**
 * The economy screens' server side: breeding barn + stud book, packs, market. Each function
 * takes the database, the session and `now`; the rules and the money moves live in
 * @thoroughbred/db services (transactional, idempotent, double-entry ledger) which call
 * game-core. Clients send choices (which horses, which pack, a price), never outcomes.
 *
 * Credits are never cashed out, and the Premium Pack is a demo (no real payments): it can only
 * be pulled for credits when PREMIUM_PACK_DEMO=1, and is otherwise shown as "coming soon".
 */
import { afterBreedingPreview } from "./guide";
import * as gc from "@thoroughbred/game-core";
import {
  DomainError,
  RULES,
  breed,
  breedingSeason,
  breedingStateOf,
  breedingStatus,
  buyListing,
  cancelListing,
  defaultHooks,
  getBalance,
  getHorse,
  getPackState,
  getStable,
  horsesByIds,
  isDomainError,
  isGenome,
  listHorse,
  horseNamesByIds,
  listMarket,
  listPackPulls,
  listStableHorses,
  listStablePregnancies,
  listStuds,
  ensureHouseStuds,
  nameFoal,
  occupancy,
  PACKS,
  packPullProof,
  playDaysOf,
  previewPairing,
  pullPack,
  renameHorse,
  resaleLocksOf,
  usdgPolicy,
  usdgRegisteredIds,
  sellerStatus,
  setStudFee,
  toHorseState,
  tradeStatus,
  type BreedingStatus,
  type Db,
  type HorseRow,
  type PackPullRow,
  type PackState,
} from "@thoroughbred/db";
import type { Silks } from "@thoroughbred/shared";
import type {
  BreedingHorse,
  BreedingView,
  EcoHorse,
  ListingView,
  MarketView,
  PackOffer,
  PackType,
  PacksView,
  PreviewView,
  PullProofView,
  PullResultView,
  PullRow,
  Rarity,
  SellableHorse,
  StudFinderRow,
  StudFinderView,
  StudView,
} from "@/lib/economyTypes";
import { readUsdgConfig } from "./chain/usdgConfig";
import { geneticsLineOf, horseFromRow, parseSilks } from "./horseView";
import { sharedLimiter } from "./rateLimit";
import type { Session } from "./session";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function ecoHorse(row: HorseRow, silks: Silks, nowMs: number): EcoHorse {
  const stage = isGenome(row.genome) ? gc.stageOf(toHorseState(row)) : row.stage;
  return { id: row.id, horse: horseFromRow(row, silks, nowMs), geneticsLine: geneticsLineOf(row), stage, careerStatus: row.careerStatus, starts: row.starts, rating: row.rating };
}

/** Idempotency keys are scoped to the account, so one player's key can never match another's. */
export function scopedKey(session: Session, purpose: string, key: string): string {
  return `${purpose}:${session.accountId}:${key}`;
}

const BREED_REASON: Record<string, (s: { starts: number; minStarts: number; used: number; lifetime: number; restingHours: number | null }) => string> = {
  self: () => "A horse can't breed with itself.",
  parent_child: () => "Parent and child can't be paired.",
  full_siblings: () => "Full siblings can't be paired.",
  sire_not_male: () => "The sire must be a stallion.",
  dam_not_female: () => "The dam must be a mare.",
  gelding: () => "Geldings can't breed.",
  not_racing_age: () => "Still growing: not yet of breeding age.",
  not_breeding_eligible: (s) => `Breeds from ${s.minStarts} starts, or once sent to stud (${s.starts}/${s.minStarts} starts).`,
  pastured: () => "Retired for good: retired horses don't breed.",
  lifetime_limit: (s) => `All ${s.lifetime} lifetime breedings used.`,
  season_limit: () => "Already covered this season. Free again next season.",
  dam_in_foal: () => "In foal.",
  in_race: () => "Entered in a race.",
  listed: () => "Listed on the market.",
  booked: () => "Booked for a USDG covering: waiting for the stud fee payment.",
  on_lease: () => "On lease: horses on lease don't breed.",
  no_genome: () => "No pedigree record for this horse.",
  not_at_stud: () => "That stallion isn't standing at stud.",
  not_your_mare: () => "That mare isn't in your stable.",
  stud_resting: (s) => (s.restingHours ? `Resting · available again in ${s.restingHours} h` : "Resting after a covering"),
};

export function breedReason(block: string | null, s: { starts: number; minStarts?: number; used: number; lifetime?: number; restingHours?: number | null }): string | null {
  if (!block) return null;
  const f = BREED_REASON[block];
  return f
    ? f({ starts: s.starts, minStarts: s.minStarts ?? RULES.breedingMinStarts, used: s.used, lifetime: s.lifetime ?? RULES.breedingLifetimeLimit, restingHours: s.restingHours ?? null })
    : "Can't breed right now.";
}

const LOCK_REASON: Record<string, (h: { startsNeeded: number }) => string> = {
  club_bred: () => "Club-bred (a starter or free-pack horse): it stays with your stable and can't be sold.",
  until_starts: (h) => `Foal of a Club-bred parent: tradeable after 5 starts (${h.startsNeeded} to go).`,
  legacy_farm: () => "On the Legacy Farm.",
  in_race: () => "Entered in a race.",
  listed: () => "Already listed.",
  booked: () => "Booked for a USDG covering: wait until it's paid or the booking lapses.",
  in_foal: () => "In foal: she can be sold after foaling.",
  resale_lock: () => "Bought on the market: it can be listed again once the 72-hour resale lock ends.",
  usdg_only: () => "Registered for the USDG market: it sells only for USDG (Sales → USDG).",
  on_lease: () => "Away on lease: it can be sold once it is home.",
  lease_offered: () => "Offered for lease: withdraw the lease offer first (Sales → Lease).",
};

/** Player-facing messages for the economy's domain errors (details stay attached). */
export function friendlyEconomyError(err: unknown): unknown {
  if (!isDomainError(err)) return err;
  const d = (err.details ?? {}) as Record<string, unknown>;
  const msg = (() => {
    switch (err.code) {
      case "SELF_BREEDING":
      case "KIN_BREEDING":
      case "BREEDING_NOT_ELIGIBLE":
      case "BREEDING_LIMIT":
      case "BREEDING_SEASON_LIMIT":
        if (/stand at stud/.test(err.message)) return err.message.replace(/\.?$/, ".");
        if (d.block === "stud_resting" && typeof d.until === "number") return breedReason("stud_resting", { starts: 0, used: 0, restingHours: gc.hoursUntil(d.until, Date.now()) });
        return typeof d.block === "string" ? (breedReason(d.block, { starts: 0, used: 0 }) ?? err.message) : err.message;
      case "HORSE_IN_FOAL":
        return "That mare is in foal.";
      case "TOO_EARLY":
        return "Not due yet: the foal arrives when the countdown ends.";
      case "PACK_LIMIT":
        return err.message.startsWith("weekly") ? `You've reached this week's limit for that pack. It resets on Monday (UTC).` : `A free Paddock Pack comes every ${RULES.freePaddockEveryPlayDays}rd play day.`;
      case "CROP_SOLD_OUT":
        return "This season's foal crop is all spoken for. A new crop opens next season.";
      case "STABLE_FULL":
        return "All your stalls are taken. Free a stall (Legacy Farm or release to the Club) or add stalls first.";
      case "INSUFFICIENT_FUNDS":
        return "Not enough credits.";
      case "SELLER_REQUIREMENTS":
        if (/lease/.test(err.message) && Array.isArray(d.problems)) return `To take a lease you need ${(d.problems as string[]).join("; ")}.`;
        return Array.isArray(d.problems) ? `To sell you need: ${(d.problems as string[]).join("; ")}.` : "Your account doesn't meet the seller requirements yet.";
      case "HORSE_BOUND":
        return "That horse is Club-bred and can't be sold.";
      case "PRICE_BELOW_FLOOR":
        return typeof d.floor === "number" ? `The minimum price is ${d.floor.toLocaleString("en-GB")} credits (70% of the appraisal).` : "That price is below the floor (70% of the appraisal).";
      case "PRICE_ABOVE_CEILING":
        return typeof d.ceiling === "number" ? `The maximum price is ${d.ceiling.toLocaleString("en-GB")} credits (3x the appraisal).` : "That price is above the ceiling (3x the appraisal).";
      case "RESALE_LOCKED":
        return typeof d.until === "number"
          ? `Bought on the market: it can be listed again after ${new Date(d.until).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`
          : "A horse bought on the market can be listed again after 72 hours.";
      case "LISTING_NOT_ACTIVE":
      case "LISTING_EXPIRED":
        return /lease/.test(err.message) ? sentence(err.message) : "That listing is no longer available.";
      case "CANNOT_BUY_OWN":
        return "That's your own horse.";
      case "LINKED_ACCOUNTS":
        return /lease/.test(err.message) ? "Leases between linked accounts aren't allowed." : "Trades between linked accounts aren't allowed.";
      case "HORSE_ON_LEASE":
      case "LEASE_LIMIT":
        return sentence(err.message);
      case "HORSE_LOCKED":
        if (/lease/.test(err.message)) return sentence(err.message);
        if (/booked/.test(err.message)) return "That mare is booked for a USDG covering: wait until it's paid or the booking lapses.";
        return /listed/.test(err.message) ? "That horse is listed on the market." : "That horse is entered in a race or listed.";
      default:
        return null;
    }
  })();
  return msg ? new DomainError(err.code, msg, err.details) : err;
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");
}

async function stallsOf(db: Db, session: Session) {
  const occ = await occupancy(db, session.stable);
  return { used: occ.used, slots: occ.slots, free: occ.free, overflow: occ.overflow };
}

// ---------------------------------------------------------------------------
// Breeding barn + stud book
// ---------------------------------------------------------------------------

function breedingHorse(row: HorseRow, status: BreedingStatus, silks: Silks, nowMs: number, usdgRegistered = false): BreedingHorse {
  return {
    ...ecoHorse(row, silks, nowMs),
    block: status.block,
    reason: breedReason(status.block, status),
    used: status.used,
    lifetime: status.lifetime,
    usedThisSeason: status.usedThisSeason,
    perSeason: status.perSeason,
    studFee: row.studFee,
    studFeeMax: isGenome(row.genome) ? gc.studFeeCeiling(toHorseState(row)) : null,
    studFeeUsdg: row.studFeeUsdg,
    usdgRegistered,
  };
}

/** The USDG stud-fee settings the barn needs (null while the USDG market is off or misconfigured). */
export function usdgStudSettings(): BreedingView["usdg"] {
  try {
    const cfg = readUsdgConfig();
    if (cfg.mode === "off") return null;
    const p = usdgPolicy();
    return { mock: cfg.mode === "mock", feeBps: p.feeBps, studFeeMin: p.studFeeMin, studFeeMax: p.studFeeMax, quoteMinutes: Math.round(p.quoteTtlMs / 60_000) };
  } catch {
    return null;
  }
}

/** How long recently foaled pregnancies stay on the barn board (for the reveal and naming). */
const FOALED_VISIBLE_MS = 3 * 24 * 60 * 60 * 1000;

// The Club's house stallions (packages/db houseStuds.ts): top the roster up at most once a minute per instance.
const HOUSE_STUD_CHECK_MS = 60_000;
const HS = globalThis as typeof globalThis & { __tbHouseStudsAt?: number };

async function keepHouseStuds(db: Db, now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (HS.__tbHouseStudsAt !== undefined && nowMs - HS.__tbHouseStudsAt < HOUSE_STUD_CHECK_MS && nowMs >= HS.__tbHouseStudsAt) return;
  HS.__tbHouseStudsAt = nowMs;
  try {
    await ensureHouseStuds(db, now);
  } catch (err) {
    HS.__tbHouseStudsAt = undefined;
    console.error("house studs", err);
  }
}

export async function breedingView(db: Db, session: Session, now: Date): Promise<BreedingView> {
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  // Owned horses at home only: horses held on lease never breed.
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus !== "pasture" && !r.gelded && r.ownerStableId === session.stable.id);
  const mares: BreedingHorse[] = [];
  const stallions: BreedingHorse[] = [];
  const registered = await usdgRegisteredIds(db, rows.filter((r) => r.sex === "male").map((r) => r.id));
  for (const r of rows) {
    const st = await breedingStatus(db, r, now);
    (r.sex === "female" ? mares : stallions).push(breedingHorse(r, st, silks, nowMs, registered.has(r.id)));
  }
  const rank = (h: BreedingHorse) => (h.block === null ? 0 : h.block === "not_breeding_eligible" ? 1 : 2);
  mares.sort((a, b) => rank(a) - rank(b) || b.starts - a.starts);
  stallions.sort((a, b) => rank(a) - rank(b) || b.starts - a.starts);

  await keepHouseStuds(db, now);
  const studs: StudView[] = [];
  for (const s of await listStuds(db)) {
    if (s.horse.ownerStableId === session.stable.id) continue;
    const st = await breedingStatus(db, s.horse, now);
    const sSilks = parseSilks(s.silks);
    studs.push({
      ...ecoHorse(s.horse, sSilks, nowMs),
      studFee: s.horse.studFee ?? 0,
      studFeeUsdg: s.horse.studFeeUsdg,
      stableName: s.stableName,
      silks: sSilks,
      mine: false,
      club: s.club,
      block: st.block,
      reason: breedReason(st.block, st),
      used: st.used,
      lifetime: st.lifetime,
    });
  }
  // Credits studs first (cheapest first), then USDG studs (cheapest first).
  studs.sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1) || (a.studFeeUsdg === null ? 0 : 1) - (b.studFeeUsdg === null ? 0 : 1) || a.studFee - b.studFee || (a.studFeeUsdg ?? 0) - (b.studFeeUsdg ?? 0));

  const pregs = await listStablePregnancies(db, session.stable.id, new Date(nowMs - FOALED_VISIBLE_MS));
  const { season, endsAt } = breedingSeason(now);
  const occ = await stallsOf(db, session);
  return {
    season,
    seasonEndsAtMs: endsAt.getTime(),
    baseFee: RULES.breedingBaseFee,
    studBurnPermille: gc.STUD_FEE_BURN_PERMILLE,
    lifetime: RULES.breedingLifetimeLimit,
    minStarts: RULES.breedingMinStarts,
    pregnancyMs: RULES.pregnancyMs,
    mares,
    stallions,
    studs,
    pregnancies: pregs.map((p) => ({
      id: p.pregnancy.id,
      damId: p.dam.id,
      damName: p.dam.name,
      sireId: p.sire.id,
      sireName: p.sire.name,
      conceivedAtMs: p.pregnancy.conceivedAt.getTime(),
      dueAtMs: p.pregnancy.dueAt.getTime(),
      seedCommitment: p.pregnancy.seedCommitment,
      seed: p.pregnancy.seedRevealed ? p.pregnancy.seed : null,
      status: p.pregnancy.status === "foaled" ? "foaled" : "carrying",
      coiPermille: p.pregnancy.coi,
      foal: p.foal ? ecoHorse(p.foal, silks, nowMs) : null,
    })),
    credits: await getBalance(db, session.accountId),
    stalls: { used: occ.used, slots: occ.slots, overflow: occ.overflow },
    usdg: usdgStudSettings(),
    serverNowMs: nowMs,
  };
}

async function stableNameOfHorse(db: Db, h: HorseRow): Promise<string | null> {
  if (!h.ownerStableId) return null;
  return (await getStable(db, h.ownerStableId))?.name ?? null;
}

/**
 * The breeding preview (owner decision 2026-10-31): possible looks, an outlook in words and
 * warnings in words, from public facts only (db `previewPairing`, game-core
 * `pairingOutlook` / `possibleLooks`). Every field is picked here by name: the internal
 * outlook numbers (`pv.quality`) never leave the server, and there are no odds, genes or
 * numbers in the answer but the fees and credits.
 */
export async function breedingPreview(db: Db, session: Session, input: { sireId: string; damId: string }, now: Date): Promise<PreviewView> {
  const pv = await previewPairing(db, { accountId: session.accountId, sireId: input.sireId, damId: input.damId, now });
  let reason: string | null = null;
  if (pv.block) {
    // Name the horse an eligibility block belongs to.
    const [ss, ds] = [await breedingStatus(db, pv.sire, now), await breedingStatus(db, pv.dam, now)];
    const who = ds.block === pv.block ? { name: pv.dam.name, st: ds } : ss.block === pv.block ? { name: pv.sire.name, st: ss } : null;
    reason = who ? `${who.name}: ${breedReason(pv.block, who.st)}` : breedReason(pv.block, { starts: 0, used: 0 });
  }
  const looks = gc.possibleLooks(pv.publicSire, pv.publicDam, pv.day, parseSilks(session.stable.silks));
  // Stable steps: a first look at breeding.
  await afterBreedingPreview(db, session, now);
  return {
    sireId: pv.sire.id,
    damId: pv.dam.id,
    sireName: pv.sire.name,
    damName: pv.dam.name,
    ownSire: pv.ownSire,
    block: pv.block,
    reason,
    looks: looks.map((l) => ({ appearance: l.appearance, caption: l.caption })),
    looksNote: gc.LOOKS_NOTE,
    outlook: { tone: pv.outlook.outlook.tone, phrase: pv.outlook.outlook.phrase },
    certainty: { key: pv.outlook.certainty.key, phrase: pv.outlook.certainty.phrase },
    nick: pv.outlook.nick,
    warnings: pv.outlook.warnings.map((w) => ({ key: w.key, tone: w.tone, text: w.text })),
    breed: pv.outlook.breed,
    fees: pv.fees,
    usdgStudFee: pv.usdgStudFee,
    usdgFee: pv.usdgStudFee !== null ? gc.usdgFee(pv.usdgStudFee, usdgPolicy().feeBps) : null,
    stallionOwner: pv.usdgStudFee !== null ? await stableNameOfHorse(db, pv.sire) : null,
    credits: await getBalance(db, session.accountId),
  };
}

export async function coverMare(db: Db, session: Session, input: { sireId: string; damId: string; key: string }, now: Date) {
  const res = await breed(db, { accountId: session.accountId, sireId: input.sireId, damId: input.damId, now, idempotencyKey: scopedKey(session, "cover", input.key) });
  return { pregnancyId: res.pregnancyId, dueAtMs: res.dueAt.getTime(), seedCommitment: res.seedCommitment, coiBp: res.coiBp, duplicate: res.duplicate };
}

export async function foalAndName(db: Db, session: Session, input: { pregnancyId: string; name?: string }, now: Date): Promise<{ foal: EcoHorse; inOverflow: boolean; alreadyFoaled: boolean }> {
  const res = await nameFoal(db, { accountId: session.accountId, pregnancyId: input.pregnancyId, name: input.name, now });
  const row = (await getHorse(db, res.foalId))!;
  return { foal: ecoHorse(row, parseSilks(session.stable.silks), now.getTime()), inOverflow: res.inOverflow, alreadyFoaled: res.alreadyFoaled };
}

/** Names (or renames) a foal of yours from the barn. Only before its first start. */
export async function renameFoal(db: Db, session: Session, input: { horseId: string; name: string }, now: Date): Promise<EcoHorse> {
  await renameHorse(db, { accountId: session.accountId, horseId: input.horseId, name: input.name });
  const row = (await getHorse(db, input.horseId))!;
  return ecoHorse(row, parseSilks(session.stable.silks), now.getTime());
}

export const MAX_STUD_FEE = 100_000;

export async function standAtStud(db: Db, session: Session, input: { horseId: string; fee: number | null }) {
  if (input.fee !== null && (!Number.isSafeInteger(input.fee) || input.fee < 0 || input.fee > MAX_STUD_FEE)) {
    throw new DomainError("INVALID_INPUT", `stud fee must be 0-${MAX_STUD_FEE.toLocaleString("en-GB")} credits`);
  }
  await setStudFee(db, { accountId: session.accountId, horseId: input.horseId, fee: input.fee });
}

// ---------------------------------------------------------------------------
// Stallion finder: every available stallion ranked for one mare
// ---------------------------------------------------------------------------

/** What the ranking can be sorted by (the client sends one of these): best outlook (default) or fee, cheapest first. */
export const STUD_FINDER_SORTS = ["outlook", "fee"] as const;
export type StudFinderSort = (typeof STUD_FINDER_SORTS)[number];
/** Rows per page (the finder accepts up to twice this). */
export const STUD_FINDER_PAGE = 20;
/** Candidates per run: every row runs the preview, so a run is bounded and rate-limited. */
export const STUD_FINDER_CANDIDATES = 250;
/** How many finder runs an account may compute per hour (cached answers don't count). */
export const STUD_FINDER_RUNS_PER_HOUR = 24;

const STUD_FINDER_LIMITER = sharedLimiter({ name: "stud-finder", limit: STUD_FINDER_RUNS_PER_HOUR, windowMs: 3_600_000 });

// The ranking is cached per (player, mare, UTC day): fees and cover limits change rarely, and
// every row runs the preview, so a day's answer is computed once per mare. Cached unsorted:
// each page request orders a copy, which costs nothing against the preview. Each row keeps its
// internal score next to it, server-side only; pages carry the row alone.
const FINDER_CACHE_MAX = 128;
interface RankedRow {
  row: StudFinderRow;
  /** game-core outlookNumbers score (public facts only). Never sent. */
  score: number;
}
const FINDER = globalThis as typeof globalThis & { __tbStudFinder?: Map<string, { rows: RankedRow[]; excluded: number }> };

/** Blocks that belong to the pairing itself, never to one horse's state. */
const KIN_BLOCKS: readonly string[] = ["self", "parent_child", "full_siblings", "sire_not_male"];

/**
 * Whether a stallion can cover this mare at all, judged by the same rules the single preview
 * and `breed` apply. Kinship always rules him out. So does his own game-core eligibility
 * (`sireBlock`, the state the preview itself builds: racing age, 25 starts or retired, lifetime
 * and per-season cover limits — live USDG bookings count as covers) when it is what the preview
 * reports, and the sire-side locks `breed` refuses (listed for sale, away on lease). A block
 * that belongs to the mare alone — in foal, under 25 starts, entered, listed or booked herself
 * — keeps him ranked: her covers can still be planned.
 */
function sireExcluded(pv: { block: string | null; sire: HorseRow }, sireBlock: string | null): boolean {
  const block = pv.block;
  if (block === null) return false;
  if (KIN_BLOCKS.includes(block) || block === "not_at_stud") return true;
  if (typeof sireBlock === "string" && block === sireBlock) return true;
  if (block === "listed") return pv.sire.lockKind === "market";
  if (block === "on_lease") return !!pv.sire.lesseeStableId;
  return false; // in_race / booked / dam_in_foal / the mare's own eligibility
}

/** The sort comparator: credits studs first (the ranking), USDG-only studs after, by `sort`. */
function compareRows(sort: StudFinderSort): (a: RankedRow, b: RankedRow) => number {
  const fee = (r: StudFinderRow) => r.feeCredits ?? r.studFeeUsdg ?? 0;
  const byKey =
    sort === "fee"
      ? (a: RankedRow, b: RankedRow) => fee(a.row) - fee(b.row)
      : (a: RankedRow, b: RankedRow) => b.score - a.score || fee(a.row) - fee(b.row); // default: best outlook, ties by fee
  // The last tiebreak is only for a stable page order when the sort key ties exactly.
  // Credits studs, then USDG-only ones; resting studs after the available ones in each.
  return (a, b) =>
    (a.row.usdgOnly ? 1 : 0) - (b.row.usdgOnly ? 1 : 0) || (a.row.resting ? 1 : 0) - (b.row.resting ? 1 : 0) || byKey(a, b) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);
}

/**
 * The full ranking of one mare's available stallions (her stable's own, the Club's house studs
 * and other players' advertised studs), each row from the same preview as the single cover
 * preview (`previewPairing`, public facts only): the outlook and nick in words, warnings in
 * words and the first of the day's possible looks. Ranked by the outlook's internal score.
 * Expensive — every candidate runs the preview — so the caller caches and rate-limits it.
 */
async function studFinderRows(db: Db, session: Session, mare: HorseRow, now: Date): Promise<{ rows: RankedRow[]; excluded: number }> {
  await keepHouseStuds(db, now);
  // Own entire stallions at home, plus every stallion standing at public stud — the same
  // lists the barn and the stud book show.
  const own: { horse: HorseRow; stableName: string }[] = (await listStableHorses(db, session.stable.id))
    .filter((r) => r.sex === "male" && !r.gelded && r.careerStatus !== "pasture" && r.ownerStableId === session.stable.id && isGenome(r.genome))
    .slice(0, STUD_FINDER_CANDIDATES)
    .map((horse) => ({ horse, stableName: "Yours" }));
  const publicStuds = (await listStuds(db, { limit: STUD_FINDER_CANDIDATES }))
    .filter((s) => s.horse.ownerStableId !== session.stable.id && isGenome(s.horse.genome))
    .map((s) => ({ horse: s.horse, stableName: s.stableName }));
  const rows: RankedRow[] = [];
  let excluded = 0;
  const season = breedingSeason(now).season;
  const silks = parseSilks(session.stable.silks);
  const seen = new Set<string>();
  for (const { horse: sire, stableName } of [...own, ...publicStuds]) {
    if (sire.id === mare.id || seen.has(sire.id)) continue;
    seen.add(sire.id);
    let pv;
    try {
      pv = await previewPairing(db, { accountId: session.accountId, sireId: sire.id, damId: mare.id, now });
    } catch {
      excluded++; // not a pairing the preview can state (no pedigree record, &c.)
      continue;
    }
    if (sireExcluded(pv, pv.block ? gc.breedingEligibility(await breedingStateOf(db, sire, now), season) : null)) {
      excluded++;
      continue;
    }
    const usdgOnly = pv.usdgStudFee !== null;
    const look = gc.possibleLooks(pv.publicSire, pv.publicDam, pv.day, silks, 1)[0]!;
    rows.push({
      score: pv.quality.score,
      row: {
        id: sire.id,
        name: sire.name,
        stableName,
        club: !pv.ownSire && sire.ownerStableId === null,
        own: pv.ownSire,
        feeCredits: usdgOnly ? null : pv.fees.totalPaidByMareOwner,
        studFeeUsdg: pv.usdgStudFee,
        usdgOnly,
        outlook: { tone: pv.outlook.outlook.tone, phrase: pv.outlook.outlook.phrase },
        nick: pv.outlook.nick,
        warnings: pv.outlook.warnings.filter((w) => w.tone === "warn").map((w) => w.text),
        look: { appearance: look.appearance, caption: look.caption },
        resting: pv.sireRestingUntilMs === null ? null : `Resting · available again in ${gc.hoursUntil(pv.sireRestingUntilMs, now.getTime())} h`,
      },
    });
  }
  return { rows, excluded };
}

/**
 * The stallion finder: one mare's stallions ranked by the breeding preview's outlook (public
 * facts only; shown in words, with the fee), a page at a time. The full ranking is computed once per (player, mare, UTC day) and cached (pagination
 * and re-sorting are free); each fresh compute is rate-limited per account, because every row
 * runs the preview.
 */
export async function studFinder(
  db: Db,
  session: Session,
  input: { mareId: string; sort?: string; page?: number; pageSize?: number },
  now: Date,
): Promise<StudFinderView> {
  const mare = await getHorse(db, input.mareId);
  if (!mare || mare.ownerStableId !== session.stable.id || mare.sex !== "female") throw new DomainError("NOT_FOUND", "that mare isn't in your stable");
  if (!isGenome(mare.genome)) throw new DomainError("NOT_ELIGIBLE", "that mare has no pedigree record");
  const sort = (STUD_FINDER_SORTS as readonly string[]).includes(input.sort ?? "") ? (input.sort as StudFinderSort) : "outlook";
  const pageSize = Math.max(1, Math.min(input.pageSize ?? STUD_FINDER_PAGE, 2 * STUD_FINDER_PAGE));
  const day = Math.floor(now.getTime() / 86_400_000);
  const key = `${session.accountId}:${mare.id}:${day}`;
  let cache = FINDER.__tbStudFinder;
  if (!cache) cache = FINDER.__tbStudFinder = new Map();
  let answer = cache.get(key);
  if (!answer) {
    if (await STUD_FINDER_LIMITER.hit(db, session.accountId, now.getTime())) {
      throw new DomainError("RATE_LIMITED", `The stallion finder can be run ${STUD_FINDER_RUNS_PER_HOUR} times an hour. Try again in a little while.`);
    }
    answer = await studFinderRows(db, session, mare, now);
    cache.set(key, answer);
    if (cache.size > FINDER_CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  await afterBreedingPreview(db, session, now);
  const total = answer.rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(0, input.page ?? 0), pages - 1);
  return {
    mareId: mare.id,
    mareName: mare.name,
    sort,
    page,
    pageSize,
    rows: [...answer.rows]
      .sort(compareRows(sort))
      .slice(page * pageSize, (page + 1) * pageSize)
      .map((r) => r.row),
    total,
    excluded: answer.excluded,
    day: new Date(day * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    credits: await getBalance(db, session.accountId),
  };
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

const PACK_NAME: Record<PackType, string> = { paddock: "Paddock Pack", premium: "Premium Pack" };
const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** PackOffer.disabledReason when the Premium Pack is sold for ETH (the card points to the checkout). */
export const ETH_CHECKOUT = "Pay with ETH below";

/** PackOffer.disabledReason in practice mode: the Premium Pack is bought with T-USDG (PremiumCheckout), never credits or ETH. */
export const TUSDG_CHECKOUT = "Pay with T-USDG below";

export function premiumDemoEnabled(): boolean {
  return process.env.PREMIUM_PACK_DEMO === "1";
}

function pullRow(p: PackPullRow & { horseName?: string | null }, geneticsLine: string | null = null): PullRow {
  return {
    id: p.id,
    packType: p.packType === "premium" ? "premium" : "paddock",
    pullIndex: p.pullIndex,
    rarity: p.rarity,
    pityApplied: p.pityApplied === "rare" || p.pityApplied === "epic" ? p.pityApplied : null,
    horseId: p.horseId,
    horseName: p.horseName ?? null,
    geneticsLine,
    free: p.free,
    price: p.price,
    createdAtMs: p.createdAt.getTime(),
    seedCommitment: p.seedCommitment,
  };
}

function offer(type: PackType, st: PackState, ctx: { credits: number; stallsFree: number; cropLeft: number }): PackOffer {
  const price = PACKS[type]!.price;
  const pity = gc.PACK_PITY[type].map((r) => {
    const since = r.counter === "sinceEpic" ? st.sinceEpic : st.sinceRare;
    return { min: r.min, within: r.within, since, left: Math.max(1, r.within - since) };
  });
  let disabledReason: string | null = null;
  const demo = type === "premium";
  // Closed beta with WEB3_ENABLED: the Premium Pack is bought with ETH (PremiumCheckout), never credits.
  // Practice mode (USDG_MODE=practice): bought with T-USDG test money, whatever the other switches say.
  if (demo && gc.isUsdgPracticeMode(process.env)) disabledReason = TUSDG_CHECKOUT;
  else if (demo && !premiumDemoEnabled()) disabledReason = process.env.WEB3_ENABLED?.trim().toLowerCase() === "true" ? ETH_CHECKOUT : "Coming soon";
  else if (ctx.stallsFree <= 0) disabledReason = "No free stall";
  else if (ctx.cropLeft <= 0) disabledReason = "Crop sold out";
  else if (st.paidThisWeek >= st.weeklyLimit) disabledReason = "Weekly limit reached";
  else if (ctx.credits < price) disabledReason = "Not enough credits";
  return {
    type,
    name: PACK_NAME[type],
    price,
    odds: RARITIES.map((r) => ({ rarity: r, bp: gc.PACK_ODDS[type][r] })).filter((o) => o.bp > 0),
    pity,
    paidThisWeek: st.paidThisWeek,
    weeklyLimit: st.weeklyLimit,
    freeAvailable: st.freeAvailable,
    totalPulls: st.totalPulls,
    nextSeedCommitment: st.nextSeedCommitment,
    enabled: disabledReason === null,
    disabledReason,
    demo,
  };
}

export async function packsView(db: Db, session: Session, now: Date): Promise<PacksView> {
  const paddock = await getPackState(db, { accountId: session.accountId, packType: "paddock", now });
  const premium = await getPackState(db, { accountId: session.accountId, packType: "premium", now });
  const credits = await getBalance(db, session.accountId);
  const stalls = await stallsOf(db, session);
  const playDays = await playDaysOf(db, session.accountId);
  const every = RULES.freePaddockEveryPlayDays;
  const ctx = { credits, stallsFree: stalls.free, cropLeft: paddock.crop.remaining };
  return {
    paddock: offer("paddock", paddock, ctx),
    premium: offer("premium", premium, ctx),
    crop: { season: breedingSeason(now).season, ...paddock.crop },
    playDays,
    freeEvery: every,
    nextFreeAtPlayDay: (Math.floor(playDays / every) + 1) * every,
    ceiling: gc.packCeiling(breedingSeason(now).season),
    credits,
    stalls: { used: stalls.used, slots: stalls.slots, free: stalls.free },
    pulls: await pullRows(db, session.accountId),
    serverNowMs: now.getTime(),
  };
}

/** Pull history rows with the foal's one-line genetics (its genome lives on the horse row). */
async function pullRows(db: Db, accountId: string): Promise<PullRow[]> {
  const pulls = await listPackPulls(db, accountId, 20);
  const foals = await horsesByIds(db, pulls.map((p) => p.horseId).filter((id): id is string => !!id));
  return pulls.map((p) => {
    const foal = p.horseId ? foals.get(p.horseId) : undefined;
    return pullRow(p, foal ? geneticsLineOf(foal) : null);
  });
}

export async function pull(db: Db, session: Session, input: { packType: PackType; free: boolean; key: string }, now: Date): Promise<PullResultView> {
  if (input.packType === "premium" && gc.isUsdgPracticeMode(process.env)) {
    throw new DomainError("NOT_ELIGIBLE", "During the beta Premium Packs are bought with T-USDG (test money): use the checkout below the pack.");
  }
  if (input.packType === "premium" && !premiumDemoEnabled()) {
    throw new DomainError("NOT_ELIGIBLE", "The Premium Pack is coming soon. There are no payments in this demo.");
  }
  const res = await pullPack(db, { accountId: session.accountId, packType: input.packType, free: input.free, idempotencyKey: scopedKey(session, "pack", input.key), now });
  const row = await getHorse(db, res.horseId);
  const [p] = (await listPackPulls(db, session.accountId, 40)).filter((x) => x.id === res.pullId);
  return {
    pull: pullRow(p!, row ? geneticsLineOf(row) : null),
    foal: row ? ecoHorse(row, parseSilks(session.stable.silks), now.getTime()) : null,
    seedReveal: res.seedReveal,
    nextSeedCommitment: res.nextSeedCommitment,
    duplicate: res.duplicate,
  };
}

export async function pullProof(db: Db, session: Session, pullId: string): Promise<PullProofView> {
  const proof = await packPullProof(db, { accountId: session.accountId, pullId });
  const horse = proof.pull.horseId ? await getHorse(db, proof.pull.horseId) : null;
  return {
    pull: pullRow({ ...proof.pull, horseName: horse?.name ?? null }, horse ? geneticsLineOf(horse) : null),
    accountId: proof.accountId,
    seasonNumber: proof.pull.seasonNumber,
    seedReveal: proof.pull.seedReveal,
    chain: proof.chain,
    pityBefore: proof.pityBefore,
    genome: proof.genome,
    sex: proof.sex,
    checks: proof.checks,
    verified: proof.verified,
  };
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/** Catalogue lot numbers 1-999 from the listing id (stable while it's listed; clashes step on). */
export function lotNumbers(listingIds: string[]): Map<string, number> {
  const taken = new Set<number>();
  const out = new Map<string, number>();
  for (const id of [...listingIds].sort()) {
    let n = (Number.parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 999) + 1;
    while (taken.has(n)) n = (n % 999) + 1;
    taken.add(n);
    out.set(id, n);
  }
  return out;
}

export async function marketView(db: Db, session: Session, now: Date): Promise<MarketView> {
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const all = await listMarket(db, { now, limit: 100 });
  const names = await horseNamesByIds(db, all.flatMap((m) => [m.horse.sireId, m.horse.damId]).filter((x): x is string => !!x));
  const lots = lotNumbers(all.map((m) => m.listing.id));
  const view = (m: (typeof all)[number]): ListingView => {
    const sellerSilks = parseSilks(m.sellerSilks);
    // A Club lot burns the whole price (packages/db market.ts buyListing).
    const fee = m.listing.club ? m.listing.price : gc.marketFee(m.listing.price);
    return {
      ...ecoHorse(m.horse, sellerSilks, nowMs),
      listingId: m.listing.id,
      price: m.listing.price,
      appraisal: m.listing.appraisal,
      fee,
      sellerReceives: m.listing.price - fee,
      sellerStableName: m.sellerStableName,
      sellerSilks,
      club: m.listing.club,
      expiresAtMs: m.listing.expiresAt.getTime(),
      mine: m.listing.sellerStableId === session.stable.id,
      lot: lots.get(m.listing.id)!,
      sireName: m.horse.sireId ? (names.get(m.horse.sireId) ?? null) : null,
      damName: m.horse.damId ? (names.get(m.horse.damId) ?? null) : null,
    };
  };
  const listings = all.map(view);
  const mineByHorse = new Map(listings.filter((l) => l.mine).map((l) => [l.id, l.listingId]));
  const horses: SellableHorse[] = [];
  // One resale-locks query for the whole stable (tradeStatus takes the map's entries).
  const resales = await resaleLocksOf(db, session.stable.id, now);
  // Owned horses only: a horse held on lease is not the lessee's to sell.
  const stableRows = (await listStableHorses(db, session.stable.id)).filter((r) => r.ownerStableId === session.stable.id);
  // One query for the stable's USDG registrations (registered horses sell only for USDG).
  const usdgOnly = await usdgRegisteredIds(db, stableRows.map((r) => r.id));
  for (const r of stableRows) {
    if (r.careerStatus === "pasture") continue;
    const ts = await tradeStatus(db, r, now, defaultHooks, resales.get(r.id) ?? null, usdgOnly.has(r.id));
    horses.push({
      ...ecoHorse(r, silks, nowMs),
      appraisal: ts.appraisal,
      floor: ts.floor,
      ceiling: ts.ceiling,
      lock: ts.lock,
      lockReason: ts.lock ? (LOCK_REASON[ts.lock]?.(ts) ?? "Can't be sold right now.") : null,
      boughtAtMs: ts.boughtAt?.getTime() ?? null,
      resaleUntilMs: ts.resaleUntil?.getTime() ?? null,
      listingId: mineByHorse.get(r.id) ?? null,
    });
  }
  horses.sort((a, b) => (a.lock === null ? 0 : 1) - (b.lock === null ? 0 : 1) || b.appraisal - a.appraisal);
  const seller = await sellerStatus(db, { accountId: session.accountId, stableId: session.stable.id, now });
  const stalls = await stallsOf(db, session);
  return {
    listings: listings.filter((l) => !l.mine),
    mine: listings.filter((l) => l.mine),
    horses,
    seller: {
      ok: seller.ok,
      accountAgeDays: seller.accountAgeDays,
      minAccountAgeDays: seller.minAccountAgeDays,
      oldEnoughAtMs: seller.oldEnoughAt?.getTime() ?? null,
      races: seller.races,
      minRaces: seller.minRaces,
      emailVerified: seller.emailVerified,
      emailRequired: seller.emailRequired,
      missing: seller.missing,
    },
    feePermille: gc.MARKET_FEE_PERMILLE,
    floorPermille: gc.LISTING_FLOOR_PERMILLE,
    ceilingPermille: gc.LISTING_CEILING_PERMILLE,
    maxListingDays: Math.round(RULES.maxListingMs / 86_400_000),
    credits: await getBalance(db, session.accountId),
    stalls: { used: stalls.used, slots: stalls.slots, free: stalls.free },
    serverNowMs: nowMs,
  };
}

export const LISTING_DAYS = [3, 7, 14] as const;

export async function listForSale(db: Db, session: Session, input: { horseId: string; price: number; days: number }, now: Date) {
  const days = (LISTING_DAYS as readonly number[]).includes(input.days) ? input.days : 7;
  const l = await listHorse(db, { accountId: session.accountId, horseId: input.horseId, price: input.price, now, durationMs: days * 86_400_000 });
  return { listingId: l.id, price: l.price, expiresAtMs: l.expiresAt.getTime() };
}

export async function buy(db: Db, session: Session, listingId: string, now: Date) {
  const r = await buyListing(db, { accountId: session.accountId, listingId, now });
  return { horseId: r.horseId, price: r.price, fee: r.fee };
}

export async function cancel(db: Db, session: Session, listingId: string, now: Date) {
  await cancelListing(db, { accountId: session.accountId, listingId, now });
}
