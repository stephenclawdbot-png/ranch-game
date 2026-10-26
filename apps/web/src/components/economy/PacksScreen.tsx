"use client";
/**
 * Packs (game-design §8, §4b): foals with published odds and pity, sealed before you open
 * them. Paddock Pack for credits (3 a week) plus a free one every 3rd play day; the Premium
 * Pack is a demo here (no payments). The seasonal foal crop is public.
 */
import Link from "next/link";
import { useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { ActionBar } from "@/components/ui/ActionBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { formatCredits, shortHash } from "@/lib/format";
import type { PackOffer, PacksView, PullResultView } from "@/lib/economyTypes";
import { api } from "@/lib/player";
import { FoalReveal } from "./FoalReveal";
import { PremiumCheckout } from "@/components/chain/PremiumCheckout";
import { Credits, RARITY_COLOR, RARITY_LABEL, RarityBadge, Skeleton, newKey, refreshPurse, useEcoView } from "./kit";

export function PacksScreen() {
  const { data, setData, error, reload } = useEcoView<PacksView>("/api/packs");
  const [busy, setBusy] = useState<string | null>(null);
  const [pullError, setPullError] = useState<unknown>(null);
  const [result, setResult] = useState<PullResultView | null>(null);
  // One key per intended pull: a retry after a network error reuses it (no double charge).
  const [keys, setKeys] = useState<Record<string, string>>({});

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const v = data;

  async function open(packType: "paddock" | "premium", free: boolean) {
    const slot = `${packType}:${free}`;
    const key = keys[slot] ?? newKey();
    setKeys((k) => ({ ...k, [slot]: key }));
    setBusy(slot);
    setPullError(null);
    try {
      const r = await api<{ result: PullResultView; view: PacksView }>("/api/packs/pull", { body: { packType, free, key } });
      setData(r.view);
      setResult(r.result);
      setKeys((k) => ({ ...k, [slot]: newKey() }));
      refreshPurse();
    } catch (e) {
      setPullError(e);
    } finally {
      setBusy(null);
    }
  }

  const freeReady = v.paddock.freeAvailable > 0;
  const freeBlocked = v.stalls.free <= 0 ? "No free stall" : v.crop.remaining <= 0 ? "Crop sold out" : null;

  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h1 className="t-display-l">Packs</h1>
        <p className="t-meta">
          Each pack is a foal: it needs 19 care days in the nursery before it can race, and no stat can exceed the season ceiling ({v.ceiling}). Odds and pity are published; every pull is
          sealed before you open it.
        </p>
      </header>

      <CropMeter v={v} />

      {/* Free pack progress. */}
      <section className={freeReady ? "frame-hero grid gap-3 p-4" : "surface grid gap-2 p-3"} aria-labelledby="free-h" data-testid="free-pack">
        <h2 id="free-h" className="t-display-m">
          {freeReady ? "Free Paddock Pack ready" : "Free Paddock Pack"}
        </h2>
        <p className="text-cream-dim">
          One free Paddock Pack every {v.freeEvery}rd day you play (the days don't need to be in a row; missing a day never costs you anything). Free-pack foals are Club-bred: they stay
          with your stable and can't be sold.
        </p>
        <PlayDays playDays={v.playDays} every={v.freeEvery} next={v.nextFreeAtPlayDay} />
        {freeReady && (
          <ActionBar>
            <button type="button" className="btn btn-brass btn-lg" onClick={() => open("paddock", true)} disabled={busy !== null || !!freeBlocked} data-testid="open-free">
              {busy === "paddock:true" ? "Opening…" : freeBlocked ?? `Open free pack${v.paddock.freeAvailable > 1 ? ` (${v.paddock.freeAvailable})` : ""}`}
            </button>
          </ActionBar>
        )}
      </section>

      {pullError ? <ErrorNote error={pullError} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PackCard o={v.paddock} busy={busy} primary={!freeReady} onOpen={() => open("paddock", false)} />
        <div className="grid content-start gap-3">
          <PackCard o={v.premium} busy={busy} primary={false} onOpen={() => open("premium", false)} />
          {/* Closed beta: buy with ETH on Robinhood Chain (renders nothing unless WEB3_ENABLED). */}
          <PremiumCheckout
            weeklyLeft={v.premium.weeklyLimit - v.premium.paidThisWeek}
            stallsFree={v.stalls.free}
            onFulfilled={() => {
              reload();
              refreshPurse();
            }}
          />
        </div>
      </div>

      <section aria-labelledby="pulls-h">
        <SectionHeader id="pulls-h" title="Your pulls" />
        {v.pulls.length === 0 ? (
          <p className="surface p-3 text-cream-dim">Your pulls and their proofs will appear here.</p>
        ) : (
          <ul className="surface rows !p-0" data-testid="pull-history">
            {v.pulls.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <RarityBadge rarity={p.rarity} />
                <span className="min-w-0 flex-1">
                  {p.horseId ? (
                    <Link href={`/horse/${p.horseId}`} className="t-title hover:underline">
                      {p.horseName ?? "Foal"}
                    </Link>
                  ) : (
                    <span className="t-title">{p.horseName ?? "Foal"}</span>
                  )}
                  <span className="t-meta block">
                    {p.packType === "premium" ? "Premium" : "Paddock"} #{p.pullIndex} · {p.free ? "free" : `${formatCredits(p.price)} credits`}
                    {p.pityApplied ? ` · pity (${p.pityApplied === "epic" ? "Epic" : p.packType === "paddock" ? "Uncommon" : "Rare"} guarantee)` : ""} ·{" "}
                    {new Date(p.createdAtMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </span>
                <Link href={`/packs/pulls/${p.id}`} className="btn btn-sm" data-testid="verify-link">
                  ✓ Verify
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="caption">
        Stable Credits are never cashed out, and packs never contain credits. Paid Premium Packs (later) will be capped at 10 a week and unavailable where paid loot boxes are restricted.
      </p>

      {result && result.foal && (
        <FoalReveal
          foal={result.foal}
          rarity={result.pull.rarity}
          eyebrow={`${result.pull.packType === "premium" ? "Premium" : "Paddock"} Pack #${result.pull.pullIndex}`}
          note={
            <p className="caption">
              Seal {shortHash(result.pull.seedCommitment, 8)} · revealed seed {shortHash(result.seedReveal, 8)}
              {result.pull.pityApplied ? " · pity guarantee applied" : ""}
            </p>
          }
          onClose={() => setResult(null)}
        >
          <Link href="/nursery" className="btn btn-brass btn-block" data-testid="reveal-nursery">
            See the foal in the nursery
          </Link>
          <Link href={`/packs/pulls/${result.pull.id}`} className="btn btn-block" data-testid="reveal-verify">
            ✓ Verify this pull
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => setResult(null)} data-testid="reveal-close">
            Back to packs
          </button>
        </FoalReveal>
      )}
    </div>
  );
}

function CropMeter({ v }: { v: PacksView }) {
  const share = v.crop.cap ? v.crop.produced / v.crop.cap : 0;
  return (
    <section className="surface grid gap-1 p-3" aria-labelledby="crop-h" data-testid="crop">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="crop-h" className="label">
          Season {v.crop.season} foal crop
        </h2>
        <span className="text-sm text-cream-dim">
          <span className="num text-cream" data-testid="crop-remaining">
            {formatCredits(v.crop.remaining)}
          </span>{" "}
          of {formatCredits(v.crop.cap)} pack foals left this season
        </span>
      </div>
      <span className="block h-3 bg-[#050b08] p-[2px]" role="meter" aria-valuemin={0} aria-valuemax={v.crop.cap} aria-valuenow={v.crop.produced} aria-label="Foal crop used">
        <span className="block h-full bg-cream-dim" style={{ width: `${Math.max(share > 0 ? 1 : 0, share * 100)}%` }} />
      </span>
      <p className="caption">One crop for every stable in the game: it keeps the horse population healthy. A new crop opens each season.</p>
    </section>
  );
}

function PlayDays({ playDays, every, next }: { playDays: number; every: number; next: number }) {
  const into = playDays % every;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ol className="flex gap-1" aria-label={`Play day ${playDays}. Next free pack on play day ${next}.`}>
        {Array.from({ length: every }, (_, i) => {
          const lit = i < (into === 0 && playDays > 0 ? every : into);
          return <li key={i} className="h-5 w-8" style={{ background: lit ? "#d9a441" : "#173025", boxShadow: "0 0 0 2px #050b08" }} aria-hidden />;
        })}
      </ol>
      <span className="text-sm text-cream-dim">
        Play day <span className="num text-cream">{playDays}</span> · next free pack on play day <span className="num text-cream">{next}</span>
      </span>
    </div>
  );
}

function PackCard({ o, busy, primary, onOpen }: { o: PackOffer; busy: string | null; primary: boolean; onOpen: () => void }) {
  const slot = `${o.type}:false`;
  const button = (
    <button
      type="button"
      className={`btn ${primary && o.enabled ? "btn-brass btn-lg" : ""} ${o.demo ? "btn-block" : ""}`}
      onClick={onOpen}
      disabled={!o.enabled || busy !== null}
      data-testid={`open-${o.type}`}
    >
      {busy === slot ? "Opening…" : o.enabled ? `Open for ${formatCredits(o.price)}` : o.demo && o.disabledReason === "Coming soon" ? "Coming soon · no payments in this demo" : o.disabledReason}
    </button>
  );
  return (
    <section className="surface grid content-start gap-3 p-3" aria-labelledby={`${o.type}-h`} data-testid={`pack-${o.type}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${o.type}-h`} className="t-display-m">
          {o.name}
        </h2>
        {o.demo && o.disabledReason === "Pay with ETH below" ? (
          <span className="chip chip-cream" data-testid="premium-eth">
            ETH · closed beta
          </span>
        ) : o.demo ? (
          <span className="chip chip-cream" data-testid="premium-demo">
            Coming soon · demo
          </span>
        ) : (
          <Credits value={o.price} className="text-cream" />
        )}
      </div>
      <p className="t-meta">
        {o.demo && o.disabledReason === "Pay with ETH below"
          ? "Better odds, still under the genetic ceiling. Closed beta: bought with ETH on Robinhood Chain, below. 30% of every sale funds the Prize Pool."
          : o.demo
          ? "Better odds, still under the genetic ceiling. In Phase 1 it is a preview only: no real payments, nothing to buy."
          : "A young horse, Common or Uncommon. Bought-pack foals are yours to keep, race or sell."}
      </p>

      <table className="w-full text-sm" data-testid={`odds-${o.type}`}>
        <caption className="label mb-1 text-left">Published odds</caption>
        <tbody>
          {o.odds.map((r) => (
            <tr key={r.rarity} className="border-t-2 border-line">
              <th scope="row" className="py-1 text-left font-bold" style={{ color: RARITY_COLOR[r.rarity] }}>
                {RARITY_LABEL[r.rarity]}
              </th>
              <td className="w-1/2 py-1">
                <span className="block h-3 bg-[#050b08] p-[2px]" aria-hidden>
                  <span className="block h-full" style={{ width: `${r.bp / 100}%`, background: RARITY_COLOR[r.rarity] }} />
                </span>
              </td>
              <td className="num py-1 text-right text-cream">{(r.bp / 100).toFixed(r.bp % 100 ? 1 : 0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inset grid gap-1 p-2 text-sm" data-testid={`pity-${o.type}`}>
        <span className="label">Pity (guaranteed)</span>
        {o.pity.map((p) => (
          <p key={p.min}>
            {RARITY_LABEL[p.min]} or better within {p.within} pulls ·{" "}
            <span className="font-bold text-cream">
              {p.since} since the last · guaranteed {p.left === 1 ? "on your next pull" : `within ${p.left} pulls`}
            </span>
          </p>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="label">This week</dt>
          <dd className="num text-cream" data-testid={`weekly-${o.type}`}>
            {o.paidThisWeek}/{o.weeklyLimit}
          </dd>
        </div>
        <div>
          <dt className="label">Next pull sealed</dt>
          <dd className="font-mono text-xs text-cream-dim" title={o.nextSeedCommitment}>
            🔒 {shortHash(o.nextSeedCommitment, 10)}
          </dd>
        </div>
      </dl>
      {primary && o.enabled ? <ActionBar>{button}</ActionBar> : button}
    </section>
  );
}
