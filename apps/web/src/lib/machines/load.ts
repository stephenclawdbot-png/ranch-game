/**
 * Data a screen needs before it can show anything: the signed-in player (/api/me), a Live race's
 * entry options, your settled result on a race page.
 *
 *   loading -> ready | failed;  failed -> loading (Try again, or an automatic retry);
 *   ready -> loading (a refresh; the last good data stays on screen meanwhile)
 *
 * `loading` always ends: the fetch has a timeout (fetchTimed / the player store's own).
 */
import { defineMachine } from "@thoroughbred/shared";
import { moveOr } from "./guard";

export const LOAD_MACHINE = defineMachine({
  name: "load",
  storedIn: "useLoad (apps/web/src/lib/machines/useLoad.ts), the player store (src/lib/player.ts)",
  states: ["loading", "ready", "failed"],
  initial: "loading",
  transitions: {
    loading: ["ready", "failed"],
    ready: ["loading"],
    failed: ["loading"],
  },
  describe: {
    loading: "Fetching; ends by itself after the request timeout.",
    ready: "The data is here. A refresh goes back to loading with the old data still shown.",
    failed: "A visible error with Try again (some screens also retry on their own).",
  },
});

export type LoadStatus = (typeof LOAD_MACHINE.states)[number];

export interface LoadState<T> {
  status: LoadStatus;
  data: T | null;
  error: unknown;
}

export type LoadEvent<T> = { type: "load" } | { type: "loaded"; data: T } | { type: "fail"; error: unknown };

export function loadReducer<T>(state: LoadState<T>, event: LoadEvent<T>): LoadState<T> {
  const target: LoadStatus = event.type === "load" ? "loading" : event.type === "loaded" ? "ready" : "failed";
  const to = moveOr(LOAD_MACHINE, state.status, target, `load:${event.type}`);
  if (to === state.status && event.type === "load") return state;
  if (to !== target) return state;
  if (event.type === "loaded") return { status: to, data: event.data, error: null };
  if (event.type === "fail") return { ...state, status: to, error: event.error };
  return { ...state, status: to };
}

export const LOAD_START = <T>(): LoadState<T> => ({ status: "loading", data: null, error: null });
