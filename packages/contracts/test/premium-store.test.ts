import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, parseEther, toBytes, type Address, type Hex } from "viem";
import { newOrderId, orderTypedData, parseTokenAmount, skuId } from "../adapter/voucher";
import type { PurchaseOrder } from "../adapter/types";
import { expectAnyRevert, expectRevert, latestTimestamp, ZERO_ADDRESS } from "./helpers";

const SIGNER_ROLE = keccak256(toBytes("SIGNER_ROLE"));
const PACK = skuId("premium_pack");
const PASS = skuId("season_pass");
const PACK_PRICE = parseTokenAmount("4.99", 6); // 4_990_000

async function fixture() {
  const [admin, treasury, signer, buyer, other] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const usd = await hre.viem.deployContract("MockStablecoin", []);
  const store = await hre.viem.deployContract("PremiumStore", [admin!.account.address, treasury!.account.address, signer!.account.address, admin!.account.address, 3000]);
  await store.write.setAcceptedToken([usd.address, true]);
  await store.write.setPrice([PACK, usd.address, PACK_PRICE]);
  await store.write.setSkuActive([PACK, true]);
  await store.write.setPrice([PASS, usd.address, parseTokenAmount("9.99", 6)]);
  await store.write.setSkuActive([PASS, true]);
  for (const w of [buyer!, other!]) {
    await usd.write.mint([w.account.address, parseTokenAmount("1000", 6)]);
    const t = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: w } });
    await t.write.approve([store.address, 2n ** 256n - 1n]);
  }
  const asBuyer = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: buyer! } });
  const asOther = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: other! } });
  const chainId = await publicClient.getChainId();

  async function order(overrides: Partial<PurchaseOrder> = {}): Promise<PurchaseOrder> {
    return {
      orderId: newOrderId(),
      buyer: getAddress(buyer!.account.address),
      sku: PACK,
      quantity: 1,
      token: usd.address,
      maxTotal: PACK_PRICE,
      deadline: (await latestTimestamp()) + 600n,
      ...overrides,
    };
  }
  async function sign(o: PurchaseOrder, by = signer!, verifyingContract: Address = store.address, cid = chainId): Promise<Hex> {
    return by.signTypedData({ account: by.account, ...orderTypedData(o, cid, verifyingContract) });
  }
  return { admin: admin!, treasury: treasury!, signer: signer!, buyer: buyer!, other: other!, usd, store, asBuyer, asOther, publicClient, chainId, order, sign };
}

