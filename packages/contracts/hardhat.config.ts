import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

// Robinhood Chain network config comes ONLY from the environment. Nothing secret lives in
// this file. See docs/web3.md and .claude/skills/robinhood-chain/SKILL.md.
//
//   ROBINHOOD_RPC_URL      e.g. https://rpc.testnet.chain.robinhood.com (rate-limited public RPC)
//                          or a provider URL (Alchemy etc.). Testnet is the default target.
//   ROBINHOOD_CHAIN_ID     46630 = Robinhood Chain Testnet (default), 4663 = mainnet
//   ROBINHOOD_EXPLORER_URL Blockscout base URL used for verification
//                          (default: https://explorer.testnet.chain.robinhood.com)
//   DEPLOYER_PRIVATE_KEY   0x-prefixed deployer key. NEVER commit it. Use a throwaway key on testnet.
const env = process.env;
const rpcUrl = env.ROBINHOOD_RPC_URL?.trim();
const chainId = Number(env.ROBINHOOD_CHAIN_ID ?? 46630);
const explorer = (env.ROBINHOOD_EXPLORER_URL ?? "https://explorer.testnet.chain.robinhood.com").replace(/\/$/, "");
const deployerKey = env.DEPLOYER_PRIVATE_KEY?.trim();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    // Arbitrum Nitro supports Cancun opcodes (PUSH0, MCOPY, TSTORE/TLOAD) since ArbOS 20.
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    hardhat: {},
    ...(rpcUrl
      ? {
          robinhood: {
            url: rpcUrl,
            chainId,
            accounts: deployerKey ? [deployerKey] : [],
          },
        }
      : {}),
  },
  etherscan: {
    // Blockscout does not need a real API key; hardhat-verify requires a non-empty string.
    apiKey: { robinhood: "empty" },
    customChains: [
      {
        network: "robinhood",
        chainId,
        urls: { apiURL: `${explorer}/api`, browserURL: explorer },
      },
    ],
  },
  sourcify: { enabled: false },
  mocha: { timeout: 60_000 },
};

export default config;
