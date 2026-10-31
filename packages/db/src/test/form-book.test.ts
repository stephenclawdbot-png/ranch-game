/**
 * The form book and the horse's log: form lines from the entry snapshot, the locked field and
 * the settled result (old races without the newer fields included); no result before a race
 * settles; training sessions persisted with their gains; race injuries and quirks logged at
 * settlement; the log's ordering and cursor paging.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { horseLog, raceEntries, races } from "../schema";
import { careForHorse, runTrainingSession } from "../services/horseLife";
import { formLineOf, horseFormRows, settledFormRows, splitRunOf, splitsOf } from "../services/formBook";
import { horseLogPage, logHorseEventTx, trainingLogOf, type HorseLogEntry } from "../services/horseLog";
import { createRace, enterRace, getRaceForSimulation, settleRace, type RunnerOutcome } from "../services/races";
import { gc } from "../gameCore";
import { at, DAY, getHorseRow, makeHorse, memoryDb, MIN, newPlayer, T0 } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

/** Settles a race with `first` in front; margins 1 m between each finisher. */
async function runRace(raceId: string, now: Date, first: string[], extra: Record<string, Partial<RunnerOutcome>> = {}) {
  const { field } = await getRaceForSimulation(h.db, raceId, now);
  const order = [...first, ...field.runners.map((r) => r.horseId).filter((id) => !first.includes(id))];
  const finishOrder = order.map((horseId, i) => ({ horseId, position: i + 1, finishTimeUs: 70_000_000 + i * 200_000, marginMm: i === 0 ? 0 : 1000, marginLabel: i === 0 ? "" : "neck", prize: 0 }));
  await settleRace(h.db, {
    raceId,
    now,
    resultHash: "0".repeat(64),
    result: { finishOrder, winningTimeUs: 70_000_000, photoFinish: false, resultHash: "0".repeat(64) },
    runners: order.map((horseId, i) => ({ horseId, position: i + 1, finishTimeUs: 70_000_000 + i * 200_000, ratingAfter: 30 + i, ...(extra[horseId] ?? {}) })),
  });
  return order;
}

async function newRace(name: string, postMs: number, conditions: Record<string, unknown>, kind: "scheduled" | "quick" = "scheduled") {
  return createRace(h.db, { kind, name, raceClass: "maiden", conditions, postTime: at(postMs), entriesCloseAt: at(postMs - MIN), targetRunners: 4, purse: 1000 });
}

