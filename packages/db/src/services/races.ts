/**
 * Races: create (seed committed), enter (locks the horse), simulate input (seed revealed
 * only at post time), settle (idempotent by race id), cancel.
 *
 * The racing engine runs in the web app: it loads `getRaceForSimulation`, simulates, and
 * hands the outcome to `settleRace`. Settlement is safe to call any number of times, from
 * any instance (first read after post time, cron backstop): the race row lock plus the
 * ledger idempotency key make it happen exactly once.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { commitSeed, newSeed } from "../crypto";
import { DomainError } from "../errors";
import { horses, raceEntries, raceResults, races, type HorseRow, type RaceEntryRow, type RaceRow } from "../schema";
import { bps, defaultHooks, RULES, stageFor, type GameHooks } from "../rules";
import type { Db, Executor } from "../types";
import { accountIdOfStable, recordPlayDay, stableOf } from "./accounts";
import { isCarrying, lockHorse, startsOnDay } from "./horses";
import { playerLedgerAccountId, post, spendCreditsTx, systemAccountId, type Posting } from "./ledger";
import { audit, runTx } from "./tx";

export type RaceKind = RaceRow["kind"];

export interface CreateRaceInput {
  kind: RaceKind;
  name: string;
  raceClass: string;
  conditions: Record<string, unknown>;
  postTime: Date;
  entriesCloseAt: Date;
  purse?: number;
  entryFee?: number;
  maxRunners?: number;
  seasonNumber?: number | null;
  /** Optional externally derived seed (e.g. HMAC(secret, raceId)); random by default. */
  seed?: string;
}

/** Public view: never includes the secret seed. */
export type PublicRace = Omit<RaceRow, "seed">;

function publicRace(r: RaceRow): PublicRace {
  const { seed: _seed, ...rest } = r;
  return rest;
}

export async function createRace(db: Executor, input: CreateRaceInput): Promise<PublicRace> {
  const seed = input.seed ?? newSeed();
  const [row] = await db
    .insert(races)
    .values({
      kind: input.kind,
      name: input.name,
      raceClass: input.raceClass,
      conditions: input.conditions,
      postTime: input.postTime,
      entriesCloseAt: input.entriesCloseAt,
      purse: input.purse ?? 0,
      entryFee: input.entryFee ?? 0,
      maxRunners: input.maxRunners ?? 12,
      seasonNumber: input.seasonNumber ?? null,
      seed,
      seedCommitment: commitSeed(seed),
    })
    .returning();
  return publicRace(row!);
}

export async function getRace(ex: Executor, raceId: string): Promise<PublicRace | null> {
  const [r] = await ex.select().from(races).where(eq(races.id, raceId));
  return r ? publicRace(r) : null;
}

export async function listRaceEntries(ex: Executor, raceId: string): Promise<RaceEntryRow[]> {
  return ex.select().from(raceEntries).where(eq(raceEntries.raceId, raceId)).orderBy(asc(raceEntries.gate));
}

/** Immutable snapshot stored with the entry (what the engine races). */
export function horseSnapshot(h: HorseRow): Record<string, unknown> {
  return {
    id: h.id,
    name: h.name,
    sex: h.sex,
    ownerStableId: h.ownerStableId,
    sireId: h.sireId,
    damId: h.damId,
    generation: h.generation,
    stage: h.stage,
    starts: h.starts,
    rating: h.rating,
    stats: h.stats,
    genome: h.genome,
    appearance: h.appearance,
    maturityType: h.maturityType,
    fitness: h.fitness,
    fatigue: h.fatigue,
    freshness: h.freshness,
    form: h.form,
    morale: h.morale,
    bond: h.bond,
    quirks: h.quirks,
    dynamics: h.dynamics,
    record: { starts: h.starts, wins: h.wins, places: h.places, shows: h.shows, earnings: h.earnings },
  };
}

