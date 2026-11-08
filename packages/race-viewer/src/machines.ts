/**
 * The race viewer's top-level states, declared with `defineMachine` (docs/state-machines-ui.md).
 * Pure: no DOM, no three.js, so apps/web lists them in its UI_MACHINES registry and docs.
 *
 * - VIEWER_LOAD_MACHINE: the picture starting (RaceViewer). `loading` can't last forever: after
 *   SLOW_LOAD_MS it becomes `slow` (the load carries on; Try again restarts it), and a renderer
 *   that can't start is `failed` with Try again.
 * - PLAYBACK_MACHINE: what the clocks (playback.ts) are doing, from their `playing` / `live`
 *   flags. `live` without `playing` is impossible; playback.machine.test.ts drives both clocks
 *   through every control and checks each change is one of these moves.
 */
import { IllegalTransitionError, defineMachine, type Machine } from "@thoroughbred/shared";

export const VIEWER_LOAD_MACHINE = defineMachine({
  name: "viewerLoad",
  storedIn: "RaceViewer load (packages/race-viewer/src/RaceViewer.tsx)",
  states: ["loading", "slow", "ready", "failed"],
  initial: "loading",
  transitions: {
    loading: ["ready", "slow", "failed"],
    slow: ["ready", "failed", "loading"],
    ready: ["loading"],
    failed: ["loading"],
  },
  describe: {
    loading: "Loading race… (code, art, horse sheets, GPU programs). Also after a view / setting change rebuilds the scene.",
    slow: "Still loading after SLOW_LOAD_MS: the load carries on, with a note and Try again (restarts the load).",
    ready: "The picture is up; playback and the HUD run.",
    failed: "The renderer couldn't start: what to do, that the race and result are safe, and Try again.",
  },
});

export type ViewerLoad = (typeof VIEWER_LOAD_MACHINE.states)[number];

/** How long the picture may take before the viewer says so and offers Try again. */
export const SLOW_LOAD_MS = 30_000;

export const PLAYBACK_MACHINE = defineMachine({
  name: "playback",
  storedIn: "PlaybackClock / LiveClock playing + live flags (packages/race-viewer/src/playback.ts)",
  states: ["paused", "playing", "live"],
  initial: ["paused", "playing", "live"],
  transitions: {
    paused: ["playing", "live"],
    playing: ["paused", "live"],
    live: ["paused", "playing"],
  },
  describe: {
    paused: "Not moving: paused, scrubbing, or stopped at the end (ended is a paused clock past the run-out).",
    playing: "Moving on its own at the chosen speed (a replay, or catching up behind the live edge).",
    live: "Following the broadcast / wall clock at the live edge (always playing too).",
  },
});

export type PlaybackMode = (typeof PLAYBACK_MACHINE.states)[number];

/** The mode a clock is in, from its flags. */
export function playbackMode(c: { playing: boolean; live: boolean }): PlaybackMode {
  return c.live ? "live" : c.playing ? "playing" : "paused";
}

/** The viewer's own copy of the UI move rule: dev and tests throw on an illegal move, production warns and stays. */
export function viewerMove<S extends string>(machine: Machine<S>, from: S, to: S, context?: string): S {
  if (from === to || machine.can(from, to)) return to;
  const err = new IllegalTransitionError(machine.name, from, to, context);
  if (process.env.NODE_ENV !== "production") throw err;
  console.warn(`[ui-machine] ${err.message}; ignored`);
  return from;
}
