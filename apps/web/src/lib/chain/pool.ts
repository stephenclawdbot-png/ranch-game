/**
 * PrizePool allocation leaves and Merkle trees (client + server). MUST match
 * PrizePool.leafHash and OpenZeppelin MerkleProof (commutative keccak pairs):
 *   leaf = keccak256(keccak256(abi.encode(uint8 3, chainid, pool, epochId, account, amount, vestStart, vestEnd)))
 * pool.test.ts checks the golden vector shared with packages/contracts/test/prize-pool.test.ts,
 * and the chain e2e test claims on-chain with these proofs.
 */
import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { POOL_LEAF_KIND } from "./contracts.generated";

export interface PoolAllocation {
  account: Address;
  amount: bigint;
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

function norm(h: Hex): Hex {
  return h.toLowerCase() as Hex;
}

export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** Sorted leaves, odd node promoted (same as packages/contracts/adapter/merkle.ts). */
export function merkle(leaves: readonly Hex[]): { root: Hex; proof: (leaf: Hex) => Hex[] } {
  if (!leaves.length) throw new Error("empty tree");
  const sorted = leaves.map(norm).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) throw new Error("duplicate leaf");
  const layers: Hex[][] = [sorted];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i]!, prev[i + 1]!) : prev[i]!);
    layers.push(next);
  }
  const index = new Map(sorted.map((l, i) => [l, i] as const));
  return {
    root: layers[layers.length - 1]![0]!,
    proof(leaf: Hex) {
      let idx = index.get(norm(leaf));
      if (idx === undefined) throw new Error("leaf not in tree");
      const out: Hex[] = [];
      for (let level = 0; level < layers.length - 1; level++) {
        const sib = idx ^ 1;
        if (sib < layers[level]!.length) out.push(layers[level]![sib]!);
        idx >>= 1;
      }
      return out;
    },
  };
}

export function verifyProof(root: Hex, leaf: Hex, proof: readonly Hex[]): boolean {
  let h = norm(leaf);
  for (const p of proof) h = hashPair(h, norm(p));
  return h === norm(root);
}

export interface PoolEpochTree {
  root: Hex;
  total: bigint;
  entries: (PoolAllocation & { leaf: Hex; proof: Hex[] })[];
}

export function buildPoolEpoch(chainId: number, pool: Address, epochId: bigint, allocations: readonly PoolAllocation[]): PoolEpochTree {
  const seen = new Set<string>();
  for (const a of allocations) {
    if (seen.has(a.account.toLowerCase())) throw new Error(`duplicate account ${a.account}`);
    if (a.amount <= 0n || a.vestEnd < a.vestStart) throw new Error("bad allocation");
    seen.add(a.account.toLowerCase());
  }
  const withLeaves = allocations.map((a) => ({ ...a, leaf: poolLeaf(chainId, pool, epochId, a) }));
  const tree = merkle(withLeaves.map((e) => e.leaf));
  return { root: tree.root, total: allocations.reduce((s, a) => s + a.amount, 0n), entries: withLeaves.map((e) => ({ ...e, proof: tree.proof(e.leaf) })) };
}

/** Mirror of PrizePool.vestedAmount. */
export function vestedAmount(amount: bigint, vestStart: bigint, vestEnd: bigint, at: bigint): bigint {
  if (at >= vestEnd) return amount;
  if (at <= vestStart) return 0n;
  return (amount * (at - vestStart)) / (vestEnd - vestStart);
}
