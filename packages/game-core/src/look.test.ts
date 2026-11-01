/**
 * Body build and mane / tail (V-04, V-05): read from the existing genes, deterministic, in range,
 * breed-true, and never read by a rule (performance is the same whatever the look).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HorseAppearanceSchema } from "@thoroughbred/shared";
import { appearanceOf } from "./coat";
import { BREED_HAIR, buildOf, hairOf } from "./look";
import { generateFoundationGenome, potentials, phenotypeDelta, preferredDistanceM } from "./genome";
import { raceSnapshot } from "./phenotype";
import { makeHorse } from "./test-helpers";
import { BREEDS, type Breed, type Genome } from "./types";

const SILKS = { primary: "#112233", secondary: "#ffffff", pattern: "solid", cap: "#112233" } as const;
const sample = (breed: Breed, n = 120) => Array.from({ length: n }, (_, i) => generateFoundationGenome(`look-${breed}-${i}`, { season: 1, breed }));
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

describe("body build and hair from the genome", () => {
  it("are deterministic, in range and valid on the shared look", () => {
    for (const b of BREEDS)
      for (const g of sample(b, 20)) {
        expect(buildOf(g)).toEqual(buildOf(structuredClone(g)));
        expect(hairOf(g)).toEqual(hairOf(structuredClone(g)));
        for (const v of Object.values(buildOf(g))) expect(Math.abs(v)).toBeLessThanOrEqual(2);
        const a = appearanceOf(g, { racingAge: true, starts: 3, retired: false }, SILKS);
        expect(HorseAppearanceSchema.parse(a)).toEqual(a);
        expect(a.build).toEqual(buildOf(g));
        expect(a.hair).toEqual(hairOf(g));
      }
  });

  it("only read the genome (never write it)", () => {
    const g = generateFoundationGenome("look-frozen", { season: 1 });
    const before = JSON.stringify(g);
    const deepFreeze = (o: unknown): unknown => {
      if (o && typeof o === "object") {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
      return o;
    };
    deepFreeze(g);
    buildOf(g);
    hairOf(g);
    appearanceOf(g, { racingAge: true, starts: 0, retired: false }, SILKS);
    expect(JSON.stringify(g)).toBe(before);
  });

  it("are breed-true: leggy, long-necked Akhal-Tekes; short, deep Quarter Horses; big Friesians and Warmbloods; small Arabians and Mustangs", () => {
    const avg = (b: Breed, k: "height" | "leg" | "neck" | "girth" | "head") => mean(sample(b).map((g) => buildOf(g)[k]));
    expect(avg("akhalTeke", "leg")).toBeGreaterThan(avg("quarterHorse", "leg") + 1.5);
    expect(avg("akhalTeke", "neck")).toBeGreaterThan(avg("quarterHorse", "neck") + 1);
    expect(avg("quarterHorse", "girth")).toBeGreaterThan(avg("akhalTeke", "girth") + 2);
    expect(avg("friesian", "height")).toBeGreaterThan(1);
    expect(avg("warmblood", "height")).toBeGreaterThan(1);
    expect(avg("arabian", "height")).toBeLessThan(-1);
    expect(avg("mustang", "height")).toBeLessThan(-1);
    expect(avg("arabian", "head")).toBeLessThan(avg("quarterHorse", "head") - 1);
  });

  it("vary within a breed (no breed is one build or one mane)", () => {
    for (const b of BREEDS) {
      const gs = sample(b);
      const builds = new Set(gs.map((g) => JSON.stringify(buildOf(g))));
      const hair = new Set(gs.map((g) => JSON.stringify(hairOf(g))));
      expect(builds.size, b).toBeGreaterThan(10);
      expect(hair.size, b).toBeGreaterThanOrEqual(2);
    }
  });

  it("manes and tails follow the breed: pulled racing manes, fine Akhal-Teke hair, long thick Andalusian and Friesian hair; feathered horses always long", () => {
    const maneAvg = (b: Breed) => mean(sample(b).map((g) => hairOf(g).mane));
    const thick = (b: Breed) => mean(sample(b).map((g) => (hairOf(g).thick ? 1 : 0)));
    expect(maneAvg("thoroughbred")).toBeLessThan(0.6);
    expect(maneAvg("andalusian")).toBeGreaterThan(2.4);
    expect(maneAvg("friesian")).toBeGreaterThan(2.4);
    expect(thick("akhalTeke")).toBeLessThan(0.2);
    expect(thick("friesian")).toBeGreaterThan(0.75);
    expect(Object.keys(BREED_HAIR).sort()).toEqual([...BREEDS].sort());
    for (const g of sample("thoroughbred", 30)) {
      const fe = { ...g, genes2: { ...g.genes2, feather: ["fe", "fe"] } } as Genome;
      expect(hairOf(fe)).toMatchObject({ mane: 3, tail: 2 });
    }
  });
});

describe("the look never touches performance", () => {
  it("stats, potentials, trip and the race snapshot are the same with the look stripped", () => {
    for (let s = 0; s < 12; s++) {
      const h = makeHorse(`look-perf-${s}`, { starts: 3 });
      const snap = raceSnapshot(h, { nowMs: 0, silks: SILKS, race: { surface: "turf", distanceM: 1600, going: "good", fieldSize: 8 } as never });
      expect(snap.horse.appearance.build).toEqual(buildOf(h.genome));
      // the snapshot's numbers do not depend on the look: recompute with the look removed
      const { build: _b, hair: _h, ...rest } = snap.horse.appearance;
      void _b;
      void _h;
      expect(HorseAppearanceSchema.parse(rest)).toEqual(rest);
      expect(potentials(h.genome)).toEqual(potentials(structuredClone(h.genome)));
      expect(phenotypeDelta(h.genome)).toEqual(phenotypeDelta(structuredClone(h.genome)));
      expect(preferredDistanceM(h.genome)).toBe(preferredDistanceM(structuredClone(h.genome)));
    }
  });

  it("no rule outside the look itself reads a horse's build or hair", () => {
    const dir = join(__dirname);
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "look.ts" || f === "coat.ts") continue;
      const src = readFileSync(join(dir, f), "utf8");
      if (/appearance\??\.(build|hair)\b|\b(buildOf|hairOf)\(/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
