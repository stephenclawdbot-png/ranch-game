/** Small pure wording helpers for the race call. */
import { HORSE_LENGTH_MM } from "@thoroughbred/shared";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth"];

export function numberWord(n: number): string {
  return WORDS[n] ?? `${n}`;
}

export function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}

/** A distance in mm as a caller would say it ("half a length", "three lengths"). */
export function lengthsPhrase(mm: number): string {
  const l = Math.max(0, mm) / HORSE_LENGTH_MM;
  if (l < 0.1) return "a nose";
  if (l < 0.3) return "a head";
  if (l < 0.6) return "half a length";
  if (l < 0.85) return "three-quarters of a length";
  if (l < 1.25) return "a length";
  if (l < 1.75) return "a length and a half";
  if (l < 2.25) return "two lengths";
  if (l < 2.75) return "two and a half lengths";
  const whole = Math.round(l);
  if (whole > 20) return `${whole} lengths`;
  return `${numberWord(whole)} lengths`;
}

/** Official-style margin phrase at the line ("a short head", "a neck", "two lengths"). */
export function marginPhrase(mm: number): string {
  const l = Math.max(0, mm) / HORSE_LENGTH_MM;
  if (l < 0.05) return "a nose";
  if (l < 0.1) return "a short head";
  if (l < 0.2) return "a head";
  if (l < 0.3) return "a neck";
  return lengthsPhrase(mm);
}

/** Lateral position: lane 0 is the rail. */
export function lanePhrase(lane: number): string {
  if (lane < 0.5) return "on the rail";
  if (lane < 1.5) return "one off the rail";
  if (lane < 2.5) return "three wide";
  return "out wide";
}

export function goingPhrase(going: string | undefined): string {
  switch (going) {
    case "firm":
      return "fast ground";
    case "good":
      return "good ground";
    case "soft":
      return "soft ground";
    case "heavy":
      return "heavy ground";
    default:
      return going ? `${going.replaceAll("_", " ")} ground` : "good ground";
  }
}

/** Metres, rounded to the nearest 10 ("600 metres"). */
export function metresPhrase(m: number): string {
  return `${Math.round(m / 10) * 10} metres`;
}

/** Seconds as the clock shows them: "36.42" or "1:12.08". */
export function timePhrase(sec: number): string {
  const totalCs = Math.floor(sec * 100 + 1e-6);
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  const cc = `${cs}`.padStart(2, "0");
  if (minutes > 0) return `${minutes}:${`${seconds}`.padStart(2, "0")}.${cc}`;
  return `${seconds}.${cc} seconds`;
}

/** "A, B and C". */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function capitalise(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** FNV-1a, 32-bit. Picks template variants; not a security hash. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
