"use client";

import { useState } from "react";
import type { RaceReplay } from "@thoroughbred/shared";
import type { RaceCard } from "@/server/races";
import { ShieldIcon } from "../icons";

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
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sage">{label}</p>
      <p className="mt-1 break-all rounded-lg bg-ink/50 px-2.5 py-2 font-mono text-[0.7rem] leading-relaxed text-cream-dim" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-emerald-500/20 text-emerald-300" : "bg-claret/25 text-[#f3a197]"}`}
        aria-hidden
      >
        {ok ? "✓" : "✕"}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Seed commitment before the off; seed reveal + server re-simulation check afterwards. */
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

  return (
    <aside className="panel h-fit p-5" aria-labelledby="fair-h" data-testid="fairness">
      <div className="flex items-center gap-2">
        <ShieldIcon className="h-5 w-5 text-brass" />
        <h2 id="fair-h" className="display text-lg font-semibold">
          Provably fair
        </h2>
      </div>
      {!replay ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-cream-dim">
            The race is decided by a secret seed fixed when the card was drawn. Its fingerprint is published now; the seed itself is
            revealed after the finish so anyone can check it matches and that replaying the race gives the same result.
          </p>
          <div className="mt-4">
            <Hash label="Seed commitment · sha256" value={card.seedCommitment} testId="seed-commitment" />
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-cream-dim">
            The seed is now public. Its sha256 must equal the commitment published before the off, and re-running the engine with it must
            reproduce this exact result.
          </p>
          <div className="mt-4 grid gap-3">
            <Hash label="Seed commitment · published before the off" value={card.seedCommitment} testId="seed-commitment" />
            <Hash label="Revealed seed" value={replay.seed} testId="seed-revealed" />
            <Hash label="Result hash" value={replay.result.resultHash} />
          </div>
          {verify ? (
            <ul className="mt-4 grid gap-2 text-sm" data-testid="verify-result">
              <Check ok={verify.commitmentOk}>Seed hashes to the published commitment</Check>
              {localOk !== null && <Check ok={localOk}>Your browser hashed the seed itself and got the same commitment</Check>}
              <Check ok={verify.resultHashOk}>Independent re-simulation reproduces the result</Check>
              <li className="pl-7 text-xs text-sage">Engine {verify.engineVersion}</li>
            </ul>
          ) : (
            <button type="button" onClick={run} disabled={busy} className="btn btn-ghost mt-4 w-full" data-testid="verify-button">
              <ShieldIcon className="h-4 w-4" />
              {busy ? "Re-running the race…" : "Verify fairness"}
            </button>
          )}
          {error && <p className="mt-2 text-sm text-claret">Verification failed to run ({error}).</p>}
        </>
      )}
    </aside>
  );
}
