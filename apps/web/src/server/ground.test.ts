/**
 * Ground & weather: the forecast agrees with the published card, never shows more than the card
 * has published (the outlook is a forecast, with no exact going or sky), and the racecard's
 * ground trend comes from the race's course.
 */
import { describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { RULES, cardSlotAt, slotIndexAt } from "@thoroughbred/db";
import { GET } from "../../app/api/ground/route";
import { groundView, raceGroundTrend } from "./ground";

const CLOCK = { epochMs: RULES.seasonEpochMs };

describe("ground & weather forecast", () => {
  it("matches every race on the published card, course by course", () => {
    for (const now of [new Date(Date.UTC(2026, 10, 2, 12, 0, 7)), new Date(Date.UTC(2026, 11, 1, 5, 30)), new Date(Date.UTC(2027, 1, 14, 20, 0))]) {
      const view = groundView(now);
      expect(view.courses).toHaveLength(6);
      expect(view.yearSeason).toBe(gc.yearSeasonOf(view.season));
      const first = slotIndexAt(now) + 1;
      const last = slotIndexAt(new Date(now.getTime() + RULES.cardHorizonMs));
      let checked = 0;
      for (let i = first; i <= last; i++) {
        const slot = cardSlotAt(i);
        if (!slot) continue;
        const c = slot.conditions as { track: string; surface: "turf" | "dirt" | "synthetic"; going: string; weather: string };
        const course = view.courses.find((x) => x.name === c.track)!;
        const day = course.days.find((d) => d.day === Math.floor(slot.postTime.getTime() / gc.MS_PER_DAY));
        expect(day, `${c.track} on ${slot.postTime.toISOString()} is on the card, so the forecast has it exactly`).toBeDefined();
        expect(day!.going[c.surface]).toBe(c.going);
        expect(c.weather === "dusk" ? "clear" : c.weather).toBe(day!.sky);
        checked++;
      }
      expect(checked).toBeGreaterThan(20);
    }
  });

  it("shows nothing exact beyond the published card: the outlook has odds, not answers", () => {
    const now = new Date(Date.UTC(2026, 10, 4, 9, 0));
    const view = groundView(now);
    const edge = now.getTime() + RULES.cardHorizonMs;
    for (const c of view.courses) {
      for (const d of c.days) expect(d.dayStartMs).toBeLessThanOrEqual(edge);
      expect(c.outlook).toHaveLength(gc.OUTLOOK_DAYS);
      for (const o of c.outlook) {
        expect(Object.keys(o).sort()).toEqual(["day", "dayStartMs", "frostChancePct", "likelyGoing", "rainChancePct", "yearSeason"]);
        expect(o.dayStartMs).toBeGreaterThan(c.days.at(-1)!.dayStartMs);
      }
    }
    expect(JSON.stringify(view)).not.toContain("moisture");
  });

  it("GET /api/ground serves the forecast without a session", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { ground: ReturnType<typeof groundView> };
    expect(body.ground.courses.map((c) => c.name)).toEqual(gc.COURSES.map((c) => c.name));
    expect(body.ground.courses[0]!.days.length).toBeGreaterThan(0);
    expect(body.ground.courses[0]!.character.length).toBeGreaterThan(10);
  });
});

describe("racecard ground trend", () => {
  it("is the course's trend for a card race; null when the going isn't the course's or the surface is synthetic", () => {
    const base = slotIndexAt(new Date(Date.UTC(2026, 10, 2, 6, 0)));
    let seen = 0;
    for (let i = base; i < base + gc.SLOTS_PER_DAY * 3; i++) {
      const slot = cardSlotAt(i);
      if (!slot) continue;
      const c = slot.conditions as { track: string; surface: string; going: string };
      const trend = raceGroundTrend(c, slot.postTime);
      if (c.surface === "synthetic") expect(trend).toBeNull();
      else {
        const course = gc.courseByName(c.track)!;
        expect(trend).toBe(gc.groundTrend(CLOCK, course.id, Math.floor(slot.postTime.getTime() / gc.MS_PER_DAY)));
        seen++;
        const other = c.going === "heavy" ? "firm" : "heavy";
        expect(raceGroundTrend({ ...c, going: other }, slot.postTime)).toBeNull(); // e.g. a sister on its original's ground
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(raceGroundTrend({ track: "Nowhere Park", surface: "turf", going: "good" }, new Date())).toBeNull();
    expect(raceGroundTrend({}, new Date())).toBeNull();
  });
});