/** Hard racing eligibility. Returns a DomainError to throw, or null. */
export function racingBlock(h: HorseRow, race: RaceRow, now: Date): DomainError | null {
  if (h.careerStatus !== "racing") return new DomainError("HORSE_RETIRED", "retired horses cannot race");
  if (h.starts >= RULES.maxStarts) return new DomainError("HORSE_RETIRED", "career complete");
  const nursery = stageFor(h.careSessions, h.starts);
  const ofAge = h.careSessions >= RULES.careToRacing || (race.kind === "trial" && nursery === "yearling");
  if (!ofAge) return new DomainError("HORSE_NOT_OF_AGE", "not yet of racing age");
  if (h.lockKind) return new DomainError("HORSE_LOCKED", h.lockKind === "race" ? "already entered in a race" : "listed on the market");
  if (h.injuredUntil && h.injuredUntil > now) return new DomainError("HORSE_INJURED", "recovering from injury");
  return null;
}

export interface EnterRaceInput {
  /** Null = a Club/house horse filling the field (horse must have no owner). */
  accountId: string | null;
  raceId: string;
  horseId: string;
  tactic: string;
  now: Date;
}

export async function enterRace(db: Db, input: EnterRaceInput, hooks: GameHooks = defaultHooks): Promise<RaceEntryRow> {
  return runTx(db, async (tx) => {
    // Race row lock serialises entries for this race (field size, gate numbers).
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (race.status !== "open" || input.now >= race.entriesCloseAt) throw new DomainError("RACE_CLOSED", "entries are closed");

    const stable = input.accountId ? await stableOf(tx, input.accountId) : null;
    const horse = await lockHorse(tx, input.horseId);
    if ((stable?.id ?? null) !== horse.ownerStableId) throw new DomainError("NOT_OWNER", "not your horse");
    const block = racingBlock(horse, race, input.now);
    if (block) throw block;
    if (await isCarrying(tx, horse.id)) throw new DomainError("HORSE_IN_FOAL", "mares in foal do not race");
    // Hard cap: starts per horse per day (horse row lock makes the count race-free).
    if ((await startsOnDay(tx, horse.id, race.postTime)) >= RULES.startsPerDay) {
      throw new DomainError("RACE_LIMIT", `at most ${RULES.startsPerDay} starts per horse per day`);
    }
    const reason = hooks.raceEligibility?.({ horse, race, now: input.now });
    if (reason) throw new DomainError("NOT_ELIGIBLE", reason);

    const [field] = await tx
      .select({ n: sql<number>`count(*)::int`, maxGate: sql<number>`coalesce(max(${raceEntries.gate}), 0)::int` })
      .from(raceEntries)
      .where(eq(raceEntries.raceId, race.id));
    if (Number(field!.n) >= race.maxRunners) throw new DomainError("RACE_FULL", "the field is full");

    if (race.entryFee > 0 && input.accountId) {
      await spendCreditsTx(tx, {
        accountId: input.accountId,
        amount: race.entryFee,
        idempotencyKey: `entry-fee:${race.id}:${horse.id}`,
        kind: "entry_fee",
      });
    }
    const [entry] = await tx
      .insert(raceEntries)
      .values({
        raceId: race.id,
        horseId: horse.id,
        stableId: stable?.id ?? null,
        gate: Number(field!.maxGate) + 1,
        tactic: input.tactic,
        snapshot: horseSnapshot(horse),
        ratingBefore: horse.rating,
      })
      .returning();
    await tx.update(horses).set({ lockKind: "race", lockRef: race.id, updatedAt: input.now }).where(eq(horses.id, horse.id));
    if (input.accountId) {
      await recordPlayDay(tx, input.accountId, input.now);
      await audit(tx, { actor: input.accountId, action: "race.enter", entityType: "race", entityId: race.id, data: { horseId: horse.id } });
    }
    return entry!;
  });
}

export interface SimulationInput {
  race: RaceRow;
  entries: RaceEntryRow[];
}

/** Everything the engine needs, including the revealed seed. Throws TOO_EARLY before post time. */
export async function getRaceForSimulation(db: Db, raceId: string, now: Date): Promise<SimulationInput> {
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race) throw new DomainError("NOT_FOUND", "race not found");
  if (now < race.postTime) throw new DomainError("TOO_EARLY", "the seed is revealed at post time");
  if (race.status === "open") {
    await db.update(races).set({ status: "closed" }).where(and(eq(races.id, race.id), eq(races.status, "open")));
    race.status = "closed";
  }
  return { race, entries: await listRaceEntries(db, race.id) };
}

