import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeFunctionData, getAddress, hashTypedData, keccak256, parseEther, recoverTypedDataAddress, toBytes, type Address, type Hex } from "viem";
import {
  bidTypedData,
  horseMarketFee,
  horseRef,
  registrationOrderTypedData,
  saleOrderTypedData,
  type RegistrationOrder,
  type SaleOrder,
} from "../adapter/horseMarket";
import { newOrderId, parseTokenAmount } from "../adapter/voucher";
import { expectAnyRevert, expectRevert, latestTimestamp, ZERO_ADDRESS } from "./helpers";

const SIGNER_ROLE = keccak256(toBytes("SIGNER_ROLE"));
const PRICE = parseTokenAmount("25", 6); // 25 USDG
const FEE_BPS = 500;
const REG_FEE = parseTokenAmount("2", 6);
const HORSE = horseRef("6f1c1f9e-2d0c-4f43-9b4c-2b2f1d7e8a10");

async function fixture() {
  const [admin, treasury, signer, buyer, seller, other] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const usd = await hre.viem.deployContract("MockStablecoin", []);
  const market = await hre.viem.deployContract("HorseMarket", [admin!.account.address, treasury!.account.address, signer!.account.address, usd.address, FEE_BPS]);
  for (const w of [buyer!, other!, seller!]) {
    await usd.write.mint([w.account.address, parseTokenAmount("1000", 6)]);
    const t = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: w } });
    await t.write.approve([market.address, 2n ** 256n - 1n]);
  }
  const as = (w: typeof buyer) => hre.viem.getContractAt("HorseMarket", market.address, { client: { wallet: w! } });
  const asBuyer = await as(buyer);
  const asSeller = await as(seller);
  const asOther = await as(other);
  const chainId = await publicClient.getChainId();

  async function sale(overrides: Partial<SaleOrder> = {}): Promise<SaleOrder> {
    const price = overrides.price ?? PRICE;
    return {
      orderId: newOrderId(),
      horseRef: HORSE,
      seller: getAddress(seller!.account.address),
      buyer: getAddress(buyer!.account.address),
      token: getAddress(usd.address),
      price,
      fee: horseMarketFee(price, FEE_BPS),
      deadline: (await latestTimestamp()) + 86_400n,
      ...overrides,
    };
  }
  async function reg(overrides: Partial<RegistrationOrder> = {}): Promise<RegistrationOrder> {
    return {
      orderId: newOrderId(),
      horseRef: HORSE,
      owner: getAddress(seller!.account.address),
      token: getAddress(usd.address),
      fee: REG_FEE,
      deadline: (await latestTimestamp()) + 900n,
      ...overrides,
    };
  }
  async function signSale(o: SaleOrder, by = signer!, verifyingContract: Address = market.address, cid = chainId): Promise<Hex> {
    return by.signTypedData({ account: by.account, ...saleOrderTypedData(o, cid, verifyingContract) });
  }
  async function signReg(o: RegistrationOrder, by = signer!, verifyingContract: Address = market.address, cid = chainId): Promise<Hex> {
    return by.signTypedData({ account: by.account, ...registrationOrderTypedData(o, cid, verifyingContract) });
  }
  const bal = (a: Address) => usd.read.balanceOf([a]);
  return { admin: admin!, treasury: treasury!, signer: signer!, buyer: buyer!, seller: seller!, other: other!, usd, market, asBuyer, asSeller, asOther, publicClient, chainId, sale, reg, signSale, signReg, bal };
}

