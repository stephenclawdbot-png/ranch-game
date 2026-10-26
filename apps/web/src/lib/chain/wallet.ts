"use client";
/**
 * Browser wallets (EIP-1193). Discovers injected wallets with EIP-6963 (MetaMask, Rabby,
 * Coinbase Wallet, Robinhood Wallet when injected...) and falls back to window.ethereum.
 * No keys ever leave the wallet; the server only sees addresses, signatures and tx hashes.
 */
import { createPublicClient, createWalletClient, custom, getAddress, numberToHex, type Address, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { chainInfo, viemChain } from "./chains";

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

const found = new Map<string, WalletOption>();
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent<Eip6963Detail>).detail;
    if (d?.provider && d.info) found.set(d.info.rdns || d.info.uuid, { id: d.info.rdns || d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** Injected wallets available in this browser (waits briefly for EIP-6963 announcements). */
export async function listWallets(): Promise<WalletOption[]> {
  listen();
  await new Promise((r) => setTimeout(r, 150));
  const out = [...found.values()];
  const legacy = (window as unknown as { ethereum?: EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean; isCoinbaseWallet?: boolean } }).ethereum;
  if (legacy && !out.some((w) => w.provider === legacy)) {
    out.push({ id: "injected", name: legacy.isRabby ? "Rabby" : legacy.isCoinbaseWallet ? "Coinbase Wallet" : legacy.isMetaMask ? "MetaMask" : "Browser wallet", provider: legacy });
  }
  return out;
}

export async function connect(provider: EIP1193Provider): Promise<Address> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No account was shared by the wallet.");
  return getAddress(accounts[0]);
}

/** Switches the wallet to `chainId`, adding the network first if the wallet doesn't know it. */
export async function ensureChain(provider: EIP1193Provider, chainId: number): Promise<void> {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === chainId) return;
  const hex = numberToHex(chainId);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902 && code !== -32603) throw e;
    const c = chainInfo(chainId);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: c.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [c.rpcUrl], ...(c.explorer ? { blockExplorerUrls: [c.explorer] } : {}) }],
    });
  }
}

export function clients(provider: EIP1193Provider, chainId: number, account: Address): { wallet: WalletClient; pub: PublicClient } {
  const chain = viemChain(chainId);
  return {
    wallet: createWalletClient({ account, chain, transport: custom(provider) }),
    pub: createPublicClient({ chain, transport: custom(provider) }) as PublicClient,
  };
}

/** Friendly text for wallet errors (user rejection, insufficient funds...). */
export function walletErrorText(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  const code = err.code ?? err.cause?.code;
  if (code === 4001 || /rejected|denied/i.test(err.message ?? "")) return "You cancelled in the wallet. Nothing was sent.";
  if (/insufficient funds/i.test(err.message ?? "")) return "Not enough ETH in this wallet for the price plus a little gas.";
  return err.shortMessage ?? err.message ?? "The wallet reported an error.";
}
