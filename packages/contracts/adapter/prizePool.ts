import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { buildMerkleTree } from "./merkle";

// PrizePool allocation leaves. MUST match PrizePool.leafHash:
//   keccak256(keccak256(abi.encode(uint8 3, chainid, pool, epochId, account, amount, vestStart, vestEnd)))
// Tested against the contract in test/prize-pool.test.ts. The web app's copy
// (apps/web/src/lib/chain/pool.ts) is checked against the same golden vector.

export const POOL_LEAF_KIND = 3 as const;

export interface PoolAllocation {
  account: Address;
  /** wei */
  amount: bigint;
  /** unix seconds */
  vestStart: bigint;
  vestEnd: bigint;
}

const leafTypes = [
  { type: "uint8" },
  { type: "uint256" },
  { type: "address" },
  { type: "uint64" },
  { type: "address" },
  { type: "uint256" },
  { type: "uint64" },
  { type: "uint64" },
] as const;

export function poolLeaf(chainId: number, pool: Address, epochId: bigint, a: PoolAllocation): Hex {
  return keccak256(keccak256(encodeAbiParameters(leafTypes, [POOL_LEAF_KIND, BigInt(chainId), pool, epochId, a.account, a.amount, a.vestStart, a.vestEnd])));
}

export interface PoolEpochTree {
  root: Hex;
  total: bigint;
  leafCount: number;
  entries: (PoolAllocation & { leaf: Hex; proof: Hex[] })[];
}

/** One leaf per account (duplicates rejected); total = sum of amounts. */
export function buildPoolEpoch(chainId: number, pool: Address, epochId: bigint, allocations: readonly PoolAllocation[]): PoolEpochTree {
  const seen = new Set<string>();
  for (const a of allocations) {
    const k = a.account.toLowerCase();
    if (seen.has(k)) throw new Error(`account ${a.account} appears twice in epoch ${epochId}`);
    if (a.amount <= 0n) throw new Error("allocation amounts must be positive");
    if (a.vestEnd < a.vestStart) throw new Error("vestEnd must be >= vestStart");
    seen.add(k);
  }
  const withLeaves = allocations.map((a) => ({ ...a, leaf: poolLeaf(chainId, pool, epochId, a) }));
  const tree = buildMerkleTree(withLeaves.map((e) => e.leaf));
  return {
    root: tree.root,
    total: allocations.reduce((s, a) => s + a.amount, 0n),
    leafCount: allocations.length,
    entries: withLeaves.map((e) => ({ ...e, proof: tree.proof(e.leaf) })),
  };
}

/** Mirror of PrizePool.vestedAmount (floor division). */
export function vestedAmount(amount: bigint, vestStart: bigint, vestEnd: bigint, at: bigint): bigint {
  if (at >= vestEnd) return amount;
  if (at <= vestStart) return 0n;
  return (amount * (at - vestStart)) / (vestEnd - vestStart);
}
