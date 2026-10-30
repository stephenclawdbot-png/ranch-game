/** The race list shows the evening's Feature Qualifier in the morning (calendar races publish a day ahead). */
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAccount, createDb, stableOf, type DbHandle } from "@thoroughbred/db";
import { entryOptions, raceList } from "./game";

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

it("a morning visit sees and can enter the 19:00 Feature Qualifier", { timeout: 120_000 }, async () => {
  const t = new Date(Date.UTC(2026, 10, 11, 8, 0, 0)); // a Wednesday morning
  const acc = await createAccount(h.db, { stableName: "Morning Stable", startingCredits: 50_000, silks: { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" }, timezone: "Europe/London", now: t });
  await h.db.execute(`update stables set licence_level = 3 where account_id = '${acc.accountId}'`);
  const s = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
  const list = await raceList(h.db, t, s.stable.id, { upcoming: 8, recent: 0 });
  const q = list.upcoming.find((r) => r.name.includes("Feature Qualifier"));
  expect(q).toBeDefined();
  expect(new Date(q!.postTimeMs).getUTCHours()).toBe(19);
  const sheet = await entryOptions(h.db, s, q!.id, t);
  expect(sheet.options.some((o) => o.reason === null)).toBe(true);
});
