/** The welcome-back strip's one button after a sign-in: the most relevant next thing, in order. */
import { describe, expect, it } from "vitest";
import { welcomeBackNext, type BackInput } from "./welcomeBackNext";

const NOW = 1_800_000_000_000;
const base: BackInput = {
  nowMs: NOW,
  inbox: [],
  active: [],
  runs: [],
  horseName: (id) => (id === "h1" ? "Copper Kettle" : null),
  story: null,
  firstWeek: null,
  ready: null,
};
const unseen = { raceId: "r-result", horseId: "h1", read: false, kind: "race_result" };
const live = { raceId: "r-live", kind: "live" as const, horseName: "Moss Lane", raceName: "Kestrel Mile", postTimeMs: NOW + 600_000 };
const story = { chapter: 1, raceName: "The Maiden Plate" };
const firstWeek = { title: "Care for a horse", href: "/horse/h1/care" };

describe("welcomeBackNext", () => {
  it("a result waiting to be watched comes first (and never says how it went)", () => {
    const a = welcomeBackNext({ ...base, inbox: [unseen], active: [live], runs: [{ kind: "story" }], story, firstWeek });
    expect(a).toEqual({ kind: "result", label: "Watch Copper Kettle's race", href: "/race/r-result" });
    // Read results and sponsor notes don't count.
    expect(welcomeBackNext({ ...base, inbox: [{ ...unseen, read: true }, { ...unseen, kind: "race_sponsor" }] }).kind).toBe("stable");
  });
  it("then your Live race up next (the soonest, until a few minutes after the off)", () => {
    const later = { ...live, raceId: "r-later", postTimeMs: NOW + 3_600_000 };
    expect(welcomeBackNext({ ...base, active: [later, live], runs: [{ kind: "story" }], story, firstWeek })).toEqual({
      kind: "live",
      label: "Watch Moss Lane in the Kestrel Mile",
      href: "/race/r-live",
    });
    const long = { ...live, postTimeMs: NOW - 30 * 60_000 };
    expect(welcomeBackNext({ ...base, active: [long] }).kind).toBe("stable");
    // A Story entry isn't a Live race.
    expect(welcomeBackNext({ ...base, active: [{ ...live, kind: "story" }] }).kind).toBe("stable");
  });
  it("then the Story chapter (once a Story race has been run), then the first-week job", () => {
    expect(welcomeBackNext({ ...base, runs: [{ kind: "story" }], story, firstWeek })).toEqual({ kind: "story", label: "Continue Story chapter 1: The Maiden Plate", href: "/story" });
    expect(welcomeBackNext({ ...base, runs: [], story, firstWeek })).toEqual({ kind: "first_week", label: "Care for a horse", href: "/horse/h1/care" });
    expect(welcomeBackNext({ ...base, runs: [{ kind: "live" }], story: null, firstWeek })).toMatchObject({ kind: "first_week" });
  });
  it("else a race for the ready horse, else the stable", () => {
    expect(welcomeBackNext({ ...base, ready: { name: "Copper Kettle" } })).toEqual({ kind: "race", label: "Race Copper Kettle", href: "/story" });
    expect(welcomeBackNext(base)).toEqual({ kind: "stable", label: "Go to your stable", href: "/stable" });
  });
});
