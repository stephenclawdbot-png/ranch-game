/**
 * "What if?" re-runs: the shapes the sheet, the API and the server share (client-safe).
 *
 * A settled race is simulated again with ONE change to your own runner: everything else (field,
 * gates, the other runners, course, going, race model and the seed) stays exactly as it was
 * locked. Same seed, same luck: only your change can move the result. A what-if is never a
 * result: no credits, no rating, no form line, always labelled "What if (not official)".
 */
import { z } from "zod";
import type { RunningStyle } from "@thoroughbred/shared";
import { STYLE_LABEL } from "./format";

/** Re-runs one account may compute per hour (cached answers are free). */
export const WHAT_IF_PER_HOUR = 10;
export const WHAT_IF_WINDOW_MS = 60 * 60_000;

/** Race-day extras that act on the track (the vet check and firm shoes only change injury risk). */
export const WHAT_IF_EXTRAS = ["soft_shoes", "physio"] as const;
export type WhatIfExtra = (typeof WHAT_IF_EXTRAS)[number];
export const WHAT_IF_GRADES = ["A", "B", "C", "D", "E"] as const;
export type WhatIfGrade = (typeof WHAT_IF_GRADES)[number];

export const WhatIfChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tactic"), tactic: z.enum(["front", "stalker", "closer"]) }),
  z.object({ kind: z.literal("intensity"), intensity: z.enum(["conservative", "normal", "all_out"]) }),
  z.object({
    kind: z.literal("extras"),
    extras: z
      .array(z.enum(WHAT_IF_EXTRAS))
      .max(WHAT_IF_EXTRAS.length)
      .refine((xs) => new Set(xs).size === xs.length, "each extra once"),
  }),
  z.object({ kind: z.literal("jockey"), jockeyId: z.string().uuid() }),
  z.object({ kind: z.literal("jockey_grade"), grade: z.enum(WHAT_IF_GRADES) }),
]);
export type WhatIfChange = z.infer<typeof WhatIfChangeSchema>;

/** The cache key of a change: canonical, so the same question always hits the same row. */
export function changeKey(c: WhatIfChange): string {
  switch (c.kind) {
    case "tactic":
      return `tactic:${c.tactic}`;
    case "intensity":
      return `intensity:${c.intensity}`;
    case "extras":
      return `extras:${WHAT_IF_EXTRAS.filter((x) => c.extras.includes(x)).join("+") || "none"}`;
    case "jockey":
      return `jockey:${c.jockeyId}`;
    case "jockey_grade":
      return `jockey_grade:${c.grade}`;
  }
}

/** Parses a cache key back into a change (null when it isn't one). */
export function parseChangeKey(key: string): WhatIfChange | null {
  const [kind, rest = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  const raw =
    kind === "tactic"
      ? { kind, tactic: rest }
      : kind === "intensity"
        ? { kind, intensity: rest }
        : kind === "extras"
          ? { kind, extras: rest === "none" ? [] : rest.split("+") }
          : kind === "jockey"
            ? { kind, jockeyId: rest }
            : kind === "jockey_grade"
              ? { kind, grade: rest }
              : null;
  const p = WhatIfChangeSchema.safeParse(raw);
  return p.success && changeKey(p.data) === key ? p.data : null;
}

export const INTENSITY_WORD: Record<string, string> = { conservative: "conservative", normal: "normal", all_out: "all-out" };
export const EXTRA_WORD: Record<WhatIfExtra, string> = { soft_shoes: "soft-ground shoes", physio: "a physio session" };

const styleWord = (t: string) => (STYLE_LABEL[t as RunningStyle] ?? t).toLowerCase();

/** One plain line for a change ("Ridden as a closer", "With an A-grade freelancer"). */
export function changeLabel(c: WhatIfChange, jockeyName?: string | null): string {
  switch (c.kind) {
    case "tactic":
      return `Ridden as a ${styleWord(c.tactic)}`;
    case "intensity":
      return `${c.intensity === "all_out" ? "An" : "A"} ${INTENSITY_WORD[c.intensity]} ride`;
    case "extras":
      return c.extras.length ? `With ${c.extras.map((x) => EXTRA_WORD[x]).join(" and ")}` : "With no race-day extras";
    case "jockey":
      return `Ridden by ${jockeyName ?? "another of your jockeys"}`;
    case "jockey_grade":
      return `Ridden by a ${c.grade}-grade Club freelancer`;
  }
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export interface WhatIfJockeyOption {
  id: string;
  name: string;
  grade: WhatIfGrade;
}

/** What the sheet may offer for one runner (GET /api/races/:id/what-if?horseId=). */
export interface WhatIfOptionsView {
  raceId: string;
  horseId: string;
  horseName: string;
  raceName: string;
  /** Null when re-runs are possible; otherwise why not (the sheet says it and offers nothing). */
  unavailable: string | null;
  engineVersion: string;
  /** What the runner actually ran with. */
  current: {
    tactic: RunningStyle;
    intensity: "conservative" | "normal" | "all_out" | null;
    extras: WhatIfExtra[];
    jockeyName: string | null;
    jockeyId: string | null;
  };
  /** Each kind of change on offer for this race (an empty list = not on offer here, with why). */
  tactics: RunningStyle[];
  intensities: ("conservative" | "normal" | "all_out")[];
  extras: WhatIfExtra[];
  jockeys: WhatIfJockeyOption[];
  grades: WhatIfGrade[];
  notes: string[];
  /** Fresh re-runs left this hour (cached ones are free). */
  remaining: number;
  /** Changes already re-run for this horse in this race (free to look at again). */
  done: { changeKey: string; label: string; position: number }[];
}

export interface WhatIfRow {
  position: number;
  horseId: string;
  name: string;
  mine: boolean;
  /** Distance behind the winner, mm (0 for the winner). */
  behindMm: number;
  timeUs: number;
}

export interface WhatIfRunnerLine {
  position: number;
  behindMm: number;
  timeUs: number;
  /** Sectional times in thirds (early, middle, late), seconds. */
  sectionals: [number, number, number];
}

/** One re-run, compared with the official result (POST /api/races/:id/what-if). */
export interface WhatIfView {
  raceId: string;
  horseId: string;
  horseName: string;
  raceName: string;
  track: string;
  postTimeMs: number;
  engineVersion: string;
  fieldSize: number;
  changeKey: string;
  label: string;
  official: WhatIfRunnerLine;
  whatIf: WhatIfRunnerLine;
  /** Top five plus your runner, both ways. */
  officialTop: WhatIfRow[];
  whatIfTop: WhatIfRow[];
  /** This answer came from the cache (no re-run counted). */
  cached: boolean;
  remaining: number;
}

/** "3rd → 1st": positions moved (positive = better). */
export function placesGained(v: Pick<WhatIfView, "official" | "whatIf">): number {
  return v.official.position - v.whatIf.position;
}
