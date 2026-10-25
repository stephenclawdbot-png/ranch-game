import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../client";
import { isDomainError } from "../errors";
import { MIGRATIONS } from "../migrations.generated";
import { migrate } from "../migrate";
import { ledgerAccounts, ledgerPostings, ledgerTransactions } from "../schema";
import { getBalance, grantCredits, ledgerHealth, playerLedgerAccountId, post, spendCredits, systemAccountId } from "../services/ledger";
import { runTx } from "../services/tx";
import { count, expectDbError, memoryDb, newPlayer, settledAll } from "./helpers";

let h: DbHandle;
beforeAll(async () => {
  h = await memoryDb();
});
afterAll(async () => {
  await h.close();
});

describe("migrations", () => {
  it("bundle matches migrations/ (run `pnpm generate` after schema changes)", () => {
    const root = join(__dirname, "../..");
    const journal = JSON.parse(readFileSync(join(root, "migrations/meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    expect(MIGRATIONS.map((m) => m.tag)).toEqual(journal.entries.map((e) => e.tag));
    for (const m of MIGRATIONS) {
      const file = readFileSync(join(root, "migrations", `${m.tag}.sql`), "utf8");
      expect(m.hash).toBe(createHash("sha256").update(file).digest("hex"));
    }
  });

  it("re-running migrate is a no-op", async () => {
    expect((await migrate(h.db)).applied).toEqual([]);
  });
});

describe("ledger", () => {
  it("a transaction can't credit twice (idempotency key), even concurrently", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    const key = `daily-goal:${p.accountId}:2026-11-02`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => grantCredits(h.db, { accountId: p.accountId, amount: 100, idempotencyKey: key, kind: "daily_goal" })),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(await getBalance(h.db, p.accountId)).toBe(100);
    expect(await count(h.db, "ledger_transactions", `idempotency_key = '${key}'`)).toBe(1);
  });

  it("reusing a key for a different kind is a conflict, not a silent success", async () => {
    const p = await newPlayer(h.db, { credits: 0 });
    await grantCredits(h.db, { accountId: p.accountId, amount: 10, idempotencyKey: `k:${p.accountId}`, kind: "daily_goal" });
    await expect(grantCredits(h.db, { accountId: p.accountId, amount: 10, idempotencyKey: `k:${p.accountId}`, kind: "purse" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("never lets a player balance go negative (service check and DB CHECK)", async () => {
    const p = await newPlayer(h.db, { credits: 300 });
    const spends = await settledAll(
      Array.from({ length: 5 }, (_, i) => spendCredits(h.db, { accountId: p.accountId, amount: 100, idempotencyKey: `spend:${p.accountId}:${i}`, kind: "training" })),
    );
    expect(spends.ok).toHaveLength(3);
    expect(spends.errors.every((e) => isDomainError(e, "INSUFFICIENT_FUNDS"))).toBe(true);
    expect(await getBalance(h.db, p.accountId)).toBe(0);

    // Bypass the service: a raw posting that overdraws is rejected by the CHECK constraint.
    const player = await playerLedgerAccountId(h.db, p.accountId);
    const burn = await systemAccountId(h.db, "burn");
    await expect(
      runTx(h.db, async (tx) => {
        const [t] = await tx.insert(ledgerTransactions).values({ idempotencyKey: `raw:${p.accountId}`, kind: "adjustment" }).returning();
        await tx.insert(ledgerPostings).values([
          { transactionId: t!.id, ledgerAccountId: player, amount: -1 },
          { transactionId: t!.id, ledgerAccountId: burn, amount: 1 },
        ]);
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("rejects unbalanced transactions at commit and direct balance edits", async () => {
    const p = await newPlayer(h.db, { credits: 100 });
    const player = await playerLedgerAccountId(h.db, p.accountId);
    const mint = await systemAccountId(h.db, "mint");
    await expect(post(h.db, { idempotencyKey: "x", kind: "adjustment", postings: [{ ledgerAccountId: player, amount: 5 }, { ledgerAccountId: mint, amount: -4 }] })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    // Raw single-sided posting: the deferred constraint trigger refuses the commit.
    await expect(
      h.db.transaction(async (tx) => {
        const [t] = await tx.insert(ledgerTransactions).values({ idempotencyKey: `one-sided:${p.accountId}`, kind: "adjustment" }).returning();
        await tx.insert(ledgerPostings).values({ transactionId: t!.id, ledgerAccountId: player, amount: 1_000_000 });
      }),
    ).rejects.toThrow();
    // Balances only move through postings.
    await expectDbError(h.db.update(ledgerAccounts).set({ balance: 1_000_000 }).where(eq(ledgerAccounts.id, player)), /only through postings/);
    // Postings are append-only.
    await expectDbError(h.db.update(ledgerPostings).set({ amount: 1 }).where(eq(ledgerPostings.ledgerAccountId, player)), /append-only/);
    await expectDbError(h.db.delete(ledgerPostings).where(eq(ledgerPostings.ledgerAccountId, player)), /append-only/);
    expect(await getBalance(h.db, p.accountId)).toBe(100);
  });

  it("always balances: sum of all postings is 0, no drift, no negative accounts", async () => {
    const health = await ledgerHealth(h.db);
    expect(health.totalPostings).toBe(0);
    expect(health.unbalancedTransactions).toEqual([]);
    expect(health.driftedAccounts).toEqual([]);
    expect(health.negativeAccounts).toEqual([]);
    const [neg] = await h.db.select({ n: sql<number>`count(*)::int` }).from(ledgerAccounts).where(sql`kind = 'player' and balance < 0`);
    expect(Number(neg!.n)).toBe(0);
  });
});
