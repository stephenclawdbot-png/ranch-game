"use client";
import { useEffect, useState } from "react";
import type { WalletOption } from "@/lib/chain/wallet";
import { walletErrorText } from "@/lib/chain/wallet";
import { shortAddress } from "@/lib/chain/format";
import { useWallet } from "./useWallet";

/** "Connect wallet" with a choice of the injected wallets found in this browser. */
export function WalletPicker({ label = "Connect wallet", onConnected }: { label?: string; onConnected?: () => void }) {
  const w = useWallet();
  const [options, setOptions] = useState<WalletOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && options === null) void w.listWallets().then(setOptions);
  }, [open, options, w]);

  if (w.address) {
    return (
      <span className="chip chip-cream" data-testid="wallet-connected" title={w.address}>
        {w.name ?? "Wallet"} · {shortAddress(w.address)}
      </span>
    );
  }
  return (
    <div className="grid gap-2">
      <button type="button" className="btn btn-brass" onClick={() => setOpen((o) => !o)} data-testid="wallet-connect">
        {label}
      </button>
      {open && (
        <div className="inset grid gap-2 p-2" data-testid="wallet-options">
          {options === null ? (
            <p className="caption">Looking for wallets…</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-cream-dim">
              No browser wallet found. Install MetaMask, Rabby, Coinbase Wallet or Robinhood Wallet (browser extension), or open this page in your wallet app&apos;s browser.
            </p>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="btn btn-block justify-start"
                onClick={async () => {
                  setErr(null);
                  try {
                    await w.connectWith(o);
                    setOpen(false);
                    onConnected?.();
                  } catch (e) {
                    setErr(walletErrorText(e));
                  }
                }}
              >
                {o.icon ? <img src={o.icon} alt="" width={20} height={20} className="mr-2 inline-block" /> : null}
                {o.name}
              </button>
            ))
          )}
          {err && <p className="text-sm font-bold text-negative">{err}</p>}
        </div>
      )}
    </div>
  );
}
