"use client";
import { useEffect, useState } from "react";
import type { WalletOption } from "@/lib/chain/wallet";
import { isPhoneBrowser, metamaskFallback, walletErrorText } from "@/lib/chain/wallet";
import { shortAddress } from "@/lib/chain/format";
import { MetaMaskFox } from "./MetaMaskFox";
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

  // MetaMask fallback row: hidden once an injected MetaMask is detected (options is null only pre-list/SSR).
  const fb = options === null ? null : metamaskFallback({ injected: options.filter((o) => !o.walletconnect), isPhone: isPhoneBrowser(), href: window.location.href });

  if (w.address) {
    return (
      <span className="chip chip-cream" data-testid="wallet-connected" title={w.address}>
        {w.name ?? "Wallet"} · {shortAddress(w.address)}
      </span>
    );
  }
  return (
    <div className="grid gap-2">
      <button type="button" className="btn" onClick={() => setOpen((o) => !o)} data-testid="wallet-connect">
        {label}
      </button>
      {open && (
        <div className="inset grid gap-2 p-2" data-testid="wallet-options">
          {options === null ? (
            <p className="caption">Looking for wallets…</p>
          ) : (
            <>
              {options.every((o) => o.walletconnect) && <p className="text-sm text-cream-dim">No wallet in this browser.</p>}
              {options.map((o) => (
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
              ))}
              {fb?.show &&
                (fb.newTab ? (
                  <a className="btn btn-block justify-start" data-testid="wallet-option-metamask-fallback" href={fb.url} target="_blank" rel="noopener noreferrer">
                    <MetaMaskFox className="mr-2 inline-block" />
                    <span className="text-left">
                      MetaMask
                      <span className="caption block">{fb.caption}</span>
                    </span>
                  </a>
                ) : (
                  <button type="button" className="btn btn-block justify-start" data-testid="wallet-option-metamask-fallback" onClick={() => (window.location.href = fb.url)}>
                    <MetaMaskFox className="mr-2 inline-block" />
                    <span className="text-left">
                      MetaMask
                      <span className="caption block">{fb.caption}</span>
                    </span>
                  </button>
                ))}
            </>
          )}
          {err && <p className="text-sm font-bold text-negative">{err}</p>}
        </div>
      )}
    </div>
  );
}
