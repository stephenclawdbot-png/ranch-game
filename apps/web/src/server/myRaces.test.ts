/**
 * /api/me/races: the stable's full race history. Filters (horse, kind, wins) apply to both
 * the rows and the summary; pages resume through the cursor; only settled races appear
 * (an entered Live race never does until its broadcast is over and it has settled); a
 * browser without a stable gets 401. Uses the shared PGlite singleton, like the route.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { GET } from "../../app/api/me/races/route";
import { createAccount, getRace, listStableHorses, resetDbSingleton, stableOf, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { broadcastEndsAtMs } from "./live";
import type { Session } from "./session";
import { createStoryRace, driveCard, enterLive, entryOptions, myRaces, raceList, replayStartFor, servedReplay } from "./game";
import { FINISH_LEAD_SEC } from "@/lib/replayStart";
import type { MyRacesView } from "@/lib/types";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);

let p: Session;
let token: string;
/**
 * Settled fixtures: four Story races on the one horse that isn't entered in a Live race (two
 * instant ones share a back-dated post time, for the cursor's tie-break), a Live race the test
 * settles once its broadcast is over, and a later Live race that stays entered but unsettled.
 */
let s1: string;
let s2: string;
let s3: string;
let watchedStory: string;
let live: { raceId: string; postTimeMs: number };
let pendingLive: { raceId: string } | null = null;
let names: Map<string, string>;

async function get(url: string): Promise<Response> {
  return GET(new Request(`https://tb.example${url}`));
}

beforeAll(async () => {
  h = await dbHandle();
  const acc = await createAccount(h.db, { stableName: "History Lodge", silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "Europe/London", now: T0 });
  token = acc.token;
  jar.token = token;
  p = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };

  // Two Live entries while every horse is fresh: the first race that will take one of them is
  // the one this test settles, and a much later one stays pending (story races tire the rest).
  const { upcoming } = await raceList(h.db, T0, p.stable.id);
  const card = [...upcoming].sort((a, b) => a.postTimeMs - b.postTimeMs);
  const enter = async (raceId: string): Promise<string | null> => {
    const opts = await entryOptions(h.db, p, raceId, T0);
    const ok = opts.options.find((o) => o.reason === null);
    if (!ok) return null;
    await enterLive(h.db, p, raceId, ok.horseId, { tactic: "stalker", intensity: "normal" }, T0);
    return ok.horseId;
  };
  const entered: Set<string> = new Set();
  let liveRow: { id: string; postTimeMs: number } | undefined;
  for (const r of card) {
    const horseId = await enter(r.id);
    if (!horseId) continue;
    entered.add(horseId);
    liveRow = { id: r.id, postTimeMs: r.postTimeMs };
    break;
  }
  expect(liveRow).toBeDefined();
  let pendingRow: { id: string } | undefined;
  for (const r of [...card].reverse()) {
    if (r.id === liveRow!.id || r.postTimeMs <= liveRow!.postTimeMs + 240_000) continue;
    const horseId = await enter(r.id);
    if (!horseId) continue;
    entered.add(horseId);
    pendingRow = { id: r.id };
    break;
  }
  expect(pendingRow).toBeDefined();
  live = { raceId: liveRow!.id, postTimeMs: liveRow!.postTimeMs };
  pendingLive = { raceId: pendingRow!.id };

  // Story races for a horse that isn't locked in either Live race.
  const rows = await listStableHorses(h.db, p.stable.id);
  names = new Map(rows.map((r) => [r.id, r.name]));
  const free = rows.filter((r) => !entered.has(r.id));
  expect(free.length).toBeGreaterThanOrEqual(1);
  const h0 = free[0]!.id;
  s1 = (await createStoryRace(h.db, p, { horseId: h0, instant: true }, T0)).raceId;
  s2 = (await createStoryRace(h.db, p, { horseId: h0, instant: true }, at(400))).raceId; // same back-dated post time as s1
  s3 = (await createStoryRace(h.db, p, { horseId: h0, instant: true }, at(2000))).raceId;
  // The next day: the third start today is the daily cap, so the watched (not instant) race posts tomorrow.
  watchedStory = (await createStoryRace(h.db, p, { horseId: h0 }, at(24 * 3_600_000))).raceId;

  // Settle the Live race once its broadcast is over (nothing else is due that early).
  const replay = await servedReplay(h.db, live.raceId, new Date(live.postTimeMs + 3_600_000));
  const end = new Date(broadcastEndsAtMs(replay) + 1000);
  await driveCard(h.db, end, { force: true });
  await driveCard(h.db, new Date(end.getTime() + 5000), { force: true });
  expect((await getRace(h.db, live.raceId))!.status).toBe("settled");
  expect((await getRace(h.db, pendingLive!.raceId))!.status).not.toBe("settled");
}, 180_000);

