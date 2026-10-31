/**
 * "What if?" re-runs end to end on PGlite: a Live race and a Story race settled with the
 * player's horses, then
 *   - refused before the race has settled (no peeking at the luck), and for a horse the stable
 *     didn't run (another stable's, a Club runner);
 *   - a no-change re-run of the stored field is the official result (and its result hash);
 *   - one change re-runs on the race's own engine version with no side effects at all: no ledger
 *     postings, no rating, record, form or entry change, no jockey rides or XP;
 *   - answers are cached per (race, horse, change): asking again is free;
 *   - fresh re-runs are rate-limited per account per hour; cached ones still answer;
 *   - the replay is served only for a re-run already made, through the API too.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { verifyReplay } from "@thoroughbred/racing-engine";
import { clearRateLimits, createAccount, ensureJockeyBackfill, getRace, getRaceResult, listJockeys, listRaceEntries, listStableHorses, resetDbSingleton, schema, signJockey, stableOf, type DbHandle } from "@thoroughbred/db";
import { GET as GET_OPTIONS, POST } from "../../app/api/races/[id]/what-if/route";
import { GET as GET_REPLAY } from "../../app/api/races/[id]/what-if/replay/route";
import { dbHandle } from "./db";
import { broadcastEndsAtMs } from "./live";
import type { Session } from "./session";
import { createStoryRace, driveCard, enterLive, entryOptions, lockedRaceInput, raceList, servedReplay } from "./game";
import { lockedRunner, rerun, runWhatIf, whatIfInput, whatIfLimiter, whatIfOptions, whatIfReplay } from "./whatIf";
import { WHAT_IF_PER_HOUR, changeKey, type WhatIfChange, type WhatIfOptionsView, type WhatIfView } from "@/lib/whatIf";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const HOUR = 3_600_000;

let p: Session;
let other: Session;
let token: string;
let live: { raceId: string; postTimeMs: number; horseId: string };
let story: { raceId: string; horseId: string };
let after: Date;

async function player(name: string): Promise<{ s: Session; token: string }> {
  const acc = await createAccount(h.db, { stableName: name, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  return { s: { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) }, token: acc.token };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

/** Everything a re-run must never touch (the whole rows, compared as JSON). */
async function sideEffects(raceId: string, horseId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = async (t: any) => (await h.db.select().from(t)) as Record<string, unknown>[];
  const j = (x: unknown) => JSON.stringify(x);
  return {
    postings: (await all(schema.ledgerPostings)).length,
    txs: (await all(schema.ledgerTransactions)).length,
    horse: j((await all(schema.horses)).find((r) => r.id === horseId)),
    entries: j((await all(schema.raceEntries)).filter((r) => r.raceId === raceId).sort((a, b) => String(a.horseId).localeCompare(String(b.horseId)))),
    result: j((await all(schema.raceResults)).find((r) => r.raceId === raceId)),
    race: j((await all(schema.races)).find((r) => r.id === raceId)),
    rides: (await all(schema.jockeyRides)).length,
    jockeys: j((await all(schema.jockeys)).sort((a, b) => String(a.id).localeCompare(String(b.id)))),
    log: (await all(schema.horseLog)).length,
    inbox: (await all(schema.inboxItems)).length,
  };
}

