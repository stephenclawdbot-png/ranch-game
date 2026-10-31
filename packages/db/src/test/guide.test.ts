/**
 * The beginner welcome (services/guide.ts): Stable steps complete once from the real events and
 * pay once, the finishing bonus and plaque, progressive unlocks (existing stables keep
 * everything, wallet players see the USDG features), coach marks and the welcome-back window.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../client";
import { gc } from "../gameCore";
import { accounts, achievements, inboxItems, stables } from "../schema";
import { createAccount } from "../services/accounts";
import { runCupEntry } from "../services/dailyCup";
import {
  completeStableStep,
  dismissWelcomeBack,
  finishMentor,
  isFeatureUnlocked,
  markCoachSeen,
  onboardingRow,
  quickRacesAvailable,
  recordVisit,
  stableStepsView,
  syncUnlocks,
} from "../services/guide";
import { careForHorse } from "../services/horseLife";
import { getBalance } from "../services/ledger";
import { createRace, enterRace } from "../services/races";
import { at, count, DAY, makeHorse, memoryDb, MIN, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function player(opts: { guided?: boolean; now?: Date } = {}) {
  return createAccount(h.db, {
    stableName: `Guide ${++n}`,
    silks: { primary: "#112233", secondary: "#445566", pattern: "hoops", cap: "#778899" },
    startingCredits: 0,
    starterHorses: 0,
    guided: opts.guided ?? true,
    now: opts.now ?? T0,
  });
}

const credits = (k: gc.StableStepKey) => gc.STABLE_STEPS.find((s) => s.key === k)!.credits;
const stepRows = (accountId: string) => count(h.db, "stable_steps", `account_id = '${accountId}'`);

describe("Stable steps", () => {
  it("a care session completes the care step once and pays it once (next to the daily goal)", async () => {
    const p = await player();
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, p.stableId);
    await careForHorse(h.db, { accountId: p.accountId, horseId: a.id, now: T0 });
    await careForHorse(h.db, { accountId: p.accountId, horseId: b.id, now: T0 });
    await careForHorse(h.db, { accountId: p.accountId, horseId: a.id, now: at(DAY) });
    expect(await stepRows(p.accountId)).toBe(1);
    expect(await count(h.db, "ledger_transactions", `idempotency_key = 'stable-step:${p.accountId}:care'`)).toBe(1);
    // Day one: care goal + care step; day two: care goal again.
    expect(await getBalance(h.db, p.accountId)).toBe(2 * gc.DAILY_GOAL_CREDITS + credits("care"));
  });

  it("existing (unguided) stables get no guide and no step credits", async () => {
    const p = await player({ guided: false });
    const a = await makeHorse(h.db, p.stableId);
    await careForHorse(h.db, { accountId: p.accountId, horseId: a.id, now: T0 });
    expect(await stepRows(p.accountId)).toBe(0);
    expect(await getBalance(h.db, p.accountId)).toBe(gc.DAILY_GOAL_CREDITS);
    expect(await stableStepsView(h.db, p.accountId, T0)).toBeNull();
    expect(await completeStableStep(h.db, { accountId: p.accountId, step: "read_why", now: T0 })).toBe(false);
  });

  it("a Story entry is not the Live step; a Live entry is", async () => {
    const p = await player();
    const horse = await makeHorse(h.db, p.stableId);
    const story = await createRace(h.db, { kind: "quick", name: "Story", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: at(10 * MIN), entriesCloseAt: at(9 * MIN), targetRunners: 2 });
    await enterRace(h.db, { accountId: p.accountId, raceId: story.id, horseId: horse.id, tactic: "front", now: T0 });
    expect((await stableStepsView(h.db, p.accountId, T0))!.steps.find((s) => s.key === "enter_live")!.done).toBe(false);
    const other = await makeHorse(h.db, p.stableId);
    const live = await createRace(h.db, { kind: "scheduled", name: "Live", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: at(60 * MIN), entriesCloseAt: at(50 * MIN), targetRunners: 8 });
    await enterRace(h.db, { accountId: p.accountId, raceId: live.id, horseId: other.id, tactic: "front", now: T0 });
    const v = (await stableStepsView(h.db, p.accountId, T0))!;
    expect(v.steps.find((s) => s.key === "enter_live")!.done).toBe(true);
  });

  it("the Daily Cup run completes its step from runCupEntry", async () => {
    const p = await player();
    const horse = await makeHorse(h.db, p.stableId);
    await runCupEntry(h.db, { accountId: p.accountId, horseId: horse.id, now: T0, credits: 0, run: () => ({ finishPosition: 3, finishTimeUs: 90_000_000, result: null }) });
    const v = (await stableStepsView(h.db, p.accountId, T0))!;
    expect(v.steps.find((s) => s.key === "daily_cup")!.done).toBe(true);
    expect(v.done).toBe(1);
  });

  it("finishing every step pays the bonus once, awards the plaque and sends one moment", async () => {
    const p = await player();
    const keys = gc.stableStepsFor(await (async () => ({ quickRaces: await quickRacesAvailable(h.db) }))()).map((s) => s.key);
    // Parallel completions: each step still pays once.
    await Promise.all(keys.map((step) => completeStableStep(h.db, { accountId: p.accountId, step, now: T0 })));
    await Promise.all(keys.map((step) => completeStableStep(h.db, { accountId: p.accountId, step, now: T0 })));
    const v = (await stableStepsView(h.db, p.accountId, T0))!;
    expect(v.complete).toBe(true);
    expect(v.completedAtMs).not.toBeNull();
    const total = keys.reduce((s, k) => s + credits(k), 0) + gc.STABLE_STEPS_BONUS;
    expect(v.earned).toBe(total);
    expect(v.totalCredits).toBe(total);
    expect(await getBalance(h.db, p.accountId)).toBe(total);
    expect(await count(h.db, "ledger_transactions", `idempotency_key = 'stable-steps-bonus:${p.accountId}'`)).toBe(1);
    const plaque = await h.db.select().from(achievements).where(eq(achievements.accountId, p.accountId));
    expect(plaque.map((a) => a.code)).toContain("stable_steps");
    expect(await count(h.db, "inbox_items", `account_id = '${p.accountId}' and dedupe_key = 'moment:stable_steps'`)).toBe(1);
    // Once done, nothing more is paid.
    expect(await completeStableStep(h.db, { accountId: p.accountId, step: "care", now: at(DAY) })).toBe(false);
    expect(await getBalance(h.db, p.accountId)).toBe(total);
  });

  it("the quick race step is skipped until the quick races table exists, then reconciles from it", async () => {
    const p = await player();
    expect(await quickRacesAvailable(h.db)).toBe(false);
    expect((await stableStepsView(h.db, p.accountId, T0))!.steps.some((s) => s.key === "quick_race")).toBe(false);
    expect(await completeStableStep(h.db, { accountId: p.accountId, step: "quick_race", now: T0 })).toBe(false);
    await h.db.execute(sql`create table if not exists quick_races (id uuid primary key default gen_random_uuid(), account_id uuid not null)`);
    expect(await quickRacesAvailable(h.db)).toBe(true);
    const before = (await stableStepsView(h.db, p.accountId, T0))!;
    expect(before.steps.find((s) => s.key === "quick_race")!.done).toBe(false);
    expect(before.totalCredits).toBe(gc.stableStepsTotal({ quickRaces: true }));
    await h.db.execute(sql`insert into quick_races (account_id) values (${p.accountId})`);
    const after = (await stableStepsView(h.db, p.accountId, T0))!;
    expect(after.steps.find((s) => s.key === "quick_race")!.done).toBe(true);
    expect(await getBalance(h.db, p.accountId)).toBe(credits("quick_race"));
    await h.db.execute(sql`drop table quick_races`);
    (globalThis as { __tbQuickRacesTable?: boolean }).__tbQuickRacesTable = undefined;
  });
});

describe("progressive unlocks", () => {
  async function liveWatched(accountId: string, stableId: string) {
    const horse = await makeHorse(h.db, stableId);
    const race = await createRace(h.db, { kind: "scheduled", name: "Watched", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: at(-60 * MIN), entriesCloseAt: at(-70 * MIN), targetRunners: 8 });
    await h.db.insert(inboxItems).values({ accountId, kind: "race_result", dedupeKey: `race:${race.id}:${horse.id}`, title: "Ran", raceId: race.id, horseId: horse.id, readAt: T0, createdAt: T0 });
  }
  const open = (u: Record<string, boolean>) => Object.keys(u).filter((k) => u[k]);

  it("a new stable starts with nothing extra; the tote opens after a watched Live race, with an Unlocked moment", async () => {
    const p = await player();
    expect(open((await syncUnlocks(h.db, p.accountId, T0)).unlocks)).toEqual([]);
    expect(await isFeatureUnlocked(h.db, p.accountId, "tote")).toBe(false);
    await liveWatched(p.accountId, p.stableId);
    const s = await syncUnlocks(h.db, p.accountId, T0);
    expect(s.fresh).toEqual(["tote"]);
    expect(await isFeatureUnlocked(h.db, p.accountId, "tote")).toBe(true);
    expect(await count(h.db, "inbox_items", `account_id = '${p.accountId}' and dedupe_key = 'moment:unlock:tote'`)).toBe(1);
    // Synced again: nothing new, no second moment.
    expect((await syncUnlocks(h.db, p.accountId, T0)).fresh).toEqual([]);
    expect(await count(h.db, "inbox_items", `account_id = '${p.accountId}' and dedupe_key like 'moment:unlock:%'`)).toBe(1);
  });

  it("market and leasing open on day 3; Story chapter 1 opens claiming and jockey contracts", async () => {
    const p = await player();
    expect(open((await syncUnlocks(h.db, p.accountId, at(DAY))).unlocks)).toEqual([]);
    expect(open((await syncUnlocks(h.db, p.accountId, at(2 * DAY))).unlocks)).toEqual(["market", "leasing"]);
    await h.db.update(stables).set({ licenceLevel: 2 }).where(eq(stables.id, p.stableId));
    expect(open((await syncUnlocks(h.db, p.accountId, at(2 * DAY))).unlocks)).toEqual(["market", "leasing", "claiming", "jockey_contracts"]);
  });

  it("an opened feature is never taken away", async () => {
    const p = await player();
    await h.db.update(stables).set({ licenceLevel: 2 }).where(eq(stables.id, p.stableId));
    await syncUnlocks(h.db, p.accountId, T0);
    await h.db.update(stables).set({ licenceLevel: 1 }).where(eq(stables.id, p.stableId));
    expect((await syncUnlocks(h.db, p.accountId, T0)).unlocks.claiming).toBe(true);
    expect(await isFeatureUnlocked(h.db, p.accountId, "claiming")).toBe(true);
  });

  it("existing stables keep everything (no row, or an unguided row)", async () => {
    const p = await player({ guided: false });
    const s = await syncUnlocks(h.db, p.accountId, T0);
    expect(Object.values(s.unlocks).every(Boolean)).toBe(true);
    for (const f of gc.UNLOCK_FEATURES) expect(await isFeatureUnlocked(h.db, p.accountId, f)).toBe(true);
    await recordVisit(h.db, p.accountId, T0); // creates an unguided row
    expect((await onboardingRow(h.db, p.accountId))!.guided).toBe(false);
    expect(Object.values((await syncUnlocks(h.db, p.accountId, T0)).unlocks).every(Boolean)).toBe(true);
  });

  it("wallet players see the USDG features (tote, market) from the start, without moments", async () => {
    const p = await player();
    await h.db.update(accounts).set({ walletAddress: `0x${p.accountId.replace(/-/g, "").padEnd(40, "0").slice(0, 40)}` }).where(eq(accounts.id, p.accountId));
    const s = await syncUnlocks(h.db, p.accountId, T0);
    expect(open(s.unlocks)).toEqual(["tote", "market", "leasing"]);
    expect(await count(h.db, "inbox_items", `account_id = '${p.accountId}' and dedupe_key like 'moment:unlock:%'`)).toBe(0);
  });

  it("a feature already used stays open (a claiming entry)", async () => {
    const p = await player();
    const horse = await makeHorse(h.db, p.stableId);
    const race = await createRace(h.db, { kind: "scheduled", name: "Claimer", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: at(60 * MIN), entriesCloseAt: at(50 * MIN), targetRunners: 8 });
    await h.db.execute(sql`insert into race_entries (race_id, horse_id, stable_id, tactic, snapshot, rating_before, entry_cost, claim_price) values (${race.id}, ${horse.id}, ${p.stableId}, 'front', '{}'::jsonb, 0, 0, 1000)`);
    const s = await syncUnlocks(h.db, p.accountId, T0);
    expect(s.unlocks.claiming).toBe(true);
    expect(s.unlocks.jockey_contracts).toBe(false);
  });
});

describe("mentor, coach marks and welcome back", () => {
  it("records the mentor's answer and each coach mark once", async () => {
    const p = await player();
    expect((await onboardingRow(h.db, p.accountId))!.mentorDoneAt).toBeNull();
    await finishMentor(h.db, { accountId: p.accountId, plainLanguage: true, now: T0 });
    const row = (await onboardingRow(h.db, p.accountId))!;
    expect(row.mentorDoneAt).not.toBeNull();
    expect(row.plainLanguage).toBe(true);
    // Reopening and skipping later keeps the answer.
    await finishMentor(h.db, { accountId: p.accountId, now: at(MIN) });
    expect((await onboardingRow(h.db, p.accountId))!.plainLanguage).toBe(true);
    expect(await markCoachSeen(h.db, { accountId: p.accountId, id: "racecard", now: T0 })).toEqual(["racecard"]);
    expect(await markCoachSeen(h.db, { accountId: p.accountId, id: "racecard", now: T0 })).toEqual(["racecard"]);
    expect(await markCoachSeen(h.db, { accountId: p.accountId, id: "tote", now: T0 })).toEqual(["racecard", "tote"]);
  });

  it("opens a welcome-back window after a day away, shows it for a few hours, and closes it on dismiss", async () => {
    const p = await player();
    expect(await recordVisit(h.db, p.accountId, at(MIN))).toBeNull();
    expect(await recordVisit(h.db, p.accountId, at(12 * 60 * MIN))).toBeNull();
    const back = at(12 * 60 * MIN + gc.WELCOME_BACK_AFTER_MS);
    const w = await recordVisit(h.db, p.accountId, back);
    expect(w).toEqual({ fromMs: at(12 * 60 * MIN).getTime(), atMs: back.getTime() });
    expect(await recordVisit(h.db, p.accountId, new Date(back.getTime() + 60 * MIN))).toEqual(w);
    expect(await recordVisit(h.db, p.accountId, new Date(back.getTime() + gc.WELCOME_BACK_SHOW_MS + MIN))).toBeNull();
    const again = new Date(back.getTime() + 3 * DAY);
    expect(await recordVisit(h.db, p.accountId, again)).not.toBeNull();
    await dismissWelcomeBack(h.db, p.accountId);
    expect(await recordVisit(h.db, p.accountId, new Date(again.getTime() + MIN))).toBeNull();
  });
});
