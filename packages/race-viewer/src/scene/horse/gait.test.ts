import { describe, expect, it } from "vitest";
import { GALLOP, hoofTarget, legPhase, solveTwoBone, strideLengthM, type LegId } from "./gait";

describe("gait", () => {
  it("racing strides are 6.5-7.6 m", () => {
    expect(strideLengthM(15)).toBeGreaterThanOrEqual(6.5);
    expect(strideLengthM(17)).toBeLessThanOrEqual(7.6);
    expect(strideLengthM(2)).toBeGreaterThanOrEqual(3);
  });

  it("a planted hoof stays still on the ground (no foot sliding)", () => {
    const strideM = strideLengthM(16);
    const sweep = strideM * 100 * GALLOP.duty;
    for (const kind of ["fore", "hind"] as const) {
      // Body travels strideM per phase unit; world hoof = body + local hoof x.
      const world = (ph: number) => ph * strideM * 100 + hoofTarget(kind, ph, sweep).x;
      const a = world(0.01);
      const b = world(GALLOP.duty - 0.01);
      expect(hoofTarget(kind, 0.05, sweep).stance).toBe(true);
      expect(Math.abs(b - a)).toBeLessThan(1e-6);
    }
  });

  it("swing hooves lift off the ground, stance hooves don't", () => {
    expect(hoofTarget("fore", 0.1, 100).lift).toBe(0);
    expect(hoofTarget("fore", 0.5, 100).lift).toBeGreaterThan(20);
  });

  it("footfall order is a transverse gallop: HL, HR, FL, FR", () => {
    const order = (["HL", "HR", "FL", "FR"] as LegId[]).map((l) => GALLOP.offsets[l]);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(legPhase(GALLOP.offsets.FL, "FL")).toBe(0);
  });

  it("two-bone IK reaches reachable targets", () => {
    const ik = solveTwoBone(0, 0, 20, 80, 50, 45, -1);
    expect(ik.endX).toBeCloseTo(20);
    expect(ik.endY).toBeCloseTo(80);
    expect(Math.hypot(ik.kneeX, ik.kneeY)).toBeCloseTo(50);
  });
});
