import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../client";
import { accountPlayDays, accounts, ledgerTransactions, raceEntries } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { audienceMetrics } from "../services/audience";
import { grantCredits, spendCredits } from "../services/ledger";
import { createRace } from "../services/races";
import { DAY, at, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

/** Moves a ledger transaction's postings to `when` (postings are stamped with the database clock; the append-only trigger is bypassed for the fixture). */
async function backdate(key: string, when: Date) {
  const [t] = await h.db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, key));
  await h.db.execute(sql`set session_replication_role = replica`);
  await h.db.execute(sql`update ledger_postings set created_at = ${when.toISOString()} where transaction_id = ${t!.id}`);
  await h.db.execute(sql`set session_replication_role = origin`);
}

describe("players by audience", () => {
  it("splits crypto players from the others: signups, day-1/day-7 returns, spend and races per active day", async () => {
    // T0 is Monday 2026-11-02 12:00 UTC; "now" is ten days later
    const now = at(10 * DAY);
    const cryptoA = await newPlayer(h.db, { now: at(DAY) }); // signs up 3 Nov
    const cryptoB = await newPlayer(h.db, { now: at(DAY) });
    const otherC = await newPlayer(h.db, { now: at(DAY) });
    const otherD = await newPlayer(h.db, { now: at(9 * DAY) }); // yesterday: day 1 not over yet
    await h.db.update(accounts).set({ walletAddress: "0x00000000000000000000000000000000000000a1" }).where(eq(accounts.id, cryptoA.accountId));
    await recordAccountSignal(h.db, { accountId: cryptoB.accountId, kind: "wallet", value: "0xb2" }); // linked once, since unlinked

    // A: back on day 1 (spends 100) and on day 7; B never returns
    await h.db.insert(accountPlayDays).values([
      { accountId: cryptoA.accountId, day: "2026-11-04" },
      { accountId: cryptoA.accountId, day: "2026-11-10" },
    ]);
    await grantCredits(h.db, { accountId: cryptoA.accountId, amount: 500, idempotencyKey: "aud:grant", kind: "adjustment" });
    await spendCredits(h.db, { accountId: cryptoA.accountId, amount: 100, idempotencyKey: "aud:spend", kind: "care" });
    await backdate("aud:spend", at(2 * DAY));
    // C: two race entries on day 1 (no play-day row: the entries are the activity)
    const race = await createRace(h.db, { kind: "scheduled", name: "Audience Stakes", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" }, postTime: at(2 * DAY + 3_600_000), entriesCloseAt: at(2 * DAY + 3_000_000), purse: 1000 });
    const race2 = await createRace(h.db, { kind: "scheduled", name: "Audience Stakes II", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" }, postTime: at(2 * DAY + 7_200_000), entriesCloseAt: at(2 * DAY + 7_000_000), purse: 1000 });
    for (const r of [race, race2]) {
      const horse = await makeHorse(h.db, otherC.stableId);
      await h.db.insert(raceEntries).values({ raceId: r.id, horseId: horse.id, stableId: otherC.stableId, tactic: "stalker", snapshot: {}, ratingBefore: 50, enteredAt: at(2 * DAY) });
    }
    // D played today
    await h.db.insert(accountPlayDays).values({ accountId: otherD.accountId, day: "2026-11-12" });

    const m = await audienceMetrics(h.db, { now, days: 14 });
    expect(m.toDay).toBe("2026-11-12");
    const crypto = m.groups.find((g) => g.key === "crypto")!;
    const other = m.groups.find((g) => g.key === "other")!;
    expect(crypto.accounts).toBe(2);
    expect(other.accounts).toBe(2);
    expect(crypto.newPerDay).toEqual([{ day: "2026-11-03", n: 2 }]);
    expect(other.newPerDay).toEqual([{ day: "2026-11-03", n: 1 }, { day: "2026-11-11", n: 1 }]);
    expect(crypto.day1).toEqual({ eligible: 2, returned: 1, pct: 50 });
    expect(crypto.day7).toEqual({ eligible: 2, returned: 1, pct: 50 });
    expect(other.day1).toEqual({ eligible: 1, returned: 1, pct: 100 });
    expect(other.day7).toEqual({ eligible: 1, returned: 0, pct: 0 });
    // A's active days: 4 Nov (100 spent) and 10 Nov (0): median 50, no races
    expect(crypto).toMatchObject({ activeDays: 2, medianSpentPerActiveDay: 50, racesPerActiveDay: 0 });
    // C: 4 Nov with 2 races; D: 12 Nov with none -> 1 race per active day
    expect(other).toMatchObject({ activeDays: 2, medianSpentPerActiveDay: 0, racesPerActiveDay: 1 });
    expect(crypto.usdg).toEqual({ actions: 0, testnetOrders: 0, mainnetOrders: 0 });
    expect(other.usdg).toBeNull();
  });
});
