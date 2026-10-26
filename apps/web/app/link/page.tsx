"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionBar } from "@/components/ui/ActionBar";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Wordmark } from "@/components/SiteNav";
import { PixelIcon } from "@/components/icons";
import { api, usePlayerState } from "@/lib/player";

/** Typed code mask: uppercase, 8 characters from the unambiguous alphabet, dash after four. */
function maskCode(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** A short, honest device label for the "Devices" list ("iPhone · Safari"), from the user agent. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Safari";
  return `${os} · ${browser}`;
}

/**
 * Link a device to an existing stable: the player shows a code on /me and types it here.
 * A browser that already has a stable must confirm it will be left behind.
 */
export default function LinkPage() {
  const state = usePlayerState();
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const hasStable = state !== null && state !== undefined;

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("code");
    if (fromLink) setCode(maskCode(fromLink));
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // On success the response carries the player, so the shared state is already this stable.
      await api("/api/account/link", { body: { code, label: deviceLabel(), ...(hasStable && confirmed ? { replace: true } : {}) } });
      window.location.assign("/stable");
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  if (state === undefined) return <div className="min-h-[60vh]" aria-busy />;

  return (
    <form
      className="mx-auto grid max-w-xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (hasStable && !confirmed) {
          setNeedsConfirm(true);
          return;
        }
        void submit();
      }}
      data-testid="link-page"
    >
      <header>
        <p className="w-fit">
          <Wordmark />
        </p>
        <h1 className="t-display-xl">Bring your stable here</h1>
        <p className="mt-1 text-lg text-cream-dim">
          Playing on a new phone or browser? Enter the link code from your other device and this one signs in to the same stable.
        </p>
      </header>
      <label className="grid gap-1">
        <span className="font-extrabold">Link code</span>
        <input
          className="field min-h-11 uppercase tracking-[0.15em]"
          value={code}
          onChange={(e) => {
            setCode(maskCode(e.target.value));
            setNeedsConfirm(false);
          }}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={9}
          aria-invalid={error !== null || undefined}
          data-testid="link-code-input"
        />
      </label>

      {hasStable && (
        <div className="surface-2 grid gap-2 p-3" data-testid="replace-warning" role={needsConfirm ? "alert" : undefined}>
          <p className="font-extrabold">This browser already has a stable: {state!.stableName}.</p>
          <p className="t-meta">
            Linking here replaces it on this device. The old stable isn&rsquo;t deleted, but this browser can&rsquo;t reach it any more, so only continue if you can still open it elsewhere.
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="replace-confirm" />
            <span className="t-meta">Leave this browser&rsquo;s stable behind and sign in with the code</span>
          </label>
        </div>
      )}
      {needsConfirm && (
        <p className="font-bold text-negative" data-testid="replace-needed">
          Tick the box above to continue: this browser&rsquo;s stable will be left behind.
        </p>
      )}
      {error !== null && <ErrorNote error={error} />}
      <ActionBar>
        <button type="submit" className="btn btn-brass btn-lg" disabled={busy || code.replace("-", "").length < 8} data-testid="link-submit">
          <PixelIcon name="flag" className="h-5 w-5" /> {busy ? "Linking…" : "Link this device"}
        </button>
      </ActionBar>
      <p className="caption">
        New here, without a code?{" "}
        <Link href="/play" className="link">
          Found a stable instead
        </Link>
        .
      </p>
    </form>
  );
}