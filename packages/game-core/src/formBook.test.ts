import { describe, expect, it } from "vitest";
import { MIN_SPLIT_RUNS, beatenMmOf, compareBuckets, drawBucket, formSplits, restBucket, splitRecord, type SplitRun } from "./formBook";
import { MS_PER_DAY, MS_PER_HOUR } from "./time";

let n = 0;
function run(over: Partial<SplitRun> = {}): SplitRun {
  n++;
  return {
    horseId: "h1",
    raceId: `r${String(n).padStart(3, "0")}`,
    postTimeMs: n * MS_PER_DAY,
    position: 5,
    fieldSize: 10,
    beatenMm: 6000,
    going: "good",
    surface: "turf",
    course: "Kestrel Downs",
    distanceM: 1600,
    tactic: "stalker",
    jockey: "apprentice",
    gate: 5,
    ...over,
  };
}

const group = (s: ReturnType<typeof formSplits>, dim: string) => s.groups.find((g) => g.dimension === dim)!;
const bucket = (s: ReturnType<typeof formSplits>, dim: string, key: string) => group(s, dim).buckets.find((b) => b.key === key);

describe("form book helpers", () => {
  it("puts the gate in its third of the field", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => drawBucket(g, 9))).toEqual(["low", "low", "low", "mid", "mid", "mid", "high", "high", "high"]);
    expect(drawBucket(1, 5)).toBe("low");
    expect(drawBucket(5, 5)).toBe("high");
    expect(drawBucket(null, 8)).toBeNull();
    // A gate past the field (an old row) counts as the outside draw, never out of range.
    expect(drawBucket(14, 12)).toBe("high");
  });

  it("buckets the rest since the previous run", () => {
    expect(restBucket(null, 5)).toBe("first");
    expect(restBucket(0, 3 * MS_PER_HOUR)).toBe("same_day");
    expect(restBucket(0, MS_PER_DAY)).toBe("1_2_days");
    expect(restBucket(0, 2 * MS_PER_DAY + MS_PER_HOUR)).toBe("1_2_days");
    expect(restBucket(0, 3 * MS_PER_DAY)).toBe("3_6_days");
    expect(restBucket(0, 7 * MS_PER_DAY)).toBe("7_plus_days");
  });

  it("adds the margins of every finisher ahead to get the beaten distance", () => {
    const order = [
      { position: 1, marginMm: 0 },
      { position: 2, marginMm: 1200 },
      { position: 3, marginMm: 300 },
      { position: 4, marginMm: 2400 },
    ];
    expect(beatenMmOf(order, 1)).toBe(0);
    expect(beatenMmOf(order, 2)).toBe(1200);
    expect(beatenMmOf(order, 4)).toBe(3900);
    expect(beatenMmOf([], 3)).toBeNull();
  });

  it("writes a record as wins-seconds-thirds from runs", () => {
    expect(splitRecord({ wins: 2, seconds: 1, thirds: 0, runs: 3 })).toBe("2-1-0 from 3");
  });
});

