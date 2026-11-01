/**
 * Credit notes (services/creditNotes.ts): every credit movement becomes a bell note with the
 * amount, the reason and the balance; one note per action; no spoilers from a prize; never
 * doubled on a retry; a switch of its own, bell only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { inboxItems, ledgerTransactions, raceEntries, raceResults, races } from "../schema";
import { grantCredits, getBalance, playerLedgerAccountId, post, spendCredits, systemAccountId } from "../services/ledger";
import { createRace } from "../services/races";
import { notify, BELL_ONLY_CATEGORIES, CATEGORY_KEYS, isPushCategory, listNotifications, setNotificationPrefs, unreadNotificationCount } from "../services/notifications";
import { markInboxRead, listInbox } from "../services/player";
import { KIND_CATEGORIES, cardEntryFee } from "../index";
import { CREDIT_BATCH_MS, creditNoteTitle, creditReason, creditsSince, syncCreditNotes } from "../services/creditNotes";
import { MIN, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const NOW = new Date("2026-11-04T12:00:00.000Z");
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** Pins a ledger transaction's time (the batching key) for the test: the ledger is append-only, so its guard steps aside for this one write. */
async function at(key: string, when: Date) {
  await h.db.execute("alter table ledger_transactions disable trigger ledger_transactions_append_only");
  try {
    await h.db.update(ledgerTransactions).set({ createdAt: when }).where(eq(ledgerTransactions.idempotencyKey, key));
  } finally {
    await h.db.execute("alter table ledger_transactions enable trigger ledger_transactions_append_only");
  }
}
async function notes(accountId: string) {
  return h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "credits"))).orderBy(inboxItems.createdAt);
}
async function fresh(credits = 3_000) {
  const p = await newPlayer(h.db, { credits, now: ago(3 * 24 * HOUR) });
  await at(`starter-grant:${p.accountId}`, ago(3 * 24 * HOUR));
  return p;
}

