/**
 * The race call as the HUD's commentary ticker. Pure (no DOM, no clock).
 *
 * `RaceCallFeed` keeps the call for whatever the viewer holds: a finished replay (built once),
 * or a live broadcast (rebuilt as frames arrive, only up to the data edge; a live view has no
 * result to read). `callLineAt` then picks the line showing at the playhead: lines after the
 * playhead never show, so the ticker never runs ahead of the picture, and when lines come
 * faster than they can be read (2x / 4x playback) the lower-priority ones are dropped.
 */
import type { RaceReplay } from "@thoroughbred/shared";
import { buildRaceCall, type CallCourse, type CallLine, type LiveReplayView } from "./buildRaceCall";

export interface CallFeedOptions {
  /** horseId -> display name. */
  names: Record<string, string>;
  /** The viewer's horses ("your X"). */
  mine: readonly string[];
  distanceM: number;
  course?: CallCourse | null;
  going?: string;
  /** Anything stable per race that the broadcast already shows (the race id; never the seed while live). */
  seed: string;
}

export class RaceCallFeed {
  lines: CallLine[] = [];
  private builtFrames = -1;
  private builtFinal = false;

  constructor(private opts: CallFeedOptions) {}

  /**
   * Rebuild for the data held now. `final` = a finished race (whole call, once). Live: the
   * call is built only up to `edgeSec` (the last frame received), from frames and events.
   */
  update(source: RaceReplay | LiveReplayView, final: boolean, edgeSec: number): void {
    if (final) {
      if (this.builtFinal) return;
      this.builtFinal = true;
      this.lines = this.build(source, Number.POSITIVE_INFINITY);
      return;
    }
    this.builtFinal = false;
    const n = source.frames.length;
    if (n === this.builtFrames) return;
    this.builtFrames = n;
    this.lines = this.build(source, Math.max(-1, edgeSec));
  }

  private build(source: RaceReplay | LiveReplayView, uptoSec: number): CallLine[] {
    const o = this.opts;
    return buildRaceCall({
      replay: source,
      names: o.names,
      mine: [...o.mine],
      distanceM: o.distanceM,
      course: o.course ?? undefined,
      going: o.going,
      uptoSec,
      seed: o.seed,
    });
  }
}

export interface TickerPick {
  /** Race seconds a line must have to itself before the next one may replace it. */
  minShowSec: number;
  /** Race seconds a line stays up when nothing follows it. */
  holdSec: number;
}

/**
 * The call line showing at race time `t`: the newest line at or before `t`, after dropping the
 * lines that would overlap (a line arriving within `minShowSec` of the shown one replaces it
 * only when it matters more; otherwise it is skipped). Never looks past `t`.
 */
export function callLineAt(lines: readonly CallLine[], t: number, pick: TickerPick): CallLine | null {
  let shown: CallLine | null = null;
  for (const l of lines) {
    if (l.atSec > t) break;
    if (!shown || l.atSec - shown.atSec >= pick.minShowSec - 1e-6 || l.priority > shown.priority) shown = l;
  }
  if (!shown || t - shown.atSec > pick.holdSec) return null;
  return shown;
}
