/**
 * Deploys HorseMarket (the USDG horse market, docs/usdg-market.md). TESTNET FIRST.
 *
 *   ROBINHOOD_RPC_URL=https://rpc.testnet.chain.robinhood.com DEPLOYER_PRIVATE_KEY=0x... \
 *   DEPLOY_ADMIN_ADDRESS=0x... DEPLOY_TREASURY_ADDRESS=0x... DEPLOY_STORE_SIGNER_ADDRESS=0x... \
 *   pnpm --filter @thoroughbred/contracts deploy:horse-market
 *
 * Env (addresses default to the deployer, which is fine on testnet only):
 *   DEPLOY_ADMIN_ADDRESS         final DEFAULT_ADMIN + PAUSER (use a Safe multisig on mainnet)
 *   DEPLOY_TREASURY_ADDRESS      receives marketplace fees and registration fees directly
 *   DEPLOY_STORE_SIGNER_ADDRESS  the game server key that signs orders (QUOTE_SIGNER_PRIVATE_KEY's address)
 *   USDG_TOKEN_ADDRESS           payment token; defaults to Paxos USDG on Robinhood testnet (46630)
 *   DEPLOY_USDG_FEE_BPS          marketplace fee (default 500 = 5 %, hard cap 1000); must equal the
 *                                server's USDG_FEE_BPS, or signed orders revert with FeeMismatch
 *
 * The contract never holds funds, so there is nothing to sweep. Never run against mainnet before
 * the gates in docs/usdg-market.md ("Gates before mainnet"). test/deploy.test.ts runs
 * `deployHorseMarket` against the in-process Hardhat network.
 */
import fs from "node:fs";
import path from "node:path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { ROBINHOOD_TESTNET_USDG } from "./deploy";

export interface HorseMarketDeployOptions {
  admin?: Address;
  treasury?: Address;
  signer?: Address;
  token?: Address;
  feeBps?: number;
  writeManifest?: boolean;
  log?: (msg: string) => void;
}

export interface HorseMarketDeployResult {
  chainId: number;
  deployer: Address;
  admin: Address;
  treasury: Address;
  signer: Address;
  token: Address;
  feeBps: number;
  horseMarket: Address;
}

const role = (name: string): Hex => keccak256(toBytes(name));
const DEFAULT_ADMIN_ROLE: Hex = `0x${"00".repeat(32)}`;

export async function deployHorseMarket(hre: HardhatRuntimeEnvironment, opts: HorseMarketDeployOptions = {}): Promise<HorseMarketDeployResult> {
  const log = opts.log ?? (() => {});
  const publicClient = await hre.viem.getPublicClient();
  const [deployerWallet] = await hre.viem.getWalletClients();
  if (!deployerWallet) throw new Error("No deployer account: set DEPLOYER_PRIVATE_KEY");
  const deployer = getAddress(deployerWallet.account.address);
  const chainId = await publicClient.getChainId();
  const admin = getAddress(opts.admin ?? deployer);
  const treasury = getAddress(opts.treasury ?? admin);
  const signer = getAddress(opts.signer ?? deployer);
  const token = opts.token ?? (chainId === 46630 ? ROBINHOOD_TESTNET_USDG : undefined);
  if (!token) throw new Error("USDG_TOKEN_ADDRESS is required outside Robinhood testnet (46630)");
  const feeBps = opts.feeBps ?? 500;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) throw new Error("fee bps must be 0..1000");
  log(`chain ${chainId}, deployer ${deployer}`);

  const wait = async (hash: Hex) => {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  };

  // Deployed with the final admin directly when it differs, so no hand-over is needed; the
  // deployer only keeps a role when it IS the admin (testnet default).
  const market = await hre.viem.deployContract("HorseMarket", [admin, treasury, signer, getAddress(token), feeBps]);
  log(`HorseMarket ${market.address} (token ${token}, fee ${feeBps} bps, treasury ${treasury}, signer ${signer})`);
  if (admin !== deployer) {
    // Defensive: the constructor never granted the deployer anything, but make it explicit.
    for (const r of [DEFAULT_ADMIN_ROLE, role("PAUSER_ROLE")]) {
      if (await market.read.hasRole([r, deployer])) await wait(await market.write.renounceRole([r, deployer]));
    }
  }

  const result: HorseMarketDeployResult = { chainId, deployer, admin, treasury, signer, token: getAddress(token), feeBps, horseMarket: getAddress(market.address) };
  if (opts.writeManifest) {
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${chainId}-horse-market.json`), JSON.stringify({ ...result, deployedAt: new Date().toISOString() }, null, 2) + "\n");
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
  deployHorseMarket(hre, {
    admin: envAddress("DEPLOY_ADMIN_ADDRESS"),
    treasury: envAddress("DEPLOY_TREASURY_ADDRESS"),
    signer: envAddress("DEPLOY_STORE_SIGNER_ADDRESS"),
    token: envAddress("USDG_TOKEN_ADDRESS"),
    feeBps: process.env.DEPLOY_USDG_FEE_BPS ? Number(process.env.DEPLOY_USDG_FEE_BPS) : undefined,
    writeManifest: hre.network.name !== "hardhat",
    log: (m) => console.log(m),
  })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.log("\nApp env (Vercel, Preview first):");
      console.log(`HORSE_MARKET_ADDRESS=${r.horseMarket}`);
      console.log(`USDG_TOKEN_ADDRESS=${r.token}`);
      console.log(`USDG_FEE_BPS=${r.feeBps}`);
      console.log(`\nVerify: npx hardhat verify --network robinhood ${r.horseMarket} ${r.admin} ${r.treasury} ${r.signer} ${r.token} ${r.feeBps}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
