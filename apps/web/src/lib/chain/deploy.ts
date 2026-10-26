/**
 * Deploys and configures PrizePool + PremiumStore from ANY viem wallet client: the owner's
 * browser wallet on /admin/chain (no deploy key ever exists on a server), or a Hardhat
 * account in the chain e2e test. Bytecode and ABIs come from contracts.generated.ts.
 *
 * Steps (each one a wallet confirmation):
 *  1. PrizePool(admin = owner, maxClaimPerEpochWei)
 *  2. PremiumStore(admin = owner, treasury, server signer, pool, poolBps)
 *  3. pool.grantRole(FUNDER_ROLE, store)       the store forwards the pool's share of sales
 *  4. store.setSkuActive(premium_pack, true)
 *  5. optional: pool.grantRole(POSTER_ROLE, server signer)  (server posts weekly roots; needs gas)
 *  6. optional: store.setReferralBps(l1, l2) if not the defaults (10% / 3%)
 */
import { keccak256, toBytes, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { premiumStoreAbi, premiumStoreBytecode, prizePoolAbi, prizePoolBytecode } from "./contracts.generated";

export interface DeployParams {
  treasury: Address;
  signer: Address;
  poolBps: number;
  maxClaimPerEpochWei: bigint;
  grantPosterToSigner: boolean;
  ref1Bps?: number;
  ref2Bps?: number;
}

export interface DeployResult {
  chainId: number;
  admin: Address;
  prizePool: Address;
  premiumStore: Address;
  txs: { step: string; hash: Hex }[];
}

const role = (n: string) => keccak256(toBytes(n));
export const SKU_PREMIUM_PACK = keccak256(toBytes("premium_pack"));

export async function deployBetaContracts(
  wallet: WalletClient,
  pub: PublicClient,
  p: DeployParams,
  log: (step: string, hash?: Hex) => void = () => {},
): Promise<DeployResult> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  if (p.poolBps < 1000 || p.poolBps > 5000) throw new Error("pool share must be 10%..50%");
  if (p.maxClaimPerEpochWei <= 0n) throw new Error("per-account cap must be > 0");
  const chainId = await pub.getChainId();
  const txs: { step: string; hash: Hex }[] = [];
  const wait = async (step: string, hash: Hex) => {
    txs.push({ step, hash });
    log(step, hash);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${step} reverted (${hash})`);
    return r;
  };

  log("Deploying PrizePool…");
  const poolTx = await wallet.deployContract({ abi: prizePoolAbi, bytecode: prizePoolBytecode, args: [account.address, p.maxClaimPerEpochWei], account, chain: wallet.chain });
  const poolR = await wait("PrizePool deployed", poolTx);
  const prizePool = poolR.contractAddress!;

  log("Deploying PremiumStore…");
  const storeTx = await wallet.deployContract({ abi: premiumStoreAbi, bytecode: premiumStoreBytecode, args: [account.address, p.treasury, p.signer, prizePool, p.poolBps], account, chain: wallet.chain });
  const storeR = await wait("PremiumStore deployed", storeTx);
  const premiumStore = storeR.contractAddress!;

  await wait("Store may fund the pool", await wallet.writeContract({ address: prizePool, abi: prizePoolAbi, functionName: "grantRole", args: [role("FUNDER_ROLE"), premiumStore], account, chain: wallet.chain }));
  await wait("Premium Pack on sale", await wallet.writeContract({ address: premiumStore, abi: premiumStoreAbi, functionName: "setSkuActive", args: [SKU_PREMIUM_PACK, true], account, chain: wallet.chain }));
  if (p.grantPosterToSigner) {
    await wait("Server may post weekly roots", await wallet.writeContract({ address: prizePool, abi: prizePoolAbi, functionName: "grantRole", args: [role("POSTER_ROLE"), p.signer], account, chain: wallet.chain }));
  }
  // The owner (admin) can always post roots from this page.
  await wait("Owner may post weekly roots", await wallet.writeContract({ address: prizePool, abi: prizePoolAbi, functionName: "grantRole", args: [role("POSTER_ROLE"), account.address], account, chain: wallet.chain }));
  if ((p.ref1Bps !== undefined && p.ref1Bps !== 1000) || (p.ref2Bps !== undefined && p.ref2Bps !== 300)) {
    await wait("Affiliate ceilings", await wallet.writeContract({ address: premiumStore, abi: premiumStoreAbi, functionName: "setReferralBps", args: [p.ref1Bps ?? 1000, p.ref2Bps ?? 300], account, chain: wallet.chain }));
  }
  return { chainId, admin: account.address, prizePool, premiumStore, txs };
}

/** The Vercel env block shown after a deploy (no secrets). */
export function envBlock(r: { chainId: number; prizePool: Address; premiumStore: Address }): string {
  return [
    "WEB3_ENABLED=true",
    `CHAIN_ID=${r.chainId}`,
    `PREMIUM_STORE_ADDRESS=${r.premiumStore}`,
    `PRIZE_POOL_ADDRESS=${r.prizePool}`,
    "# already set (secret): QUOTE_SIGNER_PRIVATE_KEY, ROBINHOOD_RPC_URL",
  ].join("\n");
}
