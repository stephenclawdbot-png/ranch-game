/**
 * Testing-phase login codes: permanent per account, unguessable shape, only the hash stored,
 * accepted at /link in place of a device code, off outside the playtest or without the secret.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { authenticate, createAccount, createDb, schema, type DbHandle } from "@thoroughbred/db";
import { linkDeviceResponse, resetLinkFailures } from "./devices";
import { ensureLoginCode, loginCodeFor, loginCodesEnabled, normalizeLoginCode } from "./loginCode";

const ENV = { PLAYTEST_MODE: "1", LOGIN_CODE_SECRET: "x".repeat(40) };
const SILKS = { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" };
let h: DbHandle;
const saved = { ...process.env };
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  process.env = { ...saved };
});

describe("login codes", () => {
  it("are permanent per account, distinct between accounts, and 20 characters from the safe alphabet", () => {
    const a = loginCodeFor("11111111-1111-1111-1111-111111111111", ENV)!;
    expect(a).toMatch(/^PT-[2-9A-HJKMNP-Z]{5}(-[2-9A-HJKMNP-Z]{5}){3}$/);
    expect(loginCodeFor("11111111-1111-1111-1111-111111111111", ENV)).toBe(a);
    expect(loginCodeFor("22222222-2222-2222-2222-222222222222", ENV)).not.toBe(a);
    expect(loginCodeFor("11111111-1111-1111-1111-111111111111", { ...ENV, LOGIN_CODE_SECRET: "y".repeat(40) })).not.toBe(a);
  });
  it("are off outside the playtest or without a long secret", () => {
    expect(loginCodesEnabled(ENV)).toBe(true);
    expect(loginCodeFor("a", { LOGIN_CODE_SECRET: ENV.LOGIN_CODE_SECRET })).toBeNull();
    expect(loginCodeFor("a", { PLAYTEST_MODE: "1", LOGIN_CODE_SECRET: "short" })).toBeNull();
  });
  it("forgive case, spaces, dashes and the PT prefix when typed", () => {
    const code = loginCodeFor("33333333-3333-3333-3333-333333333333", ENV)!;
    const raw = code.slice(3).replace(/-/g, "");
    expect(normalizeLoginCode(raw.toLowerCase())).toBe(code);
    expect(normalizeLoginCode(` pt ${raw.slice(0, 10)} ${raw.slice(10)} `)).toBe(code);
    expect(normalizeLoginCode("ABCD-EFGH")).toBeNull();
  });
  it("sign a new browser in at /link, again and again; only the hash is stored; a wrong code fails", async () => {
    process.env = { ...saved, ...ENV };
    const acc = await createAccount(h.db, { stableName: "Code Stable", silks: SILKS });
    const code = (await ensureLoginCode(h.db, acc.accountId))!;
    expect(await ensureLoginCode(h.db, acc.accountId)).toBe(code);
    const rows = await h.db.select().from(schema.loginCodes);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code.slice(3, 8));
    for (const typed of [code, code.toLowerCase().replace(/-/g, " ")]) {
      const res = await linkDeviceResponse(h.db, { body: { code: typed }, ip: "9.9.9.9", session: null });
      expect(res.status).toBe(200);
      expect(await authenticate(h.db, res.cookies.get("tb_session")!.value)).toMatchObject({ accountId: acc.accountId });
    }
    const wrong = code.slice(0, -1) + (code.endsWith("2") ? "3" : "2");
    expect((await linkDeviceResponse(h.db, { body: { code: wrong }, ip: "9.9.9.9", session: null })).status).toBe(400);
    await resetLinkFailures(h.db);
  });
  it("are refused outside the playtest", async () => {
    process.env = { ...saved, ...ENV };
    const acc = await createAccount(h.db, { stableName: "Later Stable", silks: SILKS });
    const code = (await ensureLoginCode(h.db, acc.accountId))!;
    process.env = { ...saved, PLAYTEST_MODE: "", LOGIN_CODE_SECRET: ENV.LOGIN_CODE_SECRET };
    expect((await linkDeviceResponse(h.db, { body: { code }, ip: "8.8.8.8", session: null })).status).toBe(400);
    await resetLinkFailures(h.db);
  });
});
