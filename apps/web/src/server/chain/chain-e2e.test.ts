/**
 * END-TO-END on a local Hardhat node (opt-in: CHAIN_E2E=1, ~20 s):
 *   deploy PrizePool + PremiumStore with the same helper /admin/chain uses (a wallet client,
 *   no deploy key on a server) -> SIWE wallet links -> quote -> buyer pays with a viem wallet
 *   -> confirm (receipt + event verification) -> pool +30%, inviter +10%, owner +3% ->
 *   backstop settles an unconfirmed payment -> compute epoch -> post root with the server key
 *   -> time travel -> claim the vested ETH from the buyer's wallet.
 *
 *   CHAIN_E2E=1 npx vitest run src/server/chain/chain-e2e.test.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  claimOwner,
  createAccount,
  createDb,
  ensureReferralCode,
  generateInviteCodes,
  getChainOrder,
  listStableHorses,
  recordPlayDay,
  recordReferral,
  schema,
  stableOf,
  utcDay,
  type DbHandle,
} from "@thoroughbred/db";
import { premiumStoreAbi, prizePoolAbi } from "@/lib/chain/contracts.generated";
import { viemChain } from "@/lib/chain/chains";
import { deployBetaContracts } from "@/lib/chain/deploy";
import { quoteFromJson } from "@/lib/chain/quote";
import { EvmBetaChain } from "./adapter";
import { checkoutBackstop, confirmCheckout, quoteCheckout, type CheckoutCtx } from "./checkout";
import { readBetaConfig } from "./config";
import { computeEpochDraft, myAllocations, postEpochWithServer } from "./pool";
import { PriceService } from "./price";
import { linkWallet, walletChallenge } from "./wallet";
import type { Session } from "../session";

const RUN = process.env.CHAIN_E2E === "1";
const CONTRACTS = fileURLToPath(new URL("../../../../../packages/contracts", import.meta.url));
const HARDHAT = `${CONTRACTS}/node_modules/.bin/hardhat`;
const PORT = 8600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const DAY = 86_400_000;

let node: ChildProcess | undefined;
let h: DbHandle;
let pub: PublicClient;
const rpc = (method: string, params: unknown[] = []) => pub.request({ method: method as never, params: params as never });

async function waitForNode() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("hardhat node did not start");
}

describe.skipIf(!RUN || !existsSync(HARDHAT))("beta money end-to-end on a local Hardhat node", () => {
  beforeAll(async () => {
    node = spawn(HARDHAT, ["node", "--port", String(PORT)], { cwd: CONTRACTS, stdio: "ignore" });
    await waitForNode();
    pub = createPublicClient({ chain: viemChain(31337, RPC), transport: http(RPC) }) as PublicClient;
    h = await createDb({ url: null, pglite: "memory" });
  }, 60_000);
  afterAll(async () => {
    node?.kill();
    await h?.close();
  });

  it("deploy -> quote -> buy -> confirm -> pool +30% -> epoch -> claim", async () => {
    const chain31337 = viemChain(31337, RPC);
    const [ownerAddr, treasury] = (await rpc("eth_accounts")) as Address[];
    // The "owner's browser wallet": an unlocked Hardhat account (json-rpc), like an injected wallet.
    const ownerWallet = createWalletClient({ account: ownerAddr!, chain: chain31337, transport: http(RPC) });
    // Server signer: generated at runtime (never committed), funded for gas (it posts the root).
    const signerKey = generatePrivateKey();
    const signer = privateKeyToAccount(signerKey);
    await rpc("hardhat_setBalance", [signer.address, "0x56BC75E2D63100000"]);

    const d = await deployBetaContracts(ownerWallet, pub, { treasury: treasury!, signer: signer.address, poolBps: 3000, maxClaimPerEpochWei: parseEther("1"), grantPosterToSigner: true });
    expect(d.txs.length).toBeGreaterThanOrEqual(5);

    const cfg = readBetaConfig({
      WEB3_ENABLED: "true",
      CHAIN_ID: "31337",
      ROBINHOOD_RPC_URL: RPC,
      PREMIUM_STORE_ADDRESS: d.premiumStore,
      PRIZE_POOL_ADDRESS: d.prizePool,
      QUOTE_SIGNER_PRIVATE_KEY: signerKey,
    });
    const chain = new EvmBetaChain(cfg);
    const ctx: CheckoutCtx = { db: h.db, chain, price: new PriceService({ source: "fixed:3000" }), cfg };
    const st = await chain.storeState();
    expect(st).toMatchObject({ poolBps: 3000, premiumActive: true, signerHasRole: true, signerCanPost: true });

    // Players with their own wallets (local keys stand in for browser wallets).
    const now0 = new Date();
    let n = 0;
    const player = async () => {
      const acc = await createAccount(h.db, { stableName: `E2E ${++n}`, silks: { pattern: "hoops", primary: "#112233", secondary: "#445566", cap: "#778899" }, timezone: "UTC", now: now0 });
      const key = generatePrivateKey();
      const account = privateKeyToAccount(key);
      await rpc("hardhat_setBalance", [account.address, "0x56BC75E2D63100000"]); // 100 ETH
      const s: Session = { accountId: acc.accountId, stable: await stableOf(h.db, acc.accountId) };
      const ch = await walletChallenge(h.db, s, { address: account.address, host: "localhost:3000", proto: "http", chainId: 31337, now: now0 });
      await linkWallet(h.db, chain, s, { nonce: ch.nonce, signature: await account.signMessage({ message: ch.message }), now: now0 });
      return { s, account, wallet: createWalletClient({ account, chain: chain31337, transport: http(RPC) }) };
    };
    const owner = await player();
    await claimOwner(h.db, { accountId: owner.s.accountId, now: now0 });
    const [root] = await generateInviteCodes(h.db, { count: 1 });
    const inviter = await player();
    await recordReferral(h.db, { accountId: inviter.s.accountId, code: root!, now: now0 });
    const buyer = await player();
    await recordReferral(h.db, { accountId: buyer.s.accountId, code: await ensureReferralCode(h.db, inviter.s.accountId), now: now0 });

    const bal = (a: Address) => pub.getBalance({ address: a });
    const [inv0, own0, tre0] = [await bal(inviter.account.address), await bal(owner.account.address), await bal(treasury!)];

    // Quote -> pay from the buyer's wallet -> confirm.
    const q = await quoteCheckout(ctx, buyer.s, { sku: "premium_pack", quantity: 1, country: null, now: new Date() });
    expect(q.referral).toEqual({ level1: true, level2: true });
    const quote = quoteFromJson(q.quote);
    const hash = await buyer.wallet.writeContract({ address: d.premiumStore, abi: premiumStoreAbi, functionName: "purchaseWithEth", args: [quote, q.signature], value: quote.priceWei });
    await pub.waitForTransactionReceipt({ hash });
    const res = await confirmCheckout(ctx, buyer.s, { orderId: q.orderId, txHash: hash, now: new Date() });
    expect(res.status).toBe("fulfilled");
    expect(await confirmCheckout(ctx, buyer.s, { orderId: q.orderId, txHash: hash, now: new Date() })).toMatchObject({ status: "fulfilled", duplicate: true });

    const poolShare = (quote.priceWei * 3000n) / 10_000n;
    const l1 = (quote.priceWei * 1000n) / 10_000n;
    const l2 = (quote.priceWei * 300n) / 10_000n;
    expect(await bal(d.prizePool)).toBe(poolShare); // the pool grew by exactly 30%
    expect((await bal(inviter.account.address)) - inv0).toBe(l1);
    expect((await bal(owner.account.address)) - own0).toBe(l2);
    expect((await bal(treasury!)) - tre0).toBe(quote.priceWei - poolShare - l1 - l2);
    expect(await bal(d.premiumStore)).toBe(0n);

    // A tx that paid another order can't be reused for this one.
    const q2 = await quoteCheckout(ctx, buyer.s, { sku: "premium_pack", quantity: 1, country: null, now: new Date() });
    await expect(confirmCheckout(ctx, buyer.s, { orderId: q2.orderId, txHash: hash, now: new Date() })).rejects.toThrow(/another order/);
    // Paid but never confirmed by the client: the backstop finds the event and fulfils it.
    const quote2 = quoteFromJson(q2.quote);
    const r2 = await pub.waitForTransactionReceipt({ hash: await buyer.wallet.writeContract({ address: d.premiumStore, abi: premiumStoreAbi, functionName: "purchaseWithEth", args: [quote2, q2.signature], value: quote2.priceWei }) });
    expect(r2.status).toBe("success");
    expect(await chain.findPurchaseTx(q2.orderId)).toBe(r2.transactionHash);
    console.log("DEBUG", await getChainOrder(h.db, q2.orderId));
    const back = await checkoutBackstop(ctx, new Date(Date.now() + 7 * 60_000)); // the next cron run, after the quote's deadline
    expect(back.settled).toBeGreaterThanOrEqual(1);
    expect((await getChainOrder(h.db, q2.orderId))?.status).toBe("fulfilled");

    // Owner top-up (fund) so the week's budget is meaningful, then score the buyer.
    await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: d.prizePool, abi: prizePoolAbi, functionName: "fund", args: [`0x${"00".repeat(32)}`], value: parseEther("1") }) });
    const horseId = (await listStableHorses(h.db, buyer.s.stable.id))[0]!.id;
    await h.db.insert(schema.dailyCupEntries).values({ day: utcDay(now0), accountId: buyer.s.accountId, horseId, snapshot: {}, points: 80 });
    for (let k = 0; k < 3; k++) await recordPlayDay(h.db, buyer.s.accountId, new Date(now0.getTime() - k * DAY));
    const from = utcDay(new Date(now0.getTime() - 6 * DAY));
    const to = utcDay(new Date(now0.getTime() + DAY));
    const draft = await computeEpochDraft(ctx, { kind: "season", from, to, rules: { budgetBps: 5000 }, now: new Date() });
    expect(draft.allocations.map((a) => a.wallet.toLowerCase())).toEqual([buyer.account.address.toLowerCase()]);
    expect(draft.allocations[0]!.usdCents).toBe(2_000); // $20 cap
    await postEpochWithServer(ctx, draft.draftId!, new Date());
    expect((await chain.epoch(1))?.root).toBe(draft.root);
    expect((await chain.poolState()).outstandingWei).toBe(BigInt(draft.totalWei));

    // 15 days later the allocation has fully vested: the buyer claims from their wallet.
    await rpc("evm_increaseTime", [15 * 86_400]);
    await rpc("evm_mine");
    const block = await pub.getBlock();
    const mine = await myAllocations(ctx, buyer.s, new Date(Number(block.timestamp) * 1000));
    const a = mine.allocations[0]!;
    expect(a.claimableWei).toBe(a.amountWei);
    const before = await bal(buyer.account.address);
    const claimHash = await buyer.wallet.writeContract({
      address: d.prizePool,
      abi: prizePoolAbi,
      functionName: "claim",
      args: [BigInt(a.epochId), BigInt(a.amountWei), BigInt(a.vestStart), BigInt(a.vestEnd), a.proof],
    });
    const r = await pub.waitForTransactionReceipt({ hash: claimHash });
    expect(r.status).toBe("success");
    expect((await bal(buyer.account.address)) - before + r.gasUsed * r.effectiveGasPrice).toBe(BigInt(a.amountWei));
    expect((await chain.claimOf(1, buyer.account.address)).claimed).toBe(BigInt(a.amountWei));
    expect((await chain.poolState()).outstandingWei).toBe(0n);
  }, 120_000);
});
