/**
 * Jockeys (docs/design/jockeys.md, Phase 1: roster and riding; rules in game-core jockeys.ts).
 *
 *   stable creation / backfill → an apprentice for every stable; a starting Club freelance pool
 *   enterRace → bookRideTx: one of the stable's own jockeys (free) or a Club freelancer (fee, burned)
 *   lockFieldTx → assignFieldJockeysTx: who rides each runner is frozen into the field (name, kit,
 *       apprentice claim), house runners get a Club freelancer from the race seed; ride rows written
 *   settleRace → settleJockeyRidesTx: rides/wins, experience and growth, once (same transaction)
 *   runMaintenance → runJockeyMaintenance: stages, retirement notices and retirements, idle-stable
 *       releases; once a game week: veteran decline and the apprentice intake (pool ≈ 1.5 per active stable)
 *
 * Phase 1 has no contracts or wages: a stable keeps its own apprentice, may sign an unsigned
 * freelancer for a one-off signing fee (burned) while it holds fewer than JOCKEYS_PER_STABLE_MAX,
 * and may release a jockey back to the Club pool. Credits only, never USDG.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { gc } from "../gameCore";
import { fraudEvents, jockeyEvents, jockeyRides, jockeyWeeks, jockeys, stables, type JockeyRow, type RaceRow } from "../schema";
import type { Db, Executor, Tx } from "../types";
import { accountIdOfStable, areLinked, lockStableOf } from "./accounts";
import { spendCreditsTx } from "./ledger";
import { audit, runTx } from "./tx";
import { jockeyEventNewsTx } from "./news";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Smallest starting Club pool, whatever the number of active stables. */
export const JOCKEY_STARTING_POOL_MIN = 12;
/** A stable's jockey released this recently can't be signed by a linked account. */
export const JOCKEY_LINKED_SIGN_DAYS = 14;
/**
 * Skills of an unnamed rider: a Club runner when no freelancer is free, and the old journeyman /
 * top-jockey tiers on entries stored before jockeys existed (they paid for those).
 */
export const UNNAMED_RIDER_SKILLS = {
  club: { gate: 400, pace: 400, finish: 400, handling: 400 },
  journeyman: { gate: 500, pace: 500, finish: 500, handling: 500 },
  top: { gate: 850, pace: 850, finish: 850, handling: 850 },
} as const satisfies Record<string, gc.JockeySkills>;

export function skillsOf(j: Pick<JockeyRow, "skills">): gc.JockeySkills {
  const s = (j.skills ?? {}) as Partial<gc.JockeySkills>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1000, Math.floor(v))) : 0);
  return { gate: n(s.gate), pace: n(s.pace), finish: n(s.finish), handling: n(s.handling) };
}

export function potentialOf(j: Pick<JockeyRow, "potential">): gc.JockeySkills {
  return skillsOf({ skills: j.potential });
}

export function gradeOfJockey(j: Pick<JockeyRow, "skills">): gc.JockeyGrade {
  return gc.jockeyGrade(skillsOf(j));
}

// ---------------------------------------------------------------------------
// Creation, backfill
// ---------------------------------------------------------------------------

async function event(ex: Executor, e: { key: string; jockeyId: string; kind: "debut" | "signed" | "released" | "retirement_announced" | "retired"; stableId: string | null; at: Date; data?: Record<string, unknown> }): Promise<void> {
  await ex
    .insert(jockeyEvents)
    .values({ key: e.key, jockeyId: e.jockeyId, kind: e.kind, stableId: e.stableId, at: e.at, data: e.data ?? {} })
    .onConflictDoNothing();
  await jockeyEventNewsTx(ex, e);
}

/** Inserts a jockey drawn from `seed`: a new apprentice, or (weeksIn > 0) a seasoned rider for the starting pool. */
export async function createJockeyTx(ex: Executor, input: { seed: string; stableId: string | null; now: Date; weeksIn?: number }): Promise<JockeyRow> {
  const weeksIn = Math.max(0, input.weeksIn ?? 0);
  const p = weeksIn > 0 ? gc.generateSeasonedJockey(input.seed, weeksIn) : { ...gc.generateApprentice(input.seed), rides: 0, wins: 0, experience: 0 };
  const bornMs = input.now.getTime() - weeksIn * WEEK_MS;
  const [row] = await ex
    .insert(jockeys)
    .values({
      name: p.name,
      seed: input.seed,
      bornAt: new Date(bornMs),
      stage: gc.jockeyStageAt(bornMs, input.now.getTime()),
      personality: p.personality,
      skills: p.skills,
      potential: p.potential,
      experience: p.experience,
      rides: p.rides,
      wins: p.wins,
      stableId: input.stableId,
      joinedAt: input.stableId ? input.now : null,
      retireAt: new Date(gc.jockeyRetireAt(bornMs, input.seed)),
      createdAt: input.now,
    })
    .returning();
  await event(ex, { key: `debut:${row!.id}`, jockeyId: row!.id, kind: "debut", stableId: input.stableId, at: input.now });
  return row!;
}

