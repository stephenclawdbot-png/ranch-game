import { describe, expect, it } from "vitest";
import { RaceReplaySchema } from "@thoroughbred/shared";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { COURSE_ENGINE_VERSION, ENGINE_VERSION, KIT_ENGINE_VERSION, LEGACY_ENGINE_VERSION, engineVersionFor, commitSeed, deriveSeed, marginLabel, simulateRace, splitPurse, verifyReplay } from "./index";
import { checkFrames, makeInput, seedFor, typicalField } from "./test-fixtures";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("determinism", () => {
  const input = makeInput(typicalField(10, 1600), { seed: seedFor(42) });

  it("same input twice gives deep-equal replays", () => {
    const a = simulateRace(input);
    const b = simulateRace(clone(input));
    expect(b).toEqual(a);
    expect(b.result.resultHash).toBe(a.result.resultHash);
  });

  it("entry order never changes the outcome", () => {
    const a = simulateRace(input);
    const shuffled = clone(input);
    shuffled.entries.reverse();
    const mid = shuffled.entries.splice(3, 4);
    shuffled.entries.push(...mid);
    expect(simulateRace(shuffled)).toEqual(a);
  });

  it("different seeds usually give different results", () => {
    const hashes = new Set<string>();
    const winners = new Set<string>();
    for (let s = 0; s < 20; s++) {
      const r = simulateRace(makeInput(typicalField(10, 1600), { seed: seedFor(100 + s) }));
      hashes.add(r.result.resultHash);
      winners.add(r.result.finishOrder[0]!.horseId);
    }
    expect(hashes.size).toBe(20);
    expect(winners.size).toBeGreaterThan(3);
  });

  it("golden result (cross-version reproducibility guard)", () => {
    // If this fails, simulation output changed: bump ENGINE_VERSION (old replays will no longer
    // verify against the new engine) and update these literals deliberately.
    const r = simulateRace(makeInput(typicalField(8, 1600), { seed: seedFor(2024) }));
    // 1.2.0 only added the optional per-runner kit, 1.3.0 the optional course profile and 1.4.0 the
    // optional race model: a race with none of them is the 1.1.0 race, bit for bit, and keeps its
    // 1.1.0 label and result hash (old fairness proofs still hold).
    expect(ENGINE_VERSION).toBe("1.4.0");
    expect(COURSE_ENGINE_VERSION).toBe("1.3.0");
    expect(KIT_ENGINE_VERSION).toBe("1.2.0");
    expect(LEGACY_ENGINE_VERSION).toBe("1.1.0");
    expect(r.engineVersion).toBe("1.1.0");
    expect(r.result.finishOrder[0]!.horseId).toBe("h8");
    expect(r.result.winningTimeUs).toBe(98_029_606);
    expect(r.result.finishOrder.map((f) => f.horseId).join(",")).toBe("h8,h5,h4,h3,h7,h6,h2,h1");
    expect(r.totalTicks).toBe(1978);
    expect(r.result.resultHash).toBe("cd67447eb44b1a18d38831c977d072941db2f128b7df15080ca64d4a07d65133");
    // Frames + commentary digest: catches any change to the race picture, not just the result.
    expect(bytesToHex(sha256(utf8ToBytes(JSON.stringify([r.frames, r.events]))))).toBe(
      "ec6ed62fdb55318e4967760353ea9ee0d24c01f9f053c2b1375399f538015912",
    );
  });
});

