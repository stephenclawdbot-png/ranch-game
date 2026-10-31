/**
 * The verdict's wording rules (first-hour playtest): one sentence that reads like a person
 * explaining the race, built only from the engine's record of the run, and one change the owner
 * can make in one tap. Unit cases pin the sentences; the simulated races check every runner of
 * real engine replays gets an honest, measured reason.
 */
import { describe, expect, it } from "vitest";
import { simulateRace } from "@thoroughbred/racing-engine";
import type { RaceReplay } from "@thoroughbred/shared";
import { fixtureInput } from "@/server/testing";
import type { Fit } from "./aptitude";
import { analyseRace } from "./raceAnalysis";
import { raceStory, runFacts, storyFromFacts, toGo, type RunFacts, type StoryInput } from "./raceStory";
import type { TryNextTip } from "./tryNext";

const NOW = Date.UTC(2026, 9, 25, 15, 0, 0);
const good = (id: Fit["id"]): Fit => ({ id, label: id, level: "good", detail: "" });
const fits = (over: Partial<Record<Fit["id"], Fit>> = {}): Fit[] => (["trip", "surface", "going", "plan"] as const).map((id) => over[id] ?? good(id));

/** A stand-in replay: storyFromFacts reads only the race card and the track length from it. */
const replay = { race: { distanceM: 1200, surface: "turf", going: "good" }, trackLengthMm: 1_200_000 } as unknown as RaceReplay;

function input(over: Omit<Partial<StoryInput>, "analysis" | "horse"> & { analysis?: Partial<StoryInput["analysis"]>; horse?: Partial<StoryInput["horse"]> } = {}): StoryInput {
  const { analysis, horse, ...rest } = over;
  return {
    horseId: "h1",
    analysis: {
      position: 5,
      fieldSize: 9,
      runningLine: [5, 5, 5, 5],
      sectionals: [
        { segment: "early", timeS: 20, rank: 5, score: 0.5 },
        { segment: "middle", timeS: 20, rank: 5, score: 0.5 },
        { segment: "late", timeS: 20, rank: 5, score: 0.5 },
      ],
      fits: fits(),
      tactic: "front",
      ...analysis,
    },
    horse: { name: "Copper Kettle", sex: "colt", style: "front", preferredDistanceM: 1200, preferredSurface: "turf", ...horse },
    replay,
    tips: [],
    yours: true,
    freshAlternative: null,
    ...rest,
  };
}
const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  energyAtTwoThirds: 400,
  lowTankRank: 5,
  tiringWithM: null,
  energyAtFinish: 35,
  topSpeedRank: 5,
  lateChange: 0,
  slowStart: false,
  boxedInLate: false,
  ...over,
});
const late = (rank: number) => [
  { segment: "early" as const, timeS: 20, rank: 1, score: 1 },
  { segment: "middle" as const, timeS: 20, rank: 2, score: 0.8 },
  { segment: "late" as const, timeS: 20, rank, score: 0.1 },
];

