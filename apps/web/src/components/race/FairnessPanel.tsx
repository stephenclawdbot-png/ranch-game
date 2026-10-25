"use client";

import { useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { shortHash } from "@/lib/format";
import { PixelIcon } from "../icons";

/** sha256 over the raw seed bytes, exactly as the engine's commitSeed() does — computed locally. */
async function browserCommitment(seedHex: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(seedHex.match(/../g)!.map((b) => parseInt(b, 16)));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // no WebCrypto (insecure context): rely on the server check
  }
}

interface VerifyResponse {
  commitmentOk: boolean;
  resultHashOk: boolean;
  seed: string;
  seedCommitment: string;
  resultHash: string;
  engineVersion: string;
}

function Hash({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="inset mt-1 break-all px-2 py-1 font-mono text-xs leading-snug text-cream" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className={`font-extrabold ${ok ? "text-positive" : "text-negative"}`}>
        {ok ? "✓" : "✕"}
      </span>
      <span className="sr-only">{ok ? "✓" : "✕"}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Race integrity as a quiet seal (no casino language): "Sealed" before the off with the
 * fingerprint one tap away; after the finish the seed is revealed and the browser can verify.
 * The seed and result only appear once the official result exists (`replay`).
 */
export function FairnessPanel({ card, replay }: { card: RaceCard; replay: RaceReplay | null }) {
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [localOk, setLocalOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!replay) return;
    setBusy(true);
    setError(null);
    try {
      // Send what this page saw: the commitment published before the race and the hash of the result it played.
      const qs = new URLSearchParams({ commitment: card.seedCommitment, resultHash: replay.result.resultHash });
      const res = await fetch(`/api/races/${encodeURIComponent(card.id)}/verify?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVerify((await res.json()) as VerifyResponse);
      const local = await browserCommitment(replay.seed);
      setLocalOk(local === null ? null : local === card.seedCommitment);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const verified = verify && verify.commitmentOk && verify.resultHashOk && localOk !== false;

  return (
    <section className="surface h-fit p-3" aria-labelledby="fair-h" data-testid="fairness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fair-h" className="flex items-center gap-2 font-extrabold">
          <PixelIcon name="shield" size={32} className="-my-1" />
          {verified ? "Verified race" : replay ? "Sealed race · result revealed" : "Sealed race"}
        </h2>
        {replay && !verify && (
          <button type="button" onClick={run} disabled={busy} className="btn btn-sm" data-testid="verify-button">
            {busy ? "Re-running the race…" : "Verify"}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-cream-dim">
        {replay
          ? "The secret seed is now public. Verify re-checks it against the fingerprint published before the off and re-runs the race."
          : `The outcome was locked when entries closed. Fingerprint ${shortHash(card.seedCommitment, 6)}.`}
      </p>
      {verify && (
        <ul className="mt-3 grid gap-1.5 text-sm" data-testid="verify-result">
          <Check ok={verify.commitmentOk}>The seed matches the fingerprint published before the off</Check>
          {localOk !== null && <Check ok={localOk}>Your browser hashed the seed itself and got the same fingerprint</Check>}
          <Check ok={verify.resultHashOk}>Re-running the race gives exactly the same result</Check>
          <li className="caption pl-5">Engine {verify.engineVersion}</li>
        </ul>
      )}
      {error && <p className="mt-2 text-sm font-bold text-negative">Couldn&rsquo;t run the check ({error}).</p>}
      <details className="mt-2">
        <summary className="inline-flex min-h-11 items-center text-sm font-bold text-cream-dim underline decoration-2 underline-offset-4">How sealing works</summary>
        <div className="mt-2 grid gap-3 text-sm text-cream-dim">
          <p>
            Each race is decided by a secret seed fixed when the card is drawn. Its fingerprint (a sha256 hash) is published before the off. After
            the finish the seed is revealed, so anyone can check it matches and that replaying the race gives the same result.
          </p>
          <Hash label="Fingerprint (published before the off)" value={card.seedCommitment} testId="seed-commitment" />
          {replay && <Hash label="Revealed seed" value={replay.seed} testId="seed-revealed" />}
          {replay && <Hash label="Result hash" value={replay.result.resultHash} />}
        </div>
      </details>
    </section>
  );
}
