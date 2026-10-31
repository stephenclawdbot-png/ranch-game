/**
 * Race-clip planning (pure, no DOM, no clock): the finish window, the 30 fps frame
 * schedule, what overlays sit on each frame, the end card's rows and the share filename.
 * Everything here is a function of the replay alone, so a clip is reproducible frame
 * for frame. DOM canvas drawing lives in overlay.ts, encoding in encode.ts.
 */
import { formatRaceTime, type RaceReplay } from "@thoroughbred/shared";
import { replayTiming } from "../sampleReplay";
import { timeLeaderReaches } from "../playback";
import { callLineAt, type TickerPick } from "../call/ticker";
import type { CallLine } from "../call/buildRaceCall";
import { marginPhrase } from "../photo/model";
import { isPhotoFinish, marginLabelFor, ordinal } from "../finale/plan";

/** Frames per second, also the fixed realDt fed to the scenes so a clip is deterministic. */
export const CLIP_FPS = 30;
/** The clip opens with the leader about this far from the line (m). */
export const CLIP_FROM_M = 300;
/** Clip length bounds (s): "the last ~12-15 s of the race". */
export const CLIP_MIN_SEC = 12;
export const CLIP_MAX_SEC = 15;
/** How long past the last finisher the footage runs (the ease-down). */
export const EASE_DOWN_SEC = 1;
/** The placed horses overlay the last this-many seconds of the footage. */
export const END_CARD_SEC = 2.6;
/** End card fade-in (s). */
export const END_CARD_FADE_SEC = 0.4;
/** A photo finish ends with the line-scan strip and verdict held this long. */
export const PHOTO_HOLD_SEC = 2;
/**
 * Stepped before the first encoded frame (never encoded) so the camera springs, the
 * director and ambient fx match continuous playback from the first frame of the clip.
 */
export const CLIP_WARMUP_SEC = 4;

export type ClipOrientation = "vertical" | "landscape";

/** Encoded frame sizes (TikTok/Reels/X vertical, X/YouTube landscape). */
export const CLIP_SIZES: Record<ClipOrientation, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

/** A clip may only ever be cut from an official (settled) result — never a live broadcast. */
export function canShareClip(final: RaceReplay | null | undefined, whatIf = false): final is RaceReplay {
  return !!final && !whatIf;
}

export interface ClipWindow {
  startSec: number;
  endSec: number;
}

/**
 * The race-time window the clip covers: from the leader ~CLIP_FROM_M out through the
 * line and EASE_DOWN_SEC of the ease-down, clamped to [CLIP_MIN_SEC, CLIP_MAX_SEC]
 * (clamps keep the end fixed: the line is always in shot).
 */
export function clipWindow(replay: RaceReplay): ClipWindow {
  const timing = replayTiming(replay);
  const endSec = Math.min(timing.duration, timing.lastFinishTime + EASE_DOWN_SEC);
  const from = timeLeaderReaches(replay, CLIP_FROM_M) ?? timing.winnerTime - CLIP_MAX_SEC;
  let startSec = Math.min(from, endSec - CLIP_MIN_SEC);
  startSec = Math.max(startSec, endSec - CLIP_MAX_SEC);
  startSec = Math.max(0, Math.min(startSec, endSec));
  return { startSec, endSec };
}

export interface ClipFrame {
  index: number;
  /** Race time to render, or null on the photo-finish hold (the strip, not the race). */
  timeSec: number | null;
  photo: boolean;
}

export interface ClipSchedule {
  fps: number;
  startSec: number;
  endSec: number;
  raceFrames: number;
  photoFrames: number;
  frames: ClipFrame[];
}

/**
 * The deterministic frame schedule: race frames at startSec + i/fps, then (for a photo
 * finish) PHOTO_HOLD_SEC of stills showing the line-scan strip and verdict.
 */
