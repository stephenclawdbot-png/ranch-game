"use client";
/** One connected browser wallet for the whole page (module store + hook). */
import { useSyncExternalStore } from "react";
import type { Address, EIP1193Provider } from "viem";
import { connect, listWallets, type WalletOption } from "@/lib/chain/wallet";

interface State {
  provider: EIP1193Provider | null;
  address: Address | null;
  name: string | null;
}

let state: State = { provider: null, address: null, name: null };
const subs = new Set<() => void>();
const set = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};

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
      const address = await connect(w.provider);
      set({ provider: w.provider, address, name: w.name });
      const p = w.provider as EIP1193Provider & { on?: (ev: string, f: (a: string[]) => void) => void };
      p.on?.("accountsChanged", (a: string[]) => set({ ...state, address: (a[0] as Address | undefined) ?? null }));
      return address;
    },
    disconnect() {
      set({ provider: null, address: null, name: null });
    },
  };
}
