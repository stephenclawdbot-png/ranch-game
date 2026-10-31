"use client";
/**
 * The beginner welcome on the client: the player's onboarding state (from GET /api/me), the
 * POST /api/onboarding choices with an optimistic update of the cached player, and the copy
 * for the mentor, Stable steps and the locked features.
 */
import * as gc from "@thoroughbred/game-core";
import { api, getPlayerState, refreshPlayer, setPlayer, usePlayerState } from "@/lib/player";
import type { OnboardingView, PlayerView, UnlockFeature } from "@/lib/types";

export const MENTOR_NAME = gc.MENTOR.name;
export const MENTOR_FIRST = gc.MENTOR.name.split(" ")[0]!;
export const MENTOR_ROLE = gc.MENTOR.role;

/** The signed-in player's onboarding, or null (signed out, still loading, or unreadable). */
export function useOnboarding(): OnboardingView | null {
  const state = usePlayerState();
  return state?.onboarding ?? null;
}

/** Plain-language mode is on ("New to horse racing?" Yes). */
export function usePlain(): boolean {
  return useOnboarding()?.plainLanguage === true;
}

function patch(fn: (o: OnboardingView) => OnboardingView): void {
  const p = getPlayerState();
  if (p?.onboarding) setPlayer({ ...p, onboarding: fn(p.onboarding) } as PlayerView);
}

export type OnboardingBody =
  | { action: "mentor"; plainLanguage?: boolean | null }
  | { action: "plain"; on: boolean }
  | { action: "coach"; id: string }
  | { action: "why"; raceId: string }
  | { action: "welcome_back" };

/** Sends a choice; updates the cached player first so the screen answers at once. */
export async function sendOnboarding(body: OnboardingBody): Promise<void> {
  if (body.action === "mentor") patch((o) => ({ ...o, mentorDone: true, ...(typeof body.plainLanguage === "boolean" ? { plainLanguage: body.plainLanguage } : {}) }));
  if (body.action === "plain") patch((o) => ({ ...o, plainLanguage: body.on }));
  if (body.action === "coach") patch((o) => ({ ...o, coachSeen: [...new Set([...o.coachSeen, body.id])] }));
  if (body.action === "welcome_back") patch((o) => ({ ...o, welcomeBack: null }));
  const res = await api<{ ok: boolean; step?: boolean }>("/api/onboarding", { body });
  // A completed step changes credits and the guide: fetch the player again.
  if (res.step) await refreshPlayer().catch(() => undefined);
}

/** Each locked feature: what it is, and when it opens. */
export const LOCKED_COPY: Record<UnlockFeature, { name: string; what: string; when: string; wiki: string }> = {
  tote: {
    name: "The tote",
    what: "Back a runner in other stables' Live races with credits, from a shared pool.",
    when: "Opens after you've watched one of your own Live races.",
    wiki: "/wiki/tote",
  },
  market: {
    name: "The market",
    what: "Buy and sell horses for Stable Credits.",
    when: "Opens on your stable's third day, or as soon as you finish Story chapter 1.",
    wiki: "/wiki/the-market",
  },
  leasing: {
    name: "Leasing",
    what: "Rent a racer from another stable and share its prize money, or lend yours.",
    when: "Opens on your stable's third day, or as soon as you finish Story chapter 1.",
    wiki: "/wiki/leasing",
  },
  claiming: {
    name: "Claiming races",
    what: "Races where every runner is for sale at a price set on entry.",
    when: "Open once you finish Story chapter 1, so you don't lose a horse by accident.",
    wiki: "/wiki/claiming-races",
  },
  jockey_contracts: {
    name: "Jockey contracts",
    what: "Sign a jockey for a regular rider, or bid in Sunday's transfer window.",
    when: "Open once you finish Story chapter 1. Your apprentice rides for you meanwhile.",
    wiki: "/wiki/jockeys",
  },
};

/** The guide's steps: what to do, why, and where (the server decides when each is done). */
export const STEP_COPY: Record<string, { title: string; text: string }> = {
  care: { title: "Care for a horse", text: "Feed, groom and turn out one horse. About a minute, once a day." },
  train_plan: { title: "Set a training plan", text: "Choose this week's sessions on the gallops board. Saving a plan is free." },
  enter_live: { title: "Enter a Live race", text: "Spend one of today's entries on a race against real stables." },
  watch_live: { title: "Watch your Live race", text: "Everyone sees the same finish. We never tell you the result before you watch." },
  read_why: { title: "Read “Why it went that way”", text: "Under every result: the pace, your positions and what to try next time." },
  daily_cup: { title: "Run the Daily Cup", text: "One free time trial a day. Same field and same luck for everyone." },
  pick: { title: "Pick a winner", text: "Tip one runner in someone else's Live race for tipster points. No credits at stake." },
  quick_race: { title: "Try a quick race", text: "A short race on demand, settled straight away." },
  pin_target: { title: "Pin a target race", text: "Plan ahead: pin a coming race for a horse on This week and get a reminder." },
  breeding_preview: { title: "Preview a breeding", text: "See what a foal of your filly might look like. Only a look: nothing is spent." },
};
