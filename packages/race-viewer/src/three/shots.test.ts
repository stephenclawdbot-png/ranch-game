/**
 * V-09 / V-10 framing numbers. The screen checks (field share of the frame at t = 0.5 s on three
 * courses, both leaders' noses at the line) run in the capture harness (docs: race-read captures);
 * these pin the geometry the scene fits with.
 */
import { describe, expect, it } from "vitest";
import { GATE_SHOT, JUDGE_SHOT, laneSeparationPx } from "./shots";

describe("3D shot framing (visual research V-09, V-10)", () => {
  it("judge's shot: square to the line, adjacent lanes >= 8 px apart on a phone and a desktop stage", () => {
    expect(JUDGE_SHOT.yaw).toBe(0);
    // The scene keeps a 16:9 frame's horizontal lens on narrow stages (taller vertical FOV) and
    // fits the line's box (the leaders, at least 5 m of track) into `fillX` of the width.
    const frame = (W: number, H: number) => {
      const tanH = Math.tan((JUDGE_SHOT.fov * Math.PI) / 360) * (16 / 9);
      const vfov = (2 * Math.atan(tanH / (W / H)) * 180) / Math.PI;
      const D = (JUDGE_SHOT.reach + 2.7) / (2 * JUDGE_SHOT.fillX * tanH) + 6; // + the near lanes' depth
      return { vfov, D };
    };
    for (const [W, H] of [
      [358, 320],
      [1098, 615],
    ] as const) {
      const { vfov, D } = frame(W, H);
      // adjacent lanes are ~1.2 m apart
      expect(laneSeparationPx(JUDGE_SHOT.elev, D, vfov, H, 1.2), `${W}x${H}`).toBeGreaterThanOrEqual(8);
      // the old judge's shot (12 degrees) left two neighbouring leaders nearly on top of each other
      expect(laneSeparationPx(12, D, vfov, H, 1.2)).toBeLessThan(laneSeparationPx(JUDGE_SHOT.elev, D, vfov, H, 1.2) / 2);
    }
  });

  it("gate shot: low, ahead of the doors looking back across the fronts (lanes spread across the frame)", () => {
    expect(GATE_SHOT.elev).toBeLessThanOrEqual(12);
    expect(GATE_SHOT.yaw).toBeGreaterThan(20);
    // twelve lanes (~14 m deep) spread over this much track width on screen
    expect(14 * Math.sin((GATE_SHOT.yaw * Math.PI) / 180)).toBeGreaterThan(8);
    expect(GATE_SHOT.fillY).toBeGreaterThan(0.62);
  });
});
