/**
 * Broadcast director (pure; no rendering). Side-on angles only: it chooses what the
 * side-on race camera frames (the whole field, close tracking, a slightly wider pack, the
 * finish line, the winner pulling up) and around whom. It never cuts: the scene eases the
 * camera between framings with critically damped springs, so the picture is one continuous move.
 *
 * Shared shot intent: the viewer keeps ONE director across both views and hands its intent
 * to whichever scene is drawing (`intentOf`): whole field / group around a horse / the line /
 * pull-up follow. Switching views keeps the same subject and a similar framing. The director
 * restarts itself when race time jumps (a seek), not when a view is rebuilt.
 */

import { HORSE_LENGTH_MM } from "@thoroughbred/shared";

export type ShotType = "gate" | "establish" | "close" | "pack" | "judge" | "post" | "wide" | "replay";

/** What both views should show: the same subject, each in its own projection. */
export type ShotIntent =
  | { kind: "field" }
  | { kind: "group"; subject: string | null }
  | { kind: "line" }
  | { kind: "pullup"; subject: string | null }
  /** The slow-motion finish replay: side-on, close on the subject (the winner) and its rivals. */
  | { kind: "replay"; subject: string | null };

export function intentOf(shot: Pick<Shot, "type" | "subject">): ShotIntent {
  switch (shot.type) {
    case "gate":
    case "establish":
    case "wide":
      return { kind: "field" };
    case "judge":
      return { kind: "line" };
    case "post":
      return { kind: "pullup", subject: shot.subject };
    case "replay":
      return { kind: "replay", subject: shot.subject };
    default:
      return { kind: "group", subject: shot.subject };
  }
}

export interface Shot {
  type: ShotType;
  /** Horse the framing is built around; null = whoever leads. */
  subject: string | null;
  /** Race time (s) the framing was chosen. */
  since: number;
}

export interface DirectorRunner {
  id: string;
  /** Distance covered (m). */
  x: number;
}

export interface DirectorEvent {
  type: string;
  horseId?: string;
}

export interface DirectorInput {
  t: number;
  runners: readonly DirectorRunner[];
  trackLengthM: number;
  /** Official winner time once known (else the first frame-derived crossing, else Infinity). */
  winnerTime: number;
  photoFinish: boolean;
  /** Events whose tick passed since the previous update. */
  newEvents: readonly DirectorEvent[];
  highlightId: string | null;
  /** The horse whose finish is being celebrated, once known (the post shot follows it). */
  winnerId?: string | null;
  /** A picture-in-picture inset shows your horse whenever the main shot does not (3D, desktop). */
  pipForMine?: boolean;
}

/** Minimum time a framing is held before the director changes it (s). */
export const MIN_SHOT_S = 4;
/** The player's horse is never out of frame for longer than this (s). */
export const MAX_UNSEEN_S = 10;
/** How long a framing runs before the rotation moves on (s). */
const LENGTH: Record<ShotType, number> = { gate: 99, establish: 6, close: 8, pack: 6, judge: 99, post: 99, wide: 99, replay: 99 };
/** Half-width (m) around the subject that a framing shows. */
export const SHOT_REACH: Record<ShotType, number> = { gate: 1e9, establish: 1e9, close: 5, pack: 14, judge: 6, post: 40, wide: 1e9, replay: 6 };

/** Closing stages: the leader is within this of the line (m). Your horse is never hidden long here. */
export const CLOSING_M = 400;
/** Final furlong (m): everything within KEEP_WITH_LEADER_M of the leader stays in frame. */
export const FINAL_FURLONG_M = 201;
/** Two lengths (m). */
export const KEEP_WITH_LEADER_M = (2 * HORSE_LENGTH_MM) / 1000;
/** In the closing stages a shot that hides your horse is held at most this long (s). */
export const CLOSING_UNSEEN_S = 3;
/** ...and a closing-stage shot is held at least this long (s). */
const CLOSING_HOLD_S = 2.5;
/** The last strides (m) stay on the leaders whatever else (the finish must be seen). */
export const FINISH_ON_LEADERS_M = 35;
/** A wide shot (m, leader back to your horse) that still reads in the closing stages. */
export const CLOSING_WIDE_M = 45;

