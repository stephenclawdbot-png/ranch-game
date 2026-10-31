/**
 * Quick races end to end on PGlite (match, ghost, daily challenge):
 *   - each runs on the server with the current race model and leaves the rest of the game exactly
 *     as it was: every table but the quick races' own rows, the rate-limit counters, the daily
 *     seed and the batched match note is compared row for row (ledger, horses, entries, results,
 *     ratings, form, records, leagues, jockeys and rides, tote, picks, horse log ...);
 *   - the replay re-simulates to the stored result;
 *   - match races: only your racing horse against other stables' racing horses, at most four
 *     runners, conditions a course really races on, MATCH_RACES_PER_DAY per stable, a note a day
 *     to an owner whose horse beat the challenger, a head-to-head per pair;
 *   - ghost races: only settled Live races from yesterday on, against their first three as locked;
 *   - the daily challenge: the same puzzle and seed for everyone, one attempt per stable a day,
 *     the seed (and other stables' plans and replays) hidden until the day is over, then revealed
 *     and matching the commitment published with the puzzle.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import * as gc from "@thoroughbred/game-core";
import { commitSeed, createAccount, getQuickRace, getRace, listMatchNotes, listRaceEntries, listStableHorses, resetDbSingleton, rowsOf, stableOf, type DbHandle } from "@thoroughbred/db";
import { simulateRace, verifyReplay } from "@thoroughbred/racing-engine";
import { LIVE_RACE_MODEL, type RaceInput } from "@thoroughbred/shared";
import { GET as GET_HUB } from "../../app/api/quick/route";
import { POST as POST_DAILY } from "../../app/api/quick/daily/route";
import { POST as POST_MATCH } from "../../app/api/quick/match/route";
import { GET as GET_REPLAY } from "../../app/api/quick/[id]/replay/route";
import { dbHandle } from "./db";
import { broadcastEndsAtMs } from "./live";
import { driveCard, enterLive, entryOptions, raceList, servedReplay } from "./game";
import { dailyView, quickHorseReason, quickHub, quickRaceReplay, quickRaceView, runDailyChallenge, runGhostRace, runMatchRace } from "./quickRaces";
import type { Session } from "./session";
import type { MatchRequest } from "@/lib/quickRaces";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const HOUR = 3_600_000;
const DAY = 86_400_000;

let p: Session;
let other: Session;
let third: Session;
let token: string;
let mineIds: string[] = [];
let theirIds: string[] = [];
let thirdIds: string[] = [];
let live: { raceId: string; postTimeMs: number; horseId: string };
let after: Date;

async function player(name: string): Promise<{ s: Session; token: string }> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { s: { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) }, token: acc.token };
}

async function code(x: Promise<unknown>): Promise<string> {
  try {
    await x;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

async function racers(s: Session, at: Date): Promise<string[]> {
  return (await listStableHorses(h.db, s.stable.id)).filter((r) => quickHorseReason(r, at.getTime()) === null).map((r) => r.id);
}

/** Runs an API call with the clock at `at` (the routes read the real clock). */
async function at<T>(when: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(when);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

/** Tables a quick race may write: its own rows, the limiter, the daily seed (economy_config) and the match note (inbox). */
const OWN = new Set(["quick_races", "match_race_runners", "rate_limits", "economy_config", "inbox_items"]);

/** Every other table, row for row. */
async function everythingElse(): Promise<Record<string, string>> {
  const tables = rowsOf<{ table_name: string }>(await h.db.execute("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"));
  const out: Record<string, string> = {};
  for (const { table_name: t } of tables) {
    if (OWN.has(t) || t.startsWith("__drizzle")) continue;
    const rows = rowsOf<Record<string, unknown>>(await h.db.execute(`select * from "${t}"`));
    out[t] = rows.map((r) => JSON.stringify(r)).sort().join("\n");
  }
  return out;
}

async function inboxKinds(): Promise<string[]> {
  return rowsOf<{ kind: string }>(await h.db.execute("select kind from inbox_items order by kind")).map((r) => r.kind);
}

async function configKeys(): Promise<string[]> {
  return rowsOf<{ key: string }>(await h.db.execute("select key from economy_config order by key")).map((r) => r.key);
}

function matchReq(horseId: string, opponentIds: string[], extra: Partial<MatchRequest> = {}): MatchRequest {
  return { horseId, opponentIds, courseId: "ashcombe", distanceM: 1600, surface: "turf", going: "good", ...extra };
}

beforeAll(async () => {
  h = await dbHandle();
  const a = await player("Quick Lodge");
  p = a.s;
  token = a.token;
  jar.token = token;
  other = (await player("Other Lodge")).s;
  third = (await player("Third Lodge")).s;
  mineIds = await racers(p, T0);
  theirIds = await racers(other, T0);
  thirdIds = await racers(third, T0);
  expect(mineIds.length).toBeGreaterThanOrEqual(2);
  expect(theirIds.length).toBeGreaterThanOrEqual(1);

  // A Live race with one of our horses, run and settled (the ghost race source).
  const { upcoming } = await raceList(h.db, T0, p.stable.id);
  for (const r of [...upcoming].sort((x, y) => x.postTimeMs - y.postTimeMs)) {
    const opts = await entryOptions(h.db, p, r.id, T0);
    const ok = opts.options.find((o) => o.reason === null);
    if (!ok) continue;
    await enterLive(h.db, p, r.id, ok.horseId, { tactic: "stalker", intensity: "normal" }, T0);
    live = { raceId: r.id, postTimeMs: r.postTimeMs, horseId: ok.horseId };
    break;
  }
  expect(live).toBeDefined();
}, 180_000);

afterAll(async () => {
  await resetDbSingleton();
});

describe("match races", () => {
  it("runs one-on-one with nothing official moving, and re-simulates to the stored result", async () => {
    const before = await everythingElse();
    const { id } = await runMatchRace(h.db, p, matchReq(mineIds[0]!, [theirIds[0]!], { tactic: "front", going: "soft" }), T0);
    expect(await everythingElse()).toEqual(before);
    const row = (await getQuickRace(h.db, id))!;
    expect(row.mode).toBe("match");
    const input = row.input as RaceInput;
    expect(input.model).toEqual(LIVE_RACE_MODEL);
    expect(input.course?.id).toBe("ashcombe");
    expect(input.race.going).toBe("soft");
    expect(input.race.purse).toBe(0);
    expect(input.entries.find((e) => e.horse.id === mineIds[0])!.tactic).toBe("front");
    const replay = await quickRaceReplay(h.db, p, id, T0);
    expect(verifyReplay(input, replay)).toBe(true);
    expect(replay.result.resultHash).toBe(simulateRace(input).result.resultHash);
    const view = await quickRaceView(h.db, other, id, T0);
    expect(view.badge).toMatch(/unofficial/i);
    expect(view.rows).toHaveLength(2);
    expect(view.match!.records[0]).toMatchObject({ opponentId: theirIds[0], meetings: 1 });
    expect(view.match!.records[0]!.won + view.match!.records[0]!.lost).toBe(1);
    // A fresh seed every time.
    const again = await runMatchRace(h.db, p, matchReq(mineIds[0]!, [theirIds[0]!]), T0);
    expect(((await getQuickRace(h.db, again.id))!.input as RaceInput).seed).not.toBe(input.seed);
  });

  it("tells the other owner once a day when their horse beat the challenger", async () => {
    const before = (await listMatchNotes(h.db, other.accountId, 5)).length;
    const runs = [];
    for (let i = 0; i < 2; i++) runs.push(await runMatchRace(h.db, p, matchReq(mineIds[0]!, [theirIds[0]!, ...(thirdIds[0] ? [thirdIds[0]] : [])]), T0));
    const beaten = [];
    for (const r of runs) {
      const v = await quickRaceView(h.db, p, r.id, T0);
      const mine = v.rows.find((x) => x.mine)!.position;
      if (v.rows.find((x) => x.horseId === theirIds[0])!.position < mine) beaten.push(r.id);
    }
    const notes = await listMatchNotes(h.db, other.accountId, 5);
    expect(notes.length).toBeLessThanOrEqual(1);
    if (beaten.length || before) expect(notes[0]!.title).toMatch(/beat .* in a match race/);
    expect((await inboxKinds()).every((k) => k !== "result")).toBe(true);
  });

  it("refuses a horse that isn't yours, your own horse as the opponent, a field over four and a course's wrong surface", async () => {
    expect(await code(runMatchRace(h.db, p, matchReq(theirIds[0]!, [mineIds[0]!]), T0))).toBe("NOT_OWNER");
    expect(await code(runMatchRace(h.db, p, matchReq(mineIds[0]!, [mineIds[1]!]), T0))).toBe("INVALID_INPUT");
    expect(await code(runMatchRace(h.db, p, matchReq(mineIds[0]!, [mineIds[0]!]), T0))).toBe("INVALID_INPUT");
    expect(await code(runMatchRace(h.db, p, matchReq(mineIds[0]!, [theirIds[0]!], { courseId: "saltmarsh", surface: "dirt" }), T0))).toBe("INVALID_INPUT");
    expect(await code(runMatchRace(h.db, p, matchReq(mineIds[0]!, [theirIds[0]!], { distanceM: 1650 }), T0))).toBe("INVALID_INPUT");
    const res = await at(T0, () => POST_MATCH(new Request("https://tb.example/api/quick/match", { method: "POST", body: JSON.stringify(matchReq(mineIds[0]!, [theirIds[0]!, theirIds[1] ?? theirIds[0]!, thirdIds[0] ?? theirIds[0]!, thirdIds[1] ?? theirIds[0]!])) })));
    expect([400, 422]).toContain(res.status);
  });

  it("stops at MATCH_RACES_PER_DAY a stable, and the hub counts down", async () => {
    const hub = await quickHub(h.db, p, T0);
    expect(hub.match.perDay).toBe(gc.MATCH_RACES_PER_DAY);
    let left = hub.match.remaining;
    expect(left).toBeLessThan(gc.MATCH_RACES_PER_DAY);
    while (left > 0) {
      await runMatchRace(h.db, p, matchReq(mineIds[1]!, [theirIds[0]!]), T0);
      left--;
    }
    expect(await code(runMatchRace(h.db, p, matchReq(mineIds[1]!, [theirIds[0]!]), T0))).toBe("RATE_LIMITED");
    const res = await at(T0, () => POST_MATCH(new Request("https://tb.example/api/quick/match", { method: "POST", body: JSON.stringify(matchReq(mineIds[1]!, [theirIds[0]!])) })));
    expect(res.status).toBe(429);
    // Another stable has its own allowance; and a day later ours is back.
    expect(await code(runMatchRace(h.db, other, matchReq(theirIds[0]!, [mineIds[0]!]), T0))).toBe("ok");
    expect(await code(runMatchRace(h.db, p, matchReq(mineIds[1]!, [theirIds[0]!]), new Date(T0.getTime() + 2 * DAY)))).toBe("ok");
  });
});

describe("ghost races", () => {
  it("are refused before the source race has settled", async () => {
    expect(await code(runGhostRace(h.db, p, { horseId: mineIds[1]!, raceId: live.raceId }, T0))).toBe("NOT_FOUND");
  });

  it("then settle the Live race", async () => {
    const replay = await servedReplay(h.db, live.raceId, new Date(live.postTimeMs + HOUR));
    const end = new Date(broadcastEndsAtMs(replay) + 1000);
    await driveCard(h.db, end, { force: true });
    await driveCard(h.db, new Date(end.getTime() + 5000), { force: true });
    expect((await getRace(h.db, live.raceId))!.status).toBe("settled");
    after = new Date(end.getTime() + 10_000);
  }, 120_000);

  it("runs your horse against the first three as they locked, on the race's own conditions, with nothing official moving", async () => {
    const hub = await quickHub(h.db, p, after);
    const src = hub.ghost.sources.find((s) => s.raceId === live.raceId)!;
    expect(src.top.length).toBeGreaterThan(0);
    const horse = mineIds.find((x) => x !== live.horseId)!;
    const before = await everythingElse();
    const { id } = await runGhostRace(h.db, p, { horseId: horse, raceId: live.raceId, tactic: "closer" }, after);
    expect(await everythingElse()).toEqual(before);
    const row = (await getQuickRace(h.db, id))!;
    const input = row.input as RaceInput;
    const race = (await getRace(h.db, live.raceId))!;
    const conds = race.conditions as { distanceM: number; surface: string; going: string; track: string };
    expect(input.race.distanceM).toBe(conds.distanceM);
    expect(input.race.going).toBe(conds.going);
    expect(input.course?.id).toBe(gc.courseByName(conds.track)!.id);
    expect(input.entries.length).toBe(1 + src.top.filter((t) => t.horseId !== horse).slice(0, gc.GHOST_TOP).length);
    // The ghosts are the locked field's horses (same stats).
    const entries = await listRaceEntries(h.db, live.raceId);
    for (const e of input.entries) if (e.horse.id !== horse) expect(entries.some((x) => x.horseId === e.horse.id)).toBe(true);
    const view = await quickRaceView(h.db, p, id, after);
    expect(view.ghost!.line).toMatch(/You'd have finished/);
    expect(view.rows.filter((r) => !r.mine).every((r) => typeof r.officialPosition === "number")).toBe(true);
    expect(verifyReplay(input, await quickRaceReplay(h.db, p, id, after))).toBe(true);
  });

  it("only for Live races from yesterday on", async () => {
    expect(await code(runGhostRace(h.db, p, { horseId: mineIds[1]!, raceId: live.raceId }, new Date(after.getTime() + 3 * DAY)))).toBe("INVALID_INPUT");
  });
});

describe("the daily challenge", () => {
  const day = Math.floor(T0.getTime() / DAY);
  const close = new Date((day + 1) * DAY + 1000);

  it("is one puzzle and one seed for everyone, one attempt per stable, with nothing official moving", async () => {
    const before = await everythingElse();
    const keys = await configKeys();
    const a = await runDailyChallenge(h.db, p, { tactic: "front", intensity: "all_out", grade: "B" }, T0);
    const b = await runDailyChallenge(h.db, other, { tactic: "closer", intensity: "normal", grade: "E" }, new Date(T0.getTime() + 60_000));
    expect(await everythingElse()).toEqual(before);
    expect((await configKeys()).filter((k) => !keys.includes(k)).every((k) => k.startsWith("daily-challenge-secret:"))).toBe(true);
    const ia = (await getQuickRace(h.db, a.id))!.input as RaceInput;
    const ib = (await getQuickRace(h.db, b.id))!.input as RaceInput;
    expect(ia.seed).toBe(ib.seed);
    const rivals = (x: RaceInput) => JSON.stringify(x.entries.filter((e) => e.horse.id !== gc.dailyHorseId(day)));
    expect(rivals(ia)).toBe(rivals(ib));
    expect(await code(runDailyChallenge(h.db, p, { tactic: "stalker", intensity: "normal", grade: "A" }, T0))).toBe("RACE_LIMIT");
    const res = await at(T0, () => POST_DAILY(new Request("https://tb.example/api/quick/daily", { method: "POST", body: JSON.stringify({ tactic: "stalker", intensity: "normal", grade: "A" }) })));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("RACE_LIMIT");
  });

  it("keeps the seed, other stables' plans and their replays hidden until the day is over", async () => {
    const seed = ((await getQuickRace(h.db, (await dailyView(h.db, p, T0)).mine!.quickRaceId))!.input as RaceInput).seed;
    const mine = await dailyView(h.db, p, T0);
    expect(mine.mine).not.toBeNull();
    expect(mine.seedCommitment).toBe(commitSeed(seed));
    expect(mine.entrants).toBe(2);
    const theirs = mine.board.find((l) => !l.mine)!;
    expect(theirs.plan).toBeNull();
    expect(theirs.quickRaceId).toBeNull();
    // My own replay: the seed masked.
    const r = await quickRaceReplay(h.db, p, mine.mine!.quickRaceId, T0);
    expect(r.seed).not.toBe(seed);
    // Their attempt: refused until the day closes.
    expect(await code(quickRaceView(h.db, other, mine.mine!.quickRaceId, T0))).toBe("TOO_EARLY");
    expect(await code(quickRaceReplay(h.db, other, mine.mine!.quickRaceId, T0))).toBe("TOO_EARLY");
    // Nothing the APIs serve today carries the seed.
    const hub = await at(T0, () => GET_HUB());
    const replayRes = await at(T0, () => GET_REPLAY(new Request("https://tb.example/x"), { params: Promise.resolve({ id: mine.mine!.quickRaceId }) }));
    expect(replayRes.status).toBe(200);
    for (const body of [JSON.stringify(await hub.json()), JSON.stringify(await replayRes.json()), JSON.stringify(await quickRaceView(h.db, p, mine.mine!.quickRaceId, T0))]) {
      expect(body).not.toContain(seed);
    }
  });

  it("reveals the seed once the day is over: it matches the commitment and replays every attempt", async () => {
    const view = await dailyView(h.db, other, close);
    expect(view.day).toBe(day + 1);
    expect(view.yesterday).not.toBeNull();
    expect(commitSeed(view.yesterday!.seed)).toBe(view.yesterday!.seedCommitment);
    expect(view.yesterday!.entrants).toBe(2);
    const yesterday = await dailyView(h.db, p, T0);
    expect(view.yesterday!.seedCommitment).toBe(yesterday.seedCommitment);
    const id = yesterday.mine!.quickRaceId;
    const r = await quickRaceReplay(h.db, other, id, close);
    expect(r.seed).toBe(view.yesterday!.seed);
    const v = await quickRaceView(h.db, other, id, close);
    expect(v.daily!.seed).toBe(view.yesterday!.seed);
    expect(v.daily!.rank).toBeGreaterThan(0);
    // Streak: today (the new day) not done yet, so yesterday's still counts.
    expect(view.streak.current).toBe(1);
    const theirs = (await getQuickRace(h.db, view.yesterday!.mine!.quickRaceId))!;
    expect(view.points).toBe(theirs.points);
    expect(theirs.points).toBe(gc.dailyPoints(theirs.position));
    // One of the two was in the top tenth (the leader): one badge between them.
    const badges = (await dailyView(h.db, p, close)).badges + view.badges;
    expect(badges).toBe(1);
  });
});
