/**
 * /api/events: the client allow-list. race_perf reports are accepted with exactly the
 * eight props the client sends; anything extra is dropped, never stored.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { POST } from "../../app/api/events/route";
import { createAccount, resetDbSingleton, schema, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { trackClientBatch, visitorEventsWaiting } from "./playtest";

let h: DbHandle;

beforeAll(async () => {
  h = await dbHandle();
});
afterAll(async () => {
  // resetDbSingleton closes the handle too; don't close it twice.
  await resetDbSingleton();
});

function post(events: unknown[]): Promise<Response> {
  return POST(new Request("https://beta.example/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) }));
}

describe("POST /api/events", () => {
  it("accepts a race_perf report and drops props beyond the eight sent by the client", async () => {
    const gpu = `Test GPU ${Date.now()}`;
    const res = await post([
      {
        name: "race_perf",
        fps: 34,
        fpsLow: 22,
        quality: "low",
        downgraded: true,
        view: "trackside",
        device: "phone",
        dpr: 2.5,
        gpu,
        // Extra junk: zod strips unknown keys, cleanProps caps the stored count.
        secret: "should not be stored",
      },
    ]);
    expect(res.status).toBe(202);
    const rows = await h.db.select().from(schema.telemetryEvents);
    const row = rows.find((r) => r.name === "race_perf");
    expect(row?.props).toEqual({ fps: 34, fpsLow: 22, quality: "low", downgraded: true, view: "trackside", device: "phone", dpr: 2.5, gpu });
  });

  it("stores the baseline fields of a full report (V-00: p99, JS work, slow frames, layout, downgrade time)", async () => {
    const gpu = `Baseline GPU ${Date.now()}`;
    const report = { name: "race_perf", fps: 41, fpsLow: 30, fps99: 19, workMs: 1.4, workP99: 6.2, slowPct: 12.5, quality: "high", downgraded: true, downgradeSec: 18, view: "classic", layout: "phone-closeup", device: "phone", dpr: 3, gpu };
    const res = await post([report]);
    expect(res.status).toBe(202);
    const rows = await h.db.select().from(schema.telemetryEvents);
    const row = rows.find((r) => r.name === "race_perf" && (r.props as { gpu?: string } | null)?.gpu === gpu);
    const { name: _n, ...props } = report;
    expect(row?.props).toEqual(props);
    // an unknown layout is refused
    expect((await post([{ ...report, layout: "tablet-wide" }])).status).toBe(400);
  });

  it("rejects perf props outside the allow-list; other client events still work", async () => {
    const bad = await post([{ name: "race_perf", fps: 12, fpsLow: 8, quality: "ultra", downgraded: false, view: "classic", device: "phone", dpr: 1, gpu: "x" }]);
    expect(bad.status).toBe(400);
    const still = await post([{ name: "session_start" }]);
    expect(still.status).toBe(202);
  });

  it("a visitor's page view never writes; their session start waits for the next write and goes out with it", async () => {
    const all = async () => (await h.db.select().from(schema.telemetryEvents)).length;
    const count = async (name: string) => (await h.db.select().from(schema.telemetryEvents)).filter((r) => r.name === name).length;
    // flush whatever earlier tests left waiting
    await trackClientBatch(h.db, null, [{ name: "race_watched", props: { raceId: "flush" } }]);
    const [views, starts, total] = [await count("page_view"), await count("session_start"), await all()];

    expect((await post([{ name: "page_view", route: "/" }, { name: "session_start", route: "/" }, { name: "page_view", route: "/races" }])).status).toBe(202);
    // nothing reached the database: no row of any kind
    expect(await all()).toBe(total);
    expect(visitorEventsWaiting()).toBe(1);

    // the next batch that is written anyway (here a race watched) carries the waiting session start
    expect((await post([{ name: "race_watched", raceId: "11111111-2222-4333-8444-555555555555" }])).status).toBe(202);
    expect(visitorEventsWaiting()).toBe(0);
    expect(await count("session_start")).toBe(starts + 1);
    expect(await count("page_view")).toBe(views);
    expect(await all()).toBe(total + 2);
  });

  it("a signed-in player's batch is written whole, with the visitors' waiting events", async () => {
    const acc = await createAccount(h.db, { stableName: `Batch Lodge ${Date.now() % 100000}`, silks: { primary: "#112233", secondary: "#445566", pattern: "solid", cap: "#778899" }, starterHorses: 0, now: new Date() });
    await post([{ name: "session_start", route: "/wiki" }]);
    expect(visitorEventsWaiting()).toBe(1);
    const before = (await h.db.select().from(schema.telemetryEvents)).length;
    const out = await trackClientBatch(h.db, acc.accountId, [{ name: "session_start", props: { route: "/" } }, { name: "page_view", props: { route: "/" } }, { name: "page_view", props: { route: "/stable" } }]);
    expect(out).toEqual({ written: 4, deferred: 0, dropped: 0 });
    expect(visitorEventsWaiting()).toBe(0);
    const rows = (await h.db.select().from(schema.telemetryEvents)).slice(before);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.accountId === acc.accountId).map((r) => r.name).sort()).toEqual(["page_view", "page_view", "session_start"]);
    // the visitor's session start stays nobody's
    expect(rows.filter((r) => r.accountId === null).map((r) => r.name)).toEqual(["session_start"]);
  });
});