describe("replay shape", () => {
  it("passes the schema and frame invariants across distances and conditions", () => {
    const cases = [
      { d: 1000, going: "firm" as const, weather: "clear" as const, n: 2 },
      { d: 1600, going: "good" as const, weather: "rain" as const, n: 16 },
      { d: 2400, going: "soft" as const, weather: "overcast" as const, n: 12 },
      { d: 4000, going: "heavy" as const, weather: "dusk" as const, n: 7 },
    ];
    for (const [k, c] of cases.entries()) {
      const input = makeInput(typicalField(c.n, c.d), { distanceM: c.d, going: c.going, weather: c.weather, seed: seedFor(300 + k) });
      const r = simulateRace(input);
      RaceReplaySchema.parse(r);
      checkFrames(input, r);
      expect(r.tickHz).toBe(20);
      expect(r.sampleEvery).toBe(2);
      expect(r.laneCount).toBe(Math.max(6, c.n));
      expect(r.engineVersion).toBe(engineVersionFor(input.entries));
      expect(r.seedCommitment).toBe(commitSeed(input.seed));
      expect(r.horses.map((h) => h.gate)).toEqual([...r.horses.map((h) => h.gate)].sort((a, b) => a - b));
      // Events: sorted, typed, bounded.
      for (let i = 1; i < r.events.length; i++) expect(r.events[i]!.tick).toBeGreaterThanOrEqual(r.events[i - 1]!.tick);
      expect(r.events[0]!.type).toBe("start");
      expect(r.events.filter((e) => e.type === "finish").length).toBe(1);
      expect(r.events.filter((e) => e.type === "final_furlong").length).toBe(1);
      expect(r.events.length).toBeLessThanOrEqual(32);
      // Results.
      const fo = r.result.finishOrder;
      expect(fo.map((f) => f.position)).toEqual(fo.map((_, i) => i + 1));
      expect(fo[0]!.marginMm).toBe(0);
      expect(r.result.winningTimeUs).toBe(fo[0]!.finishTimeUs);
      expect(r.result.photoFinish).toBe(fo[1]!.marginMm < 150);
      expect(fo.reduce((s, f) => s + f.prize, 0)).toBe(input.race.purse);
      expect(r.totalTicks * 50_000).toBeGreaterThanOrEqual(fo[fo.length - 1]!.finishTimeUs);
    }
  });

  it("events are commentary-sized across many races", () => {
    let total = 0;
    for (let s = 0; s < 30; s++) {
      const r = simulateRace(makeInput(typicalField(10, 1600), { seed: seedFor(700 + s) }));
      expect(r.events.length).toBeGreaterThanOrEqual(6);
      expect(r.events.length).toBeLessThanOrEqual(32);
      for (const e of r.events) expect(e.text.length).toBeGreaterThan(5);
      total += r.events.length;
    }
    expect(total / 30).toBeGreaterThanOrEqual(10);
  });
});

describe("validation", () => {
  it("rejects duplicate gates and duplicate horse ids", () => {
    const dupGate = makeInput(typicalField(4, 1600));
    dupGate.entries[1]!.gate = dupGate.entries[0]!.gate;
    expect(() => simulateRace(dupGate)).toThrow(/gate/);
    const dupId = makeInput(typicalField(4, 1600));
    dupId.entries[2]!.horse.id = dupId.entries[0]!.horse.id;
    expect(() => simulateRace(dupId)).toThrow(/horse id/);
  });

  it("rejects schema-invalid input", () => {
    const bad = makeInput(typicalField(4, 1600));
    (bad as { seed: string }).seed = "xyz";
    expect(() => simulateRace(bad)).toThrow();
    const one = makeInput(typicalField(1, 1600));
    expect(() => simulateRace(one)).toThrow();
  });

  it("handles sparse gate numbers", () => {
    const input = makeInput(typicalField(3, 1200).map((e, i) => ({ ...e, gate: [16, 3, 9][i]! })), { distanceM: 1200 });
    const r = simulateRace(input);
    expect(r.horses.map((h) => h.gate)).toEqual([3, 9, 16]);
    checkFrames(input, r);
  });
});

