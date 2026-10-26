"use client";
/** One connected browser wallet for the whole page (module store + hook). */
import { useSyncExternalStore } from "react";
import type { Address, EIP1193Provider } from "viem";
import { connect, connectWalletConnect, listWallets, type WalletOption } from "@/lib/chain/wallet";

interface State {
  provider: EIP1193Provider | null;
  address: Address | null;
  name: string | null;
}

let state: State = { provider: null, address: null, name: null };
/** True when the connected wallet came in over WalletConnect (its session ends on disconnect). */
let walletconnect = false;
const subs = new Set<() => void>();
const set = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};

/** Detaches the wallet (WalletConnect sessions are dropped too, so the QR sheet stays clean). */
export function disconnectWallet(): void {
  if (walletconnect) {
    walletconnect = false;
    void (state.provider as (EIP1193Provider & { disconnect?: () => Promise<void> }) | null)?.disconnect?.().catch(() => undefined);
  }
  set({ provider: null, address: null, name: null });
}

export function useWallet(): State & { connectWith: (w: WalletOption) => Promise<Address>; disconnect: () => void; listWallets: typeof listWallets } {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
  return {
    ...s,
    listWallets,
    async connectWith(w) {
      // The WalletConnect entry has no provider until it connects (dynamic import, QR modal).
      const option = w.walletconnect ? await connectWalletConnect() : w;
      if (!option.provider) throw new Error("That wallet isn't available right now.");
      const address = await connect(option.provider);
      walletconnect = !!option.walletconnect;
      set({ provider: option.provider, address, name: option.name });
      const p = option.provider as EIP1193Provider & { on?: (ev: string, f: (a: string[]) => void) => void };
      p.on?.("accountsChanged", (a: string[]) => set({ ...state, address: (a[0] as Address | undefined) ?? null }));
      return address;
    },
    disconnect: disconnectWallet,
  };
}