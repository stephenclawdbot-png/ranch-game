/**
 * Rivals on the web side: the post-race rival lines endpoint answers 425 until the race's
 * broadcast is over (no spoilers), the racecard tags a rival stable's runner and the nemesis,
 * and the news feed hides a race's items until then. Uses the shared PGlite singleton at real time.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import * as gc from "@thoroughbred/game-core";
import { GET as RIVAL_LINES } from "../../app/api/races/[id]/rivals/route";
import { createAccount, createRace, enterRace, getRaceForSimulation, insertHorse, settleRace, specFromGenome, stableOf, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { raceCard } from "./game";
import { newsFeed } from "./social";

let h: DbHandle;
const silks = { pattern: "hoops", primary: "#2c5f2d", secondary: "#f3e7c9", cap: "#263238" } as const;
type Who = { token: string; accountId: string; stableId: string; horseId: string };
let a: Who;
let b: Who;

async function addHorse(stableId: string, name: string): Promise<string> {
  const genome = gc.generateFoundationGenome(gc.seedFrom("web-rivals", name), { season: 1 });
  return insertHorse(h.db, { stableId, spec: { ...specFromGenome({ genome, name, sex: "colt", careSessions: 19, season: 1 }), rating: 0 }, origin: "admin", now: new Date(Date.now() - 30 * 86_400_000) });
}

async function founded(name: string, horse: string): Promise<Who> {
  const acc = await createAccount(h.db, { stableName: name, silks, startingCredits: 20_000, timezone: "Europe/London", now: new Date(Date.now() - 30 * 86_400_000) });
  const stableId = (await stableOf(h.db, acc.accountId)).id;
  const genome = gc.generateFoundationGenome(gc.seedFrom("web-rivals", name), { season: 1 });
  const horseId = await insertHorse(h.db, { stableId, spec: { ...specFromGenome({ genome, name: horse, sex: "colt", careSessions: 19, season: 1 }), rating: 0 }, origin: "admin", now: new Date(Date.now() - 30 * 86_400_000) });
  return { token: acc.token, accountId: acc.accountId, stableId, horseId };
}

/** A two-runner Feature that went off `agoMs` ago, settled now, B by a nose; the last finisher crosses the line 70 s after the off. */
async function closeFinish(agoMs: number, i: number, ha = a.horseId, hb = b.horseId) {
  const post = new Date(Date.now() - agoMs);
  const race = await createRace(h.db, { kind: "feature", name: `Saltmarsh Feature ${i}`, raceClass: "listed", conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" }, postTime: post, entriesCloseAt: new Date(post.getTime() - 30_000), targetRunners: 2 });
  const enteredAt = new Date(post.getTime() - 60_000);
  await enterRace(h.db, { accountId: a.accountId, horseId: ha, raceId: race.id, tactic: "stalker", now: enteredAt, goalNow: enteredAt });
  await enterRace(h.db, { accountId: b.accountId, horseId: hb, raceId: race.id, tactic: "stalker", now: enteredAt, goalNow: enteredAt });
  const now = new Date();
  await getRaceForSimulation(h.db, race.id, now);
  const finishOrder = [
    { horseId: hb, position: 1, finishTimeUs: 69_900_000, marginMm: 0, marginLabel: "", prize: 0 },
    { horseId: ha, position: 2, finishTimeUs: 70_000_000, marginMm: 80, marginLabel: "nose", prize: 0 },
  ];
  await settleRace(h.db, { raceId: race.id, now, resultHash: "0".repeat(64), result: { finishOrder, winningTimeUs: 69_900_000, photoFinish: true, resultHash: "0".repeat(64) }, runners: [{ horseId: hb, position: 1 }, { horseId: ha, position: 2 }] });
  return race;
}

beforeAll(async () => {
  h = await dbHandle();
  a = await founded("Rival Home", "Home Comet");
  b = await founded("Thistle Mead", "Copper Comet");
});
afterAll(() => {
  jar.token = null;
});

describe("rivals on the web", () => {
  it("rival lines 425 until the broadcast is over; tags and news only from public results", async () => {
    // three close finishes days ago (the horses' one-a-day Live cap: one per day)
    for (let d = 4; d >= 2; d--) await closeFinish(d * 86_400_000, d);
    // a fourth (other horses) that went off 10 s ago: settled, but its broadcast (2 s + 70 s + grace) is still running
    const running = await closeFinish(10_000, 0, await addHorse(a.stableId, "Home Star"), await addHorse(b.stableId, "Tin Comet"));
    jar.token = a.token;
    const res = await RIVAL_LINES(new Request(`https://tb.example/api/races/${running.id}/rivals`), { params: Promise.resolve({ id: running.id }) });
    expect(res.status).toBe(425);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/Comet|lines/);
    // the news has the older Features but nothing yet about the running one
    const news = await newsFeed(h.db, null, "all", new Date());
    expect(news.some((n) => n.href === `/race/${running.id}`)).toBe(false);
    expect(news.some((n) => /Copper Comet/.test(n.headline))).toBe(true);

    // a racecard with both stables: B is a rival and Copper Comet the nemesis
    const post = new Date(Date.now() + 3 * 3_600_000);
    const next = await createRace(h.db, { kind: "scheduled", name: "Saltmarsh Handicap", raceClass: "handicap", conditions: { distanceM: 1400, surface: "turf", track: "Saltmarsh" }, postTime: post, entriesCloseAt: new Date(post.getTime() - 30_000), targetRunners: 6 });
    await enterRace(h.db, { accountId: b.accountId, horseId: b.horseId, raceId: next.id, tactic: "stalker", now: new Date() });
    const card = await raceCard(h.db, next.id, new Date(), a.stableId);
    const runner = card.field.find((e) => e.horse.id === b.horseId)!;
    expect(runner.rival).toBe("nemesis");
    expect(runner.stableId).toBe(b.stableId);
    // the stable that is viewing sees no tag on its own horse, and a signed-out card has none
    const anon = await raceCard(h.db, next.id, new Date(), null);
    expect(anon.field.every((e) => !e.rival)).toBe(true);
  });
});
