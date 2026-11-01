/**
 * Race on a phone (visual research 2026-11-01, Prototype B; pure, no DOM at import).
 *
 * V-01, the phone race layout (stages of 480 px and narrower; on by default): the course map
 * folds to a button, the call line moves under the stage, the standings show the top three and
 * your horse. `?phonehud=0` on the page URL shows the previous layout, for comparison.
 *
 * V-02, "Close-up finish" (phones only; a viewer toggle, off by default; `?phonehud=2` forces it
 * on): in the final 400 m the camera frames the leaders and your horse instead of the whole field,
 * then goes back to the whole field for the run-out. Camera only: positions come from the replay,
 * nothing is invented; the camera eases there with the views' usual springs (no cut, no shake, no
 * zoom pulse).
 */
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";
import { CLOSING_M, KEEP_WITH_LEADER_M } from "./director";

/** Stage width (CSS px) at and below which the phone layout applies. */
export const PHONE_PX = 480;

/** `?phonehud=0` asks for the previous phone layout. */
export function phoneLayoutByUrl(): boolean {
  return urlParam("phonehud") !== "0";
}

/** `?phonehud=2` turns the close-up finish on (the owner's test switch). */
export function closeUpByUrl(): boolean {
  return urlParam("phonehud") === "2";
}

function urlParam(k: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(k);
  } catch {
    return null;
  }
}

/** Your horse joins the close-up when within this of the leader (six lengths, m). */
export const CLOSE_UP_MINE_M = (6 * HORSE_LENGTH_MM) / 1000;
/** The runner-up joins a clear leader when within this (three lengths, m): the race for the line, not the field. */
export const CLOSE_UP_RIVAL_M = (3 * HORSE_LENGTH_MM) / 1000;
/** A runner already in the group leaves it only past this (hysteresis, m): no zoom pumping at the edge. */
const LEAVE_PAD_M = (0.75 * HORSE_LENGTH_MM) / 1000;
/** The close-up holds this long past the winner's line (s), then the whole field returns for the run-out. */
export const CLOSE_UP_AFTER_S = 0.4;
/**
 * Trackside's placement eases between the whole field (squeezed to fit) and the close-up's plain
 * linear mapping over these times (s), with the lens: runners leave and come back into the frame
 * with the camera, never popping.
 */
export const CLOSE_UP_EASE_IN_S = 0.8;
export const CLOSE_UP_EASE_OUT_S = 1.6;

/** One step of that ease: `dt` < 0 snaps (a seek or the first frame). */
export function closeUpBlend(cur: number, on: boolean, dt: number): number {
  if (dt < 0) return on ? 1 : 0;
  const next = on ? cur + dt / CLOSE_UP_EASE_IN_S : cur - dt / CLOSE_UP_EASE_OUT_S;
  return Math.min(1, Math.max(0, next));
}

export interface CloseUpRunner {
  id: string;
  /** Distance covered (m). */
  x: number;
}

export interface CloseUpInput {
  t: number;
  trackLengthM: number;
  /** The winner's time at the line (Infinity until known). */
  winnerTime: number;
  runners: readonly CloseUpRunner[];
  highlightId: string | null;
}

/**
 * Who the close-up finish frames: null outside the final 400 m (and after the line); otherwise
 * the leader, every runner within two lengths of it (the director's final-furlong rule), the
 * runner-up within three lengths and your horse within six. Membership has a little hysteresis.
 */
export class CloseUpFinish {
  private members = new Set<string>();

  /** Is a group framed now? */
  get active(): boolean {
    return this.members.size > 0;
  }

  group(inp: CloseUpInput): string[] | null {
    let leader: CloseUpRunner | null = null;
    for (const r of inp.runners) if (!leader || r.x > leader.x) leader = r;
    if (!leader || inp.t < 1 || inp.t > inp.winnerTime + CLOSE_UP_AFTER_S || inp.trackLengthM - leader.x >= CLOSING_M) {
      this.members.clear();
      return null;
    }
    const lx = leader.x;
    const was = this.members;
    const inside = (r: CloseUpRunner, m: number) => lx - r.x <= m + (was.has(r.id) ? LEAVE_PAD_M : 0);
    const next = new Set<string>([leader.id]);
    for (const r of inp.runners) if (inside(r, KEEP_WITH_LEADER_M)) next.add(r.id);
    let second: CloseUpRunner | null = null;
    for (const r of inp.runners) if (r.id !== leader.id && (!second || r.x > second.x)) second = r;
    if (second && inside(second, CLOSE_UP_RIVAL_M)) next.add(second.id);
    const me = inp.highlightId ? inp.runners.find((r) => r.id === inp.highlightId) : undefined;
    if (me && inside(me, CLOSE_UP_MINE_M)) next.add(me.id);
    this.members = next;
    return inp.runners.filter((r) => next.has(r.id)).map((r) => r.id);
  }

  reset(): void {
    this.members.clear();
  }
}
