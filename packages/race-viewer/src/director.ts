/**
 * TV-style broadcast director (pure; no rendering). Each tick it receives the race
 * state and decides which shot is on air. Cuts are hard (like TV) and motivated by the
 * race: the off, the establishing aerial, moves/kicks/lead changes, the turn into the
 * straight, the final furlong, a photo finish. Within a shot the camera moves smoothly
 * (that part is the scene's job).
 */

export type ShotType = "gate" | "close" | "pack" | "headon" | "aerial" | "rail" | "judge" | "post" | "wide";

export interface Shot {
  type: ShotType;
  /** Horse the shot is built around; null = whoever leads. */
  subject: string | null;
  /** Race time (s) of the cut. */
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
}

/** Minimum time between cuts (s). */
export const MIN_SHOT_S = 3;
/** The player's horse is never off screen for longer than this (s). */
export const MAX_UNSEEN_S = 10;
const LENGTH: Record<ShotType, number> = { gate: 99, close: 7, pack: 6, headon: 4, aerial: 5, rail: 5, judge: 99, post: 99, wide: 99 };
/** Half-width (m) around the subject that a shot shows. */
export const SHOT_REACH: Record<ShotType, number> = { gate: 1e9, close: 5, pack: 14, headon: 8, aerial: 1e9, rail: 6, judge: 6, post: 40, wide: 1e9 };

export class Director {
  shot: Shot = { type: "gate", subject: null, since: 0 };
  private aerials = 0;
  private headons = 0;
  private finalRail = false;
  private lastSawHighlight = 0;
  private pendingFocus: string | null = null;
  private rotation = 0;

  reset(t = 0): void {
    this.shot = { type: "gate", subject: null, since: t };
    this.aerials = 0;
    this.headons = 0;
    this.finalRail = false;
    this.lastSawHighlight = t;
    this.pendingFocus = null;
    this.rotation = 0;
  }

  /** Is horse `id` inside the current shot? */
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

  update(inp: DirectorInput): { shot: Shot; cut: boolean } {
    const prev = this.shot;
    const next = this.decide(inp);
    const cut = next.type !== prev.type || next.subject !== prev.subject;
    if (cut) this.shot = { ...next, since: inp.t };
    if (inp.highlightId && this.shows(inp.highlightId, inp)) this.lastSawHighlight = inp.t;
    return { shot: this.shot, cut };
  }

  private decide(inp: DirectorInput): Omit<Shot, "since"> {
    const { t } = inp;
    const cur = this.shot;
    const held = t - cur.since;
    const leader = leaderOf(inp.runners);
    const L = inp.trackLengthM;
    const lead = leader?.x ?? 0;
    const progress = L > 0 ? lead / L : 0;
    const toGo = L - lead;
    const hl = inp.highlightId;
    const keep = { type: cur.type, subject: cur.subject };

    for (const ev of inp.newEvents) {
      if ((ev.type === "move" || ev.type === "kick" || ev.type === "lead_change") && ev.horseId) {
        // The player's horse wins ties for attention.
        if (!this.pendingFocus || ev.horseId === hl) this.pendingFocus = ev.horseId;
      }
    }

    // Forced shots (always on time, regardless of the 3 s rule).
    if (t < 1.0) return { type: "gate", subject: null };
    if (inp.photoFinish && t > inp.winnerTime - 1.6 && t < inp.winnerTime + 0.9) return { type: "judge", subject: null };
    if (t > inp.winnerTime + 0.9) return cur.type === "post" ? keep : { type: "post", subject: null };
    if (cur.type === "gate") return { type: "close", subject: null };
    if (held < MIN_SHOT_S) return keep;

    // Final furlong: low rail cam, then close on the leaders to the line.
    if (toGo < 201) {
      if (!this.finalRail) {
        this.finalRail = true;
        return { type: "rail", subject: null };
      }
      if (cur.type === "rail" && held < LENGTH.rail) return keep;
      if (hl && t - this.lastSawHighlight > MAX_UNSEEN_S * 0.6) return { type: "close", subject: hl };
      if (cur.type === "close" || cur.type === "pack") return keep;
      return { type: "close", subject: null };
    }

    // Establishing aerial early (shows everyone, the player's horse included); an
    // optional second one mid-race.
    if (this.aerials === 0 && progress > 0.15 && progress < 0.3) {
      this.aerials++;
      return { type: "aerial", subject: null };
    }
    if (cur.type === "aerial" && held < LENGTH.aerial) return keep;

    // Never leave the player's horse unseen for too long.
    if (hl && t - this.lastSawHighlight > MAX_UNSEEN_S - 1) {
      this.pendingFocus = null;
      return { type: "close", subject: hl };
    }

    // Motivated cut: someone makes a move.
    if (this.pendingFocus) {
      const id = this.pendingFocus;
      this.pendingFocus = null;
      return { type: id === hl ? "close" : "pack", subject: id === leader?.id ? null : id };
    }

    // Head-on cutaways: mid-race and turning for home.
    if ((this.headons === 0 && progress > 0.36 && progress < 0.45) || (this.headons === 1 && progress > 0.62 && progress < 0.74)) {
      this.headons++;
      return { type: "headon", subject: null };
    }
    if (this.aerials === 1 && progress > 0.5 && progress < 0.58 && spread(inp.runners) > 45) {
      this.aerials++;
      return { type: "aerial", subject: null };
    }

    // Shot ran its course: rotate close (leaders) -> pack -> close (player / leaders).
    if (held >= LENGTH[cur.type]) {
      this.rotation++;
      const r = this.rotation % 3;
      if (r === 1) return { type: "pack", subject: null };
      if (r === 2 && hl && hl !== leader?.id) return { type: "close", subject: hl };
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

function spread(runners: readonly DirectorRunner[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of runners) {
    lo = Math.min(lo, r.x);
    hi = Math.max(hi, r.x);
  }
  return hi - lo;
}
