/**
 * The lazy card tick does real work only when something is due: a request that arrives while
 * nothing is due returns before any query (it used to cost eight queries every four seconds).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { resetDbSingleton, type DbHandle } from "@thoroughbred/db";
import { dbHandle, type Db } from "./db";
import { TICK_IDLE_MS, cardChanged, driveCard, nextTickDueMs } from "./game";

const T = Date.UTC(2026, 10, 20, 12, 0, 0);
const race = (status: "open" | "locked" | "settled", closeInMs: number, postInMs: number) => ({ status, entriesCloseAt: new Date(T + closeInMs), postTime: new Date(T + postInMs) });

describe("nextTickDueMs", () => {
  it("nothing on the card: the idle beat", () => {
    expect(nextTickDueMs(T, [], false)).toBe(T + TICK_IDLE_MS);
  });

  it("the next field to lock, when that is sooner than the idle beat", () => {
    expect(nextTickDueMs(T, [race("open", 20_000, 50_000), race("open", 900_000, 930_000)], false)).toBe(T + 20_000);
    // far away: the idle beat still applies (new slots, time-driven notes)
    expect(nextTickDueMs(T, [race("open", 900_000, 930_000)], false)).toBe(T + TICK_IDLE_MS);
  });

  it("a locked field: at its post time (the broadcast then has to be followed)", () => {
    expect(nextTickDueMs(T, [race("locked", -5_000, 25_000)], false)).toBe(T + 25_000);
  });

  it("a race running or work just done: the short beat; never sooner than that", () => {
    expect(nextTickDueMs(T, [], true)).toBe(T + 4_000);
    expect(nextTickDueMs(T, [race("open", 1_000, 31_000)], false)).toBe(T + 4_000);
    // entries closed but the field is not locked yet (the lock failed): keep trying on the short beat
    expect(nextTickDueMs(T, [race("open", -10_000, 20_000)], false)).toBe(T + 4_000);
  });
});

describe("driveCard", () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await dbHandle();
  });
  afterAll(async () => {
    await resetDbSingleton();
  });

  it("ticks once, then stays off the database until something is due", { timeout: 120_000 }, async () => {
    // Far in the future, so this test's clock is ahead of anything else in the process.
    const t0 = Date.UTC(2031, 0, 6, 3, 0, 0);
    expect(await driveCard(h.db, new Date(t0), { force: true })).not.toBeNull();
    // A database that throws on use proves the guard returns before any query.
    const untouchable = new Proxy({}, { get: () => { throw new Error("touched the database"); } }) as unknown as Db;
    for (const dt of [500, 3_000, 4_100]) expect(await driveCard(untouchable, new Date(t0 + dt))).toBeNull();
    // Something moved a race: the next request (outside the short throttle) ticks again.
    cardChanged();
    await expect(driveCard(untouchable, new Date(t0 + 4_200))).rejects.toThrow("touched the database");
    expect(await driveCard(h.db, new Date(t0 + 8_500))).not.toBeNull();
    // And at the latest one idle beat later.
    expect(await driveCard(untouchable, new Date(t0 + 8_500 + 4_100)).catch(() => "ticked")).toBeNull();
    expect(await driveCard(h.db, new Date(t0 + 8_500 + TICK_IDLE_MS + 1))).not.toBeNull();
  });
});
