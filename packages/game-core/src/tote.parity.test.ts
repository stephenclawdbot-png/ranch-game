import { describe, expect, it } from "vitest";
// The copy of settleTotePool the TotePools contract is tested against (Hardhat can't load this
// ESM package). This test proves the copy matches the original exactly, so the contract's
// randomized tests really check game-core's rules.
import { refSettle } from "../../contracts/test/toteReference";
import { settleTotePool, type TotePoolKind } from "./tote";

describe("TotePools reference copy == game-core settleTotePool", () => {
  it("gives identical settlements over random pools, dead heats, non-runners, thin pools and heavy favourites", () => {
    let state = 0x2545f491;
    const rnd = (n: number) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % n;
    };
    const seen = { thin: 0, cut: 0, paid: 0, noWinner: 0 };
    for (let round = 0; round < 4_000; round++) {
      const runners = 2 + rnd(23);
      const ids = Array.from({ length: runners }, (_, i) => `h${String(i).padStart(2, "0")}`);
      const finishers: { horseId: string; position: number }[] = [];
      let rank = 0;
      let prev = 0;
      for (const id of [...ids].sort(() => rnd(3) - 1)) {
        if (rnd(8) === 0) continue; // non-runner
        rank++;
        const position = rank > 1 && rnd(5) === 0 ? prev : rank;
        finishers.push({ horseId: id, position });
        prev = position;
      }
      // Few bettors often (thin pools), and sometimes one runner carrying most of the money.
      const bettors = 1 + rnd(rnd(4) === 0 ? 2 : 12);
      const favourite = ids[rnd(runners)]!;
      const bets = Array.from({ length: rnd(rnd(3) === 0 ? 3 : 30) }, (_, i) => {
        const heavy = rnd(4) === 0;
        return {
          id: `b${String(i).padStart(3, "0")}`,
          bettor: `w${rnd(bettors)}`,
          horseId: heavy ? favourite : ids[rnd(Math.max(1, rnd(runners)))]!,
          stake: heavy ? 1 + rnd(1_000_000_000) : 1 + rnd(5) * rnd(1_000_000) + rnd(3) * rnd(100_000_000),
        };
      });
      const kind: TotePoolKind = rnd(2) === 0 ? "win" : "place";
      const permille = [0, 150, 250, 99][rnd(4)]!;
      const a = settleTotePool(kind, bets, finishers, permille);
      const b = refSettle(kind, bets, finishers, permille);
      expect(b, `round ${round}`).toEqual({
        places: a.places,
        total: a.total,
        takeout: a.takeout,
        standardTakeout: a.standardTakeout,
        net: a.net,
        payouts: a.payouts,
        refunds: a.refunds,
        remainder: a.remainder,
        outcome: a.outcome,
        voidReason: a.voidReason,
      });
      // Winners never lose.
      const stakeOf = new Map(bets.map((x) => [x.id, x.stake]));
      if (a.outcome === "paid") for (const d of a.dividends) expect(d.amount).toBeGreaterThanOrEqual(d.stake);
      if (a.outcome === "paid") {
        const winners = new Set(a.dividends.map((d) => d.horseId));
        for (const x of bets) if (winners.has(x.horseId)) expect(a.payouts.find((p) => p.betId === x.id)?.amount ?? 0).toBeGreaterThanOrEqual(stakeOf.get(x.id)!);
      }
      if (a.voidReason === "thin_pool") seen.thin++;
      if (a.takeout < a.standardTakeout) seen.cut++;
      if (a.outcome === "paid") seen.paid++;
      if (a.outcome === "no_winner") seen.noWinner++;
      expect(a.voidReason).not.toBe("winners_short");
    }
    // The random pools really exercise every branch.
    expect(seen.thin).toBeGreaterThan(100);
    expect(seen.cut).toBeGreaterThan(20);
    expect(seen.paid).toBeGreaterThan(500);
    expect(seen.noWinner).toBeGreaterThan(50);
  });
});
