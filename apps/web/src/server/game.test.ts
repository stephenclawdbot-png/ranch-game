/**
 * The web app's game server against a real (in-memory PGlite) database: accounts, Story races
 * settled server-side at creation, and the shared Live card (enter, lock with house horses,
 * live broadcast without leaks, settlement after the broadcast, inbox).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceBroadcastChunkSchema, type RaceBroadcastChunk } from "@thoroughbred/shared";
import { DAILY_GOAL_CREDITS } from "@thoroughbred/game-core";
import { createAccount, createDb, getBalance, getEntryBank, getRace, listInbox, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import {
  createStoryRace,
  driveCard,
  enterLive,
  entryOptions,
  liveChunk,
  myRaceResult,
  playerView,
  quickPickLive,
  raceCard,
  raceList,
  servedReplay,
  settleIfDue,
  verifyRace,
} from "./game";
import { TooEarlyError } from "./errors";
import { broadcastEndsAtMs } from "./live";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);

async function player(name: string): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

function assertNoLeak(chunk: RaceBroadcastChunk, seed: string, resultHash: string) {
  expect(RaceBroadcastChunkSchema.safeParse(chunk).success).toBe(true);
  expect(chunk.final).toBeNull();
  const json = JSON.stringify(chunk);
  expect(json).not.toContain(seed);
  expect(json).not.toContain(resultHash);
  for (const key of ["result", "seed", "totalTicks", "finishOrder", "finishTimeUs", "winningTimeUs", "endsAtMs", "prize"]) expect(json).not.toContain(`"${key}"`);
  if (chunk.frames.length) expect(chunk.fromFrame + chunk.frames.length - 1).toBeLessThanOrEqual(chunk.liveEdgeFrame);
  const edgeTick = chunk.liveEdgeFrame * chunk.header.sampleEvery;
  for (const e of chunk.events) expect(e.tick).toBeLessThanOrEqual(edgeTick);
}

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("accounts", () => {
  it("a new player gets a stable, starter horses, credits and today's entries from the database", async () => {
    const p = await player("Larkrise Lodge");
    const view = await playerView(h.db, p, T0);
    expect(view.stableName).toBe("Larkrise Lodge");
    expect(view.horses.length).toBe(3);
    for (const s of view.horses) {
      expect(s.horse.appearance.silks.primary).toBe("#112233");
      expect(s.block).toBeNull();
      expect(s.risk.permille).toBeGreaterThan(0);
    }
    expect(view.credits).toBe(3000);
    expect(view.entries).toMatchObject({ balance: 10, cap: 20 });
    expect(view.hasRaced).toBe(false);
  });

  it("a Daily Cup run counts as having raced (the home's first-race hero retires)", async () => {
    const p = await player("Cup Only");
    const horseId = (await playerView(h.db, p, T0)).horses[0]!.id;
    await h.db.insert(schema.dailyCupEntries).values({ day: "2026-11-02", accountId: p.accountId, horseId, snapshot: {}, points: 50 });
    expect((await playerView(h.db, p, T0)).hasRaced).toBe(true);
  });
});

describe("Story mode", () => {
  it("an instant Story race is simulated and settled on the server once, at creation", { timeout: 60_000 }, async () => {
    const p = await player("Story Stable");
    const created = await createStoryRace(h.db, p, { instant: true }, T0);
    expect(created.pick?.reason).toMatch(/best fit/);
    const race = (await getRace(h.db, created.raceId))!;
    expect(race.status).toBe("settled");
    expect(race.kind).toBe("quick");
    const card = await raceCard(h.db, created.raceId, T0, p.stable.id);
    expect(card.kind).toBe("story");
    expect(card.status).toBe("finished");
    expect(card.field.length).toBeGreaterThanOrEqual(8);
    expect(card.field.filter((f) => f.mine)).toHaveLength(1);
    const credits = await getBalance(h.db, p.accountId);
    const mine = await myRaceResult(h.db, p, created.raceId, T0);
    expect(mine.runners).toHaveLength(1);
    const r = mine.runners[0]!;
    expect(credits).toBe(3000 + r.storyReward + DAILY_GOAL_CREDITS); // entering also paid the day's race goal
    expect(r.storyReward).toBe(r.position === 1 ? 400 : 20);
    // Viewing again or re-settling never pays twice; Story races cost no stable entries.
    expect(await settleIfDue(h.db, created.raceId, at(60_000))).toBe(false);
    await myRaceResult(h.db, p, created.raceId, at(60_000));
    expect(await getBalance(h.db, p.accountId)).toBe(credits);
    expect((await getEntryBank(h.db, { accountId: p.accountId, now: T0 })).balance).toBe(10);
    // The result is in the inbox, read now that the player has seen it.
    const inbox = await listInbox(h.db, p.accountId);
    expect(inbox.find((i) => i.raceId === created.raceId)?.readAt).not.toBeNull();
    const view = await playerView(h.db, p, T0);
    expect(view.runs[0]?.raceId).toBe(created.raceId);
    expect(view.hasRaced).toBe(true);
    // A Story race is not a career start: the run is in the history, the record is not.
    expect(view.horses.find((x) => x.id === created.horseId)?.starts).toBe(0);
  });

  it("a watched Story race withholds its replay until the broadcast is over", { timeout: 60_000 }, async () => {
    const p = await player("Watcher");
    const created = await createStoryRace(h.db, p, {}, T0);
    expect(created.postTimeMs - T0.getTime()).toBeGreaterThanOrEqual(10_000);
    const pre = await liveChunk(h.db, created.raceId, 0, T0);
    expect(pre.liveEdgeFrame).toBe(-1);
    expect(pre.frames).toEqual([]);
    const replay = await servedReplay(h.db, created.raceId, new Date(created.postTimeMs + 3_600_000));
    assertNoLeak(pre, replay.seed, replay.result.resultHash);
    const mid = await liveChunk(h.db, created.raceId, 0, new Date(created.postTimeMs + 20_000));
    assertNoLeak(mid, replay.seed, replay.result.resultHash);
    expect(mid.frames.length).toBeGreaterThan(0);
    expect(mid.header).toEqual(pre.header);
    await expect(servedReplay(h.db, created.raceId, new Date(created.postTimeMs + 20_000))).rejects.toBeInstanceOf(TooEarlyError);
    await expect(myRaceResult(h.db, p, created.raceId, new Date(created.postTimeMs + 20_000))).rejects.toBeInstanceOf(TooEarlyError);
    const done = await liveChunk(h.db, created.raceId, 0, new Date(broadcastEndsAtMs(replay)));
    expect(done.final?.result.resultHash).toBe(replay.result.resultHash);
  });
});

describe("Live card", () => {
  it("enter → lock with house horses → live broadcast without leaks → settlement after the broadcast → inbox", { timeout: 120_000 }, async () => {
    const a = await player("Alpha Stable");
    const b = await player("Bravo Stable");
    await driveCard(h.db, T0, { force: true });
    const { upcoming } = await raceList(h.db, T0, a.stable.id);
    expect(upcoming.length).toBeGreaterThan(3);
    expect(upcoming.every((r) => r.kind === "live" && (r.phase === "open" || r.phase === "closed") && r.postTimeMs > T0.getTime())).toBe(true);

    // Quick Pick enters the best-fit fresh horse into the next suitable race.
    const pick = await quickPickLive(h.db, a, T0);
    expect(pick.reason.length).toBeGreaterThan(10);
    expect((await getEntryBank(h.db, { accountId: a.accountId, now: T0 })).balance).toBe(10 - (upcoming.find((r) => r.id === pick.raceId)?.entryCost ?? 1));
    const options = await entryOptions(h.db, b, pick.raceId, T0);
    const okHorse = options.options.find((o) => o.reason === null);
    if (okHorse) await enterLive(h.db, b, pick.raceId, okHorse.horseId, { tactic: "stalker", intensity: "conservative" }, T0);

    const open = await raceCard(h.db, pick.raceId, T0, a.stable.id);
    expect(open.status).toBe("open");
    expect(open.fieldLocked).toBe(false);
    expect(open.field.filter((f) => f.mine)).toHaveLength(1);
    await expect(liveChunk(h.db, pick.raceId, 0, T0)).rejects.toBeInstanceOf(TooEarlyError);

    // Entries close 30 s before the off: the field locks, house horses fill the gates.
    const closeAt = new Date(open.entriesCloseAtMs + 500);
    const closed = await raceCard(h.db, pick.raceId, closeAt, a.stable.id);
    expect(closed.status).toBe("closed");
    expect(closed.fieldLocked).toBe(true);
    expect(closed.field.length).toBe(Math.max(closed.targetRunners, okHorse ? 2 : 1));
    expect(closed.field.filter((f) => !f.isPlayer).length).toBeGreaterThan(0);
    expect(new Set(closed.field.map((f) => f.gate)).size).toBe(closed.field.length);
    expect(JSON.stringify(closed)).not.toMatch(/"seed"|"result"|winner/);

    const post = open.config.postTimeMs;
    const pre = await liveChunk(h.db, pick.raceId, 0, closeAt);
    const replay = await servedReplay(h.db, pick.raceId, new Date(post + 3_600_000));
    assertNoLeak(pre, replay.seed, replay.result.resultHash);
    const mid = new Date(post + 30_000);
    const live = await liveChunk(h.db, pick.raceId, 0, mid);
    assertNoLeak(live, replay.seed, replay.result.resultHash);
    expect(live.header).toEqual(pre.header);
    expect((await raceCard(h.db, pick.raceId, mid, a.stable.id)).status).toBe("live");
    const listLive = await raceList(h.db, mid, a.stable.id);
    const row = listLive.recent.find((r) => r.id === pick.raceId)!;
    expect(row.phase).toBe("live");
    expect(JSON.stringify(row)).not.toMatch(/winner|endsAtMs|timeUs/);
    await expect(verifyRace(h.db, pick.raceId, mid)).rejects.toBeInstanceOf(TooEarlyError);
    // Not settled while the broadcast runs (nothing in the inbox, credits unchanged).
    await driveCard(h.db, mid, { force: true });
    expect((await getRace(h.db, pick.raceId))!.status).toBe("locked");
    expect((await listInbox(h.db, a.accountId)).filter((i) => i.raceId === pick.raceId)).toHaveLength(0);

    const end = new Date(broadcastEndsAtMs(replay) + 1000);
    const before = await getBalance(h.db, a.accountId);
    await driveCard(h.db, end, { force: true });
    await driveCard(h.db, new Date(end.getTime() + 5000), { force: true });
    expect((await getRace(h.db, pick.raceId))!.status).toBe("settled");
    const result = await myRaceResult(h.db, a, pick.raceId, end);
    expect(result.settled).toBe(true);
    const mine = result.runners[0]!;
    expect(mine.position).toBe(replay.result.finishOrder.find((f) => f.horseId === pick.horseId)!.position);
    expect(await getBalance(h.db, a.accountId)).toBe(before + mine.prize);
    expect(mine.prize).toBe(replay.result.finishOrder.find((f) => f.horseId === pick.horseId)!.prize);
    const v = await verifyRace(h.db, pick.raceId, end, { commitment: open.seedCommitment, resultHash: replay.result.resultHash });
    expect(v.commitmentOk && v.resultHashOk).toBe(true);
    const finished = await raceList(h.db, end, a.stable.id);
    expect(finished.recent.find((r) => r.id === pick.raceId)?.winner?.horseId).toBe(replay.result.finishOrder[0]!.horseId);
    const view = await playerView(h.db, a, end);
    expect(view.inbox.find((i) => i.raceId === pick.raceId)?.read).toBe(true);
    expect(view.active.find((x) => x.raceId === pick.raceId)).toBeUndefined();
  });
});
