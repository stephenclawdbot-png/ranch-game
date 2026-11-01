/**
 * /api/events: the client allow-list. race_perf reports are accepted with exactly the
 * eight props the client sends; anything extra is dropped, never stored.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { POST } from "../../app/api/events/route";
import { resetDbSingleton, schema, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";

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
});