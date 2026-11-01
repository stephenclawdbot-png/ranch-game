/**
 * Chapter 1 must not be a wall of losses (first-hour follow-up, 2026-11-01). A smaller, seeded run
 * of the Story curve probe (storyProbe.ts; the full 40-stable run is
 * tools/season-harness/storyCurve.harness.ts) holds the owner's targets: brand-new stables
 * finish chapter 1 in a median of at most 8 Story races (90th percentile 14), their longest losing
 * run is typically at most 4 (90th percentile 6), and the first County race is no cliff (the
 * Championship's step up is measured by the full probe: too few runs here). And the field a chapter race is run against is chosen
 * deterministically from the stable's own records and stored with the race.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { authenticate, createDb, getRace, listStableHorses, type DbHandle } from "@thoroughbred/db";
import { installDeterministicRandom } from "../../../../tools/season-harness/src/determinism";
import { foundStable } from "./founding";
import { parseSilks, stableHorseView } from "./horseView";
import { chapterResults, createChapterRace } from "./story";
import { pct, probeStable, summarise, type ProbeStable } from "./storyProbe";

let h: DbHandle;
beforeAll(async () => {
  installDeterministicRandom("story-curve-test");
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 9, 9, 0, 0);

describe("the Story curve (seeded probe)", () => {
  it("new stables finish chapter 1 without a wall of losses, and step into chapter 2 without a cliff", { timeout: 900_000 }, async () => {
    const rs: ProbeStable[] = [];
    for (let i = 0; i < 12; i++) rs.push(await probeStable(h.db, i, { startMs: START + i * DAY + ((i * 5) % 12) * 3_600_000, ch2Races: 1, rest: "race", maxCh1Races: 24 }));
    const s = summarise(rs);
    expect(s.finished).toBe(rs.length);
    expect(s.ch1Median).toBeLessThanOrEqual(8);
    expect(s.ch1P90).toBeLessThanOrEqual(14);
    expect(s.streakMedian).toBeLessThanOrEqual(4);
    expect(s.streakP90).toBeLessThanOrEqual(6);
    expect(s.ch2FirstWinPct).toBeGreaterThanOrEqual(12);
    // Every chapter race was run against a field chosen from the runner (never the published 318+).
    const club = rs.flatMap((r) => r.races.filter((x) => x.raceKey));
    for (const x of club) {
      const base = x.level - (x.raceKey === "club-6" ? gc.STORY_CLUB_FINAL_BELOW : gc.STORY_CLUB_BELOW);
      if (x.strength === gc.STORY_STRENGTH_FLOOR) continue;
      expect(x.strength! - base).toBeGreaterThanOrEqual(-gc.STORY_EASE_MAX);
      expect(x.strength! - base).toBeLessThanOrEqual(gc.STORY_STIFFEN_MAX);
    }
    expect(pct(rs.map((r) => r.racingMinutes), 50)).toBeLessThan(60);
  });
});

describe("a chapter race's field", () => {
  it("is chosen from the runner's level and the stable's run of results in the chapter, and stored with the race", { timeout: 120_000 }, async () => {
    const t0 = new Date(Date.UTC(2026, 10, 20, 10, 0, 0));
    const acc = await foundStable(h.db, { stableName: "Field Choice Yard", silks: { pattern: "hoops", primary: "#112233", secondary: "#c8a040", cap: "#112233" }, inviteCode: null, now: t0 });
    const s = (await authenticate(h.db, acc.token))!;
    const silks = parseSilks(s.stable.silks);
    const def = gc.storyRaceByKey("club-2")!;
    for (let k = 0; k < 3; k++) {
      const now = new Date(t0.getTime() + k * 6 * 3_600_000);
      const rows = await listStableHorses(h.db, s.stable.id);
      const row = rows[k % rows.length]!;
      const recent = await chapterResults(h.db, s.stable.id, "club");
      const expected = gc.storyField({ race: def, runnerLevel: gc.meanStat(stableHorseView(row, silks, now.getTime()).horse), recent });
      const created = await createChapterRace(h.db, s, { raceKey: def.key, horseId: row.id, instant: true }, now);
      const story = ((await getRace(h.db, created.raceId))!.conditions as { story: { strength: number; field: { base: number; adjust: number; note: string | null } } }).story;
      expect(story.strength).toBe(expected.strength);
      expect(story.field).toMatchObject({ base: expected.base, adjust: expected.adjust, note: expected.note });
      if ((await chapterResults(h.db, s.stable.id, "club"))[0]) break; // won it: the next run would be a replay
    }
  });
});