/** Jockeys a stable holds now (not retired). */
export async function heldCount(ex: Executor, stableId: string): Promise<number> {
  const [r] = await ex.select({ n: sql<number>`count(*)::int` }).from(jockeys).where(and(eq(jockeys.stableId, stableId), isNull(jockeys.retiredAt)));
  return Number(r?.n ?? 0);
}

/**
 * Every stable starts with one apprentice: given once per stable (keyed on its debut event), at
 * creation or by the backfill for stables made before jockeys existed. Never past the cap.
 */
export async function ensureStableApprenticeTx(ex: Executor, stableId: string, now: Date): Promise<JockeyRow | null> {
  const [had] = await ex
    .select({ id: jockeyEvents.id })
    .from(jockeyEvents)
    .where(and(eq(jockeyEvents.stableId, stableId), eq(jockeyEvents.kind, "debut")))
    .limit(1);
  if (had) return null;
  if (!gc.canHoldAnother(await heldCount(ex, stableId))) return null;
  return createJockeyTx(ex, { seed: gc.seedFrom("jockey-apprentice", stableId), stableId, now });
}

/** Stables that raced or were seen within JOCKEY_ACTIVE_STABLE_DAYS. */
export async function activeStableIds(ex: Executor, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - gc.JOCKEY_ACTIVE_STABLE_DAYS * DAY_MS);
  const rows = (await ex.execute(sql`
    select s.id from stables s join accounts a on a.id = s.account_id
    where a.last_seen_at >= ${since}
       or exists (select 1 from race_entries e where e.stable_id = s.id and e.created_at >= ${since})
  `)) as unknown as { rows?: { id: string }[] } | { id: string }[];
  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return list.map((r) => r.id);
}

/** Jockeys not yet retired (the pool the supply rule counts). */
export async function poolSize(ex: Executor): Promise<number> {
  const [r] = await ex.select({ n: sql<number>`count(*)::int` }).from(jockeys).where(isNull(jockeys.retiredAt));
  return Number(r?.n ?? 0);
}

/**
 * Backfill (idempotent): an apprentice for every stable that never had one, and, the first time,
 * a starting Club freelance pool of seasoned riders spread over every career stage, sized so the
 * whole pool reaches the target (at least JOCKEY_STARTING_POOL_MIN freelancers).
 */
