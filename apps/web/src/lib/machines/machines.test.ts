import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IllegalTransitionError, machineProblems } from "@thoroughbred/shared";
import { UI_MACHINES, moveOr, setIllegalMovePolicy } from "./index";
import { SUBMIT_IDLE, SUBMIT_MACHINE, isSubmitBusy, submitReducer, type SubmitState } from "./submit";
import { LOAD_START, loadReducer } from "./load";
import { ENTRY_SHEET_CLOSED, entrySheetReducer, entrySheetView, type EntrySheetEvent, type EntrySheetState } from "./entrySheet";
import { FINALE_MACHINE, RACE_PAGE_MACHINE, checkPhaseMove, finaleNext, racePhase } from "./racePage";
import { CHECKOUT_MACHINE } from "./checkout";
import { FOUNDING_MACHINE } from "./founding";
import { PUSH_ASK_MACHINE } from "./pushAsk";

afterEach(() => setIllegalMovePolicy(null));

describe("UI_MACHINES", () => {
  it("are all well formed (reachable, no dead ends that aren't terminal)", () => {
    for (const m of UI_MACHINES) expect(machineProblems(m), m.name).toEqual([]);
  });

  it("have unique names and describe every state", () => {
    expect(new Set(UI_MACHINES.map((m) => m.name)).size).toBe(UI_MACHINES.length);
    for (const m of UI_MACHINES) for (const s of m.states) expect(m.describe?.[s], `${m.name}.${s}`).toBeTruthy();
  });

  it("every busy state has a way out (no spinner without an exit)", () => {
    const waits: [typeof UI_MACHINES[number], string][] = [
      [SUBMIT_MACHINE, "submitting"],
      [SUBMIT_MACHINE, "leaving"],
      [CHECKOUT_MACHINE, "quoting"],
      [CHECKOUT_MACHINE, "paying"],
      [CHECKOUT_MACHINE, "confirming"],
      [PUSH_ASK_MACHINE, "busy"],
    ];
    for (const [m, s] of waits) expect(m.next(s).length, `${m.name}.${s}`).toBeGreaterThan(0);
  });
});

