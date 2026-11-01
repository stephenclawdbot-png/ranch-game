/**
 * Phone alerts in the web app (/api/push, /api/push/device, server/push.ts): invisible and inert
 * without the VAPID keys; with them, a player saves, reads, switches and removes only their own
 * device, only browser push services are accepted, and a new push-kind note goes out after the
 * request (here: outside a request, on the fallback timer) through fetch to the device's endpoint.
 */
import { createECDH, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { GET as CONFIG } from "../../app/api/push/route";
import { DELETE as REMOVE, PATCH as UPDATE, POST as SUBSCRIBE } from "../../app/api/push/device/route";
import { createAccount, notify, resetDbSingleton, type DbHandle } from "@thoroughbred/db";
import { dbHandle } from "./db";

let h: DbHandle;
const silks = { pattern: "hoops" as const, primary: "#112233", secondary: "#445566", cap: "#778899" };
let me: { accountId: string; token: string };
let other: { accountId: string; token: string };
/** A throwaway VAPID key pair (P-256: the public point and the private scalar, base64url). */
const vapid = (() => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString("base64url") };
})();

const req = (url: string, method: string, b?: unknown) => new Request(`https://tb.example${url}`, { method, headers: { "content-type": "application/json", "user-agent": "vitest" }, body: b === undefined ? undefined : JSON.stringify(b) });
const as = (who: { token: string } | null) => {
  jar.token = who?.token ?? null;
};
const keysOn = () => {
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = "mailto:alerts@example.test";
};
const keysOff = () => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
};
function browserSub() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/web-${randomBytes(6).toString("hex")}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

beforeAll(async () => {
  h = await dbHandle();
  const now = new Date();
  const a = await createAccount(h.db, { stableName: "Ping Lodge", silks, now });
  const b = await createAccount(h.db, { stableName: "Silent Acres", silks, now });
  me = { accountId: a.accountId, token: a.token };
  other = { accountId: b.accountId, token: b.token };
});

afterEach(() => {
  keysOff();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbSingleton();
});

describe("phone alerts API", () => {
  it("is invisible without the keys", async () => {
    keysOff();
    expect(await (await CONFIG()).json()).toEqual({ enabled: false });
    as(me);
    expect((await SUBSCRIBE(req("/api/push/device", "POST", { subscription: browserSub() }))).status).toBe(404);
    expect((await UPDATE(req("/api/push/device", "PATCH", { endpoint: browserSub().endpoint }))).status).toBe(404);
  });

  it("with the keys: the public key and the alert categories, never the private key", async () => {
    keysOn();
    const body = await (await CONFIG()).json();
    expect(body).toMatchObject({ enabled: true, publicKey: vapid.publicKey, categories: [{ key: "races" }, { key: "health" }, { key: "breeding" }, { key: "club" }] });
    expect(JSON.stringify(body)).not.toContain(vapid.privateKey);
  });

  it("saves, reads, switches and removes only the player's own device", async () => {
    keysOn();
    const sub = browserSub();
    as(null);
    expect((await SUBSCRIBE(req("/api/push/device", "POST", { subscription: sub }))).status).toBe(401);
    as(me);
    expect((await SUBSCRIBE(req("/api/push/device", "POST", { subscription: { ...sub, endpoint: "https://169.254.169.254/latest/meta-data" } }))).status).toBe(400);
    expect((await SUBSCRIBE(req("/api/push/device", "POST", { subscription: { ...sub, keys: { p256dh: "x".repeat(20), auth: sub.keys.auth } } }))).status).toBe(400);
    const saved = await SUBSCRIBE(req("/api/push/device", "POST", { subscription: sub }));
    expect(saved.status).toBe(201);
    expect((await saved.json()).device.categories).toEqual(["races", "health", "breeding", "club"]);
    const off = await UPDATE(req("/api/push/device", "PATCH", { endpoint: sub.endpoint, enabled: { club: false } }));
    expect((await off.json()).device.categories).toEqual(["races", "health", "breeding"]);
    expect((await (await UPDATE(req("/api/push/device", "PATCH", { endpoint: sub.endpoint }))).json()).device.categories).toEqual(["races", "health", "breeding"]);
    expect((await UPDATE(req("/api/push/device", "PATCH", { endpoint: sub.endpoint, enabled: { market: true } }))).status).toBe(400);
    as(other);
    expect((await (await UPDATE(req("/api/push/device", "PATCH", { endpoint: sub.endpoint, enabled: { club: true } }))).json()).device).toBeNull();
    expect((await (await REMOVE(req("/api/push/device", "DELETE", { endpoint: sub.endpoint }))).json()).removed).toBe(false);
    as(me);
    expect((await (await REMOVE(req("/api/push/device", "DELETE", { endpoint: sub.endpoint }))).json()).removed).toBe(true);
  });

  it("a new push-kind note goes out after the request, to the device's push service", async () => {
    keysOn();
    as(me);
    const sub = browserSub();
    expect((await SUBSCRIBE(req("/api/push/device", "POST", { subscription: sub }))).status).toBe(201);
    const posts: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      posts.push({ url, headers: init.headers as Record<string, string> });
      return new Response(null, { status: 201 });
    });
    const id = await notify(h.db, { accountId: me.accountId, kind: "back_in_race", dedupeKey: `back:web:${randomBytes(3).toString("hex")}`, title: "Sea Lavender is over the sore shin and can race again", now: new Date() });
    // Not during the write: the sender runs after (here on the fallback timer, no request scope).
    expect(posts).toHaveLength(0);
    await vi.waitFor(() => expect(posts).toHaveLength(1), { timeout: 5000, interval: 100 });
    expect(posts[0]!.url).toBe(sub.endpoint);
    expect(posts[0]!.headers["Content-Encoding"]).toBe("aes128gcm");
    await vi.waitFor(
      async () => {
        const rows = await h.db.execute(`select status from push_deliveries where inbox_item_id = '${id}'`);
        expect((rows as unknown as { rows: { status: string }[] }).rows[0]?.status).toBe("sent");
      },
      { timeout: 5000, interval: 100 },
    );
  });
});