export async function ensureJockeyBackfill(db: Db, now: Date): Promise<{ apprentices: number; freelancers: number }> {
  return runTx(db, async (tx) => {
    // One backfill at a time (concurrent instances): a transaction-scoped advisory lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jockeys-backfill'))`);
    let apprentices = 0;
    const missing = await tx
      .select({ id: stables.id })
      .from(stables)
      .where(sql`not exists (select 1 from jockey_events e where e.stable_id = ${stables.id} and e.kind = 'debut')`)
      .orderBy(asc(stables.createdAt), asc(stables.id));
    for (const s of missing) if (await ensureStableApprenticeTx(tx, s.id, now)) apprentices++;
    let freelancers = 0;
    const [anyClub] = await tx
      .select({ id: jockeyEvents.id })
      .from(jockeyEvents)
      .where(and(eq(jockeyEvents.kind, "debut"), isNull(jockeyEvents.stableId)))
      .limit(1);
    if (!anyClub) {
      const target = gc.jockeyPoolTarget((await activeStableIds(tx, now)).length);
      const n = Math.max(JOCKEY_STARTING_POOL_MIN, target - (await poolSize(tx)));
      const longest = gc.JOCKEY_CAREER_WEEKS.apprentice + gc.JOCKEY_CAREER_WEEKS.prime + gc.JOCKEY_CAREER_WEEKS.veteranMin - gc.JOCKEY_RETIREMENT_NOTICE_WEEKS - 1;
      for (let i = 0; i < n; i++) {
        // Spread over the career (most in their prime), never already due to retire.
        const weeksIn = 1 + Math.floor((i * longest) / Math.max(1, n));
        await createJockeyTx(tx, { seed: gc.seedFrom("jockey-pool", now.getTime(), i), stableId: null, now, weeksIn });
        freelancers++;
      }
    }
    return { apprentices, freelancers };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface JockeyView {
  id: string;
  name: string;
  stage: gc.JockeyStage;
  personality: gc.JockeyPersonality;
  grade: gc.JockeyGrade;
  overall: number;
  skills: gc.JockeySkills;
  /** Potential range per skill and overall (narrows with rides; the true potential is never shown). */
  potential: Record<gc.JockeySkill | "overall", { lo: number; hi: number; label: string }>;
  rides: number;
  wins: number;
  claimLb: number;
  stableId: string | null;
  stableName: string | null;
  silks: unknown;
  retireAt: string;
  retirementAnnounced: boolean;
  retired: boolean;
  seed: string;
}

export function jockeyView(j: JockeyRow, stable?: { name: string; silks: unknown } | null): JockeyView {
  const skills = skillsOf(j);
  const pot = potentialOf(j);
  const range = (k: gc.JockeySkill | "overall") => {
    const real = k === "overall" ? gc.jockeyOverall(skills) : skills[k];
    const p = k === "overall" ? gc.jockeyOverall(pot) : pot[k];
    const r = gc.potentialRange(real, p, j.rides, j.seed, k);
    return { lo: r.lo, hi: r.hi, label: gc.potentialLabel(r) };
  };
  return {
    id: j.id,
    name: j.name,
    stage: j.stage as gc.JockeyStage,
    personality: j.personality as gc.JockeyPersonality,
    grade: gc.jockeyGrade(skills),
    overall: gc.jockeyOverall(skills),
    skills,
    potential: { gate: range("gate"), pace: range("pace"), finish: range("finish"), handling: range("handling"), overall: range("overall") },
    rides: j.rides,
    wins: j.wins,
    claimLb: gc.apprenticeClaimLb(j.wins),
    stableId: j.stableId,
    stableName: stable?.name ?? null,
    silks: stable?.silks ?? null,
    retireAt: j.retireAt.toISOString(),
    retirementAnnounced: j.retirementAnnouncedAt !== null,
    retired: j.retiredAt !== null,
    seed: j.seed,
  };
}

async function withStables(ex: Executor, rows: JockeyRow[]): Promise<JockeyView[]> {
  const ids = [...new Set(rows.map((r) => r.stableId).filter((x): x is string => !!x))];
  const st = ids.length ? await ex.select({ id: stables.id, name: stables.name, silks: stables.silks }).from(stables).where(inArray(stables.id, ids)) : [];
  const byId = new Map(st.map((s) => [s.id, s]));
  return rows.map((r) => jockeyView(r, r.stableId ? byId.get(r.stableId) : null));
}

export type JockeyFilter = "all" | "freelancers" | "prospects" | "mine";

/** Active jockeys (not retired), best first. Prospects: apprentices whose potential range reaches B or better. */
export async function listJockeys(ex: Executor, input: { filter?: JockeyFilter; stableId?: string | null; limit?: number } = {}): Promise<JockeyView[]> {
  const f = input.filter ?? "all";
  const where = [isNull(jockeys.retiredAt)];
  if (f === "freelancers") where.push(isNull(jockeys.stableId));
  if (f === "mine") where.push(input.stableId ? eq(jockeys.stableId, input.stableId) : sql`false`);
  if (f === "prospects") where.push(eq(jockeys.stage, "apprentice"));
  const rows = await ex.select().from(jockeys).where(and(...where)).orderBy(desc(jockeys.wins), asc(jockeys.name)).limit(input.limit ?? 500);
  let views = await withStables(ex, rows);
  if (f === "prospects") views = views.filter((v) => v.potential.overall.hi >= 600);
  return views.sort((a, b) => b.overall - a.overall || b.wins - a.wins || a.name.localeCompare(b.name));
}

export async function getJockey(ex: Executor, id: string): Promise<JockeyView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await ex.select().from(jockeys).where(eq(jockeys.id, id));
  return row ? (await withStables(ex, [row]))[0]! : null;
}

export async function stableJockeys(ex: Executor, stableId: string): Promise<JockeyView[]> {
  return listJockeys(ex, { filter: "mine", stableId });
}

/** Winners between two times (a season), most first: the jockeys' leaderboard. */
export async function jockeyLeaderboard(ex: Executor, input: { from: Date; to: Date; limit?: number }): Promise<{ jockey: JockeyView; wins: number; rides: number }[]> {
  const rows = await ex
    .select({ jockeyId: jockeyRides.jockeyId, wins: sql<number>`count(*) filter (where ${jockeyRides.position} = 1)::int`, rides: sql<number>`count(*)::int` })
    .from(jockeyRides)
    .where(and(isNotNull(jockeyRides.settledAt), gte(jockeyRides.postTime, input.from), lte(jockeyRides.postTime, input.to)))
    .groupBy(jockeyRides.jockeyId)
    .orderBy(desc(sql`count(*) filter (where ${jockeyRides.position} = 1)`), desc(sql`count(*)`))
    .limit(input.limit ?? 20);
  if (!rows.length) return [];
  const js = await ex.select().from(jockeys).where(inArray(jockeys.id, rows.map((r) => r.jockeyId)));
  const views = new Map((await withStables(ex, js)).map((v) => [v.id, v]));
  return rows.flatMap((r) => (views.get(r.jockeyId) ? [{ jockey: views.get(r.jockeyId)!, wins: Number(r.wins), rides: Number(r.rides) }] : []));
}

/** Season winners per jockey (for the list page's "wins this season" column). */
export async function jockeyWinsBetween(ex: Executor, from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await ex
    .select({ jockeyId: jockeyRides.jockeyId, wins: sql<number>`count(*)::int` })
    .from(jockeyRides)
    .where(and(eq(jockeyRides.position, 1), gte(jockeyRides.postTime, from), lte(jockeyRides.postTime, to)))
    .groupBy(jockeyRides.jockeyId);
  return new Map(rows.map((r) => [r.jockeyId, Number(r.wins)]));
}

/** Career path: debut, signings, releases, retirement (oldest first), with stable names. */
export async function jockeyCareer(ex: Executor, jockeyId: string) {
  return ex
    .select({ kind: jockeyEvents.kind, at: jockeyEvents.at, stableId: jockeyEvents.stableId, stableName: stables.name, data: jockeyEvents.data })
    .from(jockeyEvents)
    .leftJoin(stables, eq(stables.id, jockeyEvents.stableId))
    .where(eq(jockeyEvents.jockeyId, jockeyId))
    .orderBy(asc(jockeyEvents.at), sql`case ${jockeyEvents.kind} when 'debut' then 0 when 'signed' then 1 when 'released' then 2 when 'retirement_announced' then 3 else 4 end`);
}

/** Recent rides with race and horse names (newest first). */
export async function jockeyRecentRides(ex: Executor, jockeyId: string, limit = 20) {
  const rows = await ex.execute(sql`
    select r.race_id as "raceId", r.horse_id as "horseId", r.position, r.claim_lb as "claimLb", r.post_time as "postTime",
           ra.name as "raceName", ra.status as "raceStatus", h.name as "horseName", s.name as "stableName"
    from jockey_rides r
    join races ra on ra.id = r.race_id
    join horses h on h.id = r.horse_id
    left join stables s on s.id = r.stable_id
    where r.jockey_id = ${jockeyId}
    order by r.post_time desc
    limit ${limit}
  `);
  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as {
    raceId: string;
    horseId: string;
    position: number | null;
    claimLb: number;
    postTime: string | Date;
    raceName: string;
    raceStatus: string;
    horseName: string;
    stableName: string | null;
  }[];
  return list.map((r) => ({ ...r, postTime: new Date(r.postTime).toISOString() }));
}

// ---------------------------------------------------------------------------
// Signing and release
// ---------------------------------------------------------------------------

async function lockJockey(tx: Tx, id: string): Promise<JockeyRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("NOT_FOUND", "no such jockey");
  const [j] = await tx.select().from(jockeys).where(eq(jockeys.id, id)).for("update");
  if (!j) throw new DomainError("NOT_FOUND", "no such jockey");
  return j;
}

/**
 * Sign an unsigned Club freelancer (Phase 1: a one-off signing fee by grade, burned). Refused at
 * the cap, for a retiring or retired jockey, and (like the market) when a linked account let them
 * go within JOCKEY_LINKED_SIGN_DAYS.
 */
export async function signJockey(db: Db, input: { accountId: string; jockeyId: string; now: Date }): Promise<{ jockey: JockeyView; fee: number }> {
  return runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const j = await lockJockey(tx, input.jockeyId);
    if (j.stableId === stable.id) return { jockey: jockeyView(j, stable), fee: 0 };
    if (j.retiredAt || j.retirementAnnouncedAt) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} is retiring`);
    if (j.stableId) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} rides for another stable`);
    if (!gc.canHoldAnother(await heldCount(tx, stable.id))) throw new DomainError("JOCKEY_LIMIT", `a stable can hold at most ${gc.JOCKEYS_PER_STABLE_MAX} jockeys`);
    if (j.lastStableId && j.releasedAt && input.now.getTime() - j.releasedAt.getTime() < JOCKEY_LINKED_SIGN_DAYS * DAY_MS && j.lastStableId !== stable.id) {
      const other = await accountIdOfStable(tx, j.lastStableId);
      if (await areLinked(tx, input.accountId, other)) {
        await tx.insert(fraudEvents).values({ accountId: input.accountId, relatedAccountId: other, kind: "linked_trade_blocked", severity: 2, data: { jockeyId: j.id } });
        throw new DomainError("LINKED_ACCOUNTS", "signing a jockey from a linked account is not allowed");
      }
    }
    const fee = gc.signingFee(gradeOfJockey(j));
    await spendCreditsTx(tx, { accountId: input.accountId, amount: fee, idempotencyKey: `jockey-sign:${j.id}:${stable.id}:${input.now.getTime()}`, kind: "jockey_signing", memo: j.name });
    const [row] = await tx.update(jockeys).set({ stableId: stable.id, joinedAt: input.now }).where(eq(jockeys.id, j.id)).returning();
    await event(tx, { key: `signed:${j.id}:${input.now.getTime()}`, jockeyId: j.id, kind: "signed", stableId: stable.id, at: input.now, data: { fee } });
    await audit(tx, { actor: input.accountId, action: "jockey.sign", entityType: "jockey", entityId: j.id, data: { stableId: stable.id, fee } });
    return { jockey: jockeyView(row!, stable), fee };
  });
}

