"use client";

import { WalletLink, useWalletStatus } from "@/components/chain/WalletLink";
import Link from "next/link";
import { useState } from "react";
import { PlayerGate } from "../PlayerGate";
import { Skeleton, useEcoView } from "../economy/kit";
import { ErrorNote } from "../ui/ErrorNote";
import { SectionHeader } from "../ui/SectionHeader";
import { HowItWorks, PageHeader } from "../ui/Page";
import { FeedbackButton } from "./FeedbackButton";

interface BetaView {
  playtest: boolean;
  tester: { joinedAtMs: number; walletAddress: string | null } | null;
  progress?: { daysPlayed: number; acceptedBugs: number; feedbackSent: number };
  rules: { key: string; label: string; amountUsdCents: number; config: unknown }[];
  rewards?: { id: string; ruleKey: string; period: string; amountUsdCents: number; status: "pending" | "approved" | "paid"; txHash: string | null; notes: string | null; createdAtMs: number }[];
  explorer: string;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const STATUS: Record<string, string> = { pending: "Pending review", approved: "Approved · payout soon", paid: "Paid" };

/** /beta: what testers can earn (rules), their progress, their payouts and their wallet. */
export function BetaScreen() {
  return <PlayerGate>{() => <Beta />}</PlayerGate>;
}

function Beta() {
  const { data, setData, error, reload } = useEcoView<BetaView>("/api/beta");
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const v = data;
  return (
    <div className="grid gap-6">
      <PageHeader scene="grandstand" back={{ href: "/me", label: "Profile" }} eyebrow="Closed playtest" title="Your beta" meta="Thank you for testing Post Time. Your notes shape the game." />
      <FeedbackButton variant="fab" />
      <HowItWorks label="About tester rewards">
        <p>Testers get an exclusive item later, and some rewards during the beta. Stable Credits stay in the game: they are never converted to money.</p>
      </HowItWorks>

      {!v.tester ? (
        <section className="surface t-meta p-4" data-testid="beta-not-tester">
          This page is for invited playtesters. {v.playtest ? "Your stable wasn't founded with an invite code." : "The closed playtest isn't running on this server."}
        </section>
      ) : (
        <>
          <section aria-labelledby="prog-h">
            <SectionHeader id="prog-h" title="Your beta so far" />
            <ul className="grid grid-cols-3 gap-2" data-testid="beta-progress">
              <Stat label="Days played" value={v.progress?.daysPlayed ?? 0} />
              <Stat label="Feedback sent" value={v.progress?.feedbackSent ?? 0} />
              <Stat label="Bugs accepted" value={v.progress?.acceptedBugs ?? 0} />
            </ul>
            <p className="caption mt-2">Tester since {new Date(v.tester.joinedAtMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. Your tester record and exclusive item survive the end-of-beta reset.</p>
          </section>

          <Wallet address={v.tester.walletAddress} onSaved={(walletAddress) => setData({ ...v, tester: { ...v.tester!, walletAddress } })} />
        </>
      )}

      <section aria-labelledby="pool-h" className="surface grid gap-2 p-4">
        <h2 id="pool-h" className="t-h2">
          Weekly Prize Pool
        </h2>
        <p className="text-cream-dim">The weekly prizes come from the on-chain Prize Pool on Robinhood Chain: its rules, the current pool and payouts are public.</p>
        <Link href="/pool" prefetch={false} className="btn w-fit" data-testid="beta-pool-link">
          See the Prize Pool
        </Link>
      </section>

      {v.tester && v.rules.length > 0 && (
        <section aria-labelledby="rules-h">
          <SectionHeader id="rules-h" title="Tester bonuses" />
          <ul className="surface rows" data-testid="beta-rules">
            {v.rules.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-bold">{r.label}</span>
                <span className="num text-cream">{usd(r.amountUsdCents)}</span>
              </li>
            ))}
          </ul>
          <p className="caption mt-2">Reviewed by the team and paid by hand in USDG to your wallet on Robinhood Chain. Amounts can change during the beta.</p>
        </section>
      )}

      {v.tester && (
        <section aria-labelledby="earned-h">
          <SectionHeader id="earned-h" title="Your payouts" />
          {!v.rewards?.length ? (
            <p className="surface p-3 text-cream-dim" data-testid="beta-no-rewards">
              Nothing yet. Accepted bug reports and other tester bonuses show up here.
            </p>
          ) : (
            <ul className="surface rows" data-testid="beta-rewards">
              {v.rewards.map((r) => (
                <li key={r.id} className="grid gap-1 px-3 py-2" data-testid="beta-reward" data-status={r.status}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold">{v.rules.find((x) => x.key === r.ruleKey)?.label ?? r.ruleKey}</span>
                    <span className="num text-cream">{usd(r.amountUsdCents)}</span>
                  </div>
                  <p className="t-meta">
                    {STATUS[r.status] ?? r.status}
                    {r.txHash && (
                      <>
                        {" · "}
                        <a href={`${v.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-4 hover:text-cream">
                          transaction {r.txHash.slice(0, 10)}…
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="surface p-3 text-center">
      <p className="score text-[2rem] leading-none text-cream">{value}</p>
      <p className="mt-1 text-xs font-bold text-cream-dim">{label}</p>
    </li>
  );
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function Wallet({ address, onSaved }: { address: string | null; onSaved: (a: string | null) => void }) {
  const [value, setValue] = useState(address ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const trimmed = value.trim();
  const valid = trimmed === "" || ADDRESS_RE.test(trimmed);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/beta/wallet", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: trimmed || null }) });
      const data = (await res.json().catch(() => ({}))) as { walletAddress?: string | null; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Couldn't save.");
      onSaved(data.walletAddress ?? null);
      setMsg({ ok: true, text: data.walletAddress ? "Saved." : "Removed." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Beta money: the wallet is proven with a free signature (SIWE) and stored on the same tester
  // record; only a verified wallet buys packs, receives Prize Pool payouts and commissions.
  const { status } = useWalletStatus();
  if (status?.address) {
    return (
      <section aria-labelledby="wallet-h" className="surface grid gap-2 p-4">
        <h2 id="wallet-h" className="t-h2">
          Your wallet
        </h2>
        <WalletLink />
      </section>
    );
  }
  return (
    <section aria-labelledby="wallet-h" className="surface grid gap-2 p-4">
      <h2 id="wallet-h" className="t-h2">
        Your wallet
      </h2>
      <WalletLink />
      <p className="caption mt-2">
        No browser wallet? You can paste an address for your tester item only. An unverified address can&rsquo;t buy packs or receive Prize Pool payouts or commissions.
      </p>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          className="field min-h-11 min-w-0 flex-1 basis-64 font-mono text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Wallet address"
          aria-invalid={!valid || undefined}
          data-testid="wallet-input"
        />
        <button type="submit" className="btn" disabled={!valid || busy || trimmed === (address ?? "")} data-testid="wallet-save">
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      {!valid && <p className="text-sm font-bold text-negative">That doesn&rsquo;t look like an EVM address.</p>}
      {msg && (
        <p role="status" className={`text-sm font-bold ${msg.ok ? "text-positive" : "text-negative"}`} data-testid="wallet-msg">
          {msg.text}
        </p>
      )}
    </section>
  );
}
