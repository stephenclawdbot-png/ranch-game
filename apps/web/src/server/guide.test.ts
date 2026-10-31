/**
 * The beginner welcome in the web app (server/guide.ts): new stables are guided, existing ones
 * keep everything; the player view carries the guide; coach marks show once; the Why step only
 * counts for a watched race of your own; locked features are refused at the routes' guard;
 * welcome back never spoils an unwatched result.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as gc from "@thoroughbred/game-core";
import { authenticate, createAccount, createDb, createRace, enterRace, getBalance, markInboxRead, rowsOf, type DbHandle } from "@thoroughbred/db";
import { foundStable } from "./founding";
import { onboardingAction, onboardingView, requireUnlocked, welcomeBackView } from "./guide";
import type { Session } from "./session";

let h: DbHandle;
const T0 = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));
const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };
const MIN = 60_000;

beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

let n = 0;
const q = async <T,>(text: string): Promise<T[]> => rowsOf<T>(await h.db.execute(text));
async function founded(now = T0): Promise<Session> {
  const acc = await foundStable(h.db, { stableName: `Guide Yard ${++n}`, silks: SILKS, inviteCode: null, now });
  return (await authenticate(h.db, acc.token))!;
}
async function existing(): Promise<Session> {
  const acc = await createAccount(h.db, { stableName: `Old Yard ${++n}`, silks: SILKS, now: T0 });
  return (await authenticate(h.db, acc.token))!;
}

describe("onboarding view", () => {
  it("a stable founded now is guided: mentor to meet, the guide at step one, nothing extra unlocked", async () => {
    const s = await founded();
    const o = (await onboardingView(h.db, s, T0))!;
    expect(o.guided).toBe(true);
    expect(o.mentorDone).toBe(false);
    expect(o.plainLanguage).toBe(false);
    expect(o.steps).toMatchObject({ done: 0, next: "care", complete: false });
    expect(o.steps!.totalCredits).toBe(gc.stableStepsTotal({}));
    expect(Object.values(o.unlocks).some(Boolean)).toBe(false);
    expect(o.welcomeBack).toBeNull();
  });

  it("an existing stable keeps everything: no guide, no coach marks, every feature open", async () => {
    const s = await existing();
    const o = (await onboardingView(h.db, s, T0))!;
    expect(o.guided).toBe(false);
    expect(o.mentorDone).toBe(true);
    expect(o.steps).toBeNull();
    expect(o.coachSeen).toContain("*");
    expect(Object.values(o.unlocks).every(Boolean)).toBe(true);
    for (const f of gc.UNLOCK_FEATURES) await expect(requireUnlocked(h.db, s, f, T0)).resolves.toBeUndefined();
  });

  it("wallet players see the USDG features (tote, market) from the start", async () => {
    const s = await founded();
    await h.db.execute(`update accounts set wallet_address = '0x${"ab".repeat(19)}${String(n).padStart(2, "0")}' where id = '${s.accountId}'`);
    const o = (await onboardingView(h.db, s, T0))!;
    expect(o.unlocks).toMatchObject({ tote: true, market: true, leasing: true, claiming: false, jockey_contracts: false });
  });

  it("the mentor's answer and coach marks are stored once per account", async () => {
    const s = await founded();
    await onboardingAction(h.db, s, { action: "mentor", plainLanguage: true }, T0);
    await onboardingAction(h.db, s, { action: "coach", id: "racecard" }, T0);
    await onboardingAction(h.db, s, { action: "coach", id: "racecard" }, T0);
    const o = (await onboardingView(h.db, s, T0))!;
    expect(o.mentorDone).toBe(true);
    expect(o.plainLanguage).toBe(true);
    expect(o.coachSeen).toEqual(["racecard"]);
    await expect(onboardingAction(h.db, s, { action: "coach", id: "nope" }, T0)).rejects.toThrow();
    await onboardingAction(h.db, s, { action: "plain", on: false }, T0);
    expect((await onboardingView(h.db, s, T0))!.plainLanguage).toBe(false);
  });
});

/** A settled Live race the stable ran in, with its result note unread. */
async function ranLive(s: Session, position: number, at: Date) {
  const [horse] = await q<{ id: string }>(`select id from horses where owner_stable_id = '${s.stable.id}' order by id limit 1`);
  const race = await createRace(h.db, { kind: "scheduled", name: `Live ${++n}`, raceClass: "maiden", conditions: { distanceM: 1200, surface: "turf" }, postTime: new Date(at.getTime() + 30 * MIN), entriesCloseAt: new Date(at.getTime() + 20 * MIN), targetRunners: 8 });
  await enterRace(h.db, { accountId: s.accountId, raceId: race.id, horseId: horse!.id, tactic: "front", now: at });
  await h.db.execute(`update races set status = 'settled' where id = '${race.id}'`);
  await h.db.execute(`update race_entries set finish_position = ${position} where race_id = '${race.id}'`);
  await h.db.execute(`update horses set lock_kind = null, lock_ref = null where id = '${horse!.id}'`);
  await h.db.execute(
    `insert into inbox_items (account_id, kind, dedupe_key, title, race_id, horse_id, created_at) values ('${s.accountId}', 'race_result', 'race:${race.id}:${horse!.id}', 'Finished ${position}', '${race.id}', '${horse!.id}', '${at.toISOString()}')`,
  );
  return race.id;
}

