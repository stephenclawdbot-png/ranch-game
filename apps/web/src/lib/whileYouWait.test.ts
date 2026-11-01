import { describe, expect, it } from "vitest";
import { WAIT_ACTIONS_MAX, whileYouWaitActions, type WaitFacts } from "./whileYouWait";

const all: WaitFacts = {
  story: { chapterShort: "Club", wins: 1, winsToComplete: 3, raceKey: "club-2", horseReady: true },
  care: { horseName: "Fair Wind", href: "/horse/abc/care", due: 2 },
  cupRunsLeft: 1,
  quickRace: true,
};

describe("while you wait", () => {
  it("offers up to three actions from the stable's state, most useful first", () => {
    const a = whileYouWaitActions(all);
    expect(a.map((x) => x.label)).toEqual(["Win your 2nd Club race (Story)", "Care for Fair Wind (due)", "Daily Cup (1 run left)"]);
    expect(a).toHaveLength(WAIT_ACTIONS_MAX);
    expect(a[0]!.href).toBe("/story#race-club-2");
  });

  it("only offers what is actually available", () => {
    const none: WaitFacts = { story: { ...all.story!, horseReady: false }, care: { ...all.care!, due: 0 }, cupRunsLeft: 0, quickRace: false };
    expect(whileYouWaitActions(none)).toEqual([]);
    // No rested horse for Story (the only one is waiting for its Live race), the Cup already run.
    expect(whileYouWaitActions({ ...all, story: { ...all.story!, horseReady: false }, cupRunsLeft: 0 }).map((x) => x.key)).toEqual(["care", "quick"]);
    // A chapter already complete is not offered.
    expect(whileYouWaitActions({ ...all, story: { ...all.story!, wins: 3 } }).map((x) => x.key)).toEqual(["care", "cup", "quick"]);
    expect(whileYouWaitActions({ ...all, story: null, care: null }).map((x) => x.key)).toEqual(["cup", "quick"]);
  });
});
