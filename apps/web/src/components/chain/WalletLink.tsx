"use client";
/**
 * The stable's wallet: connect a browser wallet and prove it with a free signature
 * (Sign-In with Ethereum). One wallet per stable; it receives Prize Pool payouts and
 * affiliate commissions, and pays for Premium Packs. The single source of truth is the
 * verified wallet on the server (GET /api/wallet).
 */
import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { addressUrl } from "@/lib/chain/chains";
import { shortAddress } from "@/lib/chain/format";
import { walletErrorText } from "@/lib/chain/wallet";
import { WalletPicker } from "./WalletPicker";
import { useWallet } from "./useWallet";

interface Status {
  address: string | null;
  verifiedAtMs: number | null;
  unverifiedAddress: string | null;
  chainId: number;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

export function useWalletStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (res.ok) setStatus((await res.json()) as Status);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { status, reload };
}

export function WalletLink({ compact = false, onLinked }: { compact?: boolean; onLinked?: (address: string) => void }) {
  const { status, reload } = useWalletStatus();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function verify() {
    if (!w.provider || !w.address) return;
    setBusy(true);
    setErr(null);
    try {
      const ch = await post<{ nonce: string; message: string }>("/api/wallet/challenge", { address: w.address });
      const signature = (await w.provider.request({ method: "personal_sign", params: [ch.message as Hex, w.address] })) as Hex;
      const res = await post<{ address: string }>("/api/wallet/link", { nonce: ch.nonce, signature });
      await reload();
      onLinked?.(res.address);
    } catch (e) {
      setErr(e instanceof Error && !("code" in e) ? e.message : walletErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="caption">Loading wallet…</p>;
  if (status.address) {
    const url = addressUrl(status.chainId, status.address);
    return (
      <div className={compact ? "flex flex-wrap items-center gap-2" : "grid gap-1"} data-testid="wallet-linked">
        <span className="label">Wallet</span>
        <span className="font-mono text-sm text-cream" title={status.address}>
          ✓ {shortAddress(status.address)}{" "}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="underline">
              explorer
            </a>
          )}
        </span>
        {!compact && <p className="caption">Verified by signature. One wallet per stable: to change it, ask the organiser.</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-testid="wallet-link">
      {!compact && (
        <p className="text-sm text-cream-dim">
          Link a wallet on Robinhood Chain to buy Premium Packs, receive Prize Pool payouts and affiliate commissions. Linking is a free signature: no transaction, no gas.
          {status.unverifiedAddress ? ` You saved ${shortAddress(status.unverifiedAddress)} earlier without a signature: please verify it (or another wallet) now.` : ""}
        </p>
      )}
      {!w.address ? (
        <WalletPicker label="Connect wallet" />
      ) : (
        <button type="button" className="btn btn-brass" onClick={verify} disabled={busy} data-testid="wallet-verify">
          {busy ? "Check your wallet…" : `Verify ${shortAddress(w.address)} (free signature)`}
        </button>
      )}
      {err && (
        <p role="alert" className="text-sm font-bold text-negative">
          {err}
        </p>
      )}
    </div>
  );
}
