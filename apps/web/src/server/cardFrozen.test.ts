/** Preview deployments share production's database: they must never drive the race card. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardFrozen, driveCard, settleIfDue } from "./game";
import type { Db } from "./db";

afterEach(() => vi.unstubAllEnvs());

describe("preview deployments don't drive the card", () => {
  it("freezes card writes on a preview unless PREVIEW_DRIVES_CARD=1", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(cardFrozen()).toBe(true);
    // never touches the database: a db that throws on use proves it
    const db = new Proxy({}, { get: () => { throw new Error("touched the database"); } }) as unknown as Db;
    expect(await driveCard(db, new Date(), { force: true })).toBeNull();
    expect(await settleIfDue(db, "00000000-0000-0000-0000-000000000000", new Date())).toBe(false);
    vi.stubEnv("PREVIEW_DRIVES_CARD", "1");
    expect(cardFrozen()).toBe(false);
  });

  it("production and local runs drive the card", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(cardFrozen()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "");
    expect(cardFrozen()).toBe(false);
  });
});
