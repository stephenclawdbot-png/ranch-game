import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { genomeOf, gameCoreHooks, isGenome, toHorseState } from "../gameCore";
import { checkPull } from "../services/economyViews";
import type { HorseRow } from "../schema";

describe("genomes upgrade on read (genetics v2)", () => {
  const v2 = gc.generateFoundationGenome("db-upgrade", { season: 1 });
  /** A genome exactly as the v1 mint stored it (version 1, four breeds, no v2 loci). */
  const v1 = gc.generateFoundationGenomeV1("db-upgrade", { season: 1 });

  it("isGenome accepts both versions; genomeOf upgrades v1 and rejects junk", () => {
    expect(isGenome(v1)).toBe(true);
    expect(isGenome(v2)).toBe(true);
    expect(isGenome({ nonsense: true })).toBe(false);
    const up = genomeOf(v1)!;
    expect(gc.GenomeSchema.safeParse(up).success).toBe(true);
    expect(up.genes2).toEqual(gc.WILD_GENES2);
    expect(up.upgradedFrom).toBe(1);
    expect(gc.potentials(up)).toEqual(gc.potentials({ ...up, genes2: gc.WILD_GENES2, upgradedFrom: 1 }));
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

  it("a pack pull made before genetics v2 (stored v1 genome) still verifies; tampering still fails", () => {
    const serverSeed = "b".repeat(64);
    const accountId = "acct-v1";
    const { pull } = gc.pullPack("paddock", { ...gc.NEW_PITY }, { serverSeed, accountId, season: 1 });
    const stored = gc.generateFoundationGenomeV1(pull.pullSeed, { season: 1, rarity: pull.rarity });
    const input = (genome: unknown) => ({
      packType: "paddock",
      accountId,
      chain: [],
      pull: { pullIndex: 1, seedCommitment: gc.commitSeed(serverSeed), seedReveal: serverSeed, seasonNumber: 1, rarity: pull.rarity, pityApplied: null },
      genome,
      sex: null,
    });
    expect(checkPull(input(stored)).checks.genome).toBe(true);
    expect(checkPull(input(pull.genome)).checks.genome).toBe(true); // a v2 pull
    const bad = structuredClone(stored);
    bad.vigour = [bad.vigour[0] + 1, bad.vigour[1]];
    expect(checkPull(input(bad)).checks.genome).toBe(false);
  });
});
