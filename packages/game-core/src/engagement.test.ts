import { describe, expect, it } from "vitest";
import {
  AWAY_MAX_LINES,
  AWAY_ORDER,
  FATIGUE_RECOVERY_PER_HOUR,
  MS_PER_DAY,
  MS_PER_HOUR,
  TIRED_THRESHOLD,
  awaySummary,
  featureCalendar,
  featureCardShows,
  freshAgainAt,
  freshSince,
  giftFoalDue,
  giftFoalTomorrowAt,
  tomorrowCalendar,
  tomorrowHooks,
  utcWeekday,
  weekBoard,
  type AwayFacts,
  type BoardEntry,
  type TomorrowFacts,
} from "./index";

const EMPTY: AwayFacts = { unwatched: [], liveToday: [], foalsBorn: [], foalsDue: [], recovered: [], fresh: [], training: [], ratings: [], rivalWins: [] };
const FULL: AwayFacts = {
  rivalWins: [{ headline: "Kestrel Lane's Moonrake wins the Ashcombe Weekend Feature", href: "/race/r9" }],
  training: [{ title: "Bramble can train again: a new training week has started", href: "/horse/h3" }],
  ratings: [{ horseId: "h1", name: "Bramble", from: 62, to: 65 }],
  fresh: [{ horseId: "h2", name: "Tansy" }],
  recovered: [{ horseId: "h4", name: "Hollin" }],
  foalsDue: [{ damName: "Marigold" }],
  foalsBorn: [{ horseId: "f1", name: "Little Wren", gift: true }],
  liveToday: [{ raceId: "r2", horseName: "Bramble", raceName: "Bellmont Handicap", postTimeMs: 5_000 }],
  unwatched: [{ raceId: "r1", horseName: "Tansy", live: true }],
};

