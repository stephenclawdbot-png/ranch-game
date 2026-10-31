import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { horses, inboxItems } from "../schema";
import { gc } from "../gameCore";
import { createRace, enterRace, getRaceForSimulation, settleRace, type RunnerOutcome } from "../services/races";
import { markInboxRead, listInbox } from "../services/player";
import { moveToLegacyFarm, retireHorse } from "../services/horses";
import { scanPedigree } from "../services/horseLife";
import { MOMENT_KIND, dismissMoment, legacyFarm, listMoments } from "../services/moments";
import { at, DAY, MIN, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

let slot = 0;
/** A Live race 10 minutes after `day` days from T0, entered by the given horses, settled with `first` in front. */
async function race(entries: { accountId: string; horseId: string }[], opts: { kind?: "scheduled" | "feature"; first?: string[]; extra?: Record<string, Partial<RunnerOutcome>>; day?: number } = {}) {
  const base = (opts.day ?? 0) * DAY + ++slot * 20 * MIN;
  const r = await createRace(h.db, {
    kind: opts.kind ?? "scheduled",
    name: `${opts.kind === "feature" ? "Feature" : "Moment"} Stakes ${slot}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime: at(base + 10 * MIN),
    entriesCloseAt: at(base + 9 * MIN),
    targetRunners: 4,
  });
  for (const e of entries) await enterRace(h.db, { ...e, raceId: r.id, tactic: "stalker", now: at(base) });
  const now = at(base + 11 * MIN);
  const { field } = await getRaceForSimulation(h.db, r.id, now);
  const first = opts.first ?? [];
  const order = [...first, ...field.runners.map((x) => x.horseId).filter((id) => !first.includes(id))];
  const res = await settleRace(h.db, {
    raceId: r.id,
    now,
    resultHash: "0".repeat(64),
    result: { order },
    runners: order.map((horseId, i) => ({ horseId, position: i + 1, ...(opts.extra?.[horseId] ?? {}) })),
  });
  return { race: r, now, res };
}

async function momentRows(accountId: string) {
  return h.db.select().from(inboxItems).where(and(eq(inboxItems.accountId, accountId), eq(inboxItems.kind, MOMENT_KIND)));
}

describe("moments from settlement", () => {
  it("first win: once, hidden until the result is seen, never again", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 2, name: "Sea Lavender", sex: "female" });
    const { race: r1, now } = await race([{ accountId: p.accountId, horseId: horse.id }], { first: [horse.id] });
    const rows = await momentRows(p.accountId);
    expect(rows.map((x) => (x.data as { moment: string }).moment)).toEqual(["first_win"]);
    expect(rows[0]!.raceId).toBeNull(); // viewing the result must not dismiss it
    // no spoiler: hidden until the owner has watched the result
    expect(await listMoments(h.db, p.accountId)).toEqual([]);
    await markInboxRead(h.db, { accountId: p.accountId, raceId: r1.id, now });
    const [m] = await listMoments(h.db, p.accountId);
    expect(m).toMatchObject({ kind: "first_win", horseId: horse.id, raceId: r1.id, href: `/race/${r1.id}`, dismissed: false });
    expect(m!.title).toBe("First win: Sea Lavender");
    // the moments don't crowd the race inbox
    expect((await listInbox(h.db, p.accountId)).every((i) => i.kind !== MOMENT_KIND)).toBe(true);
    // settling again is a no-op; a second win is not a "first" win
    await settleRace(h.db, { raceId: r1.id, now, resultHash: "0".repeat(64), result: {}, runners: [] });
    await race([{ accountId: p.accountId, horseId: horse.id }], { first: [horse.id], day: 1 });
    expect((await momentRows(p.accountId)).filter((x) => (x.data as { moment: string }).moment === "first_win")).toHaveLength(1);
  });

  it("a revealed quirk is a moment once; a quirk already known never is", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 3 });
    await race([{ accountId: p.accountId, horseId: horse.id }], { extra: { [horse.id]: { quirksRevealed: ["mudlark"] } } });
    await race([{ accountId: p.accountId, horseId: horse.id }], { extra: { [horse.id]: { quirksRevealed: ["mudlark"] } }, day: 1 });
    const rows = (await momentRows(p.accountId)).filter((x) => (x.data as { moment: string }).moment === "quirk");
    expect(rows.map((x) => x.dedupeKey)).toEqual([gc.momentKey("quirk", horse.id, "mudlark")]);
    expect((rows[0]!.data as { body: string }).body).toContain(`+${gc.QUIRK_EFFECT.mudlark.adaptability} adaptability`);
  });

  it("ranges closing to exact are announced at the start that closes them", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, {});
    const closes = Array.from({ length: 41 }, (_, k) => k).find((k) => gc.revealWidth({ care: { sessions: horse.careSessions, lastCareDay: null, quality: 0 }, career: { starts: k, racingRetired: null, pastured: false, insured: false }, reveal: { scanned: false, quirks: [] } }) === 0)!;
    await h.db.update(horses).set({ starts: closes - 2 }).where(eq(horses.id, horse.id));
    await race([{ accountId: p.accountId, horseId: horse.id }]);
    expect((await momentRows(p.accountId)).some((x) => (x.data as { moment: string }).moment === "exact")).toBe(false);
    await race([{ accountId: p.accountId, horseId: horse.id }], { day: 1 });
    expect((await momentRows(p.accountId)).filter((x) => (x.data as { moment: string }).moment === "exact")).toHaveLength(1);
  });

  it("first Feature run, once", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 5 });
    await race([{ accountId: p.accountId, horseId: horse.id }], { kind: "feature" });
    await race([{ accountId: p.accountId, horseId: horse.id }], { kind: "feature", day: 1 });
    expect((await momentRows(p.accountId)).map((x) => (x.data as { moment: string }).moment).filter((k) => k !== "first_win")).toEqual(["first_feature"]);
  });

  it("retirement at 40 starts carries the tribute with the best win", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: gc.CAREER_MAX_STARTS - 2 });
    const { race: won } = await race([{ accountId: p.accountId, horseId: horse.id }], { first: [horse.id] });
    await race([{ accountId: p.accountId, horseId: horse.id }], { day: 1 });
    const retired = (await momentRows(p.accountId)).find((x) => (x.data as { moment: string }).moment === "retired")!;
    const t = (retired.data as { tribute: gc.Tribute }).tribute;
    expect(t.starts).toBe(gc.CAREER_MAX_STARTS);
    expect(t.wins).toBeGreaterThanOrEqual(1);
    expect(t.bestWin?.raceId).toBe(won.id);
  });

  it("a fatal injury sends only the memorial, and the Legacy Farm remembers", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 6 });
    const { race: r } = await race([{ accountId: p.accountId, horseId: horse.id }], { first: [horse.id], extra: { [horse.id]: { injury: { severity: "fatal", recoveryMs: 0 } } } });
    expect((await momentRows(p.accountId)).map((x) => (x.data as { moment: string }).moment)).toEqual(["memorial"]);
    const farm = await legacyFarm(h.db, p.stableId);
    expect(farm).toHaveLength(1);
    expect(farm[0]!.died).toMatchObject({ raceId: r.id, raceName: r.name });
  });
});

describe("moments from owner actions", () => {
  it("scan, retire and Legacy Farm each send one moment; a highlight dismisses once", async () => {
    const p = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId, { starts: 1 });
    await scanPedigree(h.db, { accountId: p.accountId, horseId: horse.id, now: at(0) });
    await scanPedigree(h.db, { accountId: p.accountId, horseId: horse.id, now: at(MIN) });
    await retireHorse(h.db, { accountId: p.accountId, horseId: horse.id, now: at(2 * MIN) });
    await moveToLegacyFarm(h.db, { accountId: p.accountId, horseId: horse.id, now: at(3 * MIN) });
    await moveToLegacyFarm(h.db, { accountId: p.accountId, horseId: horse.id, now: at(4 * MIN) });
    const list = await listMoments(h.db, p.accountId, { horseId: horse.id });
    expect(list.map((m) => m.kind)).toEqual(["legacy", "retired", "scan"]);
    expect(list[0]!.tribute).toMatchObject({ starts: 1 });
    expect(await dismissMoment(h.db, { accountId: p.accountId, id: list[2]!.id, now: at(5 * MIN) })).toBe(true);
    expect(await dismissMoment(h.db, { accountId: p.accountId, id: list[2]!.id, now: at(6 * MIN) })).toBe(false);
    const other = await newPlayer(h.db);
    expect(await dismissMoment(h.db, { accountId: other.accountId, id: list[1]!.id, now: at(6 * MIN) })).toBe(false);
    expect((await listMoments(h.db, p.accountId, { undismissed: true })).map((m) => m.kind)).toEqual(["legacy", "retired"]);
  });
});
