/**
 * Timing maths for the radio commentary (pure: no Web Audio, no clock).
 *
 * planSpeech turns the voiced call lines into a speech timeline in race seconds: each line
 * starts at its call time, or just after the previous line when that one is still talking
 * (never more than MAX_DELAY_SEC late: a late routine line is dropped, a key line cuts the
 * previous one short). crowdCues derives the crowd bed under the voice from the same plan.
 * The player (player.ts) maps the plan onto the AudioContext clock every frame.
 */
import type { CallKind, VoicedCallLine } from "../buildRaceCall";
import type { Intensity, SpeechToken } from "./speech";

/** A playable clip: its cache key and length in seconds. */
export interface ClipRef {
  key: string;
  dur: number;
}

/** Clips for one token at an intensity; null while still loading; [] to say nothing. */
export type ClipResolver = (token: SpeechToken, intensity: Intensity) => ClipRef[] | null;

export interface PlannedClip extends ClipRef {
  /** Seconds from the line's start. */
  at: number;
}

export interface PlannedLine {
  /** Stable per line (call time + kind). */
  id: string;
  kind: CallKind;
  priority: number;
  intensity: Intensity;
  /** The line's call time (race s). */
  atSec: number;
  /** When it is spoken (race s): atSec, or later behind the previous line. */
  start: number;
  /** When it finishes (race s): start + its length, or the cut. */
  end: number;
  /** Set when a key line cuts in: the speech stops here (race s). */
  cut?: number;
  clips: PlannedClip[];
}

export interface SpeechPlan {
  lines: PlannedLine[];
  /** Index (into the input lines) of the first line whose clips are still loading; -1 if none. */
  waitingFrom: number;
}

/** Tunables (docs/foundation/KNOBS.md, "Radio commentary"). */
export const SPEECH = {
  /** Gap between the clips of one line (the clips carry their own 25 ms lead-in). */
  wordGapSec: 0.03,
  /** Gap between two lines. */
  lineGapSec: 0.3,
  /** Latest a line may start behind its call time; later routine lines are dropped. */
  maxDelaySec: 1.6,
  /** Lines at or above this priority are never dropped: the cut-in kinds cut the previous line short, the rest wait. */
  keyPriority: 75,
  /** The key calls that cut in on time (the final furlong, the duel, the finish, the photograph, the result). */
  cutKinds: ["home", "challenge", "finish", "photo", "result"] as readonly CallKind[],
  /** The calls still spoken at 2x / 4x / 0.5x (in real time, the rest are skipped). */
  keyKinds: ["finish", "photo", "result"] as readonly CallKind[],
};

export const lineId = (l: { atSec: number; kind: string }): string => `${l.atSec.toFixed(3)}|${l.kind}`;

/**
 * The speech timeline for the call lines. Deterministic: same lines, same clips, same plan.
 * `nowSec`: a line still loading whose latest start is already past is skipped, so a missing
 * clip can never hold up the rest of the call.
 */
export function planSpeech(lines: readonly VoicedCallLine[], resolve: ClipResolver, nowSec = Number.NEGATIVE_INFINITY): SpeechPlan {
  const out: PlannedLine[] = [];
  let cursor = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const sp = l.speech;
    if (!sp || !sp.tokens.length) continue;
    const clips: PlannedClip[] = [];
    let at = 0;
    let loading = false;
    for (const tok of sp.tokens) {
      const refs = resolve(tok, sp.intensity);
      if (!refs) {
        loading = true;
        break;
      }
      for (const r of refs) {
        if (clips.length) at += SPEECH.wordGapSec;
        clips.push({ ...r, at });
        at += r.dur;
      }
    }
    if (loading) {
      if (l.atSec + SPEECH.maxDelaySec < nowSec) continue;
      return { lines: out, waitingFrom: i };
    }
    if (!clips.length) continue;
    let start = Math.max(l.atSec, cursor + SPEECH.lineGapSec);
    if (start - l.atSec > SPEECH.maxDelaySec) {
      const prev = out[out.length - 1];
      if (l.priority < SPEECH.keyPriority || !prev) continue;
      if (SPEECH.cutKinds.includes(l.kind)) {
        // A key call at the business end cuts the previous line short.
        prev.cut = Math.max(prev.start, l.atSec - 0.05);
        prev.end = prev.cut;
        start = l.atSec;
      }
      // Other key lines (the opening order) wait their turn.
    }
    out.push({ id: lineId(l), kind: l.kind, priority: l.priority, intensity: sp.intensity, atSec: l.atSec, start, end: start + at, clips });
    cursor = start + at;
  }
  return { lines: out, waitingFrom: -1 };
}

