/**
 * Before the off (pure, deterministic): the build-up both views play in the last ~24 s before
 * the off. Everything here comes from what is public once the field is locked (the runners and
 * their gates) and from race time alone, never from the result or the seed, so a live viewer
 * who arrives late joins exactly where the real clock is.
 *
 *   t < POST_FROM          the parade in the paddock (an overlay: the host's paddock scene)
 *   POST_FROM..LOAD_FROM   going down to post: the field canters past the stands in pairs
 *   LOAD_FROM..SETTLE_AT   loading: one by one (odd stalls first, then even) each horse walks
 *                          from behind the stalls into its bay
 *   SETTLE_AT..0           all in, the gates shut: under starter's orders, then the off at 0
 *
 * Going down to post is shown as the broadcast shows it: the field cantering away past the
 * stands (left to right in both views, the race direction), then a cut to the start. No new
 * art is needed: the canter and walk are the ease-up strip's canter and trot frames, standing
 * behind the stalls is the idle strip, and standing in a bay is the break strip's frame 0.
 */
import { strideLengthM } from "../scene/horse/gait";
import type { RunnerState } from "./motion";

/** The build-up starts this long before the off (s); before that, the paddock. */
export const PRE_OFF_SEC = 24;
/** Going down to post starts (s, race time). */
export const POST_FROM = -18;
/** Loading starts (s). */
export const LOAD_FROM = -10;
/** Every runner is in its bay by now (s): the last moments are the stalls, gates shut. */
export const SETTLE_AT = -1.2;
/** Canter speed on the way to post (m/s). */
export const POST_CANTER = 7;
/** How far behind the stalls the runners wait (m, nose position). */
export const WAIT_M = 6;
/** Seconds a horse takes to walk from behind the stalls into its bay. */
export const WALK_IN_S = 1.8;
/** The stand's centre, metres before the line (as the stage places it). */
const STAND_BEFORE_LINE_M = 30;

export type PreOffKind = "parade" | "post" | "loading" | "settled" | "off";

export interface PreOffPlan {
  /** Race distance (m). */
  L: number;
  /** Runner indices in loading order (odd stalls first, then even, by stall number). */
  order: number[];
  /** Per runner: race time (s) it starts walking into its bay. */
  loadAt: number[];
  /** Per runner: offset (m) from the cantering group's centre and lane on the way to post. */
  post: { dx: number; lane: number }[];
  /** Per runner: where it waits behind the stalls (m before the start). */
  waitX: number[];
}

export interface PreOffStep {
  kind: PreOffKind;
  /** Race time the step started / ends (s). */
  from: number;
  to: number;
  /** 0..1 through the step. */
  u: number;
}

