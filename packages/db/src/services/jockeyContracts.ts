/**
 * Jockeys Phase 2 (docs/design/jockeys.md; rules in game-core jockeyContracts.ts): contracts, the
 * weekly transfer window, morale and the development bonus.
 *
 *   signing (direct, a stable's starting apprentice, a window win) → startContractTx
 *   runJockeyMaintenance, once a game week (Monday 00:00 UTC) → runContractWeekTx: wages (burned;
 *       a stable that can't pay loses the jockey at Sunday's window, the debt waived), morale from
 *       last week's rides vs the promise, contract-end notes, this week's free agents marked, and
 *       the window's seed committed
 *   makeJockeyOffer / withdrawJockeyOffer: offers to free agents until the deadline, the signing fee
 *       escrowed (refunded when the offer loses), at most JOCKEY_OPEN_OFFERS_PER_STABLE open
 *   runJockeyMaintenance after Sunday 20:00 UTC → runTransferWindowTx: jockey-proposing deferred
 *       acceptance over the jockeys' published utilities; results and the revealed seed stored on
 *       jockey_weeks; news, inbox notes; unmatched free agents go to the Club pool
 *   settleJockeyRidesTx → developmentTx: "developed at" and the development bonus
 *
 * Credits only: wages, fees and bonuses are Stable Credits, never USDG or T-USDG.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { commitSeed, newSeed } from "../crypto";
import { DomainError } from "../errors";
import { gc } from "../gameCore";
import { seasonBounds, seasonNumberAt } from "../rules";
import { fraudEvents, inboxItems, jockeyContracts, jockeyOffers, jockeyRides, jockeyWeeks, jockeys, stables, type JockeyContractRow, type JockeyOfferRow, type JockeyRow, type RaceRow } from "../schema";
import type { Db, Executor, Tx } from "../types";
import { accountIdOfStable, areLinked, lockStableOf } from "./accounts";
import { getBalance, grantCreditsTx, playerLedgerAccountId, post, spendCreditsTx, systemAccountId } from "./ledger";
import { putNews } from "./news";
import { audit, rowsOf, runTx } from "./tx";
import { JOCKEY_LINKED_SIGN_DAYS, gradeOfJockey, jockeyEventTx, skillsOf } from "./jockeys";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Inbox kind of every jockey note (contract ends, window results, wages, morale, bonuses). */
export const JOCKEY_NOTE = "jockey";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** The seasons a contract signed at `at` may run to (the one in progress, and the next). */
function seasonEndsFrom(at: Date): number[] {
  const n = seasonNumberAt(at);
  return [seasonBounds(n).endsAt.getTime(), seasonBounds(n + 1).endsAt.getTime()];
}

export async function activeContractOf(ex: Executor, jockeyId: string): Promise<JockeyContractRow | null> {
  const [c] = await ex.select().from(jockeyContracts).where(and(eq(jockeyContracts.jockeyId, jockeyId), eq(jockeyContracts.status, "active")));
  return c ?? null;
}

/** Standard terms: the grade's wage, 4 weeks, JOCKEY_DEFAULT_PROMISED_RIDES, the default buyout. */
export function standardTerms(j: Pick<JockeyRow, "skills">): gc.OfferTerms {
  const grade = gradeOfJockey(j);
  return { wage: gc.jockeyWage(grade), length: "4w", promisedRides: gc.JOCKEY_DEFAULT_PROMISED_RIDES, buyout: gc.buyoutBounds(gc.signingFee(grade)).default };
}

/**
 * Starts a contract (ending any active one). An apprentice on its first contract pays no wage for
 * JOCKEY_APPRENTICE_FREE_WEEKS weekly charges.
 */
export async function startContractTx(tx: Executor, input: { jockey: JockeyRow; stableId: string; now: Date; terms: gc.OfferTerms; why?: string }): Promise<JockeyContractRow> {
  const j = input.jockey;
  const old = await activeContractOf(tx, j.id);
  if (old) await endContractTx(tx, old, input.now, input.why ?? (old.stableId === input.stableId ? "re-signed" : "moved"));
  const [had] = await tx.select({ id: jockeyContracts.id }).from(jockeyContracts).where(eq(jockeyContracts.jockeyId, j.id)).limit(1);
  const startWeek = gc.weekIndex(input.now.getTime());
  const first = !had && j.stage === "apprentice";
  const [row] = await tx
    .insert(jockeyContracts)
    .values({
      jockeyId: j.id,
      stableId: input.stableId,
      length: input.terms.length,
      startsAt: input.now,
      startWeek,
      endsWeek: gc.contractEndWeek(input.terms.length, startWeek, seasonEndsFrom(input.now)),
      wage: input.terms.wage,
      wageFreeUntilWeek: first ? startWeek + 1 + gc.JOCKEY_APPRENTICE_FREE_WEEKS : null,
      promisedRides: input.terms.promisedRides,
      buyout: input.terms.buyout,
    })
    .returning();
  return row!;
}

async function endContractTx(tx: Executor, c: JockeyContractRow, now: Date, why: string): Promise<void> {
  await tx.update(jockeyContracts).set({ status: "ended", endedAt: now, endedWhy: why }).where(and(eq(jockeyContracts.id, c.id), eq(jockeyContracts.status, "active")));
}

/** Ends a jockey's active contract, if any (release, idle stable, retirement). */
export async function endJockeyContractTx(tx: Executor, jockeyId: string, now: Date, why: string): Promise<void> {
  const c = await activeContractOf(tx, jockeyId);
  if (c) await endContractTx(tx, c, now, why);
}

/**
 * Phase 1 → Phase 2 (idempotent): every held jockey without an active contract gets a 4-week
 * contract at its grade's wage with JOCKEY_DEFAULT_PROMISED_RIDES promised (an apprentice's first
 * contract wage-free for its first weeks).
 */
export async function ensureContractBackfillTx(tx: Executor, now: Date): Promise<number> {
  const rows = await tx
    .select()
    .from(jockeys)
    .where(and(isNull(jockeys.retiredAt), sql`${jockeys.stableId} is not null`, sql`not exists (select 1 from jockey_contracts c where c.jockey_id = ${jockeys.id} and c.status = 'active')`))
    .orderBy(asc(jockeys.id));
  for (const j of rows) await startContractTx(tx, { jockey: j, stableId: j.stableId!, now, terms: standardTerms(j) });
  return rows.length;
}

