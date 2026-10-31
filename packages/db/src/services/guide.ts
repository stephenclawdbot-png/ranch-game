/**
 * The beginner welcome (2026-10-31, owner-approved): the mentor, Stable steps (the first-week
 * guide), one-time coach marks, progressive unlocks and the welcome-back card.
 *
 * - `onboarding_states` holds one row per account. Only stables founded with the guide are
 *   `guided` (createAccount `guided: true`, set by the web app's founding); every account
 *   without a row, or with `guided` false, is an existing stable: no guide, no coach marks,
 *   every feature open. Nothing is ever taken away from a current player.
 * - Stable steps complete from the real server events (`completeStableStepTx`, called inside
 *   the action's own transaction: care, training plan, Live entry, Cup run, pick, target; or
 *   `completeStableStep` after a read: watched result, the Why card, a breeding preview). The
 *   `stable_steps` row (PK account + step) and the ledger key `stable-step:<account>:<step>`
 *   make each step pay once; the finishing bonus is `stable-steps-bonus:<account>`.
 * - Unlocks (game-core `unlockState`) are synced lazily on the player's own visits and stored
 *   in `feature_unlocks`, so an opened feature stays open; each new one is an "Unlocked" moment.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { gc } from "../gameCore";
import { accounts, featureUnlocks, inboxItems, onboardingStates, races, stableSteps, stables } from "../schema";
import type { Db, Executor } from "../types";
import { awardAchievement } from "./competition";
import { LIVE_RACE_KINDS } from "./leagues";
import { grantCreditsTx } from "./ledger";
import { MOMENT_KIND, type MomentData } from "./moments";
import { rowsOf, runTx } from "./tx";

/** Screens with one-time coach marks (web: CoachMark ids). */
export const COACH_MARK_IDS = ["racecard", "entry", "training", "breeding", "tote", "market"] as const;
export type CoachMarkId = (typeof COACH_MARK_IDS)[number];

export function isCoachMarkId(x: unknown): x is CoachMarkId {
  return typeof x === "string" && (COACH_MARK_IDS as readonly string[]).includes(x);
}

type OnboardingRow = typeof onboardingStates.$inferSelect;

/** Called by createAccount for a stable founded with the guide (inside its transaction). */
export async function startGuideTx(tx: Executor, accountId: string, now: Date): Promise<void> {
  await tx.insert(onboardingStates).values({ accountId, guided: true, lastVisitAt: now, createdAt: now }).onConflictDoNothing();
}

export async function onboardingRow(ex: Executor, accountId: string): Promise<OnboardingRow | null> {
  const [row] = await ex.select().from(onboardingStates).where(eq(onboardingStates.accountId, accountId));
  return row ?? null;
}

