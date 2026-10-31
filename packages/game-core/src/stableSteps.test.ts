import { describe, expect, it } from "vitest";
import {
  STABLE_STEPS,
  STABLE_STEPS_BONUS,
  UNLOCK_FEATURES,
  WELCOME_BACK_AFTER_MS,
  isStableStepKey,
  isWelcomeBack,
  stableStepsFor,
  stableStepsProgress,
  stableStepsTotal,
  unlockState,
  type UnlockFacts,
} from "./onboarding";
import { ACHIEVEMENTS } from "./social";

describe("stable steps (first-week guide)", () => {
  it("has about ten ordered, unique steps and a modest total", () => {
    expect(STABLE_STEPS.length).toBe(10);
    expect(new Set(STABLE_STEPS.map((s) => s.key)).size).toBe(STABLE_STEPS.length);
    expect(STABLE_STEPS[0]!.key).toBe("care");
    for (const s of STABLE_STEPS) expect(s.credits).toBeGreaterThan(0);
    const all = stableStepsTotal({ quickRaces: true });
    const without = stableStepsTotal({});
    expect(all).toBeGreaterThanOrEqual(600);
    expect(all).toBeLessThanOrEqual(900);
    expect(without).toBeGreaterThanOrEqual(600);
    expect(all - without).toBe(STABLE_STEPS.find((s) => s.key === "quick_race")!.credits);
    expect(STABLE_STEPS_BONUS).toBeGreaterThan(0);
  });

  it("skips a step whose feature isn't in the build", () => {
    expect(stableStepsFor({}).some((s) => s.key === "quick_race")).toBe(false);
    expect(stableStepsFor({ quickRaces: true }).some((s) => s.key === "quick_race")).toBe(true);
    expect(stableStepsFor({ quickRaces: false }).length).toBe(9);
  });

  it("tracks progress, the next step in order and completion", () => {
    const p0 = stableStepsProgress(new Set());
    expect(p0).toMatchObject({ done: 0, total: 9, complete: false, next: "care" });
    const p1 = stableStepsProgress(new Set(["care", "enter_live"]));
    expect(p1.next).toBe("train_plan");
    expect(p1.done).toBe(2);
    const every = new Set(stableStepsFor({}).map((s) => s.key));
    expect(stableStepsProgress(every)).toMatchObject({ complete: true, next: null, done: 9 });
    // a quick race done before the feature is detected doesn't count towards a build without it
    expect(stableStepsProgress(new Set(["quick_race"])).done).toBe(0);
  });

  it("recognises step keys", () => {
    expect(isStableStepKey("read_why")).toBe(true);
    expect(isStableStepKey("nope")).toBe(false);
    expect(isStableStepKey(3)).toBe(false);
  });

  it("finishing the guide is a plaque", () => {
    const a = ACHIEVEMENTS.find((x) => x.id === "stable_steps")!;
    expect(a).toBeTruthy();
    const base = { races: 0, wins: 0, gradedWins: 0, g1Wins: 0, photoFinishWins: 0, foalsBred: 0, bestBredGrade: null, cupTop10: 0, cupRuns: 0, leaguePromotions: 0, seasonFinalWins: 0, hallOfFame: 0, careDays: 0 };
    expect(a.test(base)).toBe(false);
    expect(a.test({ ...base, stableSteps: true })).toBe(true);
  });
});

describe("progressive unlocks", () => {
  const fresh: UnlockFacts = { guided: true, wallet: false, watchedLiveRace: false, daysSinceFounding: 0, licenceLevel: 1 };
  const open = (f: UnlockFacts) => UNLOCK_FEATURES.filter((k) => unlockState(f)[k] !== null);

  it("a brand-new stable starts with none of them", () => {
    expect(open(fresh)).toEqual([]);
  });

  it("existing stables keep everything", () => {
    const s = unlockState({ ...fresh, guided: false });
    for (const k of UNLOCK_FEATURES) expect(s[k]).toBe("existing_stable");
  });

  it("the tote opens after the first watched Live race", () => {
    expect(unlockState({ ...fresh, watchedLiveRace: true }).tote).toBe("watched_live");
    expect(open({ ...fresh, watchedLiveRace: true })).toEqual(["tote"]);
  });

  it("market and leasing open on day 3 or with Story chapter 1", () => {
    expect(open({ ...fresh, daysSinceFounding: 1 })).toEqual([]);
    expect(open({ ...fresh, daysSinceFounding: 2 })).toEqual(["market", "leasing"]);
    expect(unlockState({ ...fresh, daysSinceFounding: 2 }).market).toBe("day_three");
  });

  it("Story chapter 1 opens market, leasing, claiming and jockey contracts", () => {
    const s = unlockState({ ...fresh, licenceLevel: 2 });
    expect(open({ ...fresh, licenceLevel: 2 })).toEqual(["market", "leasing", "claiming", "jockey_contracts"]);
    expect(s.claiming).toBe("story_chapter");
    expect(s.tote).toBeNull();
  });

  it("wallet players see the USDG features (tote and market) from the start", () => {
    const s = unlockState({ ...fresh, wallet: true });
    expect(s.tote).toBe("wallet");
    expect(s.market).toBe("wallet");
    expect(s.leasing).toBe("wallet");
    expect(s.claiming).toBeNull();
  });

  it("never locks away something already used", () => {
    const s = unlockState({ ...fresh, used: { claiming: true, tote: true } });
    expect(s.claiming).toBe("already_used");
    expect(s.tote).toBe("already_used");
    expect(s.market).toBeNull();
  });

  it("only ever opens as the facts grow", () => {
    const steps: UnlockFacts[] = [fresh, { ...fresh, watchedLiveRace: true }, { ...fresh, watchedLiveRace: true, daysSinceFounding: 3 }, { ...fresh, watchedLiveRace: true, daysSinceFounding: 3, licenceLevel: 2 }];
    let before = new Set<string>();
    for (const f of steps) {
      const now = new Set<string>(open(f));
      for (const k of before) expect(now.has(k)).toBe(true);
      before = now;
    }
    expect(before.size).toBe(UNLOCK_FEATURES.length);
  });
});

describe("welcome back", () => {
  it("needs a day away and a previous visit", () => {
    expect(isWelcomeBack(null, 10)).toBe(false);
    expect(isWelcomeBack(0, WELCOME_BACK_AFTER_MS - 1)).toBe(false);
    expect(isWelcomeBack(0, WELCOME_BACK_AFTER_MS)).toBe(true);
  });
});