async function releaseTx(tx: Tx, j: JockeyRow, now: Date, why: "released" | "idle"): Promise<void> {
  if (!j.stableId) return;
  await tx.update(jockeys).set({ stableId: null, joinedAt: null, lastStableId: j.stableId, releasedAt: now }).where(eq(jockeys.id, j.id));
  await event(tx, { key: `released:${j.id}:${now.getTime()}`, jockeyId: j.id, kind: "released", stableId: j.stableId, at: now, data: { why } });
}

/** Release one of your jockeys back to the Club pool (rides already booked still go ahead). */
export async function releaseJockey(db: Db, input: { accountId: string; jockeyId: string; now: Date }): Promise<void> {
  await runTx(db, async (tx) => {
    const stable = await lockStableOf(tx, input.accountId);
    const j = await lockJockey(tx, input.jockeyId);
    if (j.stableId !== stable.id) throw new DomainError("NOT_OWNER", "not your jockey");
    await releaseTx(tx, j, input.now, "released");
    await audit(tx, { actor: input.accountId, action: "jockey.release", entityType: "jockey", entityId: j.id, data: { stableId: stable.id } });
  });
}

// ---------------------------------------------------------------------------
// Booking (enterRace) and clashes
// ---------------------------------------------------------------------------

/** Is the jockey already booked or riding within JOCKEY_CLASH_MS of `postTime` (any race but `exceptRaceId`)? */
export async function jockeyBusyTx(ex: Executor, jockeyId: string, postTime: Date, exceptRaceId?: string): Promise<boolean> {
  return (await busyJockeysTx(ex, [jockeyId], postTime, exceptRaceId)).has(jockeyId);
}

