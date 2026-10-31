import { describe, expect, it } from "vitest";
import { NEWS_KINDS, NEWS_TEMPLATES, newsHeadline } from "./news";
import { entryWindow, freshnessOutlook, planReminderDue, restHoursAfter, targetClashes } from "./planning";
import { findNemesis, horseHeadToHead, rankRivals, raceRivalLines, stableHeadToHead, type RaceMeeting } from "./rivals";
import { MS_PER_DAY, MS_PER_HOUR } from "./time";

const run = (horseId: string, stableId: string | null, position: number, marginMm: number) => ({ horseId, horseName: horseId.toUpperCase(), stableId, stableName: stableId ? `Stable ${stableId}` : "The Club", position, marginMm });
const meet = (raceId: string, atMs: number, runners: ReturnType<typeof run>[]): RaceMeeting => ({ raceId, raceName: `Race ${raceId}`, atMs, runners });

describe("rivals", () => {
  const ms = [
    meet("r1", 1, [run("b1", "B", 1, 0), run("a1", "A", 2, 300), run("c1", "C", 3, 5000)]),
    meet("r2", 2, [run("b1", "B", 1, 0), run("a1", "A", 2, 100), run("k", null, 3, 50)]),
    meet("r3", 3, [run("a1", "A", 1, 0), run("b1", "B", 2, 200)]),
    meet("r4", 4, [run("k", null, 1, 0), run("a2", "A", 2, 10)]),
  ];
  it("stable H2H counts meetings, who was ahead and close finishes; the Club is nobody's rival", () => {
    const h = stableHeadToHead(ms, "A");
    const b = h.find((x) => x.stableId === "B")!;
    expect(b).toMatchObject({ meetings: 3, ahead: 1, behind: 2, close: 3, closeAhead: 1 });
    expect(b.last).toMatchObject({ raceId: "r3", ahead: true });
    expect(h.find((x) => x.stableId === "C")).toMatchObject({ meetings: 1, close: 0 });
    expect(h.some((x) => !x.stableId)).toBe(false);
    expect(rankRivals(h).map((r) => r.stableId)).toEqual(["B"]);
  });
  it("nemesis: the horse that beat yours in close finishes most often", () => {
    const n = findNemesis(horseHeadToHead(ms, "A"));
    expect(n).toMatchObject({ horseId: "b1", stableId: "B", closeBeats: 2 });
    expect(findNemesis(horseHeadToHead(ms.slice(2), "A"))).toBeNull();
  });
  it("first win over a horse after earlier defeats", () => {
    const lines = raceRivalLines(ms, "r3", "A", { rivalIds: new Set(["B"]) });
    expect(lines[0]).toBe("You beat Stable B's B1 for the first time in 3 meetings.");
    expect(lines[1]).toBe("Against your rivals Stable B: you came out ahead in a close finish. They lead 2–1.");
  });
});

describe("news templates", () => {
  it("every kind has three or more templates and picks deterministically", () => {
    for (const k of NEWS_KINDS) expect(NEWS_TEMPLATES[k].length).toBeGreaterThanOrEqual(3);
    const f = { horse: "Copper Comet", stable: "Thistle Mead", race: "Saltmarsh Feature", track: "Saltmarsh", margin: "a nose", other: "Sea Holly" };
    expect(newsHeadline("photo_finish", f, "k1")).toBe(newsHeadline("photo_finish", f, "k1"));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => newsHeadline("photo_finish", f, `k${i}`)));
    expect(seen.size).toBe(3);
    expect([...seen].join(" ")).not.toMatch(/odds|bet|stake your|punter/i);
  });
});

describe("planning", () => {
  const t0 = 1_000 * MS_PER_DAY;
  it("freshness window from the last hard work", () => {
    expect(freshnessOutlook(t0, t0 + 80 * MS_PER_HOUR).phase).toBe("peak");
    expect(freshnessOutlook(t0, t0 + 50 * MS_PER_HOUR)).toMatchObject({ phase: "building", peakFromMs: t0 + 72 * MS_PER_HOUR });
    expect(freshnessOutlook(t0, t0 + 150 * MS_PER_HOUR).phase).toBe("fading");
    expect(freshnessOutlook(t0, t0 + 300 * MS_PER_HOUR).phase).toBe("flat");
    expect(freshnessOutlook(null, t0).peakFromMs).toBeNull();
  });
  it("clashes: same day, or inside the rest", () => {
    expect(restHoursAfter(300)).toBe(0);
    expect(restHoursAfter(420)).toBe(10);
    const c = targetClashes([
      { key: "a", postTimeMs: t0 + 10 * MS_PER_HOUR, live: true, fatigue: 420 },
      { key: "b", postTimeMs: t0 + 12 * MS_PER_HOUR, live: true, fatigue: 420 },
      { key: "c", postTimeMs: t0 + 25 * MS_PER_HOUR, live: true, fatigue: 420 },
      { key: "d", postTimeMs: t0 + 4 * MS_PER_DAY, live: true, fatigue: 420 },
    ]);
    expect(c.map((x) => `${x.a}${x.b}`)).toEqual(["ab"]);
    const r = targetClashes([
      { key: "a", postTimeMs: t0 + 23 * MS_PER_HOUR, live: true, fatigue: 420 },
      { key: "b", postTimeMs: t0 + 26 * MS_PER_HOUR, live: true, fatigue: 420 },
    ]);
    expect(r[0]!.reason).toMatch(/10 h/);
  });
  it("entry window and reminders", () => {
    const w = (now: number) => entryWindow(t0, t0 - 30_000, now, MS_PER_DAY);
    expect(w(t0 - 2 * MS_PER_DAY).state).toBe("not_open");
    expect(planReminderDue(w(t0 - 20 * MS_PER_HOUR), t0 - 20 * MS_PER_HOUR, false)).toBe("open");
    expect(planReminderDue(w(t0 - MS_PER_HOUR), t0 - MS_PER_HOUR, false)).toBe("closing");
    expect(planReminderDue(w(t0 - MS_PER_HOUR), t0 - MS_PER_HOUR, true)).toBeNull();
    expect(planReminderDue(w(t0), t0, false)).toBeNull();
  });
});
