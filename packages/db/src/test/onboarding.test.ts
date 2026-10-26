import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { RULES } from "../rules";
import { horses, inboxItems } from "../schema";
import { grantGiftFoal } from "../services/onboarding";
import { at, DAY, makeHorse, memoryDb, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

describe("day-2 gift foal", () => {
  it("arrives once from the second day, as a bound foal with an inbox note", async () => {
    const p = await newPlayer(h.db, { starters: 3 });
    expect(await grantGiftFoal(h.db, { accountId: p.accountId, now: at(60_000) })).toEqual({ status: "not_due" });
    const [a, b] = await Promise.all([grantGiftFoal(h.db, { accountId: p.accountId, now: at(DAY) }), grantGiftFoal(h.db, { accountId: p.accountId, now: at(DAY) })]);
    const granted = [a, b].filter((r) => r.status === "granted");
    expect(granted).toHaveLength(1);
    expect(await grantGiftFoal(h.db, { accountId: p.accountId, now: at(2 * DAY) })).toEqual({ status: "already" });
    const gifts = await h.db.select().from(horses).where(and(eq(horses.ownerStableId, p.stableId), eq(horses.origin, "gift")));
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ bound: true, careSessions: 0 });
    const inbox = await h.db.select().from(inboxItems).where(eq(inboxItems.accountId, p.accountId));
    expect(inbox.filter((i) => i.kind === "gift_foal")).toHaveLength(1);
  });

  it("uses the nursery overflow slot when the stalls are full, and waits when even that is taken", async () => {
    const p = await newPlayer(h.db, { starters: 0 });
    for (let i = 0; i < RULES.defaultStallSlots; i++) await makeHorse(h.db, p.stableId);
    const r = await grantGiftFoal(h.db, { accountId: p.accountId, now: at(DAY) });
    expect(r).toMatchObject({ status: "granted", inOverflow: true });

    const q = await newPlayer(h.db, { starters: 0 });
    for (let i = 0; i < RULES.defaultStallSlots + RULES.nurseryOverflowSlots; i++) await makeHorse(h.db, q.stableId);
    expect(await grantGiftFoal(h.db, { accountId: q.accountId, now: at(DAY) })).toEqual({ status: "no_room" });
  });
});
