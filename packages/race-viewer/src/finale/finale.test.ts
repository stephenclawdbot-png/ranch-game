import { describe, expect, it } from "vitest";
import { HORSE_LENGTH_MM, type RaceReplay } from "@thoroughbred/shared";
import { fakeReplay } from "../dev/fakeReplay";
import { timeLeaderReaches } from "../playback";
import {
  FINALE_AFTER_WINNER_S,
  REPLAY_FROM_M,
  SLOWMO_MIN,
  STEP_SECONDS,
  finalePlan,
  finaleSceneTime,
  finaleSlides,
  finaleStepAt,
  isCloseFinish,
  isPhotoFinish,
  marginLabelFor,
  replayRate,
  replayTimeAt,
} from "./plan";
import { FinaleRunner } from "./runner";

const photo = fakeReplay({ horses: 8, seed: 3, distanceM: 1000, photoFinish: true });
const clear = fakeReplay({ horses: 8, seed: 5, distanceM: 1000, photoFinish: false, spread: 4 });

/** A copy of `r` whose runner-up is `mm` behind the winner (official result only). */
function withMargin(r: RaceReplay, mm: number, label: string): RaceReplay {
  const fo = r.result.finishOrder.map((f) => ({ ...f }));
  fo[1] = { ...fo[1]!, marginMm: mm, marginLabel: label };
  return { ...r, result: { ...r.result, finishOrder: fo, photoFinish: false } };
}

describe("finale plan", () => {
  it("photographs a finish within a head, not a neck", () => {
    expect(isPhotoFinish(photo)).toBe(true);
    for (const [mm, label] of [[100, "nose"], [300, "short head"], [650, "head"]] as const) expect(isPhotoFinish(withMargin(clear, mm, label))).toBe(true);
    expect(isPhotoFinish(withMargin(clear, 900, "neck"))).toBe(false);
    expect(isCloseFinish(withMargin(clear, 900, "neck"))).toBe(true);
    expect(isCloseFinish(withMargin(clear, HORSE_LENGTH_MM * 3, "3"))).toBe(false);
  });

  it("orders the steps: photograph, strip, replay, weighed in, 3rd, 2nd, winner", () => {
    const plan = finalePlan(photo, { replayFrom: timeLeaderReaches(photo, REPLAY_FROM_M) });
    expect(plan.steps.map((s) => s.kind)).toEqual(["photograph", "strip", "replay", "weighed", "slide", "slide", "slide"]);
    expect(plan.steps.slice(4).map((s) => s.slide!.position)).toEqual([3, 2, 1]);
    expect(plan.steps[6]!.slide!.winner).toBe(true);
    expect(plan.steps[6]!.dur).toBe(STEP_SECONDS.winner);
    // The verdict comes within a few seconds of the finale starting.
    expect(STEP_SECONDS.photograph + STEP_SECONDS.strip).toBeLessThan(8);
    // The slow-mo replay: last ~100 m, 6-12 real seconds.
    const replay = plan.steps[2]!;
    expect(replay.dur).toBeGreaterThan(6);
    expect(replay.dur).toBeLessThan(12);
    expect(plan.startAt).toBeGreaterThanOrEqual(plan.winnerTime + FINALE_AFTER_WINNER_S - 1e-9);
  });

  it("a clear win has no photograph and no replay, just the all-clear and the slides", () => {
    const plan = finalePlan(clear);
    expect(plan.photo).toBe(false);
    expect(plan.replay).toBeNull();
    expect(plan.steps.map((s) => s.kind)).toEqual(["weighed", "slide", "slide", "slide"]);
    expect(finaleSceneTime(plan, 3)).toBeNull();
  });

  it("gives the viewer's horse its own card outside the places, before the 3rd", () => {
    const sixth = clear.result.finishOrder.find((f) => f.position === 6)!;
    const slides = finaleSlides(clear, [sixth.horseId]);
    expect(slides.map((s) => s.position)).toEqual([6, 3, 2, 1]);
    expect(slides[0]!.mine).toBe(true);
    const behind = clear.result.finishOrder.filter((f) => f.position >= 2 && f.position <= 6).reduce((a, f) => a + f.marginMm, 0);
    expect(slides[0]!.behindWinnerMm).toBe(behind);
    expect(slides[0]!.marginText).toMatch(/^6th, beaten /);
    // A placed horse of mine is not duplicated.
    const third = clear.result.finishOrder.find((f) => f.position === 3)!;
    expect(finaleSlides(clear, [third.horseId]).map((s) => s.position)).toEqual([3, 2, 1]);
  });

  it("phrases margins like the engine", () => {
    expect(marginLabelFor(100)).toBe("nose");
    expect(marginLabelFor(1000)).toBe("neck");
    expect(marginLabelFor(HORSE_LENGTH_MM)).toBe("1");
    expect(marginLabelFor(HORSE_LENGTH_MM * 4)).toBe("4");
    expect(finaleSlides(withMargin(clear, 300, "short head"))[2]!.marginText).toBe("won by a short head");
  });

  it("the replay eases from full speed down to slow motion at the line, monotonic and bounded", () => {
    const plan = finalePlan(photo, { replayFrom: timeLeaderReaches(photo, REPLAY_FROM_M) });
    expect(replayRate(plan.winnerTime - 6, plan.winnerTime)).toBeCloseTo(1, 5);
    expect(replayRate(plan.winnerTime, plan.winnerTime)).toBeCloseTo(SLOWMO_MIN, 5);
    let prev = -Infinity;
    for (let s = 0; s <= plan.steps[2]!.dur + 0.5; s += 0.1) {
      const t = replayTimeAt(plan, s);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(replayTimeAt(plan, 0)).toBeCloseTo(plan.replay!.from, 6);
    expect(replayTimeAt(plan, 1e3)).toBeCloseTo(plan.replay!.to, 6);
    // The scene: the clock before the replay, the replay window during it, then on at 1x.
    const r0 = STEP_SECONDS.photograph + STEP_SECONDS.strip;
    expect(finaleSceneTime(plan, r0 - 0.1)).toBeNull();
    expect(finaleSceneTime(plan, r0 + 0.01)!).toBeLessThan(plan.winnerTime);
    const after = r0 + plan.steps[2]!.dur;
    expect(finaleSceneTime(plan, after + 2)!).toBeCloseTo(plan.replay!.to + 2, 6);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(finalePlan(photo, { mine: ["h3"] }))).toBe(JSON.stringify(finalePlan(photo, { mine: ["h3"] })));
  });
});

