import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { genomeOf, gameCoreHooks, isGenome, toHorseState } from "../gameCore";
import type { HorseRow } from "../schema";

/** A v2 genome as stored before genetics v2: version 1, no genes2, four-breed record. */
function asV1(genome: gc.Genome): gc.GenomeV1 {
  const { genes2: _g2, breed, ...rest } = genome;
  const v1Breed = { thoroughbred: 0, arabian: 0, quarterHorse: 0, akhalTeke: 0 } as Record<string, number>;
  for (const k of ["thoroughbred", "arabian", "quarterHorse", "akhalTeke"] as const) v1Breed[k] = breed[k];
  return { ...rest, version: 1, breed: v1Breed } as unknown as gc.GenomeV1;
}

describe("genomes upgrade on read (genetics v2)", () => {
  const v2 = gc.generateFoundationGenome("db-upgrade", { season: 1 });
  const v1 = asV1(v2);

  it("isGenome accepts both versions; genomeOf upgrades v1 and rejects junk", () => {
    expect(isGenome(v1)).toBe(true);
    expect(isGenome(v2)).toBe(true);
    expect(isGenome({ nonsense: true })).toBe(false);
    const up = genomeOf(v1)!;
    expect(gc.GenomeSchema.safeParse(up).success).toBe(true);
    expect(up.genes2).toEqual(gc.WILD_GENES2);
    for (const b of gc.BREEDS) expect(up.breed[b]).toBe(v1.breed[b as keyof gc.GenomeV1["breed"]] ?? 0);
    // v2 passes through untouched.
    expect(genomeOf(v2)).toEqual(v2);
    expect(genomeOf(null)).toBeNull();
  });

  it("toHorseState upgrades a v1 row, so summaries and previews see wild-type v2 loci", () => {
    const row = {
      id: "v1-row",
      name: "Old Horse",
      sex: "female",
      gelded: false,
      ownerStableId: null,
      careerStatus: "racing",
      bound: false,
      starts: 3,
      tradeMinStarts: 5,
      sireId: null,
      damId: null,
      generation: 0,
      genome: v1,
      bornAt: new Date(0),
      birthSeasonNumber: 1,
      careSessions: 20,
      careQuality: 600,
      fitness: 800,
      fatigue: 0,
      fatigueAt: new Date(0),
      updatedAt: new Date(0),
      bond: 100,
      rating: 60,
      wins: 0,
      places: 0,
      shows: 0,
      earnings: 0,
      breedingCount: 0,
      insured: false,
      quirks: null,
      scanned: false,
      injury: null,
      dynamics: null,
    };
    const state = toHorseState(row as unknown as HorseRow, {});
    expect(gc.GenomeSchema.safeParse(state.genome).success).toBe(true);
    const summary = gc.geneticsSummary(state.genome, gc.appearanceOf(state.genome, { racingAge: true, starts: 3, retired: false }, { primary: "#111111", secondary: "#222222", pattern: "solid", cap: "#333333" }), []);
    expect(summary.genes2).toHaveLength(14);
    expect(summary.breedLabel).toMatch(/Purebred|Crossbred/);
  });

  it("breedFoal draws a v2 foal from raw v1 parents (no placeholder fallback)", () => {
    const hook = gameCoreHooks.breedFoal as unknown as (input: { seed: string; sire: { id: string; genome: unknown }; dam: { id: string; genome: unknown }; name: string; coi: number; season: number }) => { genome: gc.Genome };
    const spec = hook({ seed: "foal-seed", sire: { id: "s", genome: v1 }, dam: { id: "d", genome: v1 }, name: "Test Foal", coi: 0, season: 1 });
    expect(gc.GenomeSchema.safeParse(spec.genome).success).toBe(true);
    // v1 parents contribute 0 to the new breeds, so the foal's new shares are all 0.
    for (const b of gc.BREEDS) if (!(b in v1.breed)) expect(spec.genome.breed[b]).toBe(0);
  });

  it("an old race snapshot's v1 horse state still parses (replays render, not fallback)", () => {
    const state = gc.createHorseState({
      id: "snap",
      name: "Snapshot",
      sex: "colt",
      ownerId: "x",
      sireId: null,
      damId: null,
      generation: 0,
      genome: v1,
      bornAtMs: 0,
      bornSeason: 1,
      careSessions: 20,
    } as unknown as Parameters<typeof gc.createHorseState>[0]);
    const parsed = gc.HorseStateSchema.safeParse({ ...state, genome: v1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.genome.genes2).toEqual(gc.WILD_GENES2);
  });
});