export interface RunnerOutcome {
  horseId: string;
  position: number;
  finishTimeUs?: number;
  /** New official rating (game-core ratings); unchanged if omitted. */
  ratingAfter?: number;
  /** Injury from this run. Career-ending forces racing retirement (never death). */
  injury?: { severity: "minor" | "moderate" | "career_ending"; recoveryMs: number; detail?: Record<string, unknown> } | null;
  quirksRevealed?: string[];
  /** Post-race condition snapshot (permille). */
  condition?: Partial<Pick<HorseRow, "fitness" | "fatigue" | "freshness" | "form" | "morale" | "bond">>;
  /** Merged into horses.dynamics (recent runs, realisation ...). */
  dynamics?: Record<string, unknown>;
  stats?: unknown;
}

export interface SettleInput {
  raceId: string;
  now: Date;
  runners: RunnerOutcome[];
  resultHash: string;
  engineVersion?: string;
  /** Finish order, margins, etc. as produced by the engine (stored as jsonb). */
  result: unknown;
}

export interface SettleResult {
  alreadySettled: boolean;
  prizes: Record<string, number>;
  retired: string[];
}

export async function settleRace(db: Db, input: SettleInput): Promise<SettleResult> {
  return runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    const entries = await listRaceEntries(tx, race.id);
    if (race.status === "settled") {
      return { alreadySettled: true, prizes: Object.fromEntries(entries.map((e) => [e.horseId, e.prize])), retired: [] };
    }
    if (race.status === "cancelled") throw new DomainError("RACE_CLOSED", "race was cancelled");
    if (input.now < race.postTime) throw new DomainError("TOO_EARLY", "race has not run yet");

    const byHorse = new Map(input.runners.map((r) => [r.horseId, r]));
    if (byHorse.size !== entries.length || entries.some((e) => !byHorse.has(e.horseId))) {
      throw new DomainError("INVALID_INPUT", "outcome must cover exactly the race entries");
    }

    // Purses: minted to each placed, owned runner's stable account, in one ledger transaction.
    const prizes: Record<string, number> = {};
    const postings: Posting[] = [];
    let minted = 0;
    for (const e of entries) {
      const r = byHorse.get(e.horseId)!;
      const share = RULES.purseSplitBps[r.position - 1] ?? 0;
      const prize = bps(race.purse, share);
      prizes[e.horseId] = prize;
      if (prize > 0 && e.stableId) {
        postings.push({ ledgerAccountId: await playerLedgerAccountId(tx, await accountIdOfStable(tx, e.stableId)), amount: prize });
        minted += prize;
      }
    }
    let ledgerTransactionId: string | null = null;
    if (minted > 0) {
      postings.push({ ledgerAccountId: await systemAccountId(tx, "mint"), amount: -minted });
      ledgerTransactionId = (await post(tx, { idempotencyKey: `purse:${race.id}`, kind: "purse", postings, meta: { raceId: race.id } })).transactionId;
    }

    const retired: string[] = [];
    for (const e of entries) {
      const r = byHorse.get(e.horseId)!;
      const h = await lockHorse(tx, e.horseId);
      const starts = Math.min(RULES.maxStarts, h.starts + 1);
      const careerEnding = r.injury?.severity === "career_ending";
      const mustRetire = h.careerStatus === "racing" && (starts >= RULES.maxStarts || careerEnding);
      const quirks = [...new Set([...((h.quirks as string[]) ?? []), ...(r.quirksRevealed ?? [])])];
      if (mustRetire) retired.push(h.id);
      await tx
        .update(horses)
        .set({
          starts,
          wins: h.wins + (r.position === 1 ? 1 : 0),
          places: h.places + (r.position === 2 ? 1 : 0),
          shows: h.shows + (r.position === 3 ? 1 : 0),
          earnings: h.earnings + (prizes[h.id] ?? 0),
          rating: r.ratingAfter ?? h.rating,
          stage: stageFor(h.careSessions, starts),
          quirks,
          stats: r.stats ?? h.stats,
          dynamics: r.dynamics ? { ...(h.dynamics as Record<string, unknown>), ...r.dynamics } : h.dynamics,
          ...(r.condition ?? {}),
          ...(r.injury
            ? { injury: { severity: r.injury.severity, raceId: race.id, ...(r.injury.detail ?? {}) }, injuredUntil: new Date(input.now.getTime() + r.injury.recoveryMs) }
            : {}),
          ...(mustRetire
            ? { careerStatus: "retired" as const, retirementReason: careerEnding ? ("injury" as const) : ("max_starts" as const), retiredAt: input.now }
            : {}),
          ...(h.lockKind === "race" && h.lockRef === race.id ? { lockKind: null, lockRef: null } : {}),
          updatedAt: input.now,
        })
        .where(eq(horses.id, h.id));
      await tx
        .update(raceEntries)
        .set({ finishPosition: r.position, finishTimeUs: r.finishTimeUs ?? null, prize: prizes[h.id] ?? 0, ratingAfter: r.ratingAfter ?? h.rating })
        .where(eq(raceEntries.id, e.id));
      // Insurance pays out on a career-ending injury.
      if (careerEnding && h.insured && e.stableId) {
        const ownerAccountId = await accountIdOfStable(tx, e.stableId);
        const mint = await systemAccountId(tx, "mint");
        await post(tx, {
          idempotencyKey: `insurance-payout:${h.id}`,
          kind: "insurance_payout",
          postings: [
            { ledgerAccountId: mint, amount: -RULES.insurancePayout },
            { ledgerAccountId: await playerLedgerAccountId(tx, ownerAccountId), amount: RULES.insurancePayout },
          ],
        });
      }
    }

    if (commitSeed(race.seed) !== race.seedCommitment) throw new Error("seed does not match its commitment");
    await tx.insert(raceResults).values({
      raceId: race.id,
      seedCommitment: race.seedCommitment,
      seedReveal: race.seed,
      resultHash: input.resultHash,
      engineVersion: input.engineVersion ?? null,
      result: input.result,
      ledgerTransactionId,
    });
    await tx.update(races).set({ status: "settled", settledAt: input.now }).where(eq(races.id, race.id));
    await audit(tx, { actor: null, action: "race.settle", entityType: "race", entityId: race.id, data: { prizes, retired, resultHash: input.resultHash } });
    return { alreadySettled: false, prizes, retired };
  });
}