async function note(ex: Executor, input: { stableId: string; key: string; title: string; jockeyId: string; now: Date; data?: Record<string, unknown> }): Promise<void> {
  const accountId = await accountIdOfStable(ex, input.stableId);
  await ex
    .insert(inboxItems)
    .values({ accountId, kind: JOCKEY_NOTE, dedupeKey: `jockey:${input.key}`, title: input.title, data: { href: `/jockeys/${input.jockeyId}`, jockeyId: input.jockeyId, ...(input.data ?? {}) }, createdAt: input.now })
    .onConflictDoNothing();
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// ---------------------------------------------------------------------------
// The weekly job: wages, morale, notes, free agents, the seed
// ---------------------------------------------------------------------------

export interface ContractWeek {
  wagesPaid: number;
  wagesCharged: number;
  unpaid: number;
  broken: number;
  walkouts: number;
  notes: number;
  freeAgents: number;
}

/** Rides each jockey had for its contract stable between two times. */
async function ridesFor(ex: Executor, pairs: { jockeyId: string; stableId: string }[], from: Date, to: Date): Promise<Map<string, number>> {
  if (!pairs.length) return new Map();
  const res = await ex.execute(sql`
    select jockey_id as "jockeyId", jockey_stable_id as "stableId", count(*)::int as n from jockey_rides jr join races r on r.id = jr.race_id
    where jr.post_time >= ${from} and jr.post_time < ${to} and r.status <> 'cancelled'
      and jr.jockey_id in (${sql.join(pairs.map((p) => sql`${p.jockeyId}`), sql`, `)})
    group by jockey_id, jockey_stable_id`);
  return new Map(rowsOf<{ jockeyId: string; stableId: string | null; n: number }>(res).map((r) => [`${r.jockeyId}|${r.stableId}`, Number(r.n)]));
}

/**
 * Once per game week, inside the weekly job's transaction (jockey_weeks row `week` just claimed):
 * charges wages, counts last week's rides against the promise, sends contract-end notes, marks
 * this week's free agents and commits the window's seed.
 */
export async function runContractWeekTx(tx: Tx, week: number, now: Date): Promise<ContractWeek> {
  const out: ContractWeek = { wagesPaid: 0, wagesCharged: 0, unpaid: 0, broken: 0, walkouts: 0, notes: 0, freeAgents: 0 };
  const seed = newSeed();
  await tx.update(jockeyWeeks).set({ windowSeed: seed, windowCommitment: commitSeed(seed) }).where(and(eq(jockeyWeeks.week, week), isNull(jockeyWeeks.windowSeed)));
  const contracts = await tx
    .select({ c: jockeyContracts, j: jockeys })
    .from(jockeyContracts)
    .innerJoin(jockeys, eq(jockeys.id, jockeyContracts.jockeyId))
    .where(and(eq(jockeyContracts.status, "active"), isNull(jockeys.retiredAt)))
    .orderBy(asc(jockeyContracts.id));
  const lastWeek = { from: new Date(gc.weekStartMs(week - 1)), to: new Date(gc.weekStartMs(week)) };
  const rides = await ridesFor(tx, contracts.map(({ c }) => ({ jockeyId: c.jockeyId, stableId: c.stableId })), lastWeek.from, lastWeek.to);
  for (const { c, j } of contracts) {
    const patch: Partial<JockeyContractRow> = {};
    let leaves = false;
    // Wages: from the first full week of the contract.
    if (c.startWeek < week) {
      const due = gc.wageDue(c, week);
      if (due > 0) {
        const accountId = await accountIdOfStable(tx, c.stableId);
        if ((await getBalance(tx, accountId)) >= due) {
          const r = await spendCreditsTx(tx, { accountId, amount: due, idempotencyKey: `jockey-wage:${c.id}:${week}`, kind: "jockey_wage", memo: `${j.name}, week ${week}` });
          if (!r.duplicate) {
            patch.wagesPaid = c.wagesPaid + due;
            out.wagesPaid += due;
            out.wagesCharged++;
          }
        } else if (c.unpaidWeek === null) {
          patch.unpaidWeek = week;
          leaves = true;
          out.unpaid++;
          await note(tx, { stableId: c.stableId, key: `unpaid:${c.id}`, jockeyId: j.id, now, title: `You couldn't pay ${j.name}'s wage of ${due} cr. ${firstName(j.name)} leaves at Sunday's transfer window; the debt is waived.` });
        }
      }
    }
    // Morale: last week's rides against the promise (only a week the contract covered in full).
    if (c.startWeek < week - 1 && c.lastRidesWeek !== week - 1) {
      const n = rides.get(`${j.id}|${c.stableId}`) ?? 0;
      const broken = gc.nextBrokenWeeks(c.brokenWeeks, c.promisedRides, n);
      Object.assign(patch, { brokenWeeks: broken, lastRidesWeek: week - 1, lastWeekRides: n });
      if (broken > c.brokenWeeks) {
        out.broken++;
        if (broken === gc.JOCKEY_BROKEN_PROMISE_WEEKS) {
          leaves = true;
          out.walkouts++;
          await note(tx, { stableId: c.stableId, key: `walkout:${c.id}`, jockeyId: j.id, now, title: `${j.name} had ${n} of ${c.promisedRides} promised rides last week, two weeks running. ${firstName(j.name)} can leave at Sunday's window.` });
        } else if (broken < gc.JOCKEY_BROKEN_PROMISE_WEEKS) {
          await note(tx, { stableId: c.stableId, key: `broken:${c.id}:${week}`, jockeyId: j.id, now, title: `${j.name} had ${n} of ${c.promisedRides} promised rides last week and isn't happy.` });
        }
      }
    }
    if (c.brokenWeeks >= gc.JOCKEY_BROKEN_PROMISE_WEEKS || c.unpaidWeek !== null) leaves = true;
    // Contract-end notes: two weeks and one week before.
    const notes = Array.isArray(c.notes) ? (c.notes as string[]) : [];
    const weeksLeft = c.endsWeek - week;
    if ((weeksLeft === 1 || weeksLeft === 0) && !notes.includes(String(weeksLeft + 1))) {
      patch.notes = [...notes, String(weeksLeft + 1)];
      out.notes++;
      const when = weeksLeft === 0 ? "ends Sunday" : "ends a week on Sunday";
      await note(tx, { stableId: c.stableId, key: `ends:${c.id}:${weeksLeft + 1}`, jockeyId: j.id, now, title: `${j.name}'s contract ${when}. Offer ${firstName(j.name)} a new one?` });
    }
    if (weeksLeft <= 0) leaves = true;
    if (Object.keys(patch).length) await tx.update(jockeyContracts).set(patch).where(eq(jockeyContracts.id, c.id));
    if (leaves && j.freeAgentWeek !== week && !j.retirementAnnouncedAt) {
      await tx.update(jockeys).set({ freeAgentWeek: week }).where(eq(jockeys.id, j.id));
      out.freeAgents++;
    }
  }
  // Club jockeys waiting for a window that passed join this one.
  const late = await tx
    .update(jockeys)
    .set({ freeAgentWeek: week })
    .where(and(isNull(jockeys.retiredAt), isNull(jockeys.stableId), sql`${jockeys.freeAgentWeek} < ${week}`))
    .returning({ id: jockeys.id });
  out.freeAgents += late.length;
  return out;
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** The current week's window (closes Sunday 20:00 UTC; after that, next week's). */
export function currentWindowWeek(now: Date): number {
  return gc.windowWeekAt(now.getTime());
}

/** Is this jockey a free agent in the window now open? */
export function isFreeAgent(j: Pick<JockeyRow, "freeAgentWeek" | "retiredAt" | "retirementAnnouncedAt">, now: Date): boolean {
  return j.freeAgentWeek !== null && j.freeAgentWeek === currentWindowWeek(now) && !j.retiredAt && !j.retirementAnnouncedAt;
}

/** Jockeys a stable holds that stay past this window (not free agents in it). */
async function stayingCount(ex: Executor, stableId: string, week: number): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(jockeys)
    .where(and(eq(jockeys.stableId, stableId), isNull(jockeys.retiredAt), or(isNull(jockeys.freeAgentWeek), sql`${jockeys.freeAgentWeek} <> ${week}`)));
  return Number(r?.n ?? 0);
}