describe("formSplits", () => {
  it("counts wins, places and the average beaten distance per bucket", () => {
    const s = formSplits([
      run({ position: 1, beatenMm: 0, going: "good" }),
      run({ position: 2, beatenMm: 1000, going: "good" }),
      run({ position: 1, beatenMm: 0, going: "good" }),
      run({ position: 7, beatenMm: 9000, going: "soft" }),
      run({ position: 3, beatenMm: 2001, going: "soft" }),
    ]);
    expect(s.total).toMatchObject({ runs: 5, wins: 2, seconds: 1, thirds: 1 });
    expect(bucket(s, "going", "good")).toMatchObject({ runs: 3, wins: 2, seconds: 1, thirds: 0, avgBeatenMm: 333, small: false });
    expect(bucket(s, "going", "soft")).toMatchObject({ runs: 2, wins: 0, thirds: 1, avgBeatenMm: 5500, small: true });
    // Every run was a mile on turf at Kestrel Downs.
    expect(bucket(s, "distance", "mile")!.runs).toBe(5);
  });

  it("orders buckets in the game's order, unknown keys after, alphabetically", () => {
    const s = formSplits([run({ going: "heavy" }), run({ going: "firm" }), run({ going: "good" }), run({ jockey: "Zed Rider" }), run({ jockey: "top" }), run({ jockey: "Amy Rider" })]);
    expect(group(s, "going").buckets.map((b) => b.key)).toEqual(["firm", "good", "heavy"]);
    expect(group(s, "jockey").buckets.map((b) => b.key)).toEqual(["apprentice", "top", "Amy Rider", "Zed Rider"]);
  });

  it("leaves a run out of a dimension it has no value for (old races without a course or a gate)", () => {
    const s = formSplits([run({ course: null, gate: null, beatenMm: null }), run(), run()]);
    expect(bucket(s, "course", "Kestrel Downs")!.runs).toBe(2);
    expect(group(s, "course").buckets).toHaveLength(1);
    expect(group(s, "draw").buckets.reduce((a, b) => a + b.runs, 0)).toBe(2);
    expect(s.total.runs).toBe(3);
    // The average uses only the runs with margins.
    expect(s.total.avgBeatenMm).toBe(6000);
    expect(s.total.beatenRuns).toBe(2);
  });

  it("computes the rest per horse, whatever order the runs come in", () => {
    const a1 = run({ horseId: "a", postTimeMs: 0 });
    const b1 = run({ horseId: "b", postTimeMs: 2 * MS_PER_HOUR });
    const a2 = run({ horseId: "a", postTimeMs: 4 * MS_PER_HOUR });
    const a3 = run({ horseId: "a", postTimeMs: 10 * MS_PER_DAY });
    const s1 = formSplits([a3, b1, a2, a1]);
    const s2 = formSplits([a1, a2, a3, b1]);
    expect(s1).toEqual(s2);
    expect(bucket(s1, "rest", "first")!.runs).toBe(2);
    expect(bucket(s1, "rest", "same_day")!.runs).toBe(1);
    expect(bucket(s1, "rest", "3_6_days")).toBeUndefined();
    expect(bucket(s1, "rest", "7_plus_days")!.runs).toBe(1);
  });

  it("flags small samples and never picks them as best or worst", () => {
    const runs = [
      // good: 3 runs, all won
      run({ going: "good", position: 1, beatenMm: 0 }),
      run({ going: "good", position: 1, beatenMm: 0 }),
      run({ going: "good", position: 1, beatenMm: 0 }),
      // soft: 3 runs, beaten far
      run({ going: "soft", position: 8, beatenMm: 12000 }),
      run({ going: "soft", position: 6, beatenMm: 8000 }),
      run({ going: "soft", position: 3, beatenMm: 2000 }),
      // heavy: one dreadful run, a small sample
      run({ going: "heavy", position: 10, beatenMm: 40000 }),
    ];
    const s = formSplits(runs);
    expect(bucket(s, "going", "heavy")!.small).toBe(true);
    expect(MIN_SPLIT_RUNS).toBe(3);
    expect(s.best).toMatchObject({ dimension: "going", bucket: { key: "good", wins: 3 } });
    expect(s.worst).toMatchObject({ dimension: "going", bucket: { key: "soft", runs: 3 } });
    expect(splitRecord(s.best!.bucket)).toBe("3-0-0 from 3");
  });

  it("names no best or worst until a dimension has two buckets with enough runs", () => {
    const s = formSplits([run({ going: "good" }), run({ going: "good" }), run({ going: "good" }), run({ going: "soft" }), run({ going: "soft" })]);
    expect(s.best).toBeNull();
    expect(s.worst).toBeNull();
    expect(formSplits([]).best).toBeNull();
    expect(formSplits([]).total.runs).toBe(0);
  });

  it("breaks ties on win rate, then places, then sample size, then the fixed order", () => {
    const a = { key: "a", runs: 4, wins: 1, seconds: 0, thirds: 0, beatenSumMm: 8000, beatenRuns: 4, avgBeatenMm: 2000, small: false };
    const b = { ...a, key: "b", wins: 2 };
    expect(compareBuckets(b, a)).toBeLessThan(0);
    const c = { ...a, key: "c", seconds: 1 };
    expect(compareBuckets(c, a)).toBeLessThan(0);
    // A smaller average beaten distance beats any win rate.
    const e = { ...a, key: "e", wins: 0, beatenSumMm: 7996 };
    expect(compareBuckets(e, b)).toBeLessThan(0);
    // Margins known beat none known.
    const f = { ...a, key: "f", wins: 4, beatenSumMm: 0, beatenRuns: 0, avgBeatenMm: null };
    expect(compareBuckets(a, f)).toBeLessThan(0);
  });

  it("ranks the larger sample first when the rates are level", () => {
    const a = { key: "a", runs: 4, wins: 1, seconds: 0, thirds: 0, beatenSumMm: 8000, beatenRuns: 4, avgBeatenMm: 2000, small: false };
    const d = { ...a, key: "d", runs: 8, wins: 2, beatenSumMm: 16000, beatenRuns: 8 };
    expect(compareBuckets(d, a)).toBeLessThan(0);
  });

  it("names neither when every condition is level, and breaks exact ties by the fixed order", () => {
    const level = [
      run({ going: "good", surface: "turf", position: 2, beatenMm: 1000 }),
      run({ going: "good", surface: "turf", position: 2, beatenMm: 1000 }),
      run({ going: "good", surface: "turf", position: 2, beatenMm: 1000 }),
      run({ going: "soft", surface: "turf", position: 2, beatenMm: 1000 }),
      run({ going: "soft", surface: "turf", position: 2, beatenMm: 1000 }),
      run({ going: "soft", surface: "turf", position: 2, beatenMm: 1000 }),
    ];
    const s = formSplits(level);
    expect(s.best).toBeNull();
    expect(s.worst).toBeNull();

    // Two buckets tie for best: the one earlier in the fixed order (firm before good) is named.
    const tied = [
      ...[1, 2, 3].map(() => run({ going: "firm", position: 1, beatenMm: 0 })),
      ...[1, 2, 3].map(() => run({ going: "good", position: 1, beatenMm: 0 })),
      ...[1, 2, 3].map(() => run({ going: "soft", position: 9, beatenMm: 9000 })),
    ];
    const t = formSplits(tied);
    expect(t.best!.bucket.key).toBe("firm");
    expect(t.worst!.bucket.key).toBe("soft");
  });
});