/** The row, created unguided for an existing account (welcome-back tracking only). */
async function ensureRow(ex: Executor, accountId: string, now: Date): Promise<OnboardingRow> {
  const row = await onboardingRow(ex, accountId);
  if (row) return row;
  await ex.insert(onboardingStates).values({ accountId, guided: false, createdAt: now }).onConflictDoNothing();
  return (await onboardingRow(ex, accountId))!;
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

const DETECT = globalThis as unknown as { __tbQuickRacesTable?: boolean };

/**
 * Quick races are another builder's feature: the step is offered only once their table exists
 * in this database (cached per process once found; looked up again until then).
 */
export async function quickRacesAvailable(ex: Executor): Promise<boolean> {
  if (DETECT.__tbQuickRacesTable) return true;
  try {
    const [r] = rowsOf<{ t: string | null }>(await ex.execute(sql`select to_regclass('public.quick_races')::text as t`));
    const found = !!r?.t;
    if (found) DETECT.__tbQuickRacesTable = true;
    return found;
  } catch {
    return false;
  }
}

export async function guideFeatures(ex: Executor): Promise<gc.GuideFeatures> {
  return { quickRaces: await quickRacesAvailable(ex) };
}

// ---------------------------------------------------------------------------
// Stable steps
// ---------------------------------------------------------------------------

export interface CompleteStepInput {
  accountId: string;
  step: gc.StableStepKey;
  now: Date;
}

/** Stores a stable-wide moment (no horse), at most once per dedupe key. */
async function stableMomentTx(ex: Executor, input: { accountId: string; kind: gc.MomentKind; dedupeKey: string; title: string; body: string; href: string; now: Date }): Promise<void> {
  const data: MomentData = { moment: input.kind, horseName: "", body: input.body, href: input.href };
  await ex
    .insert(inboxItems)
    .values({ accountId: input.accountId, kind: MOMENT_KIND, dedupeKey: input.dedupeKey, title: input.title, data, createdAt: input.now })
    .onConflictDoNothing();
}

/** Pays the finishing bonus once every step on offer is done (idempotent). True when this call finished the guide. */
async function finishGuideTx(tx: Executor, accountId: string, now: Date): Promise<boolean> {
  const rows = await tx.select({ step: stableSteps.step }).from(stableSteps).where(eq(stableSteps.accountId, accountId));
  const progress = gc.stableStepsProgress(new Set(rows.map((r) => r.step)), await guideFeatures(tx));
  if (!progress.complete) return false;
  const paid = await grantCreditsTx(tx, {
    accountId,
    amount: gc.STABLE_STEPS_BONUS,
    idempotencyKey: `stable-steps-bonus:${accountId}`,
    kind: "stable_step",
    memo: "Stable steps: finished the first-week guide",
  });
  if (paid.duplicate) return false;
  await tx.update(onboardingStates).set({ stepsDoneAt: now }).where(eq(onboardingStates.accountId, accountId));
  await awardAchievement(tx, { accountId, code: "stable_steps", data: { at: now.getTime() } });
  await stableMomentTx(tx, {
    accountId,
    kind: "stable_steps",
    dedupeKey: "moment:stable_steps",
    title: "Stable steps done: you've learned the ropes",
    body: `${gc.MENTOR.name} has nothing left to show you. +${gc.STABLE_STEPS_BONUS} credits, and the Learned the Ropes plaque is in your Trophy Room.`,
    href: "/trophies",
    now,
  });
  return true;
}

/**
 * Completes a Stable step for a guided stable and pays it (idempotent): true when this call
 * completed it. A no-op for existing stables, an unknown step or a step not on offer in this
 * build. Runs on the caller's transaction, so the step completes with the action or not at all.
 */
export async function completeStableStepTx(tx: Executor, input: CompleteStepInput): Promise<boolean> {
  const [row] = await tx.select({ guided: onboardingStates.guided, done: onboardingStates.stepsDoneAt }).from(onboardingStates).where(eq(onboardingStates.accountId, input.accountId));
  if (!row?.guided || row.done) return false;
  const def = gc.stableStepsFor(await guideFeatures(tx)).find((s) => s.key === input.step);
  if (!def) return false;
  const [have] = await tx.select({ step: stableSteps.step }).from(stableSteps).where(and(eq(stableSteps.accountId, input.accountId), eq(stableSteps.step, input.step)));
  if (have) return false;
  const paid = await grantCreditsTx(tx, {
    accountId: input.accountId,
    amount: def.credits,
    idempotencyKey: `stable-step:${input.accountId}:${input.step}`,
    kind: "stable_step",
    memo: `Stable step: ${input.step.replace(/_/g, " ")}`,
  });
  const inserted = await tx
    .insert(stableSteps)
    .values({ accountId: input.accountId, step: input.step, completedAt: input.now, ledgerTxId: paid.transactionId })
    .onConflictDoNothing()
    .returning({ step: stableSteps.step });
  if (inserted.length === 0) return false;
  await finishGuideTx(tx, input.accountId, input.now);
  return true;
}

/** `completeStableStepTx` in its own transaction (for steps that follow a read: a watched result, the Why card, a preview). */
export async function completeStableStep(db: Db, input: CompleteStepInput): Promise<boolean> {
  return runTx(db, (tx) => completeStableStepTx(tx, input));
}

export interface StableStepsState {
  steps: { key: gc.StableStepKey; credits: number; done: boolean }[];
  next: gc.StableStepKey | null;
  done: number;
  total: number;
  complete: boolean;
  bonus: number;
  /** Credits the guide pays in all in this build (steps + bonus). */
  totalCredits: number;
  /** Credits already paid by it. */
  earned: number;
  completedAtMs: number | null;
}

/**
 * The guide for a guided stable (null otherwise). Reconciles what can only be seen here: a
 * quick race run before this build detected the feature, and a bonus missed when the last two
 * steps landed in parallel transactions.
 */
export async function stableStepsView(db: Db, accountId: string, now: Date): Promise<StableStepsState | null> {
  const row = await onboardingRow(db, accountId);
  if (!row?.guided) return null;
  const features = await guideFeatures(db);
  let done = new Set((await db.select({ step: stableSteps.step }).from(stableSteps).where(eq(stableSteps.accountId, accountId))).map((r) => r.step));
  if (!row.stepsDoneAt && features.quickRaces && !done.has("quick_race")) {
    try {
      const [q] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from quick_races where account_id = ${accountId}`));
      if (Number(q?.n ?? 0) > 0 && (await completeStableStep(db, { accountId, step: "quick_race", now }))) done = new Set([...done, "quick_race"]);
    } catch {
      /* the quick races table changed shape: the step completes from its own event instead */
    }
  }
  const progress = gc.stableStepsProgress(done, features);
  let completedAt = row.stepsDoneAt;
  if (progress.complete && !completedAt) {
    await runTx(db, (tx) => finishGuideTx(tx, accountId, now));
    completedAt = (await onboardingRow(db, accountId))?.stepsDoneAt ?? now;
  }
  const earned = progress.steps.filter((s) => s.done).reduce((n, s) => n + s.credits, 0) + (completedAt ? gc.STABLE_STEPS_BONUS : 0);
  return { ...progress, bonus: gc.STABLE_STEPS_BONUS, totalCredits: gc.stableStepsTotal(features), earned, completedAtMs: completedAt?.getTime() ?? null };
}

// ---------------------------------------------------------------------------
// Progressive unlocks
// ---------------------------------------------------------------------------

/** Live card kinds as SQL (built on use: guide.ts and leagues.ts import each other through accounts.ts). */
const liveKinds = () => sql.raw(`(${LIVE_RACE_KINDS.map((k) => `'${k}'`).join(", ")})`);

/** The facts game-core `unlockState` decides from, read from the database. */
export async function unlockFacts(ex: Executor, accountId: string, now: Date, guided: boolean): Promise<gc.UnlockFacts> {
  const [acc] = await ex.select({ createdAt: accounts.createdAt, wallet: accounts.walletAddress }).from(accounts).where(eq(accounts.id, accountId));
  const [stable] = await ex.select({ id: stables.id, licence: stables.licenceLevel }).from(stables).where(eq(stables.accountId, accountId));
  const facts: gc.UnlockFacts = {
    guided,
    wallet: !!acc?.wallet,
    watchedLiveRace: false,
    daysSinceFounding: acc ? gc.dayIndex(now.getTime()) - gc.dayIndex(acc.createdAt.getTime()) : 0,
    licenceLevel: stable?.licence ?? 1,
  };
  if (!guided || !stable) return facts;
  const [f] = rowsOf<{ watched: boolean; tote: boolean; market: boolean; leasing: boolean; claiming: boolean; contracts: boolean }>(
    await ex.execute(sql`
      select
        exists (select 1 from inbox_items i join races r on r.id = i.race_id
                 where i.account_id = ${accountId} and i.kind = 'race_result' and i.read_at is not null and r.kind in ${liveKinds()}) as watched,
        exists (select 1 from tote_bets b where b.account_id = ${accountId}) as tote,
        (exists (select 1 from market_listings m where m.seller_stable_id = ${stable.id})
          or exists (select 1 from trades t where t.buyer_stable_id = ${stable.id})) as market,
        exists (select 1 from horse_leases l where l.owner_stable_id = ${stable.id} or l.lessee_stable_id = ${stable.id}) as leasing,
        (exists (select 1 from race_claims c where c.claimant_stable_id = ${stable.id})
          or exists (select 1 from race_entries e where e.stable_id = ${stable.id} and e.claim_price is not null)) as claiming,
        -- the apprentice every stable starts with (a wage-free first contract) isn't a contract the player made
        (exists (select 1 from jockey_contracts j where j.stable_id = ${stable.id} and j.wage_free_until_week is null)
          or exists (select 1 from jockey_offers o where o.stable_id = ${stable.id})) as contracts`),
  );
  facts.watchedLiveRace = !!f?.watched;
  facts.used = { tote: !!f?.tote, market: !!f?.market, leasing: !!f?.leasing, claiming: !!f?.claiming, jockey_contracts: !!f?.contracts };
  return facts;
}

export type Unlocks = Record<gc.UnlockFeature, boolean>;

const ALL_OPEN: Unlocks = { tote: true, market: true, leasing: true, claiming: true, jockey_contracts: true };

/**
 * Brings the stable's unlocks up to date (its own visits only): opens what the rules now allow,
 * stores it for good and sends each new feature's "Unlocked" moment. Existing stables: all open.
 */
export async function syncUnlocks(db: Db, accountId: string, now: Date): Promise<{ unlocks: Unlocks; fresh: gc.UnlockFeature[] }> {
  const row = await onboardingRow(db, accountId);
  if (!row?.guided) return { unlocks: { ...ALL_OPEN }, fresh: [] };
  const stored = new Map((await db.select().from(featureUnlocks).where(eq(featureUnlocks.accountId, accountId))).map((r) => [r.feature, r.reason]));
  const unlocks = Object.fromEntries(gc.UNLOCK_FEATURES.map((f) => [f, stored.has(f)])) as Unlocks;
  if (stored.size === gc.UNLOCK_FEATURES.length) return { unlocks, fresh: [] };
  const state = gc.unlockState(await unlockFacts(db, accountId, now, true));
  const fresh: gc.UnlockFeature[] = [];
  for (const f of gc.UNLOCK_FEATURES) {
    const reason = state[f];
    if (!reason || stored.has(f)) continue;
    const opened = await runTx(db, async (tx) => {
      const ins = await tx.insert(featureUnlocks).values({ accountId, feature: f, reason, unlockedAt: now }).onConflictDoNothing().returning({ f: featureUnlocks.feature });
      if (ins.length === 0) return false;
      // A wallet player came for these, and a used feature needs no announcement.
      if (reason !== "wallet" && reason !== "already_used") {
        const m = gc.UNLOCK_MOMENT[f];
        await stableMomentTx(tx, { accountId, kind: "unlock", dedupeKey: `moment:unlock:${f}`, title: m.title, body: m.body, href: m.href, now });
      }
      return true;
    });
    unlocks[f] = true;
    if (opened) fresh.push(f);
  }
  return { unlocks, fresh };
}

/** Whether a feature is open for this account (stored unlocks; existing stables: always). */
export async function isFeatureUnlocked(ex: Executor, accountId: string, feature: gc.UnlockFeature): Promise<boolean> {
  const row = await onboardingRow(ex, accountId);
  if (!row?.guided) return true;
  const [u] = await ex.select({ f: featureUnlocks.feature }).from(featureUnlocks).where(and(eq(featureUnlocks.accountId, accountId), eq(featureUnlocks.feature, feature)));
  return !!u;
}

// ---------------------------------------------------------------------------
// Mentor, plain language, coach marks
// ---------------------------------------------------------------------------

/** The mentor's welcome is done (finished or skipped). `plainLanguage` is the "New to horse racing?" answer, when given. */
export async function finishMentor(db: Db, input: { accountId: string; plainLanguage?: boolean | null; now: Date }): Promise<void> {
  await ensureRow(db, input.accountId, input.now);
  await db
    .update(onboardingStates)
    .set({ mentorDoneAt: input.now, ...(typeof input.plainLanguage === "boolean" ? { plainLanguage: input.plainLanguage } : {}) })
    .where(eq(onboardingStates.accountId, input.accountId));
}

export async function setPlainLanguage(db: Db, input: { accountId: string; on: boolean; now: Date }): Promise<void> {
  await ensureRow(db, input.accountId, input.now);
  await db.update(onboardingStates).set({ plainLanguage: input.on }).where(eq(onboardingStates.accountId, input.accountId));
}

/** Records a dismissed coach mark (idempotent; each shows once per account). */
export async function markCoachSeen(db: Db, input: { accountId: string; id: CoachMarkId; now: Date }): Promise<string[]> {
  await ensureRow(db, input.accountId, input.now);
  const [row] = await db
    .update(onboardingStates)
    .set({ coachSeen: sql`case when ${onboardingStates.coachSeen} @> ${JSON.stringify([input.id])}::jsonb then ${onboardingStates.coachSeen} else ${onboardingStates.coachSeen} || ${JSON.stringify([input.id])}::jsonb end` })
    .where(eq(onboardingStates.accountId, input.accountId))
    .returning({ seen: onboardingStates.coachSeen });
  return (row?.seen as string[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Welcome back
// ---------------------------------------------------------------------------

/** Visits closer than this don't rewrite last_visit_at (the player view polls). */
const VISIT_WRITE_MS = 5 * 60_000;

/**
 * Records a visit (the player's own state, i.e. any page while signed in). After a day or more
 * away it opens a welcome-back window: `from` (the last visit before) and `at` (this one).
 * Returns the open window, if any. Never a penalty, just a catch-up.
 */
export async function recordVisit(db: Db, accountId: string, now: Date): Promise<{ fromMs: number; atMs: number } | null> {
  const row = await ensureRow(db, accountId, now);
  const last = row.lastVisitAt?.getTime() ?? null;
  const nowMs = now.getTime();
  let from = row.welcomeBackFrom;
  let at = row.welcomeBackAt;
  if (gc.isWelcomeBack(last, nowMs)) {
    from = row.lastVisitAt;
    at = now;
    await db.update(onboardingStates).set({ lastVisitAt: now, welcomeBackFrom: from, welcomeBackAt: at }).where(eq(onboardingStates.accountId, accountId));
  } else if (last === null || nowMs - last >= VISIT_WRITE_MS) {
    await db.update(onboardingStates).set({ lastVisitAt: now }).where(eq(onboardingStates.accountId, accountId));
  }
  if (!from || !at || nowMs - at.getTime() > gc.WELCOME_BACK_SHOW_MS) return null;
  return { fromMs: from.getTime(), atMs: at.getTime() };
}

export async function dismissWelcomeBack(db: Db, accountId: string): Promise<void> {
  await db.update(onboardingStates).set({ welcomeBackFrom: null, welcomeBackAt: null }).where(eq(onboardingStates.accountId, accountId));
}

/** The account has watched this race's result (its race_result inbox item is read). */
export async function resultWatched(ex: Executor, accountId: string, raceId: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.raceId, raceId), eq(inboxItems.kind, "race_result"), sql`${inboxItems.readAt} is not null`));
  return !!row;
}

/** A shared-card Live race (not Story, the Cup or a trial). */
export async function isLiveRace(ex: Executor, raceId: string): Promise<boolean> {
  const [r] = await ex.select({ kind: races.kind }).from(races).where(eq(races.id, raceId));
  return !!r && (LIVE_RACE_KINDS as readonly string[]).includes(r.kind);
}

/** Accounts that finished the guide (for owner stats / the plaque). */
export async function stableStepsDone(ex: Executor, accountId: string): Promise<boolean> {
  const [row] = await ex.select({ done: onboardingStates.stepsDoneAt }).from(onboardingStates).where(eq(onboardingStates.accountId, accountId));
  return !!row?.done;
}

/** Completed steps per account (harness / admin metrics). */
export async function stableStepCounts(ex: Executor, accountIds: string[]): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const rows = await ex
    .select({ accountId: stableSteps.accountId, n: sql<number>`count(*)::int` })
    .from(stableSteps)
    .where(inArray(stableSteps.accountId, accountIds))
    .groupBy(stableSteps.accountId);
  return new Map(rows.map((r) => [r.accountId, Number(r.n)]));
}