/** The jockeys among `ids` (all when null) booked or riding within JOCKEY_CLASH_MS of `postTime`. */
async function busyJockeysTx(ex: Executor, ids: string[] | null, postTime: Date, exceptRaceId?: string): Promise<Set<string>> {
  if (ids && !ids.length) return new Set();
  const lo = new Date(postTime.getTime() - gc.JOCKEY_CLASH_MS + 1);
  const hi = new Date(postTime.getTime() + gc.JOCKEY_CLASH_MS - 1);
  const except = exceptRaceId ?? "00000000-0000-0000-0000-000000000000";
  const idFilter = ids ? sql`and x.jockey_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const res = await ex.execute(sql`
    select distinct x.jockey_id as id from (
      select e.jockey_id, r.post_time, r.id as race_id from race_entries e join races r on r.id = e.race_id
        where e.jockey_id is not null and e.status = 'entered' and r.status in ('open', 'locked')
      union all
      select jr.jockey_id, jr.post_time, jr.race_id from jockey_rides jr join races r2 on r2.id = jr.race_id where r2.status <> 'cancelled'
    ) x
    where x.post_time between ${lo} and ${hi} and x.race_id <> ${except} ${idFilter}
  `);
  const list = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as { id: string }[];
  return new Set(list.map((r) => r.id));
}

/** Jockeys booked on entries of this race (any stable). */
async function bookedInRaceTx(ex: Executor, raceId: string): Promise<Set<string>> {
  const res = await ex.execute(sql`select jockey_id as id from race_entries where race_id = ${raceId} and jockey_id is not null and status = 'entered'`);
  const list = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as { id: string }[];
  return new Set(list.map((r) => r.id));
}

export interface Booking {
  jockeyId: string | null;
  fee: number;
  /** The jockey's grade when booked as a freelancer (ledger memo). */
  grade?: gc.JockeyGrade;
  name?: string;
}

/**
 * The jockey for a new Live entry (inside enterRace's transaction, after its checks):
 *   - `jockeyId` given: the stable's own (free) or a Club freelancer (fee by grade and purse);
 *   - no id, an old paid tier ("journeyman" / "top"): a free freelancer of matching grade (C / A,
 *     else the nearest), charged as that freelancer;
 *   - no id otherwise: the stable's best own jockey who is free then, else none yet (the lock
 *     assigns one: own if free by then, else a Club freelancer at no charge).
 * Refused: another stable's jockey, a retired one, one already booked in this race or within
 * JOCKEY_CLASH_MS of it.
 */
export async function bookRideTx(tx: Tx, input: { stableId: string; race: RaceRow; choice: gc.RaceDayChoice }): Promise<Booking> {
  const { race, choice } = input;
  const inRace = await bookedInRaceTx(tx, race.id);
  if (choice.jockeyId) {
    const j = await lockJockey(tx, choice.jockeyId);
    if (j.retiredAt) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} has retired`);
    if (j.stableId && j.stableId !== input.stableId) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} rides for another stable`);
    if (inRace.has(j.id)) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} already has a ride in this race`);
    if (await jockeyBusyTx(tx, j.id, race.postTime, race.id)) throw new DomainError("JOCKEY_UNAVAILABLE", `${j.name} is booked for another race within ${gc.JOCKEY_CLASH_MS / 60_000} minutes`);
    if (j.stableId === input.stableId) return { jockeyId: j.id, fee: 0, name: j.name };
    const grade = gradeOfJockey(j);
    return { jockeyId: j.id, fee: gc.freelanceFee(grade, race.purse), grade, name: j.name };
  }
  if (choice.jockey === "journeyman" || choice.jockey === "top") {
    const want: gc.JockeyGrade = choice.jockey === "top" ? "A" : "C";
    const free = await freeJockeysTx(tx, { stableIds: [], race, exclude: inRace, freelancers: true });
    const order = gc.JOCKEY_GRADES;
    const dist = (g: gc.JockeyGrade) => Math.abs(order.indexOf(g) - order.indexOf(want));
    const pick = free.sort((a, b) => dist(gradeOfJockey(a)) - dist(gradeOfJockey(b)) || gc.jockeyOverall(skillsOf(b)) - gc.jockeyOverall(skillsOf(a)) || (a.id < b.id ? -1 : 1))[0];
    if (!pick) return { jockeyId: null, fee: 0 };
    await lockJockey(tx, pick.id);
    const grade = gradeOfJockey(pick);
    return { jockeyId: pick.id, fee: gc.freelanceFee(grade, race.purse), grade, name: pick.name };
  }
  const own = await freeJockeysTx(tx, { stableIds: [input.stableId], race, exclude: inRace, freelancers: false });
  const best = own.sort((a, b) => gc.jockeyOverall(skillsOf(b)) - gc.jockeyOverall(skillsOf(a)) || (a.id < b.id ? -1 : 1))[0];
  return best ? { jockeyId: best.id, fee: 0, name: best.name } : { jockeyId: null, fee: 0 };
}

