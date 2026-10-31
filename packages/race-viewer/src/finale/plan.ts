/**
 * The finish as an event (pure, deterministic): what the broadcast shows after the line, in
 * which order and for how long, built from the OFFICIAL result only. Nothing here may run
 * before the result exists: on a live broadcast the viewer builds a plan only once
 * `feed.final` has arrived (which the server sends only after the finish has been broadcast).
 *
 *   photograph  "Photograph!" (first two within a head: nose / short head / head, or a dead heat)
 *   strip       the line-scan strip, the judge's line sliding nose to nose, the verdict
 *   replay      slow-motion replay of the last ~100 m (close finishes: within a length)
 *   weighed     "Weighed in": the official all-clear (the seal check)
 *   slide       the placed horses slide in: your horse (outside the top 3), 3rd, 2nd, the winner
 *
 * Step durations are real seconds. The replay maps real seconds to race time with a rate that
 * eases from full speed 100 m out down to SLOWMO_MIN at the line.
 */
import { HORSE_LENGTH_MM, type FinishRecord, type RaceReplay } from "@thoroughbred/shared";
import { marginPhrase } from "../photo/model";

export type FinaleStepKind = "photograph" | "strip" | "replay" | "weighed" | "slide";

export interface FinaleSlide {
  horseId: string;
  /** Official placing (dead-heaters share it). */
  position: number;
  /** One of the viewer's horses. */
  mine: boolean;
  /** The race winner (the card that holds). */
  winner: boolean;
  finishTimeUs: number;
  /** Distance behind the winner (mm, summed official margins); 0 for the winner. */
  behindWinnerMm: number;
  /** "won by a short head", "2nd, beaten a neck", "6th, beaten 4 lengths". */
  marginText: string;
}

export interface FinaleStep {
  kind: FinaleStepKind;
  /** Real seconds. */
  dur: number;
  slide?: FinaleSlide;
}

export interface FinalePlan {
  /** Race time (s) at which the finale starts (a replay crossing it plays the finale). */
  startAt: number;
  winnerTime: number;
  /** First two within a head (or a dead heat): the photograph is shown. */
  photo: boolean;
  /** First two within a length: the slow-motion replay is shown. */
  close: boolean;
  steps: FinaleStep[];
  /** Total real seconds. */
  total: number;
  /** Slow-motion window (race time); null without a replay. */
  replay: { from: number; to: number } | null;
}

/** Margin under which the photograph is called (the engine's "head" ends at 700 mm). */
export const PHOTO_WITHIN_MM = 700;
/** Margin under which the finish is replayed in slow motion (a length). */
export const CLOSE_WITHIN_MM = HORSE_LENGTH_MM;
/** The finale starts this long after the winner crosses (the field easing down first)... */
export const FINALE_AFTER_WINNER_S = 3.2;
/** ...and not before the last runner is home (live: the result is only official then)... */
export const FINALE_AFTER_LAST_S = 0.8;
/** ...but a replay of a strung-out field doesn't wait longer than this after the winner. */
export const FINALE_MAX_WAIT_S = 12;
/** Slow-motion replay: from the leader this far out (m)... */
export const REPLAY_FROM_M = 100;
/** ...to this long after the winner's crossing (s, race time). */
export const REPLAY_PAST_S = 0.5;
/** Slowest replay rate (at the line). */
export const SLOWMO_MIN = 0.35;

export const STEP_SECONDS = {
  photograph: 1.8,
  strip: 5.2,
  weighed: 2.6,
  slide: 2.8,
  mine: 3.4,
  winner: 6.5,
} as const;

