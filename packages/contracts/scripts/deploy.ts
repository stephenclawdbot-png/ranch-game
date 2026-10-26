/**
 * Deploys RaceProofRegistry + PrizePool + PremiumStore (and optionally ThoroughbredToken).
 *
 * The closed beta deploys PrizePool + PremiumStore from the OWNER'S BROWSER WALLET instead
 * (apps/web /admin/chain, no keys on any server); this script is the CLI/test equivalent.
 *
 *   ROBINHOOD_RPC_URL=... DEPLOYER_PRIVATE_KEY=... \
 *   pnpm --filter @thoroughbred/contracts deploy:robinhood
 *
 * Optional env (addresses default to the deployer, which is fine on testnet only):
 *   DEPLOY_ADMIN_ADDRESS        final DEFAULT_ADMIN (use a Safe multisig on mainnet)
 *   DEPLOY_TREASURY_ADDRESS     where store proceeds are withdrawn to
 *   DEPLOY_PUBLISHER_ADDRESS    game server key that posts proof roots
 *   DEPLOY_STORE_SIGNER_ADDRESS game server key that signs Order vouchers / EthQuotes
 *   DEPLOY_POOL_POSTER_ADDRESS  optional: key allowed to post Prize Pool epoch roots (the admin always can be granted later)
 *   DEPLOY_POOL_BPS             Prize Pool share of ETH sales in basis points (default 3000 = 30%)
 *   DEPLOY_POOL_MAX_CLAIM_WEI   per-account cap per epoch in wei (default 0.01 ETH)
 *   PAYMENT_TOKEN_ADDRESS       stablecoin; defaults to Paxos USDG on Robinhood testnet
 *   DEPLOY_GAME_TOKEN=true      also deploy the optional ThoroughbredToken (off by default)
 *
 * NOTHING here holds secrets. Never run against mainnet before the gates in docs/web3.md.
 * test/deploy.test.ts runs `deployThoroughbred` against the in-process Hardhat network.
 */
import fs from "node:fs";
import path from "node:path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { parseTokenAmount, skuId } from "../adapter/voucher";
import type { SkuName } from "../adapter/types";

/** Paxos USDG on Robinhood Chain Testnet (docs.paxos.com, verified decimals()=6 on 2026-10-25). */
export const ROBINHOOD_TESTNET_USDG: Address = "0x7E955252E15c84f5768B83c41a71F9eba181802F";

export interface SkuPrice {
  sku: SkuName;
  /** Human price in token units, e.g. "4.99". */
  price: string;
  active: boolean;
}

/** Placeholder testnet catalogue. Real prices are a product decision (docs/web3.md open questions). */
export const DEFAULT_CATALOGUE: SkuPrice[] = [
  { sku: "premium_pack", price: "4.99", active: true },
  { sku: "season_pass", price: "9.99", active: true },
  // game-design.md 4f makes the entry refill a CREDIT sink; selling it for stablecoin is not approved yet.
  { sku: "entry_refill", price: "0.99", active: false },
];

export interface DeployOptions {
  admin?: Address;
  treasury?: Address;
  publisher?: Address;
  storeSigner?: Address;
  paymentToken?: Address;
  paymentTokenDecimals?: number;
  catalogue?: SkuPrice[];
  deployGameToken?: boolean;
  gameToken?: { name: string; symbol: string; cap: bigint };
  /** Write deployments/<chainId>.json. */
  writeManifest?: boolean;
  /** Prize Pool share of ETH sales (bps, 1000..5000). Default 3000. */
  poolBps?: number;
  /** PrizePool per-account cap per epoch (wei). Default 0.01 ETH. */
  poolMaxClaimWei?: bigint;
  /** Extra POSTER_ROLE holder on the PrizePool (e.g. the server key). */
  poolPoster?: Address;
  log?: (msg: string) => void;
}

export interface DeployResult {
  chainId: number;
  deployer: Address;
  admin: Address;
  raceProofRegistry: Address;
  premiumStore: Address;
  prizePool: Address;
  paymentToken?: Address;
  gameToken?: Address;
}

const role = (name: string): Hex => keccak256(toBytes(name));
const DEFAULT_ADMIN_ROLE: Hex = `0x${"00".repeat(32)}`;

