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
import { EmptyState, SceneBand } from "@/components/ui/Page";
import { HashValue } from "@/components/ui/HashValue";
import { PixelIcon } from "@/components/icons";
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
      <SceneBand scene="paddock" alt="The paddock" eyebrow="Market · foals with published odds" title="Packs" />

      {/* Free pack progress. */}
      <section className={`${freeReady ? "frame-hero" : "surface"} flex items-center gap-4 p-4`} aria-labelledby="free-h" data-testid="free-pack">
        <span className="well hidden shrink-0 sm:grid">
          <PackArt type="paddock" />
        </span>
        <div className="grid min-w-0 flex-1 gap-2">
          {freeReady && <p className="tag tag-ready w-fit">Ready</p>}
          <h2 id="free-h" className="t-hero">
            {freeReady ? "Free Paddock Pack ready" : "Free Paddock Pack"}
          </h2>
          <PlayDays playDays={v.playDays} every={v.freeEvery} next={v.nextFreeAtPlayDay} />
          <p className="caption">Every {v.freeEvery}rd day you play, in a row or not. Free-pack foals are Club-bred and stay with you.</p>
          {freeReady &&
            (freeBlocked ? (
              <p className="t-meta font-bold">{freeBlocked === "No free stall" ? "Free a stall first: your stalls are full." : "This season's foal crop is sold out."}</p>
            ) : (
              <ActionBar>
                <button type="button" className="btn btn-brass btn-lg" onClick={() => open("paddock", true)} disabled={busy !== null} data-testid="open-free">
                  {busy === "paddock:true" ? "Opening…" : `Open free pack${v.paddock.freeAvailable > 1 ? ` (${v.paddock.freeAvailable})` : ""}`}
                </button>
              </ActionBar>
            ))}
        </div>
      </section>

      {pullError ? <ErrorNote error={pullError} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PackCard o={v.paddock} busy={busy} primary={!freeReady} onOpen={() => open("paddock", false)} ceiling={v.ceiling} />
        <div className="grid content-start gap-3">
          <PackCard o={v.premium} busy={busy} primary={false} onOpen={() => open("premium", false)} ceiling={v.ceiling} />
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

      <CropMeter v={v} />

      <section aria-labelledby="pulls-h">
        <h2 id="pulls-h" className="t-h2 mb-3">
          Your pulls
        </h2>
        {v.pulls.length === 0 ? (
          <EmptyState icon="papers" title="No pulls yet" text="Every foal you open appears here with its sealed proof, so you can check the odds were honest." />
        ) : (
          <ul className="surface rows !p-0" data-testid="pull-history">
            {v.pulls.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
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
                  {p.geneticsLine && (
                    <span className="caption block" data-testid="genetics-line">
                      {p.geneticsLine}
                    </span>
                  )}
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
        Stable Credits are never cashed out, and packs never contain credits. Paid Premium Packs are capped at 10 a week and unavailable where paid loot boxes are restricted.
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
    <section className="grid gap-1.5" aria-labelledby="crop-h" data-testid="crop">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="crop-h" className="eyebrow">
          Season {v.crop.season} foal crop
        </h2>
        <span className="t-meta">
          <span className="num text-cream" data-testid="crop-remaining">
            {formatCredits(v.crop.remaining)}
          </span>{" "}
          of {formatCredits(v.crop.cap)} left
        </span>
      </div>
      <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={v.crop.cap} aria-valuenow={v.crop.produced} aria-label="Foal crop used">
        <span style={{ width: `${Math.max(share > 0 ? 1 : 0, share * 100)}%` }} />
      </span>
      <p className="caption">One crop for every stable keeps the horse population healthy. A new crop opens each season.</p>
    </section>
  );
}

/** The pack illustration (PixelLab, 128 px native) at 1x, or 2x on wide screens. */
function PackArt({ type, big = false }: { type: "paddock" | "premium"; big?: boolean }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/art/ui/pack-${type}.png`} width={128} height={128} alt="" className={`pixelated ${big ? "lg:hidden" : ""}`} draggable={false} />
      {big && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/art/ui/pack-${type}.png`} width={256} height={256} alt="" className="pixelated hidden lg:block" draggable={false} />
      )}
    </>
  );
}

function PlayDays({ playDays, every, next }: { playDays: number; every: number; next: number }) {
  const into = playDays % every;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ol className="flex gap-1" aria-label={`Play day ${playDays}. Next free pack on play day ${next}.`}>
        {Array.from({ length: every }, (_, i) => {
          const lit = i < (into === 0 && playDays > 0 ? every : into);
          return <li key={i} className={`pip ${lit ? "on" : ""}`} aria-hidden />;
        })}
      </ol>
      <span className="t-meta">
        Play day <span className="num text-cream">{playDays}</span> · next free pack on play day <span className="num text-cream">{next}</span>
      </span>
    </div>
  );
}

