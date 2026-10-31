/**
 * The finances view (services/finances.ts): every ledger kind is mapped to a category (a
 * scan of the services fails when a new kind appears without a mapping), period bounds are
 * the UTC Monday week, and the per-horse sheet attributes postings to the right horse —
 * including a horse that was sold and one that raced for another stable on lease.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { ledgerPostings, ledgerTransactions } from "../schema";
import type { Db } from "../index";
import { breed } from "../services/breeding";
import { grantCredits, playerLedgerAccountId, systemAccountId } from "../services/ledger";
import { buyListing, listHorse } from "../services/market";
import { pullPack } from "../services/packs";
import { createRace, enterRace, getRaceForSimulation, settleRace, type CreateRaceInput, type RunnerOutcome } from "../services/races";
import { setStudFee, setTrainingPlan } from "../services/horses";
import { offerLease, takeLease } from "../services/leasing";
import { runTx } from "../services/tx";
import { settleUpkeep } from "../services/upkeep";
import { FINANCE_PERIODS, KIND_CATEGORIES, financePeriodBounds, stableFinances } from "../services/finances";
import { accounts, raceEntries, races } from "../schema";
import { eq } from "drizzle-orm";
import { at, DAY, floorPrice, makeHorse, makeSeller, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

// ---------------------------------------------------------------------------
// Posting straight into the ledger at an exact time. The ledger is append-only and post()
// has no timestamp input, so backdating a posting for the period tests has to happen at
// insert time (one transaction for both postings: the balanced-sum check is deferred).
// ---------------------------------------------------------------------------

let posted = 0;
async function postAt(db: Db, accountId: string, kind: string, amount: number, createdAt: Date): Promise<void> {
  await runTx(db, async (tx) => {
    const [t] = await tx
      .insert(ledgerTransactions)
      .values({ idempotencyKey: `finances-test:${++posted}`, kind, createdAt })
      .returning();
    const player = await playerLedgerAccountId(tx, accountId);
    const counter = await systemAccountId(tx, amount > 0 ? "mint" : "burn");
    const mag = Math.abs(amount);
    await tx.insert(ledgerPostings).values([
      { transactionId: t!.id, ledgerAccountId: amount > 0 ? counter : player, amount: -mag, createdAt },
      { transactionId: t!.id, ledgerAccountId: amount > 0 ? player : counter, amount: mag, createdAt },
    ]);
  });
}

/**
 * Reads run ahead of the fixture clock: the ledger rows get wall-clock timestamps (before
 * T0), while races and upkeep settle at T0-based times, so "now" has to cover both.
 */
const FIN_NOW = () => at(8 * DAY);

// ---------------------------------------------------------------------------
// 1. Period boundaries
// ---------------------------------------------------------------------------

describe("finances: periods", () => {
  it("bounds: UTC Monday weeks, the season, and all time", () => {
    const wednesday = new Date("2026-11-04T15:30:00Z");
    const thisWeek = financePeriodBounds("this_week", wednesday);
    expect(thisWeek.from).toEqual(new Date("2026-11-02T00:00:00Z"));
    expect(thisWeek.to).toEqual(new Date("2026-11-09T00:00:00Z"));
    const lastWeek = financePeriodBounds("last_week", wednesday);
    expect(lastWeek.from).toEqual(new Date("2026-10-26T00:00:00Z"));
    expect(lastWeek.to).toEqual(new Date("2026-11-02T00:00:00Z"));
    const season = financePeriodBounds("season", wednesday);
    expect(season.from!.getUTCDay()).toBe(1);
    expect(season.to.getTime() - season.from!.getTime()).toBe(28 * DAY);
    expect(season.from!.getTime()).toBeLessThanOrEqual(wednesday.getTime());
    expect(FINANCE_PERIODS).toContain("all_time");
    expect(financePeriodBounds("all_time", wednesday).from).toBeNull();
  });

  it("this week: Monday 00:00 UTC inclusive, next Monday exclusive; balances bracket the period", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const now = new Date("2026-10-31T12:00:00Z"); // Saturday
    // Balances never go below zero (a ledger-accounts check), so the week starts with a grant.
    await postAt(h.db, p.accountId, "story_reward", 1000, new Date("2026-10-24T09:00:00Z"));
    await postAt(h.db, p.accountId, "upkeep", -100, new Date("2026-10-25T23:59:00Z")); // last week
    await postAt(h.db, p.accountId, "daily_goal", 45, new Date("2026-10-26T00:00:00Z")); // the boundary itself
    await postAt(h.db, p.accountId, "upkeep", -300, new Date("2026-10-28T09:00:00Z")); // this week
    await postAt(h.db, p.accountId, "daily_goal", 45, new Date("2026-11-02T00:00:00Z")); // next week

    const tw = await stableFinances(h.db, { stableId: p.stableId, period: "this_week", now });
    expect(tw.income).toBe(45);
    expect(tw.spend).toBe(300);
    expect(tw.net).toBe(-255);
    expect(tw.balanceAtStart).toBe(900); // the grant and last week's posting, not this period
    expect(tw.balanceAtEnd).toBe(645);
    expect(tw.balanceAtEnd - tw.balanceAtStart).toBe(tw.net);

    const lw = await stableFinances(h.db, { stableId: p.stableId, period: "last_week", now });
    expect(lw.income).toBe(1000);
    expect(lw.spend).toBe(100);
    expect(lw.net).toBe(900);
    expect(lw.balanceAtStart).toBe(0);
    expect(lw.balanceAtEnd).toBe(900);
  });

  it("the season series is zero-filled Mondays and sums to the season's net", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const now = new Date("2026-10-31T12:00:00Z");
    await postAt(h.db, p.accountId, "purse", 600, new Date("2026-10-14T12:00:00Z"));
    await postAt(h.db, p.accountId, "upkeep", -300, new Date("2026-10-28T12:00:00Z"));
    const fin = await stableFinances(h.db, { stableId: p.stableId, period: "season", now });
    expect(fin.weekly.length).toBe(3); // this season's Mondays, up to the current week
    expect(fin.weekly.map((w) => w.weekStart)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(fin.weekly.map((w) => w.net)).toEqual([600, 0, -300]);
    expect(fin.weekly.reduce((s, w) => s + w.net, 0)).toBe(fin.net);
  });
});

