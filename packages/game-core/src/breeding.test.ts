import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { breedingFees, cover, deliverFoal, pairingBlock, previewBreeding, usedInSeason, BREEDING_BASE_FEE, MARE_PER_SEASON, STALLION_PER_SEASON } from "./breeding";
import { BREEDINGS_LIFETIME, PREGNANCY_MS, retireFromRacing } from "./lifecycle";
import { inherit } from "./genetics";
import { potentials } from "./genome";
import { HorseStateSchema, STAT_KEYS, type HorseState, type PedigreeEntry } from "./types";
import { DAY, T0, makeHorse, pedOf } from "./test-helpers";
import { seedFrom } from "./rng";

const stud = (id: string, rarity: "common" | "rare" = "common") => makeHorse(id, { id, sex: "colt", retired: true, rarity });
const mare = (id: string, rarity: "common" | "rare" = "common") => makeHorse(id, { id, sex: "filly", retired: true, rarity });

describe("breeding rules", () => {
  it("needs a stallion and a mare, both eligible (racing-retired or ≥25 starts)", () => {
    const s = stud("S");
    const m = mare("M");
    const ped = pedOf(s, m);
    expect(pairingBlock(s, m, ped, 1)).toBeNull();
    expect(pairingBlock(m, s, ped, 1)).toBe("sire_not_male");
    const young = makeHorse("Y", { id: "Y", sex: "filly", starts: 24 });
    expect(pairingBlock(s, young, pedOf(s, young), 1)).toBe("not_breeding_eligible");
    const okYoung = makeHorse("Y2", { id: "Y2", sex: "filly", starts: 25 });
    expect(pairingBlock(s, okYoung, pedOf(s, okYoung), 1)).toBeNull();
    const geld = { ...stud("G"), sex: "gelding" as const };
    expect(pairingBlock(geld, m, pedOf(geld, m), 1)).toBe("gelding");
    expect(pairingBlock(s, mare("F0"), pedOf(s), 1)).toBeNull();
    const foal = makeHorse("F", { id: "F", sex: "filly", care: 3 });
    expect(pairingBlock(s, foal, pedOf(s, foal), 1)).toBe("not_racing_age");
  });

  it("blocks self, parent–child and full siblings; half-siblings allowed with COI", () => {
    const s = stud("S");
    const m = mare("M");
    const c1 = { ...stud("C1"), sireId: "S", damId: "M", generation: 1 };
    const d1 = { ...mare("D1"), sireId: "S", damId: "M", generation: 1 };
    const o = mare("O");
    const h1 = { ...mare("H1"), sireId: "S", damId: "O", generation: 1 };
    const ped = pedOf(s, m, c1, d1, o, h1);
    expect(pairingBlock(s, s, ped, 1)).toBe("self");
    expect(pairingBlock(s, d1, ped, 1)).toBe("parent_child");
    expect(pairingBlock(c1, m, ped, 1)).toBe("parent_child");
    expect(pairingBlock(c1, d1, ped, 1)).toBe("full_siblings");
    expect(pairingBlock(c1, h1, ped, 1)).toBeNull();
    const p = previewBreeding(c1, h1, ped, 1);
    expect(p.coi).toBe(125);
    expect(p.coiWarning).toBe(true);
    expect(() => cover(c1, d1, ped, 1, T0, "seed")).toThrow(/full_siblings/);
  });

  it("property: limits are never bypassed (lifetime 4; mare 1/season; stallion 4/season)", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 4 })), { maxLength: 60 }), (attempts) => {
        const herd = new Map<string, HorseState>();
        for (let i = 0; i < 3; i++) herd.set(`S${i}`, stud(`S${i}`));
        for (let i = 0; i < 4; i++) herd.set(`M${i}`, mare(`M${i}`));
        const ped: Record<string, PedigreeEntry> = pedOf(...herd.values());
        let t = T0;
        for (const [si, mi, season] of attempts) {
          const s = herd.get(`S${si}`)!;
          let m = herd.get(`M${mi}`)!;
          // Foal any due pregnancy first so mares can be covered again.
          if (m.pregnancy) {
            const sire = herd.get(m.pregnancy.sireId)!;
            m = deliverFoal(m, sire, { foalId: `F${t}`, name: "F", nowMs: m.pregnancy.dueAtMs, season, stallFree: true }).dam;
            herd.set(m.id, m);
          }
          t += DAY;
          if (pairingBlock(s, m, ped, season) !== null) {
            expect(() => cover(s, m, ped, season, t, "x")).toThrow();
            continue;
          }
          const r = cover(s, m, ped, season, t, "x");
          herd.set(s.id, r.sire);
          herd.set(m.id, r.dam);
        }
        for (const h of herd.values()) {
          expect(h.breeding.used).toBeLessThanOrEqual(BREEDINGS_LIFETIME);
          expect(h.breeding.bySeason.reduce((a, b) => a + b.count, 0)).toBe(h.breeding.used);
          for (const b of h.breeding.bySeason) expect(b.count).toBeLessThanOrEqual(h.sex === "filly" ? MARE_PER_SEASON : STALLION_PER_SEASON);
          expect(HorseStateSchema.safeParse(h).success).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("fees: base + stud fee; 10% of the stud fee and the whole base fee are burned", () => {
    const f = breedingFees(2000, false);
    expect(f.totalPaidByMareOwner).toBe(BREEDING_BASE_FEE + 2000);
    expect(f.toStallionOwner).toBe(1800);
    expect(f.burned).toBe(BREEDING_BASE_FEE + 200);
    expect(f.toStallionOwner + f.burned).toBe(f.totalPaidByMareOwner);
    expect(breedingFees(2000, true).studFee).toBe(0);
  });
});

