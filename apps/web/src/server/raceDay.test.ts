/**
 * Race-day extras and jockeys at the web layer: offered and priced on the entry sheet (risk per
 * extra), charged with a Live entry, refunded on a scratch, sealed in the locked field (the
 * engine kit and the physio'd snapshot), shown on the racecard, replayed and verified under
 * engine 1.2.0, while a race without extras stays a 1.1.0 race.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { createAccount, createDb, createRace, getBalance, listRaceEntries, listStableHorses, lockField, stableOf, type CreateRaceInput, type DbHandle, type LockedField } from "@thoroughbred/db";
import { LEGACY_ENGINE_VERSION, ENGINE_VERSION } from "@thoroughbred/racing-engine";
import { raceDayRiskKey } from "@/lib/raceDay";
import { enterLive, entryOptions, liveChunk, raceCard, raceHooks, scratchLive, servedReplay, settleIfDue, verifyRace } from "./game";
import { engineHorseFromSnapshot } from "./horseView";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

async function player(name: string): Promise<Session> {
  const acc = await createAccount(h.db, {
    stableName: name,
    silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" },
    timezone: "Europe/London",
    starterHorses: 3,
    startingCredits: 20_000,
    now: T0,
  });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function freeHorse(s: Session): Promise<string> {
  const rows = await listStableHorses(h.db, s.stable.id);
  return rows.find((r) => r.careerStatus === "racing" && !r.lockKind)!.id;
}

let slotN = 0;
function liveRace(going: "good" | "soft" | "firm", extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: `Ashcombe Handicap ${++slotN}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 55, distanceM: 1600, surface: "turf", going, weather: "clear", track: "Ashcombe" },
    postTime: at(10 * MIN),
    entriesCloseAt: at(10 * MIN - 30_000),
    purse: 16_000,
    maxRunners: 12,
    targetRunners: 6,
    slotKey: `live:8${String(slotN).padStart(6, "0")}`,
    ...extra,
  });
}

const PLAN = { tactic: "stalker" as const, intensity: "normal" as const };
const FULL: gc.RaceDayChoice = { extras: ["soft_shoes", "physio", "vet_check"], jockey: "top" };

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("race-day extras on the entry sheet", () => {
  it("offers shoes only for the going, priced from the purse, with a risk for every combination", async () => {
    const p = await player("Sheet Stable");
    const soft = await liveRace("soft");
    const sheet = await entryOptions(h.db, p, soft.id, T0);
    expect(sheet.raceDay.extras.map((x) => x.key)).toEqual(["soft_shoes", "physio", "vet_check"]);
    expect(sheet.raceDay.extras.every((x) => x.price === 320)).toBe(true);
    expect(sheet.raceDay.jockeys.map((j) => [j.key, j.price])).toEqual([
      ["apprentice", 0],
      ["journeyman", 400],
      ["top", 800],
    ]);
    const good = await entryOptions(h.db, p, (await liveRace("good")).id, T0);
    expect(good.raceDay.extras.map((x) => x.key)).toEqual(["physio", "vet_check"]);
    const o = sheet.options.find((x) => x.risk.normal)!;
    expect(Object.keys(o.riskBy)).toHaveLength(3 * 8);
    expect(o.riskBy[raceDayRiskKey("normal", [])]).toEqual(o.risk.normal);
    const checked = o.riskBy[raceDayRiskKey("normal", ["vet_check"])]!;
    expect(checked.factors).toContain("Vet-checked");
    expect(checked.permille).toBeLessThanOrEqual(o.risk.normal!.permille);
    expect(o.riskBy[raceDayRiskKey("all_out", ["soft_shoes"])]!.factors).toContain("soft going (shod for it)");
  });
});

describe("race-day extras on a Live race", () => {
  it("are charged with the entry and refunded on a scratch before the close", async () => {
    const p = await player("Scratch Stable");
    const race = await liveRace("soft");
    const before = await getBalance(h.db, p.accountId);
    const horseId = await freeHorse(p);
    await enterLive(h.db, p, race.id, horseId, PLAN, T0, FULL);
    const cost = gc.raceDayQuote(FULL, race.purse).total;
    const goal = gc.DAILY_GOAL_CREDITS;
    expect(await getBalance(h.db, p.accountId)).toBe(before + goal - race.entryFee - cost);
    await scratchLive(h.db, p, race.id, horseId, T0);
    // The entry fee is forfeited as before; the extras and the jockey come back.
    expect(await getBalance(h.db, p.accountId)).toBe(before + goal - race.entryFee);
  });

  it("are sealed at the lock, shown on the racecard, and the race replays and verifies (engine 1.2.0)", async () => {
    const p = await player("Kit Stable");
    const q = await player("Plain Stable");
    const race = await liveRace("soft");
    const ph = await freeHorse(p);
    const qh = await freeHorse(q);
    await enterLive(h.db, p, race.id, ph, PLAN, T0, FULL);
    await enterLive(h.db, q, race.id, qh, PLAN, T0);

    const open = await raceCard(h.db, race.id, T0, p.stable.id);
    expect(open.field.find((e) => e.horse.id === ph)!.gear).toEqual(["Soft shoes", "Physio", "Vet-checked", "Top jockey"]);
    expect(open.field.find((e) => e.horse.id === qh)!.gear).toEqual([]);

    const field: LockedField = await lockField(h.db, race.id, race.entriesCloseAt, raceHooks);
    expect(field.runners.find((r) => r.horseId === ph)!.kit).toEqual({ goingPenaltyPermille: 500, formAmpPermille: 800, keenPermille: 500 });
    expect(field.runners.find((r) => r.horseId === qh)!.kit).toBeUndefined();
    // Before the off the broadcast header names the engine the race will run on, and nothing else new.
    const pre = await liveChunk(h.db, race.id, 0, race.entriesCloseAt);
    expect(pre.header.engineVersion).toBe(ENGINE_VERSION);
    expect(pre.final).toBeNull();
    expect(JSON.stringify(pre)).not.toMatch(/"(kit|raceDay|result|seed|finishOrder)"/);

    const end = at(30 * MIN);
    const replay = await servedReplay(h.db, race.id, end);
    expect(replay.engineVersion).toBe(ENGINE_VERSION);
    const v = await verifyRace(h.db, race.id, end, { commitment: race.seedCommitment, resultHash: replay.result.resultHash });
    expect(v).toMatchObject({ commitmentOk: true, resultHashOk: true, engineVersion: ENGINE_VERSION });
    const card = await raceCard(h.db, race.id, end, p.stable.id);
    expect(card.engineVersion).toBe(ENGINE_VERSION);
    expect(card.field.find((e) => e.horse.id === ph)!.gear).toContain("Top jockey");
    await settleIfDue(h.db, race.id, end);
  });

  it("a race nobody bought extras for stays a 1.1.0 race (old proofs unchanged)", async () => {
    const p = await player("Legacy Stable");
    const race = await liveRace("good");
    await enterLive(h.db, p, race.id, await freeHorse(p), PLAN, T0);
    const end = at(30 * MIN);
    const replay = await servedReplay(h.db, race.id, end);
    expect(replay.engineVersion).toBe(LEGACY_ENGINE_VERSION);
    const v = await verifyRace(h.db, race.id, end, { resultHash: replay.result.resultHash });
    expect(v).toMatchObject({ resultHashOk: true, engineVersion: LEGACY_ENGINE_VERSION });
  });

  it("physio lifts a tired horse's race snapshot, never past the same horse rested", async () => {
    const p = await player("Physio Stable");
    const race = await liveRace("good");
    const horseId = await freeHorse(p);
    await enterLive(h.db, p, race.id, horseId, PLAN, T0, { extras: ["physio"], jockey: "apprentice" });
    const [entry] = (await listRaceEntries(h.db, race.id)).filter((e) => e.horseId === horseId);
    const snap = entry!.snapshot as Record<string, unknown> & { state: gc.HorseState };
    const tiredState = { ...snap.state, condition: { ...snap.state.condition, fatigue: 800, fatigueAtMs: race.postTime.getTime() } };
    const restedState = { ...snap.state, condition: { ...snap.state.condition, fatigue: 0, fatigueAtMs: race.postTime.getTime() } };
    const tired = engineHorseFromSnapshot({ ...snap, state: tiredState, raceDay: undefined }, race, false);
    const physio = engineHorseFromSnapshot({ ...snap, state: tiredState }, race, false);
    const rested = engineHorseFromSnapshot({ ...snap, state: restedState }, race, false);
    expect(physio.stats.speed).toBeGreaterThan(tired.stats.speed);
    expect(physio.stats.speed).toBeLessThanOrEqual(rested.stats.speed);
    // Without extras the snapshot is exactly as before.
    const { raceDay: _rd, ...plain } = snap;
    expect(engineHorseFromSnapshot(plain, race, false)).toEqual(engineHorseFromSnapshot({ ...snap, raceDay: undefined }, race, false));
  });

  it("refuses extras the race doesn't offer", async () => {
    const p = await player("Firm Stable");
    const race = await liveRace("good");
    await expect(enterLive(h.db, p, race.id, await freeHorse(p), PLAN, T0, { extras: ["firm_shoes"], jockey: "apprentice" })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });
});