/** Cancels an unsettled race: refunds entry fees and unlocks horses. Idempotent. */
export async function cancelRace(db: Db, input: { raceId: string; now: Date; reason: string }): Promise<void> {
  await runTx(db, async (tx) => {
    const [race] = await tx.select().from(races).where(eq(races.id, input.raceId)).for("update");
    if (!race) throw new DomainError("NOT_FOUND", "race not found");
    if (race.status === "cancelled") return;
    if (race.status === "settled") throw new DomainError("RACE_CLOSED", "race already settled");
    for (const e of await listRaceEntries(tx, race.id)) {
      const h = await lockHorse(tx, e.horseId);
      if (h.lockKind === "race" && h.lockRef === race.id) {
        await tx.update(horses).set({ lockKind: null, lockRef: null }).where(eq(horses.id, h.id));
      }
      if (race.entryFee > 0 && e.stableId) {
        const ownerAccountId = await accountIdOfStable(tx, e.stableId);
        await post(tx, {
          idempotencyKey: `entry-refund:${race.id}:${e.horseId}`,
          kind: "entry_fee_refund",
          postings: [
            { ledgerAccountId: await systemAccountId(tx, "burn"), amount: -race.entryFee },
            { ledgerAccountId: await playerLedgerAccountId(tx, ownerAccountId), amount: race.entryFee },
          ],
        });
      }
    }
    await tx.update(races).set({ status: "cancelled" }).where(eq(races.id, race.id));
    await audit(tx, { actor: null, action: "race.cancel", entityType: "race", entityId: race.id, data: { reason: input.reason } });
  });
}

export async function getRaceResult(ex: Executor, raceId: string) {
  const [r] = await ex.select().from(raceResults).where(eq(raceResults.raceId, raceId));
  return r ?? null;
}
