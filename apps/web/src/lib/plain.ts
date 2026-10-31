/**
 * Plain-language mode ("New to horse racing?" Yes): the simpler sentences some key screens add
 * under their usual racing shorthand. Words only; the glossary (lib/glossary.ts) has the terms.
 */
import { formatDistance } from "./format";

const CLASS_PLAIN: Record<string, string> = {
  maiden: "a maiden race, for horses that haven't won yet",
  novice: "a novice race, for horses with only a win or two",
  handicap: "a handicap: better-rated horses carry more weight, to even things up",
  listed: "a Listed race, one step below the very top",
  graded: "a Group race, the top class",
};

const GOING_PLAIN: Record<string, string> = {
  firm: "firm (hard and fast)",
  good: "good (just right)",
  soft: "soft (a bit of give, slower)",
  heavy: "heavy (deep mud, a real slog)",
};

/** One sentence about a race: how far, on what, for whom, and the ground. */
export function plainRace(c: { distanceM: number; surface: string; raceClass: string; going?: string | null }, live: boolean): string {
  const furlongs = Math.round(c.distanceM / 201.168);
  const what = CLASS_PLAIN[c.raceClass] ?? "a race";
  const ground = c.going ? ` The ground (the going) is ${GOING_PLAIN[c.going] ?? c.going}.` : "";
  return `${formatDistance(c.distanceM)} (about ${furlongs} furlongs) on ${c.surface}, ${what}.${ground} ${live ? "Other stables race here, and everyone watches the same finish." : "A free practice race against the Club's horses."}`;
}
