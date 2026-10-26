/**
 * Robinhood Chain networks for the browser (wallet add/switch, explorer links) and the server.
 * Client-safe: no secrets. Facts dated 2026-10-25 (docs/web3.md §1); RPC URLs here are the
 * public, rate-limited endpoints used only to add the network to a wallet.
 */
import { defineChain, type Chain } from "viem";

export const ROBINHOOD_MAINNET = 4663;
export const ROBINHOOD_TESTNET = 46630;
export const LOCAL_HARDHAT = 31337;

export interface ChainInfo {
  id: number;
  name: string;
  short: string;
  rpcUrl: string;
  explorer: string | null;
  testnet: boolean;
}

export const CHAINS: Record<number, ChainInfo> = {
  [ROBINHOOD_MAINNET]: { id: ROBINHOOD_MAINNET, name: "Robinhood Chain", short: "mainnet", rpcUrl: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", testnet: false },
  [ROBINHOOD_TESTNET]: { id: ROBINHOOD_TESTNET, name: "Robinhood Chain Testnet", short: "testnet", rpcUrl: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com", testnet: true },
  [LOCAL_HARDHAT]: { id: LOCAL_HARDHAT, name: "Local Hardhat", short: "local", rpcUrl: "http://127.0.0.1:8545", explorer: null, testnet: true },
};

export function chainInfo(id: number): ChainInfo {
  return CHAINS[id] ?? { id, name: `EVM ${id}`, short: String(id), rpcUrl: "", explorer: null, testnet: true };
}

export function viemChain(id: number, rpcUrl?: string): Chain {
  const c = chainInfo(id);
  return defineChain({
    id,
    name: c.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl || c.rpcUrl] } },
    ...(c.explorer ? { blockExplorers: { default: { name: "Blockscout", url: c.explorer } } } : {}),
    testnet: c.testnet,
  });
}

export function txUrl(chainId: number, hash: string): string | null {
  const e = chainInfo(chainId).explorer;
  return e ? `${e}/tx/${hash}` : null;
}

export function addressUrl(chainId: number, address: string): string | null {
  const e = chainInfo(chainId).explorer;
  return e ? `${e}/address/${address}` : null;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
