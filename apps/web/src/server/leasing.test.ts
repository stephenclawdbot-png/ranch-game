/**
 * Sales > Lease, web side: the lease view (board, eligibility, offers, leases), the stable view's
 * lease chip and "away on lease" list, the horse page's owner / lessee split, the horse tabs for
 * the lessee, and the /api/leases routes (auth, offer, take, return, rate).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import * as gc from "@thoroughbred/game-core";
import { createAccount, createRace, stableOf, type DbHandle } from "@thoroughbred/db";
import { GET } from "../../app/api/leases/route";
import { POST as OFFER } from "../../app/api/leases/offer/route";
import { POST as TAKE } from "../../app/api/leases/offers/[id]/take/route";
import { POST as RETURN } from "../../app/api/leases/[id]/return/route";
import { POST as RATE } from "../../app/api/leases/[id]/rate/route";
import type { LeaseView } from "@/lib/economyTypes";
import { dbHandle } from "./db";
import { horseDetail, playerView } from "./game";
import { horseLifeView } from "./horseLife";
import { leaseView } from "./leasing";
import type { Session } from "./session";

let h: DbHandle;
const silks = { pattern: "hoops", primary: "#8e2323", secondary: "#f3e7c9", cap: "#263238" } as const;
type P = Session & { token: string };
let owner: P;
let lessee: P;
let horseId: string;

async function founded(name: string): Promise<P> {
  const acc = await createAccount(h.db, { stableName: name, silks, startingCredits: 5_000, starterHorses: 3, timezone: "Europe/London", now: new Date() });
  return { token: acc.token, accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
}

/** 8 days old with the Live starts a lessee needs. */
async function establish(p: P) {
  const now = Date.now();
  await h.db.execute(`update accounts set created_at = now() - interval '8 days' where id = '${p.accountId}'`);
  const house = await firstHorseOf(p);
  for (let i = 0; i < gc.LESSEE_MIN_LIVE_STARTS; i++) {
    const race = await createRace(h.db, {
      kind: "scheduled",
      name: `Lease history ${i}`,
      raceClass: "maiden",
      conditions: {},
      postTime: new Date(now - (i + 2) * 86_400_000),
      entriesCloseAt: new Date(now - (i + 2) * 86_400_000 - 60_000),
    });
    await h.db.execute(`update races set status = 'settled' where id = '${race.id}'`);
    await h.db.execute(`insert into race_entries (race_id, horse_id, stable_id, gate, tactic, snapshot, rating_before) values ('${race.id}', '${house}', '${p.stable.id}', 1, 'stalker', '{}', 0)`);
  }
}

async function firstHorseOf(p: P): Promise<string> {
  const res = await h.db.execute(`select id from horses where owner_stable_id = '${p.stable.id}' order by created_at, id limit 1`);
  const rows = (Array.isArray(res) ? res : (res as { rows: { id: string }[] }).rows) as { id: string }[];
  return rows[0]!.id;
}

