"use client";

import { useState, type ReactNode } from "react";

/**
 * "The yard is closed for a moment": what players see when the database cannot be reached or
 * is over its quota, instead of a bare error page. Also the designed fallback for any other
 * page error (`variant="error"`). Used by /outage (HTTP 503), app/error.tsx, app/global-error.tsx
 * and the in-app overlay (OutageOverlay) when an API call reports the outage.
 *
 * Plain links and one button only: it has to work when nearly nothing else does. The art is a
 * static file (no art manifest, no providers), so it renders inside global-error too.
 */
export type OutageVariant = "outage" | "error" | "checking";

const COPY: Record<Exclude<OutageVariant, "checking">, { title: string; body: ReactNode; note: string }> = {
  outage: {
    title: "The yard is closed for a moment",
    body: (
      <>
        We can&rsquo;t reach the stable records right now, so the game is paused. <b className="text-cream">Your stable is safe</b>: your horses, credits and entries are all kept, and nothing you&rsquo;ve done is
        lost.
      </>
    ),
    note: "Try again in a little while. The guide is still open if you'd like something to read.",
  },
  error: {
    title: "Something went wrong at the track",
    body: (
      <>
        That page didn&rsquo;t load. It&rsquo;s our mistake, not yours. <b className="text-cream">Your stable is safe</b>: your horses, credits and entries are all kept.
      </>
    ),
    note: "Try again, or head back to your yard.",
  },
};

/** A same-site path to go back to ("/races"), or null: never an absolute or protocol-relative URL. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 300) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.startsWith("/outage")) return null;
  return raw;
}

export function OutageScreen({
  variant = "outage",
  onRetry,
  retryHref,
  compact = false,
}: {
  variant?: OutageVariant;
  /** Try again without leaving the page (error boundaries, the overlay). May return a promise: the button waits for it. */
  onRetry?: () => void | Promise<void>;
  /** Without `onRetry`: where Try again goes (default: `?from=` on the URL, else a reload). */
  retryHref?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const checking = variant === "checking";
  const copy = COPY[checking ? "outage" : variant];

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (onRetry) {
        await onRetry();
        return;
      }
      const from = safeReturnPath(retryHref ?? new URLSearchParams(window.location.search).get("from"));
      if (from) window.location.assign(from);
      else window.location.reload();
      // a navigation is under way: keep the button busy until the page goes
      await new Promise((r) => setTimeout(r, 4000));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`mx-auto grid max-w-lg gap-4 ${compact ? "" : "pt-8"}`} data-testid="outage-screen" data-variant={variant}>
      <div className="surface flex flex-col items-center gap-3 px-6 py-10 text-center" role={checking ? "status" : "alert"} aria-busy={checking || undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/ui/icon-stable-door.png" width={96} height={96} alt="" aria-hidden className="pixelated" draggable={false} />
        <p className="eyebrow uppercase">Kestrel Downs</p>
        {checking ? (
          <h1 className="t-h2">One moment&hellip;</h1>
        ) : (
          <>
            <h1 className="t-h2 !text-[1.75rem] !leading-8 md:!text-[2.25rem] md:!leading-10" data-testid="outage-title">
              {copy.title}
            </h1>
            <p className="max-w-md text-cream-dim">{copy.body}</p>
            <p className="t-meta max-w-md">{copy.note}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <button type="button" className="btn btn-brass btn-lg" onClick={() => void retry()} disabled={busy} aria-busy={busy || undefined} data-testid="outage-retry">
                {busy ? "Checking…" : "Try again"}
              </button>
              {variant === "outage" ? (
                <a href="/wiki" className="btn btn-outline">
                  Read the guide
                </a>
              ) : (
                <a href="/" className="btn btn-outline">
                  Back to your yard
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