export class Director {
  shot: Shot = { type: "gate", subject: null, since: 0 };
  /** Small screens: tighter rotation that favours close tracking on the player's horse. */
  compact = false;
  private lastSawHighlight = 0;
  private pendingFocus: string | null = null;
  private rotation = 0;
  private lastT = Number.NaN;
  private forced: Omit<Shot, "since"> | null = null;
  /**
   * Horses the current framing must contain (both views honour it): in the final furlong every
   * runner within two lengths of the leader, plus your horse when the shot was chosen to show it.
   */
  mustFrame: string[] = [];

  /** Hold a framing regardless of the race (the finish replay); null hands back to the director. */
  force(shot: Omit<Shot, "since"> | null): void {
    this.forced = shot;
  }

  reset(t = 0): void {
    this.shot = { type: "gate", subject: null, since: t };
    this.lastSawHighlight = t;
    this.pendingFocus = null;
    this.rotation = 0;
    this.lastT = t;
  }

  /** The current shot as an intent both views honour. */
  get intent(): ShotIntent {
    return intentOf(this.shot);
  }

  /** Is horse `id` inside the current framing? */
  shows(id: string, inp: DirectorInput): boolean {
    // A forced framing (the finish replay) is the whole picture: no inset beside it.
    if (this.forced || this.mustFrame.includes(id)) return true;
    const reach = SHOT_REACH[this.shot.type];
    if (reach >= 1e9) return true;
    const leader = leaderOf(inp.runners);
    const subjectId = this.shot.subject ?? leader?.id;
    if (subjectId === id) return true;
    const sub = inp.runners.find((r) => r.id === subjectId);
    const me = inp.runners.find((r) => r.id === id);
    if (!sub || !me) return false;
    return Math.abs(sub.x - me.x) <= reach;
  }

  /** `changed` = the framing target moved (the camera eases there; never a cut). */
  update(inp: DirectorInput): { shot: Shot; changed: boolean } {
    // A seek (time jumped) restarts the direction; a rebuilt view carries on.
    if (Number.isNaN(this.lastT) || inp.t < this.lastT - 1e-6 || inp.t - this.lastT > 0.6) this.reset(inp.t);
    this.lastT = inp.t;
    const prev = this.shot;
    const next = this.forced ?? this.decide(inp);
    this.mustFrame = this.forced ? [] : this.framingRule(inp, next);
    const changed = next.type !== prev.type || next.subject !== prev.subject;
    if (changed) this.shot = { ...next, since: inp.t };
    if (inp.highlightId && this.shows(inp.highlightId, inp)) this.lastSawHighlight = inp.t;
    return { shot: this.shot, changed };
  }

  private decide(inp: DirectorInput): Omit<Shot, "since"> {
    const { t } = inp;
    const cur = this.shot;
    const held = t - cur.since;
    const leader = leaderOf(inp.runners);
    const toGo = inp.trackLengthM - (leader?.x ?? 0);
    const hl = inp.highlightId;
    const keep = { type: cur.type, subject: cur.subject };

    for (const ev of inp.newEvents) {
      if ((ev.type === "move" || ev.type === "kick" || ev.type === "lead_change") && ev.horseId) {
        if (!this.pendingFocus || ev.horseId === hl) this.pendingFocus = ev.horseId;
      }
    }

    // Race phases (these change framing on time).
    if (t < 1.0) return { type: "gate", subject: null };
    if (inp.photoFinish && t > inp.winnerTime - 1.6 && t < inp.winnerTime + 0.9) return { type: "judge", subject: null };
    if (t > inp.winnerTime + 0.9) {
      const w = inp.winnerId ?? null;
      return cur.type === "post" && cur.subject === w ? keep : { type: "post", subject: w };
    }
    // Out of the stalls: the whole field first (establishing shot, scenery in frame).
    if (cur.type === "gate") return this.compact ? { type: "close", subject: null } : { type: "establish", subject: null };

    // Closing stages: the leaders (everything within two lengths of the leader), and your horse
    // never hidden for long: one shot holds both when it can, else short alternating looks.
    if (toGo < CLOSING_M && leader && t < inp.winnerTime) return this.closing(inp, leader, toGo, keep, held);
    if (held < MIN_SHOT_S) return keep;

    // Never leave the player's horse out of frame for too long.
    if (hl && t - this.lastSawHighlight > MAX_UNSEEN_S - 2) {
      this.pendingFocus = null;
      return { type: "close", subject: hl };
    }

    // Someone makes a move: widen to the pack around them (close if it's my horse).
    if (this.pendingFocus) {
      const id = this.pendingFocus;
      this.pendingFocus = null;
      return { type: id === hl ? "close" : "pack", subject: id === leader?.id ? null : id };
    }

    // Framing ran its course: close (leaders) -> whole field -> pack -> close (my horse / leaders).
    if (held >= LENGTH[cur.type]) {
      this.rotation++;
      const r = this.rotation % 4;
      if (r === 1 && !this.compact) return { type: "establish", subject: null };
      if (r === 2 && !this.compact) return { type: "pack", subject: null };
      if ((r === 3 || this.compact) && hl && hl !== leader?.id) return { type: "close", subject: hl };
      return { type: "close", subject: null };
    }
    return keep;
  }

