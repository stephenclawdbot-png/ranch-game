import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../client";
import { hallOfFame, horses } from "../schema";
import { createRace, enterRace, getRaceForSimulation, settleRace } from "../services/races";
import { careerStoryInput, careerStoryOf } from "../services/careerStory";
import { DAY, MIN, at, getHorseRow, makeHorse, memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

const FINISH_US = 70_000_000;
let slot = 0;

type Runner = { accountId: string; horseId: string };
/** A Live race settled 61 s after the off with `order` in front; margins in mm by position from 2nd. */
async function race(entries: Runner[], opts: { order: string[]; day: number; margins?: number[]; name?: string; raceClass?: string; kind?: "scheduled" | "feature"; injured?: string; ratings?: Record<string, number> }) {
  const base = opts.day * DAY + ++slot * 20 * MIN;
  const r = await createRace(h.db, {
    kind: opts.kind ?? "scheduled",
    name: opts.name ?? `Saltmarsh Stakes ${slot}`,
    raceClass: opts.raceClass ?? "maiden",
    conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" },
    postTime: at(base + 10 * MIN),
    entriesCloseAt: at(base + 9 * MIN),
    targetRunners: Math.max(2, entries.length),
    purse: 1_000,
  });
  for (const e of entries) await enterRace(h.db, { ...e, raceId: r.id, tactic: "stalker", now: at(base) });
  const now = at(base + 10 * MIN + 61_000);
  const { field } = await getRaceForSimulation(h.db, r.id, now);
  const order = [...opts.order, ...field.runners.map((x) => x.horseId).filter((id) => !opts.order.includes(id))];
  const margin = (i: number) => opts.margins?.[i - 1] ?? 5_000;
  const finishOrder = order.map((horseId, i) => ({
    horseId,
    position: i + 1,
    finishTimeUs: FINISH_US - (order.length - 1 - i) * 100_000,
    marginMm: i === 0 ? 0 : margin(i),
    marginLabel: i === 0 ? "" : margin(i) < 150 ? "nose" : "2",
    prize: 0,
  }));
  const result = { finishOrder, winningTimeUs: finishOrder[0]!.finishTimeUs, photoFinish: margin(1) < 150, resultHash: "0".repeat(64) };
  await settleRace(h.db, {
    raceId: r.id,
    now,
    resultHash: "0".repeat(64),
    result,
    runners: order.map((horseId, i) => ({
      horseId,
      position: i + 1,
      ...(opts.ratings?.[horseId] !== undefined ? { ratingAfter: opts.ratings[horseId] } : {}),
      ...(opts.injured === horseId ? { injury: { severity: "minor" as const, recoveryMs: 3 * DAY } } : {}),
    })),
  });
  return { race: r, now, after: new Date(r.postTime.getTime() + 80_000) };
}

describe("career story (db)", () => {
  it("debut, win, photo-finish loss, injury and comeback, the rival and a foal's win; nothing before the broadcast ends", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    const mare = await makeHorse(h.db, a.stableId, { name: "Sea Lavender", sex: "female" });
    const riot = await makeHorse(h.db, b.stableId, { name: "Quiet Riot", sex: "male" });
    const me: Runner = { accountId: a.accountId, horseId: mare.id };
    const them: Runner = { accountId: b.accountId, horseId: riot.id };

    // debut: 2nd to Quiet Riot by two lengths
    const r1 = await race([me, them], { order: [riot.id, mare.id], day: 0, name: "Saltmarsh Maiden Stakes", ratings: { [mare.id]: 40 } });
    // first win, from Quiet Riot
    const r2 = await race([me, them], { order: [mare.id, riot.id], day: 2, name: "Ashcombe Maiden Stakes", ratings: { [mare.id]: 52 } });
    // beaten a nose by Quiet Riot, and hurt
    const r3 = await race([me, them], { order: [riot.id, mare.id], day: 4, margins: [100], name: "Bellmont Mile", injured: mare.id, ratings: { [mare.id]: 55 } });
    // back nine days later and wins
    const r4 = await race([me, them], { order: [mare.id, riot.id], day: 13, name: "Kestrel Downs Handicap (0-55)", raceClass: "handicap", ratings: { [mare.id]: 60 } });

    // her son wins a Feature
    const foal = await makeHorse(h.db, a.stableId, { name: "Copper Kettle", sex: "male", damId: mare.id });
    const f1 = await race([{ accountId: a.accountId, horseId: foal.id }], { order: [foal.id], day: 20, kind: "feature", raceClass: "listed", name: "Saltmarsh Cup" });

    const row = await getHorseRow(h.db, mare.id);
    const story = await careerStoryOf(h.db, row, f1.after);
    const texts = story.map((e) => e.text);
    expect(story.map((e) => e.atMs)).toEqual([...story.map((e) => e.atMs)].sort((x, y) => x - y));

    const byRace = (id: string) => story.find((e) => e.key === `race:${id}`)!;
    expect(byRace(r1.race.id)).toMatchObject({ kind: "debut", text: "Made her debut in the Saltmarsh Maiden Stakes, 2nd of 2.", raceId: r1.race.id });
    expect(byRace(r2.race.id)).toMatchObject({ kind: "first_win", text: "Won the Ashcombe Maiden Stakes by 2 lengths, her first win at start 2." });
    const loss = byRace(r3.race.id);
    expect(loss.tags).toEqual(expect.arrayContaining(["photo_loss", "injury"]));
    expect(loss.text).toBe("Beaten a nose by Quiet Riot in the Bellmont Mile, her third meeting with him. Came home injured, nine days off.");
    const comeback = byRace(r4.race.id);
    expect(comeback.tags).toEqual(expect.arrayContaining(["comeback", "biggest_win", "rating_peak"]));
    expect(comeback.text).toBe("Won the Kestrel Downs Handicap (0-55) by 2 lengths, the biggest win of her career. First time back, nine days after an injury in the Bellmont Mile. Rated 60 afterwards, her career high.");
    expect(texts).toContain("Quiet Riot became her rival: four meetings, more than any other horse, and 2–2 against him.");
    expect(story.find((e) => e.kind === "rival")).toMatchObject({ raceId: r4.race.id, horseId: riot.id });
    expect(story.at(-1)).toMatchObject({ kind: "foal_big_win", text: "Her son Copper Kettle won the Saltmarsh Cup, his first win.", raceId: f1.race.id, horseId: foal.id });
    expect(story.every((e) => e.highlight)).toBe(true);
    // nothing private: no credits, prizes or fees in any line
    expect(texts.join(" ")).not.toMatch(/cr\b|credit|prize|fee/i);

    // a race still being broadcast (and the retirement it caused) is not in the story yet
    const r5 = await race([me, them], { order: [riot.id, mare.id], day: 30, margins: [100], name: "Late Mile" });
    await h.db.update(horses).set({ careerStatus: "retired", retirementReason: "choice", retiredAt: r5.now }).where(eq(horses.id, mare.id));
    const during = await careerStoryInput(h.db, await getHorseRow(h.db, mare.id), r5.now);
    expect(during.runs.map((r) => r.raceId)).not.toContain(r5.race.id);
    expect(during.horse.retiredAtMs).toBeNull();
    const done = await careerStoryOf(h.db, await getHorseRow(h.db, mare.id), r5.after);
    expect(done.some((e) => e.raceId === r5.race.id)).toBe(true);
    expect(done.at(-1)!.text).toBe("Retired to the broodmare band after five starts and two wins.");
  });

  it("an unraced horse has no story until something happens to it: a Hall of Fame induction counts", async () => {
    const a = await newPlayer(h.db);
    const filly = await makeHorse(h.db, a.stableId, { name: "Marsh Light", sex: "female" });
    expect(await careerStoryOf(h.db, filly, at(100 * DAY))).toEqual([]);
    await h.db.insert(hallOfFame).values({ entryKey: `horse:${filly.id}:great_racehorse`, category: "great_racehorse", title: "Marsh Light: Great racehorse", horseId: filly.id, inductedAt: at(50 * DAY) });
    const story = await careerStoryOf(h.db, filly, at(100 * DAY));
    expect(story.map((e) => e.text)).toEqual(["Inducted into the Hall of Fame: Great racehorse."]);
  });
});
