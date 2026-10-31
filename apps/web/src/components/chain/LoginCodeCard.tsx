"use client";
/**
 * Testing phase: the tester's permanent login code (the same code every time), to sign back in
 * from any browser without a wallet. Shown on Profile and after founding. Hidden outside the
 * playtest (the API answers 404).
 */
import { useEffect, useState } from "react";

export function LoginCodeCard({ compact = false }: { compact?: boolean }) {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [shown, setShown] = useState(!compact);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/account/login-code", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ code: string }>) : null))
      .then((d) => live && setCode(d?.code ?? null))
      .catch(() => live && setCode(null));
    return () => {
      live = false;
    };
  }, []);
  if (!code) return null;
  return (
    <section id="login-code" className="surface grid scroll-mt-24 gap-2 p-4" aria-labelledby="login-code-h" data-testid="login-code">
      <h2 id="login-code-h" className="t-h2">
        Your login code
      </h2>
      <p className="t-meta">
        For the testing phase: this code signs you back into this stable from any browser, no wallet needed. It never changes. Save it somewhere safe and don&rsquo;t share it.
      </p>
      {shown ? (
        <div className="surface-2 flex flex-wrap items-center justify-between gap-2 p-3">
          <code className="select-all break-all font-mono text-lg font-bold tracking-wider" data-testid="login-code-value">
            {code}
          </code>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setShown(true)} data-testid="login-code-show">
          Show my login code
        </button>
      )}
      <p className="caption">To sign in elsewhere: open posttime.family/link and enter the code.</p>
    </section>
  );
}
