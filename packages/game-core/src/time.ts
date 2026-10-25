/**
 * Time helpers. Time is always passed in (ms since epoch); nothing here reads a clock.
 *
 * Real days drive care (one counted session per horse per day), healing and the weekly
 * training/pack counters. Competition seasons (4 real weeks) drive leagues, finals, titles,
 * the per-season breeding cap and the pack mint ceiling — never horse ageing (§4a).
 */
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const DAYS_PER_WEEK = 7;
export const SEASON_DAYS = 28;

/** Integer day index. `tzOffsetMin` shifts the day boundary to the player's local midnight. */
export function dayIndex(nowMs: number, tzOffsetMin = 0): number {
  return Math.floor((nowMs + tzOffsetMin * MS_PER_MINUTE) / MS_PER_DAY);
}

/** Week index; weeks start on Monday (day 0 = Thu 1970-01-01, so shift by 3). */
export function weekIndex(nowMs: number, tzOffsetMin = 0): number {
  return Math.floor((dayIndex(nowMs, tzOffsetMin) + 3) / DAYS_PER_WEEK);
}

/** Start of a week (ms, UTC). */
export function weekStartMs(week: number): number {
  return (week * DAYS_PER_WEEK - 3) * MS_PER_DAY;
}

export interface SeasonClock {
  /** ms of the start of season 1 (launch). */
  epochMs: number;
}

/** Competition season number (1-based). Before launch counts as season 1. */
export function seasonOf(clock: SeasonClock, nowMs: number): number {
  return Math.max(1, 1 + Math.floor((nowMs - clock.epochMs) / (SEASON_DAYS * MS_PER_DAY)));
}

export function seasonStartMs(clock: SeasonClock, season: number): number {
  return clock.epochMs + (season - 1) * SEASON_DAYS * MS_PER_DAY;
}

export function seasonEndMs(clock: SeasonClock, season: number): number {
  return seasonStartMs(clock, season + 1);
}

/** Day of the season, 0..27. */
export function seasonDay(clock: SeasonClock, nowMs: number): number {
  const s = seasonOf(clock, nowMs);
  return Math.floor((nowMs - seasonStartMs(clock, s)) / MS_PER_DAY);
}
