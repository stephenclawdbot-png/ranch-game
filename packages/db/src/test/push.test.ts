/**
 * Phone / desktop alerts (services/push.ts): sent only when the keys are set and the category is
 * on (in the bell and on the device), quiet at night unless the race itself runs then, at most
 * PUSH_DAILY_CAP a day, never twice for one event, devices the push service reports gone are
 * dropped, and nothing in an alert spoils a race.
 */
import { createECDH, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { accounts, pushDeliveries, pushSubscriptions, races } from "../schema";
import { breed } from "../services/breeding";
import { createRace, enterRace } from "../services/races";
import { startRaceEarly } from "../services/startEarly";
import { SLOT_KEY_PREFIX } from "../services/card";
import { notify, onPushableNote, setNotificationPrefs, type InboxKind } from "../services/notifications";
import { noteFoalsDueTx, sweepNotifications } from "../services/notificationEvents";
import {
  PUSH_CATEGORIES,
  PUSH_DAILY_CAP,
  deliverPushes,
  isAllowedPushEndpoint,
  isQuietHour,
  isValidPushKeys,
  pushConfigFromEnv,
  pushMessageFor,
  removePushDevice,
  savePushDevice,
  setPushDeviceCategories,
  type PushConfig,
  type PushRequest,
} from "../services/push";
import { MIN, T0, at, makeHorse, memoryDb, newPlayer } from "./helpers";

const ece = createRequire(createRequire(import.meta.url).resolve("web-push"))("http_ece") as {
  decrypt: (buf: Buffer, params: { version: string; privateKey: ReturnType<typeof createECDH>; authSecret: string }) => Buffer;
};

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});
afterEach(() => onPushableNote(null));

const vapid = webpush.generateVAPIDKeys();
const config: PushConfig = { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:alerts@example.test" };

/** A browser's subscription keys (we keep the private half to read what was sent). */
function device() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16).toString("base64url");
  const n = randomBytes(6).toString("hex");
  return { ecdh, auth, endpoint: `https://fcm.googleapis.com/fcm/send/test-${n}`, p256dh: ecdh.getPublicKey().toString("base64url") };
}

/** A fake push service: records requests, answers with `status` (or per endpoint). */
function pushService(status: number | ((endpoint: string) => number) = 201) {
  const sent: PushRequest[] = [];
  return {
    sent,
    transport: async (req: PushRequest) => {
      sent.push(req);
      return { status: typeof status === "number" ? status : status(req.endpoint) };
    },
  };
}

async function playerWithDevice(opts: { tz?: string } = {}) {
  const p = await newPlayer(h.db);
  if (opts.tz) await h.db.update(accounts).set({ timezone: opts.tz }).where(eq(accounts.id, p.accountId));
  const d = device();
  await savePushDevice(h.db, { accountId: p.accountId, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, now: T0 });
  return { ...p, device: d };
}

let n = 0;
async function liveRace(postTime: Date, name?: string) {
  n++;
  return createRace(h.db, {
    kind: "scheduled",
    name: name ?? `Alert Stakes ${n}`,
    raceClass: "maiden",
    conditions: { distanceM: 1200, surface: "turf" },
    postTime,
    entriesCloseAt: new Date(postTime.getTime() - 30_000),
    targetRunners: 6,
    slotKey: `${SLOT_KEY_PREFIX}${800_000 + n}`,
  });
}

async function note(accountId: string, kind: InboxKind, now: Date, extra: { raceId?: string; horseId?: string; title?: string; data?: unknown } = {}) {
  return notify(h.db, { accountId, kind, dedupeKey: `${kind}:${randomBytes(4).toString("hex")}`, title: extra.title ?? `A ${kind} note`, now, ...extra });
}

const deliveries = (accountId: string) => h.db.select().from(pushDeliveries).where(eq(pushDeliveries.accountId, accountId));
const statusOf = async (itemId: string) => (await h.db.select().from(pushDeliveries).where(eq(pushDeliveries.inboxItemId, itemId)))[0]?.status;