// ---------------------------------------------------------------------------
// 2. Per-horse attribution
// ---------------------------------------------------------------------------

const FULL: gc.RaceDayChoice = { extras: ["soft_shoes", "physio", "vet_check"], jockey: "top" };

let raceN = 0;
function liveRace(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Finances race ${++raceN}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf", going: "soft" },
    postTime: at(10 * MIN),
    entriesCloseAt: at(9 * MIN),
    purse: 16_000,
    entryFee: 120,
    maxRunners: 12,
    targetRunners: 8,
    ...extra,
  });
}

async function runRace(raceId: string, now: Date, first: string[]) {
  const { field } = await getRaceForSimulation(h.db, raceId, now);
  const order = [...first, ...field.runners.map((r) => r.horseId).filter((id) => !first.includes(id))];
  return settleRace(h.db, {
    raceId,
    now,
    resultHash: "0".repeat(64),
    result: { order },
    runners: order.map((horseId, i): RunnerOutcome => ({ horseId, position: i + 1 })),
  });
}

describe("finances: per horse", () => {
  it("attributes training, entry fee, extras, jockey, purses, upkeep, stud fees, packs and sales to the right horse", async () => {
    // The owner trains Racer, wins a Live race with an entry fee and full race-day extras,
    // stands a stallion at stud, buys a pack, sells a horse, and pays upkeep for the week.
    const o = await newPlayer(h.db, { credits: 100_000 });
    await makeSeller(h.db, o.accountId, o.stableId);
    const racer = await makeHorse(h.db, o.stableId, { rating: 90 });
    const stallion = await makeHorse(h.db, o.stableId, { sex: "male", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    const forSale = await makeHorse(h.db, o.stableId);

    // A paid training plan.
    await setTrainingPlan(h.db, { accountId: o.accountId, horseId: racer.id, weekStart: "2026-11-02", plan: { slots: [] }, cost: 300 });

    // A Live race with an entry fee, full extras and a top jockey; the horse wins.
    const race = await liveRace();
    const quote = gc.raceDayQuote(FULL, race.purse);
    await enterRace(h.db, { accountId: o.accountId, raceId: race.id, horseId: racer.id, tactic: "stalker", now: T0, raceDay: FULL });
    const res = await runRace(race.id, at(15 * MIN), [racer.id]);
    const purse = res.prizes[racer.id]!;

    // The stallion covers another stable's mare (the mare's owner pays, ours earns).
    const mareOwner = await newPlayer(h.db, { credits: 20_000 });
    const mare = await makeHorse(h.db, mareOwner.stableId, { sex: "female", careerStatus: "retired", retirementReason: "choice", retiredAt: T0 });
    await setStudFee(h.db, { accountId: o.accountId, horseId: stallion.id, fee: 800 });
    await breed(h.db, { accountId: mareOwner.accountId, sireId: stallion.id, damId: mare.id, now: T0, idempotencyKey: `fin-breed-${raceN}` });
    const fees = gc.breedingFees(800, false);

    // A pack purchase.
    await h.db.execute(`update stables set stall_slots = 24 where id = '${o.stableId}'`);
    const pack = await pullPack(h.db, { accountId: o.accountId, packType: "paddock", idempotencyKey: `fin-pack-${raceN}`, now: T0 });

    // A market sale: the horse leaves the stable, but its sheet stays readable.
    const price = await floorPrice(h.db, forSale.id);
    const listing = await listHorse(h.db, { accountId: o.accountId, horseId: forSale.id, price, now: T0 });
    const buyer = await newPlayer(h.db, { credits: 100_000 });
    await buyListing(h.db, { accountId: buyer.accountId, listingId: listing.id, now: at(20 * MIN) });
    const saleFee = gc.marketFee(price);

    // Upkeep for the week that just finished (the racer was used; the race is in that week).
    await settleUpkeep(h.db, at(8 * DAY), { stableId: o.stableId });

    const fin = await stableFinances(h.db, { stableId: o.stableId, period: "all_time", now: FIN_NOW() });
    const byId = new Map(fin.horses.map((x) => [x.horseId, x]));

    const racerFin = byId.get(racer.id)!;
    expect(racerFin.owned).toBe(true);
    expect(racerFin.starts).toBe(1);
    expect(racerFin.earnedPurses).toBe(purse);
    expect(racerFin.costEntry).toBe(race.entryFee);
    // Since jockeys Phase 1 a Live race books a named rider: the fee charged is the booking's
    // (a freelancer's grade price, or 0 for a stable's own rider), not the old tier's quote.
    const jf = await h.db
      .select({ amount: ledgerPostings.amount })
      .from(ledgerPostings)
      .innerJoin(ledgerTransactions, eq(ledgerPostings.transactionId, ledgerTransactions.id))
      .where(eq(ledgerTransactions.idempotencyKey, `jockey-fee:${race.id}:${racer.id}`));
    const raceDayCharged = quote.extrasTotal + jf.reduce((m, r) => Math.max(m, Number(r.amount)), 0);
    expect(racerFin.costRaceDay).toBe(raceDayCharged);
    expect(racerFin.costTraining).toBe(300);
    expect(racerFin.costUpkeep).toBe(gc.UPKEEP_RACING_PER_WEEK);
    expect(racerFin.cost).toBe(race.entryFee + raceDayCharged + 300 + gc.UPKEEP_RACING_PER_WEEK);
    expect(racerFin.net).toBe(racerFin.earned - racerFin.cost);
    expect(racerFin.costPerStart).toBe(racerFin.cost);

    const stallionFin = byId.get(stallion.id)!;
    expect(stallionFin.earnedStud).toBe(fees.toStallionOwner);

    const soldFin = byId.get(forSale.id)!;
    expect(soldFin.owned).toBe(false); // no longer ours, but still on the sheet
    expect(soldFin.earnedSales).toBe(price - saleFee);
    expect(soldFin.net).toBe(price - saleFee);

    const packFin = byId.get(pack.horseId)!;
    expect(packFin.costPurchase).toBe(gc.PADDOCK_PACK_PRICE);

    // The buyer's side of the same sale.
    const buyerFin = await stableFinances(h.db, { stableId: buyer.stableId, period: "all_time", now: FIN_NOW() });
    expect(buyerFin.horses.find((x) => x.horseId === forSale.id)?.costPurchase).toBe(price);

    // The mare's owner paid the covering for the mare.
    const mareOwnerFin = await stableFinances(h.db, { stableId: mareOwner.stableId, period: "all_time", now: FIN_NOW() });
    expect(mareOwnerFin.horses.find((x) => x.horseId === mare.id)?.costStud).toBe(fees.totalPaidByMareOwner);

    // Per-horse nets plus the stable-only postings explain the whole period.
    expect(fin.unattributed).toBe(fin.net - fin.horses.reduce((s, x) => s + x.net, 0));
  });

  it("splits a leased runner's purse between owner and lessee on each one's sheet", async () => {
    // The lessee needs a Live-start history (leasing rules).
    const lessee = await newPlayer(h.db, { credits: 50_000 });
    await h.db.update(accounts).set({ createdAt: new Date(T0.getTime() - 8 * DAY) }).where(eq(accounts.id, lessee.accountId));
    const house = await makeHorse(h.db, null);
    for (let i = 0; i < gc.LESSEE_MIN_LIVE_STARTS; i++) {
      const past = await createRace(h.db, {
        kind: "scheduled",
        name: `History ${i}`,
        raceClass: "maiden",
        conditions: {},
        postTime: new Date(T0.getTime() - (i + 1) * DAY),
        entriesCloseAt: new Date(T0.getTime() - (i + 1) * DAY - MIN),
      });
      await h.db.update(races).set({ status: "settled" }).where(eq(races.id, past.id));
      await h.db.insert(raceEntries).values({ raceId: past.id, horseId: house.id, stableId: lessee.stableId, gate: 1, tactic: "stalker", snapshot: {}, ratingBefore: 0 });
    }

    const owner = await newPlayer(h.db, { credits: 10_000 });
    const leased = await makeHorse(h.db, owner.stableId, { rating: 95 });
    const offer = await offerLease(h.db, { accountId: owner.accountId, horseId: leased.id, termDays: 7, ownerSharePct: 60, now: T0 });
    await takeLease(h.db, { accountId: lessee.accountId, listingId: offer.id, now: T0 });

    const race = await liveRace({ postTime: at(DAY + 10 * MIN), entriesCloseAt: at(DAY + 9 * MIN) });
    await enterRace(h.db, { accountId: lessee.accountId, raceId: race.id, horseId: leased.id, tactic: "stalker", now: at(DAY) });
    const res = await runRace(race.id, at(DAY + 15 * MIN), [leased.id]);
    const prize = res.prizes[leased.id]!;
    const ownerShare = Math.floor((prize * 60) / 100);

    const now = FIN_NOW();
    const ownerFin = (await stableFinances(h.db, { stableId: owner.stableId, period: "all_time", now })).horses.find((x) => x.horseId === leased.id)!;
    expect(ownerFin.owned).toBe(true); // still owned, away on lease
    expect(ownerFin.earnedLease).toBe(ownerShare);
    expect(ownerFin.starts).toBe(0); // the owner didn't make the start

    const lesseeFin = (await stableFinances(h.db, { stableId: lessee.stableId, period: "all_time", now })).horses.find((x) => x.horseId === leased.id)!;
    expect(lesseeFin.owned).toBe(true); // kept on lease
    expect(lesseeFin.earnedLease).toBe(prize - ownerShare);
    expect(lesseeFin.costEntry).toBe(race.entryFee); // the lessee paid to run it
    expect(lesseeFin.starts).toBe(1);
    expect(lesseeFin.earnedLease + ownerFin.earnedLease).toBe(prize);
  });

  it("an empty stable shows zeros and empty tables, not errors", async () => {
    const p = await newPlayer(h.db, { credits: 0, starters: 0 });
    const fin = await stableFinances(h.db, { stableId: p.stableId, period: "this_week", now: new Date() });
    expect(fin.income).toBe(0);
    expect(fin.spend).toBe(0);
    expect(fin.net).toBe(0);
    expect(fin.balanceAtStart).toBe(0);
    expect(fin.balanceAtEnd).toBe(0);
    expect(fin.categories).toEqual([]);
    expect(fin.horses).toEqual([]);
    expect(fin.weekly.every((w) => w.net === 0)).toBe(true);
  });

  it("kinds with no horse reference stay in the summary only (never dropped)", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    await grantCredits(h.db, { accountId: p.accountId, amount: 123, idempotencyKey: `fin-unattrib:${p.accountId}`, kind: "daily_goal" });
    const fin = await stableFinances(h.db, { stableId: p.stableId, period: "all_time", now: FIN_NOW() });
    expect(fin.income).toBe(5_000 + 123); // starter grant + goal
    expect(fin.horses).toEqual([]); // nothing points at a horse
    expect(fin.unattributed).toBe(fin.net);
    expect(fin.categories.find((c) => c.category === "goals_cup")?.income).toBe(123);
  });

  it("a horse with no activity still appears (the question is what it costs)", async () => {
    const p = await newPlayer(h.db, { credits: 1_000 });
    const idle = await makeHorse(h.db, p.stableId);
    const fin = await stableFinances(h.db, { stableId: p.stableId, period: "this_week", now: FIN_NOW() });
    const row = fin.horses.find((x) => x.horseId === idle.id)!;
    expect(row.earned).toBe(0);
    expect(row.cost).toBe(0);
    expect(row.net).toBe(0);
    expect(row.costPerStart).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Category mapping completeness
// ---------------------------------------------------------------------------

/**
 * `kind:` string literals in the services. Ledger transaction kinds are posted through
 * grantCredits / spendCredits / post with a literal (or a ternary of literals) on the kind
 * line, so any new ledger kind shows up here. Literals that are NOT ledger transaction kinds
 * (inbox notes, race kinds, fraud events, ...) are classified once, below; a new one fails
 * this scan and gets added to that list — which is the point: every kind string in the
 * services is either mapped or knowingly something else.
 */
const NON_LEDGER_KINDS = new Set([
  // real-money tote alert kinds (realTote.ts, audit log only; never ledger transactions)
  "keeper_parked",
  "result_mismatch",
  "attestor_error",
  // form book race kinds, horse log entry kinds and moment kinds (not ledger transactions)
  "live",
  "story",
  "injury",
  "quirk",
  // news item kinds (news.ts) and the planner's inbox reminder (planner.ts)
  "photo_finish",
  "claim",
  "hall_of_fame",
  "jockey_retired",
  "jockey_retirement_announced",
  "plan_reminder",
  // the practice T-USDG sale note (an inbox kind, usdgPractice.ts)
  "usdg_sale",
  // fraud events (tote.ts)
  "tote_linked_bet_blocked",
  // ledger account kinds
  "player",
  // entry bank movements and refills
  "daily",
  "refill",
  // race kinds on the card
  "scheduled",
  "quick",
  "trial",
  "feature",
  "final",
  // invites
  "referral",
  // usdg orders and listings
  "registration",
  "sale",
  "stud",
  "fixed",
  "auction",
  "active",
  "closed",
  "sold",
  "cancelled",
  "expired",
  "unsold",
  // account link signals
  "device",
  "fingerprint",
  "ip_hash",
  "wallet",
  "email",
  // inbox notes
  "gift_foal",
  "race_sponsor",
  "race_result",
  "usdg_stud",
  "week_recap",
  "retired",
  "lease_start",
  "upkeep", // the ledger kind of the same name is mapped; this covers the inbox note
  // fraud events
  "linked_trade_blocked",
  "linked_lease_blocked",
  "lease_reciprocal",
  "usdg_price_review",
  "account_link",
  "referral_linked",
  "usdg_stud_linked",
  "usdg_stud_refund_due",
  // facility keys in a ternary
  "stalls",
  // playtest grant kinds posted through other paths
  "playtest_founder",
  // beta money (its own table, not the credits ledger)
  "weekly",
  "season",
]);

/** Every `kind: "...literal..."` on one source line (ternaries give two). */
function kindLiterals(line: string): string[] {
  if (!/^\s*kind:/.test(line)) return [];
  return [...line.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!);
}

function servicesDir(): string {
  return join(__dirname, "..", "services");
}

describe("finances: category mapping", () => {
  it("every ledger transaction kind in the services is mapped to exactly one category", () => {
    const unknown = new Map<string, string>();
    for (const file of readdirSync(servicesDir()).filter((f) => f.endsWith(".ts"))) {
      for (const line of readFileSync(join(servicesDir(), file), "utf8").split("\n")) {
        for (const kind of kindLiterals(line)) {
          if (!KIND_CATEGORIES[kind] && !NON_LEDGER_KINDS.has(kind)) unknown.set(kind, `${file}: ${line.trim()}`);
        }
      }
    }
    if (unknown.size) {
      throw new Error(
        `unmapped kind literals (add them to KIND_CATEGORIES in services/finances.ts, or to NON_LEDGER_KINDS here if they are not ledger transaction kinds):\n${[...unknown.entries()]
          .map(([k, where]) => `  ${k}  (${where})`)
          .join("\n")}`,
      );
    }
    // Two-way kinds map to one income and one spend category, whichever side posts them.
    expect(KIND_CATEGORIES["market_sale"]).toEqual({ income: "sales", spend: "purchases" });
  });

  it("the scan fails on a new unmapped ledger kind (the guard this file exists for)", () => {
    expect(kindLiterals('      kind: "training",')).toEqual(["training"]);
    expect(kindLiterals('  kind: sellerAccountId ? "market_sale" : "club_sale",')).toEqual(["market_sale", "club_sale"]);
    expect(kindLiterals("  kind: input.kind, // variable: nothing to read here")).toEqual([]);
    const brandNew = kindLiterals('    kind: "brand_new_sink",');
    expect(brandNew).toEqual(["brand_new_sink"]);
    expect(KIND_CATEGORIES[brandNew[0]!]).toBeUndefined();
  });

  it("every kind that actually reached the ledger in this test run is mapped", async () => {
    // Runs last (this describe is at the end of the file), after every scenario has posted.
    const rows = (await h.db.select({ kind: ledgerTransactions.kind }).from(ledgerTransactions)).map((r) => r.kind);
    const unmapped = [...new Set(rows)].filter((k) => !KIND_CATEGORIES[k]);
    expect(unmapped, `kinds posted by the scenarios but not mapped: ${unmapped.join(", ")}`).toEqual([]);
  });
});