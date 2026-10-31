"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCredits } from "@/lib/format";
import { ApiFailure, api } from "@/lib/player";
import { refreshPurse } from "../economy/kit";
import { useLocked } from "../onboarding/FeatureGate";

/**
 * Claim a runner of a claiming race: one confirm (the price goes into escrow now and comes back
 * if the claim loses the draw, the horse is scratched or the race is abandoned).
 */
export function ClaimButton({ raceId, horseId, horseName, price }: { raceId: string; horseId: string; horseName: string; price: number }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Progressive unlocks: a new stable claims once it has finished Story chapter 1.
  const locked = useLocked("claiming");

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/races/${encodeURIComponent(raceId)}/claim`, { body: { horseId } });
      refreshPurse();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't reach the track. Check your connection and try again.");
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  if (locked) return <span className="caption" data-testid="claim-locked">Claiming opens after Story chapter 1</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {armed ? (
        <>
          <button type="button" className="btn btn-sm btn-brass" disabled={busy} onClick={claim} data-testid="claim-confirm">
            {busy ? "Claiming…" : `Claim ${horseName} · ${formatCredits(price)} cr`}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setArmed(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setArmed(true)} data-testid="claim-button">
          Claim
        </button>
      )}
      {error && (
        <span className="text-xs font-bold text-negative" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
