"use client";
/**
 * Testing phase: the tester's permanent login code (the same code every time), to sign back in
 * from any browser without a wallet. Shown first on the key screen right after the stable is
 * named (ComeBackKey), always on Profile, and as a one-line reminder after the first race result
 * for testers who never copied or saved it (`LoginCodeAfterResult`). Hidden outside the playtest
 * (the API answers 404).
 */
import { useEffect, useState } from "react";
import { usePlayerState } from "@/lib/player";
import { sendOnboarding, useOnboarding } from "../onboarding/guide";

/**
 * The one-time mark that the code was kept (copied, saved or shared on the key screen) or the
 * after-result reminder was dismissed (packages/db COACH_MARK_IDS).
 */
export const LOGIN_CODE_MARK = "login_code";

export function useLoginCode(): string | null | undefined {
  const [code, setCode] = useState<string | null | undefined>(undefined);
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
  return code;
}

function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
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
  );
}

export function LoginCodeCard({ compact = false }: { compact?: boolean }) {
  const code = useLoginCode();
  const [shown, setShown] = useState(!compact);
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
        <CodeBox code={code} />
      ) : (
        <button type="button" className="btn" onClick={() => setShown(true)} data-testid="login-code-show">
          Show my login code
        </button>
      )}
      <p className="caption">To sign in elsewhere: open posttime.family/link and enter the code.</p>
    </section>
  );
}

/** Testers only, until they dismiss it (the mark is kept on the server, so once is once on every device). */
export function showLoginCodeAfterResult(tester: boolean | undefined, coachSeen: readonly string[] | undefined): boolean {
  return tester === true && !!coachSeen && !coachSeen.includes(LOGIN_CODE_MARK);
}

/**
 * After a result of your own (the first one, in practice), testers only, and only if they never
 * copied or saved the code on the key screen after naming their stable (both set the same mark):
 * a one-line reminder below the result. Copy or close hides it for good (it stays on Profile).
 */
export function LoginCodeAfterResult() {
  const state = usePlayerState();
  const o = useOnboarding();
  const [gone, setGone] = useState(false);
  if (gone || !showLoginCodeAfterResult(state?.tester, o?.coachSeen)) return null;
  return <AfterResultCard onDismiss={() => {
    setGone(true);
    void sendOnboarding({ action: "coach", id: LOGIN_CODE_MARK }).catch(() => undefined);
  }} />;
}

/** One calm line: the code, Copy (which counts as saved) and a close. */
function AfterResultCard({ onDismiss }: { onDismiss: () => void }) {
  const code = useLoginCode();
  if (!code) return null;
  return (
    <p className="surface flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid="login-code">
      <span className="min-w-0 flex-1">
        Your key to come back: <code className="select-all font-mono font-bold tracking-wider" data-testid="login-code-value">{code}</code>
      </span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(onDismiss, () => undefined);
        }}
        data-testid="login-code-copy"
      >
        Copy
      </button>
      <button type="button" className="btn-ghost btn btn-sm" onClick={onDismiss} aria-label="Hide (it stays on your Profile)" data-testid="login-code-dismiss">
        ✕
      </button>
    </p>
  );
}