/** Engine margin label for a distance (mm), the racing-engine's thresholds (results.ts). */
export function marginLabelFor(mm: number): string {
  if (mm < 150) return "nose";
  if (mm < 400) return "short head";
  if (mm < 700) return "head";
  if (mm < 1200) return "neck";
  const quarters = Math.floor((mm * 4 + HORSE_LENGTH_MM / 2) / HORSE_LENGTH_MM);
  const Q = ["", "1/4", "1/2", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2"];
  if (quarters <= 8) return Q[quarters] || "1/2";
  const halves = Math.max(5, Math.floor((mm * 2 + HORSE_LENGTH_MM / 2) / HORSE_LENGTH_MM));
  if (halves <= 20) return halves % 2 === 0 ? `${halves / 2}` : `${(halves - 1) / 2} 1/2`;
  const whole = Math.floor((mm + HORSE_LENGTH_MM / 2) / HORSE_LENGTH_MM);
  if (whole <= 15) return `${Math.max(10, whole)}`;
  return "dist";
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** Official order (by position, then crossing time). */
function officialOrder(replay: Pick<RaceReplay, "result">): FinishRecord[] {
  return [...replay.result.finishOrder].sort((a, b) => a.position - b.position || a.finishTimeUs - b.finishTimeUs);
}

/** Whether the first two were within a head (or dead-heated): the photograph is called. */
export function isPhotoFinish(replay: Pick<RaceReplay, "result">): boolean {
  const [a, b] = officialOrder(replay);
  if (!a || !b) return false;
  return replay.result.photoFinish || b.position === a.position || b.finishTimeUs === a.finishTimeUs || b.marginMm < PHOTO_WITHIN_MM;
}

export function isCloseFinish(replay: Pick<RaceReplay, "result">): boolean {
  const [a, b] = officialOrder(replay);
  if (!a || !b) return false;
  return isPhotoFinish(replay) || b.marginMm <= CLOSE_WITHIN_MM;
}

/** The slides, in showing order: the viewer's horses outside the top 3, then 3rd, 2nd, the winner(s). */
export function finaleSlides(replay: Pick<RaceReplay, "result">, mine: readonly string[] = []): FinaleSlide[] {
  const order = officialOrder(replay);
  const mineSet = new Set(mine);
  const behind = new Map<string, number>();
  let acc = 0;
  order.forEach((f, i) => {
    if (i > 0 && f.position !== order[i - 1]!.position) acc += f.marginMm;
    behind.set(f.horseId, acc);
  });
  const top = order.filter((f) => f.position <= 3);
  const second = order.find((f) => f.position > 1);
  const make = (f: FinishRecord): FinaleSlide => {
    const b = behind.get(f.horseId) ?? 0;
    const winner = f.position === 1;
    let marginText: string;
    if (winner) {
      const dead = order.filter((o) => o.position === 1).length > 1;
      marginText = dead ? "dead heat for first" : second ? `won by ${marginPhrase(second.marginLabel || marginLabelFor(second.marginMm))}` : "won";
    } else {
      const deadHeat = order.some((o) => o !== f && o.position === f.position);
      marginText = `${ordinal(f.position)}${deadHeat ? " (dead heat)" : ""}, beaten ${marginPhrase(marginLabelFor(b))}`;
    }
    return { horseId: f.horseId, position: f.position, mine: mineSet.has(f.horseId), winner, finishTimeUs: f.finishTimeUs, behindWinnerMm: b, marginText };
  };
  const out: FinaleSlide[] = [];
  // Your horses outside the places first (at most two cards), so the winner's card ends it.
  for (const f of order) if (f.position > 3 && mineSet.has(f.horseId) && out.filter((s) => s.mine).length < 2) out.push(make(f));
  for (let i = top.length - 1; i >= 0; i--) out.push(make(top[i]!));
  return out;
}

/** Replay rate at race time `t` (eases from 1x well before the line to SLOWMO_MIN at it). */
export function replayRate(t: number, winnerTime: number): number {
  const u = winnerTime - t;
  const a = 0.6;
  const b = 3.0;
  const k = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return SLOWMO_MIN + (1 - SLOWMO_MIN) * k * k * (3 - 2 * k);
}

const REPLAY_STEP = 1 / 120;

/** Real seconds the replay window lasts at replayRate. */
function replayDuration(from: number, to: number, winnerTime: number): number {
  let t = from;
  let s = 0;
  while (t < to) {
    t += REPLAY_STEP * replayRate(t, winnerTime);
    s += REPLAY_STEP;
  }
  return s;
}

/**
 * Race time shown `s` real seconds into the replay (deterministic integration of the rate).
 * Cheap enough per frame (a few hundred steps at most).
 */
export function replayTimeAt(plan: Pick<FinalePlan, "replay" | "winnerTime">, s: number): number {
  const w = plan.replay;
  if (!w) return plan.winnerTime;
  let t = w.from;
  let left = Math.max(0, s);
  while (left > 0 && t < w.to) {
    const h = Math.min(REPLAY_STEP, left);
    t += h * replayRate(t, plan.winnerTime);
    left -= h;
  }
  return Math.min(t, w.to);
}

export interface FinalePlanOptions {
  /** The viewer's horses (their own card when outside the places). */
  mine?: readonly string[];
  /** Race time at which the leader was REPLAY_FROM_M out (playback.ts timeLeaderReaches); default: from the winner's line speed. */
  replayFrom?: number | null;
  /** Time of the last runner home (s); default from the result. */
  lastFinishTime?: number;
}

export function finalePlan(replay: Pick<RaceReplay, "result">, opts: FinalePlanOptions = {}): FinalePlan {
  const order = officialOrder(replay);
  const winnerTime = replay.result.winningTimeUs / 1e6 || (order[0] ? order[0].finishTimeUs / 1e6 : 0);
  const lastFinish = opts.lastFinishTime ?? order.reduce((m, f) => Math.max(m, f.finishTimeUs / 1e6), winnerTime);
  const startAt = Math.min(winnerTime + FINALE_MAX_WAIT_S, Math.max(winnerTime + FINALE_AFTER_WINNER_S, lastFinish + FINALE_AFTER_LAST_S));
  const photo = isPhotoFinish(replay);
  const close = isCloseFinish(replay);
  const steps: FinaleStep[] = [];
  if (photo) {
    steps.push({ kind: "photograph", dur: STEP_SECONDS.photograph });
    steps.push({ kind: "strip", dur: STEP_SECONDS.strip });
  }
  let win: FinalePlan["replay"] = null;
  if (close) {
    const from = Math.max(0, opts.replayFrom ?? winnerTime - REPLAY_FROM_M / 16.5);
    win = { from: Math.min(from, winnerTime - 1), to: winnerTime + REPLAY_PAST_S };
    steps.push({ kind: "replay", dur: replayDuration(win.from, win.to, winnerTime) });
  }
  steps.push({ kind: "weighed", dur: STEP_SECONDS.weighed });
  for (const s of finaleSlides(replay, opts.mine)) steps.push({ kind: "slide", slide: s, dur: s.winner ? STEP_SECONDS.winner : s.mine ? STEP_SECONDS.mine : STEP_SECONDS.slide });
  const total = steps.reduce((a, s) => a + s.dur, 0);
  return { startAt, winnerTime, photo, close, steps, total, replay: win };
}

/** Where the finale is `elapsed` real seconds in: the step, its index and time into it. */
export function finaleStepAt(plan: FinalePlan, elapsed: number): { index: number; step: FinaleStep | null; into: number } {
  let t = Math.max(0, elapsed);
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]!;
    if (t < s.dur) return { index: i, step: s, into: t };
    t -= s.dur;
  }
  return { index: plan.steps.length, step: null, into: 0 };
}

/** Real seconds from the start of the finale to the start of step `index`. */
export function stepStart(plan: FinalePlan, index: number): number {
  let t = 0;
  for (let i = 0; i < Math.min(index, plan.steps.length); i++) t += plan.steps[i]!.dur;
  return t;
}

/**
 * Race time the scene should draw during the finale, or null for "the playback clock's time".
 * The replay plays its slow-motion window; after it the field carries on from the end of the
 * replay at full speed (the winner celebrating behind the slides), so the replay flows into
 * the pull-up instead of cutting away.
 */
export function finaleSceneTime(plan: FinalePlan, elapsed: number): number | null {
  if (!plan.replay) return null;
  const at = finaleStepAt(plan, elapsed);
  const ri = plan.steps.findIndex((s) => s.kind === "replay");
  if (ri < 0 || at.index < ri) return null;
  if (at.index === ri) return replayTimeAt(plan, at.into);
  return plan.replay.to + (elapsed - stepStart(plan, ri + 1));
}
