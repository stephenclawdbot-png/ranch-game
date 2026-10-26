/**
 * Onboarding (game-design §10): the day-2 gift foal from the Club's broodmare.
 *
 * - Due from the account's second UTC day on (game-core `giftFoalDue`), once per account.
 * - The foal is game-core `createGiftFoal` (a common/uncommon foundation genome at the
 *   season's launch ceiling), Club-bred (bound: never sold), with 0 care sessions so it grows
 *   in the nursery through daily care.
 * - Idempotent: the inbox item with dedupe key `gift-foal` is the marker (unique per
 *   account), and the stable row lock serialises concurrent requests.
 * - Respects the stall cap: it takes a free stall, or the nursery overflow slot; when even
 *   that is taken it waits (nothing is lost; it arrives on a later visit once there is room).
 * - No credits move, so there is no ledger entry; the grant is audited.
 */
import { and, eq } from "drizzle-orm";
import { gc, specFromGenome } from "../gameCore";
import { RULES, seasonNumberAt } from "../rules";
import { accounts, inboxItems } from "../schema";
import type { Db } from "../types";
import { insertHorse, lockStableOf, occupancy } from "./accounts";
import { audit, runTx } from "./tx";

export const GIFT_FOAL_DEDUPE = "gift-foal";

export type GiftFoalResult =
  | { status: "granted"; horseId: string; name: string; inOverflow: boolean }
  | { status: "already" | "not_due" | "no_room" };

export async function grantGiftFoal(db: Db, input: { accountId: string; now: Date }): Promise<GiftFoalResult> {
  const [acc] = await db.select({ createdAt: accounts.createdAt }).from(accounts).where(eq(accounts.id, input.accountId));
  if (!acc) return { status: "not_due" };
  const given = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, input.accountId), eq(inboxItems.dedupeKey, GIFT_FOAL_DEDUPE)));
  if (given.length) return { status: "already" };
  if (!gc.giftFoalDue(acc.createdAt.getTime(), input.now.getTime(), false)) return { status: "not_due" };

  return runTx(db, async (tx): Promise<GiftFoalResult> => {
    const stable = await lockStableOf(tx, input.accountId);
    const again = await tx
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(and(eq(inboxItems.accountId, input.accountId), eq(inboxItems.dedupeKey, GIFT_FOAL_DEDUPE)));
    if (again.length) return { status: "already" };
    const occ = await occupancy(tx, stable);
    if (occ.used + 1 > stable.stallSlots + RULES.nurseryOverflowSlots) return { status: "no_room" };

    const season = seasonNumberAt(input.now);
    const seed = gc.seedFrom("gift", input.accountId);
    const name = gc.clubHorseName(new gc.Rng(`${seed}|gift-name`));
    const state = gc.createGiftFoal({ ownerId: input.accountId, seed, nowMs: input.now.getTime(), season, name });
    const spec = specFromGenome({ genome: state.genome, name, sex: state.sex === "filly" ? "filly" : "colt", careSessions: 0, season });
    const horseId = await insertHorse(tx, { stableId: stable.id, spec: { ...spec, careSessions: 0 }, origin: "gift", bound: true, birthSeasonNumber: season, now: input.now });
    const inOverflow = occ.used + 1 > stable.stallSlots;
    await tx.insert(inboxItems).values({
      accountId: input.accountId,
      kind: "gift_foal",
      dedupeKey: GIFT_FOAL_DEDUPE,
      title: `A gift foal from the Club: ${name}`,
      data: { inOverflow },
      horseId,
      createdAt: input.now,
    });
    await audit(tx, { actor: input.accountId, action: "onboarding.gift_foal", entityType: "horse", entityId: horseId, data: { season, inOverflow } });
    return { status: "granted", horseId, name, inOverflow };
  });
}
