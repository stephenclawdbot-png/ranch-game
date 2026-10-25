import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress, keccak256, toBytes, type Hex } from "viem";
import { buildCommitmentBatch, buildResultBatch, KIND_COMMITMENT, KIND_RESULT, raceKey, toBytes32 } from "../adapter/merkle";
import { engineCommitSeed, expectRevert, random32, ZERO_ADDRESS } from "./helpers";

const PUBLISHER_ROLE = keccak256(toBytes("PUBLISHER_ROLE"));

async function fixture() {
  const [admin, publisher, stranger] = await hre.viem.getWalletClients();
  const registry = await hre.viem.deployContract("RaceProofRegistry", [admin!.account.address, publisher!.account.address]);
  const asPublisher = await hre.viem.getContractAt("RaceProofRegistry", registry.address, { client: { wallet: publisher! } });
  const asStranger = await hre.viem.getContractAt("RaceProofRegistry", registry.address, { client: { wallet: stranger! } });
  const publicClient = await hre.viem.getPublicClient();
  return { registry, asPublisher, asStranger, admin: admin!, publisher: publisher!, stranger: stranger!, publicClient };
}

/** Simulated races with real engine-format seeds/commitments. */
function races(n: number, prefix = "race") {
  return Array.from({ length: n }, (_, i) => {
    const seed = random32().slice(2); // engine seeds are 64 lowercase hex chars
    return { raceId: `${prefix}-${i}`, seed, seedCommitment: engineCommitSeed(seed), resultHash: random32().slice(2) };
  });
}

