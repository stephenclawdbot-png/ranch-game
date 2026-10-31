/**
 * Rivals and head-to-head records (experience review item 5), from settled Live races whose
 * result is public (news.ts resultPublicAt: never before the broadcast is over). game-core
 * rivals.ts does the counting; this file loads the meetings in two queries (no N+1).
 *
 * Club runners have no owner and are never anyone's rival.
 */
import { eq, inArray, or, sql } from "drizzle-orm";
import { declaredRivals, fraudEvents, inviteCodes, raceResults, stables } from "../schema";
import { gc } from "../gameCore";
import type { Db, Executor } from "../types";
import { areLinked, stableOf } from "./accounts";
import { grantCreditsTx } from "./ledger";
import { resultPublicAt } from "./news";
import { normalizeInviteCode } from "./playtest";
import { audit, rowsOf, runTx } from "./tx";

const LIVE = sql.raw(`('scheduled','feature','final')`);
const DAY_MS = 86_400_000;

interface MeetingQuery {
  /** Only races since this time. */
  since?: Date | null;
  /** Only races up to and including this post time. */
  until?: Date | null;
  /** Only races where this other stable also ran. */
  withStable?: string | null;
  /** Only these races. */
  raceIds?: string[] | null;
  limit?: number;
}

/** The stable's settled Live races (public results only), with every finisher, newest first. */
export async function meetingsOf(ex: Executor, stableId: string, now: Date, q: MeetingQuery = {}): Promise<gc.RaceMeeting[]> {
  const rows = rowsOf<{ race_id: string; race_name: string; post_time: string | Date; settled_at: string | Date | null; horse_id: string; horse_name: string | null; stable_id: string | null; stable_name: string | null; position: number }>(
    await ex.execute(sql`
      with mine as (
        select r.id, r.name, r.post_time, r.settled_at from races r
         where r.kind in ${LIVE} and r.status = 'settled'
           and exists (select 1 from race_entries e where e.race_id = r.id and e.stable_id = ${stableId} and e.status = 'entered')
           ${q.withStable ? sql`and exists (select 1 from race_entries o where o.race_id = r.id and o.stable_id = ${q.withStable} and o.status = 'entered')` : sql``}
           ${q.since ? sql`and r.post_time >= ${q.since.toISOString()}` : sql``}
           ${q.until ? sql`and r.post_time <= ${q.until.toISOString()}` : sql``}
           ${q.raceIds?.length ? sql`and r.id in (${sql.join(q.raceIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
           and r.post_time <= ${now.toISOString()}
         order by r.post_time desc limit ${q.limit ?? 300}
      )
      select m.id as race_id, m.name as race_name, m.post_time, m.settled_at, e.horse_id, h.name as horse_name, e.stable_id, s.name as stable_name, e.finish_position as position
        from mine m join race_entries e on e.race_id = m.id
        left join horses h on h.id = e.horse_id
        left join stables s on s.id = e.stable_id
       where e.finish_position is not null and e.status = 'entered'`),
  );
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.race_id))];
  const results = await ex.select({ raceId: raceResults.raceId, result: raceResults.result }).from(raceResults).where(inArray(raceResults.raceId, ids));
  const resultOf = new Map(results.map((r) => [r.raceId, r.result]));
  const by = new Map<string, gc.RaceMeeting>();
  for (const r of rows) {
    const result = resultOf.get(r.race_id);
    const postTime = new Date(r.post_time);
    // no spoilers: a race counts once its broadcast is over
    if (resultPublicAt({ postTime }, result, r.settled_at ? new Date(r.settled_at) : null) > now) continue;
    const margins = new Map((((result as { finishOrder?: { horseId: string; marginMm: number }[] } | null)?.finishOrder) ?? []).map((f) => [f.horseId, f.marginMm]));
    const m = by.get(r.race_id) ?? { raceId: r.race_id, raceName: r.race_name, atMs: postTime.getTime(), runners: [] };
    m.runners.push({ horseId: r.horse_id, horseName: r.horse_name ?? "A runner", stableId: r.stable_id, stableName: r.stable_id ? (r.stable_name ?? "A stable") : "The Club", position: Number(r.position), marginMm: margins.get(r.horse_id) ?? 0 });
    by.set(r.race_id, m);
  }
  return [...by.values()].sort((a, b) => b.atMs - a.atMs);
}

export interface RivalSummary extends gc.StableH2H {
  silks: unknown;
  /** A declared rival ("Bring a rival"): you invited them, or they invited you. Null for a detected rival. */
  declared: "invited" | "invited_by" | null;
}

export interface RivalsView {
  rivals: RivalSummary[];
  nemesis: gc.Nemesis | null;
  /** Horse-vs-horse records against the rivals' horses (most meetings first). */
  pairs: gc.HorseH2H[];
}

/**
 * Rival stables: declared rivals first (always shown), then the detected ones over the last
 * RIVAL_WINDOW_DAYS; the nemesis, and the horse pairs behind them.
 */
export async function rivalsView(ex: Executor, stableId: string, now: Date, opts: { limit?: number } = {}): Promise<RivalsView> {
  const [meetings, declared] = await Promise.all([meetingsOf(ex, stableId, now, { since: new Date(now.getTime() - gc.RIVAL_WINDOW_DAYS * DAY_MS) }), declaredRivalsOf(ex, stableId)]);
  const records = gc.stableHeadToHead(meetings, stableId);
  const declaredIds = new Set(declared.map((d) => d.stableId));
  const fromDeclared = declared.map((d) => ({ ...(records.find((r) => r.stableId === d.stableId) ?? { stableId: d.stableId, meetings: 0, ahead: 0, behind: 0, close: 0, closeAhead: 0, last: null }), stableName: d.stableName, declared: d.direction }));
  const detected = gc
    .rankRivals(records)
    .filter((r) => !declaredIds.has(r.stableId))
    .slice(0, opts.limit ?? gc.RIVALS_SHOWN)
    .map((r) => ({ ...r, declared: null }));
  const ranked = [...fromDeclared, ...detected];
  const pairs = gc.horseHeadToHead(meetings, stableId);
  const silks = ranked.length ? await ex.select({ id: stables.id, silks: stables.silks }).from(stables).where(inArray(stables.id, ranked.map((r) => r.stableId))) : [];
  const silksOf = new Map(silks.map((s) => [s.id, s.silks]));
  const rivalIds = new Set(ranked.map((r) => r.stableId));
  return {
    rivals: ranked.map((r) => ({ ...r, silks: silksOf.get(r.stableId) ?? null })),
    nemesis: gc.findNemesis(pairs),
    pairs: pairs.filter((p) => rivalIds.has(p.theirStableId)).sort((a, b) => b.meetings - a.meetings || b.close - a.close),
  };
}

/** Your record against one stable (all public meetings), with the horse pairs. */
export async function recordAgainst(ex: Executor, stableId: string, otherId: string, now: Date): Promise<{ record: gc.StableH2H | null; pairs: gc.HorseH2H[] }> {
  if (stableId === otherId) return { record: null, pairs: [] };
  const meetings = await meetingsOf(ex, stableId, now, { withStable: otherId });
  const record = gc.stableHeadToHead(meetings, stableId).find((r) => r.stableId === otherId) ?? null;
  const pairs = gc.horseHeadToHead(meetings, stableId)
    .filter((p) => p.theirStableId === otherId)
    .sort((a, b) => b.meetings - a.meetings || b.close - a.close);
  return { record, pairs };
}

/**
 * Post-race lines for the viewer's stable in one race ("You beat Thistle Mead's Copper Comet for
 * the first time in 4 meetings"). Empty until the race's result is public.
 */
export async function raceRivalLinesFor(ex: Executor, stableId: string, raceId: string, now: Date): Promise<string[]> {
  const [race] = await meetingsOf(ex, stableId, now, { raceIds: [raceId], limit: 1 });
  if (!race) return [];
  const others = [...new Set(race.runners.filter((r) => r.stableId && r.stableId !== stableId).map((r) => r.stableId!))];
  if (!others.length) return [];
  // every earlier public meeting with the stables in this race (the history of these pairs)
  const history = await meetingsOf(ex, stableId, now, { until: new Date(race.atMs), limit: 500 });
  const relevant = history.filter((m) => m.runners.some((r) => r.stableId && others.includes(r.stableId)));
  const view = await rivalsView(ex, stableId, now);
  return gc.raceRivalLines(relevant, raceId, stableId, { rivalIds: new Set(view.rivals.map((r) => r.stableId)), nemesisId: view.nemesis?.horseId ?? null });
}

/** For the racecard: the viewer's rival stables and nemesis horse (ids only). */
export async function rivalTags(ex: Executor, stableId: string, now: Date): Promise<{ rivalStableIds: string[]; nemesisHorseId: string | null }> {
  const v = await rivalsView(ex, stableId, now);
  return { rivalStableIds: v.rivals.map((r) => r.stableId), nemesisHorseId: v.nemesis?.horseId ?? null };
}

// ---------------------------------------------------------------------------
// Declared rivals: "Bring a rival" invites
// ---------------------------------------------------------------------------

const RIVAL_INVITE_WEEKLY_WELCOMES = gc.RIVAL_INVITE_WEEKLY_WELCOMES;

export interface DeclaredRival {
  stableId: string;
  stableName: string;
  direction: "invited" | "invited_by";
  atMs: number;
}

/** The stable's declared rivals, both ways (you invited them / they invited you), newest first. */
export async function declaredRivalsOf(ex: Executor, stableId: string): Promise<DeclaredRival[]> {
  const rows = await ex
    .select({ inviter: declaredRivals.inviterStableId, invitee: declaredRivals.inviteeStableId, at: declaredRivals.createdAt })
    .from(declaredRivals)
    .where(or(eq(declaredRivals.inviterStableId, stableId), eq(declaredRivals.inviteeStableId, stableId)));
  if (!rows.length) return [];
  const otherOf = (r: (typeof rows)[number]) => (r.inviter === stableId ? r.invitee : r.inviter);
  const names = await ex.select({ id: stables.id, name: stables.name }).from(stables).where(inArray(stables.id, rows.map(otherOf)));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return rows
    .map((r) => ({ stableId: otherOf(r), stableName: nameOf.get(otherOf(r)) ?? "A stable", direction: r.inviter === stableId ? ("invited" as const) : ("invited_by" as const), atMs: r.at.getTime() }))
    .sort((a, b) => b.atMs - a.atMs);
}

export type RivalInviteResult =
  | { ok: true; inviterStableId: string; welcome: "granted" | "refused"; reason: string | null; credits: { invitee: number; inviter: number } }
  | { ok: false; problem: "unknown_code" | "self" | "already" };

/**
 * A friend founded a stable through a rival invite link (the inviter's personal referral code):
 * the two stables become declared rivals at once, and both get RIVAL_INVITE_CREDITS once (kind
 * `rival_invite`; once per invited account: unique invitee). Refused, with a fraud event for
 * review, when the accounts are linked (a shared device, fingerprint, wallet or email, like the
 * market's anti-alt check); the inviter's side is also capped at gc.RIVAL_INVITE_WEEKLY_WELCOMES a
 * week. Never pays USDG; the affiliate tree is untouched (recordReferral does that separately).
 */
export async function acceptRivalInvite(db: Db, input: { inviteeAccountId: string; code: string; now: Date }): Promise<RivalInviteResult> {
  const code = normalizeInviteCode(input.code);
  const [row] = code ? await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)) : [];
  if (!row || row.revokedAt || row.kind !== "referral" || !row.ownerAccountId) return { ok: false, problem: "unknown_code" };
  const inviterAccountId = row.ownerAccountId;
  if (inviterAccountId === input.inviteeAccountId) return { ok: false, problem: "self" };
  return runTx(db, async (tx) => {
    const inviter = await stableOf(tx, inviterAccountId);
    const invitee = await stableOf(tx, input.inviteeAccountId);
    const linked = await areLinked(tx, inviterAccountId, input.inviteeAccountId);
    const weekFrom = new Date(Date.parse(`${utcMonday(input.now)}T00:00:00Z`));
    const [wk] = rowsOf<{ n: number }>(
      await tx.execute(sql`select count(*)::int as n from declared_rivals where inviter_stable_id = ${inviter.id} and welcome = 'granted' and created_at >= ${weekFrom.toISOString()}`),
    );
    const inviterCapped = Number(wk?.n ?? 0) >= RIVAL_INVITE_WEEKLY_WELCOMES;
    const amount = gc.RIVAL_INVITE_CREDITS;
    const inserted = await tx
      .insert(declaredRivals)
      .values({
        inviterStableId: inviter.id,
        inviteeStableId: invitee.id,
        source: "invite",
        welcome: linked ? "refused" : "granted",
        welcomeCredits: linked ? 0 : amount,
        refusedReason: linked ? "linked_accounts" : null,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: declaredRivals.id });
    if (!inserted[0]) return { ok: false as const, problem: "already" as const };
    if (linked) {
      await tx.insert(fraudEvents).values({ accountId: input.inviteeAccountId, relatedAccountId: inviterAccountId, kind: "rival_invite_linked", severity: 1, data: { code } });
      return { ok: true as const, inviterStableId: inviter.id, welcome: "refused" as const, reason: "linked_accounts", credits: { invitee: 0, inviter: 0 } };
    }
    const key = `rival_invite:${invitee.id}`;
    await grantCreditsTx(tx, { accountId: input.inviteeAccountId, amount, idempotencyKey: `${key}:invitee`, kind: "rival_invite", memo: `Welcome: you and ${inviter.name} are rivals` });
    if (!inviterCapped) await grantCreditsTx(tx, { accountId: inviterAccountId, amount, idempotencyKey: `${key}:inviter`, kind: "rival_invite", memo: `Welcome: ${invitee.name} took up your challenge` });
    await audit(tx, { actor: input.inviteeAccountId, action: "rival.invite", entityType: "stable", entityId: invitee.id, data: { inviterStableId: inviter.id, inviterCapped } });
    return { ok: true as const, inviterStableId: inviter.id, welcome: "granted" as const, reason: inviterCapped ? "inviter_weekly_cap" : null, credits: { invitee: amount, inviter: inviterCapped ? 0 : amount } };
  });
}

/** Rival invites sent and taken up (for the invite page). */
export async function rivalInviteStats(ex: Executor, stableId: string, now: Date): Promise<{ accepted: number; thisWeek: number }> {
  const all = await ex.select({ at: declaredRivals.createdAt, welcome: declaredRivals.welcome }).from(declaredRivals).where(eq(declaredRivals.inviterStableId, stableId));
  const from = Date.parse(`${utcMonday(now)}T00:00:00Z`);
  return { accepted: all.length, thisWeek: all.filter((r) => r.welcome === "granted" && r.at.getTime() >= from).length };
}

function utcMonday(at: Date): string {
  return new Date(gc.tipsterWeekStartMs(at.getTime())).toISOString().slice(0, 10);
}
