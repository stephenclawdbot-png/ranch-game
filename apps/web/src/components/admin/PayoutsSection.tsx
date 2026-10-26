"use client";

import { useState } from "react";
import { adminFetch, usd, useAdminData, when } from "./adminApi";

interface Rule {
  key: string;
  label: string;
  amountUsdCents: number;
  active: boolean;
}
interface Reward {
  id: string;
  testerId: string;
  ruleKey: string;
  period: string;
  amountUsdCents: number;
  status: "pending" | "approved" | "paid" | "void";
  txHash: string | null;
  notes: string | null;
  stableName: string | null;
  walletAddress: string | null;
  createdAt: string;
}
interface View {
  rules: Rule[];
  rewards: Reward[];
  budget: { pendingCents: number; approvedCents: number; paidCents: number; budgetCents: number | null; over: boolean };
  explorer: string;
}

/**
 * The manual payout ledger (fallback): tester bonuses (bug bounties, best feedback) reviewed and
 * paid by hand from the operator's wallet; we only record tx hashes. Weekly prizes are the
 * on-chain Prize Pool's job.
 */
export function PayoutsSection() {
  const { data, error, reload } = useAdminData<View>("/api/admin/payouts");
  const [msg, setMsg] = useState<string | null>(null);
  const [tx, setTx] = useState<Record<string, string>>({});

  async function act(body: Record<string, unknown>) {
    setMsg(null);
    try {
      await adminFetch("/api/admin/payouts", { body });
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  if (error) return <p className="font-bold text-negative">{error}</p>;
  if (!data) return <p className="text-cream-dim">Loading…</p>;
  const b = data.budget;
  return (
    <div className="grid gap-4" data-testid="payouts">
      <p className="text-sm text-cream-dim">
        Manual fallback ledger in USD. Nothing is sent from the server: pay from your own wallet, then record the transaction hash. Stable Credits are never converted.
      </p>
      <section className={`surface p-3 ${b.over ? "border-2 border-negative" : ""}`} data-testid="budget">
        <p className="text-sm">
          Pending <strong className="num">{usd(b.pendingCents)}</strong> · approved <strong className="num">{usd(b.approvedCents)}</strong> · paid{" "}
          <strong className="num">{usd(b.paidCents)}</strong>
          {b.budgetCents !== null && (
            <>
              {" "}
              · budget <strong className="num">{usd(b.budgetCents)}</strong>
            </>
          )}
        </p>
        {b.over && <p className="font-bold text-negative">Over budget (BETA_BUDGET_USD).</p>}
      </section>

      <section className="surface grid gap-2 p-3">
        <h2 className="t-title">Rules</h2>
        <ul className="grid gap-2">
          {data.rules.map((r) => (
            <RuleRow key={r.key} rule={r} onSave={(patch) => act({ action: "rule", key: r.key, ...patch })} />
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-title">Rewards</h2>
          <a className="btn btn-sm" href="/api/admin/payouts/csv" data-testid="payouts-csv">
            Export approved, unpaid (CSV)
          </a>
        </div>
        {msg && <p className="font-bold text-negative">{msg}</p>}
        {data.rewards.length === 0 && <p className="surface p-3 text-cream-dim">No rewards yet. Accepting a bug report in Feedback creates a pending bounty.</p>}
        <ul className="grid gap-2">
          {data.rewards.map((r) => (
            <li key={r.id} className="surface grid gap-2 p-3 text-sm" data-testid="payout-row" data-status={r.status}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip text-cream">{r.status}</span>
                <strong>{r.stableName ?? "tester"}</strong>
                <span className="text-cream-dim">
                  {r.ruleKey} · {r.period} · {when(r.createdAt)}
                </span>
                <span className="num ml-auto text-cream">{usd(r.amountUsdCents)}</span>
              </div>
              {r.notes && <p className="break-words text-cream-dim">{r.notes}</p>}
              <p className="break-all font-mono text-xs text-cream-dim">wallet: {r.walletAddress ?? "not set"}</p>
              {r.txHash && (
                <a className="break-all font-mono text-xs underline" href={`${data.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer">
                  {r.txHash}
                </a>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {r.status === "pending" && (
                  <button type="button" className="btn btn-sm" onClick={() => act({ action: "approve", id: r.id })} data-testid="payout-approve">
                    Approve
                  </button>
                )}
                {(r.status === "pending" || r.status === "approved") && (
                  <button type="button" className="btn btn-sm" onClick={() => act({ action: "void", id: r.id })}>
                    Void
                  </button>
                )}
                {r.status === "void" && (
                  <button type="button" className="btn btn-sm" onClick={() => act({ action: "pending", id: r.id })}>
                    Back to pending
                  </button>
                )}
                {r.status === "approved" && (
                  <form
                    className="flex min-w-0 flex-1 flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({ action: "paid", id: r.id, txHash: tx[r.id] ?? "" });
                    }}
                  >
                    <input
                      className="field min-h-11 min-w-0 flex-1 basis-64 font-mono text-xs"
                      placeholder="0x… transaction hash (66 characters)"
                      value={tx[r.id] ?? ""}
                      onChange={(e) => setTx({ ...tx, [r.id]: e.target.value })}
                      data-testid="payout-tx"
                    />
                    <button type="submit" className="btn btn-sm" disabled={!/^0x[0-9a-fA-F]{64}$/.test((tx[r.id] ?? "").trim())} data-testid="payout-paid">
                      Mark paid
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RuleRow({ rule, onSave }: { rule: Rule; onSave: (patch: { amountUsdCents?: number; active?: boolean; label?: string }) => void }) {
  const [amount, setAmount] = useState((rule.amountUsdCents / 100).toFixed(2));
  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents >= 0 && cents <= 1_000_000;
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 basis-48 font-bold">
        {rule.label} <span className="font-mono text-xs text-cream-dim">{rule.key}</span>
      </span>
      <label className="flex items-center gap-1">
        $
        <input className="field min-h-11 w-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`${rule.label} amount in USD`} />
      </label>
      <button type="button" className="btn btn-sm" disabled={!valid || cents === rule.amountUsdCents} onClick={() => onSave({ amountUsdCents: cents })}>
        Save
      </button>
      <button type="button" className="btn btn-sm" onClick={() => onSave({ active: !rule.active })}>
        {rule.active ? "Disable" : "Enable"}
      </button>
    </li>
  );
}