describe("the verdict: why, in one sentence", () => {
  it("used too much early: the owner's own example, from the engine's tiring call", () => {
    const s = storyFromFacts(input({ analysis: { position: 4, runningLine: [2, 2, 2, 4], sectionals: late(8) } }), facts({ tiringWithM: 180, lateChange: 2, lowTankRank: 1 }));
    expect(s.kind).toBe("ran_dry");
    expect(s.reason).toBe("Copper Kettle used too much early chasing the leader, and had nothing left with the final furlong to go, dropping from 2nd to 4th.");
    expect(s.change).toMatchObject({ kind: "tactic", tactic: "stalker", label: "Try again as a stalker" });
    expect(s.change!.text).toMatch(/^Ride him as a stalker: sit just behind the leaders/);
    expect(s.change!.text).toMatch(/It isn't his natural style, so it's a trade-off\.$/);
  });

  it("led and faded, with no tiring call: read from the tank two-thirds round", () => {
    const s = storyFromFacts(input({ horse: { sex: "filly", name: "Lucky Penny" }, analysis: { position: 5, runningLine: [1, 1, 2, 5], sectionals: late(7) } }), facts({ lowTankRank: 1, lateChange: 3 }));
    expect(s.reason).toBe("Lucky Penny used too much early leading, and had nothing left in the closing stages, dropping from 2nd to 5th.");
    expect(s.change!.text).toMatch(/^Ride her as a stalker/);
  });

  it("a trip too far is named as the cause, and the change is a race that suits", () => {
    const s = storyFromFacts(
      input({ replay: { ...replay, race: { ...replay.race, distanceM: 1600 } }, analysis: { position: 6, runningLine: [3, 3, 3, 6], sectionals: late(8), fits: fits({ trip: { id: "trip", label: "Trip", level: "poor", detail: "" } }) } }),
      facts({ tiringWithM: 420, lateChange: 3 }),
    );
    expect(s.reason).toBe("Copper Kettle ran out of energy with the last 400 m to go, dropping from 3rd to 6th: 1,600 m is further than his best (1,200 m).");
    expect(s.change).toMatchObject({ kind: "suited", label: "Try again at a race that suits" });
    expect(s.change!.text).toMatch(/Race him at his best: about 1,200 m on turf, good ground\.$/);
  });

  it("a missed break, boxed in: luck, said plainly, and simply race again", () => {
    const slow = storyFromFacts(input({ analysis: { position: 8, runningLine: [9, 8, 8, 8] } }), facts({ slowStart: true }));
    expect(slow.reason).toBe("Copper Kettle missed the break: slow out of the stalls, he was 9th early and never got back into it.");
    expect(slow.change).toMatchObject({ kind: "again", label: "Race Copper Kettle again" });
    const boxed = storyFromFacts(input(), facts({ boxedInLate: true }));
    expect(boxed.reason).toBe("Copper Kettle got boxed in behind horses when they quickened and lost his momentum: bad luck in running.");
  });

  it("conditions: the ground and the surface in words", () => {
    const s = storyFromFacts(
      input({ replay: { ...replay, race: { ...replay.race, surface: "dirt", going: "heavy" } }, analysis: { fits: fits({ going: { id: "going", label: "Going", level: "poor", detail: "heavy" } }) } }),
      facts(),
    );
    expect(s.reason).toBe("The heavy ground didn't suit Copper Kettle: it cost him more than anything else today.");
    expect(s.change!.kind).toBe("suited");
  });

  it("finished with plenty left from too far back: ride closer to the pace", () => {
    const s = storyFromFacts(input({ horse: { style: "closer" }, analysis: { tactic: "closer", position: 4, runningLine: [8, 8, 6, 4] } }), facts({ energyAtFinish: 260 }));
    expect(s.reason).toBe("Copper Kettle finished with plenty left in the tank (26%) but was 8th early: too far back when the leaders kicked for home.");
    expect(s.change).toMatchObject({ kind: "tactic", tactic: "stalker" });
  });

  it("outpaced: measured, and the one change is a fresh horse when tiredness was the top tip", () => {
    const tips: TryNextTip[] = [{ id: "freshness", weight: 9, text: "Ran the same day as hard work: his peak is 3-5 days after, worth giving him that long." }];
    const s = storyFromFacts(input({ tips, freshAlternative: "Paper Moon" }), facts({ topSpeedRank: 6 }));
    expect(s.reason).toBe("No hard-luck story: the first few were simply quicker. Copper Kettle's best speed was the 6th-fastest of 9.");
    expect(s.change).toMatchObject({ kind: "fresh_horse", label: "Race Paper Moon instead" });
    expect(s.change!.text).toBe("Ran the same day as hard work. Give Paper Moon a run meanwhile: fresh and ready.");
    // No other horse ready: race again, with the honest reason.
    expect(storyFromFacts(input({ tips }), facts({ topSpeedRank: 6 })).change!.kind).toBe("again");
  });

  it("ridden against its natural style and that was the top tip: back to its own style", () => {
    const tips: TryNextTip[] = [{ id: "plan", weight: 30, text: "Held up for a late run, but he's a natural front-runner: his own style may suit better." }];
    const s = storyFromFacts(input({ tips, analysis: { tactic: "closer" } }), facts({ topSpeedRank: 4 }));
    expect(s.change).toMatchObject({ kind: "tactic", tactic: "front", label: "Try again as a front-runner" });
    expect(s.change!.text).not.toMatch(/trade-off/);
  });

  it("wins say how it was won and suggest no change; another stable's runner gets no change", () => {
    const made = storyFromFacts(input({ analysis: { position: 1, runningLine: [1, 1, 1, 1] } }), facts());
    expect(made.reason).toBe("Copper Kettle went straight to the front and still had enough left to hold them all off.");
    expect(made.change).toBeNull();
    const late = storyFromFacts(input({ analysis: { position: 1, runningLine: [8, 8, 5, 1], sectionals: [{ segment: "late", timeS: 1, rank: 1, score: 1 }] } }), facts());
    expect(late.reason).toBe("Copper Kettle was 8th early, saved energy at the back and came past them with the fastest finish.");
    expect(storyFromFacts(input({ yours: false }), facts({ slowStart: true, lateChange: 0 })).change).toBeNull();
  });

  it("distances to go read like a commentator", () => {
    expect(toGo(150)).toBe("the final furlong");
    expect(toGo(330)).toBe("the last 350 m");
    expect(toGo(640)).toBe("the last 600 m");
  });
});

