/**
 * Sponsor a race, web side: /api/races/sponsor (the list for a local day, the purchase, its
 * idempotency and refusals), the sponsor on the race list and the racecard header, and the
 * Trophy Room plaque wording. Uses the shared PGlite singleton, like the route, at real time.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { GET, POST } from "../../app/api/races/sponsor/route";
import { SPONSORSHIP, createAccount, defaultCardSlot, getBalance, isCalendarSlot, sponsorshipPrice, stableOf, type DbHandle } from "@thoroughbred/db";
import type { SponsorView } from "@/lib/sponsorTypes";
import { dbHandle } from "./db";
import { sponsorPlaque } from "./competition";
import { raceCard, raceList } from "./game";

let h: DbHandle;
const silks = { pattern: "hoops", primary: "#8e2323", secondary: "#f3e7c9", cap: "#263238" } as const;
let a: { token: string; accountId: string; stableId: string };
let b: { token: string; accountId: string; stableId: string };

async function founded(name: string) {
  const acc = await createAccount(h.db, { stableName: name, silks, startingCredits: 60_000, timezone: "Europe/London", now: new Date() });
  return { token: acc.token, accountId: acc.accountId, stableId: (await stableOf(h.db, acc.accountId)).id };
}

const get = (q = "") => GET(new Request(`https://tb.example/api/races/sponsor${q}`));
const post = (body: unknown) => POST(new Request("https://tb.example/api/races/sponsor", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeAll(async () => {
  h = await dbHandle();
  a = await founded("Glenmorrow House");
  b = await founded("Copper Gate");
});
afterAll(async () => {
  jar.token = null;
});

describe("/api/races/sponsor", () => {
  it("needs a stable", async () => {
    jar.token = null;
    expect((await get()).status).toBe(401);
    expect((await post({ slot: 1, key: "abcdefgh" })).status).toBe(401);
  });

  it("lists a local day of ordinary races with prices; calendar races are not for sale", async () => {
    jar.token = a.token;
    const res = await get();
    expect(res.status).toBe(200);
    const v = (await res.json()) as SponsorView;
    expect(v.days.length).toBeGreaterThanOrEqual(7);
    expect(v.days.length).toBeLessThanOrEqual(9);
    expect(v.date).toBe(v.days.find((d) => d.onSale > 0)!.date);
    expect(v.rules).toMatchObject({ purseMultiple: SPONSORSHIP.purseMultiple, minPrice: SPONSORSHIP.minPrice, windowDays: 7, maxUpcoming: SPONSORSHIP.maxUpcomingPerStable, upcoming: 0 });
    expect(v.slots.length).toBeGreaterThan(0);
    for (const s of v.slots) {
      expect(isCalendarSlot(s.slot)).toBe(false);
      expect(s.price).toBe(sponsorshipPrice(s.purse));
      expect(s.purse).toBe(defaultCardSlot(s.slot).purse);
      expect(s.sponsoredName).toMatch(/^The Glenmorrow House /);
    }
    // another day by its date; an unknown date falls back to the first
    const other = v.days[3]!.date;
    const v3 = (await (await get(`?date=${other}`)).json()) as SponsorView;
    expect(v3.date).toBe(other);
    expect(v3.slots.every((s) => s.postTimeMs > v.slots[0]!.postTimeMs)).toBe(true);
    expect(((await (await get("?date=nonsense")).json()) as SponsorView).date).toBe(v.date);
  });

  it("buys a published race once per key, renames it, and shows the sponsor on the card", async () => {
    jar.token = a.token;
    const v = (await (await get()).json()) as SponsorView;
    const slot = v.slots.find((s) => s.published && s.block === null)!;
    expect(slot).toBeDefined();
    const before = await getBalance(h.db, a.accountId);
    const key = "sponsor-web-key-1";
    const res = await post({ slot: slot.slot, key });
    expect(res.status).toBe(201);
    const out = (await res.json()) as { result: { raceId: string; raceName: string; price: number; duplicate: boolean }; view: SponsorView };
    expect(out.result).toMatchObject({ raceId: slot.raceId, raceName: slot.sponsoredName, price: slot.price, duplicate: false });
    expect(out.view.mine[0]).toMatchObject({ raceId: slot.raceId, raceName: slot.sponsoredName, status: "upcoming" });
    expect(out.view.rules.upcoming).toBe(1);
    // retry with the same key: no second charge
    const again = (await (await post({ slot: slot.slot, key })).json()) as typeof out;
    expect(again.result.duplicate).toBe(true);
    expect(await getBalance(h.db, a.accountId)).toBe(before - slot.price);

    // the race list highlights it; the racecard header carries the sponsor's silks
    const { upcoming } = await raceList(h.db, new Date(), a.stableId, { upcoming: 64 });
    const row = upcoming.find((r) => r.id === slot.raceId)!;
    expect(row.name).toBe(slot.sponsoredName);
    expect(row.sponsor).toMatchObject({ stableName: "Glenmorrow House", mine: true, silks: { pattern: "hoops", primary: "#8e2323" } });
    const card = await raceCard(h.db, slot.raceId!, new Date(), b.stableId);
    expect(card.config.name).toBe(slot.sponsoredName);
    expect(card.sponsor).toMatchObject({ stableName: "Glenmorrow House", mine: false });

    // another stable can't take the same race
    jar.token = b.token;
    const taken = await post({ slot: slot.slot, key: "sponsor-web-key-2" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: "ALREADY_SPONSORED" });
    const bView = (await (await get(`?date=${v.date}`)).json()) as SponsorView;
    expect(bView.slots.find((s) => s.slot === slot.slot)).toMatchObject({ block: "sponsored", sponsoredBy: "Glenmorrow House", mine: false, sponsoredName: slot.sponsoredName });
  });

  it("refuses bad bodies, calendar races and slots out of the window", async () => {
    jar.token = b.token;
    expect((await post({ slot: "x", key: "abcdefgh" })).status).toBe(400);
    expect((await post({ slot: 5, key: "no" })).status).toBe(400);
    const v = (await (await get()).json()) as SponsorView;
    let calendar = v.slots[0]!.slot;
    while (!isCalendarSlot(calendar)) calendar++;
    const res = await post({ slot: calendar, key: "sponsor-web-key-3" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "NOT_ELIGIBLE" });
    const far = await post({ slot: v.slots[0]!.slot + 2_000, key: "sponsor-web-key-4" });
    expect(await far.json()).toMatchObject({ error: "NOT_ELIGIBLE" });
  });
});

describe("Trophy Room plaque", () => {
  it("reads 'Sponsored the …'", () => {
    expect(sponsorPlaque("The Glenmorrow House Handicap (0-55)")).toBe("Sponsored the Glenmorrow House Handicap (0-55)");
  });
});
