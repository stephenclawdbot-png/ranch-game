import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { hashToken } from "../crypto";
import { accounts } from "../schema";
import { authenticate, verifyEmail } from "../services/accounts";
import { getBalance } from "../services/ledger";
import { listStableHorses } from "../services/horses";
import { memoryDb, newPlayer } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

describe("accounts", () => {
  it("creates an anonymous device account with stable, starter credits and horses atomically", async () => {
    const p = await newPlayer(h.db, { starters: 3, credits: 5_000 });
    expect(p.token.length).toBeGreaterThanOrEqual(43);
    const [row] = await h.db.select().from(accounts).where(eq(accounts.id, p.accountId));
    expect(row!.tokenHash).toBe(hashToken(p.token));
    expect(row!.tokenHash).not.toContain(p.token);
    expect(await getBalance(h.db, p.accountId)).toBe(5_000);
    const horses = await listStableHorses(h.db, p.stableId);
    expect(horses).toHaveLength(3);
    expect(horses.every((x) => x.bound && x.origin === "starter" && x.stage === "juvenile")).toBe(true);
    const auth = await authenticate(h.db, p.token);
    expect(auth).toMatchObject({ accountId: p.accountId, stable: { id: p.stableId } });
    expect(await authenticate(h.db, "not-a-token")).toBeNull();
  });

  it("an email can verify only one account", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    await verifyEmail(h.db, { accountId: a.accountId, email: "Owner@Example.com" });
    await expect(verifyEmail(h.db, { accountId: b.accountId, email: "owner@example.com" })).rejects.toThrow();
  });
});
