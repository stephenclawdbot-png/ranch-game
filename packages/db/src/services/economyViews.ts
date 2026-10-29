/**
 * Read models and small actions for the economy screens (breeding barn, stud book, packs,
 * market). The rules stay where they are (game-core, plus the transactional services in
 * breeding.ts / packs.ts / market.ts); this file only gathers what a screen needs to explain
 * a rule before the player acts:
 *
 *   - breeding: each horse's eligibility (game-core breedingEligibility over the same state
 *     `breed` builds), the exact pairing preview (game-core previewBreeding) with fees, the
 *     stable's pregnancies, public studs, and naming a foal at foaling;
 *   - packs: pull history, play days, and the proof of a pull (the revealed seed chain, so
 *     the browser can re-derive pity and the foal's genome);
 *   - market: seller requirements as data, per-horse listability with the appraisal floor and
 *     ceiling, the active listings with horse and seller.
 *
 * Reads never change state, except `nameFoal` (which wraps the idempotent `foal`).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { gc, genomeOf, isGenome, toHorseState } from "../gameCore";
import { defaultHooks } from "../hooks";
import { RULES, bps, defaultAppraise, seasonBounds, seasonNumberAt, sellerPolicy, type GameHooks, type SellerPolicy } from "../rules";
import {
  accountPlayDays,
  accounts,
  breedingEvents,
  horses,
  marketListings,
  packPulls,
  pregnancies,
  stables,
  trades,
  type HorseRow,
  type ListingRow,
  type PregnancyRow,
} from "../schema";
import type { Db, Executor } from "../types";
import { stableOf } from "./accounts";
import { foal, grandparentsOf, pedigreeIndex } from "./breeding";
import { renameHorse } from "./horses";
import { resaleLock, settledRacesForStable } from "./market";

export type PackPullRow = typeof packPulls.$inferSelect;

/** Horses by id in ONE query (screens join pull history and listings to horse rows). */
export async function horsesByIds(ex: Executor, ids: string[]): Promise<Map<string, HorseRow>> {
  if (!ids.length) return new Map();
  const rows = await ex.select().from(horses).where(inArray(horses.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------------------------------------------------------------------------
// Breeding
// ---------------------------------------------------------------------------

async function coversBySeason(ex: Executor, horseId: string, role: "sire" | "dam") {
  const col = role === "sire" ? breedingEvents.sireId : breedingEvents.damId;
  const rows = await ex
    .select({ season: breedingEvents.seasonNumber, count: sql<number>`count(*)::int` })
    .from(breedingEvents)
    .where(eq(col, horseId))
    .groupBy(breedingEvents.seasonNumber);
  return rows.map((r) => ({ season: r.season, count: Number(r.count) }));
}

/** The game-core state `breed` builds for a horse (covers per season, carrying pregnancy). */
export async function breedingStateOf(ex: Executor, horse: HorseRow): Promise<gc.HorseState> {
  const role = horse.sex === "female" ? "dam" : "sire";
  const [carrying] = role === "dam" ? await ex.select().from(pregnancies).where(and(eq(pregnancies.damId, horse.id), eq(pregnancies.status, "carrying"))) : [];
  return toHorseState(horse, { bySeason: await coversBySeason(ex, horse.id, role), pregnancy: carrying ?? null });
}

export interface BreedingStatus {
  horseId: string;
  /** game-core BreedBlock (or a lock: "in_race" / "listed"), null when the horse can breed now. */
  block: gc.BreedBlock | "in_race" | "listed" | "no_genome" | null;
  used: number;
  lifetime: number;
  usedThisSeason: number;
  perSeason: number;
  starts: number;
  fromStarts: number;
  retired: boolean;
}

/** Can this horse breed right now (ignoring the partner)? Same checks as `breed`. */
export async function breedingStatus(ex: Executor, horse: HorseRow, now: Date): Promise<BreedingStatus> {
  const season = seasonNumberAt(now);
  const female = horse.sex === "female";
  const base = {
    horseId: horse.id,
    used: horse.breedingCount,
    lifetime: RULES.breedingLifetimeLimit,
    perSeason: female ? RULES.marePerSeason : RULES.stallionPerSeason,
    starts: horse.starts,
    fromStarts: RULES.breedingMinStarts,
    retired: horse.careerStatus !== "racing",
  };
  if (!isGenome(horse.genome)) return { ...base, block: "no_genome", usedThisSeason: 0 };
  const state = await breedingStateOf(ex, horse);
  const usedThisSeason = gc.usedInSeason(state, season);
  let block: BreedingStatus["block"] = gc.breedingEligibility(state, season);
  if (!block && horse.lockKind === "race" && female) block = "in_race";
  if (!block && horse.lockKind === "market") block = "listed";
  return { ...base, block, usedThisSeason };
}

export interface PairingPreview {
  preview: gc.BreedingPreview;
  /** Block for this exact pairing (kinship, sexes, eligibility of either horse, locks). */
  block: gc.BreedBlock | "in_race" | "listed" | "not_at_stud" | "not_your_mare" | null;
  fees: gc.BreedingFees;
  ownSire: boolean;
  sire: HorseRow;
  dam: HorseRow;
  season: number;
  /** The sire's and dam's own overall potentials (game-core overallPotential). */
  parents: { sire: number; dam: number };
}

/**
 * The exact breeding preview of a mare of yours with your own stallion or a stallion standing
 * at stud. Read-only: nothing is locked or charged; `breed` re-checks everything.
 */
export async function previewPairing(ex: Executor, input: { accountId: string; sireId: string; damId: string; now: Date }): Promise<PairingPreview> {
  if (input.sireId === input.damId) throw new DomainError("SELF_BREEDING", "a horse cannot breed with itself");
  const stable = await stableOf(ex, input.accountId);
  const rows = await ex.select().from(horses).where(inArray(horses.id, [input.sireId, input.damId]));
  const sire = rows.find((h) => h.id === input.sireId);
  const dam = rows.find((h) => h.id === input.damId);
  if (!sire || !dam) throw new DomainError("NOT_FOUND", "horse not found");
  if (!isGenome(sire.genome) || !isGenome(dam.genome)) throw new DomainError("NOT_ELIGIBLE", "these horses have no pedigree record");
  const ownSire = sire.ownerStableId === stable.id;
  const season = seasonNumberAt(input.now);
  const [sireState, damState] = [await breedingStateOf(ex, sire), await breedingStateOf(ex, dam)];
  const ped = await pedigreeIndex(ex, [sire.id, dam.id]);
  const family = (await grandparentsOf(ex, sire, dam)).map((r) => genomeOf(r.genome)).filter((g): g is gc.Genome => g !== null);
  const preview = gc.previewBreeding(sireState, damState, ped, season, family);
  let block: PairingPreview["block"] = null;
  if (dam.ownerStableId !== stable.id) block = "not_your_mare";
  else if (!ownSire && !standsAtStud(sire)) block = "not_at_stud";
  else if (preview.blocked) block = preview.blocked;
  else if (dam.lockKind === "race") block = "in_race";
  else if (dam.lockKind === "market" || sire.lockKind === "market") block = "listed";
  return {
    preview,
    block,
    fees: gc.breedingFees(sire.studFee ?? 0, ownSire),
    ownSire,
    sire,
    dam,
    season,
    parents: { sire: gc.overallPotential(sireState.genome), dam: gc.overallPotential(damState.genome) },
  };
}

export interface PregnancyView {
  pregnancy: PregnancyRow;
  dam: HorseRow;
  sire: HorseRow;
  foal: HorseRow | null;
}

/** The stable's carrying pregnancies and those foaled since `foaledSince`. */
export async function listStablePregnancies(ex: Executor, stableId: string, foaledSince: Date): Promise<PregnancyView[]> {
  const mares = await ex.select({ id: horses.id }).from(horses).where(and(eq(horses.ownerStableId, stableId), eq(horses.sex, "female")));
  if (!mares.length) return [];
  const pregs = await ex
    .select()
    .from(pregnancies)
    .where(
      and(
        inArray(
          pregnancies.damId,
          mares.map((m) => m.id),
        ),
        or(eq(pregnancies.status, "carrying"), and(eq(pregnancies.status, "foaled"), gte(pregnancies.foaledAt, foaledSince))),
      ),
    )
    .orderBy(asc(pregnancies.dueAt));
  if (!pregs.length) return [];
  const ids = [...new Set(pregs.flatMap((p) => [p.sireId, p.damId, ...(p.foalId ? [p.foalId] : [])]))];
  const hs = new Map((await ex.select().from(horses).where(inArray(horses.id, ids))).map((h) => [h.id, h]));
  return pregs.map((p) => ({ pregnancy: p, dam: hs.get(p.damId)!, sire: hs.get(p.sireId)!, foal: p.foalId ? (hs.get(p.foalId) ?? null) : null }));
}

export interface StudListing {
  horse: HorseRow;
  stableName: string;
  silks: unknown;
  /** A Club house stallion (houseStuds.ts). */
  club: boolean;
}

/** The name the stud book shows for Club house stallions. */
export const CLUB_STUD_NAME = "The Club";

/**
 * Stallions standing at public stud (entire, not on the Legacy Farm): player-owned ones and
 * the Club's house stallions (owner null, origin 'house').
 */
export async function listStuds(ex: Executor, opts: { limit?: number } = {}): Promise<StudListing[]> {
  const rows = await ex
    .select({ horse: horses, stableName: stables.name, silks: stables.silks })
    .from(horses)
    .leftJoin(stables, eq(stables.id, horses.ownerStableId))
    .where(
      and(
        isNotNull(horses.studFee),
        eq(horses.sex, "male"),
        eq(horses.gelded, false),
        ne(horses.careerStatus, "pasture"),
        isNull(horses.releasedAt),
        or(isNotNull(horses.ownerStableId), eq(horses.origin, "house")),
      ),
    )
    .orderBy(asc(horses.studFee), desc(horses.rating))
    .limit(opts.limit ?? 60);
  return rows.map((r) => ({ horse: r.horse, stableName: r.stableName ?? CLUB_STUD_NAME, silks: r.silks ?? null, club: r.horse.ownerStableId === null }));
}

/** A horse that stands at public stud: a player's stallion with a fee, or a Club house stallion. */
export function standsAtStud(h: Pick<HorseRow, "studFee" | "ownerStableId" | "origin">): boolean {
  return h.studFee !== null && (h.ownerStableId !== null || h.origin === "house");
}

/**
 * Foal a due pregnancy of one of your mares and give the foal a name (optional; the Club
 * suggests one otherwise). Idempotent: an already foaled pregnancy returns its foal, renamed
 * if a name is given and the foal has not raced.
 */
export async function nameFoal(
  db: Db,
  input: { accountId: string; pregnancyId: string; name?: string; now: Date },
  hooks: GameHooks = defaultHooks,
): Promise<{ foalId: string; alreadyFoaled: boolean; inOverflow: boolean }> {
  const raw = input.name?.trim() || undefined;
  let name: string | undefined;
  if (raw !== undefined) {
    const check = gc.validateHorseName(raw);
    if (!check.ok) throw new DomainError("INVALID_INPUT", check.message, { problem: check.problem });
    name = check.name;
  }
  const stable = await stableOf(db, input.accountId);
  const [preg] = await db.select().from(pregnancies).where(eq(pregnancies.id, input.pregnancyId));
  if (!preg) throw new DomainError("NOT_FOUND", "pregnancy not found");
  const [dam] = await db.select({ owner: horses.ownerStableId }).from(horses).where(eq(horses.id, preg.damId));
  if (dam?.owner !== stable.id) throw new DomainError("NOT_OWNER", "that mare isn't in your stable");
  const res = await foal(db, { pregnancyId: preg.id, now: input.now, name }, hooks);
  if (res.alreadyFoaled && name) await renameHorse(db, { accountId: input.accountId, horseId: res.foalId, name });
  return { foalId: res.foalId, alreadyFoaled: res.alreadyFoaled, inOverflow: res.inOverflow };
}

/** Season number, its end, and when the next one starts (mares: one cover per season). */
export function breedingSeason(now: Date): { season: number; endsAt: Date } {
  const season = seasonNumberAt(now);
  return { season, endsAt: seasonBounds(season).endsAt };
}

/**
 * Overall potentials (game-core overallPotential) of up to `limit` recent player horses, sorted
 * ascending: the population a preview's predicted foal is ranked against.
 */
export async function populationOverall(ex: Executor, limit = 2000): Promise<number[]> {
  const rows = await ex
    .select({ genome: horses.genome })
    .from(horses)
    .where(and(isNotNull(horses.ownerStableId), ne(horses.careerStatus, "pasture")))
    .orderBy(desc(horses.createdAt))
    .limit(limit);
  const out: number[] = [];
  for (const r of rows) {
    const g = genomeOf(r.genome);
    if (g) out.push(gc.overallPotential(g));
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export async function listPackPulls(ex: Executor, accountId: string, limit = 20): Promise<(PackPullRow & { horseName: string | null })[]> {
  const rows = await ex
    .select({ pull: packPulls, horseName: horses.name })
    .from(packPulls)
    .leftJoin(horses, eq(horses.id, packPulls.horseId))
    .where(eq(packPulls.accountId, accountId))
    .orderBy(desc(packPulls.createdAt), desc(packPulls.pullIndex))
    .limit(limit);
  return rows.map((r) => ({ ...r.pull, horseName: r.horseName }));
}

/** Distinct play days of the account (free Paddock Pack every 3rd). */
export async function playDaysOf(ex: Executor, accountId: string): Promise<number> {
  const [r] = await ex.select({ n: sql<number>`count(*)::int` }).from(accountPlayDays).where(eq(accountPlayDays.accountId, accountId));
  return Number(r?.n ?? 0);
}

export interface PullProof {
  pull: PackPullRow;
  accountId: string;
  /** Every earlier pull of this pack type, oldest first (seeds already revealed). */
  chain: { pullIndex: number; seedReveal: string; seasonNumber: number; rarity: string }[];
  /** Pity counters before this pull, derived by replaying the chain with game-core. */
  pityBefore: gc.PityState;
  /** The pulled horse's stored genome and sex (null if the horse is gone). */
  genome: unknown;
  sex: "colt" | "filly" | null;
  /** Server-side re-check (the browser repeats it). */
  checks: { commitment: boolean; chain: boolean; rarity: boolean; pity: boolean; genome: boolean; sex: boolean };
  verified: boolean;
}

/** Deep equality for JSON values (jsonb reorders object keys). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => jsonEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const kb = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => jsonEqual(ao[k], bo[k]));
}

/** Replays a pull chain with game-core and checks one pull against its commitment and horse. */
export function checkPull(input: {
  packType: string;
  accountId: string;
  chain: PullProof["chain"];
  pull: { pullIndex: number; seedCommitment: string; seedReveal: string; seasonNumber: number; rarity: string; pityApplied: string | null };
  genome: unknown;
  sex: "colt" | "filly" | null;
}): { pityBefore: gc.PityState; checks: PullProof["checks"]; verified: boolean } {
  const type = input.packType as gc.PackType;
  let pity: gc.PityState = { ...gc.NEW_PITY };
  let chainOk = true;
  for (const p of input.chain) {
    try {
      const r = gc.pullPack(type, pity, { serverSeed: p.seedReveal, accountId: input.accountId, season: p.seasonNumber });
      if (r.pull.rarity !== p.rarity || p.pullIndex !== pity.pulls + 1) chainOk = false;
      pity = r.pity;
    } catch {
      chainOk = false;
    }
  }
  const pityBefore = pity;
  const checks = { commitment: false, chain: chainOk, rarity: false, pity: false, genome: false, sex: false };
  try {
    checks.commitment = gc.commitSeed(input.pull.seedReveal) === input.pull.seedCommitment;
    const { pull } = gc.pullPack(type, pityBefore, { serverSeed: input.pull.seedReveal, accountId: input.accountId, season: input.pull.seasonNumber });
    checks.rarity = pull.rarity === input.pull.rarity && input.pull.pullIndex === pityBefore.pulls + 1;
    checks.pity = (pull.pityTriggered === "none" ? null : pull.pityTriggered) === (input.pull.pityApplied ?? null);
    // A pull made before genetics v2 stored a version-1 genome: re-derive it with the v1 mint.
    const v1 = (input.genome as { version?: unknown } | null)?.version === 1;
    const expected = v1 ? gc.mintForVersion(pull.pullSeed, { season: input.pull.seasonNumber, rarity: pull.rarity }, 1) : pull.genome;
    checks.genome = input.genome === null || jsonEqual(expected, input.genome);
    checks.sex = input.sex === null || gc.pullSex(pull) === input.sex;
  } catch {
    /* a malformed seed fails the commitment check */
  }
  return { pityBefore, checks, verified: Object.values(checks).every(Boolean) };
}

/** The revealed proof of one of the account's pulls. */
export async function packPullProof(ex: Executor, input: { accountId: string; pullId: string }): Promise<PullProof> {
  const [pull] = await ex.select().from(packPulls).where(eq(packPulls.id, input.pullId));
  if (!pull || pull.accountId !== input.accountId) throw new DomainError("NOT_FOUND", "pull not found");
  const prior = await ex
    .select({ pullIndex: packPulls.pullIndex, seedReveal: packPulls.seedReveal, seasonNumber: packPulls.seasonNumber, rarity: packPulls.rarity })
    .from(packPulls)
    .where(and(eq(packPulls.accountId, pull.accountId), eq(packPulls.packType, pull.packType), sql`${packPulls.pullIndex} < ${pull.pullIndex}`))
    .orderBy(asc(packPulls.pullIndex));
  const [horse] = pull.horseId ? await ex.select().from(horses).where(eq(horses.id, pull.horseId)) : [];
  const genome = horse ? horse.genome : null;
  const sex = horse ? (horse.sex === "female" ? "filly" : "colt") : null;
  const res = checkPull({ packType: pull.packType, accountId: pull.accountId, chain: prior, pull, genome, sex });
  return { pull, accountId: pull.accountId, chain: prior, genome, sex, ...res };
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export interface SellerStatus {
  ok: boolean;
  accountAgeDays: number;
  minAccountAgeDays: number;
  /** When the account becomes old enough (null once it is). */
  oldEnoughAt: Date | null;
  races: number;
  minRaces: number;
  emailVerified: boolean;
  /** Whether a verified email is required (MARKET_REQUIRE_VERIFIED_EMAIL). */
  emailRequired: boolean;
  /** Plain-words list of what is missing. */
  missing: string[];
}

/** The seller requirements (§4b, env-configurable: rules.ts sellerPolicy) as data. */
export async function sellerStatus(ex: Executor, input: { accountId: string; stableId: string; now: Date; policy?: SellerPolicy }): Promise<SellerStatus> {
  const policy = input.policy ?? sellerPolicy();
  const [acc] = await ex.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!acc) throw new DomainError("NOT_FOUND", "account not found");
  const ageMs = input.now.getTime() - acc.createdAt.getTime();
  const races = await settledRacesForStable(ex, input.stableId);
  const minDays = policy.minAccountAgeDays;
  const minAgeMs = minDays * 86_400_000;
  const oldEnough = ageMs >= minAgeMs;
  const missing: string[] = [];
  if (!oldEnough) missing.push(`Account at least ${minDays} days old`);
  if (races < policy.minRaces) missing.push(`${policy.minRaces} races run (${races} so far)`);
  if (policy.requireVerifiedEmail && !acc.emailVerifiedAt) missing.push("A verified email address");
  return {
    ok: missing.length === 0,
    accountAgeDays: Math.max(0, Math.floor(ageMs / 86_400_000)),
    minAccountAgeDays: minDays,
    oldEnoughAt: oldEnough ? null : new Date(acc.createdAt.getTime() + minAgeMs),
    races,
    minRaces: policy.minRaces,
    emailVerified: !!acc.emailVerifiedAt,
    emailRequired: policy.requireVerifiedEmail,
    missing,
  };
}

export type TradeLock = "club_bred" | "until_starts" | "in_race" | "listed" | "in_foal" | "legacy_farm" | "resale_lock" | null;

export interface TradeStatus {
  horseId: string;
  lock: TradeLock;
  /** Starts still needed for foals of Club-bred parents. */
  startsNeeded: number;
  appraisal: number;
  floor: number;
  /** Maximum listing price: 3x the appraisal (AUDIT §6). */
  ceiling: number;
  /** While lock === "resale_lock": when this stable bought the horse and when it can be listed again. */
  boughtAt: Date | null;
  resaleUntil: Date | null;
}

/** The resale lock of a horse this stable bought on the market, while it lasts (else null). */
export function resaleInfoOf(boughtAt: Date, now: Date): { boughtAt: Date; until: Date } | null {
  const until = new Date(boughtAt.getTime() + RULES.resaleLockMs);
  return until.getTime() > now.getTime() ? { boughtAt, until } : null;
}

/**
 * The whole stable's resale locks in ONE query (the latest market buy per horse), for
 * callers that call `tradeStatus` for every horse of a stable: pass the map's entries in,
 * instead of `tradeStatus` querying `trades` once per horse (an N+1).
 */
export async function resaleLocksOf(ex: Executor, ownerStableId: string, now: Date): Promise<Map<string, { boughtAt: Date; until: Date } | null>> {
  const rows = await ex
    .selectDistinctOn([trades.horseId], { horseId: trades.horseId, createdAt: trades.createdAt })
    .from(trades)
    .where(eq(trades.buyerStableId, ownerStableId))
    .orderBy(trades.horseId, desc(trades.createdAt));
  return new Map(rows.map((r) => [r.horseId, resaleInfoOf(r.createdAt, now)]));
}

/**
 * Whether a horse can be listed (ignoring the seller requirements), with its floor and
 * ceiling price. `resale` may come from `resaleLocksOf` (one query for a whole stable);
 * without it the single-horse resale lock is looked up here.
 */
export async function tradeStatus(
  ex: Executor,
  horse: HorseRow,
  now?: Date,
  hooks: GameHooks = defaultHooks,
  resaleIn?: { boughtAt: Date; until: Date } | null,
): Promise<TradeStatus> {
  const appraisal = (hooks.appraise ?? defaultAppraise)(horse);
  const floor = isGenome(horse.genome) ? gc.listingFloor(toHorseState(horse)) : bps(appraisal, RULES.listingFloorBps);
  // Never below the floor (or 1), so a degenerate appraisal can't invert the band.
  const ceiling = isGenome(horse.genome) ? gc.listingCeiling(toHorseState(horse)) : Math.max(bps(appraisal, RULES.listingCeilingBps), floor, 1);
  const resale = resaleIn !== undefined ? resaleIn : now && horse.ownerStableId ? await resaleLock(ex, horse.id, horse.ownerStableId, now) : null;
  let lock: TradeLock = null;
  const [carrying] = horse.sex === "female" ? await ex.select({ id: pregnancies.id }).from(pregnancies).where(and(eq(pregnancies.damId, horse.id), eq(pregnancies.status, "carrying"))) : [];
  if (horse.bound) lock = "club_bred";
  else if (horse.starts < horse.tradeMinStarts) lock = "until_starts";
  else if (horse.careerStatus === "pasture") lock = "legacy_farm";
  else if (horse.lockKind === "race") lock = "in_race";
  else if (horse.lockKind === "market") lock = "listed";
  else if (carrying) lock = "in_foal";
  else if (resale) lock = "resale_lock";
  return { horseId: horse.id, lock, startsNeeded: Math.max(0, horse.tradeMinStarts - horse.starts), appraisal, floor, ceiling, boughtAt: resale?.boughtAt ?? null, resaleUntil: resale?.until ?? null };
}

export interface MarketListingView {
  listing: ListingRow;
  horse: HorseRow;
  sellerStableName: string;
  sellerSilks: unknown;
}

/** Active, unexpired listings with horse and seller (soonest expiry first). */
/** Names of horses by id in one query (the sale catalogue's "by X out of Y"). */
export async function horseNamesByIds(ex: Executor, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await ex.select({ id: horses.id, name: horses.name }).from(horses).where(inArray(horses.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listMarket(ex: Executor, input: { now: Date; sellerStableId?: string; limit?: number }): Promise<MarketListingView[]> {
  const rows = await ex
    .select({ listing: marketListings, horse: horses, sellerStableName: stables.name, sellerSilks: stables.silks })
    .from(marketListings)
    .innerJoin(horses, eq(horses.id, marketListings.horseId))
    .innerJoin(stables, eq(stables.id, marketListings.sellerStableId))
    .where(
      and(
        eq(marketListings.status, "active"),
        sql`${marketListings.expiresAt} > ${input.now}`,
        input.sellerStableId ? eq(marketListings.sellerStableId, input.sellerStableId) : undefined,
      ),
    )
    .orderBy(asc(marketListings.expiresAt))
    .limit(input.limit ?? 60);
  return rows;
}
