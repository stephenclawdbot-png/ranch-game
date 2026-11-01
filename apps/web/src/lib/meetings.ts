/**
 * The Live card's schedule in words, from the game-core knobs (MEETING_START_TIMES_UTC,
 * RACES_PER_MEETING), and post times in the player's own clock. Safe on server and client.
 *
 * Local time needs the browser's time zone, which the server doesn't know: render the UTC form
 * (`utcClockText`) on the server and on the first client render, and the local one only after
 * mount (useNow() returns null until then), so the markup never mismatches on hydration.
 */
import { MEETING_INTERVAL_MS, MEETINGS_EVENLY_SPACED, MEETINGS_PER_DAY, MS_PER_HOUR } from "@thoroughbred/game-core";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => WORDS[n] ?? String(n);

/** "every 3 hours" (evenly spaced meetings) or "8 times a day". */
export const MEETING_CADENCE = MEETINGS_EVENLY_SPACED ? `every ${MEETING_INTERVAL_MS / MS_PER_HOUR} hours` : `${MEETINGS_PER_DAY} times a day`;

/** "A race meeting every 3 hours" / "Eight race meetings a day" (sentence case). */
export const MEETINGS_LINE = MEETINGS_EVENLY_SPACED
  ? `A race meeting every ${MEETING_INTERVAL_MS / MS_PER_HOUR} hours`
  : `${word(MEETINGS_PER_DAY).charAt(0).toUpperCase()}${word(MEETINGS_PER_DAY).slice(1)} race meetings a day`;

/** "21:00 UTC": the same on server and client. */
export function utcClockText(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/**
 * The post time in this browser's clock and locale: "9:00 pm", "21:00", or with the day when it
 * isn't today ("tomorrow at 9:00 am", "Sat at 21:00"). `timeZone` is for tests.
 */
export function localClockText(ms: number, nowMs: number, opts: { timeZone?: string; locale?: string } = {}): string {
  // a 24-hour clock reads "09:00", a 12-hour one "9:00 am"
  const h12 = new Intl.DateTimeFormat(opts.locale, { hour: "numeric", timeZone: opts.timeZone }).resolvedOptions().hour12 ?? false;
  const time = new Intl.DateTimeFormat(opts.locale, { hour: h12 ? "numeric" : "2-digit", minute: "2-digit", timeZone: opts.timeZone }).format(ms).replace(/\s?([AaPp])\.?\s?[Mm]\.?$/, (_, x: string) => ` ${x.toLowerCase()}m`);
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: opts.timeZone }).format(t);
  if (day(ms) === day(nowMs)) return time;
  if (day(ms) === day(nowMs + 24 * MS_PER_HOUR)) return `tomorrow at ${time}`;
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: opts.timeZone }).format(ms);
  return `${weekday} at ${time}`;
}

/** "2 h 40 min", "35 min", "under a minute". */
export function waitText(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (ms <= 0) return "now";
  if (min <= 1) return "under a minute";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
