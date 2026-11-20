import { describe, expect, it } from "vitest";
import {
  CARD_COVER_EVERY_MEETINGS,
  CARD_MIN_ELIGIBLE_STABLES,
  CARD_MIN_RACES_PER_MEETING,
  CARD_SURFACES,
  CARD_TARGET_STABLES_PER_RACE,
  CARD_TRIP_SPREAD_M,
  demandEligible,
  meetingRaceCount,
  planMeeting,
  tripSuits,
  type CardOption,
  type DemandHorse,
  type MeetingPlanInput,
  type PlannedRace,
} from "./cardPlan";

const JUVENILE = [1000, 1500, 2000, 2400];
const OPEN = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200];
/** The Live card's classes (packages/db card.ts PLAN_CLASSES). */
const OPTIONS: CardOption[] = [
  { key: "maiden", maxWins: 0, maxRating: 60, licence: 1, trips: JUVENILE, starter: true },
  { key: "novice", maxWins: 2, maxRating: 70, licence: 1, trips: JUVENILE, starter: true },
  { key: "hcp55", minRating: 0, maxRating: 55, licence: 1, trips: OPEN, starter: true },
  { key: "hcp75", minRating: 50, maxRating: 75, licence: 2, trips: OPEN },
  { key: "hcp95", minRating: 70, maxRating: 95, licence: 2, trips: OPEN },
  { key: "listed", minRating: 85, licence: 3, trips: OPEN },
  { key: "group3", minRating: 95, licence: 3, trips: OPEN },
];

let seq = 0;
function horse(over: Partial<DemandHorse> = {}): DemandHorse {
  seq++;
  return { stable: `s${seq}`, wins: 0, rating: 40, bandRating: 42, licence: 1, distanceM: 1000 + 100 * (seq % 19), surface: CARD_SURFACES[seq % 3]!, ...over };
}
/** A young beta population: `n` stables with two starters each, rated about 40, some with a win or two. */
function starters(n: number): DemandHorse[] {
  const out: DemandHorse[] = [];
  for (let i = 0; i < n; i++) {
    const stable = `beta${i}`;
    out.push(horse({ stable, wins: i % 4 === 0 ? 1 : 0, rating: 38 + (i % 6) }), horse({ stable, wins: i % 7 === 0 ? 2 : 0, rating: 40 + (i % 5) }));
  }
  return out;
}
const plan = (over: Partial<MeetingPlanInput>): PlannedRace[] => planMeeting({ meeting: 100, slots: 4, horses: [], recentEntries: 0, options: OPTIONS, ...over });
const eligibleFor = (h: DemandHorse, races: readonly PlannedRace[]) => races.some((r) => demandEligible(h, OPTIONS.find((o) => o.key === r.key)!));

describe("meetingRaceCount: the size of a meeting", () => {
  it("one race per CARD_TARGET_STABLES_PER_RACE recent entries, at least the minimum, at most the slots", () => {
    expect(meetingRaceCount(0, 4)).toBe(CARD_MIN_RACES_PER_MEETING);
    expect(meetingRaceCount(CARD_TARGET_STABLES_PER_RACE * 2 - 1, 4)).toBe(1);
    expect(meetingRaceCount(CARD_TARGET_STABLES_PER_RACE * 2, 4)).toBe(2);
    expect(meetingRaceCount(CARD_TARGET_STABLES_PER_RACE * 3, 4)).toBe(3);
    expect(meetingRaceCount(1_000, 4)).toBe(4);
    expect(meetingRaceCount(1_000, 0)).toBe(0);
    expect(meetingRaceCount(-5, 3)).toBe(1);
  });
});