describe("the verdict on real engine replays", () => {
  it("every runner gets one plain sentence from measured facts, and every loss of yours one change", { timeout: 60_000 }, () => {
    const kinds = new Set<string>();
    for (const [k, distanceM] of [1000, 1200, 1400, 1600, 2000, 2400, 1000, 1600, 2400, 1200, 1400, 2000].entries()) {
      const input = fixtureInput(`verdict-${k}`, NOW, { distanceM, runners: 8 + (k % 4) });
      const rep = simulateRace(input);
      for (const e of input.entries) {
        const a = analyseRace(rep, e.horse.id, e.horse, e.tactic)!;
        const s = raceStory({ horseId: e.horse.id, analysis: a, horse: e.horse, replay: rep, tips: [], yours: true, freshAlternative: null })!;
        const f = runFacts(rep, e.horse.id, a.runningLine)!;
        kinds.add(s.kind);
        // One sentence (two only for the measured "simply quicker"), no jargon, no certainty.
        expect(s.reason.split(/(?<=[.!])\s/).length).toBeLessThanOrEqual(2);
        expect(s.reason).not.toMatch(/\bOR\b|handicapper|permille|\bundefined\b|NaN/);
        expect(s.reason).toContain(s.kind === "conditions" ? e.horse.name : e.horse.name.split(" ")[0]!);
        // Never invented: each kind is backed by the engine's own record.
        if (s.kind === "slow_start") expect(rep.events.some((x) => x.horseId === e.horse.id && x.type === "slow_start")).toBe(true);
        if (s.kind === "boxed_in") expect(rep.events.some((x) => x.horseId === e.horse.id && x.type === "boxed_in")).toBe(true);
        if (s.kind === "ran_dry") expect(f.tiringWithM !== null || f.lowTankRank <= Math.ceil(a.fieldSize / 4)).toBe(true);
        if (s.kind === "left_too_much") expect(f.energyAtFinish).toBeGreaterThanOrEqual(150);
        if (s.kind === "outpaced") expect(s.reason).toMatch(new RegExp(`(${f.topSpeedRank === 1 ? "the fastest" : `${f.topSpeedRank}(st|nd|rd|th)-fastest`})`));
        if (a.position === 1) expect(s.change).toBeNull();
        else {
          expect(s.change).not.toBeNull();
          expect(s.change!.label).toMatch(/^(Try again as a (front-runner|stalker|closer)|Try again at a race that suits|Race .+ again)$/);
          expect(s.change!.text).not.toMatch(/\bwill\b|\bdefinitely\b|\bmust\b/);
        }
        // Deterministic: the same replay tells the same story.
        expect(raceStory({ horseId: e.horse.id, analysis: a, horse: e.horse, replay: rep, tips: [], yours: true })).toEqual(s);
      }
    }
    // The engine's races are varied enough that several kinds of story occur.
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });
});
