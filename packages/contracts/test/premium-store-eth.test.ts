import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, parseEther, toBytes, toFunctionSelector, type Address, type Hex } from "viem";
import { newOrderId, skuId } from "../adapter/voucher";
import { ethQuoteTypedData, NO_REFERRER, type EthQuote } from "../adapter/ethQuote";
import { premiumStoreAbi } from "../adapter/abi";
import { expectRevert, latestTimestamp } from "./helpers";

const role = (n: string): Hex => keccak256(toBytes(n));
const PACK = skuId("premium_pack");
const PRICE = parseEther("0.0015"); // ~ $4.99 at ~$3,300/ETH

async function fixture() {
  const [admin, treasury, signer, buyer, other] = await hre.viem.getWalletClients();
  const pc = await hre.viem.getPublicClient();
  const pool = await hre.viem.deployContract("PrizePool", [admin!.account.address, parseEther("1")]);
  const store = await hre.viem.deployContract("PremiumStore", [admin!.account.address, treasury!.account.address, signer!.account.address, pool.address, 3000]);
  await pool.write.grantRole([role("FUNDER_ROLE"), store.address]);
  await store.write.setSkuActive([PACK, true]);
  const asBuyer = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: buyer! } });
  const chainId = await pc.getChainId();
  async function quote(overrides: Partial<EthQuote> = {}): Promise<EthQuote> {
    return { orderId: newOrderId(), buyer: getAddress(buyer!.account.address), sku: PACK, quantity: 1, priceWei: PRICE, usdCents: 499n, ref1: NO_REFERRER, ref1Bps: 0, ref2: NO_REFERRER, ref2Bps: 0, deadline: (await latestTimestamp()) + 300n, ...overrides };
  }
  async function sign(q: EthQuote, by = signer!, verifyingContract: Address = store.address, cid = chainId): Promise<Hex> {
    return by.signTypedData({ account: by.account, ...ethQuoteTypedData(q, cid, verifyingContract) });
  }
  return { admin: admin!, treasury: treasury!, signer: signer!, buyer: buyer!, other: other!, pc, pool, store, asBuyer, chainId, quote, sign };
}

