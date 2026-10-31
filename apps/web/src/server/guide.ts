/**
 * The beginner welcome for the web app (packages/db guide.ts holds the rules' storage): the
 * player's onboarding state in the player view (mentor, plain language, coach marks seen,
 * unlocks, Stable steps, welcome back), the actions behind POST /api/onboarding, and the
 * route guard for features a new stable meets later.
 *
 * Nothing here takes a feature away from an existing stable (no row or an unguided row =
 * everything open, no guide), and welcome-back content never says how an unwatched race went.
 */
import * as gc from "@thoroughbred/game-core";
import {
  DomainError,
  careDayOf,
  completeStableStep,
  contractsOfStable,
  dismissWelcomeBack,
  finishMentor,
  isCoachMarkId,
  isFeatureUnlocked,
  isLiveRace,
  lastCareDays,
  listInbox,
  listStableHorses,
  listStableRuns,
  markCoachSeen,
  onboardingRow,
  recordVisit,
  resultWatched,
  setPlainLanguage,
  stableEntriesInRace,
  stableStepsView,
  syncUnlocks,
} from "@thoroughbred/db";
import type { OnboardingView, WelcomeBackView } from "@/lib/types";
import type { Db } from "./db";
import type { Session } from "./session";

/** The player's onboarding state for the player view (GET /api/me). Never throws: the guide must not break Home. */
export async function onboardingView(db: Db, session: Session, now: Date): Promise<OnboardingView | null> {
  try {
    const visit = await recordVisit(db, session.accountId, now);
    const row = await onboardingRow(db, session.accountId);
    const { unlocks } = await syncUnlocks(db, session.accountId, now);
    const guided = !!row?.guided;
    return {
      guided,
      mentorDone: !guided || !!row?.mentorDoneAt,
      plainLanguage: !!row?.plainLanguage,
      coachSeen: guided ? ((row?.coachSeen as string[] | null) ?? []) : ["*"],
      unlocks,
      steps: guided ? await stableStepsView(db, session.accountId, now) : null,
      welcomeBack: visit ? await welcomeBackView(db, session, visit, now) : null,
    };
  } catch (err) {
    console.error("onboarding view", err);
    return null;
  }
}

/**
 * Welcome back after a day or more away: what the horses did (how many ran and, for results
 * already watched, how they went; never an unwatched result), what's due, and one next action.
 */
export async function welcomeBackView(db: Db, session: Session, visit: { fromMs: number; atMs: number }, now: Date): Promise<WelcomeBackView> {
  const runs = (await listStableRuns(db, session.stable.id, 60)).filter((r) => r.postTime.getTime() >= visit.fromMs && r.postTime.getTime() <= now.getTime());
  const inbox = await listInbox(db, session.accountId, 40);
  const unseenRaces = new Set(inbox.filter((i) => !i.readAt && i.raceId && i.kind === "race_result").map((i) => i.raceId!));
  const seen = runs.filter((r) => !unseenRaces.has(r.raceId));
  const wins = seen.filter((r) => r.position === 1).length;
  const places = seen.filter((r) => r.position !== null && r.position >= 2 && r.position <= 3).length;

  // What's due: foals and youngsters to care for today, Live entries in the bank, contracts ending soon.
  const rows = (await listStableHorses(db, session.stable.id)).filter((r) => r.careerStatus !== "pasture");
  const day = await careDayOf(db, session.accountId, now);
  const last = await lastCareDays(db, rows.map((r) => r.id));
  const young = rows.filter((r) => r.careSessions < gc.CARE_TO_RACING && !((last.get(r.id) ?? "") >= day));
  const contracts = [...(await contractsOfStable(db, session.stable.id, now)).values()].filter((c) => c.endsAtMs - now.getTime() <= 7 * gc.MS_PER_DAY);
  const due: WelcomeBackView["due"] = [];
  if (unseenRaces.size > 0) due.push({ label: `${unseenRaces.size} ${unseenRaces.size === 1 ? "result" : "results"} to watch`, href: "/me/races" });
  if (young.length > 0) due.push({ label: `${young.length} ${young.length === 1 ? "youngster" : "youngsters"} to care for`, href: "/nursery" });
  if (session.stable.entryBalance > 0) due.push({ label: `${session.stable.entryBalance} Live ${session.stable.entryBalance === 1 ? "entry" : "entries"} ready to use`, href: "/races" });
  if (contracts.length > 0) due.push({ label: `${contracts.length} jockey ${contracts.length === 1 ? "contract ends" : "contracts end"} this week`, href: "/jockeys" });

  const firstUnseen = inbox.find((i) => !i.readAt && i.raceId && i.kind === "race_result");
  const next: WelcomeBackView["next"] = firstUnseen
    ? { label: "Watch the finish", href: `/race/${firstUnseen.raceId}`, why: "A result is waiting. We haven't said how it went." }
    : young.length > 0
      ? { label: "Care for your youngsters", href: "/nursery", why: "Foals grow up one care session a day." }
      : session.stable.entryBalance > 0
        ? { label: "Enter today's Live races", href: "/races", why: "Your horses are rested and your entries are waiting." }
        : { label: "Run a Story race", href: "/story", why: "Free, against the Club, any time." };
  return { fromMs: visit.fromMs, awayMs: visit.atMs - visit.fromMs, ran: runs.length, unseen: runs.filter((r) => unseenRaces.has(r.raceId)).length, wins, places, due, next };
}