describe("form lines", () => {
  it("maps a settled run from the snapshot, the locked field and the result", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 2 });
    const race = await newRace("Form Stakes", 10 * MIN, { distanceM: 2000, surface: "turf", going: "soft", track: "Saltmarsh" });
    await enterRace(h.db, {
      accountId: p.accountId,
      raceId: race.id,
      horseId: horse.id,
      tactic: "closer",
      now: T0,
      meta: { plan: { tactic: "closer", intensity: "all_out" } },
    });
    const order = await runRace(race.id, at(11 * MIN), []);
    const pos = order.indexOf(horse.id) + 1;
    const [row] = await horseFormRows(h.db, horse.id);
    const line = formLineOf(row!, { nowMs: at(12 * MIN).getTime(), keeper: true });
    expect(line).toMatchObject({
      status: "settled",
      raceName: "Form Stakes",
      kind: "live",
      course: "Saltmarsh",
      distanceM: 2000,
      surface: "turf",
      going: "soft",
      tactic: "closer",
      intensity: "all_out",
      jockey: { tier: "apprentice", name: null },
      extras: [],
      purse: 1000,
    });
    expect(line.fieldSize).toBe(order.length);
    expect(line.gate).toBeGreaterThanOrEqual(1);
    expect(line.result).toMatchObject({ position: pos, beatenMm: (pos - 1) * 1000, winningTimeUs: 70_000_000, timeUs: 70_000_000 + (pos - 1) * 200_000, ratingAfter: 30 + pos - 1 });
    expect(line.result!.marginLabel).toBe(pos === 1 ? "neck" : "neck");
    // Condition at the off: recovered from the snapshot's state (keeper only).
    expect(line.fatigue).not.toBeNull();
    expect(line.freshness).not.toBeNull();
    const pub = formLineOf(row!, { nowMs: at(12 * MIN).getTime(), keeper: false });
    expect(pub.fatigue).toBeNull();
    expect(pub.intensity).toBeNull();
    expect(splitRunOf(line)).toMatchObject({ position: pos, going: "soft", course: "Saltmarsh", jockey: "apprentice", tactic: "closer" });
  });

  it("reads an old race without course, plan, race day, field or margins", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    const race = await newRace("Old Plate", -2 * DAY, {});
    await h.db.update(races).set({ status: "settled" }).where(eq(races.id, race.id));
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId: p.stableId, gate: 3, tactic: "stalker", snapshot: {}, ratingBefore: 12, ratingAfter: 15, finishPosition: 2, prize: 150 });
    const [row] = await horseFormRows(h.db, horse.id);
    const line = formLineOf(row!, { nowMs: T0.getTime(), keeper: true });
    expect(line).toMatchObject({
      status: "settled",
      course: null,
      distanceM: 1600,
      surface: "turf",
      going: "good",
      tactic: "stalker",
      intensity: null,
      extras: [],
      weightLb: null,
      fatigue: null,
      freshness: null,
      fieldSize: 1,
      gate: 3,
      ratingBefore: 12,
      result: { position: 2, beatenMm: null, marginLabel: null, winningTimeUs: null, timeUs: null, ratingAfter: 15, prize: 150 },
    });
  });

  it("reads race-day extras, the jockey (tier, or a name once entries carry one) and the handicap weight", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    const race = await newRace("Weighted Handicap", -DAY, { distanceM: 1600, track: "Bellmont" });
    await h.db
      .update(races)
      .set({ status: "settled", field: { runners: [{ horseId: horse.id, gate: 2, weightLb: 131, extraWeightLb: 5 }, { horseId: "00000000-0000-4000-8000-000000000000", gate: 1 }] } })
      .where(eq(races.id, race.id));
    const snapshot = { plan: { tactic: "front", intensity: "conservative" }, raceDay: { extras: ["physio", "vet_check"], jockey: "top", paid: { extras: 40, jockey: 100 } } };
    await h.db.insert(raceEntries).values({ raceId: race.id, horseId: horse.id, stableId: p.stableId, gate: 2, tactic: "front", snapshot, ratingBefore: 40, ratingAfter: 41, finishPosition: 1, prize: 600 });
    const [row] = await horseFormRows(h.db, horse.id);
    const line = formLineOf(row!, { nowMs: T0.getTime(), keeper: true });
    expect(line).toMatchObject({ fieldSize: 2, gate: 2, weightLb: 131, extraWeightLb: 5, extras: ["physio", "vet_check"], jockey: { tier: "top", name: null }, intensity: "conservative" });
    // A named jockey (the jockeys feature) reads through.
    await h.db.update(raceEntries).set({ snapshot: { ...snapshot, jockey: { id: "j1", name: "Ada Quick" } } }).where(eq(raceEntries.horseId, horse.id));
    const [named] = await horseFormRows(h.db, horse.id);
    const l2 = formLineOf(named!, { nowMs: T0.getTime(), keeper: false });
    expect(l2.jockey).toEqual({ tier: "top", name: "Ada Quick" });
    expect(splitRunOf(l2)!.jockey).toBe("Ada Quick");
  });

  it("never shows a result before the race settles", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    const race = await newRace("Pending Cup", 30 * MIN, { distanceM: 1200, going: "firm" });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0 });
    // Even a row that somehow carries a position stays result-free until the race is settled.
    await h.db.update(raceEntries).set({ finishPosition: 1, prize: 999, ratingAfter: 99 }).where(eq(raceEntries.horseId, horse.id));
    const [row] = await horseFormRows(h.db, horse.id);
    expect(formLineOf(row!, { nowMs: T0.getTime(), keeper: true })).toMatchObject({ status: "declared", result: null });
    expect(formLineOf(row!, { nowMs: at(31 * MIN).getTime(), keeper: true })).toMatchObject({ status: "running", result: null });
    expect(splitRunOf(formLineOf(row!, { nowMs: at(31 * MIN).getTime(), keeper: true }))).toBeNull();
    // Splits read settled races only.
    expect(await settledFormRows(h.db, { horseId: horse.id })).toHaveLength(0);
    // A cancelled race drops out of the form.
    await h.db.update(races).set({ status: "cancelled" }).where(eq(races.id, race.id));
    expect(await horseFormRows(h.db, horse.id)).toHaveLength(0);
  });

  it("builds splits for a horse, a stable and a sire line from settled runs", async () => {
    const p = await newPlayer(h.db);
    const sire = await makeHorse(h.db, null, { name: "Splits Sire" });
    const a = await makeHorse(h.db, p.stableId, { sireId: sire.id });
    const b = await makeHorse(h.db, p.stableId, { sireId: sire.id });
    for (let i = 0; i < 3; i++) {
      const race = await newRace(`Split ${i}`, (i + 1) * DAY + 10 * MIN, { distanceM: 1200, going: i < 2 ? "good" : "soft", track: "Kestrel Downs" });
      await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: a.id, tactic: "front", now: at((i + 1) * DAY) });
      await runRace(race.id, at((i + 1) * DAY + 11 * MIN), [a.id]);
    }
    const race = await newRace("Split b", 5 * DAY + 10 * MIN, { distanceM: 2400, going: "heavy" });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: b.id, tactic: "stalker", now: at(5 * DAY) });
    await runRace(race.id, at(5 * DAY + 11 * MIN), []);

    const nowMs = at(6 * DAY).getTime();
    const horseLines = (await horseFormRows(h.db, a.id)).map((r) => formLineOf(r, { nowMs, keeper: true }));
    const s = splitsOf(horseLines);
    expect(s.total).toMatchObject({ runs: 3, wins: 3 });
    expect(s.groups.find((g) => g.dimension === "going")!.buckets.map((x) => [x.key, x.runs])).toEqual([
      ["good", 2],
      ["soft", 1],
    ]);
    const stable = splitsOf((await settledFormRows(h.db, { stableId: p.stableId })).map((r) => formLineOf(r, { nowMs, keeper: true })));
    expect(stable.total.runs).toBe(4);
    const line = splitsOf((await settledFormRows(h.db, { sireId: sire.id })).map((r) => formLineOf(r, { nowMs, keeper: false })));
    expect(line.total.runs).toBe(4);
    expect(line.groups.find((g) => g.dimension === "distance")!.buckets.map((x) => x.key)).toEqual(["sprint", "staying"]);
  });
});