describe("seeds and verification", () => {
  it("commitSeed is sha256 of the seed bytes", () => {
    expect(commitSeed("0".repeat(64))).toBe("66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925");
    expect(() => commitSeed("ABC")).toThrow();
  });

  it("deriveSeed is HMAC-SHA256(secret, label)", () => {
    expect(deriveSeed("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
    expect(deriveSeed("s", "race-1")).not.toBe(deriveSeed("s", "race-2"));
    expect(deriveSeed("s", "race-1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyReplay accepts genuine replays and rejects tampering", () => {
    const input = makeInput(typicalField(8, 1400), { distanceM: 1400, seed: seedFor(9) });
    const r = simulateRace(input);
    expect(verifyReplay(input, r)).toBe(true);
    expect(verifyReplay(clone(input), clone(r))).toBe(true);

    const t1 = clone(r);
    t1.result.finishOrder[1]!.finishTimeUs -= 1;
    expect(verifyReplay(input, t1)).toBe(false);

    const t2 = clone(r);
    const [a, b] = [t2.result.finishOrder[0]!, t2.result.finishOrder[1]!];
    [a.horseId, b.horseId] = [b.horseId, a.horseId];
    expect(verifyReplay(input, t2)).toBe(false);

    const otherSeed = { ...clone(input), seed: seedFor(10) };
    expect(verifyReplay(otherSeed, r)).toBe(false);

    const t3 = clone(r);
    t3.seed = seedFor(10);
    t3.seedCommitment = commitSeed(t3.seed);
    expect(verifyReplay(input, t3)).toBe(false);

    const t4 = clone(r);
    t4.frames[10]![0]! += 1000;
    expect(verifyReplay(input, t4)).toBe(false);

    // Recomputing the hash over a forged order must still fail (re-simulation disagrees).
    const forged = clone(input);
    forged.entries[0]!.horse.stats.speed = 1000;
    expect(verifyReplay(forged, r)).toBe(false);
  });
});

describe("result helpers", () => {
  it("labels margins", () => {
    expect(marginLabel(0)).toBe("nose");
    expect(marginLabel(149)).toBe("nose");
    expect(marginLabel(150)).toBe("short head");
    expect(marginLabel(500)).toBe("head");
    expect(marginLabel(1000)).toBe("neck");
    expect(marginLabel(1200)).toBe("1/2");
    expect(marginLabel(1800)).toBe("3/4");
    expect(marginLabel(2400)).toBe("1");
    expect(marginLabel(3000)).toBe("1 1/4");
    expect(marginLabel(3600)).toBe("1 1/2");
    expect(marginLabel(4200)).toBe("1 3/4");
    expect(marginLabel(4800)).toBe("2");
    expect(marginLabel(6000)).toBe("2 1/2");
    expect(marginLabel(7200)).toBe("3");
    expect(marginLabel(24_000)).toBe("10");
    expect(marginLabel(36_000)).toBe("15");
    expect(marginLabel(40_000)).toBe("dist");
    // Monotonic non-decreasing in size.
    const order = ["nose", "short head", "head", "neck"];
    let last = -1;
    for (let mm = 0; mm < 1200; mm += 10) {
      const k = order.indexOf(marginLabel(mm));
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });

  it("splits purses", () => {
    expect(splitPurse(10_000, 8)).toEqual([5500, 2000, 1200, 700, 400, 200, 0, 0]);
    expect(splitPurse(999, 6)).toEqual([554, 199, 119, 69, 39, 19]);
    expect(splitPurse(1000, 2).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitPurse(0, 4)).toEqual([0, 0, 0, 0]);
    const big = Number.MAX_SAFE_INTEGER - 1;
    expect(splitPurse(big, 6).reduce((a, b) => a + b, 0)).toBe(big);
  });
});

describe("performance", () => {
  it("16 horses x 4000 m simulates in < 60 ms after warmup", () => {
    const input = makeInput(typicalField(16, 4000), { distanceM: 4000, seed: seedFor(77) });
    for (let i = 0; i < 3; i++) simulateRace(input);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      simulateRace(input);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]!).toBeLessThan(60);
  });
});

describe("portability", () => {
  it("engine sources use no wall clock, randomness, float transcendental or host-specific APIs", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL(".", import.meta.url);
    const forbidden = [
      /Math\.random/,
      /Date\.now|new Date/,
      /performance\.now/,
      /Math\.(sin|cos|tan|exp|expm1|log|log2|log10|pow|sqrt|cbrt|hypot|atan2?|fround)\b/,
      /\*\*/,
      /\bprocess\./,
      /\brequire\(/,
      /\b(window|document)\./,
      /from "node:/,
    ];
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-fixtures.ts");
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const re of forbidden) expect(re.test(src), `${f} matches ${re}`).toBe(false);
    }
  });
});
