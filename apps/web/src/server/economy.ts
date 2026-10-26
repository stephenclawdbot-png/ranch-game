/**
 * The economy screens' server side: breeding barn + stud book, packs, market. Each function
 * takes the database, the session and `now`; the rules and the money moves live in
 * @thoroughbred/db services (transactional, idempotent, double-entry ledger) which call
 * game-core. Clients send choices (which horses, which pack, a price), never outcomes.
 *
 * Credits are never cashed out, and the Premium Pack is a demo (no real payments): it can only
 * be pulled for credits when PREMIUM_PACK_DEMO=1, and is otherwise shown as "coming soon".
 */
import * as gc from "@thoroughbred/game-core";
import {
  DomainError,
  RULES,
  breed,
  breedingSeason,
  breedingStatus,
  buyListing,
  cancelListing,
  getBalance,
  getHorse,
  getPackState,
  isDomainError,
  isGenome,
  listHorse,
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
  populationOverall,
  previewPairing,
  pullPack,
  renameHorse,
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
  StudView,
} from "@/lib/economyTypes";
import { horseFromRow, parseSilks } from "./horseView";
import type { Session } from "./session";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function ecoHorse(row: HorseRow, silks: Silks, nowMs: number): EcoHorse {
  const stage = isGenome(row.genome) ? gc.stageOf(toHorseState(row)) : row.stage;
  return { id: row.id, horse: horseFromRow(row, silks, nowMs), stage, careerStatus: row.careerStatus, starts: row.starts, rating: row.rating };
}

/** Idempotency keys are scoped to the account, so one player's key can never match another's. */
export function scopedKey(session: Session, purpose: string, key: string): string {
  return `${purpose}:${session.accountId}:${key}`;
}

const BREED_REASON: Record<string, (s: { starts: number; minStarts: number; used: number; lifetime: number }) => string> = {
  self: () => "A horse can't breed with itself.",
  parent_child: () => "Parent and child can't be paired.",
  full_siblings: () => "Full siblings can't be paired.",
  sire_not_male: () => "The sire must be a stallion.",
  dam_not_female: () => "The dam must be a mare.",
  gelding: () => "Geldings can't breed.",
  not_racing_age: () => "Still growing: not yet of breeding age.",
  not_breeding_eligible: (s) => `Breeds from ${s.minStarts} starts or after retirement (${s.starts}/${s.minStarts} starts).`,
  pastured: () => "On the Legacy Farm: retired from breeding.",
  lifetime_limit: (s) => `All ${s.lifetime} lifetime breedings used.`,
  season_limit: () => "Already covered this season. Free again next season.",
  dam_in_foal: () => "In foal.",
  in_race: () => "Entered in a race.",
  listed: () => "Listed on the market.",
  no_genome: () => "No pedigree record for this horse.",
  not_at_stud: () => "That stallion isn't standing at stud.",
  not_your_mare: () => "That mare isn't in your stable.",
};

export function breedReason(block: string | null, s: { starts: number; minStarts?: number; used: number; lifetime?: number }): string | null {
  if (!block) return null;
  const f = BREED_REASON[block];
  return f ? f({ starts: s.starts, minStarts: s.minStarts ?? RULES.breedingMinStarts, used: s.used, lifetime: s.lifetime ?? RULES.breedingLifetimeLimit }) : "Can't breed right now.";
}