export async function deployThoroughbred(hre: HardhatRuntimeEnvironment, opts: DeployOptions = {}): Promise<DeployResult> {
  const log = opts.log ?? (() => {});
  const publicClient = await hre.viem.getPublicClient();
  const [deployerWallet] = await hre.viem.getWalletClients();
  if (!deployerWallet) throw new Error("No deployer account: set DEPLOYER_PRIVATE_KEY");
  const deployer = getAddress(deployerWallet.account.address);
  const chainId = await publicClient.getChainId();
  const admin = opts.admin ?? deployer;
  const treasury = opts.treasury ?? admin;
  const publisher = opts.publisher ?? deployer;
  const storeSigner = opts.storeSigner ?? deployer;
  const paymentToken = opts.paymentToken ?? (chainId === 46630 ? ROBINHOOD_TESTNET_USDG : undefined);
  const decimals = opts.paymentTokenDecimals ?? 6;
  log(`chain ${chainId}, deployer ${deployer}`);

  // Deploy with the deployer as temporary admin so we can configure, then hand over.
  const registry = await hre.viem.deployContract("RaceProofRegistry", [deployer, publisher]);
  log(`RaceProofRegistry ${registry.address}`);
  const pool = await hre.viem.deployContract("PrizePool", [deployer, opts.poolMaxClaimWei ?? 10n ** 16n]);
  log(`PrizePool ${pool.address}`);
  const store = await hre.viem.deployContract("PremiumStore", [deployer, treasury, storeSigner, pool.address, opts.poolBps ?? 3000]);
  log(`PremiumStore ${store.address}`);

  const wait = async (hash: Hex) => {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  };

  // The store forwards the pool share of every ETH sale; only the store and the admin fund.
  await wait(await pool.write.grantRole([role("FUNDER_ROLE"), store.address]));
  await wait(await store.write.setSkuActive([skuId("premium_pack"), true]));
  // The admin (owner wallet / multisig) can always post epoch roots itself.
  await wait(await pool.write.grantRole([role("POSTER_ROLE"), admin]));
  if (opts.poolPoster) await wait(await pool.write.grantRole([role("POSTER_ROLE"), opts.poolPoster]));

  if (paymentToken) {
    await wait(await store.write.setAcceptedToken([paymentToken, true]));
    for (const item of opts.catalogue ?? DEFAULT_CATALOGUE) {
      const id = skuId(item.sku);
      await wait(await store.write.setPrice([id, paymentToken, parseTokenAmount(item.price, decimals)]));
      await wait(await store.write.setSkuActive([id, item.active]));
    }
    log(`catalogue configured for ${paymentToken}`);
  }

  let gameToken: Address | undefined;
  if (opts.deployGameToken) {
    const t = opts.gameToken ?? { name: "Thoroughbred", symbol: "TBRED", cap: 1_000_000_000n * 10n ** 18n };
    const token = await hre.viem.deployContract("ThoroughbredToken", [t.name, t.symbol, t.cap, admin, deployer]);
    gameToken = token.address;
    log(`ThoroughbredToken ${gameToken} (genesis NOT minted; mintGenesis + finalizeGenesis are a separate, reviewed step)`);
  }

  if (getAddress(admin) !== deployer) {
    for (const r of [DEFAULT_ADMIN_ROLE, role("PAUSER_ROLE")]) {
      await wait(await registry.write.grantRole([r, admin]));
    }
    for (const r of [DEFAULT_ADMIN_ROLE, role("PRICE_MANAGER_ROLE"), role("PAUSER_ROLE"), role("TREASURER_ROLE")]) {
      await wait(await store.write.grantRole([r, admin]));
    }
    for (const r of [DEFAULT_ADMIN_ROLE, role("PAUSER_ROLE"), role("FUNDER_ROLE")]) {
      await wait(await pool.write.grantRole([r, admin]));
    }
    // Renounce the deployer's powers (admin last).
    await wait(await registry.write.renounceRole([role("PAUSER_ROLE"), deployer]));
    await wait(await registry.write.renounceRole([DEFAULT_ADMIN_ROLE, deployer]));
    for (const r of [role("PRICE_MANAGER_ROLE"), role("PAUSER_ROLE"), role("TREASURER_ROLE"), DEFAULT_ADMIN_ROLE]) {
      await wait(await store.write.renounceRole([r, deployer]));
    }
    for (const r of [role("PAUSER_ROLE"), role("FUNDER_ROLE"), DEFAULT_ADMIN_ROLE]) {
      await wait(await pool.write.renounceRole([r, deployer]));
    }
    log(`admin handed over to ${admin}`);
  }

  const result: DeployResult = {
    chainId,
    deployer,
    admin: getAddress(admin),
    raceProofRegistry: registry.address,
    premiumStore: store.address,
    prizePool: pool.address,
    paymentToken,
    gameToken,
  };
  if (opts.writeManifest) {
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${chainId}.json`), JSON.stringify({ ...result, deployedAt: new Date().toISOString() }, null, 2) + "\n");
  }
  return result;
}

function envAddress(name: string): Address | undefined {
  const v = process.env[name]?.trim();
  return v ? getAddress(v) : undefined;
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const hre = require("hardhat") as HardhatRuntimeEnvironment;
  deployThoroughbred(hre, {
    admin: envAddress("DEPLOY_ADMIN_ADDRESS"),
    treasury: envAddress("DEPLOY_TREASURY_ADDRESS"),
    publisher: envAddress("DEPLOY_PUBLISHER_ADDRESS"),
    storeSigner: envAddress("DEPLOY_STORE_SIGNER_ADDRESS"),
    poolPoster: envAddress("DEPLOY_POOL_POSTER_ADDRESS"),
    poolBps: process.env.DEPLOY_POOL_BPS ? Number(process.env.DEPLOY_POOL_BPS) : undefined,
    poolMaxClaimWei: process.env.DEPLOY_POOL_MAX_CLAIM_WEI ? BigInt(process.env.DEPLOY_POOL_MAX_CLAIM_WEI) : undefined,
    paymentToken: envAddress("PAYMENT_TOKEN_ADDRESS"),
    deployGameToken: process.env.DEPLOY_GAME_TOKEN === "true",
    writeManifest: hre.network.name !== "hardhat",
    log: (m) => console.log(m),
  })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.log("Verify: npx hardhat verify --network robinhood <address> <constructor args...>");
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
