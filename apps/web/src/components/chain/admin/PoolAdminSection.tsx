"use client";
/**
 * Admin → Prize Pool: compute the next epoch from league/cup/activity data (USD caps converted
 * at today's median ETH/USD), review it, then post the root (server key, or your wallet), and
 * see the history. Posting is the only way money is promised; the contract caps every epoch.
 */
import Link from "next/link";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { adminFetch, useAdminData, usd, when } from "@/components/admin/adminApi";
import { prizePoolAbi } from "@/lib/chain/contracts.generated";
import { txUrl } from "@/lib/chain/chains";
import { formatEth, shortAddress } from "@/lib/chain/format";
import { clients, ensureChain, walletErrorText } from "@/lib/chain/wallet";
import { WalletPicker } from "../WalletPicker";
import { useWallet } from "../useWallet";

interface Draft {
  draftId: string | null;
  epochId: number;
  root: Hex | null;
  totalWei: string;
  budgetWei: string;
  budgetUsdCents: number;
  availableWei: string;
  ethUsd: number;
  priceSources: { source: string; usd: number | null }[];
  period: { from: string; to: string };
  allocations: { rank: number; stableName: string | null; wallet: string; score: number; activeDays: number; usdCents: number; amountWei: string }[];
  scores: { stableName: string | null; score: number; activeDays: number; eligible: boolean; reason: string | null; wallet: string | null; flagged: boolean }[];
  canServerPost: boolean;
  calldata: { epochId: number; root: Hex; total: string; leafCount: number; uri: string } | null;
}
interface History {
  epochs: { id: string; epochId: number; kind: string; status: string; weekStart: string; totalWei: string; leafCount: number; ethUsdMicros: number; txHash: string | null; postedAtMs: number | null; createdAtMs: number }[];
}
interface ChainStatus {
  config: { chainId: number; pool: Address | null; enabled: boolean };
}

