import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { EMPTY_LEDGER, SYSTEM, balanceOf, checkLedger, escrowTx, grantTx, player, post, refundTx, settleSaleTx, spendTx, studFeeTx, type Ledger } from "./ledger";
import type { LedgerTx } from "./types";

describe("ledger", () => {
  it("posts balanced transactions and refuses unbalanced / overdrawn ones", () => {
    let l: Ledger = EMPTY_LEDGER;
    const g = post(l, grantTx("starter_grant", SYSTEM.grants, "alice", 1000, "grant:alice", 1));
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    l = g.ledger;
    expect(balanceOf(l, player("alice"))).toBe(1000);
    const bad: LedgerTx = { id: "x", idempotencyKey: "x", kind: "adjustment", atMs: 1, postings: [{ account: player("alice"), amount: -5 }, { account: SYSTEM.burn, amount: 4 }] };
    expect(post(l, bad)).toMatchObject({ ok: false, error: "unbalanced" });
    expect(post(l, spendTx("training", SYSTEM.training, "alice", 1001, "t1", 2))).toMatchObject({ ok: false, error: "insufficient_funds" });
    expect(post(l, spendTx("training", SYSTEM.training, "alice", 60, "t2", 2)).ok).toBe(true);
  });

  it("idempotency: replays are no-ops, key reuse with different content is refused", () => {
    const tx = grantTx("purse", SYSTEM.purses, "bob", 500, "purse:r1:bob", 10);
    const a = post(EMPTY_LEDGER, tx);
    if (!a.ok) throw new Error();
    const b = post(a.ledger, tx);
    expect(b).toMatchObject({ ok: true, applied: false });
    if (b.ok) expect(b.ledger).toBe(a.ledger);
    expect(post(a.ledger, grantTx("purse", SYSTEM.purses, "bob", 501, "purse:r1:bob", 10))).toMatchObject({ ok: false, error: "idempotency_conflict" });
  });

  it("market sale burns 5% and stud fee burns 10%", () => {
    let l: Ledger = EMPTY_LEDGER;
    for (const t of [grantTx("starter_grant", SYSTEM.grants, "buyer", 10_000, "g1", 1), escrowTx("buyer", "L1", 2000, "e1", 2), settleSaleTx("seller", "L1", 2000, 50, "s1", 3), studFeeTx("buyer", "seller", 1000, 100, "sf1", 4)]) {
      const r = post(l, t);
      if (!r.ok) throw new Error(r.error);
      l = r.ledger;
    }
    expect(balanceOf(l, player("seller"))).toBe(1900 + 900);
    expect(balanceOf(l, SYSTEM.burn)).toBe(100 + 100);
    expect(balanceOf(l, "escrow:L1")).toBe(0);
    expect(checkLedger(l).ok).toBe(true);
  });

  it("property: any sequence of operations keeps every invariant", () => {
    const players = ["a", "b", "c"];
    const op = fc.oneof(
      fc.record({ k: fc.constant("grant" as const), p: fc.constantFrom(...players), n: fc.integer({ min: 1, max: 5000 }) }),
      fc.record({ k: fc.constant("spend" as const), p: fc.constantFrom(...players), n: fc.integer({ min: 1, max: 5000 }) }),
      fc.record({ k: fc.constant("stud" as const), p: fc.constantFrom(...players), q: fc.constantFrom(...players), n: fc.integer({ min: 1, max: 3000 }) }),
      fc.record({ k: fc.constant("sale" as const), p: fc.constantFrom(...players), q: fc.constantFrom(...players), n: fc.integer({ min: 1, max: 3000 }), refund: fc.boolean() }),
      fc.record({ k: fc.constant("replay" as const), i: fc.nat() }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        let l: Ledger = EMPTY_LEDGER;
        const posted: LedgerTx[] = [];
        ops.forEach((o, i) => {
          const txs: LedgerTx[] = [];
          if (o.k === "grant") txs.push(grantTx("daily_goal", SYSTEM.dailyGoals, o.p, o.n, `g${i}`, i));
          if (o.k === "spend") txs.push(spendTx("training", SYSTEM.training, o.p, o.n, `s${i}`, i));
          if (o.k === "stud" && o.p !== o.q) txs.push(studFeeTx(o.p, o.q, o.n, 100, `f${i}`, i));
          if (o.k === "sale" && o.p !== o.q) {
            txs.push(escrowTx(o.p, `L${i}`, o.n, `e${i}`, i));
            txs.push(o.refund ? refundTx(o.p, `L${i}`, o.n, `r${i}`, i) : settleSaleTx(o.q, `L${i}`, o.n, 50, `x${i}`, i));
          }
          if (o.k === "replay" && posted.length) txs.push(posted[o.i % posted.length]!);
          for (const t of txs) {
            const before = l;
            const r = post(l, t);
            if (r.ok) {
              l = r.ledger;
              if (r.applied) posted.push(t);
            } else expect(l).toBe(before);
          }
        });
        const c = checkLedger(l);
        expect(c.problems).toEqual([]);
        for (const [acc, bal] of Object.entries(l.balances)) if (!acc.startsWith("system:")) expect(bal).toBeGreaterThanOrEqual(0);
        expect(Object.values(l.balances).reduce((a, b) => a + b, 0)).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
