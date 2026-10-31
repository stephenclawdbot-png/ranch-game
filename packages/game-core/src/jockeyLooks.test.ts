import { describe, expect, it } from "vitest";
import { JOCKEY_FACES, JOCKEY_KNOWN_FIRST_NAMES, JOCKEY_STAGES, facePool, jockeyGender, jockeyLookKey, jockeyName, pickJockeyLook, riderLookOf, resolveJockeyLook, seedFrom, type JockeyLook } from "./index";

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
      const gender = jockeyGender(name);
      const pool = facePool(stage, gender);
      const worn = new Set(active.map((l) => l.face));
      const look = pickJockeyLook({ seed, stage, gender }, active);
      if (worn.has(look.face)) expect(pool.every((f) => worn.has(f.id))).toBe(true);
      // name gender == bust gender == rider sprite gender
      expect(JOCKEY_FACES.find((f) => f.id === look.face)!.presents).toBe(gender);
      expect(riderLookOf(look).gender).toBe(gender);
      active.push(look);
    }
    const keys = active.map(jockeyLookKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every first name has one gender (the ambiguous ones from the fixed map)", () => {
    for (const n of JOCKEY_KNOWN_FIRST_NAMES) expect(["f", "m"]).toContain(jockeyGender(`${n} Ashby`));
    expect(jockeyGender("Amy Ashby")).toBe("f");
    expect(jockeyGender("Tom Ashby")).toBe("m");
    expect(jockeyGender("Kit Ashby")).toBe("f");
  });

  it("is deterministic and keeps a stored look", () => {
    const a = pickJockeyLook({ seed: "s", stage: "prime", gender: "f" }, []);
    expect(pickJockeyLook({ seed: "s", stage: "prime", gender: "f" }, [])).toEqual(a);
    expect(resolveJockeyLook({ id: "x", name: "Amy Ashby", stage: "veteran", look: a })).toEqual(a);
    // an unknown face falls back to one from the pool
    expect(JOCKEY_FACES.some((f) => f.id === resolveJockeyLook({ id: "x", name: "Amy Ashby", stage: "prime", look: { ...a, face: "gone" } }).face)).toBe(true);
  });
});