function PackCard({ o, busy, primary, onOpen, ceiling }: { o: PackOffer; busy: string | null; primary: boolean; onOpen: () => void; ceiling: number }) {
  const slot = `${o.type}:false`;
  const eth = o.demo && o.disabledReason === "Pay with ETH below";
  const button = o.enabled ? (
    <button type="button" className={`btn ${primary ? "btn-brass btn-lg" : ""}`} onClick={onOpen} disabled={busy !== null} data-testid={`open-${o.type}`}>
      {busy === slot ? "Opening…" : `Open for ${formatCredits(o.price)}`}
    </button>
  ) : o.demo ? (
    eth ? null : (
      <p className="t-meta font-bold" data-testid={`open-${o.type}`}>
        Coming soon: no payments in this demo.
      </p>
    )
  ) : (
    <p className="t-meta font-bold" data-testid={`open-${o.type}-blocked`}>
      {o.disabledReason}
    </p>
  );
  return (
    <section className="surface grid content-start gap-3 p-4" aria-labelledby={`${o.type}-h`} data-testid={`pack-${o.type}`}>
      <div className="flex items-start gap-4">
        <span className="well grid shrink-0 place-items-center">
          <PackArt type={o.type === "premium" ? "premium" : "paddock"} big />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 id={`${o.type}-h`} className="t-hero">
            {o.name}
          </h2>
          {eth ? (
            <span className="tag tag-locked w-fit normal-case" data-testid="premium-eth">
              ETH · closed beta
            </span>
          ) : o.demo ? (
            <span className="tag tag-locked w-fit normal-case" data-testid="premium-demo">
              Coming soon · demo
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <PixelIcon name="coin" size={32} />
              <span className="score text-[1.875rem] leading-none">{formatCredits(o.price)}</span>
            </span>
          )}
          <p className="t-meta">
            {eth
              ? "Better odds, still under the genetic ceiling. Bought with ETH on Robinhood Chain, below."
              : o.demo
                ? "Better odds, still under the genetic ceiling. A preview for now: nothing to buy."
                : "A young horse, Common or Uncommon. Yours to keep, race or sell."}
          </p>
        </div>
      </div>

      {/* Published odds and pity stay open by default (ethics: odds are never hidden). */}
      <details className="how" open>
        <summary>Odds &amp; pity</summary>
        <div className="grid gap-3 pt-1">
          <table className="w-full text-sm" data-testid={`odds-${o.type}`}>
            <caption className="label mb-1 text-left">Published odds</caption>
            <tbody>
              {o.odds.map((r) => (
                <tr key={r.rarity} className="border-t-2 border-dotted border-line">
                  <th scope="row" className="py-1.5 text-left font-bold">
                    <span className="inline-flex items-center gap-2">
                      <i className="dot" style={{ background: RARITY_COLOR[r.rarity] }} aria-hidden />
                      {RARITY_LABEL[r.rarity]}
                    </span>
                  </th>
                  <td className="w-1/2 py-1.5">
                    <span className="meter !h-3" aria-hidden>
                      <span style={{ width: `${r.bp / 100}%`, background: RARITY_COLOR[r.rarity] }} />
                    </span>
                  </td>
                  <td className="num py-1.5 text-right">{(r.bp / 100).toFixed(r.bp % 100 ? 1 : 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="surface-2 grid gap-1 p-3 text-sm" data-testid={`pity-${o.type}`}>
            <span className="label">Pity (guaranteed)</span>
            {o.pity.map((p) => (
              <p key={p.min}>
                {RARITY_LABEL[p.min]} or better within {p.within} pulls ·{" "}
                <span className="font-bold">
                  {p.since} since the last · guaranteed {p.left === 1 ? "on your next pull" : `within ${p.left} pulls`}
                </span>
              </p>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="label">This week</dt>
              <dd className="num" data-testid={`weekly-${o.type}`}>
                {o.paidThisWeek}/{o.weeklyLimit}
              </dd>
            </div>
            <div>
              <dt className="label">Next pull sealed</dt>
              <dd className="text-cream-dim">
                🔒 <HashValue value={o.nextSeedCommitment} />
              </dd>
            </div>
          </dl>
          <p className="caption">Each pack is a foal: 19 care days in the nursery before it can race, and no stat above the season ceiling ({ceiling}).</p>
        </div>
      </details>
      {button && (primary && o.enabled ? <ActionBar>{button}</ActionBar> : button)}
    </section>
  );
}