describe("credit notes", () => {
  it("words every ledger kind in plain words (no kind falls through to its code name)", () => {
    for (const kind of Object.keys(KIND_CATEGORIES)) {
      if (kind.startsWith("usdg_practice")) continue; // T-USDG: another currency, never noted
      for (const amount of [40, -40]) {
        const r = creditReason({ transactionId: "t", kind, amount, at: 0, memo: null, horseName: "Lucky Penny" });
        expect(r, kind).not.toBe(kind.replace(/_/g, " "));
        expect(r.length, kind).toBeGreaterThan(3);
      }
    }
  });

  it("one note per movement: amount, reason and the balance after it, linking to Finances", async () => {
    const p = await fresh();
    const horse = await makeHorse(h.db, p.stableId, { name: "Lucky Penny" });
    await spendCredits(h.db, { accountId: p.accountId, amount: 90, idempotencyKey: `training:${horse.id}:1:0`, kind: "training", memo: "Speed work" });
    await at(`training:${horse.id}:1:0`, ago(3 * HOUR));
    await grantCredits(h.db, { accountId: p.accountId, amount: 80, idempotencyKey: `daily-cup:1:${p.accountId}`, kind: "daily_cup", memo: "Daily Cup participation" });
    await at(`daily-cup:1:${p.accountId}`, ago(2 * HOUR));
    expect(await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW })).toBe(2);
    const n = await notes(p.accountId);
    expect(n.map((x) => x.title)).toEqual(["−90 credits: Speed work for Lucky Penny · balance 2,910", "+80 credits: Daily Cup run · balance 2,990"]);
    expect((n[0]!.data as { href: string }).href).toBe("/stable/finances?highlight=training#cat-training");
    expect((n[1]!.data as { balance: number }).balance).toBe(await getBalance(h.db, p.accountId));
    // Not on the Estate's race list: bell only.
    expect((await listInbox(h.db, p.accountId, 40)).some((i) => i.kind === "credits")).toBe(false);
  });

  it("batches one action into one note ('+120 credits from 2 daily goals')", async () => {
    const p = await fresh();
    for (const g of ["race", "care"]) {
      await grantCredits(h.db, { accountId: p.accountId, amount: 60, idempotencyKey: `daily-goal:${p.accountId}:2026-11-04:${g}`, kind: "daily_goal" });
      await at(`daily-goal:${p.accountId}:2026-11-04:${g}`, new Date(ago(HOUR).getTime() + (g === "care" ? CREDIT_BATCH_MS / 2 : 0)));
    }
    await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW });
    const n = await notes(p.accountId);
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("+120 credits from 2 daily goals · balance 3,120");
    // An entry with its extras and jockey is one note too.
    const horse = await makeHorse(h.db, p.stableId, { name: "Velvet Falcon" });
    const raceId = "11111111-1111-4111-8111-111111111111";
    for (const [k, kind, amt] of [
      [`entry-fee:${raceId}:${horse.id}`, "entry_fee", 50],
      [`race-extras:${raceId}:${horse.id}`, "race_extras", 30],
      [`jockey-fee:${raceId}:${horse.id}`, "jockey_fee", 20],
    ] as const) {
      await spendCredits(h.db, { accountId: p.accountId, amount: amt, idempotencyKey: k, kind });
      await at(k, ago(30 * MIN));
    }
    await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW });
    const after = await notes(p.accountId);
    expect(after).toHaveLength(2);
    expect(after[1]!.title).toBe("−100 credits: Entry fee, race-day extras and jockey fee for Velvet Falcon · balance 3,020");
  });

  it("never doubles a note on a retry or two reads at once, and notes a late movement once", async () => {
    const p = await fresh();
    await grantCredits(h.db, { accountId: p.accountId, amount: 60, idempotencyKey: `stable-step:${p.accountId}:care`, kind: "stable_step" });
    await at(`stable-step:${p.accountId}:care`, ago(HOUR));
    await Promise.all([syncCreditNotes(h.db, { accountId: p.accountId, now: NOW }), syncCreditNotes(h.db, { accountId: p.accountId, now: NOW })]);
    expect(await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW })).toBe(0);
    expect(await notes(p.accountId)).toHaveLength(1);
    // A transaction that committed with an earlier time than the last note still gets its own note, once.
    await spendCredits(h.db, { accountId: p.accountId, amount: 25, idempotencyKey: `vet:late`, kind: "vet" });
    await at(`vet:late`, ago(HOUR + 10 * MIN));
    expect(await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW })).toBe(1);
    expect(await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW })).toBe(0);
    expect(await notes(p.accountId)).toHaveLength(2);
  });

  it("a prize waits for the broadcast, then names no place until the finish is watched", async () => {
    const p = await fresh();
    const other = await fresh();
    const horse = await makeHorse(h.db, p.stableId, { name: "Velvet Comet" });
    const rival = await makeHorse(h.db, other.stableId);
    const post0 = new Date("2026-11-04T11:59:30.000Z");
    const race = await createRace(h.db, { kind: "scheduled", name: "Bellmont Handicap", raceClass: "handicap", conditions: { distanceM: 1400 }, postTime: post0, entriesCloseAt: ago(3 * MIN) });
    await h.db.update(races).set({ status: "settled", settledAt: post0 }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values([
      { raceId: race.id, horseId: rival.id, stableId: other.stableId, tactic: "front", snapshot: {}, ratingBefore: 50, finishPosition: 1, prize: 600 },
      { raceId: race.id, horseId: horse.id, stableId: p.stableId, tactic: "front", snapshot: {}, ratingBefore: 50, finishPosition: 2, prize: 400 },
    ]);
    await h.db.insert(raceResults).values({ raceId: race.id, seedCommitment: "c", seedReveal: "s", resultHash: "r", result: { finishOrder: [{ horseId: rival.id, position: 1, finishTimeUs: 85_000_000 }, { horseId: horse.id, position: 2, finishTimeUs: 85_300_000 }] } });
    const mint = await systemAccountId(h.db, "mint");
    await post(h.db, { idempotencyKey: `purse:${race.id}`, kind: "purse", meta: { raceId: race.id }, postings: [{ ledgerAccountId: mint, amount: -1000 }, { ledgerAccountId: await playerLedgerAccountId(h.db, p.accountId), amount: 400 }, { ledgerAccountId: await playerLedgerAccountId(h.db, other.accountId), amount: 600 }] });
    await at(`purse:${race.id}`, post0);
    await notify(h.db, { accountId: p.accountId, kind: "race_result", dedupeKey: `race:${race.id}:${horse.id}`, title: "Finished 2nd", raceId: race.id, horseId: horse.id, now: post0 });

    // Thirty seconds after the off the broadcast is still on: no note yet.
    expect(await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW })).toBe(0);
    const later = new Date(NOW.getTime() + 10 * MIN);
    expect(await syncCreditNotes(h.db, { accountId: p.accountId, now: later })).toBe(1);
    const [bell] = (await listNotifications(h.db, { accountId: p.accountId, now: later })).filter((x) => x.kind === "credits");
    expect(bell!.title).toBe("+400 credits: Prize from the 11:59 Bellmont Handicap (watch the finish) · balance 3,400");
    expect(bell!.title).not.toMatch(/2nd|Velvet/);
    // Watched: the place shows.
    await markInboxRead(h.db, { accountId: p.accountId, raceId: race.id, now: later });
    const [seen] = (await listNotifications(h.db, { accountId: p.accountId, now: later })).filter((x) => x.kind === "credits");
    expect(seen!.title).toBe("+400 credits: Velvet Comet 2nd in the 11:59 Bellmont Handicap · balance 3,400");
    // The away summary's credits leave an unwatched prize out entirely.
    const moved = await creditsSince(h.db, { accountId: other.accountId, from: ago(HOUR), now: later, hideRaceIds: new Set([race.id]) });
    expect(moved).toMatchObject({ net: 0, prizes: 0 });
    expect(await creditsSince(h.db, { accountId: other.accountId, from: ago(HOUR), now: later })).toMatchObject({ net: 600, prizes: 1 });
  });

  it("has its own switch (on by default) and stays in the bell: never a push", async () => {
    expect(CATEGORY_KEYS).toContain("credits");
    expect(BELL_ONLY_CATEGORIES).toEqual(["credits"]);
    expect(isPushCategory("credits")).toBe(false);
    expect(isPushCategory("races")).toBe(true);
    const p = await fresh();
    await grantCredits(h.db, { accountId: p.accountId, amount: 60, idempotencyKey: `daily-goal:${p.accountId}:x:race`, kind: "daily_goal" });
    await at(`daily-goal:${p.accountId}:x:race`, ago(HOUR));
    await syncCreditNotes(h.db, { accountId: p.accountId, now: NOW });
    expect((await listNotifications(h.db, { accountId: p.accountId, now: NOW })).some((x) => x.kind === "credits")).toBe(true);
    const before = await unreadNotificationCount(h.db, { accountId: p.accountId, now: NOW });
    await setNotificationPrefs(h.db, { accountId: p.accountId, disabled: ["credits"], now: NOW });
    expect((await listNotifications(h.db, { accountId: p.accountId, now: NOW })).some((x) => x.kind === "credits")).toBe(false);
    expect(await unreadNotificationCount(h.db, { accountId: p.accountId, now: NOW })).toBe(before - 1);
    // ...but the full inbox still keeps it.
    expect((await listNotifications(h.db, { accountId: p.accountId, now: NOW, all: true })).find((x) => x.kind === "credits")?.muted).toBe(true);
  });

  it("titles a sale, a release and a refund the way a player reads them", () => {
    const m = (kind: string, amount: number, memo: string | null = null) => ({ transactionId: "t", kind, amount, at: 0, memo, horseName: "Lucky Penny" });
    expect(creditNoteTitle([m("market_sale", 1_200)], 4_000)).toBe("+1,200 credits: Lucky Penny sold · balance 4,000");
    expect(creditNoteTitle([m("adjustment", 100, "released to the Club")], 900)).toBe("+100 credits: Lucky Penny released to the Club · balance 900");
    expect(creditNoteTitle([m("entry_fee_refund", 50)], 950)).toBe("+50 credits: Entry fee refunded for Lucky Penny · balance 950");
  });
});

describe("the low-credit line", () => {
  it("is about a Live entry and a session of training, and the cheapest entry matches the card", () => {
    expect(gc.CHEAPEST_LIVE_ENTRY_FEE).toBe(cardEntryFee("maiden", { purse: 1_000 }));
    expect(gc.CHEAPEST_TRAINING_SESSION).toBe(Math.min(...Object.values(gc.WORKOUTS).map((w) => w.cost).filter((c) => c > 0)));
    expect(gc.LOW_CREDITS_LINE).toBe(gc.CHEAPEST_LIVE_ENTRY_FEE + gc.CHEAPEST_TRAINING_SESSION);
    expect(gc.lowCreditsAfter(130, 90)).toBe(40);
    expect(gc.lowCreditsAfter(1_000, 90)).toBeNull();
    expect(gc.lowCreditsAfter(50, 90)).toBeNull(); // can't afford it: the button says so already
    expect(gc.lowCreditsAfter(500, 0)).toBeNull();
  });
});

