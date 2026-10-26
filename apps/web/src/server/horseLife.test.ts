/**
 * Horse life against a real (in-memory PGlite) database: care on the player's local day
 * growing a foal to racing age, the training planner (plan, sessions, credits once), vet,
 * career decisions and facilities, through the same server functions the routes call.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, gameCoreHooks, getBalance, insertHorse, listStableHorses, stableOf, toHorseState, type DbHandle } from "@thoroughbred/db";
import * as gc from "@thoroughbred/game-core";
import {
  careAction,
  careAllAction,
  careerAction,
  facilitiesView,
  facilityAction,
  graduateAction,
  horseLifeView,
  nurseryView,
  renameAction,
  savePlanAction,
  trainAction,
} from "./horseLife";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms);

async function player(name: string, timezone = "Europe/London"): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone, now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function addFoal(session: Session): Promise<string> {
  const spec = gameCoreHooks.packHorse({ seed: `foal-${session.accountId}`, rarity: "common", packType: "paddock", season: 1 });
  return insertHorse(h.db, { stableId: session.stable.id, spec, origin: "pack", now: T0 });
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("nursery and care", () => {
  it("a foal grows with one care session per local day, is named, and graduates to racing", { timeout: 60_000 }, async () => {
    const p = await player("Foaling Down");
    const id = await addFoal(p);
    const n0 = await nurseryView(h.db, p, T0);
    expect(n0.foals.map((f) => f.id)).toContain(id);
    const foal0 = n0.foals.find((f) => f.id === id)!;
    expect(foal0.care.growth).toMatchObject({ stage: "foal", sessions: 0, toRacing: gc.CARE_TO_RACING });
    const width0 = foal0.ranges[0]!.hi - foal0.ranges[0]!.lo;

    await renameAction(h.db, p, id, "Northern Lantern");
    const first = await careAction(h.db, p, id, {}, T0);
    expect(first).toMatchObject({ counted: true, careSessions: 1 });
    expect((await careAction(h.db, p, id, {}, at(60_000))).counted).toBe(false);
    const life = await horseLifeView(h.db, p, id, at(60_000));
    expect(life!.name).toBe("Northern Lantern");
    expect(life!.care.caredToday).toBe(true);
    expect(life!.training.available).toBe(false);

    let graduated = false;
    for (let d = 1; d < gc.CARE_TO_RACING; d++) graduated = (await careAction(h.db, p, id, {}, at(d * DAY))).graduated || graduated;
    expect(graduated).toBe(true);
    const n1 = await nurseryView(h.db, p, at(gc.CARE_TO_RACING * DAY));
    expect(n1.foals.find((f) => f.id === id)).toBeUndefined();
    const grad = n1.graduates.find((f) => f.id === id)!;
    expect(grad.ranges[0]!.hi - grad.ranges[0]!.lo).toBeLessThan(width0);
    await graduateAction(h.db, p, id, at(gc.CARE_TO_RACING * DAY));
    expect((await nurseryView(h.db, p, at(gc.CARE_TO_RACING * DAY))).graduates).toHaveLength(0);
    const grown = await horseLifeView(h.db, p, id, at(gc.CARE_TO_RACING * DAY));
    expect(grown!.status.block).toBeNull();
    expect(grown!.career.stageLabel).toBe("Juvenile");
  });

  it("only the owner sees the life view", async () => {
    const a = await player("Owner Yard");
    const b = await player("Nosey Yard");
    const id = await addFoal(a);
    expect(await horseLifeView(h.db, b, id, T0)).toBeNull();
    await expect(careAction(h.db, b, id, {}, T0)).rejects.toMatchObject({ code: "NOT_OWNER" });
  });
});

describe("training, career, facilities", () => {
  it("plans and runs a week of training, paying per session once", { timeout: 60_000 }, async () => {
    const p = await player("Gallops Hill");
    const [starter] = await listStableHorses(h.db, p.stable.id);
    const id = starter!.id;
    const before = await getBalance(h.db, p.accountId);
    const view = await horseLifeView(h.db, p, id, T0);
    expect(view!.training).toMatchObject({ available: true, slots: 3, sessionsUsed: 0 });
    await savePlanAction(h.db, p, id, ["speed_work", "swimming", "rest"], T0);
    const s1 = await trainAction(h.db, p, id, { expectedSession: 0 }, T0);
    expect(s1).toMatchObject({ ran: true, workout: "speed_work", cost: 90, sessionsUsed: 1 });
    expect(s1.arrows!.speed).toBe(1);
    expect((await trainAction(h.db, p, id, { expectedSession: 0 }, T0)).ran).toBe(false);
    const after = await horseLifeView(h.db, p, id, at(1000));
    expect(after!.training.sessionsUsed).toBe(1);
    expect(after!.training.nextWorkout).toBe("swimming");
    expect(after!.condition.peak.phase).toBe("building");
    expect(after!.credits).toBe(before - 90);
  });

  it("retires, moves to the Legacy Farm and releases with the right guards", async () => {
    const p = await player("Decision Barn");
    const [a, b] = await listStableHorses(h.db, p.stable.id);
    const r = await careerAction(h.db, p, a!.id, "retire", T0);
    expect(r).toMatchObject({ careerStatus: "retired" });
    expect((await horseLifeView(h.db, p, a!.id, T0))!.career.canRetire).toBe(false);
    await careerAction(h.db, p, a!.id, "legacy", T0);
    const v = await horseLifeView(h.db, p, a!.id, T0);
    expect(v!.career.careerStatus).toBe("pasture");
    const before = await getBalance(h.db, p.accountId);
    await careerAction(h.db, p, b!.id, "release", T0);
    expect(await getBalance(h.db, p.accountId)).toBe(before + 50);
    expect(await horseLifeView(h.db, p, b!.id, T0)).toBeNull();
  });

  it("insurance quotes the career-ending odds, agreeing with injuryRisk", async () => {
    const p = await player("Underwriters Yard");
    const [starter] = await listStableHorses(h.db, p.stable.id);
    const v = await horseLifeView(h.db, p, starter!.id, T0);
    expect(v!.condition.insurance).toMatchObject({ insured: false, available: true });
    // Same context as the risk badge on the horse page: normal ride, best trip, good going.
    const state = toHorseState(starter!);
    const r = gc.injuryRisk(state, { nowMs: T0.getTime(), going: "good", distanceM: v!.horse.preferredDistanceM, intensity: "normal", stage: gc.stageOf(state) });
    const expected = (r.permille * r.careerEndingShare) / 1000;
    expect(v!.condition.insurance.careerEndingPerRace).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(0);
  });

  it("facilities come with game-core prices; a stable hand enables care for all", async () => {
    const p = await player("Builders Yard");
    await addFoal(p);
    const f = await facilitiesView(h.db, p);
    expect(f.items.map((i) => i.key)).toEqual(["stalls", "entries", "trainer", "vet", "stableHand"]);
    expect(f.items[0]).toMatchObject({ level: 6, nextCost: gc.stallCost(7) });
    const credits = f.credits;
    await expect(careAllAction(h.db, p, T0)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await facilityAction(h.db, p, "stalls", 7, T0);
    expect((await facilityAction(h.db, p, "stalls", 7, T0)).bought).toBe(false);
    const after = await facilitiesView(h.db, p);
    expect(after.items[0]!.level).toBe(7);
    expect(after.credits).toBe(credits - gc.stallCost(7));
  });
});
