import { describe, expect, it } from "vitest";
import { perfReport } from "./perfReport";

describe("perfReport", () => {
  it("holds 60 fps on a steady device", () => {
    const r = perfReport(Array.from({ length: 300 }, () => 1000 / 60), "high", false, "trackside");
    expect(r.fps).toBe(60);
    expect(r.fpsLow).toBe(60);
    expect(r.frames).toBe(300);
    expect(r.quality).toBe("high");
    expect(r.downgraded).toBe(false);
    expect(r.view).toBe("trackside");
  });

  it("separates the median from the p95 tail", () => {
    // 50 frames at 16.7 ms, five hitches at 40 ms, five at 50 ms.
    const ft = Array.from({ length: 60 }, (_, i) => (i < 50 ? 1000 / 60 : i < 55 ? 40 : 50));
    const r = perfReport(ft, "low", true, "classic");
    expect(r.fps).toBe(60);
    expect(r.fpsLow).toBe(20);
    expect(r.quality).toBe("low");
    expect(r.downgraded).toBe(true);
  });

  it("averages the two middle samples for even counts", () => {
    // Sorted [10, 10, 30, 30]: median 20 -> 50 fps, p95 (index 2) 30 -> 33 fps.
    const r = perfReport([30, 10, 30, 10], "high", false, "classic");
    expect(r.fps).toBe(50);
    expect(r.fpsLow).toBe(33);
    expect(r.frames).toBe(4);
  });

  it("takes ring-buffer views (Float32Array) and tolerates empty or zero-length input", () => {
    const buf = new Float32Array([16.7, 16.7, 25, 16.7]);
    expect(perfReport(buf.subarray(0, 4), "high", false, "trackside").fps).toBe(60);
    const none = perfReport(new Float32Array(0), "high", false, "trackside");
    expect(none).toMatchObject({ fps: 0, fpsLow: 0, frames: 0 });
    // Frame times can be clamped to 0: no division by zero.
    expect(perfReport([0, 0, 0], "high", false, "trackside").fps).toBe(0);
  });
});