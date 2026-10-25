import { describe, expect, it } from "vitest";
import { RIVAL_POOL, starterHorses } from "@/server/demoData";
import { raceRating } from "@/server/races";
import { aptitudes, conditionRating, fitCheck, horseSummary, recommendIndex } from "./aptitude";

describe("aptitude", () => {
  it("conditionRating mirrors the server's raceRating exactly", () => {
    const horses = [...RIVAL_POOL, ...starterHorses("abc123def456ghij")];
    for (const h of horses)
      for (const tactic of ["front", "stalker", "closer"] as const)
        for (const distanceM of [1000, 1600, 2400])
          for (const surface of ["turf", "dirt", "synthetic"] as const)
            for (const going of ["firm", "soft", "heavy"] as const)
              expect(conditionRating(h, tactic, { distanceM, surface, going })).toBe(raceRating(h, tactic, { distanceM, surface, going }));
  });

  it("grades the horse's own conditions as its best", () => {
    for (const h of starterHorses("abc123def456ghij")) {
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
    const hs = starterHorses("abc123def456ghij");
    const i = recommendIndex(hs);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(recommendIndex(hs)).toBe(i);
  });
});