/**
 * The linked-account refusal (as on the market): an offer or a signing between linked accounts —
 * the jockey's current stable, or the stable that let them go within JOCKEY_LINKED_SIGN_DAYS — is
 * refused and recorded as a fraud event. Returns the refusal (the caller commits the event, then throws).
 */
export async function linkedRefusalTx(tx: Executor, input: { accountId: string; stableId: string; jockey: JockeyRow; now: Date; action: string }): Promise<DomainError | null> {
  const j = input.jockey;
  const others = new Set<string>();
  if (j.stableId && j.stableId !== input.stableId) others.add(j.stableId);
  if (j.lastStableId && j.lastStableId !== input.stableId && j.releasedAt && input.now.getTime() - j.releasedAt.getTime() < JOCKEY_LINKED_SIGN_DAYS * DAY_MS) others.add(j.lastStableId);
  for (const s of others) {
    const other = await accountIdOfStable(tx, s);
    if (await areLinked(tx, input.accountId, other)) {
      await tx.insert(fraudEvents).values({ accountId: input.accountId, relatedAccountId: other, kind: "linked_trade_blocked", severity: 2, data: { jockeyId: j.id, action: input.action } });
      return new DomainError("LINKED_ACCOUNTS", "signing or making offers for a linked account's jockey is not allowed");
    }
  }
  return null;
}

export interface OfferInput {
  accountId: string;
  jockeyId: string;
  now: Date;
  terms: gc.OfferTerms;
}

/**
 * Makes (or amends) an offer to a free agent in the window now open. Escrows the signing fee by
 * grade (none for the jockey's current stable). Refused: not a free agent, a linked account, no
 * free place left after this window, JOCKEY_OPEN_OFFERS_PER_STABLE open already, terms out of bounds.
 */
export async function makeJockeyOffer(db: Db, input: OfferInput): Promise<JockeyOfferRow> {
  const outcome = await runTx(db, async (tx): Promise<JockeyOfferRow | DomainError> => {
    const stable = await lockStableOf(tx, input.accountId);
    const [j] = await tx.select().from(jockeys).where(eq(jockeys.id, input.jockeyId)).for("update");
    if (!j) throw new DomainError("NOT_FOUND", "no such jockey");
    if (!isFreeAgent(j, input.now)) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} isn't a free agent in this week's window`);
    const refused = await linkedRefusalTx(tx, { accountId: input.accountId, stableId: stable.id, jockey: j, now: input.now, action: "offer" });
    if (refused) return refused;
    const week = currentWindowWeek(input.now);
    const grade = gradeOfJockey(j);
    const problem = gc.offerTermsProblem(input.terms, grade, gc.signingFee(grade));
    if (problem) throw new DomainError("INVALID_INPUT", problem);
    const current = j.stableId === stable.id;
    if (current) {
      const c = await activeContractOf(tx, j.id);
      if (c && (c.unpaidWeek !== null || c.brokenWeeks >= gc.JOCKEY_BROKEN_PROMISE_WEEKS)) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} won't sign for you again this week`);
    }
    const [existing] = await tx.select().from(jockeyOffers).where(and(eq(jockeyOffers.week, week), eq(jockeyOffers.jockeyId, j.id), eq(jockeyOffers.stableId, stable.id))).for("update");
    if (existing?.status === "open") {
      const [row] = await tx.update(jockeyOffers).set({ ...termsCols(input.terms) }).where(eq(jockeyOffers.id, existing.id)).returning();
      await audit(tx, { actor: input.accountId, action: "jockey.offer_amend", entityType: "jockey", entityId: j.id, data: { week, ...input.terms } });
      return row!;
    }
    const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(jockeyOffers).where(and(eq(jockeyOffers.stableId, stable.id), eq(jockeyOffers.status, "open")));
    if (Number(open?.n ?? 0) >= gc.JOCKEY_OPEN_OFFERS_PER_STABLE) throw new DomainError("JOCKEY_LIMIT", `at most ${gc.JOCKEY_OPEN_OFFERS_PER_STABLE} open offers at a time`);
    if (!current && (await stayingCount(tx, stable.id, week)) >= gc.JOCKEYS_PER_STABLE_MAX) throw new DomainError("JOCKEY_LIMIT", `a stable can hold at most ${gc.JOCKEYS_PER_STABLE_MAX} jockeys`);
    const fee = current ? 0 : gc.signingFee(grade);
    const values = { week, jockeyId: j.id, stableId: stable.id, accountId: input.accountId, ...termsCols(input.terms), fee, status: "open", utility: null, resolvedAt: null, createdAt: input.now };
    const [row] = existing
      ? await tx.update(jockeyOffers).set(values).where(eq(jockeyOffers.id, existing.id)).returning()
      : await tx.insert(jockeyOffers).values(values).returning();
    if (fee > 0) await spendCreditsTx(tx, { accountId: input.accountId, amount: fee, idempotencyKey: escrowKey(row!), kind: "jockey_offer_escrow", memo: j.name, sink: "escrow" });
    await audit(tx, { actor: input.accountId, action: "jockey.offer", entityType: "jockey", entityId: j.id, data: { week, fee, ...input.terms } });
    return row!;
  });
  if (outcome instanceof DomainError) throw outcome;
  return outcome;
}