export function clipSchedule(replay: RaceReplay, opts: { photo?: boolean; fps?: number } = {}): ClipSchedule {
  const fps = opts.fps ?? CLIP_FPS;
  const { startSec, endSec } = clipWindow(replay);
  const raceFrames = Math.max(1, Math.round((endSec - startSec) * fps));
  const photo = opts.photo ?? isPhotoFinish(replay);
  const photoFrames = photo ? Math.max(1, Math.round(PHOTO_HOLD_SEC * fps)) : 0;
  const frames: ClipFrame[] = [];
  for (let i = 0; i < raceFrames; i++) frames.push({ index: i, timeSec: startSec + i / fps, photo: false });
  for (let i = 0; i < photoFrames; i++) frames.push({ index: raceFrames + i, timeSec: null, photo: true });
  return { fps, startSec, endSec, raceFrames, photoFrames, frames };
}

export interface ClipOverlayState {
  /** The caption (a race-call line) to burn in, or null. */
  caption: CallLine | null;
  /** End card opacity 0..1 (the placed horses over the ease-down). */
  endCardFade: number;
}

/** The commentary pick matches the on-stage ticker (desktop cadence). */
export const CLIP_TICKER_PICK: TickerPick = { minShowSec: 2.5, holdSec: 6 };

/**
 * What the frame at `index` carries on top of the race footage: the call line at that
 * race time (dropped once the end card comes up), and the end card's fade.
 */
export function overlayAt(schedule: ClipSchedule, index: number, lines: readonly CallLine[]): ClipOverlayState {
  const f = schedule.frames[index];
  if (!f || f.photo || f.timeSec === null) return { caption: null, endCardFade: 0 };
  const endCardFade = Math.min(1, Math.max(0, (f.timeSec - (schedule.endSec - END_CARD_SEC)) / END_CARD_FADE_SEC));
  const caption = endCardFade > 0 ? null : callLineAt(lines, f.timeSec, CLIP_TICKER_PICK);
  return { caption, endCardFade };
}

export interface EndCardRow {
  position: number;
  /** "1st", "2nd" (dead heats share the placing). */
  posText: string;
  name: string;
  /** Winner: the winning time. Otherwise "a short head", "¾ of a length"… (dead heat noted). */
  marginText: string;
  silks: { primary: string; secondary: string };
  winner: boolean;
}

/** The official top 3 for the end card (positions, names, margins — the result's own words). */
export function endCardRows(replay: Pick<RaceReplay, "horses" | "result">): EndCardRow[] {
  const order = [...replay.result.finishOrder].sort((a, b) => a.position - b.position || a.finishTimeUs - b.finishTimeUs);
  const names = new Map(replay.horses.map((h) => [h.horseId, h]));
  const rows: EndCardRow[] = [];
  for (const f of order) {
    if (f.position > 3 || rows.length >= 6) break;
    const horse = names.get(f.horseId);
    if (!horse) continue;
    const deadHeat = order.some((o) => o !== f && o.position === f.position);
    const winner = f.position === 1;
    const marginText = winner
      ? deadHeat
        ? "dead heat"
        : formatRaceTime(f.finishTimeUs)
      : `${marginPhrase(f.marginLabel || marginLabelFor(f.marginMm))}${deadHeat ? " · dead heat" : ""}`;
    rows.push({
      position: f.position,
      posText: ordinal(f.position),
      name: horse.name,
      marginText,
      silks: { primary: horse.appearance.silks.primary, secondary: horse.appearance.silks.secondary },
      winner,
    });
  }
  return rows;
}

/** "The 14:40 & Downs: Sprint!" -> "the-14-40-downs-sprint" (safe for filenames). */
export function clipSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** post-time-<course>-<race>-<yyyy-mm-dd>.<ext> */
export function clipFileName(parts: { course?: string | null; race: string; dateMs: number; ext: string }): string {
  const date = new Date(parts.dateMs);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const bits = ["post-time", parts.course ? clipSlug(parts.course) : "", clipSlug(parts.race), `${y}-${m}-${d}`].filter(Boolean);
  return `${bits.join("-")}.${parts.ext}`;
}
