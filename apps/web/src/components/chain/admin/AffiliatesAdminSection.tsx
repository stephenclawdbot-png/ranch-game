"use client";
/** Admin → Affiliates: owner (root) stats, config, top inviters, the tree, flags, revoke. */
import { useState } from "react";
import { adminFetch, useAdminData, usd, when } from "@/components/admin/adminApi";
import { formatEth, shortAddress } from "@/lib/chain/format";

interface View {
  ownerAccountId: string | null;
  ownerWallet: string | null;
  treasury: string | null;
  treasuryEqualsOwnerWallet: boolean;
  onchainCeilings: { maxRef1Bps: number; maxRef2Bps: number } | null;
  config: { ref1Bps: number; ref2Bps: number; windowDays: number; weeklyCapUsdCents: number; ownerWeeklyCapUsdCents: number | null; activeReward: { credits: number; minRaces: number; minPlayDays: number } };
  owner: { salesWei: string; orders: number; level1Wei: string; level2Wei: string; treasuryWei: string; poolWei: string; commissionsWei: string };
  topInviters: { accountId: string; stableName: string | null; level1: number; level2: number; earnedWei: string; earnedUsdCents: number }[];
  tree: { accountId: string; stableName: string | null; inviterAccountId: string | null; upstreamAccountId: string | null; viaCode: string; joinedAt: string; revoked: boolean; activated: boolean }[];
  flagged: { accountId: string | null; relatedAccountId: string | null; kind: string; createdAt: string }[];
}