describe("away summary", () => {
  it("is empty when nothing happened (nothing is invented)", () => {
    expect(awaySummary(EMPTY)).toEqual([]);
  });

  it("puts a result to watch first, then today's Live races, and stops at five lines", () => {
    const lines = awaySummary(FULL);
    expect(lines).toHaveLength(AWAY_MAX_LINES);
    expect(lines.map((l) => l.kind)).toEqual(["result", "live_today", "gift_foal", "foal_due", "recovered"]);
    // in AWAY_ORDER
    const idx = lines.map((l) => AWAY_ORDER.indexOf(l.kind));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("never says how an unwatched race went", () => {
    const lines = awaySummary({ ...EMPTY, unwatched: [{ raceId: "r1", horseName: "Tansy", live: true }] });
    expect(lines[0]).toEqual({ kind: "result", text: "Tansy's Live race has run: watch the finish", href: "/race/r1" });
    const anon = awaySummary({ ...EMPTY, unwatched: [{ raceId: "r1", horseName: null, live: true }] });
    expect(anon[0]!.text).toBe("Your Live race has run: watch the finish");
    const many = awaySummary({ ...EMPTY, unwatched: [{ raceId: "a", horseName: "A", live: true }, { raceId: "b", horseName: "B", live: false }] });
    expect(many[0]!.text).toBe("2 races have run: watch the finishes");
    for (const l of [...lines, ...anon, ...many]) expect(l.text).not.toMatch(/\b(won|win|1st|2nd|3rd|\d+th|placed|beaten|second|third|last)\b/i);
  });

  it("lists today's Live races with every post time (shown in local time by the browser)", () => {
    const one = awaySummary({ ...EMPTY, liveToday: [FULL.liveToday[0]!] });
    expect(one[0]).toMatchObject({ text: "Bramble runs in the Bellmont Handicap today", times: [5_000] });
    const two = awaySummary({ ...EMPTY, liveToday: [{ raceId: "b", horseName: "B", raceName: "Late", postTimeMs: 9_000 }, { raceId: "a", horseName: "A", raceName: "Early", postTimeMs: 3_000 }] });
    expect(two[0]).toMatchObject({ text: "You're in 2 Live races today", href: "/race/a", times: [3_000, 9_000] });
  });

  it("words a rating move either way, from watched races only (the server passes those)", () => {
    expect(awaySummary({ ...EMPTY, ratings: [{ horseId: "h", name: "Bramble", from: 70, to: 66 }] })[0]!.text).toBe("Bramble's rating went down from 70 to 66");
  });

  it("is fresh again only when tired at the last visit and not now, with no work since", () => {
    const from = 100 * MS_PER_HOUR;
    const tired = { fatigue: TIRED_THRESHOLD + 2 * FATIGUE_RECOVERY_PER_HOUR, fatigueAtMs: from - MS_PER_HOUR };
    expect(freshSince(tired, from, from + 5 * MS_PER_HOUR)).toBe(true);
    expect(freshSince(tired, from, from)).toBe(false); // still tired
    expect(freshSince({ ...tired, fatigueAtMs: from + 1 }, from, from + 5 * MS_PER_HOUR)).toBe(false); // raced since
    expect(freshSince({ fatigue: 0, fatigueAtMs: 0 }, from, from + MS_PER_DAY)).toBe(false); // never tired
  });
});

describe("tomorrow hooks", () => {
  const NONE: TomorrowFacts = { giftFoalAtMs: null, livePending: 0, calendar: null, freshSoon: null, healSoon: null, cup: null, story: null, entries: null };

  it("says nothing without state", () => {
    expect(tomorrowHooks(NONE)).toEqual([]);
    expect(tomorrowHooks({ ...NONE, entries: { add: 0, atMs: 1 } })).toEqual([]);
  });

  it("puts the gift foal first and caps the card", () => {
    const lines = tomorrowHooks({
      giftFoalAtMs: 10,
      livePending: 2,
      calendar: { kind: "weekend_feature", atMs: 20 },
      healSoon: { names: ["Hollin"], atMs: 30 },
      freshSoon: { names: ["Tansy", "Bramble", "Wren"], atMs: 40 },
      cup: { opensAtMs: 50, distanceM: 1600, surface: "synthetic" },
      story: { chapter: 2, raceName: "Bellmont Maiden" },
      entries: { add: 10, atMs: 60 },
    });
    expect(lines.map((l) => l.kind)).toEqual(["gift_foal", "results", "calendar", "healed", "fresh"]);
    expect(lines[1]!.text).toBe("Your 2 Live races will have run: the finishes are waiting");
    expect(lines[4]!.text).toBe("Tansy, Bramble and 1 more will be fresh again");
    const cup = tomorrowHooks({ ...NONE, cup: { opensAtMs: 50, distanceM: 1600, surface: "synthetic" } });
    expect(cup[0]!.text).toBe("A new Daily Cup: 1,600 m on the all-weather");
  });

  it("brings the gift foal tomorrow only on the founding day (the rule: the account's second UTC day)", () => {
    const created = 20_000 * MS_PER_DAY + 15 * MS_PER_HOUR;
    const tomorrow = 20_001 * MS_PER_DAY;
    expect(giftFoalTomorrowAt(created, created + MS_PER_HOUR, false)).toBe(tomorrow);
    // ...which is exactly when game-core's own rule makes it due
    expect(giftFoalDue(created, tomorrow - 1, false)).toBe(false);
    expect(giftFoalDue(created, tomorrow, false)).toBe(true);
    // a late-night founding still means the next UTC day
    expect(giftFoalTomorrowAt(20_000 * MS_PER_DAY + 23 * MS_PER_HOUR + 59 * 60_000, 20_000 * MS_PER_DAY + 23 * MS_PER_HOUR + 59 * 60_000, false)).toBe(tomorrow);
    expect(giftFoalTomorrowAt(created, tomorrow + MS_PER_HOUR, false)).toBeNull(); // due today, not tomorrow
    expect(giftFoalTomorrowAt(created, created + MS_PER_HOUR, true)).toBeNull(); // already given
  });

  it("knows when a tired horse is fresh again (time alone) and ignores a fresh one", () => {
    const now = 1_000 * MS_PER_HOUR;
    expect(freshAgainAt({ fatigue: TIRED_THRESHOLD + 3 * FATIGUE_RECOVERY_PER_HOUR, fatigueAtMs: now }, now)).toBe(now + 3 * MS_PER_HOUR);
    expect(freshAgainAt({ fatigue: 0, fatigueAtMs: now }, now)).toBeNull();
    expect(freshAgainAt({ fatigue: 1000, fatigueAtMs: now }, now)).toBeNull(); // not within a day
  });

  it("reads tomorrow's calendar race from the feature calendar, or a new week on Monday", () => {
    const cal = [...featureCalendar({ epochMs: 0 }, 740), ...featureCalendar({ epochMs: 0 }, 741)];
    const friday = cal.find((r) => r.kind === "weekend_feature")!.postTimeMs - MS_PER_DAY;
    expect(tomorrowCalendar(friday, cal)).toMatchObject({ kind: "weekend_feature" });
    const q = cal.find((r) => r.kind === "feature_qualifier")!;
    expect(tomorrowCalendar(q.postTimeMs - MS_PER_DAY, cal)).toMatchObject({ kind: "feature_qualifier", atMs: q.postTimeMs });
    // Sunday: no calendar race on Monday's... a Monday qualifier wins over "new week"
    const sunday = Math.floor(friday / MS_PER_DAY) * MS_PER_DAY + 2 * MS_PER_DAY + 12 * MS_PER_HOUR;
    expect(utcWeekday(sunday)).toBe(6);
    const t = tomorrowCalendar(sunday, cal);
    expect(t?.kind === "feature_qualifier" || t?.kind === "new_week").toBe(true);
    expect(tomorrowCalendar(sunday, [])).toEqual({ kind: "new_week", atMs: Math.floor(sunday / MS_PER_DAY + 1) * MS_PER_DAY });
  });
});

describe("this week's table", () => {
  const e = (id: string, points: number, wins = 0, runs = 1): BoardEntry => ({ accountId: id, stableName: id.toUpperCase(), points, wins, runs });

  it("ranks by points, shares places on ties and orders a tie by wins then name", () => {
    const b = weekBoard([e("c", 10, 0), e("a", 20), e("b", 10, 1), e("d", 5)], null, "d");
    expect(b.top.map((r) => [r.accountId, r.rank, r.tied])).toEqual([
      ["a", 1, false],
      ["b", 2, true],
      ["c", 2, true],
      ["d", 4, false],
    ]);
    expect(b.mine).toMatchObject({ accountId: "d", rank: 4 });
    expect(b.stables).toBe(4);
  });

  it("gives your place outside the top ten, and none without a Live run", () => {
    const rows = Array.from({ length: 14 }, (_, i) => e(`s${String(i).padStart(2, "0")}`, 100 - i));
    const b = weekBoard(rows, null, "s12", 10);
    expect(b.top).toHaveLength(10);
    expect(b.mine).toMatchObject({ rank: 13 });
    expect(weekBoard([...rows, e("idle", 0, 0, 0)], null, "idle").mine).toBeNull();
  });

  it("shows movement since the start of today, new arrivals, and none on the week's first day", () => {
    const before = [e("a", 10), e("b", 8), e("c", 6)];
    const now = [e("a", 10), e("b", 8), e("c", 12), e("n", 7)];
    const b = weekBoard(now, before, "c");
    const by = new Map(b.top.map((r) => [r.accountId, r]));
    expect(by.get("c")).toMatchObject({ rank: 1, move: 2, isNew: false });
    expect(by.get("a")).toMatchObject({ rank: 2, move: -1 });
    expect(by.get("b")).toMatchObject({ rank: 3, move: -1 });
    expect(by.get("n")).toMatchObject({ rank: 4, move: null, isNew: true });
    expect(weekBoard(now, null, "c").top.every((r) => r.move === null && !r.isNew)).toBe(true);
  });

  it("moves no one on a tie that stays a tie", () => {
    const b = weekBoard([e("a", 10), e("b", 10, 2)], [e("a", 10), e("b", 10)], null);
    expect(b.top.map((r) => r.move)).toEqual([0, 0]);
  });
});

describe("Saturday Feature card", () => {
  const cal = featureCalendar({ epochMs: 0 }, 740);
  const post = cal.find((r) => r.kind === "weekend_feature")!.postTimeMs;
  it("shows from Thursday 00:00 UTC until three hours after the off", () => {
    expect(utcWeekday(post)).toBe(5);
    const thursday = (Math.floor(post / MS_PER_DAY) - 2) * MS_PER_DAY;
    expect(featureCardShows(thursday - 1, post)).toBe(false);
    expect(featureCardShows(thursday, post)).toBe(true);
    expect(featureCardShows(post + 3 * MS_PER_HOUR - 1, post)).toBe(true);
    expect(featureCardShows(post + 3 * MS_PER_HOUR, post)).toBe(false);
  });
});
