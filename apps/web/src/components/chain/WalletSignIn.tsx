"use client";
/**
 * Sign in to the stable with a wallet (SIWE, no session needed): pick a wallet (injected via
 * EIP-6963, or WalletConnect's QR for phone apps), tick 18+ (Robinhood Chain terms), then a
 * free signature — no transaction, no gas.
 *
 * Intent "signin" (/play, /link): the wallet's stable signs this browser in; a browser that
 * already has a stable confirms leaving it behind (409 replace_required → checkbox), an
 * unknown wallet can be linked to the current stable or found a new one ({ create }).
 * Intent "link" (/me): only ever links the wallet to the signed-in stable.
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
  /** The wallet already signs this browser in: nothing to do, no cookie change. */
  alreadySignedIn?: boolean;
  needsStable?: boolean;
  /** The wallet is unknown but this browser has a stable: link here, or found a new one. */
  canLinkCurrent?: boolean;
  currentStable?: string;
}

export interface WalletSignInProps {
  label?: string;
  /** What the signature is for: "signin" (default, /play + /link) or "link" to the current stable (/me). */
  intent?: "signin" | "link";
  /** From /play: the form's name / colours / invite, so "create" founds the stable here. */
  create?: { stableName: string; silks: unknown; inviteCode?: string | null };
  /** /me: the wallet was linked to the signed-in stable. */
  onLinked?: (address: string) => void;
}

/** Fetch helper that keeps the API's error code and body on the thrown error. */
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; currentStable?: string };
  if (!res.ok) {
    const err = new Error(data.message ?? `HTTP ${res.status}`) as Error & { api?: true; code?: string; data?: { currentStable?: string } };
    err.api = true; // API answers carry their own wording; wallet-provider errors don't.
    err.code = data.error;
    err.data = { currentStable: data.currentStable };
    throw err;
  }
  return data;
}

function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** One attempt: fresh challenge + signature, then verify with the given intent and flags. */
type Attempt = { intent?: "signin" | "link"; create?: boolean; replace?: boolean };

export function WalletSignIn({ label = "Sign in with wallet", intent = "signin", create, onLinked }: WalletSignInProps) {
  const w = useWallet();
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The wallet has no stable and this browser has none either: create one (/play) or go found one. */
  const [needsStable, setNeedsStable] = useState(false);
  /** The wallet is unknown and this browser has a stable: link it here, or found a new one. */
  const [linkHere, setLinkHere] = useState<string | null>(null);
  /** The wallet belongs to another stable and this browser has one: confirm the switch. */
  const [replaceAsk, setReplaceAsk] = useState<{ currentStable: string; retry: Attempt } | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);
  const [linked, setLinked] = useState<string | null>(null);
  const [alreadyHere, setAlreadyHere] = useState(false);

  async function run(attempt: Attempt = {}) {
    if (!w.provider || !w.address || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const ch = await post<{ nonce: string; message: string }>("/api/auth/wallet/challenge", { address: w.address });
      const signature = (await w.provider.request({ method: "personal_sign", params: [ch.message as Hex, w.address] })) as Hex;
      const res = await post<VerifyResult>("/api/auth/wallet/verify", {
        nonce: ch.nonce,
        signature,
        intent: attempt.intent ?? intent,
        ...(attempt.replace ? { replace: true } : {}),
        ...(attempt.create && create ? { create: true, stableName: create.stableName, silks: create.silks, ...(create.inviteCode ? { inviteCode: create.inviteCode } : {}), timezone: deviceTimezone() } : {}),
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
      if (res.alreadySignedIn) {
        setAlreadyHere(true);
        return;
      }
      // Unknown wallet: link it to this browser's stable, or found a new one.
      if (res.canLinkCurrent) setLinkHere(res.currentStable ?? "your stable");
      else setNeedsStable(true);
    } catch (e) {
      const thrown = e as Error & { api?: true; code?: string; data?: { currentStable?: string } };
      if (thrown.code === "replace_required") {
        // Needs a fresh signature, so the whole attempt is retried with { replace: true }.
        setReplaceAsk({ currentStable: thrown.data?.currentStable ?? "this browser's stable", retry: attempt });
        setReplaceOk(false);
        return;
      }
      setErr(thrown.api ? thrown.message : walletErrorText(e));
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
          <button type="button" className="btn" onClick={() => void run()} disabled={!adult || busy} data-testid="wallet-signin-verify">
            {busy ? "Check your wallet…" : intent === "link" ? `Link ${shortAddress(w.address)} to this stable (free signature)` : `Sign in with ${shortAddress(w.address)} (free signature)`}
          </button>
          {alreadyHere && (
            <p className="t-meta" data-testid="wallet-signin-already">
              This wallet already signs you in here — you&rsquo;re all set.
            </p>
          )}
          {replaceAsk && (
            <div className="grid gap-2" data-testid="wallet-signin-replace">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} data-testid="wallet-replace-ok" />
                <span className="t-meta">Leave {replaceAsk.currentStable} on this browser and sign in to the wallet&rsquo;s stable</span>
              </label>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void run({ ...replaceAsk.retry, replace: true })}
                disabled={!adult || !replaceOk || busy}
                data-testid="wallet-signin-replace-go"
              >
                {busy ? "Check your wallet…" : "Sign in anyway (fresh signature)"}
              </button>
            </div>
          )}
          {linkHere && (
            <div className="grid gap-2" data-testid="wallet-signin-linkhere">
              <p className="t-meta">This wallet has no stable yet.</p>
              <button type="button" className="btn btn-outline" onClick={() => void run({ intent: "link" })} disabled={!adult || busy} data-testid="wallet-signin-link-current">
                Link this wallet to {linkHere}
              </button>
              {create ? (
                <button type="button" className="btn btn-outline" onClick={() => void run({ create: true })} disabled={!adult || busy} data-testid="wallet-signin-create">
                  {busy ? "Check your wallet…" : "Found a new stable with this wallet"}
                </button>
              ) : (
                <button type="button" className="btn btn-outline" onClick={() => window.location.assign("/play")} disabled={!adult || busy} data-testid="wallet-signin-create">
                  Found a new stable with this wallet
                </button>
              )}
            </div>
          )}
          {needsStable &&
            (create ? (
              <button type="button" className="btn btn-outline" onClick={() => void run({ create: true })} disabled={!adult || busy} data-testid="wallet-signin-create">
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