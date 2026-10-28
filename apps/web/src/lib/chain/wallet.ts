"use client";
/**
 * Browser wallets (EIP-1193). Discovers injected wallets with EIP-6963 (MetaMask, Rabby,
 * Coinbase Wallet, Robinhood Wallet when injected...) and falls back to window.ethereum.
 * WalletConnect (QR / phone wallets) is offered only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 * is set, and its provider is created lazily with a dynamic import on click, so it never
 * lands in the main bundle. No keys ever leave the wallet; the server only sees addresses,
 * signatures and tx hashes.
 */
import { createPublicClient, createWalletClient, custom, getAddress, numberToHex, type Address, type EIP1193Provider, type PublicClient, type WalletClient } from "viem";
import { chainInfo, viemChain, ROBINHOOD_MAINNET, ROBINHOOD_TESTNET } from "./chains";

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  /** Null for the WalletConnect entry: the provider appears only once it connects (QR modal). */
  provider: EIP1193Provider | null;
  /** A WalletConnect entry: remote wallet via QR / deep link, created on click. */
  walletconnect?: boolean;
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
  if (walletConnectProjectId()) out.push({ id: "walletconnect", name: "WalletConnect · any wallet app", provider: null, walletconnect: true });
  return out;
}

/** True on a phone: the UA-CH mobile flag, or a coarse pointer plus a mobile UA string. */
export function isPhoneBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const uad = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uad?.mobile) return true;
  return window.matchMedia("(pointer: coarse)").matches && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/**
 * The MetaMask fallback row in the wallet picker, shown unless an injected wallet is
 * MetaMask (EIP-6963 rdns, or the legacy isMetaMask name). Phones deep-link into the
 * MetaMask app, which reopens this page in its browser; desktop links to the download
 * page in a new tab, so the picker stays open.
 */
export function metamaskFallback({ injected, isPhone, href }: { injected: Pick<WalletOption, "id" | "name">[]; isPhone: boolean; href: string }): { show: boolean; caption: string; url: string; newTab: boolean } {
  const show = !injected.some((w) => w.id === "io.metamask" || w.name === "MetaMask");
  if (isPhone) {
    const u = new URL(href);
    return { show, caption: "Opens this page in the MetaMask app", url: `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}`, newTab: false };
  }
  return { show, caption: "Install MetaMask, then reload this page", url: "https://metamask.io/download/", newTab: true };
}

/** The WalletConnect project ID (free at cloud.reown.com); unset = injected wallets only. */
export function walletConnectProjectId(): string | null {
  const id = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  return id || null;
}

/**
 * Connects a remote wallet (phone apps, wallets without an extension): WalletConnect shows a
 * QR modal that deep-links into Robinhood Wallet, MetaMask, Rainbow and friends. The module
 * is imported here, on click, so it stays out of every page that just lists wallets.
 */
export async function connectWalletConnect(): Promise<WalletOption> {
  const projectId = walletConnectProjectId();
  if (!projectId) throw new Error("WalletConnect is not configured on this deployment.");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const origin = window.location.origin;
  const provider = await EthereumProvider.init({
    projectId,
    optionalChains: [ROBINHOOD_MAINNET, ROBINHOOD_TESTNET],
    showQrModal: true,
    metadata: { name: "Post Time", description: "Horse racing stable game", url: origin, icons: [`${origin}/icon.svg`] },
  });
  await provider.enable();
  return { id: "walletconnect", name: "WalletConnect", provider: provider as unknown as EIP1193Provider, walletconnect: true };
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