describe("the horse's log", () => {
  it("persists each training session's gains, fatigue and realisation, once", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    const before = await getHorseRow(h.db, horse.id);
    const r = await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: T0, expectedSession: 0, workout: "speed_work" });
    expect(r.ran).toBe(true);
    // A double tap (stale session number) runs nothing and logs nothing.
    await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: T0, expectedSession: 0, workout: "speed_work" });
    const log = await trainingLogOf(h.db, horse.id);
    expect(log).toHaveLength(1);
    const d = log[0]!.data as { workout: string; cost: number; gains: Record<string, number>; fatigueBefore: number; fatigueAfter: number; realisation: Record<string, number>; session: number };
    expect(d.workout).toBe("speed_work");
    expect(d.cost).toBe(gc.WORKOUTS.speed_work.cost);
    expect(d.session).toBe(1);
    expect(d.gains.speed).toBeGreaterThan(0);
    expect(d.gains.burst).toBeGreaterThan(0);
    expect(d.gains.stamina).toBeUndefined();
    expect(d.fatigueAfter).toBeGreaterThan(d.fatigueBefore);
    const rBefore = (before.dynamics as { training?: { realisation?: Record<string, number> } }).training?.realisation;
    if (rBefore) expect(d.realisation.speed).toBe(rBefore.speed! + d.gains.speed!);
    expect(log[0]!.stableId).toBe(p.stableId);
  });

  it("logs a race injury and revealed quirks at settlement", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 3 });
    const race = await newRace("Knock Stakes", 10 * MIN, { distanceM: 1600 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: T0 });
    await runRace(race.id, at(11 * MIN), [], { [horse.id]: { injury: { severity: "minor", recoveryMs: 2 * DAY }, quirksRevealed: ["mudlark"] } });
    const rows = await h.db.select().from(horseLog).where(eq(horseLog.horseId, horse.id));
    const injury = rows.find((r) => r.kind === "injury")!;
    expect(injury.raceId).toBe(race.id);
    expect(injury.data).toMatchObject({ severity: "minor", source: "race", backAtMs: at(11 * MIN).getTime() + 2 * DAY });
    expect(rows.find((r) => r.kind === "quirk")!.data).toEqual({ quirks: ["mudlark"] });
  });

  it("mixes every source newest first and pages without gaps or repeats", async () => {
    const p = await newPlayer(h.db, { credits: 5_000 });
    const horse = await makeHorse(h.db, p.stableId);
    await careForHorse(h.db, { accountId: p.accountId, horseId: horse.id, now: at(1 * DAY) });
    await runTrainingSession(h.db, { accountId: p.accountId, horseId: horse.id, now: at(1 * DAY + MIN), workout: "swimming" });
    const race = await newRace("Log Stakes", 2 * DAY, { distanceM: 1400 });
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "front", now: at(2 * DAY - 5 * MIN) });
    await runRace(race.id, at(2 * DAY + MIN), [horse.id]);
    const later = await newRace("Log Later", 9 * DAY, { distanceM: 1400 });
    await enterRace(h.db, { accountId: p.accountId, raceId: later.id, horseId: horse.id, tactic: "front", now: at(3 * DAY) });
    // Several entries at one instant: the key breaks the tie.
    for (const k of ["a", "b", "c"]) {
      await logHorseEventTx(h.db, { horseId: horse.id, kind: "vet", at: at(4 * DAY), dedupeKey: `tie-${k}`, data: { cost: 1 } });
    }

    const now = at(5 * DAY);
    const row = await getHorseRow(h.db, horse.id);
    const all = await horseLogPage(h.db, row, { now, limit: 100, keeper: true });
    expect(all.nextCursor).toBeNull();
    const kinds = all.entries.map((e) => e.kind);
    expect(kinds[0]).toBe("race"); // the declared race posts later than everything else
    expect(all.entries[0]!.line).toMatchObject({ status: "declared", result: null });
    expect(kinds).toEqual(expect.arrayContaining(["race", "training", "care", "vet", "born"]));
    expect(kinds[kinds.length - 1]).toBe("born");
    for (let i = 1; i < all.entries.length; i++) expect(all.entries[i - 1]!.atMs).toBeGreaterThanOrEqual(all.entries[i]!.atMs);
    const settled = all.entries.find((e) => e.kind === "race" && e.raceId === race.id)!;
    expect(settled.line).toMatchObject({ status: "settled", result: { position: 1 } });
    const training = all.entries.find((e) => e.kind === "training")!;
    expect(training.data).toMatchObject({ workout: "swimming" });

    // Pages of 2 walk the same list exactly.
    const seen: HorseLogEntry[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await horseLogPage(h.db, row, { now, limit: 2, cursor, keeper: true });
      seen.push(...page.entries);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.map((e) => e.key)).toEqual(all.entries.map((e) => e.key));
    expect(new Set(seen.map((e) => e.key)).size).toBe(seen.length);
  });
});
