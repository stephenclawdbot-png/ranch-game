"use client";
/**
 * Sign in to the stable with a wallet (SIWE, no session needed): pick a wallet (injected via
 * EIP-6963, or WalletConnect's QR for phone apps), tick 18+ (Robinhood Chain terms), then a
 * free signature — no transaction, no gas. The server signs this device in to the stable the
 * wallet belongs to; an unknown wallet on a browser that has a stable links there instead,
 * and { create: true } founds the stable in the same request (used from /play).
 */
import { useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { shortAddress } from "@/lib/chain/format";
import { walletErrorText } from "@/lib/chain/wallet";
import { WalletPicker } from "./WalletPicker";
import { useWallet } from "./useWallet";

interface VerifyResult {
  /** Set when the wallet signed this browser in (or founded a stable): off to the stable. */
  stableName?: string;
  linked?: boolean;
  address?: string;
  needsStable?: boolean;
}

export interface WalletSignInProps {
  label?: string;
  /** From /play: the form's name / colours / invite, so "create" founds the stable here. */
  create?: { stableName: string; silks: unknown; inviteCode?: string | null };
  /** /me: the wallet was linked to the signed-in stable. */
  onLinked?: (address: string) => void;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function WalletSignIn({ label = "Sign in with wallet", create, onLinked }: WalletSignInProps) {
  const w = useWallet();
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsStable, setNeedsStable] = useState(false);
  const [linked, setLinked] = useState<string | null>(null);

  async function run(withCreate: boolean) {
    if (!w.provider || !w.address || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const ch = await post<{ nonce: string; message: string }>("/api/auth/wallet/challenge", { address: w.address });
      const signature = (await w.provider.request({ method: "personal_sign", params: [ch.message as Hex, w.address] })) as Hex;
      const res = await post<VerifyResult>("/api/auth/wallet/verify", {
        nonce: ch.nonce,
        signature,
        ...(withCreate && create ? { create: true, stableName: create.stableName, silks: create.silks, ...(create.inviteCode ? { inviteCode: create.inviteCode } : {}), timezone: deviceTimezone() } : {}),
      });
      if (res.stableName !== undefined) {
        window.location.assign("/stable");
        return;
      }
      if (res.linked && res.address) {
        setLinked(res.address);
        onLinked?.(res.address);
        return;
      }
      // Unknown wallet, no stable here: found one (needs the create details) or link on /play.
      setNeedsStable(true);
    } catch (e) {
      setErr(e instanceof Error && !("code" in e) ? e.message : walletErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2" data-testid="wallet-signin">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={adult} onChange={(e) => setAdult(e.target.checked)} data-testid="wallet-adult" />
        <span className="t-meta">I&rsquo;m 18 or older (Robinhood Chain terms)</span>
      </label>
      {linked ? (
        <p className="text-sm font-bold text-turf" data-testid="wallet-signin-linked">
          ✓ {shortAddress(linked)} can now sign you in on any device.
        </p>
      ) : !w.address ? (
        <WalletPicker label={label} />
      ) : (
        <>
          <button type="button" className="btn" onClick={() => void run(false)} disabled={!adult || busy} data-testid="wallet-signin-verify">
            {busy ? "Check your wallet…" : `Sign in with ${shortAddress(w.address)} (free signature)`}
          </button>
          {needsStable &&
            (create ? (
              <button type="button" className="btn btn-outline" onClick={() => void run(true)} disabled={busy} data-testid="wallet-signin-create">
                {busy ? "Check your wallet…" : "Found a new stable with this wallet — sign again to create it"}
              </button>
            ) : (
              <p className="t-meta" data-testid="wallet-signin-nostable">
                This wallet has no stable yet.{" "}
                <Link href="/play" className="link">
                  Found one
                </Link>{" "}
                and sign in with the same wallet.
              </p>
            ))}
        </>
      )}
      {err && (
        <p role="alert" className="text-sm font-bold text-negative">
          {err}
        </p>
      )}
      <p className="caption">A wallet is optional. Signing is free: no transaction, no gas.</p>
    </div>
  );
}