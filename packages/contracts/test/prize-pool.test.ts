import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeFunctionData, getAddress, keccak256, parseEther, toBytes, type Address, type Hex } from "viem";
import { buildPoolEpoch, poolLeaf, vestedAmount, type PoolAllocation } from "../adapter/prizePool";
import { prizePoolAbi } from "../adapter/abi";
import { expectRevert, latestTimestamp, ZERO_ADDRESS } from "./helpers";

const role = (n: string): Hex => keccak256(toBytes(n));
const DAY = 86_400n;
const VEST = 14n * DAY;
const MAX_CLAIM = parseEther("1");
const REASON = keccak256(toBytes("linked-accounts"));

/** Golden vector shared with apps/web/src/lib/chain/pool.test.ts (byte parity of the leaf). */
export const GOLDEN_LEAF = {
  chainId: 46630,
  pool: "0x00000000000000000000000000000000000000a1" as Address,
  epochId: 7n,
  alloc: { account: "0x00000000000000000000000000000000000000b2" as Address, amount: 123456789n, vestStart: 1_700_000_000n, vestEnd: 1_701_209_600n },
};

async function fixture() {
  const [admin, poster, alice, bob, carol, mallory] = await hre.viem.getWalletClients();
  const pc = await hre.viem.getPublicClient();
  const pool = await hre.viem.deployContract("PrizePool", [admin!.account.address, MAX_CLAIM]);
  await pool.write.grantRole([role("POSTER_ROLE"), poster!.account.address]);
  const chainId = await pc.getChainId();
  const as = async (w: typeof admin) => hre.viem.getContractAt("PrizePool", pool.address, { client: { wallet: w! } });
  const asPoster = await as(poster);
  const fund = async (wei: bigint) => pool.write.fund([keccak256(toBytes("topup"))], { value: wei });
  async function post(allocs: PoolAllocation[], epochId?: bigint, total?: bigint) {
    const id = epochId ?? (await pool.read.lastEpochId()) + 1n;
    const tree = buildPoolEpoch(chainId, pool.address, id, allocs);
    await asPoster.write.postEpoch([id, tree.root, total ?? tree.total, tree.leafCount, "ipfs://manifest"]);
    return { id, tree };
  }
  async function vesting(): Promise<{ vestStart: bigint; vestEnd: bigint }> {
    const now = await latestTimestamp();
    return { vestStart: now, vestEnd: now + VEST };
  }
  return { admin: admin!, poster: poster!, alice: alice!, bob: bob!, carol: carol!, mallory: mallory!, pc, pool, chainId, as, asPoster, fund, post, vesting };
}

const entryOf = (tree: ReturnType<typeof buildPoolEpoch>, account: Address) => tree.entries.find((e) => getAddress(e.account) === getAddress(account))!;
const claimArgs = (id: bigint, e: ReturnType<typeof entryOf>) => [id, e.amount, e.vestStart, e.vestEnd, e.proof] as const;

