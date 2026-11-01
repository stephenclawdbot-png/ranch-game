"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ActionBar } from "@/components/ui/ActionBar";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Wordmark } from "@/components/SiteNav";
import { SceneBackdrop } from "@/components/ui/Page";
import { PixelIcon } from "@/components/icons";
import { api, usePlayerState } from "@/lib/player";
import { afterSignInHref, nextFromLocation } from "@/lib/nextPath";
import { WalletSignIn } from "@/components/chain/WalletSignIn";

/**
 * Typed code mask: a device code (8 characters, dash after four) or, in the testing phase, a
 * permanent login code (PT- and 20 characters in fives) or the invite code you joined with
 * (TB-XXXX-XXXX).
 */
function maskCode(raw: string): string {
  let c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.startsWith("TB") && c.length <= 10) {
    c = c.slice(2);
    return `TB-${(c.match(/.{1,4}/g) ?? []).join("-")}`;
  }
  if (c.startsWith("PT") || c.length > 8) {
    c = c.replace(/^PT/, "").slice(0, 20);
    return `PT-${(c.match(/.{1,5}/g) ?? []).join("-")}`;
  }
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** An invite code (TB + 8 characters) rather than a device or login code. */
function isInviteCode(code: string): boolean {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 10 && c.startsWith("TB");
}

/** A short, honest device label for the "Devices" list ("iPhone · Safari"), from the user agent. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Safari";
  return `${os} · ${browser}`;
}

function Way({ n, title, children, testId }: { n: number; title: string; children: ReactNode; testId: string }) {
  return (
    <section className="surface grid gap-2 p-4" aria-labelledby={`${testId}-h`} data-testid={testId}>
      <h2 id={`${testId}-h`} className="flex items-center gap-2 font-extrabold">
        <span className="tag tag-ready" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Sign in to an existing stable, the ways back in in plain words and in order: your invite link
 * and your login code (testing phase), then your wallet. A device code from another signed-in
 * device works in the same box. A browser that already has a stable must confirm it will be
 * left behind. Afterwards: the page they were trying to open (`?next=`), else Home.
 */
export function LinkClient({ testing }: { testing: boolean }) {
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
      const body = { code, label: deviceLabel(), ...(hasStable && confirmed ? { replace: true } : {}) };
      // On success the response carries the player, so the shared state is already this stable.
      await api(testing && isInviteCode(code) ? "/api/account/invite-sign-in" : "/api/account/link", { body });
      // Back to the page they were trying to open, else Home with "Welcome back".
      window.location.assign(afterSignInHref(nextFromLocation()));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  if (state === undefined) return <div className="min-h-[60vh]" aria-busy />;

  const codeBox = (
    <>
      <label className="grid gap-1">
        <span className="font-extrabold">{testing ? "Login code or invite code" : "Device code"}</span>
        <input
          className="field min-h-11 uppercase tracking-[0.15em]"
          value={code}
          onChange={(e) => {
            setCode(maskCode(e.target.value));
            setNeedsConfirm(false);
          }}
          placeholder={testing ? "PT-XXXXX-… or TB-XXXX-XXXX" : "XXXX-XXXX"}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={26}
          aria-invalid={error !== null || undefined}
          data-testid="link-code-input"
        />
      </label>
      {hasStable && (
        <div className="surface-2 grid gap-2 p-3" data-testid="replace-warning" role={needsConfirm ? "alert" : undefined}>
          <p className="font-extrabold">This browser already has a stable: {state!.stableName}.</p>
          <p className="t-meta">
            Signing in here replaces it on this device. The old stable isn&rsquo;t deleted, but this browser can&rsquo;t reach it any more, so only continue if you can still open it elsewhere.
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
        <button type="submit" className="btn btn-brass btn-lg" disabled={busy || code.replace(/[^A-Z0-9]/g, "").length < 8} data-testid="link-submit">
          <PixelIcon name="telephone" size={16} /> {busy ? "Signing in…" : "Sign in"}
        </button>
      </ActionBar>
      <p className="caption">Signed in on another device? Profile there gives you a one-time device code that works here too.</p>
    </>
  );

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
      <SceneBackdrop scene="owners-office" />
      <header>
        <p className="w-fit">
          <Wordmark />
        </p>
        <h1 className="t-display-xl">Sign in to your stable</h1>
        <p className="mt-1 text-lg text-cream-dim">
          {testing ? "Three ways back in, whichever you have to hand:" : "Use the wallet your stable uses, or a code from your other device."}
        </p>
      </header>

      {testing ? (
        <>
          <Way n={1} title="Your invite link" testId="way-invite">
            <p className="t-meta">
              During the testing round, the invite link you joined with brings you straight back to your stable. Open it again on this device, or type its code (TB-XXXX-XXXX) in the box
              below.
            </p>
          </Way>
          <Way n={2} title="Your login code" testId="way-login-code">
            <p className="t-meta">The code you saved when you joined (PT-…). It&rsquo;s on your Profile too.</p>
            {codeBox}
          </Way>
          <Way n={3} title="Your wallet" testId="link-wallet">
            <p className="t-meta">If you linked a wallet: a free signature, no transaction.</p>
            <div id="wallet" className="grid scroll-mt-24 gap-2">
              <WalletSignIn />
            </div>
          </Way>
        </>
      ) : (
        <>
          <div id="wallet" className="grid scroll-mt-24 gap-2" data-testid="link-wallet">
            <WalletSignIn />
          </div>
          {codeBox}
        </>
      )}

      <p className="caption">
        New here?{" "}
        <Link href="/play" className="link">
          Found a stable instead
        </Link>
        .
      </p>
    </form>
  );
}
