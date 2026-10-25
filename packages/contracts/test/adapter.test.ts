import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress, keccak256, toBytes, type Address, type PublicClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  buildCommitmentBatch,
  ChainConfigError,
  createChainAdapter,
  EvmChainAdapter,
  isWeb3Enabled,
  KIND_COMMITMENT,
  KIND_RESULT,
  MockChainAdapter,
  newOrderId,
  orderTypedData,
  ProofBatchConflictError,
  readChainConfig,
  skuId,
  toBytes32,
  type PurchaseOrder,
} from "../adapter";
import { engineCommitSeed, localServerWallet, random32, latestTimestamp } from "./helpers";

const PACK = skuId("premium_pack");
const BUYER: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x2222222222222222222222222222222222222222";

function mockOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return { orderId: newOrderId(), buyer: BUYER, sku: PACK, quantity: 1, token: TOKEN, maxTotal: 4_990_000n, deadline: 9_999_999_999n, ...overrides };
}

describe("chain adapter: config & feature flag", () => {
  it("WEB3_ENABLED defaults to off and yields the mock adapter", () => {
    expect(isWeb3Enabled({})).to.equal(false);
    expect(isWeb3Enabled({ WEB3_ENABLED: "1" })).to.equal(false);
    expect(isWeb3Enabled({ WEB3_ENABLED: "TRUE" })).to.equal(true);
    const a = createChainAdapter({});
    expect(a.kind).to.equal("mock");
    expect(a.chainId).to.equal(46630); // Robinhood Chain Testnet by default
  });

  it("reads and validates config", () => {
    const c = readChainConfig({
      ROBINHOOD_CHAIN_ID: "4663",
      PREMIUM_STORE_ADDRESS: "0x2222222222222222222222222222222222222222",
      CHAIN_MIN_CONFIRMATIONS: "3",
      CHAIN_PURCHASE_FINALITY: "safe",
    });
    expect(c).to.deep.include({ chainId: 4663, minConfirmations: 3, purchaseFinality: "safe", enabled: false });
    expect(() => readChainConfig({ PREMIUM_STORE_ADDRESS: "nope" })).to.throw(ChainConfigError);
    expect(() => readChainConfig({ CHAIN_PURCHASE_FINALITY: "instant" })).to.throw(ChainConfigError);
    expect(() => readChainConfig({ CHAIN_MIN_CONFIRMATIONS: "0" })).to.throw(ChainConfigError);
  });

  it("enabled but misconfigured fails loudly; bad keys are never echoed", () => {
    expect(() => createChainAdapter({ WEB3_ENABLED: "true" })).to.throw(/ROBINHOOD_RPC_URL/);
    expect(() => createChainAdapter({ WEB3_ENABLED: "true", ROBINHOOD_RPC_URL: "http://127.0.0.1:1" })).to.throw(/PREMIUM_STORE_ADDRESS/);
    const secretish = "0xnot-a-real-key-but-pretend-it-is-secret";
    try {
      createChainAdapter({
        WEB3_ENABLED: "true",
        ROBINHOOD_RPC_URL: "http://127.0.0.1:1",
        PREMIUM_STORE_ADDRESS: TOKEN,
        STORE_SIGNER_PRIVATE_KEY: secretish,
      });
      expect.fail("should throw");
    } catch (e) {
      expect((e as Error).message).to.include("STORE_SIGNER_PRIVATE_KEY");
      expect((e as Error).message).to.not.include(secretish);
    }
  });

  it("enabled + configured yields the EVM adapter (no network call at construction)", () => {
    const a = createChainAdapter({
      WEB3_ENABLED: "true",
      ROBINHOOD_RPC_URL: "http://127.0.0.1:1",
      PREMIUM_STORE_ADDRESS: TOKEN,
      STORE_SIGNER_PRIVATE_KEY: generatePrivateKey(),
    });
    expect(a.kind).to.equal("evm");
  });
});

