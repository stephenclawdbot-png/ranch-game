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

export type ShotType = "gate" | "establish" | "close" | "pack" | "judge" | "post" | "wide";

/** What both views should show: the same subject, each in its own projection. */
export type ShotIntent =
  | { kind: "field" }
  | { kind: "group"; subject: string | null }
  | { kind: "line" }
  | { kind: "pullup"; subject: string | null };

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
}

/** Minimum time a framing is held before the director changes it (s). */
export const MIN_SHOT_S = 4;
/** The player's horse is never out of frame for longer than this (s). */
export const MAX_UNSEEN_S = 10;
/** How long a framing runs before the rotation moves on (s). */
const LENGTH: Record<ShotType, number> = { gate: 99, establish: 6, close: 8, pack: 6, judge: 99, post: 99, wide: 99 };
/** Half-width (m) around the subject that a framing shows. */
export const SHOT_REACH: Record<ShotType, number> = { gate: 1e9, establish: 1e9, close: 5, pack: 14, judge: 6, post: 40, wide: 1e9 };

export class Director {
  shot: Shot = { type: "gate", subject: null, since: 0 };
  /** Small screens: tighter rotation that favours close tracking on the player's horse. */
  compact = false;
  private lastSawHighlight = 0;
  private pendingFocus: string | null = null;
  private rotation = 0;
  private lastT = Number.NaN;

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
    const next = this.decide(inp);
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
    if (held < MIN_SHOT_S) return keep;

    // Never leave the player's horse out of frame for too long.
    if (hl && t - this.lastSawHighlight > MAX_UNSEEN_S - 2) {
      this.pendingFocus = null;
      return { type: "close", subject: hl };
    }

    // Final furlong: close on the leaders; widen to a pack if my horse is in the fight.
    if (toGo < 201) {
      const me = hl ? inp.runners.find((r) => r.id === hl) : null;
      if (me && leader && me.id !== leader.id && leader.x - me.x < SHOT_REACH.pack) return { type: "pack", subject: null };
      return { type: "close", subject: null };
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
}

export function leaderOf(runners: readonly DirectorRunner[]): DirectorRunner | null {
  let best: DirectorRunner | null = null;
  for (const r of runners) if (!best || r.x > best.x) best = r;
  return best;
}