describe("moveOr (illegal moves)", () => {
  it("allows declared moves and staying put", () => {
    expect(moveOr(SUBMIT_MACHINE, "idle", "submitting")).toBe("submitting");
    expect(moveOr(SUBMIT_MACHINE, "idle", "idle")).toBe("idle");
  });

  it("throws in dev and tests", () => {
    expect(() => moveOr(SUBMIT_MACHINE, "leaving", "done")).toThrow(IllegalTransitionError);
  });

  it("warns once and stays put in production", () => {
    setIllegalMovePolicy("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(moveOr(SUBMIT_MACHINE, "leaving", "done", "test")).toBe("leaving");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("submitReducer", () => {
  const run = (events: Parameters<typeof submitReducer<string>>[1][], from: SubmitState<string> = SUBMIT_IDLE) => events.reduce((s, e) => submitReducer(s, e), from);

  it("idle -> submitting -> done, with the tag of the button that started it", () => {
    const s = run([{ type: "start", tag: "paddock:true" }]);
    expect(s).toMatchObject({ status: "submitting", tag: "paddock:true", error: null });
    expect(isSubmitBusy(s.status)).toBe(true);
    expect(run([{ type: "succeed" }], s).status).toBe("done");
  });

  it("a failure keeps the error until the next start (the retry)", () => {
    const err = new Error("nope");
    const failed = run([{ type: "start" }, { type: "fail", error: err }]);
    expect(failed).toMatchObject({ status: "failed", error: err });
    expect(isSubmitBusy(failed.status)).toBe(false);
    expect(run([{ type: "start" }], failed)).toMatchObject({ status: "submitting", error: null });
  });

  it("a check that fails before sending goes straight to failed, and can fail again with a new message", () => {
    const a = run([{ type: "fail", error: "first" }]);
    expect(a).toMatchObject({ status: "failed", error: "first" });
    expect(run([{ type: "fail", error: "second" }], a).error).toBe("second");
  });

  it("leaving stays busy; the back/forward cache brings it back to idle", () => {
    const leaving = run([{ type: "start" }, { type: "leave" }]);
    expect(leaving.status).toBe("leaving");
    expect(isSubmitBusy(leaving.status)).toBe(true);
    expect(run([{ type: "restored" }], leaving)).toEqual(SUBMIT_IDLE);
    // restored on a page that wasn't leaving changes nothing
    const done = run([{ type: "start" }, { type: "succeed" }]);
    expect(run([{ type: "restored" }], done)).toBe(done);
  });

  it("refuses a second start while submitting (double submit) and a result without a start", () => {
    const s = run([{ type: "start" }]);
    expect(() => submitReducer(s, { type: "start" })).not.toThrow(); // submitting -> submitting is staying put
    expect(submitReducer(s, { type: "start" })).toBe(s);
    expect(() => submitReducer(SUBMIT_IDLE, { type: "succeed" })).toThrow(IllegalTransitionError);
    setIllegalMovePolicy("warn");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(submitReducer(SUBMIT_IDLE, { type: "succeed" })).toBe(SUBMIT_IDLE);
    vi.restoreAllMocks();
  });
});

describe("loadReducer", () => {
  it("loading -> ready | failed, failed -> loading (Try again), ready -> loading keeps the data", () => {
    const s0 = LOAD_START<number>();
    const failed = loadReducer(s0, { type: "fail", error: "x" });
    expect(failed).toMatchObject({ status: "failed", data: null, error: "x" });
    const again = loadReducer(failed, { type: "load" });
    expect(again.status).toBe("loading");
    const ready = loadReducer(again, { type: "loaded", data: 7 });
    expect(ready).toEqual({ status: "ready", data: 7, error: null });
    const refreshing = loadReducer(ready, { type: "load" });
    expect(refreshing).toMatchObject({ status: "loading", data: 7 });
  });
});

describe("entrySheetReducer", () => {
  type S = EntrySheetState<string, string>;
  const step = (s: S, e: EntrySheetEvent<string, string>) => entrySheetReducer(s, e);
  const closed = ENTRY_SHEET_CLOSED as S;

  it("Quick Pick: pick -> entering -> later, then close", () => {
    let s = step(closed, { type: "openPick", token: 1 });
    expect(entrySheetView(s.target)).toBe("pick");
    s = step(s, { type: "startPick", token: 2, mode: "later" });
    expect(entrySheetView(s.target)).toBe("pickEntering");
    // a second tap while entering is ignored
    expect(step(s, { type: "startPick", token: 3, mode: "watch" })).toBe(s);
    s = step(s, { type: "pickLater", token: 2, result: "race-1" });
    expect(s.target).toEqual({ kind: "pick", status: "later", result: "race-1" });
    expect(entrySheetView(step(s, { type: "close" }).target)).toBe("closed");
  });

  it("a failed pick offers Try again back to the pick card", () => {
    let s = step(step(closed, { type: "openPick", token: 1 }), { type: "startPick", token: 2, mode: "watch" });
    s = step(s, { type: "pickFailed", token: 2, error: "timeout" });
    expect(entrySheetView(s.target)).toBe("pickFailed");
    s = step(s, { type: "openPick", token: 3 });
    expect(entrySheetView(s.target)).toBe("pick");
  });

  it("Watch / Skip: the sheet closes as the race page opens", () => {
    let s = step(step(closed, { type: "openPick", token: 1 }), { type: "startPick", token: 2, mode: "watch" });
    s = step(s, { type: "pickLeft", token: 2 });
    expect(s.target).toBeNull();
  });

  it("a result for an older sheet never replaces the one now open", () => {
    let s = step(step(closed, { type: "openPick", token: 1 }), { type: "startPick", token: 2, mode: "later" });
    s = step(s, { type: "close" });
    s = step(s, { type: "openEntry", token: 3, horseId: "h1", picker: false, nonce: 1 });
    const late = step(s, { type: "pickLater", token: 2, result: "old" });
    expect(late).toBe(s);
    expect(step(s, { type: "pickLeft", token: 2 })).toBe(s);
  });

  it("a pick that finishes after the sheet was closed reopens it with the outcome", () => {
    let s = step(closed, { type: "startLivePick", token: 1 });
    expect(entrySheetView(s.target)).toBe("livePickFinding");
    s = step(s, { type: "close" });
    s = step(s, { type: "livePickDone", token: 1, result: "race-9" });
    expect(s.target).toEqual({ kind: "livePick", status: "done", result: "race-9" });
  });

  it("Live Quick Pick failure -> Try again finds again", () => {
    let s = step(closed, { type: "startLivePick", token: 1 });
    s = step(s, { type: "livePickFailed", token: 1, error: "x" });
    expect(entrySheetView(s.target)).toBe("livePickFailed");
    s = step(s, { type: "startLivePick", token: 2 });
    expect(entrySheetView(s.target)).toBe("livePickFinding");
    expect(s.token).toBe(2);
  });

  it("opening while another sheet is open replaces it (through closed)", () => {
    let s = step(closed, { type: "openEntry", token: 1, horseId: null, picker: true, nonce: 1 });
    s = step(s, { type: "openLive", token: 2, raceId: "r1", nonce: 2 });
    expect(s.target).toEqual({ kind: "live", raceId: "r1", nonce: 2 });
    expect(s.token).toBe(2);
  });
});

describe("race page", () => {
  it("racePhase follows the clock and the replay", () => {
    expect(racePhase(null, false, 100)).toBe("loading");
    expect(racePhase(50, false, 100)).toBe("pre");
    expect(racePhase(150, false, 100)).toBe("live");
    expect(racePhase(50, true, 100)).toBe("result");
  });

  it("allows a clock correction live -> pre, never leaves result", () => {
    expect(() => checkPhaseMove("live", "pre")).not.toThrow();
    expect(() => checkPhaseMove("result", "live")).toThrow(IllegalTransitionError);
    expect(RACE_PAGE_MACHINE.isTerminal("result")).toBe(true);
  });

  it("finale: done is sticky (a replayed finale doesn't hide the results again)", () => {
    expect(finaleNext("pending", "running")).toBe("running");
    expect(finaleNext("running", "done")).toBe("done");
    expect(finaleNext("pending", "done")).toBe("done");
    expect(finaleNext("done", "running")).toBe("done");
    expect(FINALE_MACHINE.isTerminal("done")).toBe(true);
  });
});

describe("screen machines", () => {
  it("founding: form -> key -> mentor -> welcome, no skipping the key", () => {
    expect(FOUNDING_MACHINE.can("form", "key")).toBe(true);
    expect(FOUNDING_MACHINE.can("form", "welcome")).toBe(false);
    expect(FOUNDING_MACHINE.isTerminal("welcome")).toBe(true);
  });

  it("checkout: an order paid before a reload resumes into confirming; a wallet rejection returns to the quote", () => {
    expect(CHECKOUT_MACHINE.can("idle", "confirming")).toBe(true);
    expect(CHECKOUT_MACHINE.can("paying", "quoted")).toBe(true);
    expect(CHECKOUT_MACHINE.can("quoting", "paying")).toBe(false);
    expect(CHECKOUT_MACHINE.can("done", "idle")).toBe(true);
  });

  it("push ask: busy always ends in on / no / failed", () => {
    expect([...PUSH_ASK_MACHINE.next("busy")].sort()).toEqual(["failed", "no", "on"]);
  });
});

describe("player load status", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("a failed /api/me is 'failed' (Try again), the next success 'ready'", async () => {
    const { refreshPlayer, playerLoadStatus } = await import("../player");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(refreshPlayer()).rejects.toThrow();
    expect(playerLoadStatus()).toBe("failed");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ player: null })));
    await expect(refreshPlayer()).resolves.toBeNull();
    expect(playerLoadStatus()).toBe("ready");
  });
});
