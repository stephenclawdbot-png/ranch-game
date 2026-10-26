import { describe, expect, it } from "vitest";
import { buildPoolEpoch, poolLeaf, vestedAmount, verifyProof } from "./pool";

// Same vector as packages/contracts/test/prize-pool.test.ts (POOL_GOLDEN_LEAF_HASH), which the
// contracts test also checks against PrizePool.leafHash semantics: byte parity web <-> chain.
const GOLDEN = "0xfa8c956530fbc1466e1d11bb33c762dd5dbea02cccc6cfcbe8b2b4c29edd3d79";

describe("Prize Pool leaves (web copy)", () => {
  it("matches the contracts package golden vector", () => {
    expect(
      poolLeaf(46630, "0x00000000000000000000000000000000000000a1", 7n, { account: "0x00000000000000000000000000000000000000b2", amount: 123456789n, vestStart: 1_700_000_000n, vestEnd: 1_701_209_600n }),
    ).toBe(GOLDEN);
  });

  it("builds trees whose proofs verify for 1..17 leaves", () => {
    for (let n = 1; n <= 17; n++) {
      const allocs = Array.from({ length: n }, (_, i) => ({ account: `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`, amount: BigInt(i + 1), vestStart: 1n, vestEnd: 2n }));
      const t = buildPoolEpoch(31337, "0x00000000000000000000000000000000000000a1", 1n, allocs);
      expect(t.total).toBe(BigInt((n * (n + 1)) / 2));
      for (const e of t.entries) expect(verifyProof(t.root, e.leaf, e.proof)).toBe(true);
    }
    expect(() => buildPoolEpoch(1, "0x00000000000000000000000000000000000000a1", 1n, [
      { account: "0x00000000000000000000000000000000000000b2", amount: 1n, vestStart: 0n, vestEnd: 1n },
      { account: "0x00000000000000000000000000000000000000B2", amount: 2n, vestStart: 0n, vestEnd: 1n },
    ])).toThrow();
  });

  it("vests linearly", () => {
    expect(vestedAmount(1000n, 100n, 200n, 50n)).toBe(0n);
    expect(vestedAmount(1000n, 100n, 200n, 150n)).toBe(500n);
    expect(vestedAmount(1000n, 100n, 200n, 999n)).toBe(1000n);
  });
});