beforeAll(async () => {
  h = await dbHandle();
  await ensureJockeyBackfill(h.db, T0);
  const a = await player("What If Lodge");
  p = a.s;
  token = a.token;
  jar.token = token;
  other = (await player("Other Lodge")).s;
  // A second jockey of our own (a freelancer signed), to try "another of your jockeys".
  const free = (await listJockeys(h.db, { filter: "freelancers", limit: 5 }))[0]!;
  await signJockey(h.db, { accountId: p.accountId, jockeyId: free.id, now: T0 });

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

describe("what-if before the race has settled", () => {
  it("is refused while entries are open, while it's running and before settlement", async () => {
    expect(await code(whatIfOptions(h.db, p, live.raceId, live.horseId, T0))).toBe("TOO_EARLY");
    const running = new Date(live.postTimeMs + 5_000);
    expect(await code(runWhatIf(h.db, p, live.raceId, live.horseId, { kind: "tactic", tactic: "closer" }, running))).toBe("TOO_EARLY");
    expect(await code(whatIfReplay(h.db, p, live.raceId, live.horseId, "tactic:closer", running))).toBe("TOO_EARLY");
    const res = await GET_OPTIONS(new Request(`https://tb.example/api/races/${live.raceId}/what-if?horseId=${live.horseId}`), { params: Promise.resolve({ id: live.raceId }) });
    expect(res.status).toBe(425);
    expect(JSON.stringify(await res.json())).not.toMatch(/seed|finishOrder|position/);
  });

  it("then settles the races", async () => {
    const replay = await servedReplay(h.db, live.raceId, new Date(live.postTimeMs + HOUR));
    const end = new Date(broadcastEndsAtMs(replay) + 1000);
    await driveCard(h.db, end, { force: true });
    await driveCard(h.db, new Date(end.getTime() + 5000), { force: true });
    expect((await getRace(h.db, live.raceId))!.status).toBe("settled");
    after = new Date(end.getTime() + 10_000);
    // A Story race (no race model, no jockeys) with another horse.
    const entered = new Set((await listRaceEntries(h.db, live.raceId)).map((e) => e.horseId));
    const ids = (await listStableHorses(h.db, p.stable.id)).map((r) => r.id).filter((id) => !entered.has(id));
    const s = await createStoryRace(h.db, p, { horseId: ids[0]!, instant: true }, after);
    story = { raceId: s.raceId, horseId: ids[0]! };
    expect((await getRace(h.db, story.raceId))!.status).toBe("settled");
  }, 120_000);
});

describe("what-if on a settled race", () => {
  it("only for a runner your stable ran or owns", async () => {
    expect(await code(whatIfOptions(h.db, other, live.raceId, live.horseId, after))).toBe("NOT_OWNER");
    const house = (await listRaceEntries(h.db, live.raceId)).find((e) => e.isHouse)!;
    expect(await code(whatIfOptions(h.db, p, live.raceId, house.horseId, after))).toBe("NOT_OWNER");
    expect(await code(runWhatIf(h.db, p, live.raceId, house.horseId, { kind: "tactic", tactic: "front" }, after))).toBe("NOT_OWNER");
  });

  it("a no-change re-run of the stored field is the official result", async () => {
    for (const r of [live, story]) {
      const race = (await getRace(h.db, r.raceId))!;
      const { input, field, replay } = await lockedRaceInput(h.db, race, after);
      const gate = field.runners.find((x) => x.horseId === r.horseId)!.gate;
      const same = rerun(input, lockedRunner(input, gate));
      expect(JSON.stringify(same)).toBe(JSON.stringify(replay));
      expect(verifyReplay(whatIfInput(input, lockedRunner(input, gate)), replay)).toBe(true);
      expect(same.result.resultHash).toBe((await getRaceResult(h.db, r.raceId))!.resultHash);
    }
  });

  it("offers one change of each kind the race had, never the one it ran with", async () => {
    const o = await whatIfOptions(h.db, p, live.raceId, live.horseId, after);
    expect(o.unavailable).toBeNull();
    expect(o.engineVersion).toBe("1.4.0");
    expect(o.tactics).not.toContain(o.current.tactic);
    expect(o.intensities).not.toContain("normal");
    expect(o.extras).toContain("physio");
    expect(o.current.jockeyName).toBeTruthy();
    expect(o.jockeys.length).toBeGreaterThan(0);
    expect(o.jockeys.map((j) => j.id)).not.toContain(o.current.jockeyId);
    expect(o.grades).toEqual(["A", "B", "C", "D", "E"]);
    expect(o.remaining).toBe(WHAT_IF_PER_HOUR);
    const s = await whatIfOptions(h.db, p, story.raceId, story.horseId, after);
    expect(s.extras).toEqual([]);
    expect(s.jockeys).toEqual([]);
    expect(s.grades).toEqual([]);
    expect(s.tactics.length).toBe(2);
  });

  it("re-runs with one change, with no side effects, and caches the answer", async () => {
    await clearRateLimits(h.db, { name: "what-if" });
    const before = await sideEffects(live.raceId, live.horseId);
    const o = await whatIfOptions(h.db, p, live.raceId, live.horseId, after);
    const changes: WhatIfChange[] = [
      { kind: "tactic", tactic: o.tactics[0]! },
      { kind: "intensity", intensity: "all_out" },
      { kind: "extras", extras: o.current.extras.includes("physio") ? [] : ["physio"] },
      { kind: "jockey_grade", grade: "A" },
      ...(o.jockeys[0] ? [{ kind: "jockey" as const, jockeyId: o.jockeys[0].id }] : []),
    ];
    const official = (await getRaceResult(h.db, live.raceId))!;
    for (const c of changes) {
      const v = await runWhatIf(h.db, p, live.raceId, live.horseId, c, after);
      expect(v.cached).toBe(false);
      expect(v.engineVersion).toBe("1.4.0");
      expect(v.changeKey).toBe(changeKey(c));
      expect(v.official.position).toBe((official.result as { finishOrder: { horseId: string; position: number }[] }).finishOrder.find((f) => f.horseId === live.horseId)!.position);
      expect(v.whatIfTop.some((r) => r.mine)).toBe(true);
      expect(v.officialTop.some((r) => r.mine)).toBe(true);
      expect(v.whatIf.sectionals).toHaveLength(3);
      // The same question again: from the cache, identical, and free.
      const again = await runWhatIf(h.db, p, live.raceId, live.horseId, c, after);
      expect(again.cached).toBe(true);
      expect({ ...again, cached: false, remaining: 0 }).toEqual({ ...v, cached: false, remaining: 0 });
    }
    expect(await whatIfLimiter.count(h.db, p.accountId, after.getTime())).toBe(changes.length);
    expect(await sideEffects(live.raceId, live.horseId)).toEqual(before);
    // The options list the answers already in.
    expect((await whatIfOptions(h.db, p, live.raceId, live.horseId, after)).done.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses the choice it already ran with and changes the race can't take", async () => {
    const o = await whatIfOptions(h.db, p, live.raceId, live.horseId, after);
    expect(await code(runWhatIf(h.db, p, live.raceId, live.horseId, { kind: "tactic", tactic: o.current.tactic }, after))).toBe("INVALID_INPUT");
    expect(await code(runWhatIf(h.db, p, story.raceId, story.horseId, { kind: "jockey_grade", grade: "A" }, after))).toBe("INVALID_INPUT");
    expect(await code(runWhatIf(h.db, p, story.raceId, story.horseId, { kind: "extras", extras: ["physio"] }, after))).toBe("INVALID_INPUT");
    // Another stable's jockey isn't yours to put up.
    const theirs = (await listJockeys(h.db, { filter: "mine", stableId: other.stable.id }))[0]!;
    expect(await code(runWhatIf(h.db, p, live.raceId, live.horseId, { kind: "jockey", jockeyId: theirs.id }, after))).toBe("INVALID_INPUT");
  });

  it("a Story race re-runs on its own (course-less, model-less) version", async () => {
    const o = await whatIfOptions(h.db, p, story.raceId, story.horseId, after);
    const v = await runWhatIf(h.db, p, story.raceId, story.horseId, { kind: "tactic", tactic: o.tactics[0]! }, after);
    const race = (await getRace(h.db, story.raceId))!;
    const { replay } = await lockedRaceInput(h.db, race, after);
    expect(v.engineVersion).toBe(replay.engineVersion);
  });

  it("rate-limits fresh re-runs per account per hour; cached answers still come back", async () => {
    await clearRateLimits(h.db, { name: "what-if" });
    for (let i = 0; i < WHAT_IF_PER_HOUR; i++) await whatIfLimiter.hit(h.db, p.accountId, after.getTime());
    expect((await whatIfOptions(h.db, p, live.raceId, live.horseId, after)).remaining).toBe(0);
    expect(await code(runWhatIf(h.db, p, live.raceId, live.horseId, { kind: "jockey_grade", grade: "E" }, after))).toBe("RATE_LIMITED");
    expect((await runWhatIf(h.db, p, live.raceId, live.horseId, { kind: "jockey_grade", grade: "A" }, after)).cached).toBe(true);
    // Through the API (its clock: after the race): 429.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(after);
    const res = await POST(
      new Request(`https://tb.example/api/races/${live.raceId}/what-if`, { method: "POST", body: JSON.stringify({ horseId: live.horseId, change: { kind: "jockey_grade", grade: "D" } }) }),
      { params: Promise.resolve({ id: live.raceId }) },
    );
    vi.useRealTimers();
    expect(res.status).toBe(429);
    // Another account has its own allowance.
    expect(await whatIfLimiter.count(h.db, other.accountId, after.getTime())).toBe(0);
    await clearRateLimits(h.db, { name: "what-if" });
  });

  it("serves the replay of a re-run already made (and nothing else)", async () => {
    const key = changeKey({ kind: "jockey_grade", grade: "A" });
    const r = await whatIfReplay(h.db, p, live.raceId, live.horseId, key, after);
    const v = (await runWhatIf(h.db, p, live.raceId, live.horseId, { kind: "jockey_grade", grade: "A" }, after)) as WhatIfView;
    expect(r.result.finishOrder.find((f) => f.horseId === live.horseId)!.position).toBe(v.whatIf.position);
    expect(r.engineVersion).toBe("1.4.0");
    expect(await code(whatIfReplay(h.db, p, live.raceId, live.horseId, "jockey_grade:C", after))).toBe("NOT_FOUND");
    expect(await code(whatIfReplay(h.db, p, live.raceId, live.horseId, "nonsense", after))).toBe("NOT_FOUND");
    expect(await code(whatIfReplay(h.db, other, live.raceId, live.horseId, key, after))).toBe("NOT_OWNER");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(after);
    const res = await GET_REPLAY(new Request(`https://tb.example/api/races/${live.raceId}/what-if/replay?horseId=${live.horseId}&change=${encodeURIComponent(key)}`), {
      params: Promise.resolve({ id: live.raceId }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { resultHash: string } }).result.resultHash).toBe(r.result.resultHash);
    const opts = await GET_OPTIONS(new Request(`https://tb.example/api/races/${live.raceId}/what-if?horseId=${live.horseId}`), { params: Promise.resolve({ id: live.raceId }) });
    vi.useRealTimers();
    expect(((await opts.json()) as WhatIfOptionsView).horseId).toBe(live.horseId);
  });
});
