import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { keccak256, toBytes, type Hex } from "viem";
import {
  buildCommitmentBatch,
  buildMerkleTree,
  commitmentLeaf,
  hashPair,
  raceKey,
  resultLeaf,
  toBytes32,
  verifyMerkleProof,
} from "../adapter/merkle";
import { random32 } from "./helpers";

async function fixture() {
  const [admin] = await hre.viem.getWalletClients();
  const registry = await hre.viem.deployContract("RaceProofRegistry", [admin!.account.address, admin!.account.address]);
  return { registry };
}

describe("Merkle helpers (TS <-> Solidity parity)", () => {
  it("raceKey is keccak256(utf8(raceId)), including non-ASCII ids", () => {
    expect(raceKey("race-1")).to.equal(keccak256(toBytes("race-1")));
    expect(raceKey("ascot-£-🐎")).to.equal(keccak256(new TextEncoder().encode("ascot-£-🐎")));
    expect(() => raceKey("")).to.throw();
  });

  it("toBytes32 accepts engine hex (no 0x) and 0x hex, rejects anything else", () => {
    const h = "AB".repeat(32);
    expect(toBytes32(h)).to.equal(`0x${"ab".repeat(32)}`);
    expect(toBytes32(`0x${h}`)).to.equal(`0x${"ab".repeat(32)}`);
    expect(() => toBytes32("abc")).to.throw();
    expect(() => toBytes32("zz".repeat(32))).to.throw();
  });

  it("commitmentLeaf and resultLeaf hash identically in TS and Solidity (50 random cases)", async () => {
    const { registry } = await loadFixture(fixture);
    for (let i = 0; i < 50; i++) {
      const key = raceKey(`race-${i}-${random32()}`);
      const a = random32();
      const b = random32();
      expect(await registry.read.commitmentLeaf([key, a])).to.equal(commitmentLeaf(key, a));
      expect(await registry.read.resultLeaf([key, a, b])).to.equal(resultLeaf(key, a, b));
    }
  });

  it("commitment and result leaves are domain-separated", () => {
    const key = raceKey("r");
    const x = random32();
    expect(commitmentLeaf(key, x)).not.to.equal(resultLeaf(key, x, `0x${"00".repeat(32)}`));
  });

  it("hashPair is commutative", () => {
    const a = random32();
    const b = random32();
    expect(hashPair(a, b)).to.equal(hashPair(b, a));
  });

  it("tree root is independent of input order; every proof verifies off-chain", () => {
    for (const n of [1, 2, 3, 4, 7, 16, 31]) {
      const leaves = Array.from({ length: n }, () => random32());
      const t1 = buildMerkleTree(leaves);
      const t2 = buildMerkleTree([...leaves].reverse());
      expect(t1.root).to.equal(t2.root);
      for (const l of leaves) expect(verifyMerkleProof(t1.root, l, t1.proof(l))).to.equal(true);
      expect(verifyMerkleProof(t1.root, random32(), t1.proof(leaves[0]!))).to.equal(false);
    }
  });

  it("single-leaf tree: root is the leaf and the proof is empty", () => {
    const l = random32();
    const t = buildMerkleTree([l]);
    expect(t.root).to.equal(l);
    expect(t.proof(l)).to.deep.equal([]);
  });

  it("rejects empty trees, duplicate leaves, unknown leaves and duplicate races", () => {
    const l = random32();
    expect(() => buildMerkleTree([])).to.throw();
    expect(() => buildMerkleTree([l, l])).to.throw(/duplicate/);
    expect(() => buildMerkleTree([l]).proof(random32())).to.throw();
    const sc = "11".repeat(32);
    expect(() => buildCommitmentBatch([{ raceId: "x", seedCommitment: sc }, { raceId: "x", seedCommitment: sc }])).to.throw(/twice/);
  });

  it("matches a hand-computed 3-leaf tree (promotion of the odd node)", () => {
    const leaves = [random32(), random32(), random32()].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1)) as Hex[];
    const expectedRoot = hashPair(hashPair(leaves[0]!, leaves[1]!), leaves[2]!);
    const t = buildMerkleTree(leaves);
    expect(t.root).to.equal(expectedRoot);
    expect(t.proof(leaves[2]!)).to.deep.equal([hashPair(leaves[0]!, leaves[1]!)]);
  });
});