describe("PremiumStore", () => {
  describe("purchase (happy paths)", () => {
    it("takes payment, marks the order fulfilled and emits Purchased", async () => {
      const { store, asBuyer, usd, buyer, publicClient, order, sign } = await loadFixture(fixture);
      const o = await order();
      const before = await usd.read.balanceOf([buyer.account.address]);
      const hash = await asBuyer.write.purchase([o, await sign(o)]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      expect(before - (await usd.read.balanceOf([buyer.account.address]))).to.equal(PACK_PRICE);
      expect(await usd.read.balanceOf([store.address])).to.equal(PACK_PRICE);
      expect(await store.read.isFulfilled([o.orderId])).to.equal(true);
      expect(await store.read.orderBuyer([o.orderId])).to.equal(getAddress(buyer.account.address));
      const [ev] = await store.getEvents.Purchased({ orderId: o.orderId }, { fromBlock: receipt.blockNumber });
      expect(ev!.args).to.deep.equal({
        orderId: o.orderId,
        buyer: getAddress(buyer.account.address),
        sku: PACK,
        token: getAddress(usd.address),
        quantity: 1,
        unitPrice: PACK_PRICE,
        total: PACK_PRICE,
      });
      console.log(`      purchase gas: ${receipt.gasUsed}`);
    });

    it("multiplies by quantity and respects maxTotal", async () => {
      const { asBuyer, usd, store, order, sign } = await loadFixture(fixture);
      const o = await order({ quantity: 3, maxTotal: PACK_PRICE * 3n });
      await asBuyer.write.purchase([o, await sign(o)]);
      expect(await usd.read.balanceOf([store.address])).to.equal(PACK_PRICE * 3n);
    });

    it("hashOrder equals viem's EIP-712 digest (server signer parity)", async () => {
      const { store, order, chainId } = await loadFixture(fixture);
      const o = await order();
      expect(await store.read.hashOrder([o])).to.equal(hashTypedData(orderTypedData(o, chainId, store.address)));
    });
  });

  describe("idempotency, replay and front-running", () => {
    it("a replayed orderId reverts (no double fulfilment)", async () => {
      const { asBuyer, order, sign } = await loadFixture(fixture);
      const o = await order();
      const sig = await sign(o);
      await asBuyer.write.purchase([o, sig]);
      await expectRevert(asBuyer.write.purchase([o, sig]), "OrderAlreadyFulfilled");
      // Even a freshly signed voucher reusing the id is rejected.
      const o2 = { ...o, sku: PASS, maxTotal: parseTokenAmount("9.99", 6) };
      await expectRevert(asBuyer.write.purchase([o2, await sign(o2)]), "OrderAlreadyFulfilled");
    });

    it("someone else cannot submit (front-run) the buyer's voucher", async () => {
      const { asOther, order, sign } = await loadFixture(fixture);
      const o = await order();
      await expectRevert(asOther.write.purchase([o, await sign(o)]), "NotOrderBuyer");
    });

    it("tampered fields, a non-signer key, another contract or another chain invalidate the signature", async () => {
      const { asBuyer, order, sign, other, chainId } = await loadFixture(fixture);
      const o = await order();
      const sig = await sign(o);
      await expectRevert(asBuyer.write.purchase([{ ...o, quantity: 2, maxTotal: PACK_PRICE * 2n }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.purchase([{ ...o, sku: PASS, maxTotal: 10n ** 9n }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.purchase([{ ...o, deadline: o.deadline + 1n }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.purchase([o, await sign(o, other)]), "InvalidSignature");
      await expectRevert(asBuyer.write.purchase([o, await sign(o, undefined, "0x000000000000000000000000000000000000dEaD")]), "InvalidSignature");
      await expectRevert(asBuyer.write.purchase([o, await sign(o, undefined, undefined, chainId + 1)]), "InvalidSignature");
      await expectRevert(asBuyer.write.purchase([o, "0x1234"]), "InvalidSignature");
    });

    it("expired vouchers revert", async () => {
      const { asBuyer, order, sign } = await loadFixture(fixture);
      const o = await order({ deadline: (await latestTimestamp()) - 1n });
      await expectRevert(asBuyer.write.purchase([o, await sign(o)]), "OrderExpired");
    });

    it("signer rotation: a revoked signer's vouchers stop working", async () => {
      const { store, asBuyer, order, sign, signer, other } = await loadFixture(fixture);
      const o = await order();
      const sig = await sign(o);
      await store.write.grantRole([SIGNER_ROLE, other.account.address]);
      await store.write.revokeRole([SIGNER_ROLE, signer.account.address]);
      await expectRevert(asBuyer.write.purchase([o, sig]), "InvalidSignature");
      await asBuyer.write.purchase([o, await sign(o, other)]);
    });
  });

  describe("wrong token / amount / catalogue", () => {
    it("rejects a token that is not accepted, and an accepted token without a price", async () => {
      const { store, asBuyer, order, sign } = await loadFixture(fixture);
      const other = await hre.viem.deployContract("MockStablecoin", []);
      const o = await order({ token: other.address });
      await expectRevert(asBuyer.write.purchase([o, await sign(o)]), "TokenNotAccepted");
      await store.write.setAcceptedToken([other.address, true]);
      const o2 = await order({ token: other.address });
      await expectRevert(asBuyer.write.purchase([o2, await sign(o2)]), "NotForSaleInToken");
    });

    it("rejects inactive SKUs", async () => {
      const { store, asBuyer, order, sign } = await loadFixture(fixture);
      await store.write.setSkuActive([PACK, false]);
      const o = await order();
      await expectRevert(asBuyer.write.purchase([o, await sign(o)]), "SkuInactive");
      const unknown = await order({ sku: skuId("cosmetic.gold-silks") });
      await expectRevert(asBuyer.write.purchase([unknown, await sign(unknown)]), "SkuInactive");
    });

    it("protects the buyer when the price rises after the voucher was signed", async () => {
      const { store, asBuyer, usd, order, sign } = await loadFixture(fixture);
      const o = await order();
      const sig = await sign(o);
      await store.write.setPrice([PACK, usd.address, PACK_PRICE + 1n]);
      await expectRevert(asBuyer.write.purchase([o, sig]), "PriceAboveMax");
    });

    it("rejects quantity 0 and above MAX_QUANTITY", async () => {
      const { asBuyer, order, sign } = await loadFixture(fixture);
      for (const quantity of [0, 101]) {
        const o = await order({ quantity, maxTotal: 10n ** 12n });
        await expectRevert(asBuyer.write.purchase([o, await sign(o)]), "InvalidQuantity");
      }
    });

    it("rejects fee-on-transfer tokens (received != price)", async () => {
      const { asBuyer, usd, order, sign } = await loadFixture(fixture);
      await usd.write.setFeeBps([100n]);
      const o = await order();
      await expectRevert(asBuyer.write.purchase([o, await sign(o)]), "UnexpectedAmountReceived");
    });

    it("a blocklisted (frozen) buyer cannot pay, and the order stays unused", async () => {
      const { store, asBuyer, usd, buyer, order, sign } = await loadFixture(fixture);
      await usd.write.setBlocked([buyer.account.address, true]);
      const o = await order();
      await expectAnyRevert(asBuyer.write.purchase([o, await sign(o)]));
      expect(await store.read.isFulfilled([o.orderId])).to.equal(false);
    });

    it("fails without allowance and leaves the order unused", async () => {
      const { store, asBuyer, usd, buyer, order, sign } = await loadFixture(fixture);
      const t = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: buyer } });
      await t.write.approve([store.address, 0n]);
      const o = await order();
      await expectAnyRevert(asBuyer.write.purchase([o, await sign(o)]));
      expect(await store.read.isFulfilled([o.orderId])).to.equal(false);
    });

    it("refuses plain ETH transfers (no payable entry points)", async () => {
      const { store, buyer } = await loadFixture(fixture);
      await expectAnyRevert(buyer.sendTransaction({ to: store.address, value: parseEther("1") }));
    });
  });

  describe("reentrancy", () => {
    it("a hostile allow-listed token cannot re-enter purchase", async () => {
      const { store, asBuyer, buyer, order, sign } = await loadFixture(fixture);
      const evil = await hre.viem.deployContract("MockReentrantToken", []);
      await store.write.setAcceptedToken([evil.address, true]);
      await store.write.setPrice([PACK, evil.address, 1000n]);
      await evil.write.mint([buyer.account.address, 10n ** 9n]);
      const evilAsBuyer = await hre.viem.getContractAt("MockReentrantToken", evil.address, { client: { wallet: buyer } });
      await evilAsBuyer.write.approve([store.address, 10n ** 9n]);
      const inner = await order({ token: evil.address, maxTotal: 1000n });
      const payload = encodeFunctionData({ abi: store.abi, functionName: "purchase", args: [inner, await sign(inner)] });
      await evil.write.arm([store.address, payload]);
      const outer = await order({ token: evil.address, maxTotal: 1000n });
      await expectRevert(asBuyer.write.purchase([outer, await sign(outer)]), "ReentrancyGuardReentrantCall");
    });
  });

  describe("pausing", () => {
    it("pause blocks purchases; only admin unpauses", async () => {
      const { store, asBuyer, order, sign } = await loadFixture(fixture);
      await expectRevert(asBuyer.write.pause(), "AccessControlUnauthorizedAccount");
      await store.write.pause();
      const o = await order();
      const sig = await sign(o);
      await expectRevert(asBuyer.write.purchase([o, sig]), "EnforcedPause");
      await expectRevert(asBuyer.write.unpause(), "AccessControlUnauthorizedAccount");
      await store.write.unpause();
      await asBuyer.write.purchase([o, sig]);
    });
  });

  describe("admin & treasury", () => {
    it("price updates are role-gated and emit PriceSet(old, new)", async () => {
      const { store, asBuyer, usd, publicClient } = await loadFixture(fixture);
      await expectRevert(asBuyer.write.setPrice([PACK, usd.address, 1n]), "AccessControlUnauthorizedAccount");
      await expectRevert(asBuyer.write.setSkuActive([PACK, false]), "AccessControlUnauthorizedAccount");
      await expectRevert(asBuyer.write.setAcceptedToken([usd.address, false]), "AccessControlUnauthorizedAccount");
      await expectRevert(store.write.setPrice([PACK, ZERO_ADDRESS, 1n]), "ZeroAddress");
      const hash = await store.write.setPrice([PACK, usd.address, 5_490_000n]);
      const { blockNumber } = await publicClient.waitForTransactionReceipt({ hash });
      const [ev] = await store.getEvents.PriceSet({ sku: PACK }, { fromBlock: blockNumber });
      expect(ev!.args).to.deep.equal({ sku: PACK, token: getAddress(usd.address), oldPrice: PACK_PRICE, newPrice: 5_490_000n });
      expect(await store.read.priceOf([PACK, usd.address])).to.equal(5_490_000n);
    });

    it("withdraw only goes to the treasury, only by TREASURER_ROLE, and works while paused", async () => {
      const { store, asBuyer, usd, treasury, order, sign } = await loadFixture(fixture);
      const o = await order({ quantity: 2, maxTotal: PACK_PRICE * 2n });
      await asBuyer.write.purchase([o, await sign(o)]);
      await expectRevert(asBuyer.write.withdraw([usd.address, 1n]), "AccessControlUnauthorizedAccount");
      await store.write.pause();
      await store.write.withdraw([usd.address, PACK_PRICE * 2n]);
      expect(await usd.read.balanceOf([treasury.account.address])).to.equal(PACK_PRICE * 2n);
      expect(await usd.read.balanceOf([store.address])).to.equal(0n);
      await expectAnyRevert(store.write.withdraw([usd.address, 1n])); // nothing left
    });

    it("treasury changes are admin-only and non-zero", async () => {
      const { store, asBuyer, other } = await loadFixture(fixture);
      await expectRevert(asBuyer.write.setTreasury([other.account.address]), "AccessControlUnauthorizedAccount");
      await expectRevert(store.write.setTreasury([ZERO_ADDRESS]), "ZeroAddress");
      await store.write.setTreasury([other.account.address]);
      expect(await store.read.treasury()).to.equal(getAddress(other.account.address));
    });

    it("rejects zero addresses in the constructor", async () => {
      const [a] = await hre.viem.getWalletClients();
      const x = a!.account.address;
      await expectRevert(hre.viem.deployContract("PremiumStore", [ZERO_ADDRESS, x, x, x, 3000]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("PremiumStore", [x, ZERO_ADDRESS, x, x, 3000]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("PremiumStore", [x, x, ZERO_ADDRESS, x, 3000]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("PremiumStore", [x, x, x, ZERO_ADDRESS, 3000]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("PremiumStore", [x, x, x, x, 999]), "PoolBpsOutOfRange");
      await expectRevert(hre.viem.deployContract("PremiumStore", [x, x, x, x, 5001]), "PoolBpsOutOfRange");
    });
  });
});
