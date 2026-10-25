import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import type { Horse } from "@thoroughbred/shared";
import { aptitudes, conditionRating, fitCheck, horseSummary, recommendIndex } from "./aptitude";

const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" } as const;
/** A starter stable as the database creates it (game-core createStarterStable -> shared Horse). */
function starters(seed: string): Horse[] {
  return gc.createStarterStable({ ownerId: "p", seed, nowMs: 0, season: 1 }).map((s) => gc.toSharedHorse(s, 0, SILKS));
}

describe("aptitude", () => {
  it("rates a horse best in its own conditions on its natural style", () => {
    for (const h of [...starters("apt-a"), ...starters("apt-b")]) {
      const ideal = conditionRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });
      for (const t of ["front", "stalker", "closer"] as const) if (t !== h.style) expect(conditionRating(h, t, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" })).toBeLessThan(ideal);
      expect(conditionRating(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "heavy" })).toBeLessThanOrEqual(ideal);
    }
  });

  it("grades the horse's own conditions as its best", () => {
    for (const h of starters("apt-c")) {
      const a = aptitudes(h);
      expect(a.surface.find((c) => c.key === h.preferredSurface)?.best).toBe(true);
      expect(a.style.find((c) => c.key === h.style)?.grade).toBe("A");
      expect(a.going.find((c) => c.key === "good")?.grade).toBe("A");
      expect(a.trip.some((c) => c.best)).toBe(true);
      expect(horseSummary(h)).toMatch(/^Best at /);
      const fits = fitCheck(h, h.style, { distanceM: h.preferredDistanceM, surface: h.preferredSurface, going: "good" });
      expect(fits.every((f) => f.level === "good")).toBe(true);
    }
  });

  it("recommends a horse deterministically", () => {
    const hs = starters("apt-d");
    const i = recommendIndex(hs);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(recommendIndex(hs)).toBe(i);
  });
});
