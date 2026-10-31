/**
 * GET /api/races/:id/tote: the public tote board across one Live race. It is the same for every
 * viewer (never reads cookies), leaks nothing about the result before it is public (no
 * positions, no dividends, no audit while the race runs), refuses bets at the off, and shows the
 * audit once the result is out. Uses the shared PGlite singleton, like the route.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("the tote board must not read cookies");
  },
  headers: async () => {
    throw new Error("the tote board must not read request headers");
  },
}));

import { GET } from "../../app/api/races/[id]/tote/route";
import { confirmToteAdult, createAccount, getBalance, placeToteBet, stableOf, type ToteBoard } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { driveCard, enterLive, entryOptions, raceCard, raceList } from "./game";

// A fixed hour a couple of days ahead of the real clock: the database clock (bets close at the
// off by clock_timestamp()) stays behind the test's fake clock, whatever day the test runs.
const HOUR = 3_600_000;
const T0 = new Date(Math.ceil((Date.now() + 2 * 24 * HOUR) / HOUR) * HOUR + 3_000);

let raceId: string;
let postTimeMs: number;
let runners: string[] = [];
let bettor: string;

async function board(): Promise<{ res: Response; body: { available: boolean; board?: ToteBoard }; text: string }> {
  const res = await GET(new Request(`https://tb.example/api/races/${raceId}/tote`), { params: Promise.resolve({ id: raceId }) });
  const text = await res.text();
  return { res, body: JSON.parse(text) as { available: boolean; board?: ToteBoard }, text };
}

async function at<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  vi.setSystemTime(ms);
  try {
    return await fn();
  } finally {
    vi.setSystemTime(T0);
  }
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const h = await dbHandle();
  const acc = await createAccount(h.db, { stableName: "Tote Owner", silks: { pattern: "hoops", primary: "#223344", secondary: "#556677", cap: "#8899aa" }, timezone: "Europe/London", now: T0 });
  const p = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
  await driveCard(h.db, T0, { force: true });
  const { upcoming } = await raceList(h.db, T0, p.stable.id);
  for (const r of [...upcoming].sort((a, b) => a.postTimeMs - b.postTimeMs)) {
    const ok = (await entryOptions(h.db, p, r.id, T0)).options.find((o) => o.reason === null);
    if (!ok) continue;
    await enterLive(h.db, p, r.id, ok.horseId, { tactic: "stalker", intensity: "normal" }, T0);
    raceId = r.id;
    break;
  }
  expect(raceId).toBeTruthy();
  const card = await raceCard(h.db, raceId, T0, p.stable.id);
  postTimeMs = card.config.postTimeMs;
  const b = await createAccount(h.db, { stableName: "Tote Punter", silks: { pattern: "hoops", primary: "#334455", secondary: "#667788", cap: "#99aabb" }, timezone: "Europe/London", now: T0 });
  bettor = b.accountId;
  await confirmToteAdult(h.db, { accountId: bettor, now: T0 });
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("the tote board", () => {
  it("before the off: open, short CDN cache, pool odds only", async () => {
    const h = await dbHandle();
    // The owner's runner is in: bet once the field is locked (Club runners joined) on any runner.
    const locked = await at(postTimeMs - 20_000, async () => {
      await raceCard(h.db, raceId, new Date(), null); // locks the field once entries have closed
      return board();
    });
    expect(locked.body.available).toBe(true);
    runners = locked.body.board!.runners.map((r) => r.horseId);
    expect(runners.length).toBeGreaterThanOrEqual(5);
    await at(postTimeMs - 15_000, () => placeToteBet(h.db, { accountId: bettor, raceId, horseId: runners[0]!, pool: "win", currency: "CR", stake: 100, clientKey: "w1", now: new Date() }));
    await at(postTimeMs - 14_000, () => placeToteBet(h.db, { accountId: bettor, raceId, horseId: runners[1]!, pool: "place", currency: "CR", stake: 50, clientKey: "p1", now: new Date() }));
    const { res, body } = await at(postTimeMs - 10_000, () => board());
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=2, stale-while-revalidate=3");
    expect(body.board!.status).toBe("open");
    expect(body.board!.currencies).toEqual(["CR"]);
    expect(body.board!.pools[0]!.win.total).toBe(100);
    expect(body.board!.pools[0]!.win.runners.find((r) => r.horseId === runners[0])!.oddsMilli).toBe(850);
  });

  it("at the off: no more bets; while the race runs the board leaks nothing about the result", async () => {
    const h = await dbHandle();
    await expect(at(postTimeMs, () => placeToteBet(h.db, { accountId: bettor, raceId, horseId: runners[0]!, pool: "win", currency: "CR", stake: 100, clientKey: "late", now: new Date() }))).rejects.toMatchObject({
      code: "RACE_CLOSED",
    });
    const { body, text } = await at(postTimeMs + 20_000, async () => {
      await driveCard(h.db, new Date(), { force: true });
      return board();
    });
    expect(body.board!.status).toBe("closed");
    expect(body.board!.audit).toEqual([]);
    expect(text).not.toMatch(/"position"|"dividends"|"finish|"payout"|"seed"/);
    expect(body.board!.pools[0]!.win.total).toBe(100);
  });

  it("after the result is public: settled, with a balanced audit", async () => {
    const h = await dbHandle();
    const before = await getBalance(h.db, bettor);
    const { res, body } = await at(postTimeMs + 15 * 60_000, async () => {
      await driveCard(h.db, new Date(), { force: true });
      return board();
    });
    expect(body.board!.status).toBe("settled");
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=60");
    const audit = body.board!.audit;
    expect(audit.length).toBe(2);
    for (const a of audit) {
      expect(a.balanced).toBe(true);
      expect(a.paid + a.takeout + a.remainder).toBe(a.total);
    }
    expect(await getBalance(h.db, bettor)).toBeGreaterThanOrEqual(before);
  });
});