export type OnboardingAction =
  | { action: "mentor"; plainLanguage?: boolean | null }
  | { action: "plain"; on: boolean }
  | { action: "coach"; id: string }
  | { action: "why"; raceId: string }
  | { action: "welcome_back" };

/** POST /api/onboarding. Steps only ever complete from facts the server can check. */
export async function onboardingAction(db: Db, session: Session, body: OnboardingAction, now: Date): Promise<{ ok: true; step?: boolean }> {
  switch (body.action) {
    case "mentor":
      await finishMentor(db, { accountId: session.accountId, plainLanguage: body.plainLanguage ?? null, now });
      return { ok: true };
    case "plain":
      await setPlainLanguage(db, { accountId: session.accountId, on: body.on, now });
      return { ok: true };
    case "coach":
      if (!isCoachMarkId(body.id)) throw new DomainError("INVALID_INPUT", "unknown coach mark");
      await markCoachSeen(db, { accountId: session.accountId, id: body.id, now });
      return { ok: true };
    case "why":
      return { ok: true, step: await whyRead(db, session, body.raceId, now) };
    case "welcome_back":
      await dismissWelcomeBack(db, session.accountId);
      return { ok: true };
  }
}

/**
 * "Read Why it went that way": the card is drawn in the browser, so the step is reported from
 * there, and counted only for a race the stable ran in whose result it has already watched.
 */
async function whyRead(db: Db, session: Session, raceId: string, now: Date): Promise<boolean> {
  const mine = await stableEntriesInRace(db, session.stable.id, raceId);
  if (mine.length === 0) return false;
  if (!(await resultWatched(db, session.accountId, raceId))) return false;
  return completeStableStep(db, { accountId: session.accountId, step: "read_why", now });
}

/** After a result has been watched (myRaceResult, the inbox read route): the "watch your Live race" step. */
export async function afterResultWatched(db: Db, session: Session, raceId: string, now: Date): Promise<void> {
  try {
    if (!(await isLiveRace(db, raceId))) return;
    if ((await stableEntriesInRace(db, session.stable.id, raceId)).length === 0) return;
    await completeStableStep(db, { accountId: session.accountId, step: "watch_live", now });
  } catch (err) {
    console.error("stable step watch_live", err);
  }
}

/** A breeding preview or the stallion finder ran for this player: the breeding step. */
export async function afterBreedingPreview(db: Db, session: Session, now: Date): Promise<void> {
  try {
    await completeStableStep(db, { accountId: session.accountId, step: "breeding_preview", now });
  } catch (err) {
    console.error("stable step breeding_preview", err);
  }
}

const LOCKED: Record<gc.UnlockFeature, string> = {
  tote: "The tote opens after you've watched one of your own Live races.",
  market: "The market opens on your stable's third day, or when you finish Story chapter 1.",
  leasing: "Leasing opens on your stable's third day, or when you finish Story chapter 1.",
  claiming: "Claiming races open when you finish Story chapter 1.",
  jockey_contracts: "Jockey contracts open when you finish Story chapter 1.",
};

/** Route guard: refuses a feature a new stable hasn't opened yet (existing stables: always open). */
export async function requireUnlocked(db: Db, session: Session, feature: gc.UnlockFeature, now: Date): Promise<void> {
  if (await isFeatureUnlocked(db, session.accountId, feature)) return;
  // The rules may have opened it since the last visit.
  const { unlocks } = await syncUnlocks(db, session.accountId, now);
  if (!unlocks[feature]) throw new DomainError("NOT_ELIGIBLE", LOCKED[feature]);
}
