/**
 * The horse's log: one chronological timeline of everything that happened to a horse, newest
 * first, paged by a cursor.
 *
 * Sources (each read by an index on the horse):
 *   - horse_log: training sessions (workout, realisation gained per stat, fatigue before and
 *     after, realisation after), vet treatments, injuries and quirks from races;
 *   - care_log: care sessions;
 *   - race_entries + races: every start (settled ones with the result and the rating change;
 *     a race still to run or running shows no result), plus the improver's step-up, derived
 *     from game-core progressionOf at the start where it began (never in advance);
 *   - the horse row: born, graduated, retired, Legacy Farm, released, died;
 *   - ledger (exact key): the Pedigree Scan; audit_log: renames;
 *   - breeding_events / horses (sire_id, dam_id): covers and foals;
 *   - trades, race_claims: ownership changes; horse_leases: lease periods.
 *
 * Paging: the cursor is `atMs:key` of the last entry served; each source reads at most
 * `limit + SLACK` rows at or before the cursor time, the merge drops anything not strictly
 * after the cursor in (time, key) order, so a page is exact even when entries share a time.
 */
import { aliasedTable, and, desc, eq, inArray, lte, ne, or } from "drizzle-orm";
import {
  auditLog,
  breedingEvents,
  careLog,
  horseLeases,
  horseLog,
  horses,
  ledgerTransactions,
  raceClaims,
  raceEntries,
  raceResults,
  races,
  stables,
  trades,
  type HorseRow,
} from "../schema";
import { gc, isGenome, toHorseState } from "../gameCore";
import type { Executor } from "../types";
import { formColumns, formLineOf, resultJoin, type FormLine } from "./formBook";

export type HorseLogKind =
  | "training"
  | "care"
  | "race"
  | "injury"
  | "vet"
  | "quirk"
  | "scan"
  | "improver"
  | "born"
  | "graduated"
  | "retired"
  | "legacy_farm"
  | "died"
  | "released"
  | "renamed"
  | "cover"
  | "foal"
  | "sold"
  | "claimed"
  | "lease_start"
  | "lease_end";

export interface HorseLogEntry {
  /** Unique within the horse's log; the cursor's tie-break. */
  key: string;
  kind: HorseLogKind;
  atMs: number;
  /** A race to link (its replay). */
  raceId?: string | null;
  /** Another horse to link (a foal, a covering partner). */
  horseId?: string | null;
  /** Kind-specific facts (see the writers and readers below). */
  data: Record<string, unknown>;
  /** Races only: the full form line (no result before settlement). */
  line?: FormLine;
}

