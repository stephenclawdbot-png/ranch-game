/**
 * Sister courses (§4d) at the web layer: entering a full Live race lands on the slot's
 * sister course, Quick Pick prefers a race with real players over an equally fitting empty
 * one, and the race card lists a sister as its own row right after its original, with the
 * other courses named underneath.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, createRace, gameCoreHooks, getRace, insertHorse, listRaceEntries, listStableHorses, stableOf, type CreateRaceInput, type DbHandle } from "@thoroughbred/db";
import { conditionRating } from "@/lib/aptitude";
import { enterLive, quickPickLive, raceList } from "./game";
import { DEFAULT_SILKS, horseFromRow } from "./horseView";
import type { Session } from "./session";
import { SLOT_KEY_PREFIX } from "@thoroughbred/db";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 2, 12, 0, 7));
const at = (ms: number) => new Date(T0.getTime() + ms);

async function player(name: string, starters = 3): Promise<Session> {
  const acc = await createAccount(h.db, {
    stableName: name,
    silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" },
    timezone: "Europe/London",
    starterHorses: starters,
    now: T0,
  });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

async function firstHorse(s: Session): Promise<string> {
  const rows = await listStableHorses(h.db, s.stable.id);
  return rows.find((r) => r.careerStatus === "racing" && !r.lockKind)!.id;
}

let slotN = 0;
/** A Live card race in a far-future slot (never collides with a published card slot). */
function slotRace(extra: Partial<CreateRaceInput> = {}) {
  return createRace(h.db, {
    kind: "scheduled",
    name: "Ashcombe Sprint Maiden",
    raceClass: "maiden",
    conditions: { maxWins: 0, minRating: 0, maxRating: 140, distanceM: 1400, surface: "turf", going: "good", weather: "clear", track: "Ashcombe" },
    postTime: at(45_000),
    entriesCloseAt: at(15_000),
    purse: 2_000,
    maxRunners: 3,
    targetRunners: 3,
    slotKey: `${SLOT_KEY_PREFIX}9${String(++slotN).padStart(6, "0")}`,
    ...extra,
  });
}

const PLAN = { tactic: "front" as const, intensity: "normal" as const };

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("sister courses", () => {
  it("entering a full Live race lands on its sister; the card lists the sister right after", async () => {
    const a = await player("Alpha");
    const b = await player("Bravo");
    const c = await player("Charlie");
    const d = await player("Delta");
    const race = await slotRace(); // 3 gates: two entries open the sister, three fill it
    await enterLive(h.db, a, race.id, await firstHorse(a), PLAN, T0);
    await enterLive(h.db, b, race.id, await firstHorse(b), PLAN, T0); // one gate left opens the sister
    await enterLive(h.db, c, race.id, await firstHorse(c), PLAN, T0); // full
    const entered = await enterLive(h.db, d, race.id, await firstHorse(d), PLAN, T0); // RACE_FULL -> sister
    expect(entered.raceId).not.toBe(race.id);
    const sister = (await getRace(h.db, entered.raceId))!;
    expect(sister.slotKey).toBe(`${race.slotKey}:2`);
    expect(sister.name).toBe("Kestrel Downs Sprint Maiden");
    expect((await listRaceEntries(h.db, entered.raceId)).map((e) => e.stableId)).toContain(d.stable.id);
    const { upcoming } = await raceList(h.db, T0, d.stable.id, { upcoming: 8 });
    const i = upcoming.findIndex((r) => r.id === race.id);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(upcoming[i + 1]!.id).toBe(sister.id); // sisters sort right after their original
    expect(upcoming[i]!.alsoAt).toEqual(["Kestrel Downs"]); // the caption under the original
  });

  it("quick pick prefers a race with three real players over an equally fitting empty one", async () => {
    const NOW = at(5 * 60_000); // past the previous test's races (they are closed by then)
    const p = await player("Picker", 0);
    // One deterministic horse, rated past every calendar band: eligible for the two races below.
    const spec = { ...gameCoreHooks.starterHorse({ seed: "sister-pick", index: 0, season: 1 }), rating: 90 };
    const horseId = await insertHorse(h.db, { stableId: p.stable.id, spec, origin: "admin", now: T0 });
    const row = (await listStableHorses(h.db, p.stable.id)).find((r) => r.id === horseId)!;
    const horse = horseFromRow(row, DEFAULT_SILKS, T0.getTime());
    // Conditions the two races share, hostile enough that the empty one is not an early win.
    const surface = (["turf", "dirt", "synthetic"] as const).find((s) => s !== horse.preferredSurface)!;
    const ideal = conditionRating(horse, horse.style, { distanceM: horse.preferredDistanceM, surface: horse.preferredSurface, going: "good" });
    const fit = (c: { distanceM: number; surface: typeof surface; going: "heavy" }) => ideal - conditionRating(horse, horse.style, c);
    const CONDS = [3200, 2800, 1000, 1200].map((distanceM) => ({ distanceM, surface, going: "heavy" as const })).find((c) => fit(c) > 25)!;
    const early = await slotRace({ postTime: at(5 * 60_000 + 40_000), entriesCloseAt: at(5 * 60_000 + 10_000), maxRunners: 12, targetRunners: 10, conditions: { ...CONDS, track: "Ashcombe" } });
    const busy = await slotRace({ postTime: at(5 * 60_000 + 50_000), entriesCloseAt: at(5 * 60_000 + 20_000), maxRunners: 12, targetRunners: 10, conditions: { ...CONDS, track: "Bellmont" } });
    for (const name of ["Rival One", "Rival Two", "Rival Three"]) {
      const r = await player(name);
      await enterLive(h.db, r, busy.id, await firstHorse(r), PLAN, NOW);
    }
    const pick = await quickPickLive(h.db, p, NOW);
    expect(pick.raceId).toBe(busy.id);
    expect(pick.rivals).toBe(3);
  });
});