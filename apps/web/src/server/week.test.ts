/** Road to Saturday: the week view finds the Feature, its qualifiers and the stable's horses. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, stableOf, type DbHandle } from "@thoroughbred/db";
import type { Session } from "./session";
import { weekView } from "./week";

let h: DbHandle;
beforeAll(async () => {
  h = await createDb({ url: null, pglite: "memory" });
});
afterAll(async () => {
  await h.close();
});

describe("weekView", () => {
  it("shows this week's Feature conditions, the qualifiers, every racing horse and a next step", async () => {
    // a Monday morning in the middle of a season
    const monday = new Date(Date.UTC(2026, 10, 9, 8, 0, 0));
    const acc = await createAccount(h.db, { stableName: "Week Stable", startingCredits: 5_000, silks: { pattern: "hoops", primary: "#1f4e9c", secondary: "#f3e7c9", cap: "#1f4e9c" }, timezone: "Europe/London", now: monday });
    const s: Session = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
    const v = await weekView(h.db, s, monday);
    expect(v.weekStartMs).toBe(monday.getTime() - 8 * 3_600_000);
    if (v.feature) {
      expect(v.feature.distanceM).toBeGreaterThan(900);
      expect(new Date(v.feature.postTimeMs).getUTCDay()).toBe(6); // Saturday
      expect(v.plate!.postTimeMs).toBeGreaterThan(v.feature.postTimeMs);
      expect(v.qualifiers.length).toBe(5);
      expect(v.qualifiers.every((q) => !q.done)).toBe(true);
    } else {
      expect(v.finalDay).not.toBeNull();
    }
    expect(v.horses.length).toBeGreaterThan(0);
    expect(v.horses.every((x) => x.status === "not_yet")).toBe(true);
    expect(v.headline.length).toBeGreaterThan(20);
    expect(v.licenceOk).toBe(false); // a new stable starts with the Club licence
  });
});
