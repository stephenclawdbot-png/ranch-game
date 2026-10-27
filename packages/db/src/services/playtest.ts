/**
 * Closed playtest: invite codes, testers, feedback, first-party telemetry, beta rewards and
 * the playtest reset.
 *
 * - Testers, invite codes, tester rewards, feedback, telemetry and beta rewards SURVIVE the
 *   reset (`resetPlaytest`): they reference accounts by plain uuid columns.
 * - The beta reward ledger here is the manual FALLBACK (USD amounts the operator pays from
 *   their own wallet; we only record tx hashes). The weekly Prize Pool is on-chain (web3).
 *   In-game Stable Credits are never involved and never convertible.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { sha256Hex, utcDay } from "../crypto";
import { betaRewardRules, betaRewards, feedback, inviteCodes, testerRewards, testers, telemetryEvents, type BetaRewardRow, type FeedbackRow, type TesterRow } from "../schema";
import type { Db, Executor } from "../types";
import { rowsOf, runTx } from "./tx";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PlaytestConfig {
  /** PLAYTEST_MODE=1: account creation needs an invite code. */
  enabled: boolean;
  /** PLAYTEST_TESTER_CAP (default 60). */
  testerCap: number;
}

export function playtestConfig(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): PlaytestConfig {
  const on = (env.PLAYTEST_MODE ?? "").trim().toLowerCase();
  const cap = Number(env.PLAYTEST_TESTER_CAP);
  return { enabled: on === "1" || on === "true" || on === "yes", testerCap: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 60 };
}

// ---------------------------------------------------------------------------
// Invite codes and testers
// ---------------------------------------------------------------------------

/** No 0/O/1/I/L: codes are read aloud and typed on phones. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `TB-${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export async function generateInviteCodes(db: Db, input: { count: number; maxUses?: number; note?: string | null; now?: Date }): Promise<string[]> {
  const count = Math.floor(input.count);
  if (!(count >= 1 && count <= 500)) throw new DomainError("INVALID_INPUT", "generate 1 to 500 codes at a time");
  const maxUses = Math.floor(input.maxUses ?? 1);
  if (!(maxUses >= 1 && maxUses <= 1000)) throw new DomainError("INVALID_INPUT", "max uses must be 1 to 1000");
  const codes: string[] = [];
  while (codes.length < count) {
    const batch = Array.from({ length: count - codes.length }, randomCode);
    const inserted = await db
      .insert(inviteCodes)
      .values(batch.map((code) => ({ code, maxUses, note: input.note?.slice(0, 200) ?? null, createdAt: input.now ?? new Date() })))
      .onConflictDoNothing()
      .returning({ code: inviteCodes.code });
    codes.push(...inserted.map((r) => r.code));
  }
  return codes;
}

export async function listInviteCodes(ex: Executor) {
  return ex.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).limit(1000);
}

export type InviteProblem = "INVALID" | "USED" | "FULL";

/** Read-only check for the /play screen. */
export async function checkInvite(ex: Executor, rawCode: string, cap: number): Promise<{ ok: true; rejoin: boolean } | { ok: false; problem: InviteProblem }> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, problem: "INVALID" };
  const [row] = await ex.select().from(inviteCodes).where(eq(inviteCodes.code, code));
  if (!row || row.revokedAt) return { ok: false, problem: "INVALID" };
  // Personal referral codes (kind "referral", shared by many invitees) never re-link an orphan
  // tester: that would hand someone else's tester record (and wallet) to a new signup.
  const orphan = row.kind === "admin" ? await ex.select({ id: testers.id }).from(testers).where(and(eq(testers.inviteCode, code), rejoinable(new Date()))).limit(1) : [];
  if (orphan.length) return { ok: true, rejoin: true };
  if (row.uses >= row.maxUses) return { ok: false, problem: "USED" };
  const [n] = await ex.select({ n: sql<number>`count(*)::int` }).from(testers);
  if (Number(n?.n ?? 0) >= cap) return { ok: false, problem: "FULL" };
  return { ok: true, rejoin: false };
}

/**
 * Reserves a tester for an invite code: re-links a tester left without an account by a reset
 * (same code), or uses the code once and creates a new tester (cap permitting). The account
 * is attached with `linkTester` once it exists.
 */