export function PoolAdminSection() {
  const { data: hist, reload } = useAdminData<History>("/api/admin/pool");
  const { data: st } = useAdminData<ChainStatus>("/api/admin/chain");
  const w = useWallet();
  const [kind, setKind] = useState<"weekly" | "season">("weekly");
  const [weekStart, setWeekStart] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [budgetPct, setBudgetPct] = useState(25);
  const [capUsd, setCapUsd] = useState(20);
  const [minDays, setMinDays] = useState(3);
  const [ranks, setRanks] = useState(10);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chainId = st?.config.chainId ?? 46630;

  async function compute() {
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        kind,
        ...(kind === "weekly" && weekStart ? { weekStart } : {}),
        ...(kind === "season" ? { from, to } : {}),
        rules: { budgetBps: Math.round(budgetPct * 100), capUsdCents: Math.round(capUsd * 100), minActiveDays: minDays, paidRanks: ranks },
      };
      setDraft(await adminFetch<Draft>("/api/admin/pool", { body }));
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function postServer() {
    if (!draft?.draftId) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminFetch(`/api/admin/pool/${draft.draftId}`, { body: { action: "post_server" } });
      setMsg(`Epoch ${draft.epochId} posted ✓`);
      setDraft(null);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function postWallet() {
    if (!draft?.calldata || !draft.draftId || !w.provider || !w.address || !st?.config.pool) return;
    setBusy(true);
    setMsg(null);
    try {
      await ensureChain(w.provider, chainId);
      const { wallet, pub } = clients(w.provider, chainId, w.address);
      const c = draft.calldata;
      const hash = await wallet.writeContract({ address: st.config.pool, abi: prizePoolAbi, functionName: "postEpoch", args: [BigInt(c.epochId), c.root, BigInt(c.total), c.leafCount, c.uri], account: w.address, chain: wallet.chain });
      await pub.waitForTransactionReceipt({ hash });
      await adminFetch(`/api/admin/pool/${draft.draftId}`, { body: { action: "record_wallet", txHash: hash } });
      setMsg(`Epoch ${draft.epochId} posted from your wallet ✓`);
      setDraft(null);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error && e.message && !("code" in e) ? e.message : walletErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" data-testid="admin-pool">
      <p className="text-sm">
        Contracts, deploy and owner actions: <Link href="/admin/chain" className="underline">/admin/chain</Link>. Manual payouts stay available as a fallback in the Payouts tab.
        {!st?.config.enabled && <strong> WEB3_ENABLED is off: this tab works against the mock chain.</strong>}
      </p>

      <section className="surface grid gap-3 p-3">
        <h3 className="t-h2">Compute the next epoch</h3>
        <div className="flex flex-wrap gap-3 text-sm">
          <label>
            Kind{" "}
            <select className="field min-h-11" value={kind} onChange={(e) => setKind(e.target.value as "weekly" | "season")}>
              <option value="weekly">Weekly (by rank)</option>
              <option value="season">Season-end bonus</option>
            </select>
          </label>
          {kind === "weekly" ? (
            <label>
              Week (Monday, default: last completed){" "}
              <input type="date" className="field min-h-11" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </label>
          ) : (
            <>
              <label>
                From <input type="date" className="field min-h-11" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                To (exclusive) <input type="date" className="field min-h-11" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label>
            Budget % of free pool <input type="number" className="field min-h-11 w-20" min={1} max={100} value={budgetPct} onChange={(e) => setBudgetPct(Number(e.target.value))} />
          </label>
          <label>
            Cap per player ($) <input type="number" className="field min-h-11 w-20" min={1} value={capUsd} onChange={(e) => setCapUsd(Number(e.target.value))} />
          </label>
          <label>
            Min active days <input type="number" className="field min-h-11 w-20" min={0} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} />
          </label>
          <label>
            Paid ranks <input type="number" className="field min-h-11 w-20" min={1} max={200} value={ranks} onChange={(e) => setRanks(Number(e.target.value))} />
          </label>
        </div>
        <button type="button" className="btn btn-brass w-fit" onClick={compute} disabled={busy} data-testid="pool-compute">
          {busy ? "Working…" : "Compute draft"}
        </button>
      </section>

      {draft && (
        <section className="surface grid gap-2 p-3" data-testid="pool-draft">
          <h3 className="t-h2">Draft: epoch #{draft.epochId}</h3>
          <p className="text-sm">
            Period {draft.period.from.slice(0, 10)} → {draft.period.to.slice(0, 10)} · ETH ${draft.ethUsd.toFixed(2)} ({draft.priceSources.map((s) => `${s.source} ${s.usd ?? "–"}`).join(", ")}) ·
            budget {formatEth(draft.budgetWei)} ({usd(draft.budgetUsdCents)}) of free {formatEth(draft.availableWei)} · total {formatEth(draft.totalWei)}
          </p>
          {draft.allocations.length === 0 ? (
            <p className="text-cream-dim">Nobody is eligible (or the budget is too small). Nothing to post.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="label text-left">
                  <th>#</th>
                  <th>Stable</th>
                  <th>Wallet</th>
                  <th className="text-right">Pts</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">USD</th>
                  <th className="text-right">ETH</th>
                </tr>
              </thead>
              <tbody>
                {draft.allocations.map((a) => (
                  <tr key={a.wallet} className="border-t-2 border-line">
                    <td>{a.rank}</td>
                    <td>{a.stableName}</td>
                    <td className="font-mono">{shortAddress(a.wallet)}</td>
                    <td className="text-right">{a.score}</td>
                    <td className="text-right">{a.activeDays}</td>
                    <td className="text-right">{usd(a.usdCents)}</td>
                    <td className="text-right">{formatEth(a.amountWei, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary className="cursor-pointer text-sm">All scores and why players are not eligible ({draft.scores.length})</summary>
            <ul className="grid gap-1 pt-2 text-xs">
              {draft.scores.map((s, i) => (
                <li key={i}>
                  {s.stableName ?? "?"} · {s.score} pts · {s.activeDays} days · {s.eligible ? "eligible" : s.reason}
                  {s.flagged ? " · FLAGGED" : ""}
                </li>
              ))}
            </ul>
          </details>
          {draft.calldata && (
            <div className="flex flex-wrap items-center gap-2">
              {draft.canServerPost && (
                <button type="button" className="btn btn-brass" onClick={postServer} disabled={busy} data-testid="pool-post-server">
                  Post with the server key
                </button>
              )}
              {w.address ? (
                <button type="button" className="btn" onClick={postWallet} disabled={busy} data-testid="pool-post-wallet">
                  Post from my wallet
                </button>
              ) : (
                <WalletPicker label="Connect owner wallet to post" />
              )}
              <span className="caption">Root {draft.calldata.root.slice(0, 18)}… · {draft.calldata.leafCount} players</span>
            </div>
          )}
        </section>
      )}

      {msg && <p className="surface p-3 font-bold">{msg}</p>}

      <section className="surface grid gap-2 p-3">
        <h3 className="t-h2">History</h3>
        {!hist?.epochs.length ? (
          <p className="text-cream-dim">No epochs yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm" data-testid="pool-history-admin">
            {hist.epochs.map((e) => (
              <li key={e.id}>
                #{e.epochId} · {e.kind} · {e.status} · {e.weekStart} · {e.leafCount} players · {formatEth(e.totalWei)} at ${(e.ethUsdMicros / 1e6).toFixed(2)} · {when(e.postedAtMs ?? e.createdAtMs)}
                {e.txHash && txUrl(chainId, e.txHash) && (
                  <>
                    {" "}
                    ·{" "}
                    <a className="underline" href={txUrl(chainId, e.txHash)!} target="_blank" rel="noreferrer">
                      tx
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="caption">To revoke a cheating/inactive player&apos;s unclaimed share or cancel a wrong epoch, use PrizePool.revoke / cancelEpoch from the owner wallet (funds only ever return to the pool).</p>
      </section>
    </div>
  );
}
