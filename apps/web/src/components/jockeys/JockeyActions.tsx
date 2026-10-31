"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCredits } from "@/lib/format";
import { api } from "@/lib/player";

/** Sign (an unsigned Club freelancer, one-off fee) or release (one of yours) on a jockey's page. */
export function JockeyActions({ id, name, canSign, signFee, canRelease, signBlock }: { id: string; name: string; canSign: boolean; signFee: number; canRelease: boolean; signBlock: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(what: "sign" | "release") {
    if (what === "release" && !window.confirm(`Release ${name} to the Club pool? Another stable could sign them.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/jockeys/${encodeURIComponent(id)}/${what}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="jockey-actions">
      {canSign && (
        <button type="button" className="btn btn-brass" disabled={busy} onClick={() => act("sign")} data-testid="jockey-sign">
          Sign for {formatCredits(signFee)} cr
        </button>
      )}
      {canRelease && (
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act("release")} data-testid="jockey-release">
          Release
        </button>
      )}
      {!canSign && !canRelease && signBlock && <p className="t-meta">{signBlock}</p>}
      {error && (
        <p className="text-sm font-bold text-negative" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
