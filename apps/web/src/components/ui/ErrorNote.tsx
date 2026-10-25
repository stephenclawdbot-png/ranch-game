"use client";

import Link from "next/link";
import { useState } from "react";
import { formatCredits } from "@/lib/format";
import { ApiFailure, api, usePlayerState } from "@/lib/player";

/**
 * A failed action, in plain words, with the way forward when there is one: no stable entries
 * left -> the daily refill offer; no stable -> found one.
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const state = usePlayerState();
  const [busy, setBusy] = useState(false);
  const [refillError, setRefillError] = useState<string | null>(null);
  const [refilled, setRefilled] = useState(false);
  const f = error instanceof ApiFailure ? error : null;
  const message = f?.message ?? (error instanceof Error ? error.message : "Something went wrong.");
  const bank = state?.entries;

  async function refill() {
    setBusy(true);
    setRefillError(null);
    try {
      await api("/api/entries/refill");
      setRefilled(true);
    } catch (e) {
      setRefillError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2" role="alert" data-testid="error-note" data-code={f?.code}>
      <p className="font-bold text-negative">{message}</p>
      {f?.code === "INSUFFICIENT_ENTRIES" && (
        <div className="surface-2 grid gap-2 p-2 text-sm">
          {refilled ? (
            <p className="text-cream">+5 entries added. You can enter now.</p>
          ) : bank?.refillAvailable ? (
            <>
              <p className="text-cream-dim">
                Your stable gets +{bank.allowance} entries at local midnight. Need more today? One refill a day: +5 entries for {formatCredits(bank.refillPrice)} credits.
              </p>
              <button type="button" className="btn btn-sm w-fit" onClick={refill} disabled={busy} data-testid="refill">
                {busy ? "Refilling…" : `Refill +5 for ${formatCredits(bank.refillPrice)}`}
              </button>
            </>
          ) : (
            <p className="text-cream-dim">Your stable gets +{bank?.allowance ?? 10} entries at local midnight. Story races are always free.</p>
          )}
          {refillError && <p className="font-bold text-negative">{refillError}</p>}
        </div>
      )}
      {f?.status === 401 && (
        <Link href="/play" className="btn btn-sm w-fit">
          Found your stable
        </Link>
      )}
      {(refilled || (onRetry && f?.code !== "INSUFFICIENT_ENTRIES")) && onRetry && (
        <button type="button" className="btn btn-sm w-fit" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
