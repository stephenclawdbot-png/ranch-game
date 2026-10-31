/**
 * Picks and rival invites on the web side: the Pick endpoint takes a pick until the off and
 * never shows an outcome before the race's broadcast is over (no spoilers); founding through a
 * rival link makes the two stables rivals and pays both welcomes, unless the browser is shared.
 * Uses the shared PGlite singleton at real time.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import * as gc from "@thoroughbred/game-core";
import { GET as PICK_GET, POST as PICK_POST } from "../../app/api/races/[id]/pick/route";
import { GET as TIPSTERS } from "../../app/api/tipsters/route";
import { createAccount, createRace, declaredRivalsOf, enterRace, ensureReferralCode, getBalance, getRaceForSimulation, insertHorse, recordAccountSignal, settleRace, specFromGenome, stableOf, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { foundStable } from "./founding";

let h: DbHandle;
const silks = { pattern: "hoops", primary: "#2c5f2d", secondary: "#f3e7c9", cap: "#263238" } as const;
type Who = { token: string; accountId: string; stableId: string; horseId: string };

async function founded(name: string, horse: string): Promise<Who> {
  const acc = await createAccount(h.db, { stableName: name, silks, startingCredits: 20_000, timezone: "Europe/London", now: new Date(Date.now() - 30 * 86_400_000) });
  const stableId = (await stableOf(h.db, acc.accountId)).id;
  const genome = gc.generateFoundationGenome(gc.seedFrom("web-picks", name), { season: 1 });
  const horseId = await insertHorse(h.db, { stableId, spec: { ...specFromGenome({ genome, name: horse, sex: "colt", careSessions: 19, season: 1 }), rating: 0 }, origin: "admin", now: new Date(Date.now() - 30 * 86_400_000) });
  return { token: acc.token, accountId: acc.accountId, stableId, horseId };
}

let a: Who;
let b: Who;
let tipster: Who;
beforeAll(async () => {
  h = await dbHandle();
  a = await founded("Pick Home", "Picked Star");
  b = await founded("Pick Away", "Other Star");
  tipster = await founded("Sharp Eye", "Spare Star");
});
afterAll(() => {
  jar.token = null;
});

const call = async (method: "GET" | "POST", raceId: string, body?: unknown) => {
  const req = new Request(`https://tb.example/api/races/${raceId}/pick`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const res = await (method === "GET" ? PICK_GET : PICK_POST)(req, { params: Promise.resolve({ id: raceId }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("picks on the web", () => {
  it("takes a pick before the off and reveals nothing until the broadcast is over", async () => {
    // a Feature that goes off in 90 s, both stables entered
    const post = new Date(Date.now() + 90_000);
    const race = await createRace(h.db, { kind: "feature", name: "Pick Feature", raceClass: "listed", conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" }, postTime: post, entriesCloseAt: new Date(post.getTime() - 30_000), targetRunners: 2 });
    const enteredAt = new Date();
    await enterRace(h.db, { accountId: a.accountId, horseId: a.horseId, raceId: race.id, tactic: "stalker", now: enteredAt, goalNow: enteredAt });
    await enterRace(h.db, { accountId: b.accountId, horseId: b.horseId, raceId: race.id, tactic: "stalker", now: enteredAt, goalNow: enteredAt });
    jar.token = tipster.token;
    const picked = await call("POST", race.id, { horseId: b.horseId });
    expect(picked.status).toBe(200);
    expect(picked.body).toMatchObject({ open: true, picks: 1, mine: { horseId: b.horseId, outcome: "open" } });
    expect((await call("POST", race.id, { horseId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
    expect((await call("GET", "not-a-race")).status).toBe(404);

    // a second race that went off 10 s ago and is settled: its broadcast is still running
    const off = new Date(Date.now() - 10_000);
    const ran = await createRace(h.db, { kind: "scheduled", name: "Pick Maiden", raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf", track: "Saltmarsh" }, postTime: off, entriesCloseAt: new Date(off.getTime() - 30_000), targetRunners: 2 });
    const before = new Date(off.getTime() - 60_000);
    const ha = await insertHorse(h.db, { stableId: a.stableId, spec: { ...specFromGenome({ genome: gc.generateFoundationGenome(gc.seedFrom("web-picks", "x1"), { season: 1 }), name: "Quick Star", sex: "colt", careSessions: 19, season: 1 }), rating: 0 }, origin: "admin", now: before });
    const hb = await insertHorse(h.db, { stableId: b.stableId, spec: { ...specFromGenome({ genome: gc.generateFoundationGenome(gc.seedFrom("web-picks", "x2"), { season: 1 }), name: "Slow Star", sex: "colt", careSessions: 19, season: 1 }), rating: 0 }, origin: "admin", now: before });
    await enterRace(h.db, { accountId: a.accountId, horseId: ha, raceId: ran.id, tactic: "stalker", now: before, goalNow: before });
    await enterRace(h.db, { accountId: b.accountId, horseId: hb, raceId: ran.id, tactic: "stalker", now: before, goalNow: before });
    const { makePick } = await import("@thoroughbred/db");
    await makePick(h.db, { accountId: tipster.accountId, raceId: ran.id, horseId: ha, now: before });
    const now = new Date();
    await getRaceForSimulation(h.db, ran.id, now);
    const finishOrder = [
      { horseId: ha, position: 1, finishTimeUs: 69_900_000, marginMm: 0, marginLabel: "", prize: 0 },
      { horseId: hb, position: 2, finishTimeUs: 70_000_000, marginMm: 900, marginLabel: "1/2", prize: 0 },
    ];
    await settleRace(h.db, { raceId: ran.id, now, resultHash: "0".repeat(64), result: { finishOrder, winningTimeUs: 69_900_000, photoFinish: false, resultHash: "0".repeat(64) }, runners: [{ horseId: ha, position: 1 }, { horseId: hb, position: 2 }] });

    const view = await call("GET", ran.id);
    expect(view.body).toMatchObject({ open: false, mine: { horseId: ha, outcome: "open", points: 0 } });
    expect(JSON.stringify(view.body)).not.toMatch(/"won"|"lost"|finish|position/);
    expect((await call("POST", ran.id, { horseId: hb })).status).toBe(409);
    const table = (await (await TIPSTERS()).json()) as { week: { stableId: string }[] };
    expect(table.week.some((r) => r.stableId === tipster.stableId)).toBe(false);
  });
});

describe("bring a rival on the web", () => {
  it("founding through a rival link makes rivals both ways; the same browser gets no welcome", async () => {
    const inviter = await founded("Challenger", "Challenge Star");
    const code = await ensureReferralCode(h.db, inviter.accountId);
    const before = await getBalance(h.db, inviter.accountId);
    const friend = await foundStable(h.db, { stableName: "Taken Up", silks, inviteCode: code, rival: true, deviceId: "browser-friend-1", now: new Date() });
    expect(friend.rival).toMatchObject({ ok: true, welcome: "granted" });
    expect(await getBalance(h.db, inviter.accountId)).toBe(before + gc.RIVAL_INVITE_CREDITS);
    expect(await declaredRivalsOf(h.db, inviter.stableId)).toMatchObject([{ stableId: friend.stableId, direction: "invited" }]);
    expect(await declaredRivalsOf(h.db, friend.stableId)).toMatchObject([{ stableId: inviter.stableId, direction: "invited_by" }]);

    // the inviter's own browser founds a second stable through the link: rivals, no welcome
    await recordAccountSignal(h.db, { accountId: inviter.accountId, kind: "device", value: "browser-inviter" });
    const alt = await foundStable(h.db, { stableName: "Same Browser", silks, inviteCode: code, rival: true, deviceId: "browser-inviter", now: new Date() });
    expect(alt.rival).toMatchObject({ ok: true, welcome: "refused", reason: "linked_accounts" });
    expect(await getBalance(h.db, inviter.accountId)).toBe(before + gc.RIVAL_INVITE_CREDITS);
  });
});
