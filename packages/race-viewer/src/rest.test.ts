import { describe, expect, it } from "vitest";
import { REST_FRAMES, RestGate, shouldPauseForRest } from "./rest";

describe("RestGate (results on the page: stop drawing a still stage)", () => {
  it("always draws while not resting", () => {
    const g = new RestGate();
    for (let i = 0; i < 200; i++) expect(g.draw(false, "same")).toBe(true);
    expect(g.idle).toBe(false);
  });

  it("at rest, draws a few settling frames, then stops while nothing changes", () => {
    const g = new RestGate();
    let drawn = 0;
    for (let i = 0; i < 300; i++) if (g.draw(true, "t=42.000|cam")) drawn++;
    expect(drawn).toBe(REST_FRAMES + 1);
    expect(g.idle).toBe(true);
  });

  it("a change (seek, camera, resize) draws again at once, then rests again", () => {
    const g = new RestGate();
    for (let i = 0; i < 100; i++) g.draw(true, "a");
    expect(g.idle).toBe(true);
    expect(g.draw(true, "b")).toBe(true);
    expect(g.idle).toBe(false);
    let drawn = 0;
    for (let i = 0; i < 100; i++) if (g.draw(true, "b")) drawn++;
    expect(drawn).toBe(REST_FRAMES);
    // Playing again: every frame is drawn.
    expect(g.draw(false, "b")).toBe(true);
    expect(g.idle).toBe(false);
  });
});

describe("shouldPauseForRest", () => {
  const replay = (time: number, playing = true) => ({ kind: "replay" as const, time, duration: 60, playing });
  it("pauses a replay playing on past the line (the run-out)", () => {
    expect(shouldPauseForRest(replay(63), false)).toBe(true);
  });
  it("never stops the race itself, the finale, a live clock or a clock already stopped", () => {
    expect(shouldPauseForRest(replay(30), false)).toBe(false);
    expect(shouldPauseForRest(replay(63), true)).toBe(false);
    expect(shouldPauseForRest(null, false)).toBe(false);
    expect(shouldPauseForRest(replay(63, false), false)).toBe(false);
  });
});
