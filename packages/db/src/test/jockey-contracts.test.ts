import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { accounts, fraudEvents, inboxItems, jockeyContracts, jockeyOffers, jockeyRides, jockeys, newsItems, races } from "../schema";
import { recordAccountSignal } from "../services/accounts";
import { activeContractOf, developmentTx, jockeyMarketInfo, makeJockeyOffer, transferWindow, withdrawJockeyOffer } from "../services/jockeyContracts";
import { createJockeyTx, runJockeyMaintenance, signJockey, stableJockeys } from "../services/jockeys";
import { getBalance, spendCredits } from "../services/ledger";
import { createRace } from "../services/races";
import { runTx } from "../services/tx";
import { T0, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
  await runJockeyMaintenance(h.db, T0);
});
afterAll(async () => {
  await h.close();
});

const W = gc.weekIndex(T0.getTime());
const mon = (k: number, plusMs = 60_000) => new Date(gc.weekStartMs(W + k) + plusMs);
const deadline = (k: number) => new Date(gc.windowDeadlineMs(W + k) + 60_000);
let n = 0;

/** An unsigned Club jockey of a grade (not a free agent unless `week` given). */
async function clubJockey(grade: gc.JockeyGrade = "C", opts: { week?: number; personality?: gc.JockeyPersonality } = {}) {
  const v = { A: 850, B: 650, C: 500, D: 350, E: 150 }[grade];
  const j = await createJockeyTx(h.db, { seed: gc.seedFrom("contracts-test", ++n), stableId: null, now: T0 });
  const skills = { gate: v, pace: v, finish: v, handling: v };
  await h.db
    .update(jockeys)
    .set({ skills, potential: skills, wins: 60, rides: 300, stage: "prime", freeAgentWeek: opts.week ?? null, ...(opts.personality ? { personality: opts.personality } : {}) })
    .where(eq(jockeys.id, j.id));
  return j.id;
}

const terms = (wage: number, extra: Partial<gc.OfferTerms> = {}): gc.OfferTerms => ({ wage, length: "4w", promisedRides: 2, buyout: 2_000, ...extra });
/** Keeps stables from counting as idle (idle 21 days releases their jockeys). */
const seen = async (ids: string[], t: Date) => {
  for (const id of ids) await h.db.update(accounts).set({ lastSeenAt: t }).where(eq(accounts.id, id));
};
const notesOf = async (accountId: string) => (await h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, "jockey")))).map((i) => i.title);

