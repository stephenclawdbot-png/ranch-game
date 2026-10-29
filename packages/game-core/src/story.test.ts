import { describe, expect, it } from "vitest";
import { simulateRace } from "../../racing-engine/src/index";
import {
  LICENCES,
  RIVAL_STABLES,
  STORY_CHAPTER_DEFS,
  chapterRivals,
  currentChapter,
  licenceAfter,
  licenceBlock,
  licenceForTier,
  rivalFor,
  storyProgress,
  storyRaceByKey,
  storyRivalRunner,
} from "./story";
import { STORY_CHAPTERS } from "./economy";
import { createStarterStable } from "./onboarding";
import { raceSnapshot } from "./phenotype";
import { runningStyle } from "./genome";
import { deriveSeed } from "./rng";
import { SILKS, T0 } from "./test-helpers";

describe("story chapters", () => {
  it("four chapters in order, six races each, every surface and the whole trip range", () => {
    expect(STORY_CHAPTER_DEFS.map((c) => c.id)).toEqual([...STORY_CHAPTERS]);
    for (const c of STORY_CHAPTER_DEFS) {
      expect(c.races).toHaveLength(6);
      expect(new Set(c.races.map((r) => r.surface))).toEqual(new Set(["turf", "dirt", "synthetic"]));
      const ds = c.races.map((r) => r.distanceM);
      expect(Math.min(...ds)).toBeLessThanOrEqual(1200);
      expect(Math.max(...ds)).toBeGreaterThanOrEqual(2000);
      for (const r of c.races) {
        expect(storyRaceByKey(r.key)).toBe(r);
        expect(r.rivals.length).toBeGreaterThanOrEqual(2);
        for (const id of r.rivals) expect(RIVAL_STABLES.some((x) => x.id === id)).toBe(true);
        expect(r.intro.length).toBeGreaterThan(20);
      }
      expect(chapterRivals(c.id).length).toBeGreaterThanOrEqual(3);
    }
    // Strength rises chapter by chapter.
    const base = STORY_CHAPTER_DEFS.map((c) => c.races[0]!.strength);
    expect([...base].sort((a, b) => a - b)).toEqual(base);
  });

  it("licences: three wins complete a chapter and earn the next licence; it never goes down", () => {
    expect(licenceAfter(1, new Set(["club-1", "club-2"]))).toBe(1);
    expect(licenceAfter(1, new Set(["club-1", "club-2", "club-6"]))).toBe(2);
    // County wins don't count before the County licence.
    expect(licenceAfter(1, new Set(["county-1", "county-2", "county-3"]))).toBe(1);
    expect(licenceAfter(2, new Set(["county-1", "county-2", "county-3"]))).toBe(3);
    expect(licenceAfter(4, new Set())).toBe(4);
    const all = new Set(STORY_CHAPTER_DEFS.flatMap((c) => c.races.map((r) => r.key)));
    expect(licenceAfter(1, all)).toBe(LICENCES.length);
    expect(currentChapter(1, new Set())).toBe("club");
    expect(currentChapter(2, new Set(["club-1", "club-2", "club-3"]))).toBe("county");
    expect(currentChapter(5, all)).toBe("classics");
    const p = storyProgress(2, new Set(["club-1", "county-2"]));
    expect(p.map((x) => x.unlocked)).toEqual([true, true, false, false]);
    expect(p[0]!.complete).toBe(true);
    expect(p[1]!.won).toEqual(["county-2"]);
  });

  it("licences gate Live classes", () => {
    expect(licenceForTier("maiden")).toBe(1);
    expect(licenceForTier("hcp_0_55")).toBe(1);
    expect(licenceForTier("hcp_50_75")).toBe(2);
    expect(licenceForTier("listed")).toBe(3);
    expect(licenceForTier("g1")).toBe(4);
    expect(licenceForTier("novice", true)).toBe(3);
    expect(licenceForTier("g1", true)).toBe(3);
    expect(licenceForTier("g1", "final")).toBe(4);
    expect(licenceBlock(1, "novice")).toBeNull();
    expect(licenceBlock(1, "hcp_70_95")?.name).toBe("County licence");
    expect(licenceBlock(3, "g3")).toBeNull();
  });

  it("rival runners are deterministic, fit for the race and wear their stable's silks", () => {
    const race = storyRaceByKey("county-2")!;
    const rival = rivalFor(race.rivals, "horse-a")!;
    expect(race.rivals).toContain(rival.id);
    expect(rivalFor(race.rivals, "horse-a")).toBe(rival);
    const a = storyRivalRunner(race, "seed-1", "horse-a", rival);
    expect(storyRivalRunner(race, "seed-1", "horse-a", rival)).toEqual(a);
    expect(a.id).toBe("horse-a");
    expect(a.appearance.silks).toEqual(rival.silks);
    expect(Math.abs(a.preferredDistanceM - race.distanceM)).toBeLessThanOrEqual(250);
  });

  it("Club races are winnable but never a formality for a fitting starter (real engine)", { timeout: 60_000 }, () => {
    let runs = 0;
    let wins = 0;
    let top3 = 0;
    const club = STORY_CHAPTER_DEFS[0]!;
    for (let s = 0; s < 24; s++) {
      const stable = createStarterStable({ ownerId: `o${s}`, seed: `story-cal-${s}`, nowMs: T0, season: 1 });
      for (const race of club.races) {
        const snaps = stable.map(
          (h) => raceSnapshot(h, { nowMs: T0, silks: SILKS, race: { going: race.going, fieldSize: race.fieldSize, bigCrowd: false, surface: race.surface, distanceM: race.distanceM }, plan: { tactic: runningStyle(h.genome), intensity: "normal" } }).horse,
        );
        // The player's pick: on the race's surface if possible, nearest trip.
        const me = [...snaps].sort((x, y) => Number(y.preferredSurface === race.surface) - Number(x.preferredSurface === race.surface) || Math.abs(x.preferredDistanceM - race.distanceM) - Math.abs(y.preferredDistanceM - race.distanceM))[0]!;
        const entries = [{ gate: 1, tactic: me.style, horse: me }];
        for (let i = 1; i < race.fieldSize; i++) {
          const id = `cal-${s}-${race.key}-${i}`;
          const r = storyRivalRunner(race, `cal-${s}`, id, rivalFor(race.rivals, id));
          entries.push({ gate: i + 1, tactic: r.style, horse: r });
        }
        const replay = simulateRace({
          race: { id: `cal-${s}-${race.key}`, name: race.name, distanceM: race.distanceM, surface: race.surface, weather: race.weather, going: race.going, raceClass: race.raceClass, postTimeMs: T0, purse: 0 },
          entries,
          seed: deriveSeed("story-cal", `${s}:${race.key}`),
        });
        const pos = replay.result.finishOrder.find((f) => f.horseId === me.id)!.position;
        runs++;
        if (pos === 1) wins++;
        if (pos <= 3) top3++;
      }
    }
    expect(wins / runs).toBeGreaterThan(0.15);
    expect(wins / runs).toBeLessThan(0.7);
    expect(top3 / runs).toBeGreaterThan(0.4);
  });
});