describe("HorseMarket", () => {
  describe("buy (happy path, no custody)", () => {
    it("pays the seller price - fee and the treasury the fee in one tx, holds nothing, emits Sold", async () => {
      const { market, asBuyer, buyer, seller, treasury, publicClient, sale, signSale, bal } = await loadFixture(fixture);
      const o = await sale();
      const [b0, s0, t0] = await Promise.all([bal(buyer.account.address), bal(seller.account.address), bal(treasury.account.address)]);
      const hash = await asBuyer.write.buy([o, await signSale(o)]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).to.equal("success");
      const fee = (PRICE * 500n) / 10_000n;
      expect(fee).to.equal(1_250_000n);
      expect(b0 - (await bal(buyer.account.address))).to.equal(PRICE);
      expect((await bal(seller.account.address)) - s0).to.equal(PRICE - fee);
      expect((await bal(treasury.account.address)) - t0).to.equal(fee);
      expect(await bal(market.address)).to.equal(0n); // never holds funds
      expect(await market.read.isUsed([o.orderId])).to.equal(true);
      expect(await market.read.orderPayer([o.orderId])).to.equal(getAddress(buyer.account.address));
      const [ev] = await market.getEvents.Sold({ orderId: o.orderId }, { fromBlock: receipt.blockNumber });
      expect(ev!.args).to.deep.equal({ orderId: o.orderId, horseRef: HORSE, seller: getAddress(seller.account.address), buyer: getAddress(buyer.account.address), price: PRICE, fee });
      console.log(`      buy gas: ${receipt.gasUsed}`);
    });

    it("hashSaleOrder / hashRegistrationOrder equal viem's EIP-712 digests (adapter byte parity)", async () => {
      const { market, sale, reg, chainId } = await loadFixture(fixture);
      const o = await sale();
      expect(await market.read.hashSaleOrder([o])).to.equal(hashTypedData(saleOrderTypedData(o, chainId, market.address)));
      const r = await reg();
      expect(await market.read.hashRegistrationOrder([r])).to.equal(hashTypedData(registrationOrderTypedData(r, chainId, market.address)));
    });

    it("horseRef is keccak256 of the namespaced lowercase uuid", () => {
      expect(horseRef("ABC")).to.equal(keccak256(toBytes("posttime:horse:abc")));
      expect(horseRef("6F1C1F9E-2D0C-4F43-9B4C-2B2F1D7E8A10")).to.equal(HORSE);
    });

    it("Bid typed data round-trips: the server recovers the bidder from the wallet's signature", async () => {
      const { market, buyer, chainId } = await loadFixture(fixture);
      const bid = { listingId: "1b2c3d4e-0000-4000-8000-000000000001", amount: parseTokenAmount("30", 6), bidder: getAddress(buyer.account.address), nonce: 7n };
      const sig = await buyer.signTypedData({ account: buyer.account, ...bidTypedData(bid, chainId, market.address) });
      expect(await recoverTypedDataAddress({ ...bidTypedData(bid, chainId, market.address), signature: sig })).to.equal(getAddress(buyer.account.address));
      // Bound to the chain and the market: another domain recovers someone else.
      expect(await recoverTypedDataAddress({ ...bidTypedData(bid, chainId + 1, market.address), signature: sig })).to.not.equal(getAddress(buyer.account.address));
      expect(await recoverTypedDataAddress({ ...bidTypedData({ ...bid, amount: bid.amount + 1n }, chainId, market.address), signature: sig })).to.not.equal(getAddress(buyer.account.address));
    });
  });

  describe("fee math", () => {
    it("accepts the floor and the ceiling of price × feeBps, nothing else", async () => {
      const { asBuyer, sale, signSale, treasury, bal } = await loadFixture(fixture);
      const price = 1_000_001n; // 5 % = 50_000.05 → floor 50_000, ceil 50_001
      const floor = await sale({ price, fee: 50_000n });
      await asBuyer.write.buy([floor, await signSale(floor)]);
      const ceil = await sale({ price, fee: 50_001n });
      await asBuyer.write.buy([ceil, await signSale(ceil)]);
      expect(await bal(treasury.account.address)).to.equal(100_001n);
      for (const fee of [49_999n, 50_002n, 0n]) {
        const bad = await sale({ price, fee });
        await expectRevert(asBuyer.write.buy([bad, await signSale(bad)]), "FeeMismatch");
      }
    });

    it("rejects fee > price and a zero price", async () => {
      const { asBuyer, sale, signSale } = await loadFixture(fixture);
      const o = await sale({ price: 10n, fee: 11n });
      await expectRevert(asBuyer.write.buy([o, await signSale(o)]), "FeeAbovePrice");
      const z = await sale({ price: 0n, fee: 0n });
      await expectRevert(asBuyer.write.buy([z, await signSale(z)]), "ZeroPrice");
    });

    it("feeBps is admin-only, capped at 10 %, and a 0 % fee pays the seller everything", async () => {
      const { market, asBuyer, sale, signSale, seller, treasury, bal, publicClient } = await loadFixture(fixture);
      await expectRevert(asBuyer.write.setFeeBps([100]), "AccessControlUnauthorizedAccount");
      await expectRevert(market.write.setFeeBps([1001]), "FeeBpsTooHigh");
      await market.write.setFeeBps([1000]);
      expect(await market.read.feeBps()).to.equal(1000);
      const hash = await market.write.setFeeBps([0]);
      const { blockNumber } = await publicClient.waitForTransactionReceipt({ hash });
      const [ev] = await market.getEvents.FeeBpsSet({ fromBlock: blockNumber });
      expect(ev!.args).to.deep.equal({ oldBps: 1000, newBps: 0 });
      const s0 = await bal(seller.account.address);
      const o = await sale({ fee: 0n });
      await asBuyer.write.buy([o, await signSale(o)]);
      expect((await bal(seller.account.address)) - s0).to.equal(PRICE);
      expect(await bal(treasury.account.address)).to.equal(0n);
    });

    it("an order signed at the old fee stops working when feeBps changes", async () => {
      const { market, asBuyer, sale, signSale } = await loadFixture(fixture);
      const o = await sale();
      const sig = await signSale(o);
      await market.write.setFeeBps([700]);
      await expectRevert(asBuyer.write.buy([o, sig]), "FeeMismatch");
    });

    it("property: for many prices and fee rates, seller + treasury == price and the contract keeps 0", async () => {
      const { market, asBuyer, sale, signSale, seller, treasury, bal } = await loadFixture(fixture);
      let seed = 12345n;
      const rnd = (m: bigint) => {
        seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
        return seed % m;
      };
      for (let i = 0; i < 12; i++) {
        const bps = Number(rnd(1001n));
        await market.write.setFeeBps([bps]);
        const price = 1n + rnd(parseTokenAmount("50", 6));
        const fee = rnd(2n) === 0n ? (price * BigInt(bps)) / 10_000n : (price * BigInt(bps) + 9_999n) / 10_000n;
        const [s0, t0] = [await bal(seller.account.address), await bal(treasury.account.address)];
        const o = await sale({ price, fee });
        await asBuyer.write.buy([o, await signSale(o)]);
        const ds = (await bal(seller.account.address)) - s0;
        const dt = (await bal(treasury.account.address)) - t0;
        expect(ds + dt).to.equal(price);
        expect(dt).to.equal(fee);
        expect(await bal(market.address)).to.equal(0n);
      }
    });
  });

  describe("signatures, replay, deadline, wrong buyer", () => {
    it("a replayed orderId reverts, also across buy and register (shared namespace)", async () => {
      const { asBuyer, asSeller, sale, reg, signSale, signReg } = await loadFixture(fixture);
      const o = await sale();
      const sig = await signSale(o);
      await asBuyer.write.buy([o, sig]);
      await expectRevert(asBuyer.write.buy([o, sig]), "OrderAlreadyUsed");
      const o2 = { ...o, price: PRICE * 2n, fee: horseMarketFee(PRICE * 2n, FEE_BPS) };
      await expectRevert(asBuyer.write.buy([o2, await signSale(o2)]), "OrderAlreadyUsed");
      const r = await reg({ orderId: o.orderId });
      await expectRevert(asSeller.write.register([r, await signReg(r)]), "OrderAlreadyUsed");
    });

    it("someone other than the named buyer can't submit the order (front-running)", async () => {
      const { asOther, asSeller, sale, signSale, reg, signReg } = await loadFixture(fixture);
      const o = await sale();
      await expectRevert(asOther.write.buy([o, await signSale(o)]), "NotOrderBuyer");
      const r = await reg();
      await expectRevert(asOther.write.register([r, await signReg(r)]), "NotOrderBuyer");
      // The seller can't buy their own horse even with a signed order.
      const self = await sale({ buyer: r.owner });
      await expectRevert(asSeller.write.buy([self, await signSale(self)]), "SelfTrade");
    });

    it("expired orders and orders valid for longer than MAX_ORDER_TTL revert", async () => {
      const { asBuyer, sale, signSale, asSeller, reg, signReg } = await loadFixture(fixture);
      const now = await latestTimestamp();
      const old = await sale({ deadline: now - 1n });
      await expectRevert(asBuyer.write.buy([old, await signSale(old)]), "OrderExpired");
      const far = await sale({ deadline: now + 5n * 86_400n });
      await expectRevert(asBuyer.write.buy([far, await signSale(far)]), "OrderTtlTooLong");
      const oldReg = await reg({ deadline: now - 1n });
      await expectRevert(asSeller.write.register([oldReg, await signReg(oldReg)]), "OrderExpired");
    });

    it("tampered fields, a non-signer, another contract or another chain invalidate the signature", async () => {
      const { asBuyer, sale, signSale, other, chainId, seller } = await loadFixture(fixture);
      const o = await sale();
      const sig = await signSale(o);
      await expectRevert(asBuyer.write.buy([{ ...o, price: PRICE - 1_000_000n, fee: horseMarketFee(PRICE - 1_000_000n, FEE_BPS) }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([{ ...o, seller: getAddress(other.account.address) }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([{ ...o, horseRef: horseRef("another") }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([{ ...o, deadline: o.deadline + 1n }, sig]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([o, await signSale(o, other)]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([o, await signSale(o, seller)]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([o, await signSale(o, undefined, "0x000000000000000000000000000000000000dEaD")]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([o, await signSale(o, undefined, undefined, chainId + 1)]), "InvalidSignature");
      await expectRevert(asBuyer.write.buy([o, "0x1234"]), "InvalidSignature");
    });

    it("signer rotation: a revoked signer's orders stop working", async () => {
      const { market, asBuyer, sale, signSale, signer, other } = await loadFixture(fixture);
      const o = await sale();
      const sig = await signSale(o);
      await market.write.grantRole([SIGNER_ROLE, other.account.address]);
      await market.write.revokeRole([SIGNER_ROLE, signer.account.address]);
      await expectRevert(asBuyer.write.buy([o, sig]), "InvalidSignature");
      await asBuyer.write.buy([o, await signSale(o, other)]);
    });
  });

  describe("register", () => {
    it("pays the registration fee to the treasury only and emits Registered", async () => {
      const { market, asSeller, seller, treasury, reg, signReg, bal, publicClient } = await loadFixture(fixture);
      const r = await reg();
      const s0 = await bal(seller.account.address);
      const hash = await asSeller.write.register([r, await signReg(r)]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(s0 - (await bal(seller.account.address))).to.equal(REG_FEE);
      expect(await bal(treasury.account.address)).to.equal(REG_FEE);
      expect(await bal(market.address)).to.equal(0n);
      const [ev] = await market.getEvents.Registered({ orderId: r.orderId }, { fromBlock: receipt.blockNumber });
      expect(ev!.args).to.deep.equal({ orderId: r.orderId, horseRef: HORSE, owner: getAddress(seller.account.address), fee: REG_FEE });
      await expectRevert(asSeller.write.register([r, await signReg(r)]), "OrderAlreadyUsed");
      console.log(`      register gas: ${receipt.gasUsed}`);
    });

    it("rejects a zero fee, a tampered fee and an unaccepted token", async () => {
      const { asSeller, reg, signReg } = await loadFixture(fixture);
      const z = await reg({ fee: 0n });
      await expectRevert(asSeller.write.register([z, await signReg(z)]), "ZeroPrice");
      const r = await reg();
      await expectRevert(asSeller.write.register([{ ...r, fee: 1n }, await signReg(r)]), "InvalidSignature");
      const other = await hre.viem.deployContract("MockStablecoin", []);
      const t = await reg({ token: other.address });
      await expectRevert(asSeller.write.register([t, await signReg(t)]), "TokenNotAccepted");
    });
  });

  describe("tokens and exact amounts", () => {
    it("only allow-listed tokens; the admin can delist USDG", async () => {
      const { market, asBuyer, sale, signSale, usd } = await loadFixture(fixture);
      const other = await hre.viem.deployContract("MockStablecoin", []);
      const o = await sale({ token: other.address });
      await expectRevert(asBuyer.write.buy([o, await signSale(o)]), "TokenNotAccepted");
      await expectRevert(asBuyer.write.setAcceptedToken([other.address, true]), "AccessControlUnauthorizedAccount");
      await expectRevert(market.write.setAcceptedToken([ZERO_ADDRESS, true]), "ZeroAddress");
      await market.write.setAcceptedToken([usd.address, false]);
      const o2 = await sale();
      await expectRevert(asBuyer.write.buy([o2, await signSale(o2)]), "TokenNotAccepted");
    });

    it("rejects fee-on-transfer tokens (received != amount) and leaves the order unused", async () => {
      const { market, asBuyer, sale, signSale, usd } = await loadFixture(fixture);
      await usd.write.setFeeBps([100n]);
      const o = await sale();
      await expectRevert(asBuyer.write.buy([o, await signSale(o)]), "UnexpectedAmountReceived");
      expect(await market.read.isUsed([o.orderId])).to.equal(false);
    });

    it("a frozen buyer, seller or treasury, or a missing allowance, fails without using the order", async () => {
      const { market, asBuyer, sale, signSale, usd, buyer, seller, treasury } = await loadFixture(fixture);
      for (const who of [buyer, seller, treasury]) {
        await usd.write.setBlocked([who.account.address, true]);
        const o = await sale();
        await expectAnyRevert(asBuyer.write.buy([o, await signSale(o)]));
        expect(await market.read.isUsed([o.orderId])).to.equal(false);
        await usd.write.setBlocked([who.account.address, false]);
      }
      const t = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: buyer } });
      await t.write.approve([market.address, PRICE - 1n]);
      const o = await sale();
      await expectAnyRevert(asBuyer.write.buy([o, await signSale(o)]));
      expect(await market.read.isUsed([o.orderId])).to.equal(false);
    });

    it("rejects a zero seller and plain ETH (no payable entry points)", async () => {
      const { market, asBuyer, sale, signSale, buyer } = await loadFixture(fixture);
      const o = await sale({ seller: ZERO_ADDRESS });
      await expectRevert(asBuyer.write.buy([o, await signSale(o)]), "ZeroAddress");
      await expectAnyRevert(buyer.sendTransaction({ to: market.address, value: parseEther("1") }));
    });
  });

  describe("reentrancy", () => {
    it("a hostile allow-listed token cannot re-enter buy", async () => {
      const { market, asBuyer, buyer, sale, signSale } = await loadFixture(fixture);
      const evil = await hre.viem.deployContract("MockReentrantToken", []);
      await market.write.setAcceptedToken([evil.address, true]);
      await evil.write.mint([buyer.account.address, 10n ** 12n]);
      const evilAsBuyer = await hre.viem.getContractAt("MockReentrantToken", evil.address, { client: { wallet: buyer } });
      await evilAsBuyer.write.approve([market.address, 10n ** 12n]);
      const inner = await sale({ token: evil.address });
      const payload = encodeFunctionData({ abi: market.abi, functionName: "buy", args: [inner, await signSale(inner)] });
      await evil.write.arm([market.address, payload]);
      const outer = await sale({ token: evil.address });
      await expectRevert(asBuyer.write.buy([outer, await signSale(outer)]), "ReentrancyGuardReentrantCall");
    });
  });

  describe("pausing and admin", () => {
    it("pause blocks buy and register; only the admin unpauses", async () => {
      const { market, asBuyer, asSeller, sale, reg, signSale, signReg } = await loadFixture(fixture);
      await expectRevert(asBuyer.write.pause(), "AccessControlUnauthorizedAccount");
      await market.write.pause();
      const o = await sale();
      const sig = await signSale(o);
      await expectRevert(asBuyer.write.buy([o, sig]), "EnforcedPause");
      const r = await reg();
      await expectRevert(asSeller.write.register([r, await signReg(r)]), "EnforcedPause");
      await expectRevert(asBuyer.write.unpause(), "AccessControlUnauthorizedAccount");
      await market.write.unpause();
      await asBuyer.write.buy([o, sig]);
    });

    it("treasury changes are admin-only and non-zero, and fees follow the new treasury", async () => {
      const { market, asBuyer, other, sale, signSale, bal } = await loadFixture(fixture);
      await expectRevert(asBuyer.write.setTreasury([other.account.address]), "AccessControlUnauthorizedAccount");
      await expectRevert(market.write.setTreasury([ZERO_ADDRESS]), "ZeroAddress");
      await market.write.setTreasury([other.account.address]);
      expect(await market.read.treasury()).to.equal(getAddress(other.account.address));
      const o0 = await bal(other.account.address);
      const o = await sale();
      await asBuyer.write.buy([o, await signSale(o)]);
      expect((await bal(other.account.address)) - o0).to.equal(o.fee);
    });

    it("rejects zero addresses and a fee above 10 % in the constructor", async () => {
      const [a] = await hre.viem.getWalletClients();
      const x = a!.account.address;
      await expectRevert(hre.viem.deployContract("HorseMarket", [ZERO_ADDRESS, x, x, x, 500]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("HorseMarket", [x, ZERO_ADDRESS, x, x, 500]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("HorseMarket", [x, x, ZERO_ADDRESS, x, 500]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("HorseMarket", [x, x, x, ZERO_ADDRESS, 500]), "ZeroAddress");
      await expectRevert(hre.viem.deployContract("HorseMarket", [x, x, x, x, 1001]), "FeeBpsTooHigh");
    });
  });
});
