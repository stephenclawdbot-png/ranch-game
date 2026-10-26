/**
 * Club house stallions at stud.
 *
 * A new game has an empty stud book: no player stallion has retired or reached 25 starts yet.
 * The Club keeps a small roster of retired house stallions standing at public stud so a
 * player can breed as soon as their mare is eligible.
 *
 * - Owned by the Club (owner_stable_id null, origin 'house'), racing-retired, so they never
 *   join Live fields (house fillers must be `racing`) and can never be listed or sold.
 * - Deterministic genomes: stud #n is game-core `generateFoundationGenome` seeded by
 *   ("house-stud", n), minted at the current season's launch ceiling with a modest rarity
 *   (common / uncommon / rare), so they never out-class what players can breed or pull.
 * - The usual breeding rules apply to them (4 coverings per lifetime, 4 per season). When a
 *   stallion has used his lifetime coverings he is retired to the Legacy Farm and the next
 *   numbered stallion takes his box, so the roster always has `HOUSE_STUD_COUNT` available.
 * - Fees go through the ledger like any stud fee (breeding.ts): the base fee and 10% of the
 *   stud fee are burned, the rest goes to the Club's `treasury` system account.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { gc, specFromGenome } from "../gameCore";
import { RULES, seasonNumberAt } from "../rules";
import { horses } from "../schema";
import type { Db } from "../types";
import { insertHorse } from "./accounts";
import { audit, runTx } from "./tx";

/** Stallions the Club keeps available at stud. */
export const HOUSE_STUD_COUNT = 4;

const RARITY_CYCLE = ["uncommon", "common", "rare", "uncommon"] as const;
/** Stud fees by rarity (credits). The breeding base fee (1,500, burned) comes on top. */
export const HOUSE_STUD_FEES: Record<(typeof RARITY_CYCLE)[number], number> = { common: 250, uncommon: 400, rare: 700 };

/** The house stallion with serial `n`: deterministic genome, name and fee. */
export function houseStudSpec(n: number, season: number) {
  const rarity = RARITY_CYCLE[n % RARITY_CYCLE.length]!;
  const genome = gc.generateFoundationGenome(gc.seedFrom("house-stud", n), { season, rarity });
  const name = gc.clubHorseName(new gc.Rng(`house-stud|${n}|name`));
  const spec = specFromGenome({ genome, name, sex: "colt", careSessions: gc.CARE_TO_RACING, season });
  return { spec: { ...spec, rating: gc.INITIAL_OR }, rarity, fee: HOUSE_STUD_FEES[rarity] };
}

const houseStudWhere = () => and(isNull(horses.ownerStableId), eq(horses.origin, "house"), isNotNull(horses.studFee));

/**
 * Keeps `HOUSE_STUD_COUNT` Club stallions available at stud (idempotent; serialised with an
 * advisory lock so concurrent requests never mint the same serial twice).
 */
export async function ensureHouseStuds(db: Db, now: Date): Promise<{ created: number; retired: number }> {
  // Cheap check first: nothing to do in the common case.
  const [pre] = await db
    .select({ n: sql<number>`count(*) filter (where ${horses.breedingCount} < ${RULES.breedingLifetimeLimit} and ${horses.careerStatus} <> 'pasture')::int` })
    .from(horses)
    .where(houseStudWhere());
  if (Number(pre?.n ?? 0) >= HOUSE_STUD_COUNT) return { created: 0, retired: 0 };

  return runTx(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${HOUSE_STUD_LOCK})`);
    const all = await tx.select().from(horses).where(houseStudWhere()).orderBy(asc(horses.createdAt));
    let retired = 0;
    for (const h of all) {
      if (h.careerStatus !== "pasture" && h.breedingCount >= RULES.breedingLifetimeLimit) {
        await tx.update(horses).set({ careerStatus: "pasture", pasturedAt: now, updatedAt: now }).where(eq(horses.id, h.id));
        retired++;
      }
    }
    const available = all.filter((h) => h.careerStatus !== "pasture" && h.breedingCount < RULES.breedingLifetimeLimit).length;
    const season = seasonNumberAt(now);
    let created = 0;
    for (let n = all.length; n < all.length + Math.max(0, HOUSE_STUD_COUNT - available); n++) {
      const { spec, fee, rarity } = houseStudSpec(n, season);
      const id = await insertHorse(tx, { stableId: null, spec, origin: "house", birthSeasonNumber: season, now });
      await tx
        .update(horses)
        .set({ careerStatus: "retired", retirementReason: "choice", retiredAt: now, studFee: fee, dynamics: { houseStud: n, retiredAtStarts: 0 } })
        .where(eq(horses.id, id));
      await audit(tx, { actor: null, action: "house_stud.stand", entityType: "horse", entityId: id, data: { serial: n, rarity, fee, season } });
      created++;
    }
    return { created, retired };
  });
}

/** Arbitrary constant key for the advisory lock (distinct from the migration lock). */
const HOUSE_STUD_LOCK = 7_310_221;
