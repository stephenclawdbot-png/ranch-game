import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { NEW_PITY, PACK_ODDS, PACK_PITY, freePaddockEarned, oddsTable, packBinding, packBlock, pullPack, rarityFromRoll, verifyPull, type PackAllowance } from "./packs";
import { meanCeiling, meanPotential, potentialCeiling, potentials, rarityOf } from "./genome";
import { PackPullSchema, RARITY_ORDER, STAT_KEYS, type PackType, type PityState } from "./types";
import { seedFrom } from "./rng";

const serverSeed = seedFrom("pack-server");
const rank = (r: string) => RARITY_ORDER.indexOf(r as never);

describe("pack odds", () => {
  it("published tables sum to 100% and paddock packs are Common/Uncommon only", () => {
    for (const pack of ["paddock", "premium"] as PackType[]) expect(Object.values(PACK_ODDS[pack]).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(oddsTable("paddock").map((r) => r.rarity)).toEqual(["common", "uncommon"]);
    expect(rarityFromRoll("premium", 9999)).toBe("legendary");
    expect(rarityFromRoll("premium", 0)).toBe("common");
  });

  it("observed rates match the published odds (before pity)", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const r = pullPack("premium", { sinceRare: 0, sinceEpic: 0, pulls: i }, { serverSeed, accountId: "a", season: 1 });
      counts[r.pull.rarity] = (counts[r.pull.rarity] ?? 0) + 1;
    }
    expect(counts.common! / 4000).toBeGreaterThan(0.31);
    expect(counts.common! / 4000).toBeLessThan(0.39);
    expect(counts.rare! / 4000).toBeGreaterThan(0.19);
    expect(counts.legendary! / 4000).toBeLessThan(0.03);
  });
});

describe("pity guarantees (property)", () => {
  for (const pack of ["paddock", "premium"] as PackType[]) {
    it(`${pack}: every guarantee holds for any account and sequence`, () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 120 }), (account, n) => {
          let pity: PityState = NEW_PITY;
          const results: string[] = [];
          for (let i = 0; i < n; i++) {
            const r = pullPack(pack, pity, { serverSeed, accountId: account, season: 1 });
            results.push(r.pull.rarity);
            pity = r.pity;
          }
          for (const rule of PACK_PITY[pack]) {
            let since = 0;
            for (const r of results) {
              since = rank(r) >= rank(rule.min) ? 0 : since + 1;
              expect(since).toBeLessThan(rule.within);
            }
          }
        }),
        { numRuns: 60 },
      );
    });
  }
});

describe("pulls", () => {
  it("are foals under the season ceiling, of the rolled rarity, and verifiable after reveal", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 1, max: 15 }), (account, pulls, season) => {
        const pity = { sinceRare: pulls % 10, sinceEpic: pulls % 50, pulls };
        const { pull } = pullPack("premium", pity, { serverSeed, accountId: account, season });
        expect(PackPullSchema.safeParse(pull).success).toBe(true);
        expect(rarityOf(pull.genome)).toBe(pull.rarity);
        for (const k of STAT_KEYS) expect(potentials(pull.genome)[k]).toBeLessThanOrEqual(potentialCeiling(season));
        expect(meanPotential(pull.genome)).toBeLessThanOrEqual(meanCeiling(season));
        expect(verifyPull(pull, serverSeed, account, pity)).toBe(true);
        expect(verifyPull(pull, seedFrom("other"), account, pity)).toBe(false);
        expect(verifyPull({ ...pull, rarity: "legendary" }, serverSeed, account, pity)).toBe(pull.rarity === "legendary");
      }),
      { numRuns: 80 },
    );
  });
});

describe("limits", () => {
  const a: PackAllowance = { playDays: 3, freePaddockClaimed: 0, paddockBoughtThisWeek: 0, premiumThisWeek: 0, seasonCropUsed: 0, stallsFree: 1, credits: 5000, premiumAllowedInRegion: true };
  it("free paddock every 3rd play day (not consecutive), 3 bought a week, premium 10 a week", () => {
    expect(freePaddockEarned(2)).toBe(0);
    expect(freePaddockEarned(9)).toBe(3);
    expect(packBlock("free", a)).toBeNull();
    expect(packBlock("free", { ...a, freePaddockClaimed: 1 })).toBe("no_free_pack");
    expect(packBlock("credits", { ...a, paddockBoughtThisWeek: 3 })).toBe("weekly_limit");
    expect(packBlock("credits", { ...a, credits: 10 })).toBe("insufficient_credits");
    expect(packBlock("premium", { ...a, premiumThisWeek: 10 })).toBe("weekly_limit");
    expect(packBlock("premium", { ...a, premiumAllowedInRegion: false })).toBe("region_blocked");
  });
  it("needs a stall and respects the seasonal global crop cap", () => {
    expect(packBlock("credits", { ...a, stallsFree: 0 })).toBe("no_stall");
    expect(packBlock("credits", { ...a, seasonCropUsed: 10_000 })).toBe("crop_cap");
    expect(packBlock("credits", { ...a, seasonCropUsed: 5, seasonCropCap: 5 })).toBe("crop_cap");
  });
  it("free-pack foals are Club-bred", () => {
    expect(packBinding("free")).toBe("club_bred");
    expect(packBinding("credits")).toBe("free");
  });
});
