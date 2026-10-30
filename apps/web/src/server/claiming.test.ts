/**
 * Claiming races, web side: the entry sheet's claim band, entering with a claim price
 * (/api/races/[id]/enter), lodging a claim (/api/races/[id]/claim), the racecard's prices and
 * claim counts (never who), and the Claiming flag on the race summary. Uses the shared PGlite singleton,
 * like the routes, at real time. Seller requirements are relaxed by env (as on a playtest server).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import * as gc from "@thoroughbred/game-core";
import { POST as ENTER } from "../../app/api/races/[id]/enter/route";
import { POST as CLAIM } from "../../app/api/races/[id]/claim/route";
import { createAccount, createRace, getBalance, insertHorse, specFromGenome, stableOf, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { entryOptions, raceCard } from "./game";
import type { Session } from "./session";

let h: DbHandle;
const silks = { pattern: "hoops", primary: "#8e2323", secondary: "#f3e7c9", cap: "#263238" } as const;
type Who = { token: string; accountId: string; stableId: string };
let owner: Who;
let buyer: Who;
let horseId: string;
let raceId: string;

async function founded(name: string): Promise<Who> {
  const acc = await createAccount(h.db, { stableName: name, silks, startingCredits: 60_000, timezone: "Europe/London", now: new Date() });
  return { token: acc.token, accountId: acc.accountId, stableId: (await stableOf(h.db, acc.accountId)).id };
}

const call = (fn: typeof ENTER, path: string, body: unknown) =>
  fn(new Request(`https://tb.example/api/races/${raceId}/${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: raceId }) });

beforeAll(async () => {
  vi.stubEnv("MARKET_SELLER_MIN_ACCOUNT_DAYS", "0");
  vi.stubEnv("MARKET_SELLER_MIN_RACES", "0");
  h = await dbHandle();
  owner = await founded("Claim Owner");
  buyer = await founded("Claim Buyer");
  const genome = gc.generateFoundationGenome(gc.seedFrom("web-claiming", 1), { season: 1 });
  horseId = await insertHorse(h.db, { stableId: owner.stableId, spec: { ...specFromGenome({ genome, name: "Claimable", sex: "colt", careSessions: 19, season: 1 }), rating: 0 }, origin: "admin", now: new Date() });
  const now = Date.now();
  const race = await createRace(h.db, {
    kind: "scheduled",
    name: "Bellmont Claiming Stakes (0-55)",
    raceClass: "handicap",
    conditions: { claiming: true, minRating: 0, maxRating: 55, distanceM: 1400, surface: "turf", going: "good", track: "Bellmont" },
    postTime: new Date(now + 2 * 3_600_000),
    entriesCloseAt: new Date(now + 2 * 3_600_000 - 30_000),
    purse: 1_500,
    targetRunners: 6,
  });
  raceId = race.id;
});
afterAll(() => {
  jar.token = null;
  vi.unstubAllEnvs();
});

describe("claiming races on the web", () => {
  it("the entry sheet gives the claim band; entering needs a price inside it", async () => {
    const session = { accountId: owner.accountId, stable: await stableOf(h.db, owner.accountId) } as unknown as Session;
    const sheet = await entryOptions(h.db, session, raceId, new Date());
    expect(sheet.race.claiming).toBe(true);
    const opt = sheet.options.find((o) => o.horseId === horseId)!;
    expect(opt.claim).toEqual({ appraisal: opt.claim!.appraisal, ...gc.claimPriceBounds(opt.claim!.appraisal) });
    jar.token = owner.token;
    const plan = { tactic: "stalker", intensity: "normal" };
    expect((await call(ENTER, "enter", { horseId, plan })).status).toBe(400);
    expect((await call(ENTER, "enter", { horseId, plan, claimPrice: opt.claim!.max + 1 })).status).toBe(400);
    const ok = await call(ENTER, "enter", { horseId, plan, claimPrice: opt.claim!.appraisal });
    expect(ok.status).toBe(201);
  });

  it("another stable claims; the card shows the price and the count (never who)", async () => {
    jar.token = owner.token;
    expect((await call(CLAIM, "claim", { horseId })).status).toBeGreaterThanOrEqual(400); // own horse
    jar.token = buyer.token;
    const res = await call(CLAIM, "claim", { horseId });
    expect(res.status).toBe(201);
    const { claim } = (await res.json()) as { claim: { price: number; status: string } };
    expect(claim.status).toBe("lodged");
    expect(await getBalance(h.db, buyer.accountId)).toBe(60_000 - claim.price);

    const asOwner = await raceCard(h.db, raceId, new Date(), owner.stableId);
    const runner = asOwner.field.find((e) => e.horse.id === horseId)!;
    expect(runner.claim).toEqual({ price: claim.price, claims: 1 });
    expect(asOwner.claiming?.rules).toMatch(/whatever the result/);
    expect(asOwner.claiming?.myClaim).toBeNull();
    expect(JSON.stringify(asOwner)).not.toContain(buyer.stableId);
    const asBuyer = await raceCard(h.db, raceId, new Date(), buyer.stableId);
    expect(asBuyer.claiming?.myClaim).toMatchObject({ horseId, price: claim.price, status: "lodged" });
  });
});