/** Unretired jockeys of these stables (and/or Club freelancers) free at the race's post time. */
async function freeJockeysTx(tx: Tx, input: { stableIds: string[]; race: Pick<RaceRow, "id" | "postTime">; exclude: Set<string>; freelancers: boolean }): Promise<JockeyRow[]> {
  const who = [];
  if (input.stableIds.length) who.push(inArray(jockeys.stableId, input.stableIds));
  if (input.freelancers) who.push(isNull(jockeys.stableId));
  if (!who.length) return [];
  const rows = await tx.select().from(jockeys).where(and(isNull(jockeys.retiredAt), or(...who)));
  const busy = await busyJockeysTx(tx, rows.map((r) => r.id), input.race.postTime, input.race.id);
  return rows.filter((r) => !busy.has(r.id) && !input.exclude.has(r.id));
}

// ---------------------------------------------------------------------------
// The lock: who rides each runner (frozen into the field)
// ---------------------------------------------------------------------------

export interface FieldJockey {
  /** Null for an unnamed rider (no free freelancer, or an old-tier entry). */
  id: string | null;
  name: string;
  skills: gc.JockeySkills;
  /** Apprentice allowance (lb) taken off a handicap weight. */
  claimLb: number;
  /** The jockey's own stable at the lock (null = a freelancer). */
  stableId: string | null;
  /** Freelance fee this ride was booked for (0 = own jockey, Club runner, or assigned at the lock). */
  fee: number;
}

export interface FieldJockeyRunner {
  horseId: string;
  stableId: string | null;
  isHouse: boolean;
  /** The jockey booked on the entry. */
  jockeyId: string | null;
  /** An old-tier choice on an entry stored before jockeys ("journeyman" / "top"), without a jockey id. */
  legacyTier: gc.JockeyKey | null;
  fee: number;
}

const UNNAMED_NAMES = { club: "Club rider", journeyman: "Journeyman", top: "Top jockey" } as const;

function fieldJockeyOf(j: JockeyRow, fee: number): FieldJockey {
  return { id: j.id, name: j.name, skills: skillsOf(j), claimLb: gc.apprenticeClaimLb(j.wins), stableId: j.stableId, fee };
}

/**
 * Assigns a jockey to every runner of a Live field being locked (inside lockFieldTx). Players'
 * booked jockeys ride as booked; an entry with none gets its stable's best free jockey, else a
 * Club freelancer; old-tier entries ride an unnamed rider of that tier; Club runners get a free
 * Club freelancer drawn from the race seed (rows locked SKIP LOCKED, so two races locking at once
 * never share one), else an unnamed Club rider. Each jockey rides at most one horse in the race.
 */