describe("MockChainAdapter", () => {
  it("verifies a simulated purchase and returns an idempotency key", async () => {
    const m = new MockChainAdapter();
    const o = mockOrder();
    const v = await m.createPurchaseVoucher(o);
    expect(v.mock).to.equal(true);
    const tx = m.simulatePurchase(o, 4_990_000n);
    const res = await m.verifyPurchase(tx, { orderId: o.orderId, sku: PACK, buyer: BUYER, quantity: 1, token: TOKEN, minTotal: 4_990_000n });
    expect(res.status).to.equal("confirmed");
    if (res.status !== "confirmed") return;
    expect(res.purchase.total).to.equal(4_990_000n);
    expect(res.purchase.idempotencyKey).to.equal(`31337:${m.storeAddress.toLowerCase()}:${o.orderId}`);
    // Verification itself is idempotent (pure read).
    expect((await m.verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).status).to.equal("confirmed");
  });

  it("mirrors the contract: replayed orderIds and maxTotal violations throw", () => {
    const m = new MockChainAdapter();
    const o = mockOrder();
    m.simulatePurchase(o, 1n);
    expect(() => m.simulatePurchase(o, 1n)).to.throw(/OrderAlreadyFulfilled/);
    expect(() => m.simulatePurchase(mockOrder({ maxTotal: 1n }), 2n)).to.throw(/PriceAboveMax/);
    expect(() => m.simulatePurchase(mockOrder({ quantity: 0 }), 1n)).to.throw(/InvalidQuantity/);
  });

  it("rejects mismatches and reports unknown tx as pending", async () => {
    const m = new MockChainAdapter();
    const o = mockOrder({ quantity: 2, maxTotal: 10n });
    const tx = m.simulatePurchase(o, 5n);
    const base = { orderId: o.orderId, sku: PACK };
    expect(await m.verifyPurchase(tx, { ...base, sku: skuId("season_pass") })).to.deep.include({ status: "rejected", reason: "sku_mismatch" });
    expect(await m.verifyPurchase(tx, { ...base, buyer: TOKEN })).to.deep.include({ status: "rejected", reason: "buyer_mismatch" });
    expect(await m.verifyPurchase(tx, { ...base, quantity: 1 })).to.deep.include({ status: "rejected", reason: "quantity_mismatch" });
    expect(await m.verifyPurchase(tx, { ...base, token: BUYER })).to.deep.include({ status: "rejected", reason: "token_mismatch" });
    expect(await m.verifyPurchase(tx, { ...base, minTotal: 11n })).to.deep.include({ status: "rejected", reason: "amount_too_low" });
    expect(await m.verifyPurchase(tx, { ...base, orderId: newOrderId() })).to.deep.include({ status: "rejected", reason: "event_not_found" });
    expect(await m.verifyPurchase(random32(), base)).to.deep.include({ status: "pending", reason: "unknown_tx" });
  });

  it("waits for the configured confirmations", async () => {
    const m = new MockChainAdapter({ minConfirmations: 3 });
    const o = mockOrder();
    const tx = m.simulatePurchase(o, 1n);
    expect(await m.verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).to.deep.include({ status: "pending", reason: "confirmations", confirmations: 1 });
    m.mineBlocks(2);
    expect((await m.verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).status).to.equal("confirmed");
  });

  it("proof batches are write-once and idempotent", async () => {
    const m = new MockChainAdapter();
    const root = random32();
    expect((await m.publishProofBatch({ kind: KIND_COMMITMENT, batchId: 1n, root, leafCount: 3 })).status).to.equal("published");
    expect((await m.publishProofBatch({ kind: KIND_COMMITMENT, batchId: 1n, root, leafCount: 3 })).status).to.equal("already_published");
    let threw = false;
    try {
      await m.publishProofBatch({ kind: KIND_COMMITMENT, batchId: 1n, root: random32(), leafCount: 3 });
    } catch (e) {
      threw = e instanceof ProofBatchConflictError;
    }
    expect(threw).to.equal(true);
    expect((await m.getProofBatch(KIND_COMMITMENT, 1n))?.root).to.equal(root);
    expect(await m.getProofBatch(KIND_RESULT, 1n)).to.equal(null);
  });

  it("balances default to zero and can be seeded for UI dev", async () => {
    const m = new MockChainAdapter();
    expect(await m.getBalances(BUYER)).to.deep.equal({ address: BUYER, native: 0n });
    m.setBalances({ address: BUYER, native: 5n, paymentToken: { token: TOKEN, symbol: "USDG", decimals: 6, amount: 7n } });
    expect((await m.getBalances(BUYER)).paymentToken?.amount).to.equal(7n);
  });
});