const LOCK_REASON: Record<string, (h: { startsNeeded: number }) => string> = {
  club_bred: () => "Club-bred (a starter or free-pack horse): it stays with your stable and can't be sold.",
  until_starts: (h) => `Foal of a Club-bred parent: tradeable after 5 starts (${h.startsNeeded} to go).`,
  legacy_farm: () => "On the Legacy Farm.",
  in_race: () => "Entered in a race.",
  listed: () => "Already listed.",
  in_foal: () => "In foal: she can be sold after foaling.",
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
        return Array.isArray(d.problems) ? `To sell you need: ${(d.problems as string[]).join("; ")}.` : "Your account doesn't meet the seller requirements yet.";
      case "HORSE_BOUND":
        return "That horse is Club-bred and can't be sold.";
      case "PRICE_BELOW_FLOOR":
        return typeof d.floor === "number" ? `The minimum price is ${d.floor.toLocaleString("en-GB")} credits (70% of the appraisal).` : "That price is below the floor (70% of the appraisal).";
      case "LISTING_NOT_ACTIVE":
      case "LISTING_EXPIRED":
        return "That listing is no longer available.";
      case "CANNOT_BUY_OWN":
        return "That's your own horse.";
      case "LINKED_ACCOUNTS":
        return "Trades between linked accounts aren't allowed.";
      case "HORSE_LOCKED":
        return /listed/.test(err.message) ? "That horse is listed on the market." : "That horse is entered in a race or listed.";
      default:
        return null;
    }
  })();
  return msg ? new DomainError(err.code, msg, err.details) : err;
}

async function stallsOf(db: Db, session: Session) {
  const occ = await occupancy(db, session.stable);
  return { used: occ.used, slots: occ.slots, free: occ.free, overflow: occ.overflow };
}

// ---------------------------------------------------------------------------
// Breeding barn + stud book
// ---------------------------------------------------------------------------

function breedingHorse(row: HorseRow, status: BreedingStatus, silks: Silks, nowMs: number): BreedingHorse {
  return {
    ...ecoHorse(row, silks, nowMs),
    block: status.block,
    reason: breedReason(status.block, status),
    used: status.used,
    lifetime: status.lifetime,
    usedThisSeason: status.usedThisSeason,
    perSeason: status.perSeason,
    studFee: row.studFee,
  };
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
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus !== "pasture" && !r.gelded);
  const mares: BreedingHorse[] = [];
  const stallions: BreedingHorse[] = [];
  for (const r of rows) {
    const st = await breedingStatus(db, r, now);
    (r.sex === "female" ? mares : stallions).push(breedingHorse(r, st, silks, nowMs));
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
  studs.sort((a, b) => (a.block === null ? 0 : 1) - (b.block === null ? 0 : 1) || a.studFee - b.studFee);

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
    serverNowMs: nowMs,
  };
}

// The population the preview ranks against changes slowly: cache it per instance.
const POP_TTL_MS = 5 * 60_000;
const G = globalThis as typeof globalThis & { __tbPopulation?: { at: number; values: number[] } };

async function population(db: Db, nowMs: number): Promise<number[]> {
  const c = G.__tbPopulation;
  if (c && nowMs - c.at < POP_TTL_MS) return c.values;
  const values = await populationOverall(db);
  G.__tbPopulation = { at: nowMs, values };
  return values;
}

/** "Top N%": the share of the population strictly better than `v` (at least 1%). */
export function topPercent(sortedAsc: number[], v: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  const above = sortedAsc.length - lo;
  return Math.min(100, Math.max(1, Math.ceil((above * 100) / Math.max(1, sortedAsc.length))));
}

/** Minimum population before a percentile means anything. */
const MIN_POPULATION = 10;

