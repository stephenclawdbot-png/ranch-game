import { describe, expect, it } from "vitest";
import {
  FIRST_WEEK_DAYS,
  FIRST_WEEK_ORDER,
  FIRST_WEEK_SHOWN,
  STABLE_STEPS,
  firstWeekList,
  isFirstWeekKey,
  stableStepsProgress,
  type FirstWeekFacts,
} from "./onboarding";

const facts = (f: Partial<FirstWeekFacts> = {}): FirstWeekFacts => ({
  guided: true,
  daysSinceFounding: 0,
  firstRace: false,
  renamed: false,
  canRename: true,
  qualifier: false,
  careerStory: false,
  ...f,
});
const all = { quickRaces: true };

describe("the first-week list on Home", () => {
  it("holds every paid Stable step once, plus the unpaid extras, in one order", () => {
    const l = firstWeekList(stableStepsProgress(new Set(), all), facts());
    const keys = l.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of STABLE_STEPS) expect(keys).toContain(s.key);
    for (const k of ["first_race", "rename", "qualifier", "career_story"]) expect(keys).toContain(k);
    expect(keys).toEqual(FIRST_WEEK_ORDER.filter((k) => keys.includes(k)));
    expect(keys[0]).toBe("first_race");
  });

  it("never adds a reward: extras pay 0 and the paid steps pay what the guide pays", () => {
    const l = firstWeekList(stableStepsProgress(new Set(), all), facts());
    const paid = l.items.reduce((s, i) => s + i.credits, 0);
    expect(paid).toBe(STABLE_STEPS.reduce((s, x) => s + x.credits, 0));
    for (const i of l.items) if (!STABLE_STEPS.some((s) => s.key === i.key)) expect(i.credits).toBe(0);
  });

  it("ticks from the records and shows the next few jobs, in order", () => {
    const l = firstWeekList(stableStepsProgress(new Set(["read_why", "care"]), all), facts({ firstRace: true }));
    expect(l.items.find((i) => i.key === "first_race")!.done).toBe(true);
    expect(l.done).toBe(3);
    expect(l.next).toEqual(["train_plan", "enter_live", "watch_live"]);
    expect(l.next.length).toBe(FIRST_WEEK_SHOWN);
    const q = firstWeekList(stableStepsProgress(new Set(), all), facts({ qualifier: true, careerStory: true, renamed: true }));
    expect(q.items.filter((i) => i.done).map((i) => i.key).sort()).toEqual(["career_story", "qualifier", "rename"]);
  });

  it("offers renaming only while a horse can still be renamed (or once it was)", () => {
    const has = (f: Partial<FirstWeekFacts>) => firstWeekList(stableStepsProgress(new Set(), all), facts(f)).items.some((i) => i.key === "rename");
    expect(has({ canRename: true })).toBe(true);
    expect(has({ canRename: false })).toBe(false);
    expect(has({ canRename: false, renamed: true })).toBe(true);
  });

  it("skips a paid step that isn't in this build", () => {
    const l = firstWeekList(stableStepsProgress(new Set(), {}), facts());
    expect(l.items.some((i) => i.key === "quick_race")).toBe(false);
  });

  it("shows only to a guided stable, in its first week, while something is left", () => {
    const p = stableStepsProgress(new Set(), all);
    expect(firstWeekList(p, facts()).visible).toBe(true);
    expect(firstWeekList(p, facts({ daysSinceFounding: FIRST_WEEK_DAYS - 1 })).visible).toBe(true);
    expect(firstWeekList(p, facts({ daysSinceFounding: FIRST_WEEK_DAYS })).visible).toBe(false);
    expect(firstWeekList(p, facts({ guided: false })).visible).toBe(false);
    const everything = stableStepsProgress(new Set(STABLE_STEPS.map((s) => s.key)), all);
    const done = firstWeekList(everything, facts({ firstRace: true, renamed: true, qualifier: true, careerStory: true }));
    expect(done.done).toBe(done.total);
    expect(done.next).toEqual([]);
    expect(done.visible).toBe(false);
  });

  it("knows its keys", () => {
    expect(isFirstWeekKey("qualifier")).toBe(true);
    expect(isFirstWeekKey("care")).toBe(true);
    expect(isFirstWeekKey("nope")).toBe(false);
  });
});