async function evmFixture() {
  const [admin, buyer] = await hre.viem.getWalletClients();
  const publicClient = (await hre.viem.getPublicClient()) as unknown as PublicClient;
  const server = await localServerWallet(); // runtime-generated key, like the production server key
  const usd = await hre.viem.deployContract("MockStablecoin", []);
  const store = await hre.viem.deployContract("PremiumStore", [admin!.account.address, admin!.account.address, server.account.address]);
  const registry = await hre.viem.deployContract("RaceProofRegistry", [admin!.account.address, server.account.address]);
  await store.write.setAcceptedToken([usd.address, true]);
  await store.write.setPrice([PACK, usd.address, 4_990_000n]);
  await store.write.setSkuActive([PACK, true]);
  await usd.write.mint([buyer!.account.address, 100_000_000n]);
  const usdAsBuyer = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: buyer! } });
  await usdAsBuyer.write.approve([store.address, 2n ** 256n - 1n]);
  const storeAsBuyer = await hre.viem.getContractAt("PremiumStore", store.address, { client: { wallet: buyer! } });
  const chainId = await publicClient.getChainId();
  const make = (extra: Partial<ConstructorParameters<typeof EvmChainAdapter>[0]> = {}) =>
    new EvmChainAdapter({
      publicClient,
      chainId,
      premiumStore: getAddress(store.address),
      raceProofRegistry: getAddress(registry.address),
      paymentToken: getAddress(usd.address),
      publisher: server.wallet,
      voucherSigner: server.account,
      ...extra,
    });
  const order = async (): Promise<PurchaseOrder> => ({
    orderId: newOrderId(),
    buyer: getAddress(buyer!.account.address),
    sku: PACK,
    quantity: 1,
    token: getAddress(usd.address),
    maxTotal: 4_990_000n,
    deadline: (await latestTimestamp()) + 600n,
  });
  return { admin: admin!, buyer: buyer!, publicClient, usd, store, storeAsBuyer, registry, make, order, chainId };
}

