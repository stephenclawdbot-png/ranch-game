/**
 * The race page (/race/[id], RaceExperience). The phase is derived, never stored: from the clock
 * and the broadcast feed (`racePhase`), so it can't disagree with them. The machine documents and
 * checks the moves it can make.
 *
 *   loading (no clock yet) -> pre (countdown, paddock, build-up) -> live (the broadcast) -> result
 *
 * `live -> pre` is real: the feed measures the server clock on every poll, and a correction near
 * the off can move "now" back before post time for a moment. `result` is final: the replay only
 * arrives once the finish has been broadcast (no spoilers) and is never taken back.
 *
 * The finale (photo, slow-motion replay, weighed in) plays in the viewer first; the results below
 * wait for it when the race was watched live, or show after a few seconds if it never starts.
 * Once shown they stay: replaying the finale in the viewer no longer hides them again.
 */
import { defineMachine } from "@thoroughbred/shared";
import { moveOr } from "./guard";

export const RACE_PAGE_MACHINE = defineMachine({
  name: "racePage",
  storedIn: "RaceExperience (derived each render by racePhase: clock + feed)",
  states: ["loading", "pre", "live", "result"],
  initial: "loading",
  terminal: ["result"],
  transitions: {
    loading: ["pre", "live", "result"],
    pre: ["live", "result"],
    live: ["pre", "result"],
  },
  describe: {
    loading: "First paint: no client clock yet (a blank status chip).",
    pre: "Before the off: the paddock / countdown, then the viewer's build-up 32 s out. Entries-open cards refresh themselves until the field locks.",
    live: "The broadcast is running; the client only holds frames up to the live edge.",
    result: "The finish was broadcast: replay, results (after the finale), settlement, fairness check.",
  },
});

export type RacePhase = (typeof RACE_PAGE_MACHINE.states)[number];

/** The phase from what the page knows: the client clock (null before mount), the replay (only once the race is over) and local post time. */
export function racePhase(now: number | null, hasReplay: boolean, localPostMs: number): RacePhase {
  return now === null ? "loading" : hasReplay ? "result" : now < localPostMs ? "pre" : "live";
}

/** Checks a derived phase change (throws in dev on a move the machine doesn't allow; production warns). */
export function checkPhaseMove(from: RacePhase, to: RacePhase): void {
  moveOr(RACE_PAGE_MACHINE, from, to, "RaceExperience");
}

export const FINALE_MACHINE = defineMachine({
  name: "raceFinale",
  storedIn: "RaceExperience finale (the viewer's onFinale + a 6 s fallback)",
  states: ["pending", "running", "done"],
  initial: "pending",
  terminal: ["done"],
  transitions: {
    pending: ["running", "done"],
    running: ["done"],
  },
  describe: {
    pending: "Result known, finale not started: results wait (if watched live) at most 6 s.",
    running: "The viewer plays the finale; the results below say the result is being called.",
    done: "Results shown. Later finale replays in the viewer don't hide them again.",
  },
});

export type FinaleStage = (typeof FINALE_MACHINE.states)[number];

/** Next finale stage for a report from the viewer or the fallback timer. Once done it stays done. */
export function finaleNext(from: FinaleStage, report: FinaleStage): FinaleStage {
  if (from === "done") return from;
  return moveOr(FINALE_MACHINE, from, report, "RaceExperience finale");
}