export async function redeemInvite(db: Db, input: { code: string; cap: number; now?: Date }): Promise<{ testerId: string; rejoin: boolean }> {
  const code = normalizeInviteCode(input.code);
  return runTx(db, async (tx) => {
    const [row] = await tx.select().from(inviteCodes).where(eq(inviteCodes.code, code)).for("update");
    if (!row || row.revokedAt) throw new DomainError("INVALID_INPUT", "That invite code isn't valid.", { invite: "INVALID" });
    const [orphan] =
      row.kind === "admin"
        ? await tx.select().from(testers).where(and(eq(testers.inviteCode, code), rejoinable(input.now ?? new Date()))).orderBy(asc(testers.joinedAt)).limit(1).for("update")
        : [];
    if (orphan) return { testerId: orphan.id, rejoin: true };
    if (row.uses >= row.maxUses) throw new DomainError("NOT_ELIGIBLE", "That invite code has already been used.", { invite: "USED" });
    // Serialise the cap check across codes.
    await tx.execute(sql`select pg_advisory_xact_lock(${TESTER_CAP_LOCK})`);
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(testers);
    if (Number(n?.n ?? 0) >= input.cap) throw new DomainError("NOT_ELIGIBLE", "The playtest is full.", { invite: "FULL" });
    const [t] = await tx.insert(testers).values({ inviteCode: code, joinedAt: input.now ?? new Date() }).returning({ id: testers.id });
    await tx.update(inviteCodes).set({ uses: row.uses + 1, usedBy: t!.id }).where(eq(inviteCodes.code, code));
    // The exclusive tester item entitlement (granted later, kept across resets).
    await tx.insert(testerRewards).values({ testerId: t!.id, kind: "playtest_founder", note: "Closed playtest tester" }).onConflictDoNothing();
    return { testerId: t!.id, rejoin: false };
  });
}

const TESTER_CAP_LOCK = 7_310_331;

/**
 * A tester without an account who may be re-linked: unlinked by a reset (had a stable), or a
 * reservation whose account creation never finished (older than 10 minutes). A fresh
 * reservation in flight is not, so one code can't be redeemed twice concurrently.
 */
function rejoinable(now: Date) {
  return and(isNull(testers.accountId), sql`(${testers.stableName} is not null or ${testers.joinedAt} < ${new Date(now.getTime() - 10 * 60_000)})`);
}

/** Attaches the new account to a reserved tester. Fails if another account claimed it meanwhile. */
export async function linkTester(db: Db, input: { testerId: string; accountId: string; stableName: string; now?: Date }): Promise<void> {
  const res = await db
    .update(testers)
    .set({ accountId: input.accountId, stableName: input.stableName.slice(0, 60), lastSeenAt: input.now ?? new Date() })
    .where(and(eq(testers.id, input.testerId), isNull(testers.accountId)))
    .returning({ id: testers.id });
  if (!res.length) throw new DomainError("NOT_ELIGIBLE", "That invite was just used on another device.", { invite: "USED" });
}

export async function testerForAccount(ex: Executor, accountId: string): Promise<TesterRow | null> {
  const [t] = await ex.select().from(testers).where(eq(testers.accountId, accountId));
  return t ?? null;
}

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function setTesterWallet(db: Db, input: { accountId: string; address: string | null }): Promise<TesterRow> {
  const address = input.address?.trim() || null;
  if (address !== null && !EVM_ADDRESS_RE.test(address)) throw new DomainError("INVALID_INPUT", "That isn't an EVM address (0x followed by 40 hex characters).");
  // A SIWE-verified wallet (services/betaMoney.ts linkVerifiedWallet) can't be overwritten or
  // cleared by this unsigned path: it receives Prize Pool allocations.
  const [current] = await db.select().from(testers).where(eq(testers.accountId, input.accountId));
  if (current?.walletVerifiedAt) throw new DomainError("NOT_ELIGIBLE", "Your wallet is verified. Ask the organiser to change it.");
  const [t] = await db.update(testers).set({ walletAddress: address }).where(eq(testers.accountId, input.accountId)).returning();
  if (!t) throw new DomainError("NOT_FOUND", "Only playtesters can save a wallet address.");
  return t;
}

export interface TesterListRow {
  id: string;
  inviteCode: string;
  accountId: string | null;
  stableName: string | null;
  walletAddress: string | null;
  joinedAt: Date;
  lastSeenAt: Date | null;
  races: number;
  daysPlayed: number;
  rewards: string[];
}

