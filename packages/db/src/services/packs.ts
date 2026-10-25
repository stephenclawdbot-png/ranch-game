/**
 * Packs (gacha with published odds, pity and commit/reveal seeds), §8 + §4b limits:
 * - the seed of a player's NEXT pull is committed (sha256) before they pull, and revealed
 *   with the result;
 * - pity counters are updated under a row lock;
 * - free Paddock Pack every 3rd play day (its horse is bound / Club-bred); at most 3
 *   bought Paddock Packs and 10 Premium Packs per account per week;
 * - every pack horse consumes one unit of the seasonal global foal crop, taken with a
 *   single guarded UPDATE, so concurrent pulls can never oversell it;
 * - the horse needs a free stall (stable row lock).
 */
import { and, eq, sql } from "drizzle-orm";
import { commitSeed, newSeed, utcWeekStart } from "../crypto";
import { DomainError } from "../errors";
import { foalCrop, packPity, packPulls } from "../schema";
import { PACKS, RULES, seasonNumberAt, type GameHooks, type Rarity } from "../rules";
import { gc } from "../gameCore";
import { defaultHooks } from "../hooks";
import type { Db, Executor } from "../types";
import { assertStallFree, insertHorse, lockStableOf, recordPlayDay } from "./accounts";
import { spendCreditsTx } from "./ledger";
import { audit, runTx } from "./tx";

async function ensurePity(ex: Executor, accountId: string, packType: string) {
  const seed = newSeed();
  await ex.insert(packPity).values({ accountId, packType, nextSeed: seed, nextSeedCommitment: commitSeed(seed) }).onConflictDoNothing();
}

async function ensureCrop(ex: Executor, season: number): Promise<void> {
  await ex.insert(foalCrop).values({ seasonNumber: season, cap: RULES.foalCropPerSeason }).onConflictDoNothing();
}

export async function foalCropStatus(ex: Executor, season: number): Promise<{ season: number; cap: number; produced: number; remaining: number }> {
  const [row] = await ex.select().from(foalCrop).where(eq(foalCrop.seasonNumber, season));
  const cap = row?.cap ?? RULES.foalCropPerSeason;
  const produced = row?.produced ?? 0;
  return { season, cap, produced, remaining: cap - produced };
}

/** Admin: set this season's crop cap. */
export async function setFoalCropCap(ex: Executor, season: number, cap: number): Promise<void> {
  await ex.insert(foalCrop).values({ seasonNumber: season, cap }).onConflictDoUpdate({ target: foalCrop.seasonNumber, set: { cap, updatedAt: new Date() } });
}

async function weeklyPaidPulls(ex: Executor, accountId: string, packType: string, weekStart: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(packPulls)
    .where(and(eq(packPulls.accountId, accountId), eq(packPulls.packType, packType), eq(packPulls.weekStart, weekStart), eq(packPulls.free, false)));
  return Number(r?.n ?? 0);
}

async function freePullsClaimed(ex: Executor, accountId: string): Promise<number> {
  const [r] = await ex.select({ n: sql<number>`count(*)::int` }).from(packPulls).where(and(eq(packPulls.accountId, accountId), eq(packPulls.free, true)));
  return Number(r?.n ?? 0);
}

function weeklyLimit(packType: string): number {
  return packType === "premium" ? RULES.premiumPerWeek : RULES.paidPaddockPerWeek;
}

export interface PackState {
  packType: string;
  nextSeedCommitment: string;
  totalPulls: number;
  sinceRare: number;
  sinceEpic: number;
  paidThisWeek: number;
  weeklyLimit: number;
  freeAvailable: number;
  crop: { cap: number; produced: number; remaining: number };
}

/** What the pack screen shows before a pull (including the committed seed hash). */
export async function getPackState(db: Db, input: { accountId: string; packType: string; now: Date }): Promise<PackState> {
  if (!PACKS[input.packType]) throw new DomainError("INVALID_INPUT", "unknown pack");
  return runTx(db, async (tx) => {
    await ensurePity(tx, input.accountId, input.packType);
    const [p] = await tx.select().from(packPity).where(and(eq(packPity.accountId, input.accountId), eq(packPity.packType, input.packType)));
    const playDays = await recordPlayDay(tx, input.accountId, input.now);
    const free = input.packType === "paddock" ? Math.floor(playDays / RULES.freePaddockEveryPlayDays) - (await freePullsClaimed(tx, input.accountId)) : 0;
    const crop = await foalCropStatus(tx, seasonNumberAt(input.now));
    return {
      packType: input.packType,
      nextSeedCommitment: p!.nextSeedCommitment,
      totalPulls: p!.totalPulls,
      sinceRare: p!.sinceRare,
      sinceEpic: p!.sinceEpic,
      paidThisWeek: await weeklyPaidPulls(tx, input.accountId, input.packType, utcWeekStart(input.now)),
      weeklyLimit: weeklyLimit(input.packType),
      freeAvailable: Math.max(0, free),
      crop,
    };
  });
}

export interface PullInput {
  accountId: string;
  packType: string;
  idempotencyKey: string;
  now: Date;
  /** Claim the free Paddock Pack (play-day entitlement) instead of paying. */
  free?: boolean;
}

export interface PullResult {
  pullId: string;
  rarity: Rarity;
  horseId: string;
  seedCommitment: string;
  seedReveal: string;
  pityApplied: "rare" | "epic" | null;
  nextSeedCommitment: string;
  duplicate: boolean;
}


