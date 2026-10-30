/**
 * Course character on Live races (racing-engine 1.3.0, raced under the 1.4.0 model since): the course profile is frozen into the
 * field at the lock, the race runs and is sealed with it, and races locked before courses raced
 * differently keep replaying and verifying exactly as they did.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { SLOT_KEY_PREFIX, createAccount, createDb, createRace, listStableHorses, lockField, stableOf, type CreateRaceInput, type DbHandle, type LockedField } from "@thoroughbred/db";
import { ENGINE_VERSION, LEGACY_ENGINE_VERSION } from "@thoroughbred/racing-engine";
import { enterLive, liveChunk, raceCard, raceHooks, servedReplay, settleIfDue, verifyRace } from "./game";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const PLAN = { tactic: "stalker" as const, intensity: "normal" as const };

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

let n = 0;
async function player(): Promise<Session> {
  const acc = await createAccount(h.db, {
    stableName: `Course Stable ${++n}`,
    silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" },
    timezone: "Europe/London",
    starterHorses: 3,
    startingCredits: 20_000,
    now: T0,
  });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function enteredRace(track: string, extra: Partial<CreateRaceInput> = {}) {
  const p = await player();
  const race = await createRace(h.db, {
    kind: "scheduled",
    name: `${track} Handicap ${n}`,
    raceClass: "handicap",
    conditions: { minRating: 0, maxRating: 55, distanceM: 1600, surface: "turf", going: "good", weather: "clear", track },
    postTime: at(10 * MIN),
    entriesCloseAt: at(10 * MIN - 30_000),
    purse: 16_000,
    maxRunners: 12,
    targetRunners: 6,
    slotKey: `${SLOT_KEY_PREFIX}7${String(n).padStart(6, "0")}`,
    ...extra,
  });
  const horse = (await listStableHorses(h.db, p.stable.id)).find((r) => r.careerStatus === "racing" && !r.lockKind)!.id;
  await enterLive(h.db, p, race.id, horse, PLAN, T0);
  return { p, race };
}

describe("course character on Live races", () => {
  it("a race on a known course locks with its profile (and the 1.4.0 race model), verifies and shows its character", async () => {
    const { p, race } = await enteredRace("Kestrel Downs");
    const kestrel = gc.courseByName("Kestrel Downs")!;
    const open = await raceCard(h.db, race.id, T0, p.stable.id);
    expect(open.course).toEqual({ name: "Kestrel Downs", character: kestrel.character });

    const field: LockedField = (await lockField(h.db, race.id, race.entriesCloseAt, raceHooks))!;
    expect(field.course).toEqual(gc.courseProfile(kestrel));
    const pre = await liveChunk(h.db, race.id, 0, race.entriesCloseAt);
    expect(pre.header.engineVersion).toBe(ENGINE_VERSION);
    expect(pre.final).toBeNull();
    expect(JSON.stringify(pre)).not.toMatch(/"(result|seed|finishOrder)"/);

    const end = at(30 * MIN);
    const replay = await servedReplay(h.db, race.id, end);
    expect(replay.engineVersion).toBe(ENGINE_VERSION);
    const v = await verifyRace(h.db, race.id, end, { commitment: race.seedCommitment, resultHash: replay.result.resultHash });
    expect(v).toMatchObject({ commitmentOk: true, resultHashOk: true, engineVersion: ENGINE_VERSION });
    const card = await raceCard(h.db, race.id, end, p.stable.id);
    expect(card.engineVersion).toBe(ENGINE_VERSION);
    expect(card.course?.name).toBe("Kestrel Downs");
    await settleIfDue(h.db, race.id, end);
    expect((await verifyRace(h.db, race.id, end)).resultHashOk).toBe(true);
  });

  it("a field locked before courses raced differently replays and verifies exactly as before", async () => {
    const { p, race } = await enteredRace("Harrowgate");
    await lockField(h.db, race.id, race.entriesCloseAt, raceHooks);
    // What a field locked by an earlier release looks like: the same race, no course (or model) in it.
    await h.db.execute(`update races set field = field - 'course' - 'model' where id = '${race.id}'`);
    const end = at(30 * MIN);
    const replay = await servedReplay(h.db, race.id, end);
    expect(replay.engineVersion).toBe(LEGACY_ENGINE_VERSION);
    const v = await verifyRace(h.db, race.id, end, { resultHash: replay.result.resultHash });
    expect(v).toMatchObject({ commitmentOk: true, resultHashOk: true, engineVersion: LEGACY_ENGINE_VERSION });
    // The racecard doesn't claim a course character the race didn't run with.
    expect((await raceCard(h.db, race.id, end, p.stable.id)).course).toBeNull();
  });

  it("a race on an unknown track runs course-less (still the Live race model, 1.4.0)", async () => {
    const { p, race } = await enteredRace("Old Vicarage");
    const end = at(30 * MIN);
    expect((await servedReplay(h.db, race.id, end)).engineVersion).toBe(ENGINE_VERSION);
    expect((await raceCard(h.db, race.id, end, p.stable.id)).course).toBeNull();
  });
});
