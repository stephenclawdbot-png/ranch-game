"use client";
/**
 * React side of SUBMIT_MACHINE (./submit.ts): one typed state instead of `busy` + `error`.
 *
 *   const entry = useSubmit();
 *   <button disabled={entry.busy} onClick={() => entry.run(async () => {
 *     const { raceId } = await enterStoryRace(...);
 *     pushSure(router, `/race/${raceId}`);
 *     return "leaving";              // or nothing: the screen stays ("done")
 *   })}>{entry.busy ? "Entering…" : "Go"}</button>
 *   {entry.error !== null && <ErrorNote error={entry.error} />}
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { SUBMIT_IDLE, isSubmitBusy, submitReducer, type SubmitEvent, type SubmitState } from "./submit";

export interface Submit<T extends string = string> extends SubmitState<T> {
  /** submitting or leaving: keep the button disabled. */
  busy: boolean;
  /**
   * Runs `task` unless this flow is already busy (a second tap is ignored, even in the same tick).
   * Resolve "leaving" when the task navigated away; anything else means "done". A throw is the
   * visible error (`error`), and the button works again.
   */
  run: (task: () => Promise<"leaving" | "done" | void>, tag?: T | null) => Promise<void>;
  /** An error found before sending anything (a check on the input). */
  reject: (error: unknown) => void;
  /** Back to idle (e.g. "Buy another"). */
  reset: () => void;
}

export function useSubmit<T extends string = string>(): Submit<T> {
  const [state, dispatch] = useReducer(submitReducer<T>, SUBMIT_IDLE as SubmitState<T>);
  const busyRef = useRef(false);
  const send = useCallback((e: SubmitEvent<T>) => dispatch(e), []);

  useEffect(() => {
    busyRef.current = isSubmitBusy(state.status);
  }, [state.status]);

  // Back/forward cache: a page restored after it navigated away must not stay on "Entering…".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      busyRef.current = false;
      send({ type: "restored" });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [send]);

  const run = useCallback<Submit<T>["run"]>(
    async (task, tag) => {
      if (busyRef.current) return;
      busyRef.current = true;
      send({ type: "start", tag: tag ?? null });
      try {
        const outcome = await task();
        if (outcome === "leaving") send({ type: "leave" });
        else {
          busyRef.current = false;
          send({ type: "succeed" });
        }
      } catch (error) {
        busyRef.current = false;
        send({ type: "fail", error });
      }
    },
    [send],
  );
  const reject = useCallback((error: unknown) => send({ type: "fail", error }), [send]);
  const reset = useCallback(() => send({ type: "reset" }), [send]);

  return useMemo(() => ({ ...state, busy: isSubmitBusy(state.status), run, reject, reset }), [state, run, reject, reset]);
}
