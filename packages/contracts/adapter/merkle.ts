import { concat, encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

// Merkle batching for race fairness proofs. MUST stay byte-for-byte identical to
// contracts/RaceProofRegistry.sol (commitmentLeaf / resultLeaf) and to OpenZeppelin's
// MerkleProof (commutative keccak256 pair hashing). test/merkle.test.ts checks both.

export const KIND_COMMITMENT = 1 as const;
export const KIND_RESULT = 2 as const;
export type ProofKind = typeof KIND_COMMITMENT | typeof KIND_RESULT;

/** keccak256 of the UTF-8 race id. The game's race ids are strings; on-chain we use 32 bytes. */
export function raceKey(raceId: string): Hex {
  if (raceId.length === 0) throw new Error("raceId must be non-empty");
  return keccak256(toBytes(raceId));
}

/** Accepts the racing engine's lowercase hex (no 0x) or 0x-prefixed hex; returns 0x + 64 lowercase hex. */
export function toBytes32(value: string): Hex {
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`expected 32-byte hex, got "${value}"`);
  return `0x${hex.toLowerCase()}`;
}

const leafTypesCommitment = [{ type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }] as const;
const leafTypesResult = [{ type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }] as const;

/** keccak256(keccak256(abi.encode(uint8 1, raceKey, seedCommitment))) */
export function commitmentLeaf(key: Hex, seedCommitment: string): Hex {
  const inner = keccak256(encodeAbiParameters(leafTypesCommitment, [KIND_COMMITMENT, toBytes32(key), toBytes32(seedCommitment)]));
  return keccak256(inner);
}

/** keccak256(keccak256(abi.encode(uint8 2, raceKey, resultHash, revealedSeed))) */
export function resultLeaf(key: Hex, resultHash: string, revealedSeed: string): Hex {
  const inner = keccak256(
    encodeAbiParameters(leafTypesResult, [KIND_RESULT, toBytes32(key), toBytes32(resultHash), toBytes32(revealedSeed)]),
  );
  return keccak256(inner);
}

/** OpenZeppelin Hashes.commutativeKeccak256: hash the two words in ascending numeric order. */
export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export interface MerkleTree {
  readonly root: Hex;
  /** Sorted, unique leaf hashes (the tree's bottom layer). */
  readonly leaves: readonly Hex[];
  proof(leaf: Hex): Hex[];
}

/**
 * Builds a tree compatible with OZ MerkleProof.verify. Leaves are sorted (so the root is
 * independent of input order) and duplicates are rejected. A node without a sibling is
 * promoted unchanged, and its proof simply skips that level.
 */
export function buildMerkleTree(leafHashes: readonly Hex[]): MerkleTree {
  if (leafHashes.length === 0) throw new Error("cannot build a Merkle tree with no leaves");
  const sorted = leafHashes.map((l) => toBytes32(l)).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) throw new Error(`duplicate leaf ${sorted[i]}`);
  }
  const layers: Hex[][] = [sorted];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i]!, prev[i + 1]!) : prev[i]!);
    }
    layers.push(next);
  }
  const index = new Map(sorted.map((l, i) => [l, i] as const));
  return {
    root: layers[layers.length - 1]![0]!,
    leaves: sorted,
    proof(leaf: Hex): Hex[] {
      let idx = index.get(toBytes32(leaf));
      if (idx === undefined) throw new Error(`leaf ${leaf} is not in the tree`);
      const out: Hex[] = [];
      for (let level = 0; level < layers.length - 1; level++) {
        const layer = layers[level]!;
        const sibling = idx ^ 1;
        if (sibling < layer.length) out.push(layer[sibling]!);
        idx >>= 1;
      }
      return out;
    },
  };
}

/** Off-chain equivalent of MerkleProof.verify. */
export function verifyMerkleProof(root: Hex, leaf: Hex, proof: readonly Hex[]): boolean {
  let computed = toBytes32(leaf);
  for (const p of proof) computed = hashPair(computed, toBytes32(p));
  return computed === toBytes32(root);
}

// ------------------------------------------------------------------ batch builders

export interface CommitmentInput {
  raceId: string;
  /** racing-engine `commitSeed(seed)`: sha256(seed bytes), hex. */
  seedCommitment: string;
}
export interface ResultInput {
  raceId: string;
  /** racing-engine `replay.result.resultHash`, hex. */
  resultHash: string;
  /** The revealed 32-byte seed, hex. sha256(seed) must equal the published commitment. */
  revealedSeed: string;
}

export interface BatchEntry {
  raceId: string;
  raceKey: Hex;
  leaf: Hex;
  proof: Hex[];
}
export interface ProofBatch<T> {
  kind: ProofKind;
  root: Hex;
  leafCount: number;
  entries: (T & BatchEntry)[];
}

function assertUniqueRaces(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`race ${id} appears twice in one batch`);
    seen.add(id);
  }
}

export function buildCommitmentBatch(items: readonly CommitmentInput[]): ProofBatch<CommitmentInput> {
  assertUniqueRaces(items.map((i) => i.raceId));
  const withLeaves = items.map((i) => {
    const key = raceKey(i.raceId);
    return { ...i, raceKey: key, leaf: commitmentLeaf(key, i.seedCommitment) };
  });
  const tree = buildMerkleTree(withLeaves.map((e) => e.leaf));
  return {
    kind: KIND_COMMITMENT,
    root: tree.root,
    leafCount: withLeaves.length,
    entries: withLeaves.map((e) => ({ ...e, proof: tree.proof(e.leaf) })),
  };
}

export function buildResultBatch(items: readonly ResultInput[]): ProofBatch<ResultInput> {
  assertUniqueRaces(items.map((i) => i.raceId));
  const withLeaves = items.map((i) => {
    const key = raceKey(i.raceId);
    return { ...i, raceKey: key, leaf: resultLeaf(key, i.resultHash, i.revealedSeed) };
  });
  const tree = buildMerkleTree(withLeaves.map((e) => e.leaf));
  return {
    kind: KIND_RESULT,
    root: tree.root,
    leafCount: withLeaves.length,
    entries: withLeaves.map((e) => ({ ...e, proof: tree.proof(e.leaf) })),
  };
}
