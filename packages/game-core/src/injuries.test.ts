import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INJURY_DAYS, injuryRisk, rollInjury, withFatigue } from "./condition";
import { INJURY_KINDS, injuryKindOf, injuryKindShares, injuryName, injuryNameOf, injuryTriggers, likelyInjuries, likelyInjuriesText, pickInjuryKind } from "./injuries";
import { train } from "./training";
import { InjurySchema, type InjurySeverity } from "./types";
import { T0, makeHorse } from "./test-helpers";

const SEVERITIES: InjurySeverity[] = ["minor", "moderate", "career_ending", "fatal"];

describe("injury catalogue", () => {
  it("every kind is well formed and inside its severity's healing range", () => {
    const keys = new Set<string>();
    for (const k of INJURY_KINDS) {
      expect(keys.has(k.key)).toBe(false);
      keys.add(k.key);
      expect(k.key.length).toBeLessThanOrEqual(40);
      expect(k.name.length).toBeGreaterThan(3);
      expect(k.description.length).toBeGreaterThan(20);
      const [lo, hi] = INJURY_DAYS[k.severity];
      expect(k.days[0]).toBeGreaterThanOrEqual(lo);
      expect(k.days[1]).toBeLessThanOrEqual(hi);
      expect(k.days[0]).toBeLessThanOrEqual(k.days[1]);
      expect(k.weight).toBeGreaterThan(0);
    }
  });

  it("every healing day of every severity is covered by at least one named injury", () => {
    for (const sev of SEVERITIES) {
      const [lo, hi] = INJURY_DAYS[sev];
      for (let d = lo; d <= hi; d++) expect(INJURY_KINDS.some((k) => k.severity === sev && d >= k.days[0] && d <= k.days[1])).toBe(true);
    }
  });

  it("old injuries without a kind show as their severity", () => {
    expect(injuryName({ severity: "minor" })).toBe("Minor injury");
    expect(injuryName({ severity: "career_ending" })).toBe("Career-ending injury");
    expect(injuryName({ severity: "moderate", kind: "tendon_strain" })).toBe("Tendon strain");
    expect(injuryNameOf("fatal", "no_such_kind")).toBe("Fatal injury");
    expect(injuryNameOf(null)).toBe("Injury");
    // the schema still reads old stored injuries
    expect(InjurySchema.safeParse({ severity: "minor", atMs: 0, unitsRequired: 48, bonusUnits: 0, vetLevel: 0, source: "r" }).success).toBe(true);
  });
});

describe("rollInjury: names never change the roll", () => {
  // Severity and healing days for fixed seeds, recorded before the catalogue existed.
  const golden = readFileSync(new URL("./fixtures/injury-rolls.golden.txt", import.meta.url), "utf8").trim().split("\n");
  it("the same seeds roll the same severity and unitsRequired as before names existed", () => {
    expect(golden.length).toBe(6);
    for (const line of golden) {
      const [p, ce, fatal, rows] = line.split("|") as [string, string, string, string];
      const want = rows.split(",");
      for (let i = 0; i < want.length; i++) {
        // a context changes only the name, so roll with a busy one
        const inj = rollInjury({ permille: Number(p), careerEndingShare: Number(ce), context: { going: "firm", intensity: "all_out", tired: true, fragile: true, distanceM: 1200 } }, `golden|${i}`, 0, 1, "race", { fatal: fatal === "true" });
        const got = inj ? `${inj.severity === "career_ending" ? "c" : inj.severity[0]}${inj.unitsRequired / 24}` : "-";
        expect(got, `${line.slice(0, 16)} #${i}`).toBe(want[i]);
        if (inj) {
          const k = injuryKindOf(inj.kind)!;
          expect(k.severity).toBe(inj.severity);
          expect(inj.unitsRequired / 24).toBeGreaterThanOrEqual(k.days[0]);
          expect(inj.unitsRequired / 24).toBeLessThanOrEqual(k.days[1]);
        }
      }
    }
  });

  it("the name is deterministic in the seed", () => {
    const r = { permille: 1000, careerEndingShare: 200, context: { going: "soft" as const } };
    for (let i = 0; i < 50; i++) expect(rollInjury(r, `d${i}`, 0, 0, "race")).toEqual(rollInjury(r, `d${i}`, 0, 0, "race"));
  });

  it("context shifts the names: firm sprints bring sore shins, soft tired staying trips tendon trouble", () => {
    const count = (ctx: Parameters<typeof pickInjuryKind>[2], sev: InjurySeverity, days: number, key: string) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (pickInjuryKind(sev, days, ctx, `c${i}`) === key) n++;
      return n;
    };
    expect(count({ going: "firm", distanceM: 1200 }, "minor", 3, "sore_shins")).toBeGreaterThan(count({ going: "soft", distanceM: 2000 }, "minor", 3, "sore_shins") + 200);
    expect(count({ going: "soft", tired: true, distanceM: 2800 }, "moderate", 10, "tendon_strain")).toBeGreaterThan(count({ going: "firm", distanceM: 1200 }, "moderate", 10, "tendon_strain") + 200);
    expect(count({ veteran: true }, "career_ending", 15, "joint_damage")).toBeGreaterThan(count({}, "career_ending", 15, "joint_damage") + 200);
    expect(injuryTriggers({ going: "heavy", tired: true })).toEqual(["soft", "heavy", "tired", "deep_tired"]);
  });

  it("injuryRisk carries the naming context; training knocks are named minor injuries", () => {
    const h = makeHorse("ctx", { starts: 30 });
    const r = injuryRisk(withFatigue(h, 900, T0, true), { nowMs: T0, going: "heavy", distanceM: 2800, intensity: "all_out", stage: "veteran" });
    expect(r.context).toMatchObject({ going: "heavy", distanceM: 2800, intensity: "all_out", tired: true, veteran: true });
    let seen = 0;
    for (let i = 0; i < 400 && seen < 5; i++) {
      const tired = withFatigue(makeHorse(`t${i}`, { starts: 10 }), 1000, T0, true);
      const res = train(tired, "speed_work", { nowMs: T0, credits: 10_000, trainerLevel: 0, vetLevel: 0 }, `train-${i}`);
      if (res.injured) {
        seen++;
        expect(res.state.injury!.severity).toBe("minor");
        expect(injuryKindOf(res.state.injury!.kind)!.severity).toBe("minor");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("likelyInjuries names the top few for the context, and the likeliest serious one", () => {
    const firmSprint = likelyInjuries({ going: "firm", distanceM: 1200 }, 30);
    expect(firmSprint.common).toHaveLength(2);
    expect(firmSprint.common[0]).toBe("Sore shins");
    expect(["Hairline fracture", "Splint injury"]).toContain(firmSprint.serious);
    expect(likelyInjuries({ going: "soft", tired: true, distanceM: 2800, intensity: "all_out" }, 100).serious).toBe("Tendon strain");
    expect(likelyInjuriesText({ common: ["Sore shins", "Knocked joint"], serious: "Tendon strain" })).toBe("sore shins, knocked joint; if serious, tendon strain");
    const all = injuryKindShares({}, 30);
    expect(all.map((k) => k.spec.severity)).not.toContain("fatal");
    expect(all.length).toBe(18);
  });
});