/** Deterministic per-runner jitter in [0, 1) from its stall number (no randomness). */
function jitter(gate: number, salt: number): number {
  let h = Math.imul(gate * 2654435761 + salt * 40503, 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The plan for a field: only the runners' stall numbers, the race distance and the lane count
 * (all public once the field is locked).
 */
export function preOffPlan(horses: ReadonlyArray<{ gate: number }>, distanceM: number, laneCount = 8): PreOffPlan {
  const n = horses.length;
  const idx = horses.map((_, i) => i);
  const gateOf = (i: number) => horses[i]!.gate;
  const odd = (i: number) => (gateOf(i) % 2 === 1 ? 0 : 1);
  const order = [...idx].sort((a, b) => odd(a) - odd(b) || gateOf(a) - gateOf(b) || a - b);
  const loadAt = new Array<number>(n).fill(LOAD_FROM);
  const span = SETTLE_AT - WALK_IN_S - 0.4 - (LOAD_FROM + 0.8);
  const step = n > 1 ? span / (n - 1) : 0;
  order.forEach((h, j) => (loadAt[h] = LOAD_FROM + 0.8 + j * step));
  // To post: in pairs by stall number, the inner one of a pair half a length ahead.
  const maxLane = Math.max(1, laneCount - 1);
  const byGate = [...idx].sort((a, b) => gateOf(a) - gateOf(b));
  const raw = byGate.map((h, k) => {
    const row = Math.floor(k / 2);
    const side = k % 2;
    return { h, dx: -row * 5 - side * 1.3 + (jitter(gateOf(h), 1) - 0.5) * 1.2, lane: Math.min(maxLane, (side ? 3.6 : 1.6) + (jitter(gateOf(h), 2) - 0.5) * 0.6) };
  });
  const mid = raw.length ? (Math.max(...raw.map((r) => r.dx)) + Math.min(...raw.map((r) => r.dx))) / 2 : 0;
  const post = new Array<{ dx: number; lane: number }>(n);
  for (const r of raw) post[r.h] = { dx: r.dx - mid, lane: r.lane };
  const waitX = idx.map((i) => -WAIT_M - jitter(gateOf(i), 3) * 1.5);
  return { L: distanceM, order, loadAt, post, waitX };
}

/** Which part of the build-up race time `t` is in. */
export function preOffStep(t: number): PreOffStep {
  if (t >= 0) return { kind: "off", from: 0, to: Infinity, u: 0 };
  if (t < POST_FROM) return { kind: "parade", from: -PRE_OFF_SEC, to: POST_FROM, u: Math.min(1, Math.max(0, (t + PRE_OFF_SEC) / (PRE_OFF_SEC + POST_FROM))) };
  if (t < LOAD_FROM) return { kind: "post", from: POST_FROM, to: LOAD_FROM, u: (t - POST_FROM) / (LOAD_FROM - POST_FROM) };
  if (t < SETTLE_AT) return { kind: "loading", from: LOAD_FROM, to: SETTLE_AT, u: (t - LOAD_FROM) / (SETTLE_AT - LOAD_FROM) };
  return { kind: "settled", from: SETTLE_AT, to: 0, u: (t - SETTLE_AT) / -SETTLE_AT };
}

/** Centre (m) of the cantering group at race time t (passes the stand mid-way). */
export function postCentre(plan: PreOffPlan, t: number): number {
  const mid = (POST_FROM + LOAD_FROM) / 2;
  return plan.L - STAND_BEFORE_LINE_M + POST_CANTER * (Math.min(LOAD_FROM, Math.max(POST_FROM, t)) - mid);
}

const frac = (p: number) => p - Math.floor(p);
const CANTER_FRAMES = [6, 7, 8, 9] as const;
const TROT_FRAMES = [10, 11, 12, 11] as const;
const WALK_SPEED = WAIT_M / WALK_IN_S;

/**
 * Runner `h` at race time t < 0, given where it starts the race (`start`: its x and lane at
 * the off). Writes into `out`.
 */
export function preOffRunner(plan: PreOffPlan, h: number, t: number, start: { x: number; lane: number }, out: RunnerState = {} as RunnerState): RunnerState {
  const step = preOffStep(t);
  if (step.kind === "parade" || step.kind === "post") {
    // The paddock is an overlay: the scene behind it holds the first frame of the canter.
    const p = plan.post[h]!;
    const tt = step.kind === "parade" ? POST_FROM : t;
    out.x = postCentre(plan, tt) + p.dx;
    out.lane = p.lane;
    out.speed = step.kind === "parade" ? 0 : POST_CANTER;
    out.gait = step.kind === "parade" ? "stand" : "canter";
    out.phase = out.x / strideLengthM(POST_CANTER) + h * 0.29;
    out.anim = "easeup";
    out.frame = CANTER_FRAMES[Math.floor(frac(out.phase) * 4) % 4]!;
    return out;
  }
  const at = plan.loadAt[h]!;
  const wx = start.x + plan.waitX[h]!;
  out.lane = start.lane;
  if (t < at) {
    // Waiting behind the stalls (standing, breathing, a flick of the tail).
    out.x = wx;
    out.speed = 0;
    out.gait = "stand";
    out.phase = 0;
    out.anim = "idle";
    out.frame = Math.floor((t - LOAD_FROM) * 6 + h * 3) % 14;
    return out;
  }
  const dt = t - at;
  if (dt < WALK_IN_S) {
    // Led in: a steady walk-trot from behind the stalls into the bay.
    const u = dt / WALK_IN_S;
    const e = u * u * (3 - 2 * u);
    out.x = wx + (start.x - wx) * e;
    out.speed = WALK_SPEED * 6 * u * (1 - u);
    out.gait = "walk";
    out.phase = (out.x - wx) / 1.6;
    out.anim = "easeup";
    out.frame = TROT_FRAMES[Math.floor(frac(out.phase) * 4) % 4]!;
    return out;
  }
  // In the bay, gates shut: the break strip's standing frame (as at the off).
  out.x = start.x;
  out.speed = 0;
  out.gait = "stand";
  out.phase = 0;
  out.anim = "break";
  out.frame = 0;
  return out;
}

/** Loading progress at t: how many are in, and who is walking in now (runner index or -1). */
export function loadingAt(plan: PreOffPlan, t: number): { loaded: number; walking: number; total: number } {
  let loaded = 0;
  let walking = -1;
  for (const h of plan.order) {
    const at = plan.loadAt[h]!;
    if (t >= at + WALK_IN_S) loaded++;
    else if (t >= at && walking < 0) walking = h;
  }
  return { loaded, walking, total: plan.order.length };
}