  /** Closing-stage framing (see CLOSING_M). */
  private closing(inp: DirectorInput, leader: DirectorRunner, toGo: number, keep: Omit<Shot, "since">, held: number): Omit<Shot, "since"> {
    const hl = inp.highlightId;
    const me = hl ? inp.runners.find((r) => r.id === hl) : null;
    const behind = me ? leader.x - me.x : 0;
    const leaders: Omit<Shot, "since"> = toGo < FINAL_FURLONG_M ? { type: "close", subject: null } : { type: "pack", subject: null };
    let want: Omit<Shot, "since">;
    if (!me || behind <= KEEP_WITH_LEADER_M) want = leaders;
    else if (behind <= SHOT_REACH.pack) want = { type: "pack", subject: null };
    else if (behind <= CLOSING_WIDE_M && !this.compact) want = { type: "wide", subject: null };
    else {
      // Too far back for one shot: short alternating looks (the leaders, then your horse),
      // staying on the leaders for the last strides.
      const onMe = keep.type === "close" && keep.subject === hl;
      if (toGo < FINISH_ON_LEADERS_M || inp.pipForMine) want = leaders;
      else if (onMe) want = held >= CLOSING_UNSEEN_S ? leaders : keep;
      else if ((keep.type === "close" || keep.type === "pack") && keep.subject === null) want = held >= CLOSING_UNSEEN_S ? { type: "close", subject: hl } : keep;
      else want = leaders;
      if (want.type === keep.type && want.subject === keep.subject) return keep;
      return want;
    }
    if (want.type === keep.type && want.subject === keep.subject) return keep;
    // A new closing framing waits a moment, unless the current one breaks the rules.
    return this.framingOk(inp, keep) && held < CLOSING_HOLD_S ? keep : want;
  }
  /** Does `shot` (around its subject) contain what the closing-stage rules require? */
  private framingOk(inp: DirectorInput, shot: Omit<Shot, "since">): boolean {
    const reach = SHOT_REACH[shot.type];
    if (reach >= 1e9) return true;
    const leader = leaderOf(inp.runners);
    const sub = inp.runners.find((r) => r.id === (shot.subject ?? leader?.id));
    if (!sub) return false;
    return this.framingRule(inp, shot).every((id) => {
      const r = inp.runners.find((x) => x.id === id);
      return !!r && Math.abs(r.x - sub.x) <= reach;
    });
  }

  /** Horses `shot` must keep in frame (see mustFrame). */
  private framingRule(inp: DirectorInput, shot: Omit<Shot, "since">): string[] {
    const leader = leaderOf(inp.runners);
    if (!leader || inp.t >= inp.winnerTime) return [];
    const toGo = inp.trackLengthM - leader.x;
    if (toGo >= CLOSING_M || toGo <= 0) return [];
    // A look at your horse (alternating when it's far back) frames it, not the leaders.
    if (shot.type === "close" && shot.subject && shot.subject === inp.highlightId) return [shot.subject];
    const out: string[] = [];
    if (toGo < FINAL_FURLONG_M) for (const r of inp.runners) if (leader.x - r.x <= KEEP_WITH_LEADER_M) out.push(r.id);
    const hl = inp.highlightId;
    if (hl && !out.includes(hl)) {
      const me = inp.runners.find((r) => r.id === hl);
      const span = shot.type === "wide" ? CLOSING_WIDE_M : shot.type === "pack" ? SHOT_REACH.pack : KEEP_WITH_LEADER_M;
      if (me && leader.x - me.x <= span) out.push(hl);
    }
    return out;
  }
}

export function leaderOf(runners: readonly DirectorRunner[]): DirectorRunner | null {
  let best: DirectorRunner | null = null;
  for (const r of runners) if (!best || r.x > best.x) best = r;
  return best;
}