const post = (fn: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, body?: unknown) =>
  fn(new Request(`https://tb.example/api/leases/x`, { method: "POST", body: JSON.stringify(body ?? {}), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  h = await dbHandle();
  owner = await founded("Lease Owner Yard");
  lessee = await founded("Borrowing Barn");
  // starters are Club-bred: they may be leased (never sold)
  horseId = await firstHorseOf(owner);
});
afterAll(() => {
  jar.token = null;
});

describe("/api/leases", () => {
  it("needs a stable", async () => {
    jar.token = null;
    expect((await GET()).status).toBe(401);
  });

  it("an owner offers a horse; the view shows the offer, caps and config", async () => {
    jar.token = owner.token;
    const before = (await (await GET()).json()) as LeaseView;
    expect(before.config).toMatchObject({ terms: [7, 14, 28], shareMin: 30, shareMax: 80, feeMax: 0, maxLesseeLeases: 2, cooldownDays: 7 });
    const mine = before.horses.find((x) => x.id === horseId)!;
    expect(mine.block).toBeNull();
    expect(before.horses.every((x) => x.block === null)).toBe(true); // Club-bred starters can be leased
    const res = await OFFER(new Request("https://tb.example/api/leases/offer", { method: "POST", body: JSON.stringify({ horseId, termDays: 14, ownerSharePct: 60, maxLiveStartsPerWeek: 3 }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(201);
    const v = ((await res.json()) as { view: LeaseView }).view;
    expect(v.offers).toEqual([expect.objectContaining({ horseId, termDays: 14, ownerSharePct: 60, lesseeSharePct: 40, maxLiveStartsPerWeek: 3, allowAllOut: false })]);
    expect(v.board.find((b) => b.id === horseId)).toMatchObject({ mine: true, newOwner: true, takeBlock: "Your own horse" });
    const bad = await OFFER(new Request("https://tb.example/api/leases/offer", { method: "POST", body: JSON.stringify({ horseId, termDays: 14, ownerSharePct: 50 }), headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(409); // already on offer
    const term = await OFFER(new Request("https://tb.example/api/leases/offer", { method: "POST", body: JSON.stringify({ horseId, termDays: 30, ownerSharePct: 50 }), headers: { "content-type": "application/json" } }));
    expect(term.status).toBe(400); // 7, 14 or 28 days only
  });

  it("a fresh stable sees why it can't take; an established one takes it", async () => {
    jar.token = lessee.token;
    const v = (await (await GET()).json()) as LeaseView;
    const lot = v.board.find((b) => b.id === horseId)!;
    expect(v.me.eligible).toBe(false);
    expect(lot.takeBlock).toMatch(/Live starts/);
    expect((await post(TAKE, lot.listingId)).status).toBe(409);
    await establish(lessee);
    const ok = await post(TAKE, lot.listingId);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { lease: { leaseId: string; duplicate: boolean }; view: LeaseView };
    expect(body.lease.duplicate).toBe(false);
    expect(body.view.leases).toEqual([expect.objectContaining({ role: "lessee", otherStableName: "Lease Owner Yard", ownerSharePct: 60, status: "active", startCondition: "fresh" })]);
    expect((await post(TAKE, lot.listingId)).status).toBe(200); // idempotent
  });

  it("stable views: a chip for the lessee, 'away on lease' for the owner", async () => {
    const lv = await playerView(h.db, lessee, new Date());
    const held = lv.horses.find((x) => x.id === horseId)!;
    expect(held.lease).toMatchObject({ fromStable: "Lease Owner Yard", sharePct: 40, maxLiveStartsPerWeek: 3 });
    const ov = await playerView(h.db, owner, new Date());
    expect(ov.horses.some((x) => x.id === horseId)).toBe(false);
    expect(ov.leasedOut).toEqual([expect.objectContaining({ id: horseId, toStable: "Borrowing Barn", ownerSharePct: 60, earned: 0 })]);
    expect(ov.stalls.used).toBe(2);
    expect(lv.horses.length).toBe(lv.stalls.used); // the leased horse takes one of the lessee's stalls
  });

  it("horse page: the lessee keeps it (races, cares), the owner owns it; owner acts are off", async () => {
    const asLessee = (await horseDetail(h.db, horseId, lessee, new Date()))!;
    expect(asLessee).toMatchObject({ mine: true, owned: false, actions: null });
    expect(asLessee.lease).toMatchObject({ role: "lessee", ownerStableName: "Lease Owner Yard", ownerSharePct: 60 });
    expect(asLessee.status).not.toBeNull();
    const asOwner = (await horseDetail(h.db, horseId, owner, new Date()))!;
    expect(asOwner).toMatchObject({ mine: false, owned: true, status: null, actions: null });
    expect(asOwner.lease).toMatchObject({ role: "owner", lesseeStableName: "Borrowing Barn" });
    const tabs = await horseLifeView(h.db, lessee, horseId, new Date());
    expect(tabs?.career).toMatchObject({ canRetire: false, canRename: false, canRelease: false, canLegacy: false });
    expect(await horseLifeView(h.db, owner, horseId, new Date())).toBeNull();
  });

  it("the lessee hands it back; the owner rates them once; the record shows it", async () => {
    jar.token = owner.token;
    const ov = (await (await GET()).json()) as LeaseView;
    const lease = ov.leases.find((l) => l.role === "owner")!;
    expect((await post(RETURN, lease.leaseId)).status).toBe(403); // owners can't recall
    jar.token = lessee.token;
    const back = await post(RETURN, lease.leaseId);
    expect(back.status).toBe(200);
    expect(((await back.json()) as { result: { ended: boolean } }).result.ended).toBe(true);
    jar.token = owner.token;
    const rated = await post(RATE, lease.leaseId, { stars: 5 });
    expect(rated.status).toBe(200);
    const after = ((await rated.json()) as { view: LeaseView }).view;
    expect(after.leases.find((l) => l.leaseId === lease.leaseId)).toMatchObject({ status: "ended", endReason: "returned", ownerRating: 5, canRate: false, lesseeRecord: expect.objectContaining({ leases: 1, starsTenths: 50 }) });
    // the cooldown shows on the owner's list
    expect(after.horses.find((x) => x.id === horseId)?.block).toMatch(/Back from a lease/);
    const lv = await leaseView(h.db, lessee, new Date());
    expect(lv.me.record).toMatchObject({ leases: 1, ratings: 1, starsTenths: 50 });
  });
});