const termsCols = (t: gc.OfferTerms) => ({ length: t.length, wage: t.wage, promisedRides: t.promisedRides, buyout: t.buyout });
const escrowKey = (o: JockeyOfferRow) => `jockey-offer:${o.id}:${o.createdAt.getTime()}`;

/** Returns an offer's escrowed fee to the stable. */
async function refundTx(tx: Executor, o: JockeyOfferRow): Promise<void> {
  if (o.fee <= 0) return;
  await post(tx, {
    idempotencyKey: `${escrowKey(o)}:refund`,
    kind: "jockey_offer_refund",
    memo: "Jockey offer not taken",
    postings: [
      { ledgerAccountId: await systemAccountId(tx, "escrow"), amount: -o.fee },
      { ledgerAccountId: await playerLedgerAccountId(tx, o.accountId), amount: o.fee },
    ],
  });
}

/** Withdraws an open offer before the deadline (the fee comes back). */
export async function withdrawJockeyOffer(db: Db, input: { accountId: string; jockeyId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const week = currentWindowWeek(input.now);
    const [o] = await tx.select().from(jockeyOffers).where(and(eq(jockeyOffers.week, week), eq(jockeyOffers.jockeyId, input.jockeyId), eq(jockeyOffers.stableId, stable.id), eq(jockeyOffers.status, "open"))).for("update");
    if (!o) throw new DomainError("NOT_FOUND", "no open offer");
    await tx.update(jockeyOffers).set({ status: "withdrawn", resolvedAt: input.now }).where(eq(jockeyOffers.id, o.id));
    await refundTx(tx, o);
    await audit(tx, { actor: input.accountId, action: "jockey.offer_withdraw", entityType: "jockey", entityId: input.jockeyId, data: { week } });
  });
}

// ---------------------------------------------------------------------------
// Stable facts the jockeys weigh
// ---------------------------------------------------------------------------

export interface StableFacts {
  /** Mean rating of the top 5 racing horses (0 with none). */
  quality: number;
  prestige: number;
  tier: number;
  trophies: number;
  recentWinners: number;
}

export async function stableFactsTx(ex: Executor, stableIds: string[], now: Date): Promise<Map<string, StableFacts>> {
  const out = new Map<string, StableFacts>();
  if (!stableIds.length) return out;
  const ids = sql.join(stableIds.map((s) => sql`${s}`), sql`, `);
  const since = new Date(now.getTime() - 14 * DAY_MS);
  const q = rowsOf<{ id: string; quality: number | null; tier: number | null; trophies: number; recent: number }>(
    await ex.execute(sql`
      select s.id,
        (select avg(rating)::int from (select h.rating from horses h where h.owner_stable_id = s.id and h.career_status = 'racing' order by h.rating desc limit 5) t) as quality,
        (select l.tier from league_members m join leagues l on l.id = m.league_id where m.account_id = s.account_id order by m.week_start desc limit 1) as tier,
        (select count(*)::int from race_entries e join races r on r.id = e.race_id where e.stable_id = s.id and e.finish_position = 1 and r.kind in ('feature', 'final') and r.status = 'settled') as trophies,
        (select count(*)::int from race_entries e join races r on r.id = e.race_id where e.stable_id = s.id and e.finish_position = 1 and r.kind <> 'quick' and r.status = 'settled' and r.post_time >= ${since}) as recent
      from stables s where s.id in (${ids})`),
  );
  for (const r of q) {
    const f = { tier: Number(r.tier ?? 1), trophies: Number(r.trophies), recentWinners: Number(r.recent) };
    out.set(r.id, { quality: Number(r.quality ?? 0), prestige: gc.stablePrestige({ ...f, tiers: gc.LEAGUE_TIERS.length }), ...f });
  }
  return out;
}

/** Big wins (purse ≥ JOCKEY_BIG_WIN_PURSE) a jockey rode for a stable. */
async function bigWinsTogether(ex: Executor, jockeyId: string, stableId: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(jockeyRides)
    .where(and(eq(jockeyRides.jockeyId, jockeyId), eq(jockeyRides.jockeyStableId, stableId), eq(jockeyRides.position, 1), sql`exists (select 1 from races r where r.id = ${jockeyRides.raceId} and r.purse >= ${gc.JOCKEY_BIG_WIN_PURSE})`));
  return Number(r?.n ?? 0);
}

/** Weeks a contract of this length signed at `at` would run. */
function contractWeeks(length: gc.JockeyContractLength, at: Date): number {
  const w = gc.weekIndex(at.getTime());
  return gc.contractEndWeek(length, w, seasonEndsFrom(at)) - w;
}

