"use client";

import { useState } from "react";
import { adminFetch, useAdminData, when } from "./adminApi";

interface Code {
  code: string;
  maxUses: number;
  uses: number;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export function InvitesSection() {
  const { data, error, reload } = useAdminData<{ config: { enabled: boolean; testerCap: number }; codes: Code[] }>("/api/admin/invites");
  const [count, setCount] = useState("10");
  const [maxUses, setMaxUses] = useState("1");
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminFetch<{ codes: string[] }>("/api/admin/invites", { body: { count: Number(count), maxUses: Number(maxUses), note: note || undefined } });
      setFresh(r.codes);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const links = fresh.map((c) => `${c}  ${origin}/play?invite=${c}`).join("\n");

  return (
    <div className="grid gap-4">
      {error && <p className="font-bold text-negative">{error}</p>}
      {data && (
        <p className="t-meta" data-testid="playtest-config">
          Playtest mode: <strong className="text-cream">{data.config.enabled ? "ON (invite only)" : "OFF (open signups)"}</strong> · tester cap {data.config.testerCap} · {data.codes.length}{" "}
          codes, {data.codes.reduce((n, c) => n + c.uses, 0)} used
        </p>
      )}
      <form
        className="surface flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <label className="grid gap-1">
          <span className="text-sm font-bold">How many</span>
          <input className="field min-h-11 w-24" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} data-testid="invite-count" />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-bold">Uses each</span>
          <input className="field min-h-11 w-24" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </label>
        <label className="grid min-w-0 flex-1 basis-48 gap-1">
          <span className="text-sm font-bold">Note (who it&rsquo;s for)</span>
          <input className="field min-h-11" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <button type="submit" className="btn btn-brass" disabled={busy} data-testid="invite-generate">
          {busy ? "Generating…" : "Generate codes"}
        </button>
      </form>
      {msg && <p className="font-bold text-negative">{msg}</p>}
      {fresh.length > 0 && (
        <div className="surface-2 grid gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-extrabold">New codes (with invite links)</p>
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(links)}>
              Copy all
            </button>
          </div>
          <textarea className="field min-h-40 p-2 font-mono text-sm" readOnly value={links} data-testid="invite-new-codes" />
        </div>
      )}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-cream-dim">
              <tr>
                <th className="p-2">Code</th>
                <th className="p-2">Used</th>
                <th className="p-2">Note</th>
                <th className="p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.codes.map((c) => (
                <tr key={c.code} className="border-t-2 border-line">
                  <td className="p-2 font-mono">{c.code}</td>
                  <td className="p-2">
                    {c.uses}/{c.maxUses}
                  </td>
                  <td className="p-2">{c.note ?? ""}</td>
                  <td className="p-2">{when(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
