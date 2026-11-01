/**
 * The notification API (/api/notifications, /count, /read, /prefs): every route needs a stable
 * (401 without), a player only ever sees and marks their own, the category switches filter the
 * bell and its count but not the full inbox, and the count is cached privately only. Plus the
 * client helpers (badge text, day groups). Uses the shared PGlite singleton, like the routes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { GET as LIST } from "../../app/api/notifications/route";
import { GET as COUNT } from "../../app/api/notifications/count/route";
import { POST as READ } from "../../app/api/notifications/read/route";
import { GET as PREFS, PUT as SET_PREFS } from "../../app/api/notifications/prefs/route";
import { createAccount, notify, resetDbSingleton, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";
import { badgeText, bellLabel, groupByDay } from "@/lib/notifications";
import type { NotificationPrefsView, NotificationsView } from "@/lib/types";

let h: DbHandle;
const silks = { pattern: "hoops" as const, primary: "#112233", secondary: "#445566", cap: "#778899" };
let me: { accountId: string; token: string };
let other: { accountId: string; token: string };
let otherItem: string;

const req = (url: string, init?: RequestInit) => new Request(`https://tb.example${url}`, init);
const body = (b: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const as = (who: { token: string } | null) => {
  jar.token = who?.token ?? null;
};

beforeAll(async () => {
  h = await dbHandle();
  const now = new Date();
  // No starting credits: a grant would add a credit note (its own test below).
  const a = await createAccount(h.db, { stableName: "Bell Lodge", silks, now, startingCredits: 0 });
  const b = await createAccount(h.db, { stableName: "Quiet Acres", silks, now, startingCredits: 0 });
  me = { accountId: a.accountId, token: a.token };
  other = { accountId: b.accountId, token: b.token };
  const t = (min: number) => new Date(now.getTime() - min * 60_000);
  await notify(h.db, { accountId: me.accountId, kind: "upkeep", dedupeKey: "upkeep:api", title: "Weekly upkeep: 40 cr for 2 horses", now: t(3) });
  await notify(h.db, { accountId: me.accountId, kind: "back_in_race", dedupeKey: "back:api", title: "Sea Lavender is over the sore shin and can race again", now: t(2) });
  await notify(h.db, { accountId: me.accountId, kind: "listing_expired", dedupeKey: "listing-expired:api", title: "Paper Moon's listing expired unsold", data: { href: "/market" }, now: t(1) });
  otherItem = (await notify(h.db, { accountId: other.accountId, kind: "jockey", dedupeKey: "jockey:api", title: "Not yours", now: t(1) }))!;
});

afterAll(async () => {
  await resetDbSingleton();
});

describe("notification API", () => {
  it("every route answers 401 without a stable", async () => {
    as(null);
    expect((await LIST(req("/api/notifications"))).status).toBe(401);
    expect((await COUNT()).status).toBe(401);
    expect((await READ(req("/api/notifications/read", body({})))).status).toBe(401);
    expect((await PREFS()).status).toBe(401);
    expect((await SET_PREFS(req("/api/notifications/prefs", { ...body({ enabled: { market: false } }), method: "PUT" }))).status).toBe(401);
  });

  it("lists only the player's own, newest first, with links; the count is private and short-lived", async () => {
    as(me);
    const res = await LIST(req("/api/notifications"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const v = (await res.json()) as NotificationsView;
    expect(v.items.map((i) => i.kind)).toEqual(["listing_expired", "back_in_race", "upkeep"]);
    expect(v.items.map((i) => i.href)).toEqual(["/market", "/", "/stable/finances"]);
    expect(v.items.every((i) => i.unread && !i.muted)).toBe(true);
    expect(v.unread).toBe(3);
    const c = await COUNT();
    expect(c.headers.get("cache-control")).toBe("private, max-age=15");
    expect(await c.json()).toEqual({ unread: 3 });
  });

  it("switching a category off hides it from the bell and the count, not from the full inbox", async () => {
    as(me);
    const put = await SET_PREFS(req("/api/notifications/prefs", { ...body({ enabled: { market: false } }), method: "PUT" }));
    const prefs = (await put.json()) as NotificationPrefsView;
    expect(prefs.categories.find((c) => c.key === "market")!.enabled).toBe(false);
    expect(prefs.categories.filter((c) => c.enabled)).toHaveLength(prefs.categories.length - 1);
    expect(prefs.categories.find((c) => c.key === "credits")).toMatchObject({ label: "Credits", enabled: true });
    expect(((await (await PREFS()).json()) as NotificationPrefsView).categories.find((c) => c.key === "market")!.enabled).toBe(false);

    const bell = (await (await LIST(req("/api/notifications"))).json()) as NotificationsView;
    expect(bell.items.map((i) => i.kind)).toEqual(["back_in_race", "upkeep"]);
    expect(bell.unread).toBe(2);
    expect(await (await COUNT()).json()).toEqual({ unread: 2 });
    const all = (await (await LIST(req("/api/notifications?all=1"))).json()) as NotificationsView;
    expect(all.items.map((i) => [i.kind, i.muted])).toEqual([
      ["listing_expired", true],
      ["back_in_race", false],
      ["upkeep", false],
    ]);
    const health = (await (await LIST(req("/api/notifications?all=1&category=health"))).json()) as NotificationsView;
    expect(health.items.map((i) => i.kind)).toEqual(["back_in_race"]);
    // unknown keys are refused; a bad body is a 400
    expect((await SET_PREFS(req("/api/notifications/prefs", { ...body({ enabled: { spam: false } }), method: "PUT" }))).status).toBe(400);
    await SET_PREFS(req("/api/notifications/prefs", { ...body({ enabled: { market: true } }), method: "PUT" }));
    expect(await (await COUNT()).json()).toEqual({ unread: 3 });
  });

  it("mark read: one, then all; never another player's", async () => {
    as(me);
    const v = (await (await LIST(req("/api/notifications"))).json()) as NotificationsView;
    const one = await READ(req("/api/notifications/read", body({ ids: [v.items[0]!.id] })));
    expect(await one.json()).toEqual({ unread: 2 });
    // someone else's id changes nothing
    expect(await (await READ(req("/api/notifications/read", body({ ids: [otherItem] })))).json()).toEqual({ unread: 2 });
    expect((await READ(req("/api/notifications/read", body({ ids: ["not-a-uuid"] })))).status).toBe(400);
    expect(await (await READ(req("/api/notifications/read", body({})))).json()).toEqual({ unread: 0 });
    as(other);
    expect(await (await COUNT()).json()).toEqual({ unread: 1 });
  });
});

describe("credit notes in the bell", () => {
  it("a credit movement shows in the bell with the reason and the balance, once however often the bell is read", async () => {
    const c = await createAccount(h.db, { stableName: "Ledger Farm", silks, now: new Date(), startingCredits: 500 });
    as(c);
    const first = (await (await LIST(req("/api/notifications"))).json()) as NotificationsView;
    const notes = first.items.filter((i) => i.kind === "credits");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ category: "credits", title: "+500 credits: Starting credits · balance 500", href: "/stable/finances?highlight=story#cat-story" });
    // read again (and the count): still one note
    await COUNT();
    const again = (await (await LIST(req("/api/notifications"))).json()) as NotificationsView;
    expect(again.items.filter((i) => i.kind === "credits")).toHaveLength(1);
  });
});

describe("client helpers", () => {
  it("badge text caps at 9+, and the label says it in words", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(3)).toBe("3");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
    expect(bellLabel(0)).toBe("Notifications: nothing unread");
    expect(bellLabel(10)).toBe("Notifications: more than 9 unread");
  });

  it("groups by local day: Today, Yesterday, then dates", () => {
    const now = new Date(2026, 10, 4, 15, 0).getTime();
    const items = [new Date(2026, 10, 4, 9, 0), new Date(2026, 10, 4, 1, 0), new Date(2026, 10, 3, 22, 0), new Date(2026, 10, 1, 12, 0)].map((d) => ({ createdAtMs: d.getTime() }));
    const groups = groupByDay(items, now, "en-GB");
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      [new Date(2026, 10, 1).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), 1],
    ]);
  });
});