/** The facts a jockey weighs for an offer (shared by the window and the jockey page). */
async function offerFactsTx(ex: Executor, j: JockeyRow, o: Pick<JockeyOfferRow, "stableId" | "wage" | "length" | "promisedRides">, facts: Map<string, StableFacts>, at: Date): Promise<gc.OfferFacts> {
  const f = facts.get(o.stableId);
  const current = j.stableId === o.stableId;
  return {
    wage: o.wage,
    weeks: contractWeeks(o.length as gc.JockeyContractLength, at),
    promisedRides: o.promisedRides,
    stableQuality: f?.quality ?? 0,
    prestige: f?.prestige ?? 0,
    current,
    weeksTogether: current && j.joinedAt ? Math.floor((at.getTime() - j.joinedAt.getTime()) / WEEK_MS) : 0,
    bigWinsTogether: current ? await bigWinsTogether(ex, j.id, o.stableId) : 0,
  };
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export interface WindowSigning {
  jockeyId: string;
  name: string;
  fromStableId: string | null;
  fromStableName: string | null;
  toStableId: string;
  toStableName: string;
  wage: number;
  length: string;
  promisedRides: number;
  utility: number;
}

export interface WindowResult {
  week: number;
  closedAt: string;
  seed: string;
  commitment: string;
  freeAgents: number;
  offers: number;
  signings: WindowSigning[];
  /** Free agents who moved to a different stable. */
  moves: number;
  /** Free agents with no taker (to the Club pool). */
  unmatched: number;
  walkouts: number;
  refunded: number;
}

/**
 * Closes week `week`'s window (inside the maintenance transaction), once: the claim on
 * jockey_weeks.window_ran_at makes it idempotent. Returns null when it already ran.
 */
export async function runTransferWindowTx(tx: Tx, week: number, now: Date): Promise<WindowResult | null> {
  await tx.insert(jockeyWeeks).values({ week, ranAt: now }).onConflictDoNothing();
  const [claimed] = await tx.update(jockeyWeeks).set({ windowRanAt: now }).where(and(eq(jockeyWeeks.week, week), isNull(jockeyWeeks.windowRanAt))).returning();
  if (!claimed) return null;
  let seed = claimed.windowSeed;
  if (!seed) {
    seed = newSeed();
    await tx.update(jockeyWeeks).set({ windowSeed: seed, windowCommitment: commitSeed(seed) }).where(eq(jockeyWeeks.week, week));
  }
  const agents = await tx
    .select()
    .from(jockeys)
    .where(and(isNull(jockeys.retiredAt), lte(jockeys.freeAgentWeek, week)))
    .orderBy(asc(jockeys.id))
    .for("update");
  const agentIds = new Set(agents.map((a) => a.id));
  const contracts = new Map<string, JockeyContractRow>();
  if (agents.length) for (const c of await tx.select().from(jockeyContracts).where(and(eq(jockeyContracts.status, "active"), inArray(jockeyContracts.jockeyId, [...agentIds])))) contracts.set(c.jockeyId, c);
  const open = await tx.select().from(jockeyOffers).where(and(lte(jockeyOffers.week, week), eq(jockeyOffers.status, "open"))).orderBy(asc(jockeyOffers.id)).for("update");
  // Offers the jockey can take: a free agent (not retiring), not from a stable it is walking out on.
  const walking = (j: JockeyRow) => {
    const c = contracts.get(j.id);
    return !!c && (c.unpaidWeek !== null || c.brokenWeeks >= gc.JOCKEY_BROKEN_PROMISE_WEEKS);
  };
  const byId = new Map(agents.map((a) => [a.id, a]));
  const valid = open.filter((o) => {
    const j = byId.get(o.jockeyId);
    return o.week === week && !!j && !j.retirementAnnouncedAt && !(j.stableId === o.stableId && walking(j));
  });
  const offerStables = [...new Set(valid.map((o) => o.stableId))].sort();
  const facts = await stableFactsTx(tx, offerStables, now);
  const capacity: Record<string, number> = {};
  for (const s of offerStables) capacity[s] = Math.max(0, gc.JOCKEYS_PER_STABLE_MAX - (await stayingCount(tx, s, week)));
  const match: gc.MatchOffer[] = [];
  const utilities = new Map<string, number>();
  for (const o of valid) {
    const j = byId.get(o.jockeyId)!;
    const grade = gradeOfJockey(j);
    const utility = gc.offerUtility(j.personality as gc.JockeyPersonality, grade, await offerFactsTx(tx, j, o, facts, now));
    utilities.set(o.id, utility);
    match.push({ jockeyId: j.id, stableId: o.stableId, utility, priority: o.wage * 1000 + gc.jockeyOverall(skillsOf(j)) });
  }
  const result = gc.matchJockeys({ offers: match, capacity, seed });
  const names = new Map((offerStables.length || agents.length ? await tx.select({ id: stables.id, name: stables.name }).from(stables) : []).map((s) => [s.id, s.name]));
  const signings: WindowSigning[] = [];
  let moves = 0;
  let unmatched = 0;
  let walkouts = 0;
  let refunded = 0;
  const offerOf = (jockeyId: string, stableId: string) => valid.find((o) => o.jockeyId === jockeyId && o.stableId === stableId)!;
  for (const j of agents) {
    const to = result.get(j.id);
    const from = j.stableId;
    const c = contracts.get(j.id);
    const leaving = !c ? "moved" : c.unpaidWeek !== null ? "unpaid" : c.brokenWeeks >= gc.JOCKEY_BROKEN_PROMISE_WEEKS ? "walked_out" : null;
    if (from && leaving === "walked_out" && to !== from) walkouts++;
    if (!to) {
      // No taker: back to the Club pool.
      unmatched++;
      if (from) {
        const why = leaving && c ? leaving : "expired";
        if (c) await endContractTx(tx, c, now, why);
        await tx.update(jockeys).set({ stableId: null, joinedAt: null, lastStableId: from, releasedAt: now, freeAgentWeek: null }).where(eq(jockeys.id, j.id));
        await jockeyEventTx(tx, { key: `released:${j.id}:${now.getTime()}`, jockeyId: j.id, kind: "released", stableId: from, at: now, data: { why, window: week } });
        await note(tx, { stableId: from, key: `left:${j.id}:${week}`, jockeyId: j.id, now, title: `${j.name} has left for the Club pool${why === "walked_out" ? " after two weeks of broken promises" : why === "unpaid" ? " (the unpaid wage is waived)" : ""}.` });
      } else {
        await tx.update(jockeys).set({ freeAgentWeek: null }).where(eq(jockeys.id, j.id));
      }
      continue;
    }
    const o = offerOf(j.id, to);
    const utility = utilities.get(o.id) ?? 0;
    const terms = { wage: o.wage, length: o.length as gc.JockeyContractLength, promisedRides: o.promisedRides, buyout: o.buyout };
    const contract = await startContractTx(tx, { jockey: j, stableId: to, now, terms, why: from === to ? "re-signed" : (leaving ?? "moved") });
    await tx.update(jockeyOffers).set({ status: "won", utility, resolvedAt: now }).where(eq(jockeyOffers.id, o.id));
    if (o.fee > 0) {
      await post(tx, {
        idempotencyKey: `${escrowKey(o)}:won`,
        kind: "jockey_signing",
        memo: j.name,
        postings: [
          { ledgerAccountId: await systemAccountId(tx, "escrow"), amount: -o.fee },
          { ledgerAccountId: await systemAccountId(tx, "burn"), amount: o.fee },
        ],
      });
    }
    const toName = names.get(to) ?? "a stable";
    signings.push({ jockeyId: j.id, name: j.name, fromStableId: from, fromStableName: from ? (names.get(from) ?? null) : null, toStableId: to, toStableName: toName, wage: o.wage, length: o.length, promisedRides: o.promisedRides, utility });
    if (from === to) {
      await tx.update(jockeys).set({ freeAgentWeek: null }).where(eq(jockeys.id, j.id));
      await note(tx, { stableId: to, key: `resigned:${j.id}:${week}`, jockeyId: j.id, now, title: `${j.name} re-signs: ${gc.JOCKEY_CONTRACT_LENGTH_LABELS[terms.length].toLowerCase()} at ${o.wage} cr a week.` });
      continue;
    }
    moves++;
    await tx.update(jockeys).set({ stableId: to, joinedAt: now, freeAgentWeek: null, ...(from ? { lastStableId: from, releasedAt: now } : {}) }).where(eq(jockeys.id, j.id));
    await jockeyEventTx(tx, { key: `signed:${j.id}:${now.getTime()}`, jockeyId: j.id, kind: "signed", stableId: to, at: now, data: { window: week, wage: o.wage, length: o.length, promisedRides: o.promisedRides, fee: o.fee, contractId: contract.id } });
    await putNews(tx, { dedupeKey: `jockey-signed:${j.id}:${week}`, kind: "jockey_signed", facts: { jockey: j.name, stable: toName }, href: `/jockeys/${j.id}`, publicAt: now, jockeyId: j.id, stableIds: [to, from] });
    await note(tx, { stableId: to, key: `won:${j.id}:${week}`, jockeyId: j.id, now, title: `${j.name} signs for you: ${gc.JOCKEY_CONTRACT_LENGTH_LABELS[terms.length].toLowerCase()} at ${o.wage} cr a week.` });
    if (from) await note(tx, { stableId: from, key: `left:${j.id}:${week}`, jockeyId: j.id, now, title: `${j.name} leaves you for ${toName}.` });
  }
  // Every other open offer loses: the fee comes back.
  const won = new Set([...result].map(([j, s]) => `${j}|${s}`));
  for (const o of open) {
    if (won.has(`${o.jockeyId}|${o.stableId}`) && o.week === week) continue;
    await tx.update(jockeyOffers).set({ status: "lost", utility: utilities.get(o.id) ?? null, resolvedAt: now }).where(eq(jockeyOffers.id, o.id));
    await refundTx(tx, o);
    refunded++;
    const j = byId.get(o.jockeyId);
    const went = result.get(o.jockeyId);
    await note(tx, { stableId: o.stableId, key: `lost:${o.id}`, jockeyId: o.jockeyId, now, title: `${j?.name ?? "The jockey"} ${went ? `chose ${names.get(went) ?? "another stable"}` : "didn't sign"}: your offer's fee of ${o.fee} cr is back.` });
  }
  const out: WindowResult = { week, closedAt: now.toISOString(), seed, commitment: commitSeed(seed), freeAgents: agents.length, offers: open.length, signings, moves, unmatched, walkouts, refunded };
  await tx.update(jockeyWeeks).set({ window: out }).where(eq(jockeyWeeks.week, week));
  return out;
}

/** Closes any window whose deadline has passed (this week's and, if maintenance missed it, last week's). */
export async function runDueWindowsTx(tx: Tx, now: Date): Promise<WindowResult[]> {
  const w = gc.weekIndex(now.getTime());
  const out: WindowResult[] = [];
  for (const week of [w - 1, w]) {
    if (gc.windowDeadlineMs(week) > now.getTime()) continue;
    const [row] = await tx.select({ windowRanAt: jockeyWeeks.windowRanAt }).from(jockeyWeeks).where(eq(jockeyWeeks.week, week));
    if (!row || row.windowRanAt) continue; // the week's job never ran (no window opened), or it closed already
    const r = await runTransferWindowTx(tx, week, now);
    if (r) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Development
// ---------------------------------------------------------------------------

/**
 * After a settled ride (inside settleJockeyRidesTx): an apprentice who reaches JOCKEY_DEVELOPED_RIDES
 * rides for one stable is "developed at" it; a jockey developed elsewhere who wins a Feature or
 * Final for another stable earns the developer JOCKEY_DEVELOPMENT_BONUS (credits, once per race).
 */
export async function developmentTx(tx: Tx, input: { jockey: JockeyRow; race: RaceRow; horseStableId: string | null; jockeyStableId: string | null; position: number; now: Date }): Promise<number> {
  const { jockey: j, race } = input;
  if (!j.developedByStableId && j.stage === "apprentice" && input.jockeyStableId) {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(jockeyRides).where(and(eq(jockeyRides.jockeyId, j.id), eq(jockeyRides.jockeyStableId, input.jockeyStableId), sql`${jockeyRides.settledAt} is not null`));
    if (Number(r?.n ?? 0) >= gc.JOCKEY_DEVELOPED_RIDES) await tx.update(jockeys).set({ developedByStableId: input.jockeyStableId }).where(eq(jockeys.id, j.id));
  }
  const dev = j.developedByStableId;
  if (!dev || input.position !== 1 || (race.kind !== "feature" && race.kind !== "final") || !input.horseStableId || input.horseStableId === dev) return 0;
  const accountId = await accountIdOfStable(tx, dev);
  const r = await grantCreditsTx(tx, { accountId, amount: gc.JOCKEY_DEVELOPMENT_BONUS, idempotencyKey: `jockey-dev:${race.id}:${j.id}`, kind: "jockey_development_bonus", memo: `${j.name} won the ${race.name}` });
  if (r.duplicate) return 0;
  await note(tx, { stableId: dev, key: `dev:${race.id}:${j.id}`, jockeyId: j.id, now: input.now, title: `${j.name}, developed at your stable, won the ${race.name}: +${gc.JOCKEY_DEVELOPMENT_BONUS} cr development bonus.` });
  return gc.JOCKEY_DEVELOPMENT_BONUS;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ContractView {
  length: gc.JockeyContractLength;
  lengthLabel: string;
  wage: number;
  wageDueThisWeek: number;
  freeWeeksLeft: number;
  promisedRides: number;
  ridesThisWeek: number;
  ridesLastWeek: number | null;
  buyout: number;
  endsWeek: number;
  endsAtMs: number;
  morale: gc.JockeyMorale;
  moraleLabel: string;
  brokenWeeks: number;
  unpaid: boolean;
  wagesPaid: number;
}

export function contractView(c: JockeyContractRow, now: Date, ridesThisWeek: number): ContractView {
  const w = gc.weekIndex(now.getTime());
  const morale = gc.jockeyMorale(c.brokenWeeks);
  return {
    length: c.length as gc.JockeyContractLength,
    lengthLabel: gc.JOCKEY_CONTRACT_LENGTH_LABELS[c.length as gc.JockeyContractLength] ?? c.length,
    wage: c.wage,
    wageDueThisWeek: gc.wageDue(c, w + 1),
    freeWeeksLeft: c.wageFreeUntilWeek !== null ? Math.max(0, c.wageFreeUntilWeek - (w + 1)) : 0,
    promisedRides: c.promisedRides,
    ridesThisWeek,
    ridesLastWeek: c.lastWeekRides,
    buyout: c.buyout,
    endsWeek: c.endsWeek,
    endsAtMs: gc.windowDeadlineMs(c.endsWeek),
    morale,
    moraleLabel: gc.JOCKEY_MORALE_LABELS[morale],
    brokenWeeks: c.brokenWeeks,
    unpaid: c.unpaidWeek !== null,
    wagesPaid: c.wagesPaid,
  };
}

/** Rides this game week so far for each jockey's contract stable. */
export async function ridesThisWeek(ex: Executor, pairs: { jockeyId: string; stableId: string }[], now: Date): Promise<Map<string, number>> {
  const w = gc.weekIndex(now.getTime());
  const m = await ridesFor(ex, pairs, new Date(gc.weekStartMs(w)), new Date(gc.weekStartMs(w + 1)));
  return new Map(pairs.map((p) => [p.jockeyId, m.get(`${p.jockeyId}|${p.stableId}`) ?? 0]));
}

export async function contractsOfStable(ex: Executor, stableId: string, now: Date): Promise<Map<string, ContractView>> {
  const rows = await ex.select().from(jockeyContracts).where(and(eq(jockeyContracts.stableId, stableId), eq(jockeyContracts.status, "active")));
  const rides = await ridesThisWeek(ex, rows.map((c) => ({ jockeyId: c.jockeyId, stableId })), now);
  return new Map(rows.map((c) => [c.jockeyId, contractView(c, now, rides.get(c.jockeyId) ?? 0)]));
}

export interface JockeyMarketInfo {
  contract: (ContractView & { stableId: string }) | null;
  freeAgent: boolean;
  windowWeek: number;
  deadlineMs: number;
  wants: string[];
  developedAt: { stableId: string; name: string } | null;
  /** The viewer's open offer, if any. */
  myOffer: { wage: number; length: gc.JockeyContractLength; promisedRides: number; buyout: number; fee: number } | null;
  openOffers: number;
  offerBlock: string | null;
  bounds: { wage: { min: number; max: number }; buyout: { min: number; max: number; default: number }; ridesMax: number; fee: number; standard: gc.OfferTerms };
}

/** The Phase 2 part of a jockey's page: contract, morale, wants, developed at, the offer form. */
export async function jockeyMarketInfo(ex: Executor, jockeyId: string, viewer: { stableId: string; accountId: string } | null, now: Date): Promise<JockeyMarketInfo | null> {
  const [j] = await ex.select().from(jockeys).where(eq(jockeys.id, jockeyId));
  if (!j) return null;
  const c = await activeContractOf(ex, j.id);
  const rides = c ? ((await ridesThisWeek(ex, [{ jockeyId: j.id, stableId: c.stableId }], now)).get(j.id) ?? 0) : 0;
  const facts = j.stableId ? (await stableFactsTx(ex, [j.stableId], now)).get(j.stableId) : undefined;
  const grade = gradeOfJockey(j);
  const week = currentWindowWeek(now);
  const free = isFreeAgent(j, now);
  const [dev] = j.developedByStableId ? await ex.select({ id: stables.id, name: stables.name }).from(stables).where(eq(stables.id, j.developedByStableId)) : [];
  let myOffer: JockeyMarketInfo["myOffer"] = null;
  let openOffers = 0;
  let offerBlock: string | null = null;
  if (viewer) {
    const [o] = await ex.select().from(jockeyOffers).where(and(eq(jockeyOffers.week, week), eq(jockeyOffers.jockeyId, j.id), eq(jockeyOffers.stableId, viewer.stableId), eq(jockeyOffers.status, "open")));
    if (o) myOffer = { wage: o.wage, length: o.length as gc.JockeyContractLength, promisedRides: o.promisedRides, buyout: o.buyout, fee: o.fee };
    const [n] = await ex.select({ n: sql<number>`count(*)::int` }).from(jockeyOffers).where(and(eq(jockeyOffers.stableId, viewer.stableId), eq(jockeyOffers.status, "open")));
    openOffers = Number(n?.n ?? 0);
    if (!free) offerBlock = null;
    else if (!myOffer && openOffers >= gc.JOCKEY_OPEN_OFFERS_PER_STABLE) offerBlock = `You have ${gc.JOCKEY_OPEN_OFFERS_PER_STABLE} open offers already`;
    else if (j.stableId !== viewer.stableId && (await stayingCount(ex, viewer.stableId, week)) >= gc.JOCKEYS_PER_STABLE_MAX) offerBlock = `You have ${gc.JOCKEYS_PER_STABLE_MAX} jockeys already`;
    else if (j.stableId === viewer.stableId && c && (c.unpaidWeek !== null || c.brokenWeeks >= gc.JOCKEY_BROKEN_PROMISE_WEEKS)) offerBlock = `${firstName(j.name)} won't sign for you again this week`;
  }
  return {
    contract: c ? { ...contractView(c, now, rides), stableId: c.stableId } : null,
    freeAgent: free,
    windowWeek: week,
    deadlineMs: gc.windowDeadlineMs(week),
    wants: gc.jockeyWants(j.personality as gc.JockeyPersonality, grade, { wage: c?.wage ?? null, ridesLastWeek: c?.lastWeekRides ?? rides, stableQuality: facts?.quality ?? null, prestige: facts?.prestige ?? null }),
    developedAt: dev ? { stableId: dev.id, name: dev.name } : null,
    myOffer,
    openOffers,
    offerBlock,
    bounds: { wage: gc.wageBounds(grade), buyout: gc.buyoutBounds(gc.signingFee(grade)), ridesMax: gc.JOCKEY_PROMISED_RIDES_MAX, fee: j.stableId === viewer?.stableId ? 0 : gc.signingFee(grade), standard: standardTerms(j) },
  };
}

export interface TransferWindowView {
  week: number;
  deadlineMs: number;
  commitment: string | null;
  freeAgents: { jockey: JockeyRow; fromStableName: string | null; offers: number; why: string }[];
  myOffers: (JockeyOfferRow & { jockeyName: string })[];
  last: WindowResult | null;
}

/** The transfer window page: this week's free agents, your offers, last week's results. */
export async function transferWindow(ex: Executor, input: { stableId: string | null; now: Date }): Promise<TransferWindowView> {
  const week = currentWindowWeek(input.now);
  const agents = await ex
    .select()
    .from(jockeys)
    .where(and(isNull(jockeys.retiredAt), isNull(jockeys.retirementAnnouncedAt), eq(jockeys.freeAgentWeek, week)))
    .orderBy(asc(jockeys.name));
  const counts = new Map(
    (await ex.select({ jockeyId: jockeyOffers.jockeyId, n: sql<number>`count(*)::int` }).from(jockeyOffers).where(and(eq(jockeyOffers.week, week), eq(jockeyOffers.status, "open"))).groupBy(jockeyOffers.jockeyId)).map((r) => [r.jockeyId, Number(r.n)]),
  );
  const names = new Map((await ex.select({ id: stables.id, name: stables.name }).from(stables).where(inArray(stables.id, [...new Set(agents.map((a) => a.stableId).filter((x): x is string => !!x)), "00000000-0000-0000-0000-000000000000"]))).map((s) => [s.id, s.name]));
  const contracts = new Map<string, JockeyContractRow>();
  if (agents.length) for (const c of await ex.select().from(jockeyContracts).where(and(eq(jockeyContracts.status, "active"), inArray(jockeyContracts.jockeyId, agents.map((a) => a.id))))) contracts.set(c.jockeyId, c);
  const why = (j: JockeyRow) => {
    const c = contracts.get(j.id);
    if (!j.stableId || !c) return j.rides === 0 ? "New apprentice" : "Club freelancer";
    if (c.unpaidWeek !== null) return "Wage unpaid";
    if (c.brokenWeeks >= gc.JOCKEY_BROKEN_PROMISE_WEEKS) return "Wants to leave";
    return "Contract ends";
  };
  const myOffers = input.stableId
    ? await ex
        .select({ o: jockeyOffers, name: jockeys.name })
        .from(jockeyOffers)
        .innerJoin(jockeys, eq(jockeys.id, jockeyOffers.jockeyId))
        .where(and(eq(jockeyOffers.stableId, input.stableId), or(eq(jockeyOffers.week, week), eq(jockeyOffers.week, week - 1))))
        .orderBy(asc(jockeyOffers.createdAt))
    : [];
  const [cur] = await ex.select({ commitment: jockeyWeeks.windowCommitment }).from(jockeyWeeks).where(eq(jockeyWeeks.week, week));
  const [last] = await ex.select({ window: jockeyWeeks.window }).from(jockeyWeeks).where(sql`${jockeyWeeks.windowRanAt} is not null`).orderBy(sql`${jockeyWeeks.week} desc`).limit(1);
  return {
    week,
    deadlineMs: gc.windowDeadlineMs(week),
    commitment: cur?.commitment ?? null,
    freeAgents: agents.map((j) => ({ jockey: j, fromStableName: j.stableId ? (names.get(j.stableId) ?? null) : null, offers: counts.get(j.id) ?? 0, why: why(j) })),
    myOffers: myOffers.map((r) => ({ ...r.o, jockeyName: r.name })),
    last: (last?.window as WindowResult | null) ?? null,
  };
}

/** The stable's latest jockey notes (contract ends, window results, wages, morale, bonuses). */
export async function jockeyNotes(ex: Executor, accountId: string, limit = 5): Promise<{ id: string; title: string; href: string | null; atMs: number }[]> {
  const rows = await ex
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, JOCKEY_NOTE)))
    .orderBy(sql`${inboxItems.createdAt} desc`)
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, href: ((r.data ?? {}) as { href?: string }).href ?? null, atMs: r.createdAt.getTime() }));
}