export async function pullPack(db: Db, input: PullInput, hooks: GameHooks = defaultHooks): Promise<PullResult> {
  const pack = PACKS[input.packType];
  if (!pack) throw new DomainError("INVALID_INPUT", "unknown pack");
  if (input.free && input.packType !== "paddock") throw new DomainError("INVALID_INPUT", "only Paddock Packs are free");
  return runTx(db, async (tx) => {
    const [prior] = await tx.select().from(packPulls).where(eq(packPulls.idempotencyKey, input.idempotencyKey));
    if (prior) {
      const [p] = await tx.select().from(packPity).where(and(eq(packPity.accountId, prior.accountId), eq(packPity.packType, prior.packType)));
      return {
        pullId: prior.id,
        rarity: prior.rarity,
        horseId: prior.horseId!,
        seedCommitment: prior.seedCommitment,
        seedReveal: prior.seedReveal,
        pityApplied: (prior.pityApplied as "rare" | "epic" | null) ?? null,
        nextSeedCommitment: p!.nextSeedCommitment,
        duplicate: true,
      };
    }
    // Lock order: stable -> pity -> crop.
    const stable = await lockStableOf(tx, input.accountId);
    await assertStallFree(tx, stable);
    await ensurePity(tx, input.accountId, input.packType);
    const [pity] = await tx
      .select()
      .from(packPity)
      .where(and(eq(packPity.accountId, input.accountId), eq(packPity.packType, input.packType)))
      .for("update");
    const weekStart = utcWeekStart(input.now);
    const playDays = await recordPlayDay(tx, input.accountId, input.now);
    if (input.free) {
      const entitled = Math.floor(playDays / RULES.freePaddockEveryPlayDays);
      if ((await freePullsClaimed(tx, input.accountId)) >= entitled) {
        throw new DomainError("PACK_LIMIT", `a free Paddock Pack comes every ${RULES.freePaddockEveryPlayDays}rd play day`);
      }
    } else if ((await weeklyPaidPulls(tx, input.accountId, input.packType, weekStart)) >= weeklyLimit(input.packType)) {
      throw new DomainError("PACK_LIMIT", `weekly limit of ${weeklyLimit(input.packType)} ${input.packType} packs reached`);
    }

    const season = seasonNumberAt(input.now);
    await ensureCrop(tx, season);
    const taken = await tx
      .update(foalCrop)
      .set({ produced: sql`${foalCrop.produced} + 1`, updatedAt: input.now })
      .where(and(eq(foalCrop.seasonNumber, season), sql`${foalCrop.produced} < ${foalCrop.cap}`))
      .returning({ produced: foalCrop.produced });
    if (!taken[0]) throw new DomainError("CROP_SOLD_OUT", "this season's foal crop is sold out");

    let ledgerTransactionId: string | null = null;
    if (!input.free) {
      ledgerTransactionId = (
        await spendCreditsTx(tx, { accountId: input.accountId, amount: pack.price, idempotencyKey: `pack:${input.idempotencyKey}`, kind: "pack" })
      ).transactionId;
    }

    const p = pity!;
    const pullIndex = p.totalPulls + 1;
    // The pull itself is game-core's (published odds, pity, foundation genome under the
    // season ceiling). The account's pre-committed seed is game-core's server seed.
    const seed = p.nextSeed;
    const packType = input.packType as gc.PackType;
    const { pull, pity: next } = gc.pullPack(packType, { pulls: p.totalPulls, sinceRare: p.sinceRare, sinceEpic: p.sinceEpic }, { serverSeed: seed, accountId: input.accountId, season });
    if (pull.seedCommitment !== p.nextSeedCommitment) throw new Error("pack seed does not match its commitment");
    const rarity = pull.rarity as Rarity;
    const pityApplied = pull.pityTriggered === "none" ? null : pull.pityTriggered;
    const spec = hooks.packHorse({ seed: pull.pullSeed, rarity, packType: input.packType, season, genome: pull.genome, sex: gc.pullSex(pull) });
    const horseId = await insertHorse(tx, {
      stableId: stable.id,
      spec,
      origin: "pack",
      bound: !!input.free,
      birthSeasonNumber: season,
      now: input.now,
    });
    const nextSeed = newSeed();
    await tx
      .update(packPity)
      .set({
        totalPulls: pullIndex,
        sinceRare: next.sinceRare,
        sinceEpic: next.sinceEpic,
        nextSeed,
        nextSeedCommitment: commitSeed(nextSeed),
        updatedAt: input.now,
      })
      .where(and(eq(packPity.accountId, input.accountId), eq(packPity.packType, input.packType)));
    const [pull] = await tx
      .insert(packPulls)
      .values({
        accountId: input.accountId,
        packType: input.packType,
        pullIndex,
        seedCommitment: p.nextSeedCommitment,
        seedReveal: seed,
        rarity,
        pityApplied,
        horseId,
        price: input.free ? 0 : pack.price,
        free: !!input.free,
        weekStart,
        seasonNumber: season,
        ledgerTransactionId,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.now,
      })
      .returning({ id: packPulls.id });
    await audit(tx, { actor: input.accountId, action: "pack.pull", entityType: "pack_pull", entityId: pull!.id, data: { rarity, pityApplied, horseId } });
    return {
      pullId: pull!.id,
      rarity,
      horseId,
      seedCommitment: p.nextSeedCommitment,
      seedReveal: seed,
      pityApplied,
      nextSeedCommitment: commitSeed(nextSeed),
      duplicate: false,
    };
  });
}