export async function breedingPreview(db: Db, session: Session, input: { sireId: string; damId: string }, now: Date): Promise<PreviewView> {
  const pv = await previewPairing(db, { accountId: session.accountId, sireId: input.sireId, damId: input.damId, now });
  let reason: string | null = null;
  if (pv.block) {
    // Name the horse an eligibility block belongs to.
    const [ss, ds] = [await breedingStatus(db, pv.sire, now), await breedingStatus(db, pv.dam, now)];
    const who = ds.block === pv.block ? { name: pv.dam.name, st: ds } : ss.block === pv.block ? { name: pv.sire.name, st: ss } : null;
    reason = who ? `${who.name}: ${breedReason(pv.block, who.st)}` : breedReason(pv.block, { starts: 0, used: 0 });
  }
  const pop = await population(db, now.getTime());
  const o = pv.preview.overall;
  return {
    sireId: pv.sire.id,
    damId: pv.dam.id,
    sireName: pv.sire.name,
    damName: pv.dam.name,
    ownSire: pv.ownSire,
    block: pv.block,
    reason,
    preview: pv.preview,
    fees: pv.fees,
    parents: pv.parents,
    topPercent: pop.length >= MIN_POPULATION ? { p10: topPercent(pop, o.p10), p50: topPercent(pop, o.p50), p90: topPercent(pop, o.p90) } : null,
    populationSize: pop.length,
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
// Packs
// ---------------------------------------------------------------------------

const PACK_NAME: Record<PackType, string> = { paddock: "Paddock Pack", premium: "Premium Pack" };
const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** PackOffer.disabledReason when the Premium Pack is sold for ETH (the card points to the checkout). */
export const ETH_CHECKOUT = "Pay with ETH below";

export function premiumDemoEnabled(): boolean {
  return process.env.PREMIUM_PACK_DEMO === "1";
}

function pullRow(p: PackPullRow & { horseName?: string | null }): PullRow {
  return {
    id: p.id,
    packType: p.packType === "premium" ? "premium" : "paddock",
    pullIndex: p.pullIndex,
    rarity: p.rarity,
    pityApplied: p.pityApplied === "rare" || p.pityApplied === "epic" ? p.pityApplied : null,
    horseId: p.horseId,
    horseName: p.horseName ?? null,
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
  if (demo && !premiumDemoEnabled()) disabledReason = process.env.WEB3_ENABLED?.trim().toLowerCase() === "true" ? ETH_CHECKOUT : "Coming soon";
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
    pulls: (await listPackPulls(db, session.accountId, 20)).map(pullRow),
    serverNowMs: now.getTime(),
  };
}

export async function pull(db: Db, session: Session, input: { packType: PackType; free: boolean; key: string }, now: Date): Promise<PullResultView> {
  if (input.packType === "premium" && !premiumDemoEnabled()) {
    throw new DomainError("NOT_ELIGIBLE", "The Premium Pack is coming soon. There are no payments in this demo.");
  }
  const res = await pullPack(db, { accountId: session.accountId, packType: input.packType, free: input.free, idempotencyKey: scopedKey(session, "pack", input.key), now });
  const row = await getHorse(db, res.horseId);
  const [p] = (await listPackPulls(db, session.accountId, 40)).filter((x) => x.id === res.pullId);
  return {
    pull: pullRow(p!),
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
    pull: pullRow({ ...proof.pull, horseName: horse?.name ?? null }),
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

export async function marketView(db: Db, session: Session, now: Date): Promise<MarketView> {
  const nowMs = now.getTime();
  const silks = parseSilks(session.stable.silks);
  const all = await listMarket(db, { now, limit: 100 });
  const view = (m: (typeof all)[number]): ListingView => {
    const sellerSilks = parseSilks(m.sellerSilks);
    const fee = gc.marketFee(m.listing.price);
    return {
      ...ecoHorse(m.horse, sellerSilks, nowMs),
      listingId: m.listing.id,
      price: m.listing.price,
      appraisal: m.listing.appraisal,
      fee,
      sellerReceives: m.listing.price - fee,
      sellerStableName: m.sellerStableName,
      sellerSilks,
      expiresAtMs: m.listing.expiresAt.getTime(),
      mine: m.listing.sellerStableId === session.stable.id,
    };
  };
  const listings = all.map(view);
  const mineByHorse = new Map(listings.filter((l) => l.mine).map((l) => [l.id, l.listingId]));
  const horses: SellableHorse[] = [];
  for (const r of await listStableHorses(db, session.stable.id)) {
    if (r.careerStatus === "pasture") continue;
    const ts = await tradeStatus(db, r);
    horses.push({
      ...ecoHorse(r, silks, nowMs),
      appraisal: ts.appraisal,
      floor: ts.floor,
      lock: ts.lock,
      lockReason: ts.lock ? (LOCK_REASON[ts.lock]?.(ts) ?? "Can't be sold right now.") : null,
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
