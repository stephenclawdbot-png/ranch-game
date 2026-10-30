import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Weather } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import { ART_SIZE, MARKER_MIN_X, buildRaceStage, elevationAt, type RaceStage } from "./buildRaceStage";
import { COURSE_FIXTURES } from "./courseFixtures";

const ART = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/art");
const replay = fakeReplay({ horses: 10, seed: 7, distanceM: 1200 });

function stageFor(id: string | null, hour = 14, weather: Weather = replay.race.weather): RaceStage {
  const course = id ? COURSE_FIXTURES.find((c) => c.id === id)! : null;
  return buildRaceStage(course, { ...replay, race: { ...replay.race, weather } }, { hour });
}

describe("buildRaceStage", () => {
  it("builds every course with its own scenery, the stand ~30 m before the line and far-rail landmarks", () => {
    const fars = new Set<string>();
    for (const c of COURSE_FIXTURES) {
      const s = stageFor(c.id);
      expect(s.L).toBe(1200);
      expect(s.scenery.id).toBe(c.scenery);
      fars.add(s.scenery.far);
      expect(s.scenery.stand.centreX).toBeCloseTo(1170);
      expect(s.scenery.mid.length).toBeGreaterThan(5);
      expect(s.landmarks.winningPost).toMatchObject({ x: 1200, side: "far", roundel: true });
      expect(s.landmarks.finishLine.x).toBe(1200);
      expect(s.landmarks.judgeBox.side).toBe("far");
      expect(s.landmarks.boards.map((b) => b.label)).toEqual(["200", "100"]);
      for (const p of s.landmarks.poles) {
        expect(p.side).toBe("far");
        expect(p.x).toBeGreaterThan(MARKER_MIN_X);
        expect(p.plate.w).toBeLessThan(16); // readable, never a billboard
      }
      // 1200 m: 2f..5f (the 1f spot is the 200 m board's)
      expect(s.landmarks.poles.map((p) => p.label)).toEqual(["2f", "3f", "4f", "5f"]);
      expect(new Set(s.landmarks.poles.map((p) => p.colour)).size).toBeGreaterThan(1);
      expect(s.scenery.crowd[0]!.fromX).toBeLessThan(1200);
      expect(s.scenery.crowd[0]!.toX).toBeGreaterThan(1200);
    }
    expect(fars.size).toBe(6);
  });

  it("Harrowgate climbs to the line, Larkspur runs downhill, the rest are flat", () => {
    const h = stageFor("harrowgate").elevation;
    expect(elevationAt(h, 0)).toBe(0);
    expect(elevationAt(h, 1200)).toBeCloseTo(0.035 * 450, 5);
    const l = stageFor("larkspur").elevation;
    expect(elevationAt(l, 1200)).toBeLessThan(0);
    expect(elevationAt(stageFor("ashcombe").elevation, 1200)).toBe(0);
  });

  it("one look from weather and post hour, the sun on the same side for both views", () => {
    expect(stageFor("ashcombe", 14).look.id).toBe("golden");
    expect(stageFor("ashcombe", 19).look.id).toBe("dusk");
    expect(stageFor("ashcombe", 14, "rain").look.id).toBe("rain");
    const g = stageFor("bellmont", 14).look;
    expect(g.sunSide).toBe("right");
    expect(g.sunDir[0]).toBeGreaterThan(0); // right of the picture
    expect(g.sunDir[2]).toBeLessThan(0); // beyond the far rail
    expect(g.keyDir[2]).toBeGreaterThan(0); // key light from the camera side: front-lit
    expect(g.three.fog).toBe(g.trackside.fog);
    expect(g.three.sky[0]).toBe(g.sky.top);
    expect(stageFor("bellmont", 14, "rain").look.three.rain).toBe(true);
  });

  it("an unknown course keeps the default look (oak line, far hills, the Victorian stand)", () => {
    const s = stageFor(null);
    expect(s.scenery.far).toBe("race/far-hills.png");
    expect(s.scenery.stand.src).toBe("race/grandstand.png");
    expect(s.scenery.mid.some((m) => m.src === "race/bb-tree-oak.png")).toBe(true);
    expect(s.elevation.gradientPermille).toBe(0);
  });

  it("ground fx follow surface and going", () => {
    const mk = (surface: "turf" | "dirt" | "synthetic", going: "firm" | "good" | "soft" | "heavy") =>
      buildRaceStage(null, { ...replay, race: { ...replay.race, surface, going } }, { hour: 12 }).fx.emit[0];
    expect(mk("turf", "firm")).toBe("fx-dust");
    expect(mk("turf", "good")).toBe("fx-divot");
    expect(mk("turf", "heavy")).toBe("fx-mud");
    expect(mk("dirt", "soft")).toBe("fx-mud");
    expect(mk("dirt", "firm")).toBe("fx-dust");
    expect(mk("synthetic", "good")).toBe("fx-mud");
  });

  it.skipIf(!existsSync(join(ART, "manifest.json")))("the art size table matches the files on disk", () => {
    for (const [src, [w, h]] of Object.entries(ART_SIZE)) {
      const b = readFileSync(join(ART, src));
      expect([b.readUInt32BE(16), b.readUInt32BE(20)], src).toEqual([w, h]);
    }
  });
});