export function AffiliatesAdminSection() {
  const { data, error, reload } = useAdminData<View>("/api/admin/affiliates");
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <p className="text-negative">{error}</p>;
  if (!data) return <p className="caption">Loading…</p>;
  const name = new Map(data.tree.map((t) => [t.accountId, t.stableName] as const));
  const label = (id: string | null) => (id ? (id === data.ownerAccountId ? "OWNER" : (name.get(id) ?? id.slice(0, 8))) : "–");

  async function act(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try {
      await adminFetch("/api/admin/affiliates", { body });
      setMsg(ok);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="grid gap-4" data-testid="admin-affiliates">
      <section className="surface grid gap-2 p-3">
        <h3 className="t-display-m">Owner (root of the tree)</h3>
        {data.ownerAccountId ? (
          <p className="text-sm">
            Owner account {data.ownerAccountId.slice(0, 8)}… · affiliate wallet {data.ownerWallet ? shortAddress(data.ownerWallet) : "none"} · treasury {data.treasury ? shortAddress(data.treasury) : "–"}
          </p>
        ) : (
          <p className="text-sm font-bold text-negative">No owner yet: signups with admin codes have no inviter. Claim it on /admin/chain.</p>
        )}
        {data.treasuryEqualsOwnerWallet && <p className="text-sm font-bold text-negative">Treasury = your affiliate wallet. Allowed, but keep them separate for clean accounting.</p>}
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <Stat k="Sales in the tree" v={`${formatEth(data.owner.salesWei)} (${data.owner.orders})`} />
          <Stat k="Owner level 1" v={formatEth(data.owner.level1Wei)} />
          <Stat k="Owner level 2" v={formatEth(data.owner.level2Wei)} />
          <Stat k="Treasury income" v={formatEth(data.owner.treasuryWei)} />
          <Stat k="Pool contributions" v={formatEth(data.owner.poolWei)} />
          <Stat k="All commissions" v={formatEth(data.owner.commissionsWei)} />
        </dl>
      </section>

      <ConfigForm v={data} onSave={(body) => act({ action: "config", ...body }, "Saved ✓")} />

      <section className="surface grid gap-2 p-3">
        <h3 className="t-display-m">Top inviters</h3>
        <ul className="grid gap-1 text-sm">
          {data.topInviters.map((t) => (
            <li key={t.accountId}>
              {label(t.accountId)} · L1 {t.level1} · L2 {t.level2} · earned {formatEth(t.earnedWei)} ({usd(t.earnedUsdCents)})
            </li>
          ))}
          {!data.topInviters.length && <li className="text-cream-dim">Nobody yet.</li>}
        </ul>
      </section>

      <section className="surface grid gap-2 p-3">
        <h3 className="t-display-m">Flagged (linked accounts)</h3>
        <ul className="grid gap-1 text-sm">
          {data.flagged.map((f, i) => (
            <li key={i}>
              {when(f.createdAt)} · {f.kind} · {label(f.accountId)} ↔ {label(f.relatedAccountId)}
            </li>
          ))}
          {!data.flagged.length && <li className="text-cream-dim">No open flags.</li>}
        </ul>
      </section>

      <section className="surface grid gap-2 p-3">
        <h3 className="t-display-m">Tree ({data.tree.length})</h3>
        <table className="w-full text-sm" data-testid="affiliate-tree">
          <thead>
            <tr className="label text-left">
              <th>Invitee</th>
              <th>Level 1</th>
              <th>Level 2</th>
              <th>Code</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.tree.map((t) => (
              <tr key={t.accountId} className="border-t-2 border-line">
                <td>
                  {t.stableName ?? t.accountId.slice(0, 8)}
                  {t.activated ? " ✓" : ""}
                </td>
                <td>{label(t.inviterAccountId)}</td>
                <td>{label(t.upstreamAccountId)}</td>
                <td className="font-mono text-xs">{t.viaCode}</td>
                <td>{when(t.joinedAt)}</td>
                <td>
                  {t.revoked ? (
                    "revoked"
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const reason = prompt("Reason for revoking this referral (no future commissions)?");
                        if (reason) void act({ action: "revoke", accountId: t.accountId, reason }, "Revoked ✓");
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {msg && <p className="surface p-3 font-bold">{msg}</p>}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="inset grid p-2">
      <dt className="label">{k}</dt>
      <dd className="num text-cream">{v}</dd>
    </div>
  );
}

function ConfigForm({ v, onSave }: { v: View; onSave: (b: Record<string, unknown>) => void }) {
  const c = v.config;
  const [l1, setL1] = useState(c.ref1Bps / 100);
  const [l2, setL2] = useState(c.ref2Bps / 100);
  const [win, setWin] = useState(c.windowDays);
  const [cap, setCap] = useState(c.weeklyCapUsdCents / 100);
  const [ownerCap, setOwnerCap] = useState<string>(c.ownerWeeklyCapUsdCents === null ? "" : String(c.ownerWeeklyCapUsdCents / 100));
  const [credits, setCredits] = useState(c.activeReward.credits);
  const ceil = v.onchainCeilings;
  return (
    <section className="surface grid gap-2 p-3">
      <h3 className="t-display-m">Rules</h3>
      <div className="flex flex-wrap gap-3 text-sm">
        <label>
          Level 1 % <input type="number" step="0.1" className="field min-h-11 w-20" min={0} max={15} value={l1} onChange={(e) => setL1(Number(e.target.value))} />
        </label>
        <label>
          Level 2 % <input type="number" step="0.1" className="field min-h-11 w-20" min={0} max={5} value={l2} onChange={(e) => setL2(Number(e.target.value))} />
        </label>
        <label>
          Window (days) <input type="number" className="field min-h-11 w-20" min={1} value={win} onChange={(e) => setWin(Number(e.target.value))} />
        </label>
        <label>
          Weekly cap per inviter ($) <input type="number" className="field min-h-11 w-24" min={0} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </label>
        <label>
          Owner weekly cap ($, empty = none) <input type="number" className="field min-h-11 w-24" min={0} value={ownerCap} onChange={(e) => setOwnerCap(e.target.value)} />
        </label>
        <label>
          Active-invitee reward (credits) <input type="number" className="field min-h-11 w-24" min={0} value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
        </label>
      </div>
      {ceil && (Math.round(l1 * 100) > ceil.maxRef1Bps || Math.round(l2 * 100) > ceil.maxRef2Bps) && (
        <p className="text-sm font-bold text-negative">
          Above the store&apos;s on-chain ceilings ({ceil.maxRef1Bps / 100}% / {ceil.maxRef2Bps / 100}%): raise them with setReferralBps from the owner wallet first, or quotes will fail.
        </p>
      )}
      <button
        type="button"
        className="btn w-fit"
        onClick={() =>
          onSave({
            ref1Bps: Math.round(l1 * 100),
            ref2Bps: Math.round(l2 * 100),
            windowDays: win,
            weeklyCapUsdCents: Math.round(cap * 100),
            ownerWeeklyCapUsdCents: ownerCap === "" ? null : Math.round(Number(ownerCap) * 100),
            activeReward: { credits },
          })
        }
      >
        Save rules
      </button>
    </section>
  );
}
