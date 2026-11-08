/**
 * One button that sends something to the server: enter a race, sign in, found a stable, open a
 * pack, pay. Replaces the `busy` + `error` (+ `done`) booleans each screen used to keep.
 *
 *   idle -> submitting -> done        (stays on the screen: a result, a confirmation)
 *                      -> leaving     (navigating away: a race page, Home after sign-in)
 *                      -> failed      (a visible error; the button works again = retry)
 *
 * `submitting` always ends: every call goes through `api()` or `fetchTimed()`, which give up
 * after API_TIMEOUT_MS with a "try again" message. `leaving` ends when the page changes; if the
 * browser brings this page back from its back/forward cache, it returns to `idle`
 * (2026-11-01: testers coming back to a page stuck on "Entering…"). The button is disabled
 * while `submitting` or `leaving`, and the hook refuses a second start in the same tick, so a
 * double tap can never send twice.
 */
import { defineMachine } from "@thoroughbred/shared";
import { moveOr } from "./guard";

export const SUBMIT_MACHINE = defineMachine({
  name: "submit",
  storedIn: "useSubmit (React state, apps/web/src/lib/machines/useSubmit.ts)",
  states: ["idle", "submitting", "done", "leaving", "failed"],
  initial: "idle",
  transitions: {
    idle: ["submitting", "failed"],
    submitting: ["done", "leaving", "failed"],
    done: ["submitting", "idle"],
    leaving: ["idle"],
    failed: ["submitting", "idle"],
  },
  describe: {
    idle: "Nothing sent yet; the button is ready.",
    submitting: "The request is out; the button is disabled and shows its busy label. Ends by itself after the API timeout.",
    done: "It worked and the screen stays: a confirmation shows.",
    leaving: "It worked and the page is changing (a race page, Home). Back from the back/forward cache returns to idle.",
    failed: "A visible error (or a check that failed before sending); the button works again, which is the retry.",
  },
});

export type SubmitStatus = (typeof SUBMIT_MACHINE.states)[number];

export interface SubmitState<T extends string = string> {
  status: SubmitStatus;
  /** Which of several buttons sharing the flow started it ("watch" / "instant", a pack slot). */
  tag: T | null;
  error: unknown;
}

export type SubmitEvent<T extends string = string> =
  | { type: "start"; tag?: T | null }
  | { type: "succeed" }
  | { type: "leave" }
  | { type: "fail"; error: unknown }
  | { type: "reset" }
  /** The page came back from the back/forward cache. */
  | { type: "restored" };

export const SUBMIT_IDLE: SubmitState<never> = { status: "idle", tag: null, error: null };

const TARGET: Record<SubmitEvent["type"], SubmitStatus> = {
  start: "submitting",
  succeed: "done",
  leave: "leaving",
  fail: "failed",
  reset: "idle",
  restored: "idle",
};

export function submitReducer<T extends string>(state: SubmitState<T>, event: SubmitEvent<T>): SubmitState<T> {
  // Coming back from the cache only matters to a page that was leaving.
  if (event.type === "restored" && state.status !== "leaving") return state;
  const to = moveOr(SUBMIT_MACHINE, state.status, TARGET[event.type], `submit:${event.type}`);
  if (to === state.status && event.type !== "fail") return state;
  switch (event.type) {
    case "start":
      return { status: to, tag: event.tag ?? null, error: null };
    case "fail":
      return to === "failed" ? { status: to, tag: state.tag, error: event.error } : state;
    case "reset":
    case "restored":
      return { status: to, tag: null, error: null };
    default:
      return { ...state, status: to };
  }
}

/** True while the button must stay disabled. */
export const isSubmitBusy = (s: SubmitStatus): boolean => s === "submitting" || s === "leaving";
