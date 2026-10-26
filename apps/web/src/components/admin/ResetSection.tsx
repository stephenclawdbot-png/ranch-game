"use client";

import { useState } from "react";
import { adminFetch } from "./adminApi";

const CONFIRM = "RESET PLAYTEST";

export function ResetSection() {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="surface grid max-w-2xl gap-3 border-2 border-negative p-4" data-testid="reset">
      <h2 className="t-display-m">Reset game progress</h2>
      <p className="text-cream-dim">
        Wipes every account, stable, horse, race, result, the credits ledger, leagues, cups, the market and packs. <strong className="text-cream">Kept:</strong> testers (and
        their wallets), invite codes, tester rewards, feedback, telemetry and the payout ledger. Testers re-join with their own invite code. Preview and production share
        one database: this resets both.
      </p>
      <label className="grid gap-1">
        <span className="font-bold">
          Type <span className="font-mono text-cream">{CONFIRM}</span> to confirm
        </span>
        <input className="field min-h-11 font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="reset-confirm" />
      </label>
      <button
        type="button"
        className="btn btn-oxblood w-fit"
        disabled={typed !== CONFIRM || busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const r = await adminFetch<{ reset: { tables: number; testersUnlinked: number } }>("/api/admin/reset", { body: { confirm: typed } });
            setResult(`Done: ${r.reset.tables} tables wiped, ${r.reset.testersUnlinked} testers unlinked.`);
            setTyped("");
          } catch (e) {
            setResult((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        data-testid="reset-go"
      >
        {busy ? "Resetting…" : "Reset game progress"}
      </button>
      {result && (
        <p role="status" className="font-bold" data-testid="reset-result">
          {result}
        </p>
      )}
    </div>
  );
}