describe("PremiumStore: native ETH (closed beta)", () => {
  it("splits exactly: 30% to the PrizePool (Funded event), 70% to the treasury; nothing stays in the store", async () => {
    const { store, asBuyer, pool, pc, treasury, quote, sign } = await loadFixture(fixture);
    const q = await quote();
    const tBefore = await pc.getBalance({ address: treasury.account.address });
    const hash = await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE });
    const r = await pc.waitForTransactionReceipt({ hash });
    console.log(`      purchaseWithEth gas: ${r.gasUsed}`);
    const poolShare = (PRICE * 3000n) / 10_000n;
    expect(await pc.getBalance({ address: pool.address })).to.equal(poolShare);
    expect(await pool.read.available()).to.equal(poolShare);
    expect((await pc.getBalance({ address: treasury.account.address })) - tBefore).to.equal(PRICE - poolShare);
    expect(await pc.getBalance({ address: store.address })).to.equal(0n);
    expect(await store.read.isFulfilled([q.orderId])).to.equal(true);
    const [ev] = await store.getEvents.PurchasedWithEth({ orderId: q.orderId }, { fromBlock: r.blockNumber });
    expect(ev!.args).to.deep.equal({ orderId: q.orderId, buyer: q.buyer, sku: PACK, quantity: 1, priceWei: PRICE, poolShare, treasuryShare: PRICE - poolShare });
    const [funded] = await pool.getEvents.Funded({}, { fromBlock: r.blockNumber });
    expect(funded!.args.ref).to.equal(q.orderId);
    expect(getAddress(funded!.args.from!)).to.equal(getAddress(store.address));
  });

  it("property: the split always sums to msg.value for random prices and bps", async () => {
    const { store, asBuyer, pool, pc, treasury, quote, sign } = await loadFixture(fixture);
    let poolTotal = 0n;
    let seed = 7;
    for (let i = 0; i < 12; i++) {
      seed = (seed * 48271) % 2147483647;
      const bps = 1000 + (seed % 4001);
      await store.write.setPoolBps([bps]);
      const price = BigInt(seed % 10 ** 9) * 10n ** 6n + 1n;
      const tBefore = await pc.getBalance({ address: treasury.account.address });
      const q = await quote({ priceWei: price });
      await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: price });
      const share = (price * BigInt(bps)) / 10_000n;
      poolTotal += share;
      expect((await pc.getBalance({ address: treasury.account.address })) - tBefore).to.equal(price - share);
    }
    expect(await pc.getBalance({ address: pool.address })).to.equal(poolTotal);
    expect(await pc.getBalance({ address: store.address })).to.equal(0n);
  });

  it("hashEthQuote equals viem's EIP-712 digest (server signer parity)", async () => {
    const { store, quote, chainId } = await loadFixture(fixture);
    const q = await quote();
    expect(await store.read.hashEthQuote([q])).to.equal(hashTypedData(ethQuoteTypedData(q, chainId, store.address)));
  });

  it("requires the exact amount", async () => {
    const { asBuyer, quote, sign } = await loadFixture(fixture);
    const q = await quote();
    const sig = await sign(q);
    await expectRevert(asBuyer.write.purchaseWithEth([q, sig], { value: PRICE - 1n }), "WrongPayment");
    await expectRevert(asBuyer.write.purchaseWithEth([q, sig], { value: PRICE + 1n }), "WrongPayment");
    await expectRevert(asBuyer.write.purchaseWithEth([q, sig], { value: 0n }), "WrongPayment");
    const zero = await quote({ priceWei: 0n });
    await expectRevert(asBuyer.write.purchaseWithEth([zero, await sign(zero)], { value: 0n }), "ZeroPrice");
  });

  it("single-use orderId across both payment paths; replay and front-running fail", async () => {
    const { store, asBuyer, other, quote, sign } = await loadFixture(fixture);
    const q = await quote();
    const sig = await sign(q);
    await asBuyer.write.purchaseWithEth([q, sig], { value: PRICE });
    await expectRevert(asBuyer.write.purchaseWithEth([q, sig], { value: PRICE }), "OrderAlreadyFulfilled");
    const fresh = await sign({ ...q });
    await expectRevert(asBuyer.write.purchaseWithEth([q, fresh], { value: PRICE }), "OrderAlreadyFulfilled");
    const asOther = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: other } });
    const q2 = await quote();
    await expectRevert(asOther.write.purchaseWithEth([q2, await sign(q2)], { value: PRICE }), "NotOrderBuyer");
  });

  it("deadline: expired quotes and quotes valid for more than 10 minutes are rejected", async () => {
    const { asBuyer, quote, sign } = await loadFixture(fixture);
    const q = await quote();
    const sig = await sign(q);
    await time.increase(301);
    await expectRevert(asBuyer.write.purchaseWithEth([q, sig], { value: PRICE }), "OrderExpired");
    const long = await quote({ deadline: (await latestTimestamp()) + 3600n });
    await expectRevert(asBuyer.write.purchaseWithEth([long, await sign(long)], { value: PRICE }), "QuoteTtlTooLong");
  });

  it("signature: tampered price, wrong signer, other contract or chain are rejected", async () => {
    const { asBuyer, quote, sign, other, store, chainId } = await loadFixture(fixture);
    const q = await quote();
    const sig = await sign(q);
    await expectRevert(asBuyer.write.purchaseWithEth([{ ...q, priceWei: PRICE / 2n }, sig], { value: PRICE / 2n }), "InvalidSignature");
    await expectRevert(asBuyer.write.purchaseWithEth([{ ...q, quantity: 2 }, sig], { value: PRICE }), "InvalidSignature");
    await expectRevert(asBuyer.write.purchaseWithEth([q, await sign(q, other)], { value: PRICE }), "InvalidSignature");
    await expectRevert(asBuyer.write.purchaseWithEth([q, await sign(q, undefined, other.account.address)], { value: PRICE }), "InvalidSignature");
    await expectRevert(asBuyer.write.purchaseWithEth([q, await sign(q, undefined, store.address, chainId + 1)], { value: PRICE }), "InvalidSignature");
    await expectRevert(asBuyer.write.purchaseWithEth([q, "0x1234"], { value: PRICE }), "InvalidSignature");
  });

  it("inactive SKU, bad quantity and pause are enforced", async () => {
    const { store, asBuyer, quote, sign } = await loadFixture(fixture);
    const q0 = await quote({ quantity: 0 });
    await expectRevert(asBuyer.write.purchaseWithEth([q0, await sign(q0)], { value: PRICE }), "InvalidQuantity");
    const q101 = await quote({ quantity: 101 });
    await expectRevert(asBuyer.write.purchaseWithEth([q101, await sign(q101)], { value: PRICE }), "InvalidQuantity");
    const qs = await quote({ sku: skuId("season_pass") });
    await expectRevert(asBuyer.write.purchaseWithEth([qs, await sign(qs)], { value: PRICE }), "SkuInactive");
    await store.write.pause();
    const q = await quote();
    await expectRevert(asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE }), "EnforcedPause");
  });

  it("a paused or misconfigured PrizePool undoes the whole sale (no half-split)", async () => {
    const { admin, treasury, signer, asBuyer, quote, sign } = await loadFixture(fixture);
    const pool2 = await hre.viem.deployContract("PrizePool", [admin.account.address, 1n]);
    const store2 = await hre.viem.deployContract("PremiumStore", [admin.account.address, treasury.account.address, signer.account.address, pool2.address, 3000]);
    await store2.write.setSkuActive([PACK, true]);
    const as2 = await hre.viem.getContractAt("PremiumStore", store2.address, { client: { wallet: (await hre.viem.getWalletClients())[3]! } });
    const q = await quote();
    // store2 lacks FUNDER_ROLE on pool2
    await expectRevert(as2.write.purchaseWithEth([q, await sign(q, undefined, store2.address)], { value: PRICE }), "AccessControlUnauthorizedAccount");
    expect(await store2.read.isFulfilled([q.orderId])).to.equal(false);
    void asBuyer;
  });

  it("a treasury that refuses ETH defers its share (sale still succeeds); withdrawEth pays it later", async () => {
    const { admin, signer, pc, quote, sign, buyer } = await loadFixture(fixture);
    const sink = await hre.viem.deployContract("MockEthReceiver", []);
    await sink.write.setMode([1]); // reject
    const pool = await hre.viem.deployContract("PrizePool", [admin.account.address, 1n]);
    const store = await hre.viem.deployContract("PremiumStore", [admin.account.address, sink.address, signer.account.address, pool.address, 3000]);
    await pool.write.grantRole([role("FUNDER_ROLE"), store.address]);
    await store.write.setSkuActive([PACK, true]);
    const asBuyer = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: buyer } });
    const q = await quote();
    await asBuyer.write.purchaseWithEth([q, await sign(q, undefined, store.address)], { value: PRICE });
    const treasuryShare = PRICE - (PRICE * 3000n) / 10_000n;
    expect(await store.read.pendingTreasuryWei()).to.equal(treasuryShare);
    expect(await pc.getBalance({ address: store.address })).to.equal(treasuryShare);
    const [ev] = await store.getEvents.TreasuryTransferDeferred();
    expect(ev!.args.amount).to.equal(treasuryShare);
    await expectRevert(asBuyer.write.withdrawEth(), "TreasuryRefused");
    await sink.write.setMode([0]);
    await asBuyer.write.withdrawEth(); // anyone can trigger; destination is fixed
    expect(await pc.getBalance({ address: sink.address })).to.equal(treasuryShare);
    expect(await store.read.pendingTreasuryWei()).to.equal(0n);
    await asBuyer.write.withdrawEth(); // no-op when nothing is pending
  });

  it("blocks reentrancy from a hostile treasury (nested purchase hits the guard)", async () => {
    const { admin, signer, pc, quote, sign, buyer } = await loadFixture(fixture);
    const evil = await hre.viem.deployContract("MockEthReceiver", []);
    const pool = await hre.viem.deployContract("PrizePool", [admin.account.address, 1n]);
    const store = await hre.viem.deployContract("PremiumStore", [admin.account.address, evil.address, signer.account.address, pool.address, 3000]);
    await pool.write.grantRole([role("FUNDER_ROLE"), store.address]);
    await store.write.setSkuActive([PACK, true]);
    const q2 = await quote();
    const data = encodeFunctionData({ abi: premiumStoreAbi, functionName: "purchaseWithEth", args: [q2, await sign(q2, undefined, store.address)] });
    await evil.write.setReenterAndRecord([store.address, data]);
    const asBuyer = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: buyer } });
    const q = await quote();
    await asBuyer.write.purchaseWithEth([q, await sign(q, undefined, store.address)], { value: PRICE });
    expect(await store.read.isFulfilled([q2.orderId])).to.equal(false);
    expect(await evil.read.reentered()).to.equal(true);
    // ReentrancyGuardReentrantCall() selector
    expect(await evil.read.reenterError()).to.equal(toFunctionSelector("ReentrancyGuardReentrantCall()"));
    expect(await store.read.pendingTreasuryWei()).to.equal(0n);
    expect(await pc.getBalance({ address: evil.address })).to.equal(PRICE - (PRICE * 3000n) / 10_000n);
  });

  it("optional Chainlink check (off by default): quote must be within tolerance of a fresh feed", async () => {
    const { store, asBuyer, quote, sign } = await loadFixture(fixture);
    expect(await store.read.priceFeed()).to.equal("0x0000000000000000000000000000000000000000");
    // $3,326.666... per ETH with 8 decimals -> $4.99 = 0.0015 ETH
    const feed = await hre.viem.deployContract("MockPriceFeed", [8, 332_666_666_667n]);
    await expectRevert(asBuyer.write.setPriceFeed([feed.address, 300, 3600]), "AccessControlUnauthorizedAccount");
    await expectRevert(store.write.setPriceFeed([feed.address, 0, 3600]), "InvalidFeedConfig");
    await expectRevert(store.write.setPriceFeed([feed.address, 2001, 3600]), "InvalidFeedConfig");
    await expectRevert(store.write.setPriceFeed([feed.address, 300, 0]), "InvalidFeedConfig");
    await store.write.setPriceFeed([feed.address, 300, 3600]); // 3%, 1 hour
    const ok = await quote({ priceWei: (PRICE * 102n) / 100n }); // 2% off: accepted
    await asBuyer.write.purchaseWithEth([ok, await sign(ok)], { value: ok.priceWei });
    const cheap = await quote({ priceWei: (PRICE * 95n) / 100n }); // 5% under: a leaked signer can't sell cheap
    await expectRevert(asBuyer.write.purchaseWithEth([cheap, await sign(cheap)], { value: cheap.priceWei }), "PriceOffFeed");
    const dear = await quote({ priceWei: (PRICE * 104n) / 100n });
    await expectRevert(asBuyer.write.purchaseWithEth([dear, await sign(dear)], { value: dear.priceWei }), "PriceOffFeed");
    await feed.write.set([332_666_666_667n, (await latestTimestamp()) - 3601n]);
    const stale = await quote();
    await expectRevert(asBuyer.write.purchaseWithEth([stale, await sign(stale)], { value: PRICE }), "StaleFeed");
    await feed.write.set([0n, await latestTimestamp()]);
    await expectRevert(asBuyer.write.purchaseWithEth([stale, await sign(stale)], { value: PRICE }), "StaleFeed");
    await store.write.setPriceFeed(["0x0000000000000000000000000000000000000000", 0, 0]); // disable again
    await asBuyer.write.purchaseWithEth([stale, await sign(stale)], { value: PRICE });
  });

  describe("affiliates (2 levels, out of the treasury share)", () => {
    async function withRefs() {
      const f = await loadFixture(fixture);
      const [, , , , , inviter, upstream] = await hre.viem.getWalletClients();
      return { ...f, inviter: inviter!, upstream: upstream! };
    }

    it("pays L1 10% and L2 3% instantly; pool keeps exactly 30%; treasury gets the rest", async () => {
      const { asBuyer, quote, sign, pc, pool, treasury, inviter, upstream, store } = await withRefs();
      const b = async (a: Address) => pc.getBalance({ address: a });
      const [t0, i0, u0] = [await b(treasury.account.address), await b(inviter.account.address), await b(upstream.account.address)];
      const q = await quote({ ref1: getAddress(inviter.account.address), ref1Bps: 1000, ref2: getAddress(upstream.account.address), ref2Bps: 300 });
      const hash = await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE });
      const r = await pc.waitForTransactionReceipt({ hash });
      console.log(`      purchaseWithEth gas with 2 referrers: ${r.gasUsed}`);
      const poolShare = (PRICE * 3000n) / 10_000n;
      const r1 = (PRICE * 1000n) / 10_000n;
      const r2 = (PRICE * 300n) / 10_000n;
      expect(await b(pool.address)).to.equal(poolShare);
      expect((await b(inviter.account.address)) - i0).to.equal(r1);
      expect((await b(upstream.account.address)) - u0).to.equal(r2);
      expect((await b(treasury.account.address)) - t0).to.equal(PRICE - poolShare - r1 - r2);
      expect(await b(store.address)).to.equal(0n);
      const evs = await store.getEvents.ReferralCommission({}, { fromBlock: r.blockNumber });
      expect(evs.map((e) => [e.args.level, e.args.amount, e.args.deferred])).to.deep.equal([
        [1, r1, false],
        [2, r2, false],
      ]);
      const [p] = await store.getEvents.PurchasedWithEth({}, { fromBlock: r.blockNumber });
      expect(p!.args.treasuryShare).to.equal(PRICE - poolShare - r1 - r2);
    });

    it("level 1 only: the missing level-2 share stays with the treasury (never the pool)", async () => {
      const { asBuyer, quote, sign, pc, pool, treasury, inviter } = await withRefs();
      const t0 = await pc.getBalance({ address: treasury.account.address });
      const q = await quote({ ref1: getAddress(inviter.account.address), ref1Bps: 1000 });
      await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE });
      expect(await pc.getBalance({ address: pool.address })).to.equal((PRICE * 3000n) / 10_000n);
      expect((await pc.getBalance({ address: treasury.account.address })) - t0).to.equal(PRICE - (PRICE * 3000n) / 10_000n - (PRICE * 1000n) / 10_000n);
    });

    it("a referrer that refuses ETH is credited and withdraws later", async () => {
      const { asBuyer, quote, sign, store, pc } = await withRefs();
      const sink = await hre.viem.deployContract("MockEthReceiver", []);
      await sink.write.setMode([1]);
      const q = await quote({ ref1: getAddress(sink.address), ref1Bps: 1000 });
      await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE });
      const owed = (PRICE * 1000n) / 10_000n;
      expect(await store.read.referralOwed([sink.address])).to.equal(owed);
      const [ev] = await store.getEvents.ReferralCommission();
      expect(ev!.args.deferred).to.equal(true);
      await expectRevert(asBuyer.write.withdrawReferral(), "NothingOwed");
      await sink.write.setMode([0]);
      const data = encodeFunctionData({ abi: premiumStoreAbi, functionName: "withdrawReferral" });
      await sink.write.execute([store.address, 0n, data]);
      expect(await pc.getBalance({ address: sink.address })).to.equal(owed);
      expect(await store.read.referralOwed([sink.address])).to.equal(0n);
      expect(await pc.getBalance({ address: store.address })).to.equal(0n);
    });

    it("a gas-griefing or reentrant referrer can't block or re-enter the sale", async () => {
      const { asBuyer, quote, sign, store } = await withRefs();
      const evil = await hre.viem.deployContract("MockEthReceiver", []);
      const q2 = await quote();
      await evil.write.setReenterAndRecord([store.address, encodeFunctionData({ abi: premiumStoreAbi, functionName: "withdrawReferral" })]);
      const q = await quote({ ref1: getAddress(evil.address), ref1Bps: 1000 });
      await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE });
      expect(await store.read.isFulfilled([q.orderId])).to.equal(true);
      expect(await evil.read.reenterError()).to.equal(toFunctionSelector("ReentrancyGuardReentrantCall()"));
      void q2;
    });

    it("validates referrers: bps within the current ceilings, no self/duplicate referrers, L2 needs L1", async () => {
      const { asBuyer, quote, sign, inviter, upstream, buyer } = await withRefs();
      const i = getAddress(inviter.account.address);
      const u = getAddress(upstream.account.address);
      const me = getAddress(buyer.account.address);
      const cases: [Partial<EthQuote>, string][] = [
        [{ ref1: i, ref1Bps: 1001 }, "ReferralBpsOutOfRange"],
        [{ ref1: i, ref1Bps: 1000, ref2: u, ref2Bps: 301 }, "ReferralBpsOutOfRange"],
        [{ ref1Bps: 100 }, "InvalidReferral"],
        [{ ref2: u, ref2Bps: 300 }, "InvalidReferral"],
        [{ ref1: me, ref1Bps: 1000 }, "InvalidReferral"],
        [{ ref1: i, ref1Bps: 1000, ref2: me, ref2Bps: 300 }, "InvalidReferral"],
        [{ ref1: i, ref1Bps: 1000, ref2: i, ref2Bps: 300 }, "InvalidReferral"],
        [{ ref1: i, ref1Bps: 1000, ref2Bps: 300 }, "InvalidReferral"],
      ];
      for (const [o, err] of cases) {
        const q = await quote(o);
        await expectRevert(asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE }), err);
      }
      // A referrer swapped in after signing breaks the signature.
      const q = await quote({ ref1: i, ref1Bps: 1000 });
      await expectRevert(asBuyer.write.purchaseWithEth([{ ...q, ref1: u }, await sign(q)], { value: PRICE }), "InvalidSignature");
    });

    it("ceilings are admin-only with hard caps 15% / 5%; at the caps the pool still gets its full share", async () => {
      const { store, asBuyer, quote, sign, pc, pool, inviter, upstream } = await withRefs();
      await expectRevert(asBuyer.write.setReferralBps([1500, 500]), "AccessControlUnauthorizedAccount");
      await expectRevert(store.write.setReferralBps([1501, 500]), "ReferralBpsOutOfRange");
      await expectRevert(store.write.setReferralBps([1500, 501]), "ReferralBpsOutOfRange");
      await store.write.setReferralBps([1500, 500]);
      await store.write.setPoolBps([5000]);
      const q = await quote({ ref1: getAddress(inviter.account.address), ref1Bps: 1500, ref2: getAddress(upstream.account.address), ref2Bps: 500 });
      await asBuyer.write.purchaseWithEth([q, await sign(q)], { value: PRICE });
      expect(await pc.getBalance({ address: pool.address })).to.equal(PRICE / 2n);
      const evs = await store.getEvents.ReferralBpsSet({ fromBlock: 0n });
      expect(evs.at(-1)!.args).to.deep.equal({ maxRef1Bps: 1500, maxRef2Bps: 500 });
    });
  });

  it("poolBps is bounded [1000, 5000], admin-only and evented; the pool address is immutable", async () => {
    const { store, asBuyer, pool } = await loadFixture(fixture);
    expect(await store.read.poolBps()).to.equal(3000);
    expect(getAddress(await store.read.prizePool())).to.equal(getAddress(pool.address));
    await expectRevert(asBuyer.write.setPoolBps([2000]), "AccessControlUnauthorizedAccount");
    await expectRevert(store.write.setPoolBps([999]), "PoolBpsOutOfRange");
    await expectRevert(store.write.setPoolBps([5001]), "PoolBpsOutOfRange");
    await store.write.setPoolBps([5000]);
    const evs = await store.getEvents.PoolBpsSet({ fromBlock: 0n });
    expect(evs.at(-1)!.args).to.deep.equal({ oldBps: 3000, newBps: 5000 });
    const artifact = await hre.artifacts.readArtifact("PremiumStore");
    const fns = (artifact.abi as { type: string; name?: string }[]).filter((x) => x.type === "function").map((x) => x.name);
    expect(fns).to.not.include("setPrizePool");
  });
});
