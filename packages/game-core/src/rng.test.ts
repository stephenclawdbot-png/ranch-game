import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Rng, commitSeed, deriveSeed, seedFrom, hash32 } from "./rng";
import { commitSeed as engineCommit, deriveSeed as engineDerive } from "../../racing-engine/src/index";

describe("rng", () => {
  it("is deterministic per seed", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const a = new Rng(s);
        const b = new Rng(s);
        for (let i = 0; i < 20; i++) expect(a.nextU32()).toBe(b.nextU32());
      }),
    );
  });

  it("range / chance / normal stay in bounds", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 0, max: 2000 }), (s, lo, span) => {
        const r = new Rng(s);
        for (let i = 0; i < 50; i++) {
          const v = r.range(lo, lo + span);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(lo + span);
          const n = r.normal();
          expect(Math.abs(n)).toBeLessThan(3.5);
        }
      }),
    );
  });

  it("normal() has roughly unit variance and weighted() respects weights", () => {
    const r = new Rng("stats");
    let s = 0;
    let s2 = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const x = r.normal();
      s += x;
      s2 += x * x;
    }
    expect(Math.abs(s / N)).toBeLessThan(0.03);
    expect(Math.abs(s2 / N - 1)).toBeLessThan(0.05);
    const counts = [0, 0, 0];
    for (let i = 0; i < 10000; i++) counts[r.weighted([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.6);
  });

  it("commitSeed / deriveSeed match the racing engine exactly", () => {
    const seed = seedFrom("x", 1);
    expect(commitSeed(seed)).toBe(engineCommit(seed));
    expect(deriveSeed("secret", "label")).toBe(engineDerive("secret", "label"));
    expect(() => commitSeed("nothex")).toThrow();
    expect(hash32("abc")).toBe(hash32("abc"));
  });
});

describe("purity: no clocks, no Math.random, no transcendental maths in sources", () => {
  const root = join(__dirname);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
    }
  };
  walk(root);
  it.each(files.map((f) => [f.slice(root.length + 1), f]))("%s", (_name, f) => {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|Math\.(exp|log|pow|sin|cos|tan|atan|log10|log2|cbrt|hypot)\b/);
    expect(src).not.toMatch(/from "node:|require\(/);
  });
});