export async function listTesters(ex: Executor): Promise<TesterListRow[]> {
  const rows = await ex.select().from(testers).orderBy(asc(testers.joinedAt));
  if (!rows.length) return [];
  const stats = rowsOf<{ tester_id: string; races: number; days: number; last: string | null }>(
    await ex.execute(sql`select tester_id, count(*) filter (where name = 'race_entered')::int as races,
                                count(distinct (created_at at time zone 'UTC')::date)::int as days, max(created_at) as last
                           from telemetry_events where tester_id is not null group by tester_id`),
  );
  const byId = new Map(stats.map((s) => [s.tester_id, s]));
  const perks = await ex.select().from(testerRewards);
  return rows.map((t) => {
    const s = byId.get(t.id);
    const last = s?.last ? new Date(s.last) : null;
    return {
      id: t.id,
      inviteCode: t.inviteCode,
      accountId: t.accountId,
      stableName: t.stableName,
      walletAddress: t.walletAddress,
      joinedAt: t.joinedAt,
      lastSeenAt: last && (!t.lastSeenAt || last > t.lastSeenAt) ? last : t.lastSeenAt,
      races: Number(s?.races ?? 0),
      daysPlayed: Number(s?.days ?? 0),
      rewards: perks.filter((p) => p.testerId === t.id).map((p) => p.kind),
    };
  });
}

// ---------------------------------------------------------------------------
// Telemetry (first-party, privacy-light)
// ---------------------------------------------------------------------------

export const TELEMETRY_EVENTS = [
  "signup",
  "session_start",
  "page_view",
  "race_entered",
  "race_watched",
  // Race-viewer perf report from the client (one per mounted viewer; devices + fps)
  "race_perf",
  "care",
  "train",
  "breed",
  "foal",
  "pack_pull",
  "market_list",
  "market_buy",
  "market_cancel",
  "feedback",
  // Beta money (services/betaMoney.ts, apps/web/src/server/chain)
  "wallet_linked",
  "wallet_sign_in",
  "checkout_quote",
  "checkout_paid",
  "pool_claim",
  "invite_view",
] as const;
export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];

/** Props are small scalars only (route paths, kinds, ids). Anything else is dropped. */
export function cleanProps(props: Record<string, unknown> | undefined): Record<string, string | number | boolean> | null {
  if (!props) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props).slice(0, 8)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export async function track(db: Db, input: { accountId: string | null; name: TelemetryEvent; props?: Record<string, unknown>; now?: Date }): Promise<void> {
  const tester = input.accountId ? await testerForAccount(db, input.accountId) : null;
  await db.insert(telemetryEvents).values({
    accountId: input.accountId,
    testerId: tester?.id ?? null,
    name: input.name,
    props: cleanProps(input.props),
    createdAt: input.now ?? new Date(),
  });
  if (tester) await db.update(testers).set({ lastSeenAt: input.now ?? new Date() }).where(eq(testers.id, tester.id));
}

export interface PlaytestMetrics {
  days: { day: string; actives: number; sessions: number; signups: number; races: number; racesByKind: Record<string, number> }[];
  retention: { cohort: number; day1: number | null; day7: number | null; day1Eligible: number; day7Eligible: number };
  /** The 6-step signup funnel; every count is a share of `signups` in the dashboard. */
  funnel: { signups: number; firstRace: number; raceWatched: number; liveRace: number; secondSession: number; nextDay: number };
  /** Signup -> first race_entered: median seconds, share under 60 s, signups that raced. */
  firstRace: { medianSec: number | null; under60Pct: number | null; n: number };
  /** Last 7 UTC days: total race_entered / sum of daily actives (null when nobody was active). */
  racesPerActive: number | null;
  /** % of race_entered (last 7 days) with props.kind = "live". */
  liveShare: number | null;
  /** Race-viewer perf reports (target: phone/tablet 30 fps, desktop 60). */
  perf: { byDevice: PerfDeviceMetrics[]; slowGpus: PerfGpuMetrics[] };
  totals: { testers: number; feedback: number; events: number };
}

export interface PerfDeviceMetrics {
  device: string;
  reports: number;
  medianFps: number;
  lowFps: number;
  /** % of reports at or over the device target. */
  onTargetPct: number | null;
  downgradedPct: number | null;
}

export interface PerfGpuMetrics {
  gpu: string;
  reports: number;
  medianFps: number;
}