describe("contracts", () => {
  it("a new stable's apprentice has a wage-free first contract; Phase 1 signings migrate to 4 weeks at the grade's wage", async () => {
    const p = await newPlayer(h.db, { now: T0 });
    const [app] = await stableJockeys(h.db, p.stableId);
    const c = (await activeContractOf(h.db, app!.id))!;
    expect(c).toMatchObject({ length: "4w", startWeek: W, endsWeek: W + 4, promisedRides: gc.JOCKEY_DEFAULT_PROMISED_RIDES, wageFreeUntilWeek: W + 1 + gc.JOCKEY_APPRENTICE_FREE_WEEKS });
    expect(gc.wageDue(c, W + 4)).toBe(0);

    // A Phase 1 signing (held, no contract) gets one from the maintenance backfill.
    const j = await clubJockey("B");
    await h.db.update(jockeys).set({ stableId: p.stableId, joinedAt: T0 }).where(eq(jockeys.id, j));
    await h.db.delete(jockeyContracts).where(eq(jockeyContracts.jockeyId, app!.id));
    const m = await runJockeyMaintenance(h.db, new Date(T0.getTime() + 1000));
    expect(m.contractsBackfilled).toBe(2);
    expect(await activeContractOf(h.db, j)).toMatchObject({ length: "4w", wage: gc.JOCKEY_WAGE.B, promisedRides: 2, wageFreeUntilWeek: null, endsWeek: W + 4 });
    expect((await activeContractOf(h.db, app!.id))!.wageFreeUntilWeek).toBe(W + 1 + gc.JOCKEY_APPRENTICE_FREE_WEEKS);
    expect((await runJockeyMaintenance(h.db, new Date(T0.getTime() + 2000))).contractsBackfilled).toBe(0);
  });

  it("charges wages weekly (burned) and, when the stable can't pay, waives the debt and lets the jockey go at the window", async () => {
    const p = await newPlayer(h.db, { credits: 5_000, now: T0 });
    const j = await clubJockey("C");
    const signed = await signJockey(h.db, { accountId: p.accountId, jockeyId: j, now: T0 });
    expect(signed.fee).toBe(gc.JOCKEY_SIGNING_FEE.C);
    const before = await getBalance(h.db, p.accountId);
    const m1 = await runJockeyMaintenance(h.db, mon(1));
    expect(m1.week?.contracts.wagesPaid).toBeGreaterThanOrEqual(gc.JOCKEY_WAGE.C);
    // The apprentice is wage-free; the signed C-grade jockey costs its wage.
    expect(before - (await getBalance(h.db, p.accountId))).toBe(gc.JOCKEY_WAGE.C);
    expect((await activeContractOf(h.db, j))!.wagesPaid).toBe(gc.JOCKEY_WAGE.C);
    // Idempotent within the week.
    await runJockeyMaintenance(h.db, mon(1, 3_600_000));
    expect(before - (await getBalance(h.db, p.accountId))).toBe(gc.JOCKEY_WAGE.C);

    // Broke: the wage isn't paid, the balance never goes negative, the jockey is a free agent this week.
    await spendCredits(h.db, { accountId: p.accountId, amount: await getBalance(h.db, p.accountId), idempotencyKey: `drain:${p.accountId}`, kind: "adjustment" });
    await runJockeyMaintenance(h.db, mon(2));
    expect(await getBalance(h.db, p.accountId)).toBe(0);
    const c = (await activeContractOf(h.db, j))!;
    expect(c.unpaidWeek).toBe(W + 2);
    const [row] = await h.db.select().from(jockeys).where(eq(jockeys.id, j));
    expect(row!.freeAgentWeek).toBe(W + 2);
    expect((await notesOf(p.accountId)).some((t) => t.includes("couldn't pay"))).toBe(true);
    // The window: no offers, back to the Club pool; the contract ends "unpaid".
    const m = await runJockeyMaintenance(h.db, deadline(2));
    expect(m.windows.map((w) => w.week)).toContain(W + 2);
    const [after] = await h.db.select().from(jockeys).where(eq(jockeys.id, j));
    expect(after!.stableId).toBeNull();
    expect(after!.freeAgentWeek).toBeNull();
    const [ended] = await h.db.select().from(jockeyContracts).where(eq(jockeyContracts.jockeyId, j));
    expect(ended).toMatchObject({ status: "ended", endedWhy: "unpaid" });
    expect(await getBalance(h.db, p.accountId)).toBe(0);
  });
});