describe("planMeeting", () => {
  it("a thin population gets one race that every horse can enter, never a band nobody is in", () => {
    const horses = starters(20);
    let before: PlannedRace[] = [];
    for (let m = 0; m < 48; m++) {
      const races = plan({ meeting: m, horses, recentEntries: 5, previous: before.map((r) => OPTIONS.find((o) => o.key === r.key)!) });
      // one race: a horse the class of the day leaves out (a winner on maiden day) had its race in the meeting before
      if (m > 0) expect(races).toHaveLength(1);
      expect(["maiden", "novice", "hcp55"]).toContain(races[0]!.key);
      expect(races[0]!.eligibleStables).toBeGreaterThanOrEqual(CARD_MIN_ELIGIBLE_STABLES);
      if (m > 0) for (const h of horses) expect(eligibleFor(h, races) || eligibleFor(h, before)).toBe(true);
      before = races;
    }
  });

  it("the size follows the entries: more players, more races, up to the meeting's slots", () => {
    const horses = starters(60);
    const sizes = [0, 4, 8, 12, 16, 40].map((e) => plan({ horses, recentEntries: e }).filter((r) => r.reason === "demand").length);
    expect(sizes).toEqual([1, 1, 2, 3, 4, 4]);
    expect(plan({ horses, recentEntries: 40, slots: 2 })).toHaveLength(2);
    expect(plan({ horses, recentEntries: 40, slots: 0 })).toEqual([]);
  });

  it("a full meeting mixes the classes most stables can enter, each at its own trip", () => {
    const horses = starters(60);
    for (let m = 0; m < 24; m++) {
      const races = plan({ meeting: m, horses, recentEntries: 40 });
      expect(races).toHaveLength(4);
      expect(new Set(races.map((r) => r.key)).size).toBeGreaterThanOrEqual(3);
      for (const r of races) expect(["maiden", "novice", "hcp55"]).toContain(r.key);
      // four different trips, and mostly well apart
      const trips = races.map((r) => r.distanceM).sort((a, b) => a - b);
      expect(new Set(trips).size).toBe(4);
      expect(trips.filter((d, i) => i > 0 && d - trips[i - 1]! < CARD_TRIP_SPREAD_M).length).toBeLessThanOrEqual(1);
    }
  });

  it("a band is scheduled on demand once enough stables are in it, and not before", () => {
    const young = starters(30);
    const better = (n: number) => Array.from({ length: n }, (_, i) => horse({ stable: `up${i}`, wins: 4, rating: 62, bandRating: 64, licence: 2 }));
    const keys = (horses: DemandHorse[], m = 100) => plan({ meeting: m, horses, recentEntries: 40 }).map((r) => r.key);
    expect(keys([...young, ...better(CARD_MIN_ELIGIBLE_STABLES)])).toContain("hcp75");
    // below the minimum it is no demand race...
    const few = [...young, ...better(CARD_MIN_ELIGIBLE_STABLES - 1)];
    const races = plan({ meeting: 100, horses: few, recentEntries: 8 });
    expect(races.filter((r) => r.reason === "demand").map((r) => r.key)).not.toContain("hcp75");
    // ...but those horses (4 wins, rated 62: no maiden, novice or 0-55) still get a cover race
    expect(races.filter((r) => r.reason === "cover").map((r) => r.key)).toEqual(["hcp75"]);
    // nobody rated 85+: Listed and Group races are never published
    for (let m = 0; m < 30; m++) for (const k of keys(few, m)) expect(["listed", "group3", "hcp95"]).not.toContain(k);
  });

  it("cover: a horse with no race in this meeting or the ones just before gets one; one that had a race last time waits", () => {
    expect(CARD_COVER_EVERY_MEETINGS).toBe(2);
    const young = starters(12);
    const lone = horse({ stable: "lone", wins: 5, rating: 66, bandRating: 68, licence: 2 });
    const horses = [...young, lone];
    const first = plan({ meeting: 7, horses, recentEntries: 4 });
    expect(first.map((r) => r.reason)).toEqual(["demand", "cover"]);
    expect(eligibleFor(lone, first)).toBe(true);
    // the next meeting knows the last one had a race for it: no cover race
    const hcp75 = OPTIONS.find((o) => o.key === "hcp75")!;
    const next = plan({ meeting: 8, horses, recentEntries: 4, previous: [hcp75] });
    expect(next.map((r) => r.reason)).toEqual(["demand"]);
    // a horse nothing on the card can take (licence 1, too good for the open bands) changes nothing
    const stuck = horse({ stable: "stuck", wins: 5, rating: 66, bandRating: 68, licence: 1 });
    expect(plan({ meeting: 7, horses: [...young, stuck], recentEntries: 4 })).toHaveLength(1);
    // cover races only use free slots
    expect(plan({ meeting: 7, horses, recentEntries: 4, slots: 1 })).toHaveLength(1);
  });

  it("races the meeting already has count: their horses are covered, their trips are kept clear, and they count towards the size", () => {
    const horses = starters(40);
    const hcp55 = OPTIONS.find((o) => o.key === "hcp55")!;
    const fixed = [{ ...hcp55, distanceM: 1500 }];
    // sized for two races, one is already there: one more, of another class, at another trip
    const races = plan({ horses, recentEntries: 8, slots: 3, fixed });
    expect(races).toHaveLength(1);
    expect(Math.abs(races[0]!.distanceM - 1500)).toBeGreaterThanOrEqual(CARD_TRIP_SPREAD_M);
    // sized for one: the meeting still gets a race of its own
    expect(plan({ horses, recentEntries: 0, slots: 3, fixed })).toHaveLength(1);
  });

  it("classes that cover nearly as many horses take turns, and each class's trips and surfaces all come round", () => {
    const horses = starters(40).concat(Array.from({ length: 40 }, (_, i) => horse({ stable: `beta${i % 40}`, distanceM: 1000 + 50 * i, surface: CARD_SURFACES[i % 3]! })));
    const seen = new Map<string, Set<string>>();
    for (let m = 0; m < 96; m++) {
      const [r] = plan({ meeting: m, horses, recentEntries: 0 });
      seen.set(r!.key, (seen.get(r!.key) ?? new Set()).add(`${r!.distanceM}:${r!.surface}`));
    }
    // twelve days of one-race meetings: several classes, and the juvenile ones run every trip on every surface
    expect(seen.size).toBeGreaterThanOrEqual(2);
    for (const key of ["maiden", "novice"]) if (seen.has(key)) expect(seen.get(key)!.size).toBe(JUVENILE.length * CARD_SURFACES.length);
    if (seen.has("hcp55")) expect(new Set([...seen.get("hcp55")!].map((x) => x.split(":")[0])).size).toBeGreaterThanOrEqual(6);
  });

  it("trips nobody is suited to are skipped, and the surface is one a suited horse prefers", () => {
    // every horse is a dirt sprinter
    const horses = Array.from({ length: 12 }, (_, i) => horse({ stable: `sprint${i}`, distanceM: 1100, surface: "dirt" }));
    for (let m = 0; m < 24; m++) {
      const [r] = plan({ meeting: m, horses, recentEntries: 0 });
      expect(tripSuits(1100, r!.distanceM)).toBe(true);
      expect(r!.surface).toBe("dirt");
    }
  });

  it("an empty world still gets one race a meeting, of a class every new horse can enter", () => {
    const keys = new Set<string>();
    for (let m = 0; m < 30; m++) {
      const races = plan({ meeting: m });
      expect(races).toHaveLength(1);
      keys.add(races[0]!.key);
    }
    expect([...keys].sort()).toEqual(["hcp55", "maiden", "novice"]);
    // one or two stables: their class, even below the minimum
    const two = [horse({ stable: "a", wins: 3, rating: 40, bandRating: 41 }), horse({ stable: "b", wins: 4, rating: 44, bandRating: 45 })];
    for (let m = 0; m < 6; m++) expect(plan({ meeting: m, horses: two }).map((r) => r.key)).toEqual(["hcp55"]);
  });

  it("is deterministic and never returns more races than slots", () => {
    const horses = starters(25).concat([horse({ wins: 6, rating: 90, bandRating: 92, licence: 3 }), horse({ wins: 3, rating: 72, bandRating: 73, licence: 2 })]);
    for (let m = 0; m < 40; m++) {
      for (const slots of [1, 2, 3, 4, 8]) {
        const input = { meeting: m, slots, horses, recentEntries: (m * 3) % 20 };
        const a = plan(input);
        expect(plan(input)).toEqual(a);
        expect(a.length).toBeGreaterThanOrEqual(1);
        expect(a.length).toBeLessThanOrEqual(slots);
      }
    }
  });
});
