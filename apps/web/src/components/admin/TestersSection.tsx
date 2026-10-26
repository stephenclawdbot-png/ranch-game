"use client";

import { useAdminData, when } from "./adminApi";

interface Tester {
  id: string;
  inviteCode: string;
  accountId: string | null;
  stableName: string | null;
  walletAddress: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
  races: number;
  daysPlayed: number;
  rewards: string[];
}

export function TestersSection() {
  const { data, error } = useAdminData<{ testers: Tester[] }>("/api/admin/testers");
  if (error) return <p className="font-bold text-negative">{error}</p>;
  if (!data) return <p className="text-cream-dim">Loading…</p>;
  return (
    <div className="grid gap-2">
      <p className="t-meta">{data.testers.length} testers · ids survive the reset; testers re-join with their own invite code.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm" data-testid="testers-table">
          <thead className="text-cream-dim">
            <tr>
              <th className="p-2">Stable</th>
              <th className="p-2">Joined</th>
              <th className="p-2">Last seen</th>
              <th className="p-2">Races</th>
              <th className="p-2">Days</th>
              <th className="p-2">Wallet</th>
              <th className="p-2">Code</th>
            </tr>
          </thead>
          <tbody>
            {data.testers.map((t) => (
              <tr key={t.id} className="border-t-2 border-line">
                <td className="p-2 font-bold">
                  {t.stableName ?? "–"}
                  {!t.accountId && <span className="ml-1 text-xs text-cream-dim">(not re-joined)</span>}
                </td>
                <td className="p-2">{when(t.joinedAt)}</td>
                <td className="p-2">{when(t.lastSeenAt)}</td>
                <td className="p-2">{t.races}</td>
                <td className="p-2">{t.daysPlayed}</td>
                <td className="p-2 font-mono text-xs">{t.walletAddress ?? "–"}</td>
                <td className="p-2 font-mono text-xs">{t.inviteCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
