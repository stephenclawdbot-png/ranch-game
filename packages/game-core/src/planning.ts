/**
 * Campaign planning (experience review item 8): pin a horse to a future race and check the plan
 * against the rules the game already has. Pure; the database supplies the horse, the race and
 * the clock.
 *
 *   - freshness: condition.ts freshnessBonus peaks 72-120 h after the last hard work (a race is
 *     hard work), so an earlier target resets the clock for the next one;
 *   - minimum rest: one Live start per horse per UTC day (MAX_LIVE_STARTS_PER_DAY), and the
 *     hours a race's fatigue (career.ts raceFatigue) takes to fall back under TIRED_THRESHOLD;
 *   - the entry window: a race opens when it is published on the card (its post time minus the
 *     card horizon) and closes just before the off.
 */
import { FATIGUE_RECOVERY_PER_HOUR, FRESHNESS_PEAK_BONUS, TIRED_THRESHOLD, freshnessBonus } from "./condition";
import { MS_PER_DAY, MS_PER_HOUR } from "./time";

/** Most targets one horse may have at a time. */
export const MAX_TARGETS_PER_HORSE = 5;
/** The second reminder goes this long before entries close. */
export const PLAN_CLOSE_REMINDER_MS = 2 * MS_PER_HOUR;
/** Calendar races (Qualifiers, the Weekend Feature, Season Finals) can be targeted this far ahead. */
export const PLAN_CALENDAR_AHEAD_MS = 28 * MS_PER_DAY;
/** Freshness peak window after hard work, hours (condition.ts freshnessBonus). */
export const FRESHNESS_PEAK_FROM_H = 72;
export const FRESHNESS_PEAK_TO_H = 120;

export type FreshnessPhase = "peak" | "building" | "fading" | "flat";

export interface FreshnessOutlook {
  phase: FreshnessPhase;
  /** freshnessBonus at the race, permille (FRESHNESS_PEAK_BONUS at the peak). */
  bonus: number;
  /** The peak window around the race, or null with no hard work on record. */
  peakFromMs: number | null;
  peakToMs: number | null;
  /** One line for the planner. */
  text: string;
}

/** Freshness at `raceMs` given the last hard work before it (training or an earlier race). */
export function freshnessOutlook(lastHardWorkMs: number | null, raceMs: number): FreshnessOutlook {
  if (lastHardWorkMs === null) return { phase: "flat", bonus: 0, peakFromMs: null, peakToMs: null, text: "No hard work on record: no freshness peak to time" };
  const bonus = freshnessBonus(lastHardWorkMs, raceMs);
  const from = lastHardWorkMs + FRESHNESS_PEAK_FROM_H * MS_PER_HOUR;
  const to = lastHardWorkMs + FRESHNESS_PEAK_TO_H * MS_PER_HOUR;
  const h = (raceMs - lastHardWorkMs) / MS_PER_HOUR;
  if (bonus >= FRESHNESS_PEAK_BONUS) return { phase: "peak", bonus, peakFromMs: from, peakToMs: to, text: "Races at the freshness peak" };
  if (h < FRESHNESS_PEAK_FROM_H) return { phase: "building", bonus, peakFromMs: from, peakToMs: to, text: `Before the peak: ${Math.ceil(FRESHNESS_PEAK_FROM_H - h)} h short` };
  if (bonus > 0) return { phase: "fading", bonus, peakFromMs: from, peakToMs: to, text: `Past the peak by ${Math.floor(h - FRESHNESS_PEAK_TO_H)} h: freshness fading` };
  return { phase: "flat", bonus, peakFromMs: from, peakToMs: to, text: "Past the peak: freshness gone (hard work 3-5 days before brings it back)" };
}

/** Hours a race's fatigue keeps the horse tired, from fresh (0 when it stays under the threshold). */
export function restHoursAfter(raceFatigue: number): number {
  return Math.max(0, Math.ceil((raceFatigue - TIRED_THRESHOLD) / FATIGUE_RECOVERY_PER_HOUR));
}

export interface PlanTarget {
  key: string;
  postTimeMs: number;
  /** A Live race (counts against the one-a-day Live cap). */
  live: boolean;
  /** Fatigue the race adds (career.ts raceFatigue for its trip). */
  fatigue: number;
}

export interface Clash {
  a: string;
  b: string;
  reason: string;
}

const utcDay = (ms: number) => Math.floor(ms / MS_PER_DAY);

/** Pairs of targets too close together: the same UTC day (Live), or inside the earlier race's rest. */
export function targetClashes(targets: readonly PlanTarget[], liveStartsPerDay = 1): Clash[] {
  const sorted = [...targets].sort((x, y) => x.postTimeMs - y.postTimeMs);
  const out: Clash[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      const restMs = restHoursAfter(a.fatigue) * MS_PER_HOUR;
      if (a.live && b.live && liveStartsPerDay <= 1 && utcDay(a.postTimeMs) === utcDay(b.postTimeMs)) out.push({ a: a.key, b: b.key, reason: "same day: one Live race per horse per day" });
      else if (b.postTimeMs - a.postTimeMs < restMs) out.push({ a: a.key, b: b.key, reason: `inside the ${restHoursAfter(a.fatigue)} h the first race leaves it tired` });
    }
  }
  return out;
}

export type EntryState = "not_open" | "open" | "closed";

export interface EntryWindow {
  opensAtMs: number;
  closesAtMs: number;
  state: EntryState;
}

export function entryWindow(postTimeMs: number, closesAtMs: number, nowMs: number, horizonMs: number): EntryWindow {
  const opensAtMs = postTimeMs - horizonMs;
  return { opensAtMs, closesAtMs, state: nowMs < opensAtMs ? "not_open" : nowMs < closesAtMs ? "open" : "closed" };
}

export type PlanReminder = "open" | "closing";

/**
 * Which reminder is due now for a target not yet entered: "open" once entries open (unless it is
 * already inside the last PLAN_CLOSE_REMINDER_MS), "closing" inside the last two hours. The
 * caller sends each at most once (dedupe key).
 */
export function planReminderDue(window: EntryWindow, nowMs: number, entered: boolean): PlanReminder | null {
  if (entered || window.state !== "open") return null;
  return nowMs >= window.closesAtMs - PLAN_CLOSE_REMINDER_MS ? "closing" : "open";
}