/** What to start at race time `t`: the clip index within the line and the offset into it. */
export function joinAt(line: PlannedLine, t: number): { clip: number; offset: number } | null {
  if (t >= line.end) return null;
  const into = Math.max(0, t - line.start);
  for (let k = 0; k < line.clips.length; k++) {
    const c = line.clips[k]!;
    if (into < c.at + c.dur) return { clip: k, offset: Math.max(0, into - c.at) };
  }
  return null;
}

/** The lines to start now: playing at `t` (joined part-way) or due within `lookahead` seconds. */
export function dueLines(plan: SpeechPlan, t: number, lookahead: number, rate = 1): PlannedLine[] {
  return plan.lines.filter((l) => {
    if (rate !== 1 && (!SPEECH.keyKinds.includes(l.kind) || l.start < t)) return false;
    return l.end > t && l.start <= t + lookahead * Math.max(1, rate);
  });
}

// ---- the crowd under the voice --------------------------------------------------------------

export type CrowdBed = "murmur" | "building" | "roar" | "hush";

export interface CrowdCue {
  at: number;
  bed?: CrowdBed;
  /** A one-shot cheer starts here. */
  cheer?: boolean;
}

export const CROWD_FOR: Readonly<Record<Intensity, CrowdBed>> = { calm: "murmur", building: "building", climax: "roar" };

/** Seconds after the last finishing call that the crowd settles back to a murmur. */
export const CROWD_SETTLE_SEC = 7;

/**
 * Crowd cues from the plan: the bed follows each line's intensity from its start; a photo
 * hushes the crowd from the end of the call until the verdict; the winner (or the verdict of a
 * photo) gets a cheer, and the crowd settles to a murmur afterwards.
 */
export function crowdCues(plan: SpeechPlan): CrowdCue[] {
  const cues: CrowdCue[] = [{ at: Number.NEGATIVE_INFINITY, bed: "murmur" }];
  let photo = false;
  let lastEnd = Number.NEGATIVE_INFINITY;
  let finished = false;
  for (const l of plan.lines) {
    const bed = CROWD_FOR[l.intensity];
    if (l.kind === "finish") {
      finished = true;
      cues.push({ at: l.start, bed: "roar", cheer: true });
    } else if (l.kind === "photo") {
      finished = true;
      photo = true;
      cues.push({ at: l.start, bed: "roar" });
      cues.push({ at: l.end + 0.3, bed: "hush" });
    } else if (l.kind === "result") {
      cues.push(photo ? { at: l.start, bed: "hush" } : { at: l.start, bed: "building" });
      // The verdict of a photograph: the cheer comes with the winner's name.
      if (photo) cues.push({ at: l.start + Math.min(l.end - l.start, 3.2), bed: "roar", cheer: true });
      photo = false;
    } else if (!finished) {
      cues.push({ at: l.start, bed });
    }
    lastEnd = Math.max(lastEnd, l.end);
  }
  if (finished) cues.push({ at: lastEnd + CROWD_SETTLE_SEC, bed: "murmur" });
  return cues.sort((a, b) => a.at - b.at);
}

/** The bed at race time `t`. */
export function crowdAt(cues: readonly CrowdCue[], t: number): CrowdBed {
  let bed: CrowdBed = "murmur";
  for (const c of cues) {
    if (c.at > t) break;
    if (c.bed) bed = c.bed;
  }
  return bed;
}

/** Cheers that start in (from, to]. */
export function cheersBetween(cues: readonly CrowdCue[], from: number, to: number): CrowdCue[] {
  return cues.filter((c) => c.cheer && c.at > from && c.at <= to);
}