describe("the transfer window", () => {
  it("offers escrow the signing fee; the jockey takes the best by its utility; losers are refunded; idempotent", async () => {
    await runJockeyMaintenance(h.db, mon(3));
    const a = await newPlayer(h.db, { credits: 20_000, now: mon(3) });
    const b = await newPlayer(h.db, { credits: 20_000, now: mon(3) });
    const x = await clubJockey("C", { week: W + 3, personality: "money" });
    const t = mon(3, 3_600_000);
    // Not a free agent: can't receive offers; a free agent can't be signed directly.
    const notAgent = await clubJockey("C");
    await expect(makeJockeyOffer(h.db, { accountId: a.accountId, jockeyId: notAgent, now: t, terms: terms(250) })).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });
    await expect(signJockey(h.db, { accountId: a.accountId, jockeyId: x, now: t })).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });
    // Terms out of bounds.
    await expect(makeJockeyOffer(h.db, { accountId: a.accountId, jockeyId: x, now: t, terms: terms(5) })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await makeJockeyOffer(h.db, { accountId: a.accountId, jockeyId: x, now: t, terms: terms(300) });
    await makeJockeyOffer(h.db, { accountId: b.accountId, jockeyId: x, now: t, terms: terms(260) });
    const fee = gc.JOCKEY_SIGNING_FEE.C;
    expect(await getBalance(h.db, a.accountId)).toBe(20_000 - fee);
    // Amending replaces the terms without a second escrow.
    await makeJockeyOffer(h.db, { accountId: a.accountId, jockeyId: x, now: t, terms: terms(600, { length: "8w" }) });
    expect(await getBalance(h.db, a.accountId)).toBe(20_000 - fee);
    // Withdraw and re-offer.
    await withdrawJockeyOffer(h.db, { accountId: b.accountId, jockeyId: x, now: t });
    expect(await getBalance(h.db, b.accountId)).toBe(20_000);
    await makeJockeyOffer(h.db, { accountId: b.accountId, jockeyId: x, now: new Date(t.getTime() + 1000), terms: terms(260) });
    expect(await getBalance(h.db, b.accountId)).toBe(20_000 - fee);

    const view = await transferWindow(h.db, { stableId: a.stableId, now: t });
    expect(view.freeAgents.find((f) => f.jockey.id === x)).toMatchObject({ offers: 2 });
    expect(view.myOffers.some((o) => o.jockeyId === x && o.status === "open")).toBe(true);
    expect(view.commitment).toMatch(/^[0-9a-f]{64}$/);
    const info = (await jockeyMarketInfo(h.db, x, { stableId: a.stableId, accountId: a.accountId }, t))!;
    expect(info.freeAgent).toBe(true);
    expect(info.myOffer).toMatchObject({ wage: 600, length: "8w" });
    expect(info.wants.length).toBeGreaterThan(0);

    const m = await runJockeyMaintenance(h.db, deadline(3));
    const w = m.windows.find((r) => r.week === W + 3)!;
    expect(w.signings.find((s) => s.jockeyId === x)).toMatchObject({ toStableId: a.stableId, wage: 600 });
    const [row] = await h.db.select().from(jockeys).where(eq(jockeys.id, x));
    expect(row).toMatchObject({ stableId: a.stableId, freeAgentWeek: null });
    expect(await activeContractOf(h.db, x)).toMatchObject({ stableId: a.stableId, wage: 600, length: "8w", startWeek: W + 3, endsWeek: W + 11 });
    // Winner's fee burned; loser refunded.
    expect(await getBalance(h.db, a.accountId)).toBe(20_000 - fee);
    expect(await getBalance(h.db, b.accountId)).toBe(20_000);
    const offers = await h.db.select().from(jockeyOffers).where(eq(jockeyOffers.jockeyId, x));
    expect(offers.map((o) => o.status).sort()).toEqual(["lost", "won"]);
    // Published: news, notes to both sides.
    expect(await h.db.select().from(newsItems).where(and(eq(newsItems.kind, "jockey_signed"), eq(newsItems.jockeyId, x)))).toHaveLength(1);
    expect((await notesOf(a.accountId)).some((s) => s.includes("signs for you"))).toBe(true);
    expect((await notesOf(b.accountId)).some((s) => s.includes("chose"))).toBe(true);
    // Idempotent: a second run after the deadline closes nothing more.
    expect((await runJockeyMaintenance(h.db, new Date(deadline(3).getTime() + 60_000))).windows).toEqual([]);
    expect((await transferWindow(h.db, { stableId: a.stableId, now: deadline(3) })).last?.week).toBe(W + 3);
  });

  it("at most 3 open offers and 3 jockeys per stable", async () => {
    await runJockeyMaintenance(h.db, mon(4));
    const t = mon(4, 3_600_000);
    const s = await newPlayer(h.db, { credits: 50_000, now: t });
    const agents = [];
    for (let i = 0; i < 4; i++) agents.push(await clubJockey("D", { week: W + 4 }));
    for (let i = 0; i < 3; i++) await makeJockeyOffer(h.db, { accountId: s.accountId, jockeyId: agents[i]!, now: t, terms: terms(150, { buyout: 1_000 }) });
    await expect(makeJockeyOffer(h.db, { accountId: s.accountId, jockeyId: agents[3]!, now: t, terms: terms(150, { buyout: 1_000 }) })).rejects.toMatchObject({ code: "JOCKEY_LIMIT" });
    // A stable holding 3 (staying past the window) can't make offers.
    const full = await newPlayer(h.db, { credits: 50_000, now: t });
    await signJockey(h.db, { accountId: full.accountId, jockeyId: await clubJockey("E"), now: t });
    await signJockey(h.db, { accountId: full.accountId, jockeyId: await clubJockey("E"), now: t });
    expect(await stableJockeys(h.db, full.stableId)).toHaveLength(3);
    await expect(makeJockeyOffer(h.db, { accountId: full.accountId, jockeyId: agents[3]!, now: t, terms: terms(150, { buyout: 1_000 }) })).rejects.toMatchObject({ code: "JOCKEY_LIMIT" });
    // Three offers win three places at most (the stable had 1 apprentice: 2 places left).
    const m = await runJockeyMaintenance(h.db, deadline(4));
    const won = m.windows.find((r) => r.week === W + 4)!.signings.filter((x) => x.toStableId === s.stableId);
    expect(won).toHaveLength(2);
    expect(await stableJockeys(h.db, s.stableId)).toHaveLength(3);
    expect(await getBalance(h.db, s.accountId)).toBe(50_000 - 2 * gc.JOCKEY_SIGNING_FEE.D);
  });

  it("two weeks of broken promises: the jockey walks out at the window and won't re-sign", async () => {
    const p = await newPlayer(h.db, { credits: 20_000, now: mon(4) });
    const q = await newPlayer(h.db, { credits: 20_000, now: mon(4) });
    const j = await clubJockey("C", { personality: "workhorse" });
    await signJockey(h.db, { accountId: p.accountId, jockeyId: j, now: mon(4), terms: terms(250, { promisedRides: 3, length: "8w" }) });
    await runJockeyMaintenance(h.db, mon(5));
    await seen([p.accountId, q.accountId], mon(6));
    await runJockeyMaintenance(h.db, mon(6));
    expect((await activeContractOf(h.db, j))!.brokenWeeks).toBe(1);
    const info = (await jockeyMarketInfo(h.db, j, null, mon(6, 1000)))!;
    expect(info.contract?.morale).toBe("unsettled");
    expect(info.wants).toContain("more rides");
    const m7 = await runJockeyMaintenance(h.db, mon(7));
    expect(m7.week?.contracts.walkouts).toBeGreaterThanOrEqual(1);
    const t = mon(7, 3_600_000);
    expect((await jockeyMarketInfo(h.db, j, null, t))!.contract?.morale).toBe("wants_out");
    await expect(makeJockeyOffer(h.db, { accountId: p.accountId, jockeyId: j, now: t, terms: terms(500) })).rejects.toMatchObject({ code: "JOCKEY_UNAVAILABLE" });
    await makeJockeyOffer(h.db, { accountId: q.accountId, jockeyId: j, now: t, terms: terms(250, { promisedRides: 5 }) });
    await seen([p.accountId, q.accountId], deadline(7));
    const m = await runJockeyMaintenance(h.db, deadline(7));
    const w = m.windows.find((r) => r.week === W + 7)!;
    expect(w.walkouts).toBeGreaterThanOrEqual(1);
    expect(w.signings.find((s) => s.jockeyId === j)).toMatchObject({ fromStableId: p.stableId, toStableId: q.stableId });
    const old = await h.db.select().from(jockeyContracts).where(and(eq(jockeyContracts.jockeyId, j), eq(jockeyContracts.stableId, p.stableId)));
    expect(old[0]).toMatchObject({ status: "ended", endedWhy: "walked_out" });
  });

  it("contract-end notes two weeks and one week ahead", async () => {
    const p = await newPlayer(h.db, { credits: 20_000, now: mon(7, 7_200_000) });
    const j = await clubJockey("E");
    await signJockey(h.db, { accountId: p.accountId, jockeyId: j, now: mon(7, 7_200_000), terms: terms(100, { promisedRides: 0, buyout: 500 }) });
    expect((await activeContractOf(h.db, j))!.endsWeek).toBe(W + 11);
    await seen([p.accountId], mon(10));
    await runJockeyMaintenance(h.db, mon(10));
    await runJockeyMaintenance(h.db, mon(11));
    const notes = await notesOf(p.accountId);
    expect(notes.some((t) => t.includes("contract ends a week on Sunday"))).toBe(true);
    expect(notes.some((t) => t.includes("contract ends Sunday. Offer"))).toBe(true);
    const [row] = await h.db.select().from(jockeys).where(eq(jockeys.id, j));
    expect(row!.freeAgentWeek).toBe(W + 11);
    // Re-signing with your own jockey costs no fee and keeps the jockey.
    const before = await getBalance(h.db, p.accountId);
    await makeJockeyOffer(h.db, { accountId: p.accountId, jockeyId: j, now: mon(11, 3_600_000), terms: terms(100, { promisedRides: 0, buyout: 500 }) });
    expect(await getBalance(h.db, p.accountId)).toBe(before);
    await runJockeyMaintenance(h.db, deadline(11));
    expect(await activeContractOf(h.db, j)).toMatchObject({ stableId: p.stableId, startWeek: W + 11 });
  });

  it("linked accounts can't make offers for each other's jockeys", async () => {
    const t = mon(11, 7_200_000);
    const a = await newPlayer(h.db, { credits: 20_000, now: t });
    const b = await newPlayer(h.db, { credits: 20_000, now: t });
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "wallet", value: "0xcontractlink" });
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "wallet", value: "0xcontractlink" });
    const [app] = await stableJockeys(h.db, a.stableId);
    // a's jockey becomes a free agent (contract ending this week).
    await h.db.update(jockeys).set({ freeAgentWeek: W + 12 }).where(eq(jockeys.id, app!.id));
    await expect(makeJockeyOffer(h.db, { accountId: b.accountId, jockeyId: app!.id, now: mon(12, 3_600_000), terms: terms(100, { buyout: 500 }) })).rejects.toMatchObject({ code: "LINKED_ACCOUNTS" });
    expect(await h.db.select().from(fraudEvents).where(and(eq(fraudEvents.accountId, b.accountId), eq(fraudEvents.kind, "linked_trade_blocked")))).toHaveLength(1);
  });
});

