import { describe, expect, it } from "vitest";
import { pickPoints, pickStreaks, pickWindowOpen, rankTipsters, ratingRanks, scorePick, tipsterWeekStartMs, PICK_POINTS_OUTSIDER, PICK_POINTS_TOP, TIPSTER_BADGE_TOP } from "./picks";

const field = [
  { horseId: "a", rating: 80 },
  { horseId: "b", rating: 72 },
  { horseId: "c", rating: 72 },
  { horseId: "d", rating: 60 },
  { horseId: "e", rating: 41 },
];

describe("picks", () => {
  it("ranks by rating, ties share the better rank", () => {
    expect([...ratingRanks(field).entries()]).toEqual([["a", 1], ["b", 2], ["c", 2], ["d", 4], ["e", 5]]);
  });

  it("scores the top-rated winner 10 and the outsider 50, linearly between", () => {
    expect(pickPoints(1, 5)).toBe(PICK_POINTS_TOP);
    expect(pickPoints(5, 5)).toBe(PICK_POINTS_OUTSIDER);
    expect(pickPoints(3, 5)).toBe(30);
    expect(pickPoints(2, 12)).toBe(13);
    expect(pickPoints(1, 1)).toBe(10);
    for (let n = 2; n <= 16; n++) for (let r = 1; r < n; r++) expect(pickPoints(r + 1, n)).toBeGreaterThanOrEqual(pickPoints(r, n));
  });

  it("scores by rank in the final field; voids non-runners and races that didn't run", () => {
    expect(scorePick({ horseId: "e", field, winners: ["e"], ran: true })).toEqual({ outcome: "won", points: 50, rank: 5, fieldSize: 5 });
    expect(scorePick({ horseId: "c", field, winners: ["c"], ran: true }).points).toBe(20);
    expect(scorePick({ horseId: "a", field, winners: ["e"], ran: true })).toEqual({ outcome: "lost", points: 0, rank: 1, fieldSize: 5 });
    expect(scorePick({ horseId: "zz", field, winners: ["a"], ran: true }).outcome).toBe("void");
    expect(scorePick({ horseId: "a", field, winners: [], ran: false }).outcome).toBe("void");
  });

  it("closes the window at the off and for called-off races", () => {
    const race = { status: "open", postTimeMs: 1_000_000 };
    expect(pickWindowOpen(race, 999_999)).toBe(true);
    expect(pickWindowOpen({ ...race, status: "locked" }, 999_999)).toBe(true);
    expect(pickWindowOpen(race, 1_000_000)).toBe(false);
    expect(pickWindowOpen({ ...race, status: "cancelled" }, 0)).toBe(false);
    expect(pickWindowOpen({ ...race, status: "settled" }, 0)).toBe(false);
  });

  it("weeks start Monday 00:00 UTC", () => {
    const mon = Date.UTC(2026, 9, 26);
    expect(tipsterWeekStartMs(mon)).toBe(mon);
    expect(tipsterWeekStartMs(Date.UTC(2026, 10, 1, 23, 59))).toBe(mon); // Sunday
    expect(tipsterWeekStartMs(Date.UTC(2026, 10, 2))).toBe(Date.UTC(2026, 10, 2));
  });

  it("counts runs of winning picks, voids don't break them", () => {
    expect(pickStreaks(["won", "won", "void", "won", "lost", "won"])).toEqual({ current: 1, best: 3 });
    expect(pickStreaks([])).toEqual({ current: 0, best: 0 });
  });

  it("ranks tipsters and badges the top 10 with points", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ stableId: `s${String(i).padStart(2, "0")}`, points: i < 12 ? 100 - i * 5 : 0, wins: 1, picks: 3 }));
    rows.push({ stableId: "tie", points: 100, wins: 1, picks: 3 });
    const t = rankTipsters(rows);
    expect(t[0]!.position).toBe(1);
    expect(t[1]!.position).toBe(1);
    expect(t.filter((r) => r.badge).length).toBe(TIPSTER_BADGE_TOP);
    expect(t.at(-1)!.badge).toBe(false);
  });
});