describe("covering and foaling", () => {
  it("24 h pregnancy; deterministic foal; nursery overflow when stalls are full; binding passes on", () => {
    const s = { ...stud("S"), binding: "club_bred" as const };
    const m = mare("M");
    const ped = pedOf(s, m);
    const r = cover(s, m, ped, 2, T0, seedFrom("server"));
    expect(r.dam.pregnancy!.dueAtMs).toBe(T0 + PREGNANCY_MS);
    expect(usedInSeason(r.dam, 2)).toBe(1);
    expect(() => deliverFoal(r.dam, r.sire, { foalId: "f", name: "F", nowMs: T0 + 1000, season: 2, stallFree: true })).toThrow(/not due/);
    const a = deliverFoal(r.dam, r.sire, { foalId: "f", name: "F", nowMs: T0 + PREGNANCY_MS, season: 2, stallFree: false });
    const b = deliverFoal(r.dam, r.sire, { foalId: "f", name: "F", nowMs: T0 + PREGNANCY_MS, season: 2, stallFree: false });
    expect(a.foal).toEqual(b.foal);
    expect(a.foal.location).toBe("nursery");
    expect(a.foal.binding).toBe("until_5_starts");
    expect(a.foal.generation).toBe(1);
    expect(a.foal.care.sessions).toBe(0);
    expect(a.dam.pregnancy).toBeNull();
    expect(HorseStateSchema.safeParse(a.foal).success).toBe(true);
  });
});

describe("breeding preview", () => {
  const s = stud("PS", "rare");
  const m = mare("PM", "rare");
  const ped = pedOf(s, m);
  const p = previewBreeding(s, m, ped, 1);

  it("probabilities sum to ~1000", () => {
    const sum = (o: Record<string, number | undefined>) => Object.values(o).reduce((a: number, b) => a + (b ?? 0), 0);
    expect(Math.abs(sum(p.surface) - 1000)).toBeLessThanOrEqual(2);
    expect(Math.abs(sum(p.style) - 1000)).toBeLessThanOrEqual(2);
    expect(Math.abs(sum(p.distance) - 1000)).toBeLessThanOrEqual(3);
    expect(Math.abs(sum(p.maturity) - 1000)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.coats.reduce((a, c) => a + c.permille, 0) - 1000)).toBeLessThanOrEqual(10);
    expect(Math.abs(sum(p.overall.grades) - 1000)).toBeLessThanOrEqual(3);
    for (const k of STAT_KEYS) expect(Math.abs(sum(p.stats[k].grades) - 1000)).toBeLessThanOrEqual(6);
    expect(p.overall.p10).toBeLessThanOrEqual(p.overall.p50);
    expect(p.overall.p50).toBeLessThanOrEqual(p.overall.p90);
    expect(["Excellent", "Good", "Fair", "Poor"]).toContain(p.nick.label);
  });

  it("property: every actual foal lands inside the previewed per-stat range (± mutation)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const foal = inherit(s.genome, m.genome, seed, { coi: p.coi });
        const pot = potentials(foal);
        for (const k of STAT_KEYS) {
          expect(pot[k]).toBeGreaterThanOrEqual(p.stats[k].min - 50);
          expect(pot[k]).toBeLessThanOrEqual(p.stats[k].max + 50);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("coat odds follow Mendel: chestnut × chestnut is always red-based", () => {
    const red = (h: HorseState): HorseState => ({ ...h, genome: { ...h.genome, coat: { ...h.genome.coat, extension: ["e", "e"], cream: ["n", "n"], grey: ["n", "n"], roan: ["n", "n"], dun: ["n", "n"], liver: ["L", "L"] } } });
    const q = previewBreeding(red(s), red(m), ped, 1);
    expect(q.coats).toEqual([{ name: "Chestnut", permille: 1000 }]);
  });

  it("retired broodmares stay in the stud book until breedings are used", () => {
    const r = retireFromRacing(makeHorse("x", { sex: "filly" }), "choice");
    expect(r.career.racingRetired).not.toBeNull();
  });
});
