/**
 * Guard: Trackside and the 3D view must show the same race. For every course, both scenes
 * register the same landmark set, scenery set, look id and sun side from the stage (the
 * scenes build exactly their plan and expose it as `inventory`).
 */
import { describe, expect, it } from "vitest";
import { fakeReplay } from "../dev/fakeReplay";
import { buildRaceStage } from "./buildRaceStage";
import { COURSE_FIXTURES } from "./courseFixtures";
import { tracksideInventory } from "../trackside/stagePlan";
import { hd2dInventory, hd2dPlan } from "../three/stagePlan";

const replay = fakeReplay({ horses: 10, seed: 7, distanceM: 1200 });

describe.each(COURSE_FIXTURES)("both views agree at $name", (course) => {
  for (const [weather, hour] of [["clear", 14], ["clear", 19], ["rain", 15], ["overcast", 11]] as const) {
    it(`${weather} at ${hour}:00`, () => {
      const stage = buildRaceStage(course, { ...replay, race: { ...replay.race, weather } }, { hour });
      const ts = tracksideInventory(stage);
      const td = hd2dInventory(stage);
      expect(td).toEqual(ts);
      expect(ts.landmarks.some((k) => k.startsWith("post-post@1200.0:far"))).toBe(true);
      expect(ts.landmarks.filter((k) => k.endsWith(":near"))).toEqual([]);
      expect(ts.scenery).toContain(stage.scenery.stand.src);
    });
  }

  it("3D places every landmark on the far side of the track and the stand ~30 m before the line", () => {
    const stage = buildRaceStage(course, replay, { hour: 14 });
    const plan = hd2dPlan(stage);
    for (const p of plan.props) expect(p.z).toBeLessThan(-plan.trackW / 2);
    expect(plan.stand.x).toBeCloseTo(stage.L - 30);
    if (course.finishGradientPermille > 0) expect(plan.props.find((p) => p.kind === "post")!.y).toBeGreaterThan(5);
  });
});
