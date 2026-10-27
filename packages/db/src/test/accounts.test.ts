import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { hashToken, sha256Hex } from "../crypto";
import { accountLinks, accounts, fraudEvents } from "../schema";
import { areLinked, authenticate, recordAccountSignal, verifyEmail } from "../services/accounts";
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

  it("flags a NEW shared signal once, not one fraud event per call", async () => {
    const a = await newPlayer(h.db);
    const b = await newPlayer(h.db);
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "wallet", value: "0xwallet" }); // no pair yet
    // First contact: one account_link fraud event, and the pair is linked.
    expect(await recordAccountSignal(h.db, { accountId: b.accountId, kind: "wallet", value: "0xwallet" })).toEqual([a.accountId]);
    expect(await areLinked(h.db, a.accountId, b.accountId)).toBe(true);
    const eventsFor = (id: string) =>
      h.db
        .select()
        .from(fraudEvents)
        .where(eq(fraudEvents.accountId, id))
        .then((rows) => rows.filter((r) => r.kind === "account_link" && r.relatedAccountId === (id === a.accountId ? b.accountId : a.accountId)));
    expect((await eventsFor(b.accountId)).length).toBe(1); // the pair is flagged once
    expect((await eventsFor(a.accountId)).length).toBe(0); // a recorded before b existed as a link
    // Every later repeat from the same side is the same fact: no new events.
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "wallet", value: "0xwallet" });
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "wallet", value: "0xwallet" });
    expect((await eventsFor(b.accountId)).length).toBe(1);
    // a's own later signal makes the (a, b) fact once — and repeats don't pile up either.
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "wallet", value: "0xwallet" });
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "wallet", value: "0xwallet" });
    expect((await eventsFor(a.accountId)).length).toBe(1);
    // A different signal kind for the same pair is a new fact: flagged once, from whichever
    // side records it second.
    await recordAccountSignal(h.db, { accountId: b.accountId, kind: "email", value: "same@example.com" });
    expect((await eventsFor(b.accountId)).length).toBe(1); // b was first with this email: no pair yet
    await recordAccountSignal(h.db, { accountId: a.accountId, kind: "email", value: "same@example.com" });
    expect((await eventsFor(a.accountId)).length).toBe(2);
    expect((await eventsFor(b.accountId)).length).toBe(1);
    // And the link table stays one row per (account, kind, value).
    const links = (await h.db.select().from(accountLinks)).filter((r) => r.kind === "wallet" && r.valueHash === sha256Hex("wallet:0xwallet"));
    expect(links).toHaveLength(2); // a and b, one each
  });
});