describe("RaceProofRegistry", () => {
  describe("publishing", () => {
    it("stores the root once per (kind, batchId) and emits BatchPublished", async () => {
      const { registry, asPublisher, publicClient } = await loadFixture(fixture);
      const batch = buildCommitmentBatch(races(5));
      const hash = await asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, batch.root, batch.leafCount, "ipfs://manifest-1"]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const stored = await registry.read.getBatch([KIND_COMMITMENT, 1n]);
      expect(stored.root).to.equal(batch.root);
      expect(stored.leafCount).to.equal(5);
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      expect(stored.publishedAt).to.equal(block.timestamp);

      const events = await registry.getEvents.BatchPublished({}, { fromBlock: receipt.blockNumber });
      expect(events).to.have.length(1);
      expect(events[0]!.args).to.deep.include({ kind: KIND_COMMITMENT, batchId: 1n, root: batch.root, leafCount: 5, manifestURI: "ipfs://manifest-1" });
      // Gas is constant in the number of races: one storage slot pair per batch.
      console.log(`      publishBatch gas: ${receipt.gasUsed}`);
    });

    it("rejects re-publishing a batch id (roots are immutable)", async () => {
      const { asPublisher } = await loadFixture(fixture);
      const a = buildCommitmentBatch(races(2, "a"));
      const b = buildCommitmentBatch(races(2, "b"));
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 7n, a.root, 2, ""]);
      await expectRevert(asPublisher.write.publishBatch([KIND_COMMITMENT, 7n, b.root, 2, ""]), "BatchAlreadyPublished");
      await expectRevert(asPublisher.write.publishBatch([KIND_COMMITMENT, 7n, a.root, 2, ""]), "BatchAlreadyPublished");
      // The same id under the other kind is a different slot.
      await asPublisher.write.publishBatch([KIND_RESULT, 7n, b.root, 2, ""]);
    });

    it("validates kind, root and leafCount", async () => {
      const { asPublisher } = await loadFixture(fixture);
      const root = random32();
      await expectRevert(asPublisher.write.publishBatch([0, 1n, root, 1, ""]), "InvalidKind");
      await expectRevert(asPublisher.write.publishBatch([3, 1n, root, 1, ""]), "InvalidKind");
      await expectRevert(asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, `0x${"00".repeat(32)}`, 1, ""]), "EmptyRoot");
      await expectRevert(asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, root, 0, ""]), "EmptyBatch");
    });

    it("only PUBLISHER_ROLE can publish; admin can rotate the publisher", async () => {
      const { registry, asStranger, asPublisher, stranger, publisher } = await loadFixture(fixture);
      await expectRevert(asStranger.write.publishBatch([KIND_COMMITMENT, 1n, random32(), 1, ""]), "AccessControlUnauthorizedAccount");
      // admin rotates the hot key
      await registry.write.grantRole([PUBLISHER_ROLE, stranger.account.address]);
      await registry.write.revokeRole([PUBLISHER_ROLE, publisher.account.address]);
      await asStranger.write.publishBatch([KIND_COMMITMENT, 1n, random32(), 1, ""]);
      await expectRevert(asPublisher.write.publishBatch([KIND_COMMITMENT, 2n, random32(), 1, ""]), "AccessControlUnauthorizedAccount");
    });

    it("rejects zero addresses in the constructor", async () => {
      const [admin] = await hre.viem.getWalletClients();
      await expectRevert(hre.viem.deployContract("RaceProofRegistry", [ZERO_ADDRESS, admin!.account.address]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("RaceProofRegistry", [admin!.account.address, ZERO_ADDRESS]), "ZeroAddress");
    });
  });

  describe("pausing", () => {
    it("pause blocks publishing but not verification; only admin unpauses", async () => {
      const { registry, asPublisher, asStranger } = await loadFixture(fixture);
      const batch = buildCommitmentBatch(races(3));
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, batch.root, 3, ""]);
      await expectRevert(asStranger.write.pause(), "AccessControlUnauthorizedAccount");
      await registry.write.pause();
      await expectRevert(asPublisher.write.publishBatch([KIND_COMMITMENT, 2n, random32(), 1, ""]), "EnforcedPause");
      const e = batch.entries[0]!;
      expect(await registry.read.verifyCommitment([1n, e.raceKey, toBytes32(e.seedCommitment), e.proof])).to.equal(true);
      await expectRevert(asPublisher.write.unpause(), "AccessControlUnauthorizedAccount");
      await registry.write.unpause();
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 2n, random32(), 1, ""]);
    });
  });

  describe("verification", () => {
    it("verifies every race in batches of many sizes (incl. odd sizes and a single leaf)", async () => {
      const { registry, asPublisher } = await loadFixture(fixture);
      let id = 100n;
      for (const n of [1, 2, 3, 5, 8, 13, 33]) {
        const batch = buildCommitmentBatch(races(n, `n${n}`));
        await asPublisher.write.publishBatch([KIND_COMMITMENT, ++id, batch.root, batch.leafCount, ""]);
        for (const e of batch.entries) {
          expect(await registry.read.verifyCommitment([id, e.raceKey, toBytes32(e.seedCommitment), e.proof])).to.equal(true);
        }
      }
    });

    it("rejects wrong commitment, wrong race, tampered proof, wrong batch, unknown batch, wrong kind", async () => {
      const { registry, asPublisher } = await loadFixture(fixture);
      const rs = races(6);
      const commit = buildCommitmentBatch(rs);
      const other = buildCommitmentBatch(races(6, "other"));
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, commit.root, 6, ""]);
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 2n, other.root, 6, ""]);
      const e = commit.entries[2]!;
      const sc = toBytes32(e.seedCommitment);
      expect(await registry.read.verifyCommitment([1n, e.raceKey, sc, e.proof])).to.equal(true);
      expect(await registry.read.verifyCommitment([1n, e.raceKey, random32(), e.proof])).to.equal(false);
      expect(await registry.read.verifyCommitment([1n, raceKey("race-999"), sc, e.proof])).to.equal(false);
      const tampered = [...e.proof] as Hex[];
      tampered[0] = random32();
      expect(await registry.read.verifyCommitment([1n, e.raceKey, sc, tampered])).to.equal(false);
      expect(await registry.read.verifyCommitment([1n, e.raceKey, sc, []])).to.equal(false);
      expect(await registry.read.verifyCommitment([2n, e.raceKey, sc, e.proof])).to.equal(false);
      expect(await registry.read.verifyCommitment([99n, e.raceKey, sc, e.proof])).to.equal(false);
      // Domain separation: a commitment root never verifies a result-shaped claim.
      expect(await registry.read.verifyResult([1n, e.raceKey, sc, sc, e.proof])).to.equal(false);
    });

    it("verifyRace checks both inclusions, sha256(seed) == commitment, and commit-before-result order", async () => {
      const { registry, asPublisher } = await loadFixture(fixture);
      const rs = races(4);
      const commit = buildCommitmentBatch(rs);
      const result = buildResultBatch(rs.map((r) => ({ raceId: r.raceId, resultHash: r.resultHash, revealedSeed: r.seed })));
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, commit.root, 4, ""]);
      await time.increase(180); // the race runs
      await asPublisher.write.publishBatch([KIND_RESULT, 1n, result.root, 4, ""]);

      for (let i = 0; i < rs.length; i++) {
        const c = commit.entries.find((x) => x.raceId === rs[i]!.raceId)!;
        const r = result.entries.find((x) => x.raceId === rs[i]!.raceId)!;
        const args = [1n, c.proof, 1n, r.proof, c.raceKey, toBytes32(rs[i]!.seedCommitment), toBytes32(rs[i]!.resultHash), toBytes32(rs[i]!.seed)] as const;
        expect(await registry.read.verifyRace([...args])).to.equal(true);
        // a different seed (whose hash is not the commitment) fails
        expect(await registry.read.verifyRace([1n, c.proof, 1n, r.proof, c.raceKey, toBytes32(rs[i]!.seedCommitment), toBytes32(rs[i]!.resultHash), random32()])).to.equal(false);
        // a different result fails
        expect(await registry.read.verifyRace([1n, c.proof, 1n, r.proof, c.raceKey, toBytes32(rs[i]!.seedCommitment), random32(), toBytes32(rs[i]!.seed)])).to.equal(false);
        // unknown batches fail
        expect(await registry.read.verifyRace([1n, c.proof, 5n, r.proof, c.raceKey, toBytes32(rs[i]!.seedCommitment), toBytes32(rs[i]!.resultHash), toBytes32(rs[i]!.seed)])).to.equal(false);
      }
    });

    it("verifyRace fails when the commitment was anchored AFTER the result", async () => {
      const { registry, asPublisher } = await loadFixture(fixture);
      const rs = races(2);
      const result = buildResultBatch(rs.map((r) => ({ raceId: r.raceId, resultHash: r.resultHash, revealedSeed: r.seed })));
      const commit = buildCommitmentBatch(rs);
      await asPublisher.write.publishBatch([KIND_RESULT, 1n, result.root, 2, ""]);
      await time.increase(60);
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, commit.root, 2, ""]);
      const c = commit.entries[0]!;
      const r = result.entries.find((x) => x.raceId === c.raceId)!;
      const src = rs.find((x) => x.raceId === c.raceId)!;
      // Inclusion alone holds...
      expect(await registry.read.verifyCommitment([1n, c.raceKey, toBytes32(src.seedCommitment), c.proof])).to.equal(true);
      // ...but the ordering proof does not.
      expect(await registry.read.verifyRace([1n, c.proof, 1n, r.proof, c.raceKey, toBytes32(src.seedCommitment), toBytes32(src.resultHash), toBytes32(src.seed)])).to.equal(false);
    });

    it("on-chain sha256 matches the racing engine's commitSeed vector", async () => {
      const { registry, asPublisher } = await loadFixture(fixture);
      // racing-engine engine.test.ts: commitSeed("0"*64) === "66687aad..."
      const seed = "0".repeat(64);
      const commitment = engineCommitSeed(seed);
      expect(commitment).to.equal("66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925");
      const rs = [{ raceId: "golden", seed, seedCommitment: commitment, resultHash: "ab".repeat(32) }];
      const commit = buildCommitmentBatch(rs);
      const result = buildResultBatch([{ raceId: "golden", resultHash: rs[0]!.resultHash, revealedSeed: seed }]);
      await asPublisher.write.publishBatch([KIND_COMMITMENT, 1n, commit.root, 1, ""]);
      await time.increase(1);
      await asPublisher.write.publishBatch([KIND_RESULT, 1n, result.root, 1, ""]);
      expect(
        await registry.read.verifyRace([1n, [], 1n, [], raceKey("golden"), toBytes32(commitment), toBytes32(rs[0]!.resultHash), toBytes32(seed)]),
      ).to.equal(true);
    });

    it("exposes roles as expected", async () => {
      const { registry, admin, publisher } = await loadFixture(fixture);
      expect(await registry.read.hasRole([PUBLISHER_ROLE, getAddress(publisher.account.address)])).to.equal(true);
      expect(await registry.read.hasRole([PUBLISHER_ROLE, getAddress(admin.account.address)])).to.equal(false);
    });
  });
});