export interface HorseLogPage {
  entries: HorseLogEntry[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface HorseLogWrite {
  horseId: string;
  kind: "training" | "vet" | "injury" | "quirk";
  stableId?: string | null;
  raceId?: string | null;
  at: Date;
  data: Record<string, unknown>;
  /** Unique per horse: a retried write is a no-op. */
  dedupeKey: string;
}

/** Appends to the horse's log on the caller's transaction (idempotent per horse and key). */
export async function logHorseEventTx(ex: Executor, e: HorseLogWrite): Promise<void> {
  await ex
    .insert(horseLog)
    .values({ horseId: e.horseId, kind: e.kind, stableId: e.stableId ?? null, raceId: e.raceId ?? null, at: e.at, data: e.data, dedupeKey: e.dedupeKey })
    .onConflictDoNothing({ target: [horseLog.horseId, horseLog.dedupeKey] });
}

/**
 * What a race did to a horse that only the settlement knows: an injury picked up in it (with
 * when the horse is expected back) and quirks it revealed. Called by settleRace per runner.
 */
export async function logRaceOutcomeTx(
  ex: Executor,
  input: {
    raceId: string;
    horse: Pick<HorseRow, "id" | "quirks">;
    stableId: string | null;
    now: Date;
    fatal: boolean;
    injury?: { severity: string; recoveryMs: number } | null;
    state?: gc.HorseState;
    quirksRevealed?: string[];
  },
): Promise<void> {
  const fromState = input.state?.injury && input.state.injury.source === input.raceId ? input.state.injury : null;
  const severity = input.fatal ? "fatal" : (input.injury?.severity ?? fromState?.severity ?? null);
  if (severity) {
    const nowMs = input.now.getTime();
    const backAtMs = input.fatal ? null : input.injury ? nowMs + input.injury.recoveryMs : fromState ? nowMs + Math.ceil(gc.hoursToHeal(fromState, nowMs)) * 3_600_000 : null;
    // the catalogue name (game-core injuries.ts), when the injury has one
    const kind = fromState?.kind ?? null;
    await logHorseEventTx(ex, { horseId: input.horse.id, kind: "injury", stableId: input.stableId, raceId: input.raceId, at: input.now, dedupeKey: `injury:race:${input.raceId}`, data: { severity, source: "race", backAtMs, ...(kind ? { injuryKind: kind } : {}) } });
  }
  const had = new Set((input.horse.quirks as string[] | null) ?? []);
  const fresh = [...new Set([...(input.quirksRevealed ?? []), ...(input.state?.reveal.quirks ?? [])])].filter((q) => !had.has(q)).sort();
  if (fresh.length) {
    await logHorseEventTx(ex, { horseId: input.horse.id, kind: "quirk", stableId: input.stableId, raceId: input.raceId, at: input.now, dedupeKey: `quirk:race:${input.raceId}`, data: { quirks: fresh } });
  }
}

/** The training entries a horse's log keeps (newest first): for tests and the training board. */
export async function trainingLogOf(ex: Executor, horseId: string, limit = 20) {
  return ex
    .select()
    .from(horseLog)
    .where(and(eq(horseLog.horseId, horseId), eq(horseLog.kind, "training")))
    .orderBy(desc(horseLog.at))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Extra rows read per source beyond the page, for entries sharing the cursor's time. */
const SLACK = 20;

function parseCursor(cursor: string | null | undefined): { atMs: number; key: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf(":");
  if (i <= 0) return null;
  const atMs = Number(cursor.slice(0, i));
  const key = cursor.slice(i + 1);
  return Number.isSafeInteger(atMs) && key ? { atMs, key } : null;
}

/** Newest first: later time, then the greater key. */
function newerFirst(a: HorseLogEntry, b: HorseLogEntry): number {
  return b.atMs - a.atMs || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
}

const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);

/**
 * One page of a horse's log, newest first. `keeper`: the viewer keeps or owns the horse (the
 * page is only served to them; the flag also opens the form lines' condition columns).
 */
export async function horseLogPage(ex: Executor, horse: HorseRow, opts: { now: Date; cursor?: string | null; limit?: number; keeper?: boolean }): Promise<HorseLogPage> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
  const take = limit + SLACK + 1;
  const cur = parseCursor(opts.cursor);
  const before = cur ? new Date(cur.atMs) : null;
  const nowMs = opts.now.getTime();
  const out: HorseLogEntry[] = [];

  // horse_log: training, vet, injury, quirk.
  const logRows = await ex
    .select()
    .from(horseLog)
    .where(and(eq(horseLog.horseId, horse.id), before ? lte(horseLog.at, before) : undefined))
    .orderBy(desc(horseLog.at), desc(horseLog.id))
    .limit(take);
  for (const r of logRows) {
    out.push({ key: `${r.kind}:${r.dedupeKey}`, kind: r.kind as HorseLogKind, atMs: r.at.getTime(), raceId: r.raceId, data: (r.data ?? {}) as Record<string, unknown> });
  }

  // Care sessions.
  const care = await ex
    .select()
    .from(careLog)
    .where(and(eq(careLog.horseId, horse.id), before ? lte(careLog.createdAt, before) : undefined))
    .orderBy(desc(careLog.createdAt))
    .limit(take);
  for (const r of care) {
    const a = (r.actions ?? {}) as Record<string, unknown>;
    out.push({ key: `care:${r.day}`, kind: "care", atMs: r.createdAt.getTime(), data: { day: r.day, feed: a.feed ?? null, groom: a.groom !== false, turnout: a.turnout !== false, quality: r.quality } });
  }

  // Races: every start, with the form line (no result before settlement).
  const runs = await ex
    .select(formColumns)
    .from(raceEntries)
    .innerJoin(races, eq(races.id, raceEntries.raceId))
    .leftJoin(raceResults, resultJoin)
    .where(and(eq(raceEntries.horseId, horse.id), eq(raceEntries.status, "entered"), inArray(races.status, ["open", "locked", "settled"]), before ? lte(races.postTime, before) : undefined))
    .orderBy(desc(races.postTime), desc(races.id))
    .limit(take);
  for (const r of runs) {
    const line = formLineOf(r, { nowMs, keeper: opts.keeper ?? false });
    out.push({ key: `race:${r.raceId}`, kind: "race", atMs: line.postTimeMs, raceId: r.raceId, data: {}, line });
  }

  // The improver's step-up: at the career start after which progressionOf first moves.
  if (isGenome(horse.genome)) {
    const careerRuns = await ex
      .select({ raceId: races.id, postTime: races.postTime })
      .from(raceEntries)
      .innerJoin(races, eq(races.id, raceEntries.raceId))
      .where(and(eq(raceEntries.horseId, horse.id), eq(raceEntries.status, "entered"), eq(races.status, "settled"), ne(races.kind, "quick")))
      .orderBy(races.postTime, races.id);
    const state = toHorseState(horse);
    for (let i = 0; i < careerRuns.length; i++) {
      const was = gc.progressionOf({ ...state, career: { ...state.career, starts: i } }).orNow;
      const now = gc.progressionOf({ ...state, career: { ...state.career, starts: i + 1 } }).orNow;
      if (was === 0 && now > 0) {
        const r = careerRuns[i]!;
        // A moment after the race itself, so it reads after the run that set it off.
        out.push({ key: `improver:${r.raceId}`, kind: "improver", atMs: r.postTime.getTime() + 1, raceId: r.raceId, data: { start: i + 1 } });
        break;
      }
    }
  }

  // The horse's own milestones.
  const dyn = (horse.dynamics ?? {}) as { graduatedAtMs?: unknown; diedAtMs?: unknown; diedAtRaceId?: unknown };
  out.push({ key: "born", kind: "born", atMs: horse.bornAt.getTime(), data: { origin: horse.origin } });
  if (typeof dyn.graduatedAtMs === "number") out.push({ key: "graduated", kind: "graduated", atMs: dyn.graduatedAtMs, data: {} });
  if (horse.retiredAt) out.push({ key: "retired", kind: "retired", atMs: horse.retiredAt.getTime(), data: { reason: horse.retirementReason } });
  if (horse.pasturedAt && typeof dyn.diedAtMs !== "number") out.push({ key: "legacy_farm", kind: "legacy_farm", atMs: horse.pasturedAt.getTime(), data: {} });
  if (typeof dyn.diedAtMs === "number") out.push({ key: "died", kind: "died", atMs: dyn.diedAtMs, raceId: typeof dyn.diedAtRaceId === "string" ? dyn.diedAtRaceId : null, data: {} });
  if (horse.releasedAt) out.push({ key: "released", kind: "released", atMs: horse.releasedAt.getTime(), data: {} });

  // Pedigree Scan (one ledger row by its exact key) and renames (audit).
  const [scan] = await ex.select({ at: ledgerTransactions.createdAt }).from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, `scan:${horse.id}`));
  if (scan) out.push({ key: "scan", kind: "scan", atMs: scan.at.getTime(), data: { cost: gc.PEDIGREE_SCAN_COST } });
  const renames = await ex
    .select({ id: auditLog.id, at: auditLog.createdAt, data: auditLog.data })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "horse"), eq(auditLog.entityId, horse.id), eq(auditLog.action, "horse.rename")));
  for (const r of renames) {
    const d = (r.data ?? {}) as { from?: unknown; to?: unknown };
    out.push({ key: `renamed:${r.id}`, kind: "renamed", atMs: r.at.getTime(), data: { from: d.from ?? null, to: d.to ?? null } });
  }

  // Breeding: covers (as sire or dam) and foals.
  const partner = aliasedTable(horses, "partner");
  const covers = await ex
    .select({ id: breedingEvents.id, at: breedingEvents.createdAt, sireId: breedingEvents.sireId, damId: breedingEvents.damId, partnerName: partner.name, partnerId: partner.id })
    .from(breedingEvents)
    .innerJoin(partner, or(and(eq(breedingEvents.sireId, horse.id), eq(partner.id, breedingEvents.damId)), and(eq(breedingEvents.damId, horse.id), eq(partner.id, breedingEvents.sireId))))
    .where(or(eq(breedingEvents.sireId, horse.id), eq(breedingEvents.damId, horse.id)));
  for (const c of covers) {
    out.push({ key: `cover:${c.id}`, kind: "cover", atMs: c.at.getTime(), horseId: c.partnerId, data: { role: c.sireId === horse.id ? "sire" : "dam", partner: c.partnerName } });
  }
  const foals = await ex
    .select({ id: horses.id, name: horses.name, bornAt: horses.bornAt, sex: horses.sex })
    .from(horses)
    .where(or(eq(horses.sireId, horse.id), eq(horses.damId, horse.id)));
  for (const f of foals) out.push({ key: `foal:${f.id}`, kind: "foal", atMs: f.bornAt.getTime(), horseId: f.id, data: { name: f.name, sex: f.sex } });

  // Ownership (market sales, claims) and lease periods; stable names in one read.
  const sales = await ex
    .select({ id: trades.id, at: trades.createdAt, price: trades.price, club: trades.club, from: trades.sellerStableId, to: trades.buyerStableId })
    .from(trades)
    .where(eq(trades.horseId, horse.id));
  const claims = await ex
    .select({ id: raceClaims.id, at: raceClaims.closedAt, raceId: raceClaims.raceId, price: raceClaims.price, from: raceClaims.ownerStableId, to: raceClaims.claimantStableId })
    .from(raceClaims)
    .where(and(eq(raceClaims.horseId, horse.id), eq(raceClaims.status, "claimed")));
  const leases = await ex.select().from(horseLeases).where(eq(horseLeases.horseId, horse.id));
  const stableIds = [...new Set([...sales.flatMap((t) => [t.from, t.to]), ...claims.flatMap((c) => [c.from, c.to]), ...leases.flatMap((l) => [l.ownerStableId, l.lesseeStableId])])].filter(
    (x): x is string => !!x,
  );
  const names = new Map(stableIds.length ? (await ex.select({ id: stables.id, name: stables.name }).from(stables).where(inArray(stables.id, stableIds))).map((s) => [s.id, s.name]) : []);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  for (const t of sales) out.push({ key: `sold:${t.id}`, kind: "sold", atMs: t.at.getTime(), data: { price: t.price, from: t.club ? null : nameOf(t.from), to: nameOf(t.to) } });
  for (const c of claims) if (c.at) out.push({ key: `claimed:${c.id}`, kind: "claimed", atMs: c.at.getTime(), raceId: c.raceId, data: { price: c.price, from: nameOf(c.from), to: nameOf(c.to) } });
  for (const l of leases) {
    const who = { owner: l.club ? null : nameOf(l.ownerStableId), lessee: nameOf(l.lesseeStableId) };
    out.push({ key: `lease_start:${l.id}`, kind: "lease_start", atMs: l.startsAt.getTime(), data: { ...who, termDays: l.termDays, ownerSharePct: l.ownerSharePct, endsAtMs: ms(l.endsAt) } });
    if (l.endedAt) out.push({ key: `lease_end:${l.id}`, kind: "lease_end", atMs: l.endedAt.getTime(), data: { ...who, reason: l.endReason, races: l.races } });
  }

  const after = (e: HorseLogEntry) => !cur || e.atMs < cur.atMs || (e.atMs === cur.atMs && e.key < cur.key);
  const merged = out.filter(after).sort(newerFirst);
  const page = merged.slice(0, limit);
  const last = page[page.length - 1];
  return { entries: page, nextCursor: merged.length > limit && last ? `${last.atMs}:${last.key}` : null };
}
