/**
 * The Live wait (first-hour follow-up): what a stable can usefully do before its Live race goes
 * off, chosen from its own state, in priority order, at most WAIT_ACTIONS_MAX. Only things that
 * are actually available today are offered: a Story chapter race needs a rested horse that isn't
 * the one waiting for its Live race, care needs a horse still due today, the Daily Cup needs a run
 * left, and a Quick race needs a horse of racing age. Pure: safe on server and client.
 */
import { ordinal } from "./format";

export const WAIT_ACTIONS_MAX = 3;

export interface WaitFacts {
  /** The current Story chapter's next race, when a rested horse other than the Live runner can run it. */
  story: { chapterShort: string; wins: number; winsToComplete: number; raceKey: string; horseReady: boolean } | null;
  /** The first horse not yet cared for today (and how many are due). */
  care: { horseName: string; href: string; due: number } | null;
  /** Today's Daily Cup: runs the stable has left today (0 when run, or no horse can run it). */
  cupRunsLeft: number;
  /** The stable has a horse of racing age (Quick races are instant and unofficial: no fatigue). */
  quickRace: boolean;
}

export type WaitActionKey = "story" | "care" | "cup" | "quick";

export interface WaitAction {
  key: WaitActionKey;
  label: string;
  href: string;
}

/** Up to WAIT_ACTIONS_MAX things to do while waiting, most useful first. */
export function whileYouWaitActions(f: WaitFacts): WaitAction[] {
  const out: WaitAction[] = [];
  if (f.story && f.story.horseReady && f.story.wins < f.story.winsToComplete) {
    out.push({ key: "story", label: `Win your ${ordinal(f.story.wins + 1)} ${f.story.chapterShort} race (Story)`, href: `/story#race-${f.story.raceKey}` });
  }
  if (f.care && f.care.due > 0) out.push({ key: "care", label: `Care for ${f.care.horseName} (due)`, href: f.care.href });
  if (f.cupRunsLeft > 0) out.push({ key: "cup", label: `Daily Cup (${f.cupRunsLeft} ${f.cupRunsLeft === 1 ? "run" : "runs"} left)`, href: "/cup" });
  if (f.quickRace) out.push({ key: "quick", label: "A Quick race", href: "/quick" });
  return out.slice(0, WAIT_ACTIONS_MAX);
}