describe("development", () => {
  it("an apprentice with 25 rides at a stable is developed there; a Feature win for another stable pays the developer", async () => {
    const dev = await newPlayer(h.db, { credits: 0, now: T0 });
    const other = await newPlayer(h.db, { credits: 0, now: T0 });
    const [app] = await stableJockeys(h.db, dev.stableId);
    const horse = await makeHorse(h.db, dev.stableId, { rating: 60 });
    for (let i = 0; i < gc.JOCKEY_DEVELOPED_RIDES; i++) {
      const r = await createRace(h.db, { kind: "scheduled", name: `Dev ${i}`, raceClass: "handicap", conditions: { minRating: 0, maxRating: 140, distanceM: 1600, surface: "turf", going: "good" }, postTime: new Date(T0.getTime() - (i + 1) * 3_600_000), entriesCloseAt: new Date(T0.getTime() - (i + 1) * 3_600_000 - 60_000), purse: 1_000, maxRunners: 12, targetRunners: 6 });
      await h.db.insert(jockeyRides).values({ jockeyId: app!.id, raceId: r.id, horseId: horse.id, stableId: dev.stableId, jockeyStableId: dev.stableId, postTime: r.postTime, position: 3, settledAt: T0 });
    }
    const feature = await createRace(h.db, { kind: "feature", name: "The Weekend Feature", raceClass: "listed", conditions: { minRating: 0, maxRating: 140, distanceM: 1600, surface: "turf", going: "good" }, postTime: T0, entriesCloseAt: T0, purse: 10_000, maxRunners: 12, targetRunners: 6 });
    const [raceRow] = await h.db.select().from(races).where(eq(races.id, feature.id));
    const load = async () => (await h.db.select().from(jockeys).where(eq(jockeys.id, app!.id)))[0]!;
    // A win for the developing stable itself pays nothing, but marks the development.
    const before = await load();
    await runTx(h.db, (tx) => developmentTx(tx, { jockey: before, race: raceRow!, horseStableId: dev.stableId, jockeyStableId: dev.stableId, position: 1, now: T0 }));
    expect((await load()).developedByStableId).toBe(dev.stableId);
    expect(await getBalance(h.db, dev.accountId)).toBe(0);
    // Now riding for another stable: a Feature win pays the developer, once.
    await h.db.update(jockeys).set({ stableId: other.stableId }).where(eq(jockeys.id, app!.id));
    const pay = async () => {
      const jr = await load();
      return runTx(h.db, (tx) => developmentTx(tx, { jockey: jr, race: raceRow!, horseStableId: other.stableId, jockeyStableId: other.stableId, position: 1, now: T0 }));
    };
    expect(await pay()).toBe(gc.JOCKEY_DEVELOPMENT_BONUS);
    expect(await pay()).toBe(0);
    expect(await getBalance(h.db, dev.accountId)).toBe(gc.JOCKEY_DEVELOPMENT_BONUS);
    expect((await jockeyMarketInfo(h.db, app!.id, null, T0))!.developedAt?.stableId).toBe(dev.stableId);
  });
});