export async function assignFieldJockeysTx(tx: Tx, race: RaceRow, runners: readonly FieldJockeyRunner[]): Promise<Map<string, FieldJockey>> {
  const out = new Map<string, FieldJockey>();
  const used = new Set<string>();
  // Booked rides first.
  const booked = runners.filter((r) => r.jockeyId);
  if (booked.length) {
    const rows = await tx.select().from(jockeys).where(inArray(jockeys.id, booked.map((r) => r.jockeyId!)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of booked) {
      const j = byId.get(r.jockeyId!);
      if (!j || used.has(j.id)) continue;
      used.add(j.id);
      out.set(r.horseId, fieldJockeyOf(j, r.fee));
    }
  }
  for (const r of runners) {
    if (out.has(r.horseId) || !r.legacyTier || r.legacyTier === "apprentice") continue;
    out.set(r.horseId, { id: null, name: UNNAMED_NAMES[r.legacyTier], skills: UNNAMED_RIDER_SKILLS[r.legacyTier], claimLb: 0, stableId: null, fee: 0 });
  }
  // Players' entries with no booking: their stable's best free jockey.
  const unbooked = runners.filter((r) => !out.has(r.horseId) && !r.isHouse);
  const stableIds = [...new Set(unbooked.map((r) => r.stableId).filter((x): x is string => !!x))];
  if (stableIds.length) {
    const own = await freeJockeysTx(tx, { stableIds, race, exclude: used, freelancers: false });
    for (const r of unbooked) {
      const best = own
        .filter((j) => j.stableId === r.stableId && !used.has(j.id))
        .sort((a, b) => gc.jockeyOverall(skillsOf(b)) - gc.jockeyOverall(skillsOf(a)) || (a.id < b.id ? -1 : 1))[0];
      if (!best) continue;
      used.add(best.id);
      out.set(r.horseId, fieldJockeyOf(best, 0));
    }
  }
  // Everyone else: a free Club freelancer, in an order drawn from the race seed.
  const rest = runners.filter((r) => !out.has(r.horseId)).sort((a, b) => (a.horseId < b.horseId ? -1 : 1));
  if (rest.length) {
    const candidates = await tx
      .select()
      .from(jockeys)
      .where(and(isNull(jockeys.retiredAt), isNull(jockeys.stableId)))
      .orderBy(sql`md5(${jockeys.id}::text || ${race.seed})`)
      .for("update", { skipLocked: true });
    const busy = await busyJockeysTx(tx, candidates.map((c) => c.id), race.postTime, race.id);
    const free = candidates.filter((c) => !busy.has(c.id) && !used.has(c.id));
    for (const r of rest) {
      const j = free.shift();
      if (j) {
        used.add(j.id);
        out.set(r.horseId, fieldJockeyOf(j, 0));
      } else {
        out.set(r.horseId, { id: null, name: UNNAMED_NAMES.club, skills: UNNAMED_RIDER_SKILLS.club, claimLb: 0, stableId: null, fee: 0 });
      }
    }
  }
  return out;
}

/** Writes the ride rows for a locked field (who rode which horse). Idempotent per (race, horse). */
export async function recordRidesTx(tx: Tx, race: RaceRow, rides: readonly { horseId: string; stableId: string | null; jockey: FieldJockey }[]): Promise<void> {
  for (const r of rides) {
    if (!r.jockey.id) continue;
    await tx
      .insert(jockeyRides)
      .values({ jockeyId: r.jockey.id, raceId: race.id, horseId: r.horseId, stableId: r.stableId, jockeyStableId: r.jockey.stableId, postTime: race.postTime, claimLb: r.jockey.claimLb, fee: r.jockey.fee })
      .onConflictDoNothing();
  }
}

/**
 * After settlement (inside settleRace's transaction, which runs once): each ride's result, the
 * jockey's rides and wins, experience (bigger, stronger races teach more) and skill growth.
 */
export async function settleJockeyRidesTx(tx: Tx, race: RaceRow, positions: ReadonlyMap<string, number>, fieldMeanOr: number, now: Date): Promise<number> {
  const rides = await tx.select().from(jockeyRides).where(and(eq(jockeyRides.raceId, race.id), isNull(jockeyRides.settledAt)));
  const xp = gc.rideExperience({ purse: race.purse, fieldMeanOr });
  for (const r of [...rides].sort((a, b) => (a.jockeyId < b.jockeyId ? -1 : 1))) {
    const pos = positions.get(r.horseId);
    if (pos === undefined) continue;
    const j = await lockJockey(tx, r.jockeyId);
    const skills = gc.growSkills(skillsOf(j), potentialOf(j), xp);
    await tx.update(jockeyRides).set({ position: pos, experience: xp, settledAt: now }).where(eq(jockeyRides.id, r.id));
    await tx
      .update(jockeys)
      .set({ rides: j.rides + 1, wins: j.wins + (pos === 1 ? 1 : 0), experience: j.experience + xp, skills })
      .where(eq(jockeys.id, j.id));
  }
  return rides.length;
}

/** A race abandoned after its lock: its unsettled rides never happened. */
export async function cancelJockeyRidesTx(tx: Tx, raceId: string): Promise<void> {
  await tx.delete(jockeyRides).where(and(eq(jockeyRides.raceId, raceId), isNull(jockeyRides.settledAt)));
}

// ---------------------------------------------------------------------------
// Maintenance: ageing, retirement, idle stables, the weekly intake
// ---------------------------------------------------------------------------

export interface JockeyMaintenance {
  backfill: { apprentices: number; freelancers: number };
  staged: number;
  announced: number;
  retired: number;
  released: number;
  /** Set when this run did the week's jobs. */
  week: { week: number; declined: number; intake: number; active: number; pool: number; target: number } | null;
}

/**
 * Idempotent; safe to call on every maintenance run. Stage changes, retirement notices
 * (JOCKEY_RETIREMENT_NOTICE_WEEKS ahead) and retirements happen as they fall due; a stable idle
 * JOCKEY_IDLE_RELEASE_DAYS lets its jockeys go; once per game week veterans decline and new
 * apprentices join to hold the pool at JOCKEY_POOL_PER_ACTIVE_STABLE per active stable.
 */
export async function runJockeyMaintenance(db: Db, now: Date): Promise<JockeyMaintenance> {
  const backfill = await ensureJockeyBackfill(db, now);
  return runTx(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jockeys-maintenance'))`);
    const t = now.getTime();
    // Only jockeys with something due: retirement, its notice, or a stage change.
    const W = WEEK_MS;
    const c = gc.JOCKEY_CAREER_WEEKS;
    const live = await tx
      .select()
      .from(jockeys)
      .where(
        and(
          isNull(jockeys.retiredAt),
          or(
            lte(jockeys.retireAt, new Date(t + gc.JOCKEY_RETIREMENT_NOTICE_WEEKS * W)),
            and(eq(jockeys.stage, "apprentice"), lte(jockeys.bornAt, new Date(t - c.apprentice * W))),
            and(sql`${jockeys.stage} <> 'veteran'`, lte(jockeys.bornAt, new Date(t - (c.apprentice + c.prime) * W))),
          ),
        ),
      )
      .for("update");
    let staged = 0;
    let announced = 0;
    let retired = 0;
    for (const j of live) {
      if (j.retireAt.getTime() <= t) {
        // Retired: leaves its stable for good.
        await tx.update(jockeys).set({ retiredAt: now, stableId: null, joinedAt: null, lastStableId: j.stableId ?? j.lastStableId, retirementAnnouncedAt: j.retirementAnnouncedAt ?? now }).where(eq(jockeys.id, j.id));
        await event(tx, { key: `retired:${j.id}`, jockeyId: j.id, kind: "retired", stableId: j.stableId, at: now, data: { rides: j.rides, wins: j.wins } });
        retired++;
        continue;
      }
      const stage = gc.jockeyStageAt(j.bornAt.getTime(), t);
      const patch: Partial<JockeyRow> = {};
      if (stage !== j.stage) {
        patch.stage = stage;
        staged++;
      }
      if (!j.retirementAnnouncedAt && gc.retirementAnnouncedAt(j.retireAt.getTime()) <= t) {
        patch.retirementAnnouncedAt = now;
        await event(tx, { key: `retirement_announced:${j.id}`, jockeyId: j.id, kind: "retirement_announced", stableId: j.stableId, at: now, data: { retireAt: j.retireAt.toISOString() } });
        announced++;
      }
      if (Object.keys(patch).length) await tx.update(jockeys).set(patch).where(eq(jockeys.id, j.id));
    }
    // Idle stables (no race entry and not seen for JOCKEY_IDLE_RELEASE_DAYS) release their jockeys.
    const idleSince = new Date(t - gc.JOCKEY_IDLE_RELEASE_DAYS * DAY_MS);
    const idle = await tx.execute(sql`
      select j.id from jockeys j join stables s on s.id = j.stable_id join accounts a on a.id = s.account_id
      where j.retired_at is null and a.last_seen_at < ${idleSince} and s.created_at < ${idleSince}
        and not exists (select 1 from race_entries e where e.stable_id = s.id and e.created_at >= ${idleSince})
    `);
    const idleIds = ((Array.isArray(idle) ? idle : ((idle as { rows?: unknown[] }).rows ?? [])) as { id: string }[]).map((r) => r.id);
    let released = 0;
    for (const id of idleIds) {
      const [j] = await tx.select().from(jockeys).where(eq(jockeys.id, id));
      if (j?.stableId) {
        await releaseTx(tx, j, now, "idle");
        released++;
      }
    }
    // Once a game week: veteran decline and the intake.
    const week = gc.weekIndex(t);
    const [done] = await tx.insert(jockeyWeeks).values({ week, ranAt: now }).onConflictDoNothing().returning();
    let weekly: JockeyMaintenance["week"] = null;
    if (done) {
      let declined = 0;
      const vets = await tx.select().from(jockeys).where(and(isNull(jockeys.retiredAt), eq(jockeys.stage, "veteran")));
      for (const j of vets) {
        const d = gc.declineSkills(skillsOf(j), potentialOf(j));
        await tx.update(jockeys).set({ skills: d.skills, potential: d.potential }).where(eq(jockeys.id, j.id));
        declined++;
      }
      const active = (await activeStableIds(tx, now)).length;
      const pool = await poolSize(tx);
      const intake = gc.jockeyIntake(active, pool);
      for (let i = 0; i < intake; i++) await createJockeyTx(tx, { seed: gc.seedFrom("jockey-intake", week, i), stableId: null, now });
      weekly = { week, declined, intake, active, pool, target: gc.jockeyPoolTarget(active) };
      await tx.update(jockeyWeeks).set({ data: weekly }).where(eq(jockeyWeeks.week, week));
    }
    return { backfill, staged, announced, retired, released, week: weekly };
  });
}
