"use client";
/**
 * The Prize Pool (closed beta): a share of every Premium Pack sale, held by a contract on
 * Robinhood Chain and paid out weekly by skill (per-run placings + Daily Cup) to active
 * players. Players claim their own vested ETH from their wallet. USD figures are live
 * conversions (always "≈"), refreshed every minute.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { prizePoolAbi } from "@/lib/chain/contracts.generated";
import { addressUrl, txUrl } from "@/lib/chain/chains";
import { approxUsd, formatEth, formatUsdCents } from "@/lib/chain/format";
import { usePlayerState } from "@/lib/player";
import { clients, ensureChain, walletErrorText } from "@/lib/chain/wallet";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { WalletLink } from "./WalletLink";
import { PageHeader } from "@/components/ui/Page";
import { WalletPicker } from "./WalletPicker";
import { useWallet } from "./useWallet";

interface Standing {
  rank: number | null;
  stableName: string | null;
  score: number;
  racePoints: number;
  cupPoints: number;
  activeDays: number;
  eligible: boolean;
  reason: string | null;
  projectedUsdCents: number;
  me: boolean;
}
interface PoolView {
  enabled: boolean;
  mock: boolean;
  chainId: number;
  pool: Address;
  poolBps: number;
  balanceWei: string;
  availableWei: string;
  outstandingWei: string;
  ethUsdMicros: number | null;
  week: { weekStart: string; endsAtMs: number };
  budgetWei: string;
  rules: { budgetBps: number; capUsdCents: number; minActiveDays: number; paidRanks: number; vestDays: number; claimWindowDays: number; excludePremiumHorses: boolean; maxClaimPerEpochWei: string };
  standings: Standing[];
  me: Standing | null;
  history: { epochId: number; kind: string; weekStart: string; totalWei: string; leafCount: number; ethUsdMicros: number; postedAtMs: number | null; txHash: string | null }[];
}
interface Allocation {
  epochId: number;
  weekStart: string;
  rank: number;
  usdCents: number;
  amountWei: string;
  vestStart: string;
  vestEnd: string;
  proof: Hex[];
  claimedWei: string;
  vestedWei: string;
  claimableWei: string;
  claimDeadlineMs: number | null;
  closed: boolean;
  revoked: boolean;
}
interface Mine {
  wallet: string | null;
  pool?: Address;
  chainId?: number;
  allocations: Allocation[];
}

export function PoolScreen() {
  const [v, setV] = useState<PoolView | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const signedIn = usePlayerState() != null;
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/pool", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
      setV(d);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
    if (!signedIn) {
      setMine(null); // no stable: /api/pool/proof would just 401
      return;
    }
    const m = await fetch("/api/pool/proof", { cache: "no-store" });
    if (m.ok) setMine(await m.json());
  }, [signedIn]);
  useEffect(() => {
    void load();
    if (!signedIn) return; // visitors see the public pool once; nothing here is theirs to claim
    const t = setInterval(load, 60_000); // live balance and ≈USD every minute
    return () => clearInterval(t);
  }, [load, signedIn]);

  if (err && !v) return <p className="surface p-3 text-negative">{err}</p>;
  if (!v) return <p className="surface p-3 caption" aria-busy>Loading the Prize Pool…</p>;
  const px = v.ethUsdMicros;

  return (
    <div className="grid gap-5" data-testid="pool">
      <PageHeader back={{ href: "/me", label: "Profile" }} eyebrow="Closed beta" title="Prize Pool" />
      <header className="grid gap-1">
        <p className="t-meta">
          A weekly budget from the Club plus {v.poolBps / 100}% of every Premium Pack sale goes into a contract on Robinhood Chain. Each week it pays the best active players by skill. Nobody can withdraw it, not even us:
          ETH leaves only when a player claims their share.
        </p>
        {!v.enabled && <p className="surface-2 p-2 text-sm font-bold">Closed beta: the pool opens when ETH checkout is switched on.</p>}
      </header>

      <section className="frame-hero grid gap-2 p-4" aria-labelledby="bal-h">
        <h2 id="bal-h" className="label">
          In the pool
        </h2>
        <p>
          <span className="score text-[2.5rem] leading-none" data-testid="pool-balance">
            {formatEth(v.balanceWei, 5)}
          </span>{" "}
          <span className="text-cream-dim">{approxUsd(v.balanceWei, px)}</span>
        </p>
        <p className="text-sm text-cream-dim">
          Promised to players (vesting): {formatEth(v.outstandingWei, 5)} · free: {formatEth(v.availableWei, 5)} · this week&apos;s budget up to {formatEth(v.budgetWei, 5)}{" "}
          {approxUsd(v.budgetWei, px)}
        </p>
        {!v.mock && addressUrl(v.chainId, v.pool) && (
          <a href={addressUrl(v.chainId, v.pool)!} target="_blank" rel="noreferrer" className="caption underline">
            Contract on the explorer
          </a>
        )}
      </section>

      <MyClaims mine={mine} px={px} onClaimed={load} />

      <section aria-labelledby="week-h">
        <SectionHeader id="week-h" title={`This week (from ${v.week.weekStart})`} />
        {v.me && (
          <p className="surface mb-2 p-3 text-sm" data-testid="pool-me">
            You: {v.me.score} pts · active {v.me.activeDays}/{v.rules.minActiveDays} days ·{" "}
            {v.me.eligible ? `rank ${v.me.rank}, projected ≈ ${formatUsdCents(v.me.projectedUsdCents)}` : `not eligible yet (${v.me.reason})`}
          </p>
        )}
        {v.standings.length === 0 ? (
          <p className="surface p-3 text-cream-dim">No points yet this week. Race in Live races and the Daily Cup.</p>
        ) : (
          <table className="surface w-full text-sm" data-testid="pool-standings">
            <thead>
              <tr className="label text-left">
                <th className="p-2">#</th>
                <th className="p-2">Stable</th>
                <th className="p-2 text-right">Points</th>
                <th className="p-2 text-right">Days</th>
                <th className="p-2 text-right">Projected</th>
              </tr>
            </thead>
            <tbody>
              {v.standings.slice(0, 25).map((s, i) => (
                <tr key={i} className={`border-t-2 border-line ${s.me ? "text-cream font-bold" : ""}`}>
                  <td className="p-2 num">{s.rank ?? "–"}</td>
                  <td className="p-2">
                    {s.stableName ?? "Stable"}
                    {!s.eligible && <span className="caption block">{s.reason}</span>}
                  </td>
                  <td className="p-2 text-right num">{s.score}</td>
                  <td className="p-2 text-right num">{s.activeDays}</td>
                  <td className="p-2 text-right num">{s.projectedUsdCents ? `≈ ${formatUsdCents(s.projectedUsdCents)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="caption mt-1">Projections use the current pool and price; the final split is computed when the week closes.</p>
      </section>

      <section className="surface grid gap-2 p-3" aria-labelledby="rules-h" data-testid="pool-rules">
        <h2 id="rules-h" className="t-h2">
          Rules
        </h2>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          <li>Your score is how well you place per Live race (full weight from 8 runs) plus your best three Daily Cup days. Playing more doesn&apos;t score more by itself. The top {v.rules.paidRanks} eligible players share the week&apos;s budget (rank 1 the most).</li>
          <li>Each week uses at most {v.rules.budgetBps / 100}% of the pool&apos;s free balance; the rest rolls over. The contract itself refuses to promise more than it holds.</li>
          <li>Cap: {formatUsdCents(v.rules.capUsdCents)} per person per week (converted to ETH when the week is posted; the price used is shown in the history).</li>
          <li>Be active: at least {v.rules.minActiveDays} days played that week, and a verified wallet (one per stable; linked accounts are reviewed and excluded).</li>
          <li>
            Payouts vest over {v.rules.vestDays} days: claim any time, as often as you like. Unclaimed ETH returns to the pool after {v.rules.claimWindowDays} days.
          </li>
          <li>Season-end bonus: a share for players who stayed active through the season.</li>
          {v.rules.excludePremiumHorses && <li>Horses from paid Premium Packs don&apos;t score for the pool: paying never buys better odds at real money.</li>}
          <li>Stable Credits never convert to ETH. You never need to buy anything to win.</li>
        </ul>
      </section>

      {v.history.length > 0 && (
        <section aria-labelledby="hist-h">
          <SectionHeader id="hist-h" title="Past weeks" />
          <ul className="surface rows !p-0" data-testid="pool-history">
            {v.history.map((e) => (
              <li key={e.epochId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>
                  #{e.epochId} · {e.kind === "season" ? "Season bonus" : `week of ${e.weekStart}`} · {e.leafCount} players
                </span>
                <span className="num">
                  {formatEth(e.totalWei, 5)} <span className="caption">at ${(e.ethUsdMicros / 1e6).toFixed(2)}/ETH</span>
                </span>
                {e.txHash && txUrl(v.chainId, e.txHash) && (
                  <a className="underline" href={txUrl(v.chainId, e.txHash)!} target="_blank" rel="noreferrer">
                    tx
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="caption">
        <Link href="/invite" className="underline">
          Invite friends
        </Link>{" "}
        · <Link href="/packs" className="underline">Packs</Link>
      </p>
    </div>
  );
}

function MyClaims({ mine, px, onClaimed }: { mine: Mine | null; px: number | null; onClaimed: () => void }) {
  const w = useWallet();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!mine) return null;
  if (!mine.wallet) {
    return (
      <section className="surface grid gap-2 p-3" aria-label="Your wallet">
        <h2 className="t-h2">Your payouts</h2>
        <WalletLink />
      </section>
    );
  }
  async function claim(a: Allocation) {
    if (!w.provider || !w.address || !mine?.pool || !mine.chainId) return;
    setBusy(a.epochId);
    setMsg(null);
    try {
      await ensureChain(w.provider, mine.chainId);
      const { wallet, pub } = clients(w.provider, mine.chainId, w.address);
      const hash = await wallet.writeContract({
        address: mine.pool,
        abi: prizePoolAbi,
        functionName: "claim",
        args: [BigInt(a.epochId), BigInt(a.amountWei), BigInt(a.vestStart), BigInt(a.vestEnd), a.proof],
        account: w.address,
        chain: wallet.chain,
      });
      await pub.waitForTransactionReceipt({ hash });
      setMsg("Claimed ✓");
      void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{ name: "pool_claim", route: "/pool" }] }) }).catch(() => null);
      onClaimed();
    } catch (e) {
      setMsg(walletErrorText(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="surface grid gap-2 p-3" aria-labelledby="mine-h" data-testid="pool-mine">
      <h2 id="mine-h" className="t-h2">
        Your payouts
      </h2>
      {mine.allocations.length === 0 ? (
        <p className="text-sm text-cream-dim">No payouts yet. Finish a week in the top ranks while active to earn a share.</p>
      ) : (
        <ul className="rows">
          {mine.allocations.map((a) => (
            <li key={a.epochId} className="grid gap-1 py-2 text-sm">
              <span className="font-bold text-cream">
                Week of {a.weekStart} · rank {a.rank} · {formatEth(a.amountWei, 6)} {approxUsd(a.amountWei, px)}
              </span>
              <span className="caption">
                Vested {formatEth(a.vestedWei, 6)} · claimed {formatEth(a.claimedWei, 6)} · vesting ends {new Date(Number(a.vestEnd) * 1000).toLocaleDateString("en-GB")}
                {a.claimDeadlineMs ? ` · claim by ${new Date(a.claimDeadlineMs).toLocaleDateString("en-GB")}` : ""}
                {a.revoked ? " · revoked (review)" : ""}
              </span>
              {BigInt(a.claimableWei) > 0n &&
                (w.address ? (
                  <button type="button" className="btn btn-brass w-fit" onClick={() => claim(a)} disabled={busy !== null} data-testid={`claim-${a.epochId}`}>
                    {busy === a.epochId ? "Confirm in your wallet…" : `Claim ${formatEth(a.claimableWei, 6)}`}
                  </button>
                ) : (
                  <WalletPicker label="Connect wallet to claim" />
                ))}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-sm font-bold">{msg}</p>}
      <p className="caption">Claiming is a transaction from your wallet (a tiny ETH gas fee on Robinhood Chain).</p>
    </section>
  );
}