describe("Stable steps from real events", () => {
  it("the Why step counts only for your own race, once watched, and pays once", async () => {
    const s = await founded();
    const other = await founded();
    const raceId = await ranLive(s, 2, T0);
    const before = await getBalance(h.db, s.accountId);
    expect((await onboardingAction(h.db, s, { action: "why", raceId }, T0)).step).toBe(false); // not watched yet
    expect((await onboardingAction(h.db, other, { action: "why", raceId }, T0)).step).toBe(false); // not their race
    await markInboxRead(h.db, { accountId: s.accountId, raceId, now: T0 });
    expect((await onboardingAction(h.db, s, { action: "why", raceId }, T0)).step).toBe(true);
    expect((await onboardingAction(h.db, s, { action: "why", raceId }, T0)).step).toBe(false);
    const credit = gc.STABLE_STEPS.find((x) => x.key === "read_why")!.credits;
    expect(await getBalance(h.db, s.accountId)).toBe(before + credit);
  });

  it("entering a Live race completes its step; watching it opens the tote with an Unlocked moment", async () => {
    const s = await founded();
    const raceId = await ranLive(s, 3, T0);
    let o = (await onboardingView(h.db, s, T0))!;
    expect(o.steps!.steps.find((x) => x.key === "enter_live")!.done).toBe(true);
    expect(o.unlocks.tote).toBe(false);
    await expect(requireUnlocked(h.db, s, "tote", T0)).rejects.toThrow(/watched/);
    await markInboxRead(h.db, { accountId: s.accountId, raceId, now: T0 });
    o = (await onboardingView(h.db, s, T0))!;
    expect(o.unlocks.tote).toBe(true);
    await expect(requireUnlocked(h.db, s, "tote", T0)).resolves.toBeUndefined();
    const moments = await q<{ dedupe_key: string }>(`select dedupe_key from inbox_items where account_id = '${s.accountId}'`);
    expect(moments.filter((m) => m.dedupe_key === "moment:unlock:tote")).toHaveLength(1);
  });
});

describe("welcome back", () => {
  it("after a day away: how many ran, nothing about an unwatched result, what's due and one next step", async () => {
    const s = await founded();
    await onboardingView(h.db, s, T0);
    const away = new Date(T0.getTime() + 26 * 3_600_000);
    await ranLive(s, 1, new Date(T0.getTime() + 2 * 3_600_000));
    const o = (await onboardingView(h.db, s, away))!;
    const w = o.welcomeBack!;
    expect(w).not.toBeNull();
    expect(w.ran).toBe(1);
    expect(w.unseen).toBe(1);
    expect(w.wins).toBe(0); // the win stays hidden until it's watched
    expect(JSON.stringify(w)).not.toMatch(/won|Finished 1/i);
    expect(w.next.label).toBe("Watch the finish");
    expect(w.due.some((d) => /result/.test(d.label))).toBe(true);
    // Watched: now the win shows.
    const [item] = await q<{ race_id: string }>(`select race_id from inbox_items where account_id = '${s.accountId}' and kind = 'race_result'`);
    await markInboxRead(h.db, { accountId: s.accountId, raceId: item!.race_id, now: away });
    const again = await welcomeBackView(h.db, s, { fromMs: T0.getTime(), atMs: away.getTime() }, away);
    expect(again.wins).toBe(1);
    expect(again.unseen).toBe(0);
    // Dismissed: gone.
    await onboardingAction(h.db, s, { action: "welcome_back" }, away);
    expect((await onboardingView(h.db, s, new Date(away.getTime() + MIN)))!.welcomeBack).toBeNull();
  });

  it("no card for a short absence", async () => {
    const s = await founded();
    await onboardingView(h.db, s, T0);
    expect((await onboardingView(h.db, s, new Date(T0.getTime() + 5 * 3_600_000)))!.welcomeBack).toBeNull();
  });
});
