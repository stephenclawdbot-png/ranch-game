import { describe, expect, it } from "vitest";
// The copy of settleTotePool the TotePools contract is tested against (Hardhat can't load this
// ESM package). This test proves the copy matches the original exactly, so the contract's
// randomized tests really check game-core's rules.
import { refSettle } from "../../contracts/test/toteReference";
import { settleTotePool, type TotePoolKind } from "./tote";

describe("TotePools reference copy == game-core settleTotePool", () => {
  it("gives identical settlements over random pools, dead heats and non-runners", () => {
    let state = 0x2545f491;
    const rnd = (n: number) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % n;
    };
    for (let round = 0; round < 3_000; round++) {
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
      const bets = Array.from({ length: rnd(30) }, (_, i) => ({
        id: `b${String(i).padStart(3, "0")}`,
        horseId: ids[rnd(Math.max(1, rnd(runners)))]!,
        stake: 1 + rnd(5) * rnd(1_000_000) + rnd(3) * rnd(100_000_000),
      }));
      const kind: TotePoolKind = rnd(2) === 0 ? "win" : "place";
      const permille = [0, 150, 250, 99][rnd(4)]!;
      const a = settleTotePool(kind, bets, finishers, permille);
      const b = refSettle(kind, bets, finishers, permille);
      expect(b, `round ${round}`).toEqual({
        places: a.places,
        total: a.total,
        takeout: a.takeout,
        net: a.net,
        payouts: a.payouts,
        refunds: a.refunds,
        remainder: a.remainder,
        outcome: a.outcome,
      });
    }
  });
});