/** Day-1 / day-7 retention, actives, sessions, races per day, the signup funnel and perf reports. */
export async function playtestMetrics(ex: Executor, input: { now: Date; days?: number }): Promise<PlaytestMetrics> {
  const span = Math.max(1, Math.min(60, input.days ?? 14));
  const from = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()) - (span - 1) * DAY_MS);
  const daily = rowsOf<{ day: string; actives: number; sessions: number; signups: number; races: number }>(
    await ex.execute(sql`select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
                                count(distinct account_id)::int as actives,
                                count(*) filter (where name = 'session_start')::int as sessions,
                                count(*) filter (where name = 'signup')::int as signups,
                                count(*) filter (where name = 'race_entered')::int as races
                           from telemetry_events where created_at >= ${from} group by 1 order by 1`),
  );
  const kinds = rowsOf<{ day: string; kind: string | null; n: number }>(
    await ex.execute(sql`select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, props->>'kind' as kind, count(*)::int as n
                           from telemetry_events where name = 'race_entered' and created_at >= ${from} group by 1, 2`),
  );
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days: PlaytestMetrics["days"] = [];
  for (let i = 0; i < span; i++) {
    const day = utcDay(new Date(from.getTime() + i * DAY_MS));
    const d = byDay.get(day);
    const racesByKind: Record<string, number> = {};
    for (const k of kinds.filter((x) => x.day === day)) racesByKind[k.kind ?? "other"] = Number(k.n);
    days.push({ day, actives: Number(d?.actives ?? 0), sessions: Number(d?.sessions ?? 0), signups: Number(d?.signups ?? 0), races: Number(d?.races ?? 0), racesByKind });
  }

  // Retention by signup cohort (UTC days): active again exactly 1 / 7 days after signing up.
  const [ret] = rowsOf<{ cohort: number; d1: number; d1e: number; d7: number; d7e: number }>(
    await ex.execute(sql`with s as (
        select account_id, min((created_at at time zone 'UTC')::date) as d0 from telemetry_events where name = 'signup' and account_id is not null group by account_id),
      a as (select distinct account_id, (created_at at time zone 'UTC')::date as d from telemetry_events where account_id is not null)
      select count(*)::int as cohort,
             count(*) filter (where s.d0 + 1 <= (${input.now} at time zone 'UTC')::date)::int as d1e,
             count(*) filter (where exists (select 1 from a where a.account_id = s.account_id and a.d = s.d0 + 1))::int as d1,
             count(*) filter (where s.d0 + 7 <= (${input.now} at time zone 'UTC')::date)::int as d7e,
             count(*) filter (where exists (select 1 from a where a.account_id = s.account_id and a.d = s.d0 + 7))::int as d7
        from s`),
  );
  const [fun] = rowsOf<{ signups: number; first_race: number; watched: number; live_race: number; second_session: number; next_day: number }>(
    await ex.execute(sql`with s as (select account_id, min(created_at) as t0 from telemetry_events where name = 'signup' and account_id is not null group by account_id)
      select count(*)::int as signups,
             count(*) filter (where exists (select 1 from telemetry_events e where e.account_id = s.account_id and e.name = 'race_entered'))::int as first_race,
             count(*) filter (where exists (select 1 from telemetry_events e where e.account_id = s.account_id and e.name = 'race_watched'))::int as watched,
             count(*) filter (where exists (select 1 from telemetry_events e where e.account_id = s.account_id and e.name = 'race_entered' and e.props->>'kind' = 'live'))::int as live_race,
             count(*) filter (where (select count(*) from telemetry_events e where e.account_id = s.account_id and e.name = 'session_start') >= 2)::int as second_session,
             count(*) filter (where exists (select 1 from telemetry_events e where e.account_id = s.account_id and (e.created_at at time zone 'UTC')::date = (s.t0 at time zone 'UTC')::date + 1))::int as next_day
        from s`),
  );
  const [fr] = rowsOf<{ median_sec: number | null; signups: number; raced: number; under60: number }>(
    await ex.execute(sql`with su as (select account_id, min(created_at) as t0 from telemetry_events where name = 'signup' and account_id is not null group by account_id),
      fr as (select account_id, min(created_at) as t1 from telemetry_events where name = 'race_entered' and account_id is not null group by account_id)
      select percentile_cont(0.5) within group (order by extract(epoch from (fr.t1 - su.t0)))::float8 as median_sec,
             count(*)::int as signups, count(fr.t1)::int as raced,
             count(*) filter (where fr.t1 - su.t0 <= interval '60 seconds')::int as under60
        from su left join fr using (account_id)`),
  );
  const perfRows = rowsOf<{ device: string; reports: number; median_fps: number; low_fps: number; on_target: number; downgraded: number }>(
    await ex.execute(sql`select coalesce(props->>'device', 'unknown') as device, count(*)::int as reports,
                                percentile_cont(0.5) within group (order by (props->>'fps')::float8)::float8 as median_fps,
                                percentile_cont(0.5) within group (order by (props->>'fpsLow')::float8)::float8 as low_fps,
                                count(*) filter (where (props->>'fps')::float8 >= case props->>'device' when 'desktop' then 60 else 30 end)::int as on_target,
                                count(*) filter (where (props->>'downgraded')::boolean)::int as downgraded
                           from telemetry_events where name = 'race_perf' and created_at >= ${from}
                          group by 1`),
  );
  const gpuRows = rowsOf<{ gpu: string; reports: number; median_fps: number }>(
    await ex.execute(sql`select coalesce(props->>'gpu', 'unknown') as gpu, count(*)::int as reports,
                                percentile_cont(0.5) within group (order by (props->>'fps')::float8)::float8 as median_fps
                           from telemetry_events where name = 'race_perf' and created_at >= ${from}
                          group by 1 having count(*) >= 3 order by median_fps asc limit 5`),
  );
  const [tot] = rowsOf<{ testers: number; feedback: number; events: number }>(
    await ex.execute(sql`select (select count(*) from testers)::int as testers, (select count(*) from feedback)::int as feedback, (select count(*) from telemetry_events)::int as events`),
  );
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 1000) / d) / 10 : null);
  // Last 7 UTC days of the window: races per active tester and the Live share.
  const last7 = days.slice(-7);
  const races7 = last7.reduce((s, d) => s + d.races, 0);
  const actives7 = last7.reduce((s, d) => s + d.actives, 0);
  const in7 = new Set(last7.map((d) => d.day));
  let live7 = 0;
  let all7 = 0;
  for (const k of kinds) {
    if (!in7.has(k.day)) continue;
    all7 += Number(k.n);
    if (k.kind === "live") live7 += Number(k.n);
  }
  return {
    days,
    retention: {
      cohort: Number(ret?.cohort ?? 0),
      day1: pct(Number(ret?.d1 ?? 0), Number(ret?.d1e ?? 0)),
      day7: pct(Number(ret?.d7 ?? 0), Number(ret?.d7e ?? 0)),
      day1Eligible: Number(ret?.d1e ?? 0),
      day7Eligible: Number(ret?.d7e ?? 0),
    },
    funnel: {
      signups: Number(fun?.signups ?? 0),
      firstRace: Number(fun?.first_race ?? 0),
      raceWatched: Number(fun?.watched ?? 0),
      liveRace: Number(fun?.live_race ?? 0),
      secondSession: Number(fun?.second_session ?? 0),
      nextDay: Number(fun?.next_day ?? 0),
    },
    firstRace: {
      medianSec: fr?.median_sec === null || fr?.median_sec === undefined ? null : Number(fr.median_sec),
      under60Pct: pct(Number(fr?.under60 ?? 0), Number(fr?.signups ?? 0)),
      n: Number(fr?.raced ?? 0),
    },
    racesPerActive: actives7 > 0 ? Math.round((races7 / actives7) * 10) / 10 : null,
    liveShare: pct(live7, all7),
    perf: {
      byDevice: perfRows
        .map((r) => ({
          device: String(r.device),
          reports: Number(r.reports),
          medianFps: Number(r.median_fps ?? 0),
          lowFps: Number(r.low_fps ?? 0),
          onTargetPct: pct(Number(r.on_target), Number(r.reports)),
          downgradedPct: pct(Number(r.downgraded), Number(r.reports)),
        }))
        .sort((a, b) => (a.device === "phone" ? -1 : b.device === "phone" ? 1 : a.device === "tablet" ? -1 : b.device === "tablet" ? 1 : 0)),
      slowGpus: gpuRows.map((r) => ({ gpu: String(r.gpu), reports: Number(r.reports), medianFps: Number(r.median_fps ?? 0) })),
    },
    totals: { testers: Number(tot?.testers ?? 0), feedback: Number(tot?.feedback ?? 0), events: Number(tot?.events ?? 0) },
  };
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export const FEEDBACK_CATEGORIES = ["bug", "idea", "confusing", "fun"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface FeedbackInput {
  accountId: string | null;
  stableId: string | null;
  /** Rate-limit key when there is no account (e.g. a hashed IP). */
  anonKey: string;
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  route: string | null;
  viewport: string | null;
  userAgent: string | null;
  clientErrors: string[];
  now?: Date;
}

/** At most this many reports per sender per hour. */
export const FEEDBACK_PER_HOUR = 10;

export async function submitFeedback(db: Db, input: FeedbackInput): Promise<FeedbackRow> {
  const message = input.message.trim();
  if (!message || message.length > 4000) throw new DomainError("INVALID_INPUT", "Write a message (up to 4,000 characters).");
  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(input.category)) throw new DomainError("INVALID_INPUT", "Pick a category.");
  if (input.rating !== null && !(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5)) throw new DomainError("INVALID_INPUT", "Ratings are 1 to 5.");
  const now = input.now ?? new Date();
  const senderKey = input.accountId ? `acc:${input.accountId}` : `anon:${sha256Hex(input.anonKey).slice(0, 32)}`;
  return runTx(db, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${senderKey}))`);
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(feedback)
      .where(and(eq(feedback.senderKey, senderKey), gte(feedback.createdAt, new Date(now.getTime() - 3_600_000))));
    if (Number(n?.n ?? 0) >= FEEDBACK_PER_HOUR) throw new DomainError("RACE_LIMIT", "Thanks! You've sent a lot of feedback this hour; please try again a bit later.", { rateLimited: true });
    const tester = input.accountId ? await testerForAccount(tx, input.accountId) : null;
    const [row] = await tx
      .insert(feedback)
      .values({
        accountId: input.accountId,
        testerId: tester?.id ?? null,
        stableId: input.stableId,
        senderKey,
        category: input.category,
        rating: input.rating,
        message,
        route: input.route?.slice(0, 200) ?? null,
        viewport: input.viewport?.slice(0, 40) ?? null,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        clientErrors: input.clientErrors.slice(-10).map((e) => String(e).slice(0, 500)),
        createdAt: now,
      })
      .returning();
    return row!;
  });
}

export interface FeedbackListRow extends FeedbackRow {
  stableName: string | null;
}

export async function listFeedback(ex: Executor, filter: { status?: "new" | "resolved"; category?: FeedbackCategory; limit?: number } = {}): Promise<FeedbackListRow[]> {
  const conds = [filter.status ? eq(feedback.status, filter.status) : undefined, filter.category ? eq(feedback.category, filter.category) : undefined].filter(Boolean);
  const rows = await ex
    .select({ f: feedback, stableName: testers.stableName })
    .from(feedback)
    .leftJoin(testers, eq(testers.id, feedback.testerId))
    .where(conds.length ? and(...(conds as never[])) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(Math.min(500, filter.limit ?? 200));
  return rows.map((r) => ({ ...r.f, stableName: r.stableName }));
}

/** Resolve / reopen, add a note, or accept as a bug (creates the pending bug bounty, idempotently). */
export async function updateFeedback(db: Db, input: { id: string; status?: "new" | "resolved"; acceptBug?: boolean; note?: string | null; now?: Date }): Promise<FeedbackRow> {
  const now = input.now ?? new Date();
  return runTx(db, async (tx) => {
    const [f] = await tx.select().from(feedback).where(eq(feedback.id, input.id)).for("update");
    if (!f) throw new DomainError("NOT_FOUND", "feedback not found");
    const patch: Partial<FeedbackRow> = {};
    if (input.status) {
      patch.status = input.status;
      patch.resolvedAt = input.status === "resolved" ? now : null;
    }
    if (input.note !== undefined) patch.adminNote = input.note?.slice(0, 2000) ?? null;
    if (input.acceptBug) {
      patch.acceptedBug = true;
      if (f.testerId) {
        const rule = await ruleByKey(tx, "bug_bounty");
        if (rule?.active) {
          await tx
            .insert(betaRewards)
            .values({ testerId: f.testerId, ruleKey: "bug_bounty", period: `feedback:${f.id}`, amountUsdCents: rule.amountUsdCents, notes: f.message.slice(0, 120), createdAt: now, updatedAt: now })
            .onConflictDoNothing();
        }
      }
    }
    const [row] = await tx.update(feedback).set(patch).where(eq(feedback.id, f.id)).returning();
    return row!;
  });
}

// ---------------------------------------------------------------------------
// Beta rewards (USD, paid manually; never credits)
// ---------------------------------------------------------------------------

async function ruleByKey(ex: Executor, key: string) {
  const [r] = await ex.select().from(betaRewardRules).where(eq(betaRewardRules.key, key));
  return r ?? null;
}

export async function listRewardRules(ex: Executor) {
  return ex.select().from(betaRewardRules).orderBy(asc(betaRewardRules.key));
}

export async function updateRewardRule(db: Db, input: { key: string; label?: string; amountUsdCents?: number; config?: Record<string, unknown>; active?: boolean }) {
  if (input.amountUsdCents !== undefined && !(Number.isInteger(input.amountUsdCents) && input.amountUsdCents >= 0 && input.amountUsdCents <= 1_000_000)) {
    throw new DomainError("INVALID_INPUT", "amount must be 0 to $10,000 in cents");
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.label !== undefined) patch.label = input.label.slice(0, 120);
  if (input.amountUsdCents !== undefined) patch.amountUsdCents = input.amountUsdCents;
  if (input.config !== undefined) patch.config = input.config;
  if (input.active !== undefined) patch.active = input.active;
  const [r] = await db.update(betaRewardRules).set(patch).where(eq(betaRewardRules.key, input.key)).returning();
  if (!r) throw new DomainError("NOT_FOUND", "rule not found");
  return r;
}

/**
 * Manual award (fallback payout ledger: e.g. a bug bounty or a best-feedback pick). Weekly
 * prize allocation is the on-chain Prize Pool's job (web3), not this ledger. Idempotent per
 * (tester, rule, period).
 */
export async function awardBetaReward(db: Db, input: { testerId: string; ruleKey: string; period: string; notes?: string | null; amountUsdCents?: number; now?: Date }) {
  const rule = await ruleByKey(db, input.ruleKey);
  if (!rule) throw new DomainError("NOT_FOUND", "rule not found");
  const now = input.now ?? new Date();
  await db
    .insert(betaRewards)
    .values({ testerId: input.testerId, ruleKey: rule.key, period: input.period.slice(0, 80), amountUsdCents: input.amountUsdCents ?? rule.amountUsdCents, notes: input.notes ?? null, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
}

export interface BetaRewardListRow extends BetaRewardRow {
  stableName: string | null;
  walletAddress: string | null;
}

export async function listBetaRewards(ex: Executor, filter: { status?: BetaRewardRow["status"]; testerId?: string } = {}): Promise<BetaRewardListRow[]> {
  const conds = [filter.status ? eq(betaRewards.status, filter.status) : undefined, filter.testerId ? eq(betaRewards.testerId, filter.testerId) : undefined].filter(Boolean);
  const rows = await ex
    .select({ r: betaRewards, stableName: testers.stableName, walletAddress: testers.walletAddress })
    .from(betaRewards)
    .innerJoin(testers, eq(testers.id, betaRewards.testerId))
    .where(conds.length ? and(...(conds as never[])) : undefined)
    .orderBy(desc(betaRewards.createdAt), asc(betaRewards.ruleKey));
  return rows.map((x) => ({ ...x.r, stableName: x.stableName, walletAddress: x.walletAddress }));
}

export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** pending -> approved -> paid (tx hash); any unpaid -> void. Paid is final. */
export async function setBetaRewardStatus(db: Db, input: { id: string; action: "approve" | "void" | "paid" | "pending"; txHash?: string | null; now?: Date }): Promise<BetaRewardRow> {
  return runTx(db, async (tx) => {
    const [r] = await tx.select().from(betaRewards).where(eq(betaRewards.id, input.id)).for("update");
    if (!r) throw new DomainError("NOT_FOUND", "reward not found");
    if (r.status === "paid") throw new DomainError("PERMANENT_STATE", "already paid");
    const patch: Partial<BetaRewardRow> = { updatedAt: input.now ?? new Date() };
    if (input.action === "approve") {
      if (r.status === "void") throw new DomainError("PERMANENT_STATE", "void rewards can't be approved; set it back to pending first");
      patch.status = "approved";
    } else if (input.action === "pending") patch.status = "pending";
    else if (input.action === "void") patch.status = "void";
    else {
      const hash = input.txHash?.trim() ?? "";
      if (!TX_HASH_RE.test(hash)) throw new DomainError("INVALID_INPUT", "A transaction hash is 0x followed by 64 hex characters.");
      if (r.status !== "approved") throw new DomainError("NOT_ELIGIBLE", "approve the reward before marking it paid");
      patch.status = "paid";
      patch.txHash = hash;
    }
    const [row] = await tx.update(betaRewards).set(patch).where(eq(betaRewards.id, r.id)).returning();
    return row!;
  });
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Neutralise spreadsheet formulas and quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of approved, unpaid rewards (wallet, USD amount, tester, reason) for manual payout. */
export async function approvedUnpaidCsv(ex: Executor): Promise<string> {
  const rows = await listBetaRewards(ex, { status: "approved" });
  const lines = [["wallet", "amount_usd", "reward_id", "tester_id", "stable", "rule", "period", "notes"].join(",")];
  for (const r of rows) {
    lines.push([r.walletAddress, (r.amountUsdCents / 100).toFixed(2), r.id, r.testerId, r.stableName, r.ruleKey, r.period, r.notes].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

export interface BudgetSummary {
  pendingCents: number;
  approvedCents: number;
  paidCents: number;
  budgetCents: number | null;
  /** pending + approved + paid exceeds the budget. */
  over: boolean;
}

export async function budgetSummary(ex: Executor, budgetCents: number | null): Promise<BudgetSummary> {
  const [s] = rowsOf<{ pending: number; approved: number; paid: number }>(
    await ex.execute(sql`select coalesce(sum(amount_usd_cents) filter (where status = 'pending'), 0)::int as pending,
                                coalesce(sum(amount_usd_cents) filter (where status = 'approved'), 0)::int as approved,
                                coalesce(sum(amount_usd_cents) filter (where status = 'paid'), 0)::int as paid from beta_rewards`),
  );
  const pending = Number(s?.pending ?? 0);
  const approved = Number(s?.approved ?? 0);
  const paid = Number(s?.paid ?? 0);
  return { pendingCents: pending, approvedCents: approved, paidCents: paid, budgetCents, over: budgetCents !== null && pending + approved + paid > budgetCents };
}

export interface TesterBetaProgress {
  daysPlayed: number;
  acceptedBugs: number;
  feedbackSent: number;
}

/** A tester's own progress for /beta: days played over the beta, feedback sent and accepted bugs. */
export async function testerBetaProgress(ex: Executor, input: { testerId: string }): Promise<TesterBetaProgress> {
  const [d] = rowsOf<{ days: number }>(
    await ex.execute(sql`select count(distinct (created_at at time zone 'UTC')::date)::int as days from telemetry_events where tester_id = ${input.testerId}`),
  );
  const [b] = rowsOf<{ sent: number; accepted: number }>(
    await ex.execute(sql`select count(*)::int as sent, count(*) filter (where accepted_bug)::int as accepted from feedback where tester_id = ${input.testerId}`),
  );
  return { daysPlayed: Number(d?.days ?? 0), acceptedBugs: Number(b?.accepted ?? 0), feedbackSent: Number(b?.sent ?? 0) };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Every game-progress table. The playtest tables (invite_codes, testers, tester_rewards,
 * feedback, telemetry_events, beta_reward_rules, beta_rewards), economy_config, seasons and
 * the migration book-keeping are kept.
 */
export const RESET_TABLES = [
  // The affiliate tree follows the accounts (beta money: referral_earnings, chain_orders,
  // pool_* and wallet data on testers survive).
  "referrals",
  "audit_log",
  "hall_of_fame",
  "achievements",
  "foal_crop",
  "pack_pulls",
  "pack_pity",
  "trades",
  "market_listings",
  "league_members",
  "leagues",
  "daily_cup_entries",
  "daily_goals",
  "inbox_items",
  "entry_movements",
  "race_results",
  "race_entries",
  "races",
  "pregnancies",
  "breeding_events",
  "ledger_postings",
  "ledger_transactions",
  "ledger_accounts",
  "training_plans",
  "care_log",
  "lineage_edges",
  "horses",
  "stables",
  "account_play_days",
  "fraud_events",
  "account_links",
  "link_codes",
  "account_devices",
  "accounts",
] as const;

export const RESET_CONFIRMATION = "RESET PLAYTEST";

/**
 * Wipes all game progress (accounts, stables, horses, races, the ledger...) and keeps the
 * playtest records: testers (flags, wallets), invite codes, tester rewards, feedback,
 * telemetry and beta rewards. Testers are unlinked from their (deleted) accounts and re-join
 * with their own invite code. Idempotent: running it again leaves the same empty game.
 */
export async function resetPlaytest(db: Db, input: { confirm: string; now?: Date }): Promise<{ tables: number; testersUnlinked: number }> {
  if (input.confirm !== RESET_CONFIRMATION) throw new DomainError("INVALID_INPUT", `type "${RESET_CONFIRMATION}" to confirm`);
  return runTx(db, async (tx) => {
    // TRUNCATE skips the row-level append-only ledger triggers by design (whole-table reset).
    await tx.execute(sql.raw(`TRUNCATE TABLE ${RESET_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`));
    await tx.execute(
      sql.raw(`INSERT INTO ledger_accounts (kind, currency, allow_negative) VALUES ('mint', 'CR', true), ('burn', 'CR', false), ('treasury', 'CR', false), ('escrow', 'CR', false)`),
    );
    const unlinked = await tx.update(testers).set({ accountId: null }).where(sql`${testers.accountId} is not null`).returning({ id: testers.id });
    await tx.insert(telemetryEvents).values({ accountId: null, testerId: null, name: "page_view", props: { route: "/admin#reset", reset: true }, createdAt: input.now ?? new Date() });
    return { tables: RESET_TABLES.length, testersUnlinked: unlinked.length };
  });
}

