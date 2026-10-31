/**
 * Quick races storage: rows of their own, one daily attempt per stable per day, a match race's
 * runners and head-to-heads, and one batched inbox line a day to an owner whose horse beat a
 * challenger. Nothing else in the game moves (no ledger, horse, entry or result writes).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { RESET_TABLES } from "../services/playtest";
import { RATE_LIMIT_PRUNE_MS } from "../services/maintenance";
import {
  MATCH_NOTE_KIND,
  dailyAttemptOf,
  dailyBoard,
  dailyChallengeSeed,
  dailyHistory,
  getQuickRace,
  listMatchNotes,
  listQuickRaces,
  matchNoteTitle,
  matchRecordOf,
  matchRunsOf,
  saveQuickRace,
  type MatchRunnerInsert,
} from "../services/quickRaces";
import { MIN, T0, count, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const untouched = async () => ({
  postings: await count(h.db, "ledger_postings"),
  entries: await count(h.db, "race_entries"),
  results: await count(h.db, "race_results"),
  horses: JSON.stringify(await h.db.execute("select * from horses order by id")),
});

describe("quick races storage", () => {
  it("stores a match race with its runners; the beaten challenger's opponents' owners get one line a day", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const c = await newPlayer(h.db);
    const mine = await makeHorse(h.db, a.stableId, { name: "Paper Moon" });
    const theirs = await makeHorse(h.db, b.stableId, { name: "Copper Comet" });
    const third = await makeHorse(h.db, c.stableId, { name: "Slow Coach" });
    const before = await untouched();
    const run = (pos: [number, number, number], at: Date) => {
      const runners: MatchRunnerInsert[] = [
        { horseId: mine.id, horseName: "Paper Moon", stableId: a.stableId, challenger: true, position: pos[0] },
        { horseId: theirs.id, horseName: "Copper Comet", stableId: b.stableId, challenger: false, position: pos[1] },
        { horseId: third.id, horseName: "Slow Coach", stableId: c.stableId, challenger: false, position: pos[2] },
      ];
      return saveQuickRace(h.db, { mode: "match", accountId: a.accountId, stableId: a.stableId, horseId: mine.id, engineVersion: "1.4.0", input: {}, summary: { n: 1 }, position: pos[0], finishTimeUs: 100_000_000, now: at }, runners);
    };
    const first = await run([2, 1, 3], T0);
    expect((await getQuickRace(h.db, first.id))?.mode).toBe("match");
    let notesB = await listMatchNotes(h.db, b.accountId);
    expect(notesB).toHaveLength(1);
    expect(notesB[0]!.kind).toBe(MATCH_NOTE_KIND);
    expect(notesB[0]!.title).toBe("Copper Comet beat Paper Moon in a match race");
    // The horse that finished behind the challenger gets nothing.
    expect(await listMatchNotes(h.db, c.accountId)).toHaveLength(0);
    // Two more the same day: still one line, counting them.
    await run([3, 1, 2], new Date(T0.getTime() + MIN));
    notesB = await listMatchNotes(h.db, b.accountId);
    expect(notesB).toHaveLength(1);
    expect(notesB[0]!.title).toBe("Copper Comet beat Paper Moon in a match race (and 1 more match win today)");
    expect((notesB[0]!.data as { wins: number }).wins).toBe(2);
    expect(await listMatchNotes(h.db, c.accountId)).toHaveLength(1);
    // A win for the challenger: no line for anyone.
    await run([1, 2, 3], new Date(T0.getTime() + 2 * MIN));
    expect(((await listMatchNotes(h.db, b.accountId))[0]!.data as { wins: number }).wins).toBe(2);
    // The next UTC day starts a new line.
    await run([2, 1, 3], new Date(T0.getTime() + 86_400_000));
    expect(await listMatchNotes(h.db, b.accountId, 5)).toHaveLength(2);

    const rec = await matchRecordOf(h.db, mine.id);
    const vsB = rec.find((r) => r.opponentId === theirs.id)!;
    expect(vsB).toMatchObject({ won: 1, lost: 3, meetings: 4, opponentName: "Copper Comet" });
    const theirRec = (await matchRecordOf(h.db, theirs.id)).find((r) => r.opponentId === mine.id)!;
    expect(theirRec).toMatchObject({ won: 3, lost: 1, meetings: 4 });
    expect((await matchRunsOf(h.db, [mine.id, third.id])).get(mine.id)).toBe(4);
    expect(await listQuickRaces(h.db, a.stableId, 10, "match")).toHaveLength(4);
    // Nothing official moved.
    expect(await untouched()).toEqual(before);
  });

  it("takes one daily attempt per stable per day and ranks the day's board", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const day = "2026-11-02";
    const save = (p: { accountId: string; stableId: string }, position: number, t: number, d = day) =>
      saveQuickRace(h.db, { mode: "daily", accountId: p.accountId, stableId: p.stableId, challengeDay: d, engineVersion: "1.4.0", input: {}, summary: {}, position, finishTimeUs: t, points: 5, now: T0 });
    await save(a, 3, 101_000_000);
    await expect(save(a, 1, 99_000_000)).rejects.toMatchObject({ code: "RACE_LIMIT" });
    await save(b, 1, 105_000_000);
    await save(a, 2, 101_000_000, "2026-11-03");
    expect((await dailyAttemptOf(h.db, a.stableId, day))?.position).toBe(3);
    const board = await dailyBoard(h.db, day);
    expect(board.map((r) => r.stableId)).toEqual([b.stableId, a.stableId]);
    expect((await dailyHistory(h.db, a.stableId)).map((r) => r.day)).toEqual(["2026-11-03", day]);
  });

  it("keeps one seed per challenge day", async () => {
    const s = await dailyChallengeSeed(h.db, 20_760);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(await dailyChallengeSeed(h.db, 20_760)).toBe(s);
    expect(await dailyChallengeSeed(h.db, 20_761)).not.toBe(s);
  });

  it("titles a note with the latest win", () => {
    expect(matchNoteTitle({ winner: "A", challenger: "B" }, 3)).toBe("A beat B in a match race (and 2 more match wins today)");
  });

  it("is wiped by the playtest reset, and the daily limiter's counters outlive a day", () => {
    expect(RESET_TABLES).toContain("quick_races");
    expect(RESET_TABLES).toContain("match_race_runners");
    expect(RATE_LIMIT_PRUNE_MS).toBeGreaterThanOrEqual(2 * 86_400_000);
  });
});