describe("weighed in: the seal check", () => {
  it("passes for a sealed replay and fails for a wrong commitment", async () => {
    const { checkSeal } = await import("./FinaleOverlay");
    const { sha256HexOfHex } = await import("../dev/sha256");
    expect(sha256HexOfHex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const sealed = fakeReplay({ horses: 4, seed: 9, sealed: true });
    expect(await checkSeal(sealed)).toBe("ok");
    expect(await checkSeal({ ...sealed, seedCommitment: "0".repeat(64) })).toBe("failed");
    // `sealed` changes nothing else in the fake replay.
    const plain = fakeReplay({ horses: 4, seed: 9 });
    expect({ ...sealed, seedCommitment: "", race: { ...sealed.race, postTimeMs: 0 } }).toEqual({ ...plain, seedCommitment: "", race: { ...plain.race, postTimeMs: 0 } });
  });
});

describe("finale runner", () => {
  const plan = finalePlan(photo);

  it("starts when playback crosses the start, steps through and ends", () => {
    const r = new FinaleRunner();
    r.setPlan(plan, 0);
    expect(r.state).toBe("idle");
    r.update(plan.startAt - 0.1, plan.startAt - 0.05, 0.05);
    expect(r.state).toBe("idle");
    r.update(plan.startAt - 0.05, plan.startAt + 0.01, 0.05);
    expect(r.state).toBe("running");
    expect(r.current().step!.kind).toBe("photograph");
    for (let i = 0; i < 10_000 && r.running; i++) r.update(0, 0, 1 / 30);
    expect(r.state).toBe("done");
  });

  it("opening after the start shows the board at once; a live hand-off starts it", () => {
    const r = new FinaleRunner();
    r.setPlan(plan, plan.startAt + 5);
    expect(r.state).toBe("done");
    r.setPlan(plan, plan.startAt + 5, true);
    expect(r.state).toBe("running");
  });

  it("skips a step on tap and everything on Esc", () => {
    const r = new FinaleRunner();
    r.setPlan(plan, plan.startAt, true);
    r.skip();
    expect(r.current().step!.kind).toBe("strip");
    r.skip();
    expect(r.current().step!.kind).toBe("replay");
    r.skipAll();
    expect(r.state).toBe("done");
    r.rearm(0);
    expect(r.state).toBe("idle");
  });

  it("holds while paused", () => {
    const r = new FinaleRunner();
    r.setPlan(plan, plan.startAt, true);
    r.paused = true;
    r.update(0, 0, 0.2);
    expect(r.elapsed).toBe(0);
    expect(finaleStepAt(plan, 0).step!.kind).toBe("photograph");
  });
});
