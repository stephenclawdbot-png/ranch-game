"use client";

import { useState } from "react";
import { adminFetch, useAdminData, when } from "./adminApi";

interface Fb {
  id: string;
  category: string;
  rating: number | null;
  message: string;
  route: string | null;
  viewport: string | null;
  userAgent: string | null;
  clientErrors: string[] | null;
  status: "new" | "resolved";
  acceptedBug: boolean;
  testerId: string | null;
  stableName: string | null;
  createdAt: string;
}

export function FeedbackSection() {
  const [status, setStatus] = useState<"" | "new" | "resolved">("new");
  const [category, setCategory] = useState("");
  const { data, error, reload } = useAdminData<{ feedback: Fb[] }>(`/api/admin/feedback?status=${status}&category=${category}`);
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await adminFetch("/api/admin/feedback", { method: "PATCH", body: { id, ...body } });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <select className="field min-h-11" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status" data-testid="fb-filter-status">
          <option value="">All</option>
          <option value="new">New</option>
          <option value="resolved">Resolved</option>
        </select>
        <select className="field min-h-11" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="bug">Bug</option>
          <option value="idea">Idea</option>
          <option value="confusing">Confusing</option>
          <option value="fun">Fun</option>
        </select>
      </div>
      {error && <p className="font-bold text-negative">{error}</p>}
      {data && data.feedback.length === 0 && <p className="surface p-3 text-cream-dim">No feedback here.</p>}
      <ul className="grid gap-2" data-testid="fb-list">
        {data?.feedback.map((f) => (
          <li key={f.id} className="surface grid gap-2 p-3" data-testid="fb-item" data-status={f.status}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="chip text-cream">{f.category}</span>
              {f.rating && <span className="chip text-cream">{f.rating}/5</span>}
              {f.acceptedBug && <span className="chip chip-brass">Bug accepted</span>}
              <span className="text-cream-dim">
                {f.stableName ?? (f.testerId ? "tester" : "anonymous")} · {when(f.createdAt)} · {f.route ?? "?"} · {f.viewport ?? ""}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-cream">{f.message}</p>
            {f.clientErrors && f.clientErrors.length > 0 && (
              <details className="text-xs text-cream-dim">
                <summary className="min-h-11 cursor-pointer content-center">{f.clientErrors.length} client errors</summary>
                <pre className="whitespace-pre-wrap break-words">{f.clientErrors.join("\n")}</pre>
              </details>
            )}
            <p className="break-words text-xs text-cream-dim">{f.userAgent}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" disabled={busy === f.id} onClick={() => patch(f.id, { status: f.status === "new" ? "resolved" : "new" })} data-testid="fb-resolve">
                {f.status === "new" ? "Mark resolved" : "Reopen"}
              </button>
              {!f.acceptedBug && f.testerId && (
                <button type="button" className="btn btn-sm" disabled={busy === f.id} onClick={() => patch(f.id, { acceptBug: true })} data-testid="fb-accept">
                  Accept as bug (bounty)
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