afterAll(async () => {
  // resetDbSingleton closes the handle too; don't close it twice.
  await resetDbSingleton();
});

describe("GET /api/me/races", () => {
  it("is 401 without a stable", async () => {
    jar.token = null;
    const res = await get("/api/me/races");
    expect(res.status).toBe(401);
    jar.token = token;
  });

  it("lists only settled runs, newest first, with the horse named in each row", async () => {
    const res = await get("/api/me/races");
    expect(res.status).toBe(200);
    const page = (await res.json()) as MyRacesView;
    const ids = page.rows.map((r) => r.raceId);
    expect(new Set(ids)).toEqual(new Set([s1, s2, s3, live.raceId, watchedStory]));
    expect(ids).not.toContain(pendingLive!.raceId);
    expect(page.rows.map((r) => r.postTimeMs)).toEqual([...page.rows.map((r) => r.postTimeMs)].sort((a, b) => b - a));
    for (const r of page.rows) expect(r.horseName).toBe(names.get(r.horseId));
    expect(page.nextCursor).toBeNull();
    // The summary counts the same rows the page lists.
    expect(page.summary.runs).toBe(page.rows.length);
    expect(page.summary.wins).toBe(page.rows.filter((r) => r.position === 1).length);
    expect(page.summary.places).toBe(page.rows.filter((r) => r.position === 2 || r.position === 3).length);
    expect(page.summary.credits).toBe(page.rows.reduce((n, r) => n + r.prize, 0));
  });

  it("filters by horse, kind and wins — rows and summary together", async () => {
    const all = (await (await get("/api/me/races")).json()) as MyRacesView;
    const horseA = [...names.keys()].find((id) => all.rows.some((r) => r.raceId === s1 && r.horseId === id))!;

    const byHorse = (await (await get(`/api/me/races?horse=${horseA}`)).json()) as MyRacesView;
    expect(byHorse.rows.every((r) => r.horseId === horseA)).toBe(true);
    expect(byHorse.rows.map((r) => r.raceId).sort()).toEqual(all.rows.filter((r) => r.horseId === horseA).map((r) => r.raceId).sort());
    expect(byHorse.summary.runs).toBe(byHorse.rows.length);

    const story = (await (await get("/api/me/races?kind=story")).json()) as MyRacesView;
    expect(story.rows.every((r) => r.kind === "story")).toBe(true);
    expect(story.rows.map((r) => r.raceId).sort()).toEqual([s1, s2, s3, watchedStory].sort());

    const liveOnly = (await (await get("/api/me/races?kind=live")).json()) as MyRacesView;
    expect(liveOnly.rows.map((r) => r.raceId)).toEqual([live.raceId]);
    expect(liveOnly.rows[0]!.kind).toBe("live");

    const wins = (await (await get("/api/me/races?wins=1")).json()) as MyRacesView;
    expect(wins.rows.every((r) => r.position === 1)).toBe(true);
    expect(wins.rows).toHaveLength(all.summary.wins);
    expect(wins.summary).toMatchObject({ runs: wins.rows.length, wins: wins.rows.length });
  });

  it("pages through the history with the cursor (ties inside one post time included)", async () => {
    const filter = { kind: "all" as const, winsOnly: false, horseId: null };
    const all = await myRaces(h.db, p, filter, null);
    const pages: typeof all[] = [];
    let cursor: string | null = null;
    do {
      const page = await myRaces(h.db, p, filter, cursor, 2);
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor);
    // 5 runs in pages of 2: a full page, a full page, then one row that ends the cursor.
    expect(pages.map((pg) => pg.rows.length)).toEqual([2, 2, 1]);
    expect(pages.at(-1)!.nextCursor).toBeNull();
    expect(pages.flatMap((pg) => pg.rows)).toEqual(all.rows);
  });
});

describe("replayStartFor (?at=)", () => {
  it("starts a finished race FINISH_LEAD_SEC before the winning time; a race that isn't over ignores the param", async () => {
    const longAfter = new Date(live.postTimeMs + 3_600_000);
    const finished = await servedReplay(h.db, live.raceId, longAfter);
    const start = await replayStartFor(h.db, live.raceId, "finish", longAfter);
    expect(start).toBeCloseTo(finished.result.finishOrder[0]!.finishTimeUs / 1_000_000 - FINISH_LEAD_SEC, 5);
    // Still to come, and mid-broadcast: no start time, so nothing is spoiled.
    expect(await replayStartFor(h.db, live.raceId, "finish", T0)).toBeUndefined();
    expect(await replayStartFor(h.db, live.raceId, "finish", new Date(live.postTimeMs + 5_000))).toBeUndefined();
    expect(await replayStartFor(h.db, pendingLive!.raceId, "finish", T0)).toBeUndefined();
  });
});