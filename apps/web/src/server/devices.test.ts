/**
 * Device linking at the HTTP layer (src/server/devices.ts, driven by /api/account/link*):
 * the cookie that signs the new device in, the generic failure wording for every bad code,
 * the per-IP failure limit, and the replace guard for browsers that already have a stable.
 * Storage of tokens and codes as hashes only is asserted in packages/db's devices tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, createAccount, createDb, createLinkCode, listDevices, schema, stableOf, type DbHandle } from "@thoroughbred/db";
import { createStoryRace } from "./game";
import { linkDeviceResponse, listDevicesResponse, resetLinkFailures, LINK_FAIL_LIMIT } from "./devices";
import type { Session } from "./session";

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };

async function player(name: string): Promise<Session & { token: string }> {
  const acc = await createAccount(h.db, { stableName: name, silks: SILKS });
  return { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId), token: acc.token };
}

function body(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/account/link", () => {
  it("signs the new device in: session cookie set, stable name returned, token authenticates", async () => {
    const home = await player("Home Stable");
    const { code } = await createLinkCode(h.db, { accountId: home.accountId });
    const res = await linkDeviceResponse(h.db, { body: { code, label: "iPhone · Safari" }, ip: "1.2.3.4", session: null });
    expect(res.status).toBe(200);
    expect((await body(res)).stableName).toBe("Home Stable");
    const cookie = res.cookies.get("tb_session")!;
    expect(cookie.value.length).toBeGreaterThanOrEqual(20);
    expect(cookie.httpOnly).toBe(true);
    expect(await authenticate(h.db, cookie.value)).toMatchObject({ accountId: home.accountId });
  });

  it("answers the same generic message for unknown, expired and already-used codes", async () => {
    const home = await player("Careful Stable");
    const expired = await createLinkCode(h.db, { accountId: home.accountId, now: new Date(Date.now() - 11 * 60_000) });
    for (const code of ["NOPE-CODE", expired.code]) {
      const res = await linkDeviceResponse(h.db, { body: { code }, ip: "2.2.2.2", session: null });
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe("link_code_invalid");
    }
    const fresh = await createLinkCode(h.db, { accountId: home.accountId });
    const once = await linkDeviceResponse(h.db, { body: { code: fresh.code.toLowerCase().replace("-", " ") }, ip: "2.2.2.2", session: null });
    expect(once.status).toBe(200); // case- and dash-insensitive
    const twice = await linkDeviceResponse(h.db, { body: { code: fresh.code }, ip: "2.2.2.2", session: null });
    expect(twice.status).toBe(400);
    expect((await body(twice)).message).toBe("That code didn't work. Check it and try again.");
    expect((await body(await linkDeviceResponse(h.db, { body: { code: "NOPE-CODE" }, ip: "2.2.2.2", session: null }))).message).toBe(
      "That code didn't work. Check it and try again.",
    );
  });

  it("rejects the 21st failed redemption from one IP within the hour; others unaffected", async () => {
    await resetLinkFailures(h.db);
    for (let i = 0; i < LINK_FAIL_LIMIT; i++) {
      const res = await linkDeviceResponse(h.db, { body: { code: "BAD1-CODE" }, ip: "3.3.3.3", session: null });
      expect(res.status).toBe(400);
    }
    const throttled = await linkDeviceResponse(h.db, { body: { code: "BAD1-CODE" }, ip: "3.3.3.3", session: null });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("3600");
    // A different IP (and a good code) still links.
    const home = await player("Throttled Stable");
    const { code } = await createLinkCode(h.db, { accountId: home.accountId });
    const ok = await linkDeviceResponse(h.db, { body: { code }, ip: "4.4.4.4", session: null });
    expect(ok.status).toBe(200);
  });

  it("refuses to switch a browser that has a stable in play, unless replace is confirmed; the switch is audited, the IP never recorded as a signal", async () => {
    const home = await player("Old Stable");
    const other = await player("New Stable");
    // The old browser's stable has run a race, so it is in play.
    await createStoryRace(h.db, home, { instant: true }, new Date());
    const { code } = await createLinkCode(h.db, { accountId: other.accountId });
    const refused = await linkDeviceResponse(h.db, { body: { code }, ip: "5.5.5.5", session: home });
    expect(refused.status).toBe(409);
    expect((await body(refused)).error).toBe("replace_required");
    const replaced = await linkDeviceResponse(h.db, { body: { code, replace: true }, ip: "5.5.5.5", session: home });
    expect(replaced.status).toBe(200);
    const cookie = replaced.cookies.get("tb_session")!;
    expect(await authenticate(h.db, cookie.value)).toMatchObject({ accountId: other.accountId });
    // The switch is a browser changing stables, not a shared identity: audit row, no signal.
    const switches = (await h.db.select().from(schema.auditLog)).filter((r) => r.action === "account.switch");
    expect(switches.at(-1)).toMatchObject({ data: { from: home.accountId, to: other.accountId } });
    const deviceSignals = (await h.db.select().from(schema.accountLinks)).filter((r) => r.kind === "device");
    expect(deviceSignals).toHaveLength(0);
  });

  it("links a browser whose stable is still fresh without the confirmation", async () => {
    const home = await player("Fresh Starter Stable");
    const other = await player("Established Stable");
    const { code } = await createLinkCode(h.db, { accountId: other.accountId });
    const res = await linkDeviceResponse(h.db, { body: { code }, ip: "6.6.6.6", session: home });
    expect(res.status).toBe(200);
    expect(res.cookies.get("tb_session")!.value.length).toBeGreaterThanOrEqual(20);
  });
});

describe("GET /api/account/devices", () => {
  it("marks the requesting device", async () => {
    const home = await player("Device Stable");
    const { code } = await createLinkCode(h.db, { accountId: home.accountId });
    const linked = await linkDeviceResponse(h.db, { body: { code, label: "Spare phone" }, ip: "7.7.7.7", session: null });
    const token = linked.cookies.get("tb_session")!.value;
    const session = (await authenticate(h.db, token))!;
    const res = await listDevicesResponse(h.db, session, token);
    const data = (await body(res)) as { devices: { label: string; current: boolean }[]; original: boolean };
    expect(data.original).toBe(false);
    expect(data.devices).toHaveLength(1);
    expect(data.devices[0]).toMatchObject({ label: "Spare phone", current: true });
    const fromHome = await listDevicesResponse(h.db, home, home.token);
    expect(((await body(fromHome)) as { original: boolean }).original).toBe(true);
    // Same answer straight from the service layer, where the db tests live.
    expect((await listDevices(h.db, home.accountId, "not-the-token")).devices[0]!.current).toBe(false);
  });
});