"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "./adminApi";
import { ADMIN_SECTIONS } from "./sections";

/** /admin: tabs from the section registry (sections.tsx); the tab lives in the URL hash. */
export function AdminShell() {
  const [tab, setTab] = useState(ADMIN_SECTIONS[0]!.key);
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (ADMIN_SECTIONS.some((s) => s.key === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const active = ADMIN_SECTIONS.find((s) => s.key === tab) ?? ADMIN_SECTIONS[0]!;
  return (
    <div className="grid gap-5" data-testid="admin">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Closed playtest</p>
          <h1 className="t-page">Admin</h1>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
            window.location.reload();
          }}
        >
          Sign out
        </button>
      </header>
      <nav className="-mx-4 overflow-x-auto px-4" aria-label="Admin sections">
        <div className="segmented w-max" role="tablist">
          {ADMIN_SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === active.key}
              onClick={() => {
                setTab(s.key);
                history.replaceState(null, "", `#${s.key}`);
              }}
              data-testid={`admin-tab-${s.key}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>
      <section role="tabpanel" aria-label={active.label}>
        <active.Component />
      </section>
    </div>
  );
}

export function AdminLogin({ enabled }: { enabled: boolean }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) {
    return (
      <div className="surface mx-auto max-w-md p-4" data-testid="admin-disabled">
        <h1 className="t-h2">Admin is off</h1>
        <p className="mt-1 text-cream-dim">Set ADMIN_SECRET (12+ characters) in the server environment to enable /admin.</p>
      </div>
    );
  }
  return (
    <form
      className="surface mx-auto grid max-w-md gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await adminFetch("/api/admin/session", { body: { secret } });
          window.location.reload();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
      data-testid="admin-login"
    >
      <h1 className="t-h2">Admin sign-in</h1>
      <label className="grid gap-1">
        <span className="font-bold">Admin secret</span>
        <input className="field min-h-11" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="current-password" data-testid="admin-secret" />
      </label>
      {error && (
        <p role="alert" className="font-bold text-negative">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-brass w-fit" disabled={!secret || busy} data-testid="admin-signin">
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