function read(req: PushRequest, d: ReturnType<typeof device>) {
  return JSON.parse(ece.decrypt(req.body!, { version: "aes128gcm", privateKey: d.ecdh, authSecret: d.auth }).toString("utf8")) as { title: string; body: string; url: string; tag: string };
}

describe("configuration", () => {
  it("is off unless all three VAPID settings are set and valid", () => {
    expect(pushConfigFromEnv({})).toBeNull();
    expect(pushConfigFromEnv({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey })).toBeNull();
    expect(pushConfigFromEnv({ VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
    expect(pushConfigFromEnv({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "nobody" })).toBeNull();
    expect(pushConfigFromEnv({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:a@b.c" })).toEqual({ publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:a@b.c" });
  });

  it("only posts to the browsers' push services", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://googleapis.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("http://127.0.0.1:4555/push/1")).toBe(false);
    expect(isAllowedPushEndpoint("http://127.0.0.1:4555/push/1", "http://127.0.0.1:4555")).toBe(true);
    const d = device();
    expect(isValidPushKeys(d)).toBe(true);
    expect(isValidPushKeys({ p256dh: "abc", auth: d.auth })).toBe(false);
  });
});

describe("delivery", () => {
  it("sends nothing without keys, and nothing for accounts without a device", async () => {
    const p = await playerWithDevice();
    const lonely = await newPlayer(h.db);
    const horse = await makeHorse(h.db, p.stableId);
    await note(p.accountId, "back_in_race", T0, { horseId: horse.id });
    await note(lonely.accountId, "back_in_race", T0, { horseId: horse.id });
    const svc = pushService();
    const off = await deliverPushes(h.db, T0, { config: null, transport: svc.transport });
    expect(off.sent).toBe(0);
    expect(svc.sent).toHaveLength(0);
    expect(await deliveries(p.accountId)).toHaveLength(0);
    const on = await deliverPushes(h.db, T0, { config, transport: svc.transport });
    expect(on.sent).toBe(1);
    expect(svc.sent).toHaveLength(1);
    expect(svc.sent[0]!.endpoint).toBe(p.device.endpoint);
    expect(svc.sent[0]!.headers.Authorization ?? svc.sent[0]!.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(await deliveries(lonely.accountId)).toHaveLength(0);
    // Run again: already claimed, never sent twice.
    expect((await deliverPushes(h.db, at(MIN), { config, transport: svc.transport })).sent).toBe(0);
    expect(svc.sent).toHaveLength(1);
  });

  it("only pushes push kinds, and nothing the player already saw", async () => {
    const p = await playerWithDevice();
    await note(p.accountId, "training_ready", T0);
    await note(p.accountId, "listing_expired", T0);
    await notify(h.db, { accountId: p.accountId, kind: "gift_foal", dedupeKey: "gift-foal", title: "A gift foal from the Club: Tiny Dancer", now: T0, seen: true });
    const svc = pushService();
    expect((await deliverPushes(h.db, T0, { config, transport: svc.transport })).sent).toBe(0);
    expect(svc.sent).toHaveLength(0);
  });

  it("respects the bell's category switch and the device's own", async () => {
    const p = await playerWithDevice();
    const horse = await makeHorse(h.db, p.stableId);
    await setNotificationPrefs(h.db, { accountId: p.accountId, disabled: ["health"], now: T0 });
    const a = await note(p.accountId, "back_in_race", T0, { horseId: horse.id });
    await setPushDeviceCategories(h.db, { accountId: p.accountId, endpoint: p.device.endpoint, enabled: { club: false }, now: T0 });
    const b = await note(p.accountId, "gift_foal", T0, { title: "A gift foal from the Club: Tiny Dancer" });
    const c = await note(p.accountId, "foal_due", T0, { horseId: horse.id, title: "Mare is ready to foal: come and meet the foal" });
    const svc = pushService();
    const r = await deliverPushes(h.db, T0, { config, transport: svc.transport });
    expect(await statusOf(a!)).toBe("off");
    expect(await statusOf(b!)).toBe("device_off");
    expect(await statusOf(c!)).toBe("sent");
    expect(r.sent).toBe(1);
    expect(read(svc.sent[0]!, p.device)).toMatchObject({ title: "Your foal is here", url: "/breeding" });
  });

  it("stays quiet from 22:00 to 08:00 local, unless the race the player entered runs then", async () => {
    expect(isQuietHour("Asia/Tokyo", new Date("2026-11-02T13:00:00Z"))).toBe(true); // 22:00 JST
    expect(isQuietHour("Asia/Tokyo", new Date("2026-11-02T23:00:00Z"))).toBe(false); // 08:00 JST
    expect(isQuietHour("Asia/Tokyo", new Date("2026-11-02T12:59:00Z"))).toBe(false); // 21:59 JST
    const p = await playerWithDevice({ tz: "Asia/Tokyo" });
    const horse = await makeHorse(h.db, p.stableId);
    const now = new Date("2026-11-02T14:00:00Z"); // 23:00 JST
    const back = await note(p.accountId, "back_in_race", now, { horseId: horse.id });
    const race = await liveRace(new Date(now.getTime() + 30_000));
    const off = await note(p.accountId, "race_off", now, { raceId: race.id, horseId: horse.id, title: `${horse.name} is going to post in the ${race.name}: watch it live` });
    const svc = pushService();
    await deliverPushes(h.db, now, { config, transport: svc.transport });
    expect(await statusOf(back!)).toBe("quiet");
    expect(await statusOf(off!)).toBe("sent");
    expect(svc.sent).toHaveLength(1);
    // The same race by day for a UTC player is simply sent.
    expect(isQuietHour("UTC", now)).toBe(false);
  });

  it(`sends at most ${PUSH_DAILY_CAP} a day (the player's local day)`, async () => {
    const p = await playerWithDevice();
    const ids: string[] = [];
    for (let i = 0; i < PUSH_DAILY_CAP + 2; i++) {
      const horse = await makeHorse(h.db, p.stableId);
      ids.push((await note(p.accountId, "back_in_race", T0, { horseId: horse.id }))!);
    }
    const svc = pushService();
    const r = await deliverPushes(h.db, T0, { config, transport: svc.transport });
    expect(r.sent).toBe(PUSH_DAILY_CAP);
    expect(r.skipped.cap).toBe(2);
    expect(svc.sent).toHaveLength(PUSH_DAILY_CAP);
    // Later the same day: still capped. The next local day: alerts again.
    const horse = await makeHorse(h.db, p.stableId);
    const later = await note(p.accountId, "back_in_race", at(3 * 60 * MIN), { horseId: horse.id });
    await deliverPushes(h.db, at(3 * 60 * MIN), { config, transport: svc.transport });
    expect(await statusOf(later!)).toBe("cap");
    const tomorrow = new Date("2026-11-03T09:00:00Z");
    const next = await note(p.accountId, "back_in_race", tomorrow, { horseId: (await makeHorse(h.db, p.stableId)).id });
    await deliverPushes(h.db, tomorrow, { config, transport: svc.transport });
    expect(await statusOf(next!)).toBe("sent");
  });

  it("collapses duplicates: two horses in one race ring once, and the same alert isn't repeated", async () => {
    const p = await playerWithDevice();
    const a = await makeHorse(h.db, p.stableId);
    const b = await makeHorse(h.db, p.stableId);
    const race = await liveRace(at(MIN));
    const offA = await note(p.accountId, "race_off", T0, { raceId: race.id, horseId: a.id });
    const offB = await note(p.accountId, "race_off", T0, { raceId: race.id, horseId: b.id });
    const svc = pushService();
    const r = await deliverPushes(h.db, T0, { config, transport: svc.transport });
    expect(r.sent).toBe(1);
    expect([await statusOf(offA!), await statusOf(offB!)].sort()).toEqual(["duplicate", "sent"]);
    const msg = read(svc.sent[0]!, p.device);
    expect(msg.tag).toBe(`race-${race.id}`);
    // The same kind for the same race a little later: a duplicate. A different kind (the result) is not.
    const again = await note(p.accountId, "race_off", at(30_000), { raceId: race.id, horseId: a.id });
    const result = await note(p.accountId, "race_result", at(2 * MIN), { raceId: race.id, horseId: a.id, title: `${a.name} finished 1st in the ${race.name}` });
    await deliverPushes(h.db, at(2 * MIN), { config, transport: svc.transport });
    expect(await statusOf(again!)).toBe("duplicate");
    expect(await statusOf(result!)).toBe("sent");
    expect(read(svc.sent[1]!, p.device).tag).toBe(`race-${race.id}`); // replaces "going to post" on the device
  });

  it("skips stale race alerts and results already watched", async () => {
    const p = await playerWithDevice();
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace(at(5 * MIN));
    const soon = await note(p.accountId, "race_soon", T0, { raceId: race.id, horseId: horse.id });
    const svc = pushService();
    await deliverPushes(h.db, at(6 * MIN), { config, transport: svc.transport }); // after the off
    expect(await statusOf(soon!)).toBe("stale");
    // A Story race (no Live slot): the player is there, no alert.
    const story = await createRace(h.db, { kind: "quick", name: "Story Race", raceClass: "maiden", conditions: {}, postTime: at(7 * MIN), entriesCloseAt: at(7 * MIN) });
    const storyResult = await note(p.accountId, "race_result", at(7 * MIN), { raceId: story.id, horseId: horse.id });
    await deliverPushes(h.db, at(7 * MIN), { config, transport: svc.transport });
    expect(await statusOf(storyResult!)).toBe("stale");
    expect(svc.sent).toHaveLength(0);
  });

  it("forgets a device the push service reports gone (410 / 404), and counts other failures", async () => {
    const p = await playerWithDevice();
    const second = device();
    await savePushDevice(h.db, { accountId: p.accountId, endpoint: second.endpoint, p256dh: second.p256dh, auth: second.auth, now: T0 });
    const third = device();
    await savePushDevice(h.db, { accountId: p.accountId, endpoint: third.endpoint, p256dh: third.p256dh, auth: third.auth, now: T0 });
    const horse = await makeHorse(h.db, p.stableId);
    const item = await note(p.accountId, "back_in_race", T0, { horseId: horse.id });
    const svc = pushService((e) => (e === p.device.endpoint ? 410 : e === second.endpoint ? 404 : 500));
    const r = await deliverPushes(h.db, T0, { config, transport: svc.transport });
    expect(svc.sent).toHaveLength(3);
    expect(r.devicesRemoved).toBe(2);
    expect(await statusOf(item!)).toBe("failed");
    const left = await h.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, p.accountId));
    expect(left.map((d) => d.endpoint)).toEqual([third.endpoint]);
    expect(left[0]!.failures).toBe(1);
  });

  it("never spoils a race: a result alert says only that it is ready to watch", async () => {
    const p = await playerWithDevice();
    const horse = await makeHorse(h.db, p.stableId, { name: "Spoiler Alert" });
    const race = await liveRace(T0, "Secret Stakes");
    await note(p.accountId, "race_result", at(2 * MIN), { raceId: race.id, horseId: horse.id, title: "Spoiler Alert finished 1st in the Secret Stakes · Sprain", data: { position: 1, prize: 900, injury: "minor" } });
    const svc = pushService();
    await deliverPushes(h.db, at(2 * MIN), { config, transport: svc.transport });
    expect(svc.sent).toHaveLength(1);
    const msg = read(svc.sent[0]!, p.device);
    expect(msg).toEqual({ title: "Your result is ready", body: "Watch the Secret Stakes to see how it went.", url: `/race/${race.id}`, tag: `race-${race.id}`, kind: "race_result" });
    expect(JSON.stringify(msg)).not.toMatch(/1st|won|win|finish|Sprain|injur|Spoiler Alert|900/i);
    // pushMessageFor never uses the stored title for a spoiler kind, whatever it says.
    for (const title of ["X won the Y", "X was fatally injured in the Y", "X finished 3rd"]) {
      const m = pushMessageFor({ id: "i", kind: "race_result", title, data: null, raceId: race.id, horseId: null, readAt: null, createdAt: T0, raceName: "Y" });
      expect(`${m.title} ${m.body}`).not.toMatch(/won|injur|3rd|finished/);
    }
  });

  it("holds back an item that came out of a race whose result is still unwatched", async () => {
    const p = await playerWithDevice();
    const horse = await makeHorse(h.db, p.stableId);
    const race = await liveRace(at(-60 * MIN));
    await note(p.accountId, "race_result", at(-50 * MIN), { raceId: race.id, horseId: horse.id }); // unwatched, too old to push
    const back = await note(p.accountId, "back_in_race", T0, { horseId: horse.id, data: { raceId: race.id } });
    const svc = pushService();
    await deliverPushes(h.db, T0, { config, transport: svc.transport });
    expect(await statusOf(back!)).toBe("held");
    expect(svc.sent).toHaveLength(0);
  });
});

describe("a Live race moved earlier", () => {
  it("rings the entrant (race_moved), and the 10-minute reminder that follows adds nothing", async () => {
    const p = await playerWithDevice();
    const horse = await makeHorse(h.db, p.stableId, { rating: 40 });
    const race = await liveRace(at(180 * MIN), "Early Bird Stakes");
    await h.db.update(races).set({ maxRunners: 8, conditions: { minRating: 0, maxRating: 140, distanceM: 1200, surface: "turf" } }).where(eq(races.id, race.id));
    await enterRace(h.db, { accountId: p.accountId, raceId: race.id, horseId: horse.id, tactic: "stalker", now: T0 });
    expect(await startRaceEarly(h.db, { raceId: race.id, now: at(MIN), minutes: 10 })).not.toBeNull();
    const svc = pushService();
    const r = await deliverPushes(h.db, at(MIN), { config, transport: svc.transport });
    expect(r.sent).toBe(1);
    const msg = read(svc.sent[0]!, p.device);
    expect(msg).toMatchObject({ title: "Your Live race moved earlier", url: `/race/${race.id}`, tag: `race-${race.id}` });
    expect(msg.body).toMatch(/Early Bird Stakes now goes off in 10 minutes/);
    expect(svc.sent[0]!.headers.Urgency ?? svc.sent[0]!.headers.urgency).toBe("high");
    // The sweep's "runs in 10 minutes" for the same race: a duplicate (the device already shows the new time).
    await sweepNotifications(h.db, at(2 * MIN));
    await deliverPushes(h.db, at(2 * MIN), { config, transport: svc.transport });
    const soon = (await deliveries(p.accountId)).find((d) => d.kind === "race_soon");
    expect(soon?.status).toBe("duplicate");
    expect(svc.sent).toHaveLength(1);
  });

  it("is a race alert: sent in quiet hours when the race itself runs then, stale once it has gone off", async () => {
    const p = await playerWithDevice({ tz: "Asia/Tokyo" });
    const horse = await makeHorse(h.db, p.stableId);
    const night = new Date("2026-11-02T14:00:00Z"); // 23:00 JST
    const race = await liveRace(new Date(night.getTime() + 10 * MIN));
    const moved = await note(p.accountId, "race_moved", night, { raceId: race.id, title: `The ${race.name} now goes off in 10 minutes (brought forward)` });
    const svc = pushService();
    await deliverPushes(h.db, night, { config, transport: svc.transport });
    expect(await statusOf(moved!)).toBe("sent");
    const p2 = await playerWithDevice();
    const race2 = await liveRace(at(5 * MIN));
    const late = await note(p2.accountId, "race_moved", at(6 * MIN), { raceId: race2.id });
    await deliverPushes(h.db, at(6 * MIN), { config, transport: svc.transport });
    expect(await statusOf(late!)).toBe("stale");
  });
});

describe("devices", () => {
  it("a new device starts with every alert category on; settings stick and removal works", async () => {
    const p = await newPlayer(h.db);
    const d = device();
    expect(PUSH_CATEGORIES).toEqual(["races", "health", "breeding", "club"]);
    expect((await savePushDevice(h.db, { accountId: p.accountId, ...d, now: T0 })).categories).toEqual([...PUSH_CATEGORIES]);
    expect((await setPushDeviceCategories(h.db, { accountId: p.accountId, endpoint: d.endpoint, enabled: { races: false, market: true } as never, now: T0 }))!.categories).toEqual(["health", "breeding", "club"]);
    // Re-saving (fresh keys after a browser refresh) keeps the device's choices.
    expect((await savePushDevice(h.db, { accountId: p.accountId, ...d, now: T0 })).categories).toEqual(["health", "breeding", "club"]);
    // Another account can't touch it.
    const other = await newPlayer(h.db);
    expect(await setPushDeviceCategories(h.db, { accountId: other.accountId, endpoint: d.endpoint, enabled: { races: true }, now: T0 })).toBeNull();
    expect(await removePushDevice(h.db, { accountId: other.accountId, endpoint: d.endpoint })).toBe(false);
    expect(await removePushDevice(h.db, { accountId: p.accountId, endpoint: d.endpoint })).toBe(true);
  });
});

describe("the signal from notify", () => {
  it("fires for new push-kind items only (not bell-only kinds, not repeats, not already seen)", async () => {
    const p = await newPlayer(h.db);
    const got: string[] = [];
    onPushableNote((k) => got.push(k));
    await notify(h.db, { accountId: p.accountId, kind: "back_in_race", dedupeKey: "sig-1", title: "x", now: T0 });
    await notify(h.db, { accountId: p.accountId, kind: "back_in_race", dedupeKey: "sig-1", title: "x", now: T0 });
    await notify(h.db, { accountId: p.accountId, kind: "training_ready", dedupeKey: "sig-2", title: "x", now: T0 });
    await notify(h.db, { accountId: p.accountId, kind: "gift_foal", dedupeKey: "sig-3", title: "x", now: T0, seen: true });
    expect(got).toEqual(["back_in_race"]);
  });
});

describe("a mare ready to foal", () => {
  it("rings once per pregnancy from the sweep (the owner's note, linking to the barn)", async () => {
    const p = await newPlayer(h.db, { credits: 100_000 });
    await h.db.execute(`update stables set stall_slots = 24 where id = '${p.stableId}'`);
    const retired = { careerStatus: "retired" as const, retirementReason: "choice" as const, retiredAt: T0 };
    const sire = await makeHorse(h.db, p.stableId, { sex: "male", ...retired });
    const dam = await makeHorse(h.db, p.stableId, { sex: "female", name: "Mother Hen", ...retired });
    const { dueAt } = await breed(h.db, { accountId: p.accountId, sireId: sire.id, damId: dam.id, now: T0, idempotencyKey: `push-foal:${dam.id}` });
    expect(await noteFoalsDueTx(h.db, new Date(dueAt.getTime() - MIN))).toBe(0); // not due yet
    const r = await sweepNotifications(h.db, new Date(dueAt.getTime() + MIN));
    expect(r.foalsDue).toBe(1);
    expect(await noteFoalsDueTx(h.db, new Date(dueAt.getTime() + 2 * MIN))).toBe(0); // once
    const d = device();
    await savePushDevice(h.db, { accountId: p.accountId, ...d, now: T0 });
    const svc = pushService();
    const run = await deliverPushes(h.db, new Date(dueAt.getTime() + 2 * MIN), { config, transport: svc.transport });
    expect(run.sent).toBe(1);
    expect(read(svc.sent[0]!, d)).toMatchObject({ title: "Your foal is here", body: "Mother Hen is ready to foal: come and meet the foal", url: "/breeding" });
  });
});