describe("EvmChainAdapter (against the Hardhat network)", () => {
  it("signs a voucher the contract accepts, then verifies the purchase tx", async () => {
    const { make, order, storeAsBuyer, buyer, usd } = await loadFixture(evmFixture);
    const adapter = make();
    const o = await order();
    const voucher = await adapter.createPurchaseVoucher(o);
    expect(voucher.mock).to.equal(false);
    const tx = await storeAsBuyer.write.purchase([voucher.order, voucher.signature]);
    const res = await adapter.verifyPurchase(tx, {
      orderId: o.orderId,
      sku: PACK,
      buyer: getAddress(buyer.account.address),
      quantity: 1,
      token: getAddress(usd.address),
      minTotal: 4_990_000n,
    });
    expect(res.status).to.equal("confirmed");
    if (res.status === "confirmed") {
      expect(res.purchase.total).to.equal(4_990_000n);
      expect(res.purchase.confirmations).to.equal(1);
      expect(res.purchase.idempotencyKey).to.include(o.orderId);
    }
    // wrong expectations
    expect(await adapter.verifyPurchase(tx, { orderId: o.orderId, sku: skuId("season_pass") })).to.deep.include({ reason: "sku_mismatch" });
    expect(await adapter.verifyPurchase(tx, { orderId: newOrderId(), sku: PACK })).to.deep.include({ reason: "event_not_found" });
  });

  it("ignores identical events from a different (fake) store", async () => {
    const { make, order, admin, usd, buyer } = await loadFixture(evmFixture);
    const signerAdapter = make();
    const fake = await hre.viem.deployContract("PremiumStore", [admin.account.address, admin.account.address, admin.account.address]);
    await fake.write.setAcceptedToken([usd.address, true]);
    await fake.write.setPrice([PACK, usd.address, 1n]);
    await fake.write.setSkuActive([PACK, true]);
    const usdAsBuyer = await hre.viem.getContractAt("MockStablecoin", usd.address, { client: { wallet: buyer } });
    await usdAsBuyer.write.approve([fake.address, 10n]);
    const o = { ...(await order()), maxTotal: 1n };
    const sig = await admin.signTypedData({ account: admin.account, ...orderTypedData(o, signerAdapter.chainId, fake.address) });
    const fakeAsBuyer = await hre.viem.getContractAt("PremiumStore", fake.address, { client: { wallet: buyer } });
    const tx = await fakeAsBuyer.write.purchase([o, sig]);
    expect(await signerAdapter.verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).to.deep.include({ status: "rejected", reason: "event_not_found" });
  });

  it("pending for unknown tx and until confirmations / finality are reached", async () => {
    const { make, order, storeAsBuyer } = await loadFixture(evmFixture);
    expect(await make().verifyPurchase(random32(), { orderId: newOrderId(), sku: PACK })).to.deep.include({ status: "pending", reason: "unknown_tx" });
    const adapter = make({ minConfirmations: 3 });
    const o = await order();
    const v = await adapter.createPurchaseVoucher(o);
    const tx = await storeAsBuyer.write.purchase([v.order, v.signature]);
    expect(await adapter.verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).to.deep.include({ status: "pending", reason: "confirmations" });
    await mine(2);
    expect((await adapter.verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).status).to.equal("confirmed");
    // "finalized" uses the node's finalized tag (on Robinhood Chain: L1-finalized batch).
    const finalizedAdapter = make({ purchaseFinality: "finalized" });
    const r = await finalizedAdapter.verifyPurchase(tx, { orderId: o.orderId, sku: PACK });
    expect(["confirmed", "pending"]).to.include(r.status);
  });

  it("rejects when the RPC is on a different chain", async () => {
    const { make, order, storeAsBuyer, chainId } = await loadFixture(evmFixture);
    const good = make();
    const o = await order();
    const v = await good.createPurchaseVoucher(o);
    const tx = await storeAsBuyer.write.purchase([v.order, v.signature]);
    expect(await make({ chainId: chainId + 1 }).verifyPurchase(tx, { orderId: o.orderId, sku: PACK })).to.deep.include({ reason: "wrong_chain" });
  });

  it("publishes proof batch roots idempotently and the proofs verify on-chain", async () => {
    const { make, registry } = await loadFixture(evmFixture);
    const adapter = make();
    const items = Array.from({ length: 7 }, (_, i) => {
      const seed = random32().slice(2);
      return { raceId: `card-1-race-${i}`, seedCommitment: engineCommitSeed(seed) };
    });
    const batch = buildCommitmentBatch(items);
    const first = await adapter.publishProofBatch({ kind: KIND_COMMITMENT, batchId: 42n, root: batch.root, leafCount: batch.leafCount, manifestUri: "https://example.invalid/b/42" });
    expect(first.status).to.equal("published");
    expect((await adapter.publishProofBatch({ kind: KIND_COMMITMENT, batchId: 42n, root: batch.root, leafCount: batch.leafCount })).status).to.equal("already_published");
    let conflict = false;
    try {
      await adapter.publishProofBatch({ kind: KIND_COMMITMENT, batchId: 42n, root: random32(), leafCount: 1 });
    } catch (e) {
      conflict = e instanceof ProofBatchConflictError;
    }
    expect(conflict).to.equal(true);
    expect((await adapter.getProofBatch(KIND_COMMITMENT, 42n))?.root).to.equal(batch.root);
    expect(await adapter.getProofBatch(KIND_RESULT, 42n)).to.equal(null);
    for (const e of batch.entries) {
      expect(await registry.read.verifyCommitment([42n, e.raceKey, toBytes32(e.seedCommitment), e.proof])).to.equal(true);
    }
  });

  it("refuses to publish without a publisher key", async () => {
    const { make } = await loadFixture(evmFixture);
    let threw = false;
    try {
      await make({ publisher: undefined }).publishProofBatch({ kind: KIND_COMMITMENT, batchId: 1n, root: random32(), leafCount: 1 });
    } catch (e) {
      threw = e instanceof ChainConfigError;
    }
    expect(threw).to.equal(true);
  });

  it("reads balances for display", async () => {
    const { make, buyer } = await loadFixture(evmFixture);
    const b = await make().getBalances(getAddress(buyer.account.address));
    expect(b.native > 0n).to.equal(true);
    expect(b.paymentToken).to.deep.include({ symbol: "mUSD", decimals: 6, amount: 100_000_000n });
  });

  it("role ids used by ops scripts match the contracts", async () => {
    const { registry } = await loadFixture(evmFixture);
    expect(await registry.read.PUBLISHER_ROLE()).to.equal(keccak256(toBytes("PUBLISHER_ROLE")));
  });
});