describe("PrizePool", () => {
  describe("funding", () => {
    it("accepts ETH only through fund() from FUNDER_ROLE; plain transfers are refused", async () => {
      const { pool, fund, alice, pc } = await loadFixture(fixture);
      await fund(parseEther("2"));
      expect(await pc.getBalance({ address: pool.address })).to.equal(parseEther("2"));
      expect(await pool.read.available()).to.equal(parseEther("2"));
      const [ev] = await pool.getEvents.Funded();
      expect(ev!.args.amount).to.equal(parseEther("2"));
      const asAlice = await hre.viem.getContractAt("PrizePool", pool.address, { client: { wallet: alice } });
      await expectRevert(asAlice.write.fund([REASON], { value: 1n }), "AccessControlUnauthorizedAccount");
      await expectRevert(alice.sendTransaction({ to: pool.address, value: 1n }), "DirectTransferRejected");
      await expectRevert(pool.write.fund([REASON], { value: 0n }), "ZeroAmount");
    });

    it("works while paused (money in is always fine)", async () => {
      const { pool, fund } = await loadFixture(fixture);
      await pool.write.pause();
      await fund(1n);
      expect(await pool.read.available()).to.equal(1n);
    });
  });

  describe("posting epochs (cannot over-allocate)", () => {
    it("posts a root, reserves the total and emits EpochPosted", async () => {
      const { pool, fund, post, alice, bob, vesting } = await loadFixture(fixture);
      await fund(parseEther("4"));
      const v = await vesting();
      const { id, tree } = await post([
        { account: alice.account.address, amount: parseEther("0.5"), ...v },
        { account: bob.account.address, amount: parseEther("0.25"), ...v },
      ]);
      expect(id).to.equal(1n);
      const e = await pool.read.getEpoch([1n]);
      expect(e.root).to.equal(tree.root);
      expect(e.total).to.equal(parseEther("0.75"));
      expect(e.maxClaim).to.equal(MAX_CLAIM);
      expect(await pool.read.outstanding()).to.equal(parseEther("0.75"));
      expect(await pool.read.available()).to.equal(parseEther("3.25"));
      const [ev] = await pool.getEvents.EpochPosted();
      expect(ev!.args.leafCount).to.equal(2);
    });

    it("enforces total <= maxEpochBps x (balance - outstanding), across epochs", async () => {
      const { pool, fund, post, alice, bob, vesting } = await loadFixture(fixture);
      await fund(parseEther("2")); // available 2, max 50% = 1
      const v = await vesting();
      await expectRevert(post([{ account: alice.account.address, amount: parseEther("1"), ...v }], 1n, parseEther("1") + 1n), "OverAllocation");
      await post([{ account: alice.account.address, amount: parseEther("1"), ...v }]); // exactly 50%
      await pool.write.setParams([10_000, 0, 56 * 86_400, MAX_CLAIM]);
      // available is now 1: even at 100% an epoch can't promise more than what is free
      await expectRevert(post([{ account: bob.account.address, amount: parseEther("1"), ...v }], 2n, parseEther("1") + 1n), "OverAllocation");
      await post([{ account: bob.account.address, amount: parseEther("1"), ...v }]);
      expect(await pool.read.available()).to.equal(0n);
      expect(await pool.read.outstanding()).to.equal(parseEther("2"));
    });

    it("property: outstanding never exceeds the balance over random post/claim/fund sequences", async () => {
      const { pool, fund, as, pc, poster, alice, bob, carol } = await loadFixture(fixture);
      await pool.write.setParams([10_000, 0, 56 * 86_400, MAX_CLAIM]);
      const chainId = await pc.getChainId();
      const asPoster = await as(poster);
      const users = [alice, bob, carol];
      let seed = 12345;
      const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
      const open: { id: bigint; tree: ReturnType<typeof buildPoolEpoch> }[] = [];
      for (let step = 0; step < 25; step++) {
        const op = rnd(3);
        if (op === 0) await fund(BigInt(rnd(1000) + 1) * 10n ** 15n);
        else if (op === 1) {
          const avail = await pool.read.available();
          if (avail < 3n) continue;
          const now = await latestTimestamp();
          const allocs = users.map((u) => ({ account: u.account.address, amount: avail / 4n, vestStart: now, vestEnd: now + 10n }));
          const id = (await pool.read.lastEpochId()) + 1n;
          const tree = buildPoolEpoch(chainId, pool.address, id, allocs);
          // A dishonest total (more than the leaves) must still fit in the free balance.
          await asPoster.write.postEpoch([id, tree.root, tree.total, 3, ""]);
          open.push({ id, tree });
        } else if (open.length) {
          await time.increase(5);
          const ep = open[rnd(open.length)]!;
          const u = users[rnd(3)]!;
          const asU = await as(u);
          try {
            await asU.write.claim(claimArgs(ep.id, entryOf(ep.tree, u.account.address)));
          } catch {
            /* nothing vested yet / already claimed */
          }
        }
        const bal = await pc.getBalance({ address: pool.address });
        expect((await pool.read.outstanding()) <= bal, `step ${step}`).to.equal(true);
      }
    });

    it("epochs are sequential, rate-limited and validated; only POSTER_ROLE posts", async () => {
      const { pool, fund, post, asPoster, alice, as, vesting, chainId } = await loadFixture(fixture);
      await fund(parseEther("10"));
      const v = await vesting();
      const allocs = [{ account: alice.account.address, amount: parseEther("0.1"), ...v }];
      await expectRevert(post(allocs, 2n), "EpochOutOfOrder");
      const tree = buildPoolEpoch(chainId, pool.address, 1n, allocs);
      await expectRevert(asPoster.write.postEpoch([1n, `0x${"00".repeat(32)}`, 1n, 1, ""]), "EmptyRoot");
      await expectRevert(asPoster.write.postEpoch([1n, tree.root, 0n, 1, ""]), "EmptyEpoch");
      await expectRevert(asPoster.write.postEpoch([1n, tree.root, 1n, 0, ""]), "EmptyEpoch");
      const asAlice = await as(alice);
      await expectRevert(asAlice.write.postEpoch([1n, tree.root, tree.total, 1, ""]), "AccessControlUnauthorizedAccount");
      await post(allocs);
      await expectRevert(post(allocs), "EpochTooSoon"); // 6-day minimum interval
      await time.increase(6 * 86_400);
      await post(allocs);
      expect(await pool.read.lastEpochId()).to.equal(2n);
      await pool.write.pause();
      await expectRevert(post(allocs, 3n), "EnforcedPause");
    });
  });

  describe("claiming and vesting", () => {
    it("vests linearly; claims anytime, several times; full amount at vestEnd", async () => {
      const { pool, fund, post, alice, as, pc } = await loadFixture(fixture);
      await fund(parseEther("2"));
      const now = await latestTimestamp();
      const amount = parseEther("0.7");
      const { id, tree } = await post([{ account: alice.account.address, amount, vestStart: now + 10n, vestEnd: now + 10n + VEST }]);
      const e = entryOf(tree, alice.account.address);
      const asAlice = await as(alice);
      await expectRevert(asAlice.write.claim(claimArgs(id, e)), "NothingToClaim"); // before vestStart
      await time.increaseTo(now + 10n + VEST / 2n);
      const before = await pc.getBalance({ address: alice.account.address });
      const h1 = await asAlice.write.claim(claimArgs(id, e));
      const r1 = await pc.waitForTransactionReceipt({ hash: h1 });
      const t1 = (await pc.getBlock({ blockNumber: r1.blockNumber })).timestamp;
      const first = vestedAmount(amount, now + 10n, now + 10n + VEST, t1);
      expect(first).to.equal(await pool.read.vestedAmount([amount, now + 10n, now + 10n + VEST, t1]));
      const gas1 = r1.gasUsed * r1.effectiveGasPrice;
      expect((await pc.getBalance({ address: alice.account.address })) - before + gas1).to.equal(first);
      expect((await pool.read.claimOf([id, alice.account.address])).claimed).to.equal(first);
      console.log(`      claim gas: ${r1.gasUsed}`);
      await time.increaseTo(now + 10n + VEST + 1n);
      expect(await pool.read.claimable([id, alice.account.address, amount, e.vestStart, e.vestEnd])).to.equal(amount - first);
      await asAlice.write.claim(claimArgs(id, e));
      expect((await pool.read.claimOf([id, alice.account.address])).claimed).to.equal(amount);
      expect(await pool.read.outstanding()).to.equal(0n);
      expect(await pc.getBalance({ address: pool.address })).to.equal(parseEther("2") - amount);
      await expectRevert(asAlice.write.claim(claimArgs(id, e)), "NothingToClaim"); // double claim
      const evs = await pool.getEvents.Claimed({}, { fromBlock: 0n });
      expect(evs.map((x) => x.args.totalClaimed)).to.deep.equal([first, amount]);
    });

    it("rejects wrong proofs, other accounts, tampered amounts/vesting, other epochs", async () => {
      const { pool, fund, post, alice, bob, mallory, as, vesting } = await loadFixture(fixture);
      await fund(parseEther("4"));
      const v = await vesting();
      const { id, tree } = await post([
        { account: alice.account.address, amount: parseEther("0.5"), ...v },
        { account: bob.account.address, amount: parseEther("0.25"), ...v },
      ]);
      await time.increase(Number(VEST));
      const a = entryOf(tree, alice.account.address);
      const asMallory = await as(mallory);
      await expectRevert(asMallory.write.claim(claimArgs(id, a)), "InvalidProof"); // someone else's leaf
      const asAlice = await as(alice);
      await expectRevert(asAlice.write.claim([id, a.amount + 1n, a.vestStart, a.vestEnd, a.proof]), "InvalidProof");
      await expectRevert(asAlice.write.claim([id, a.amount, a.vestStart + 1n, a.vestEnd, a.proof]), "InvalidProof");
      await expectRevert(asAlice.write.claim([id, a.amount, a.vestStart, a.vestEnd, []]), "InvalidProof");
      await expectRevert(asAlice.write.claim([id, a.amount, a.vestEnd, a.vestStart, a.proof]), "InvalidVesting");
      await expectRevert(asAlice.write.claim([99n, a.amount, a.vestStart, a.vestEnd, a.proof]), "UnknownEpoch");
      await expectRevert(asAlice.write.claim([id, MAX_CLAIM + 1n, a.vestStart, a.vestEnd, a.proof]), "AboveAccountCap");
      await asAlice.write.claim(claimArgs(id, a));
    });

    it("a bad root can never pay more than its epoch total", async () => {
      const { pool, fund, alice, bob, as, asPoster, chainId } = await loadFixture(fixture);
      await fund(parseEther("10"));
      const now = await latestTimestamp();
      const allocs = [
        { account: alice.account.address, amount: parseEther("0.6"), vestStart: now, vestEnd: now },
        { account: bob.account.address, amount: parseEther("0.6"), vestStart: now, vestEnd: now },
      ];
      const tree = buildPoolEpoch(chainId, pool.address, 1n, allocs);
      await asPoster.write.postEpoch([1n, tree.root, parseEther("1"), 2, ""]); // total < sum of leaves
      await (await as(alice)).write.claim(claimArgs(1n, entryOf(tree, alice.account.address)));
      await expectRevert((await as(bob)).write.claim(claimArgs(1n, entryOf(tree, bob.account.address))), "EpochExhausted");
      expect(await pool.read.outstanding()).to.equal(parseEther("0.4"));
    });

    it("leaves are bound to the epoch, the chain and the pool contract", async () => {
      const { pool, fund, post, alice, as, vesting, chainId } = await loadFixture(fixture);
      await fund(parseEther("4"));
      const v = await vesting();
      const alloc = { account: alice.account.address, amount: parseEther("0.1"), ...v };
      const { tree } = await post([alloc]);
      expect(await pool.read.leafHash([1n, alloc.account, alloc.amount, alloc.vestStart, alloc.vestEnd])).to.equal(tree.entries[0]!.leaf);
      expect(poolLeaf(chainId, pool.address, 2n, alloc)).to.not.equal(tree.entries[0]!.leaf);
      expect(poolLeaf(chainId + 1, pool.address, 1n, alloc)).to.not.equal(tree.entries[0]!.leaf);
      expect(poolLeaf(chainId, alice.account.address, 1n, alloc)).to.not.equal(tree.entries[0]!.leaf);
      await time.increase(6 * 86_400);
      await post([{ ...alloc, amount: alloc.amount + 1n }]); // epoch 2: a different allocation
      const e1 = entryOf(tree, alice.account.address);
      await time.increase(Number(VEST));
      await expectRevert((await as(alice)).write.claim(claimArgs(2n, e1)), "InvalidProof"); // epoch-1 proof on epoch 2
    });

    it("TS leaf encoding matches the golden vector used by the web app", () => {
      const leaf = poolLeaf(GOLDEN_LEAF.chainId, GOLDEN_LEAF.pool, GOLDEN_LEAF.epochId, GOLDEN_LEAF.alloc);
      expect(leaf).to.equal(POOL_GOLDEN_LEAF_HASH);
    });

    it("pause blocks claims; only the admin unpauses", async () => {
      const { pool, fund, post, alice, as, vesting } = await loadFixture(fixture);
      await fund(parseEther("1"));
      const v = await vesting();
      const { id, tree } = await post([{ account: alice.account.address, amount: parseEther("0.1"), ...v }]);
      await time.increase(Number(VEST));
      const asAlice = await as(alice);
      await expectRevert(asAlice.write.pause(), "AccessControlUnauthorizedAccount");
      await pool.write.pause();
      await expectRevert(asAlice.write.claim(claimArgs(id, entryOf(tree, alice.account.address))), "EnforcedPause");
      await expectRevert(asAlice.write.unpause(), "AccessControlUnauthorizedAccount");
      await pool.write.unpause();
      await asAlice.write.claim(claimArgs(id, entryOf(tree, alice.account.address)));
    });

    it("blocks reentrancy from a malicious claimer", async () => {
      const { pool, fund, asPoster, chainId } = await loadFixture(fixture);
      await fund(parseEther("1"));
      const evil = await hre.viem.deployContract("MockEthReceiver", []);
      const now = await latestTimestamp();
      const alloc = { account: getAddress(evil.address), amount: parseEther("0.2"), vestStart: now, vestEnd: now };
      const tree = buildPoolEpoch(chainId, pool.address, 1n, [alloc]);
      await asPoster.write.postEpoch([1n, tree.root, tree.total, 1, ""]);
      const data = encodeFunctionData({ abi: prizePoolAbi, functionName: "claim", args: claimArgs(1n, tree.entries[0]!) });
      await evil.write.setReenter([pool.address, data]);
      await expectRevert(evil.write.execute([pool.address, 0n, data]), "ReentrancyGuardReentrantCall");
      expect(await pool.read.outstanding()).to.equal(parseEther("0.2"));
      await evil.write.setMode([0]);
      await evil.write.execute([pool.address, 0n, data]);
      expect((await pool.read.claimOf([1n, evil.address])).claimed).to.equal(parseEther("0.2"));
    });
  });

  describe("returns to the pool (revoke, cancel, expiry)", () => {
    it("revoke(includeVested=false) keeps what vested and returns the rest to the pool", async () => {
      const { pool, fund, post, alice, as, pc } = await loadFixture(fixture);
      await fund(parseEther("2"));
      const now = await latestTimestamp();
      const amount = parseEther("1");
      const { id, tree } = await post([{ account: alice.account.address, amount, vestStart: now, vestEnd: now + 100n }]);
      const e = entryOf(tree, alice.account.address);
      await time.increaseTo(now + 25n);
      const h = await pool.write.revoke([id, alice.account.address, e.amount, e.vestStart, e.vestEnd, e.proof, false, REASON]);
      const t = (await pc.getBlock({ blockNumber: (await pc.waitForTransactionReceipt({ hash: h })).blockNumber })).timestamp;
      const kept = vestedAmount(amount, now, now + 100n, t);
      const [ev] = await pool.getEvents.Revoked();
      expect(ev!.args.returned).to.equal(amount - kept);
      expect(ev!.args.reason).to.equal(REASON);
      expect(await pool.read.outstanding()).to.equal(kept);
      expect(await pool.read.available()).to.equal(parseEther("2") - kept);
      await time.increaseTo(now + 1000n);
      const asAlice = await as(alice);
      await asAlice.write.claim(claimArgs(id, e));
      expect((await pool.read.claimOf([id, alice.account.address])).claimed).to.equal(kept);
      await expectRevert(asAlice.write.claim(claimArgs(id, e)), "NothingToClaim");
      await expectRevert(pool.write.revoke([id, alice.account.address, e.amount, e.vestStart, e.vestEnd, e.proof, true, REASON]), "AlreadyRevoked");
      expect(await pool.read.outstanding()).to.equal(0n);
    });

    it("revoke(includeVested=true) returns everything unclaimed; admin only; needs a valid leaf", async () => {
      const { pool, fund, post, alice, bob, as, vesting } = await loadFixture(fixture);
      await fund(parseEther("2"));
      const v = await vesting();
      const { id, tree } = await post([
        { account: alice.account.address, amount: parseEther("0.5"), ...v },
        { account: bob.account.address, amount: parseEther("0.5"), ...v },
      ]);
      const e = entryOf(tree, alice.account.address);
      await time.increase(Number(VEST / 2n));
      await (await as(alice)).write.claim(claimArgs(id, e));
      const claimed = (await pool.read.claimOf([id, alice.account.address])).claimed;
      const asBob = await as(bob);
      await expectRevert(asBob.write.revoke([id, alice.account.address, e.amount, e.vestStart, e.vestEnd, e.proof, true, REASON]), "AccessControlUnauthorizedAccount");
      await expectRevert(pool.write.revoke([id, bob.account.address, e.amount, e.vestStart, e.vestEnd, e.proof, true, REASON]), "InvalidProof");
      await pool.write.revoke([id, alice.account.address, e.amount, e.vestStart, e.vestEnd, e.proof, true, REASON]);
      expect(await pool.read.outstanding()).to.equal(parseEther("0.5"));
      await time.increase(Number(VEST));
      await expectRevert((await as(alice)).write.claim(claimArgs(id, e)), "NothingToClaim");
      expect((await pool.read.claimOf([id, alice.account.address])).claimed).to.equal(claimed);
      await asBob.write.claim(claimArgs(id, entryOf(tree, bob.account.address))); // others unaffected
    });

    it("cancelEpoch returns all unclaimed funds to the pool and stops claims", async () => {
      const { pool, fund, post, alice, as, vesting } = await loadFixture(fixture);
      await fund(parseEther("2"));
      const v = await vesting();
      const { id, tree } = await post([{ account: alice.account.address, amount: parseEther("0.8"), ...v }]);
      const asAlice = await as(alice);
      await expectRevert(asAlice.write.cancelEpoch([id, REASON]), "AccessControlUnauthorizedAccount");
      await pool.write.pause(); // incident response: works while paused
      await pool.write.cancelEpoch([id, REASON]);
      await pool.write.unpause();
      expect(await pool.read.outstanding()).to.equal(0n);
      expect(await pool.read.available()).to.equal(parseEther("2"));
      await time.increase(Number(VEST));
      await expectRevert(asAlice.write.claim(claimArgs(id, entryOf(tree, alice.account.address))), "EpochClosed");
      await expectRevert(pool.write.cancelEpoch([id, REASON]), "EpochClosed");
      await expectRevert(pool.write.cancelEpoch([42n, REASON]), "UnknownEpoch");
      expect(await pool.read.claimable([id, alice.account.address, parseEther("0.8"), v.vestStart, v.vestEnd])).to.equal(0n);
    });

    it("unclaimed allocations expire back to the pool after the claim window (anyone can trigger)", async () => {
      const { pool, fund, post, alice, bob, as, vesting } = await loadFixture(fixture);
      await fund(parseEther("2"));
      const v = await vesting();
      const { id, tree } = await post([
        { account: alice.account.address, amount: parseEther("0.3"), ...v },
        { account: bob.account.address, amount: parseEther("0.2"), ...v },
      ]);
      await time.increase(Number(VEST));
      await (await as(alice)).write.claim(claimArgs(id, entryOf(tree, alice.account.address)));
      const asBob = await as(bob);
      await expectRevert(asBob.write.expireEpoch([id]), "ClaimWindowOpen");
      await time.increase(56 * 86_400);
      await expectRevert(asBob.write.claim(claimArgs(id, entryOf(tree, bob.account.address))), "ClaimWindowOver");
      expect(await pool.read.claimable([id, bob.account.address, parseEther("0.2"), v.vestStart, v.vestEnd])).to.equal(0n);
      await asBob.write.expireEpoch([id]);
      const [ev] = await pool.getEvents.EpochExpired();
      expect(ev!.args.returned).to.equal(parseEther("0.2"));
      expect(await pool.read.outstanding()).to.equal(0n);
      expect(await pool.read.available()).to.equal(parseEther("1.7"));
      await expectRevert(asBob.write.expireEpoch([id]), "EpochClosed");
      await expectRevert(asBob.write.expireEpoch([77n]), "UnknownEpoch");
    });
  });

  describe("admin", () => {
    it("params are bounded, admin-only, evented, and snapshotted per epoch", async () => {
      const { pool, fund, post, alice, as, vesting } = await loadFixture(fixture);
      const asAlice = await as(alice);
      await expectRevert(asAlice.write.setParams([5000, 0, 3600, 1n]), "AccessControlUnauthorizedAccount");
      for (const bad of [
        [0, 0, 3600, 1n],
        [10_001, 0, 3600, 1n],
        [5000, 30 * 86_400 + 1, 3600, 1n],
        [5000, 0, 3599, 1n],
        [5000, 0, 365 * 86_400 + 1, 1n],
        [5000, 0, 3600, 0n],
      ] as const) {
        await expectRevert(pool.write.setParams([...bad]), "InvalidParams");
      }
      await fund(parseEther("1"));
      const v = await vesting();
      const { id, tree } = await post([{ account: alice.account.address, amount: parseEther("0.3"), ...v }]);
      await pool.write.setParams([5000, 0, 3600, parseEther("0.1")]); // lowering the cap later...
      await time.increase(Number(VEST));
      await asAlice.write.claim(claimArgs(id, entryOf(tree, alice.account.address))); // ...doesn't break posted epochs
      const evs = await pool.getEvents.ParamsSet({ fromBlock: 0n });
      expect(evs.length).to.equal(2);
    });

    it("rejects a zero admin; exposes roles; has no way to withdraw to the owner", async () => {
      await expectRevert(hre.viem.deployContract("PrizePool", [ZERO_ADDRESS, 1n]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("PrizePool", [getAddress("0x00000000000000000000000000000000000000a1"), 0n]), "InvalidParams");
      const { pool, admin } = await loadFixture(fixture);
      expect(await pool.read.hasRole([`0x${"00".repeat(32)}`, admin.account.address])).to.equal(true);
      const artifact = await hre.artifacts.readArtifact("PrizePool");
      const fns = (artifact.abi as { type: string; name?: string }[]).filter((x) => x.type === "function").map((x) => x.name);
      for (const banned of ["withdraw", "sweep", "sweepToTreasury", "transfer", "rescue"]) expect(fns).to.not.include(banned);
    });
  });
});

/** Computed once from the adapter and pinned; apps/web must produce the same bytes. */
export const POOL_GOLDEN_LEAF_HASH: Hex = "0xfa8c956530fbc1466e1d11bb33c762dd5dbea02cccc6cfcbe8b2b4c29edd3d79";
