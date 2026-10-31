import { describe, expect, it } from "vitest";
import { JOCKEY_FACES, JOCKEY_STAGES, facePool, jockeyLookKey, jockeyName, pickJockeyLook, presentsAs, resolveJockeyLook, seedFrom, type JockeyLook } from "./index";

describe("jockey looks", () => {
  it("every stage and presentation has at least 20 base faces", () => {
    for (const stage of JOCKEY_STAGES) {
      for (const who of ["f", "m"] as const) expect(JOCKEY_FACES.filter((f) => f.stage === stage && f.presents === who).length).toBeGreaterThanOrEqual(20);
    }
  });

  it("faces don't repeat while unused ones exist, and full looks stay unique far past the face count", () => {
    const active: JockeyLook[] = [];
    for (let i = 0; i < 1500; i++) {
      const seed = seedFrom("look-test", i);
      const name = jockeyName(seed);
      const stage = JOCKEY_STAGES[i % 3]!;
      const pool = facePool(stage, name);
      const worn = new Set(active.map((l) => l.face));
      const look = pickJockeyLook({ seed, stage, name }, active);
      if (worn.has(look.face)) expect(pool.every((f) => worn.has(f.id))).toBe(true);
      const who = presentsAs(name);
      if (who) expect(JOCKEY_FACES.find((f) => f.id === look.face)!.presents).toBe(who);
      active.push(look);
    }
    const keys = active.map(jockeyLookKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic and keeps a stored look", () => {
    const a = pickJockeyLook({ seed: "s", stage: "prime", name: "Amy Ashby" }, []);
    expect(pickJockeyLook({ seed: "s", stage: "prime", name: "Amy Ashby" }, [])).toEqual(a);
    expect(resolveJockeyLook({ id: "x", name: "Amy Ashby", stage: "veteran", look: a })).toEqual(a);
    // an unknown face falls back to one from the pool
    expect(JOCKEY_FACES.some((f) => f.id === resolveJockeyLook({ id: "x", name: "Amy Ashby", stage: "prime", look: { ...a, face: "gone" } }).face)).toBe(true);
  });
});
