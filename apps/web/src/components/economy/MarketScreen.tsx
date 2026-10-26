"use client";
/**
 * The market (game-design §8, §4b): credits only, no real money. Buy (atomic; needs a free
 * stall), sell (price floor 70% of the appraisal; seller requirements shown with what is
 * missing; bound and locked horses explained), and your listings (cancel any time).
 * 5% of every sale is burned.
 */
import { useEffect, useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState, HowItWorks, SceneBand } from "@/components/ui/Page";
import { formatCredits } from "@/lib/format";
import type { ListingView, MarketView, SellableHorse } from "@/lib/economyTypes";
import { api } from "@/lib/player";
import { Check, Credits, HorseLine, Skeleton, refreshPurse, stageLabel, useEcoView } from "./kit";

type Tab = "buy" | "sell" | "mine";

function expiresIn(ms: number): string {
  const h = Math.max(0, Math.round(ms / 3_600_000));
  return h >= 48 ? `${Math.round(h / 24)} days` : h >= 1 ? `${h} h` : "under an hour";
}

export function MarketScreen() {
  const { data, setData, error, reload } = useEcoView<MarketView>("/api/market");
  const [tab, setTab] = useState<Tab>("buy");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (h === "buy" || h === "sell" || h === "mine") setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const v = data;
  return (
    <div className="grid gap-5">
      <SceneBand scene="paddock" alt="The sale ring paddock" eyebrow={`Credits only · ${v.stalls.used} of ${v.stalls.slots} stalls used`} title="Market" />
      <HowItWorks className="-mt-2">
        <p>Horses change hands for Stable Credits only, never real money. {v.feePermille / 10}% of every sale is burned.</p>
        <p>Buying needs a free stall. Sellers set a price of at least 70% of the Club&rsquo;s appraisal. Club-bred horses stay with the stable that raised them.</p>
      </HowItWorks>
      <div className="tabs baize-scope -mx-[var(--gutter)] !px-[var(--gutter)]" role="tablist" aria-label="Market">
        <button type="button" role="tab" aria-selected={tab === "buy"} onClick={() => setTab("buy")} data-testid="tab-buy">
          Buy ({v.listings.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === "sell"} onClick={() => setTab("sell")} data-testid="tab-sell">
          Sell
        </button>
        <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")} data-testid="tab-mine">
          Your listings ({v.mine.length})
        </button>
      </div>
      {tab === "buy" && <Buy v={v} onView={setData} />}
      {tab === "sell" && <Sell v={v} onView={setData} onListed={() => setTab("mine")} />}
      {tab === "mine" && <Mine v={v} onView={setData} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ListingMeta({ l }: { l: ListingView }) {
  return (
    <>
      {stageLabel(l.stage)} · {l.starts} starts · OR {l.rating} · {l.sellerStableName}
    </>
  );
}

function Buy({ v, onView }: { v: MarketView; onView: (v: MarketView) => void }) {
  const full = v.stalls.free <= 0;
  if (!v.listings.length)
    return (
      <EmptyState
        icon="horse-head"
        title="No horses on the market yet"
        text="Other stables' listings appear here. You can list one of yours: tradeable horses sell for credits."
        testId="market-empty"
        action={
          <a href="#sell" className="btn btn-sm">
            List one of yours
          </a>
        }
      />
    );
  return (
    <section aria-label="Horses for sale" className="grid gap-2">
      {full && (
        <p className="surface-2 p-3 text-sm font-bold text-cream" role="status">
          All {v.stalls.slots} stalls are taken: free a stall before buying.
        </p>
      )}
      <ul className="grid gap-2">
        {v.listings.map((l) => (
          <BuyRow key={l.listingId} l={l} v={v} onView={onView} />
        ))}
      </ul>
    </section>
  );
}

function BuyRow({ l, v, onView }: { l: ListingView; v: MarketView; onView: (v: MarketView) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const short = v.credits < l.price;
  const full = v.stalls.free <= 0;
  async function buyNow() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ view: MarketView }>(`/api/market/${l.listingId}/buy`);
      setDone(true);
      onView(r.view);
      refreshPurse();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="surface grid gap-2 p-4" data-testid="listing">
      <HorseLine h={l} meta={<ListingMeta l={l} />} aside={<span className="score text-[1.875rem] leading-none">{formatCredits(l.price)}</span>} />
      <p className="caption">
        Appraised {formatCredits(l.appraisal)} · listing ends in {expiresIn(l.expiresAtMs - v.serverNowMs)}
      </p>
      {done ? (
        <p className="font-bold text-positive" role="status">
          ✓ {l.horse.name} is yours.
        </p>
      ) : confirming ? (
        <div className="paper grid gap-2 p-3" role="alertdialog" aria-label="Confirm purchase">
          <p className="font-extrabold">
            Buy {l.horse.name} for {formatCredits(l.price)} credits?
          </p>
          <p className="text-sm">The horse moves to your stable at once. {formatCredits(l.fee)} of the price is burned; the seller gets {formatCredits(l.sellerReceives)}.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-brass" onClick={buyNow} disabled={busy} data-testid="buy-confirm">
              {busy ? "Buying…" : `Confirm · ${formatCredits(l.price)}`}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn w-fit" onClick={() => setConfirming(true)} disabled={short || full} data-testid="buy">
          {full ? "No free stall" : short ? "Not enough credits" : `Buy for ${formatCredits(l.price)}`}
        </button>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}

// ---------------------------------------------------------------------------

function SellerChecklist({ v }: { v: MarketView }) {
  const s = v.seller;
  const oldEnough = s.oldEnoughAtMs === null;
  return (
    <section className={`${s.ok ? "surface-2" : "surface"} grid gap-2 p-3`} aria-labelledby="seller-h" data-testid="seller-requirements" data-ok={s.ok ? "true" : "false"}>
      <h2 id="seller-h" className="t-h2">
        {s.ok ? "✓ You can sell" : "Before you can sell"}
      </h2>
      <p className="t-meta">Selling needs an established stable. It keeps the market fair and stops throwaway accounts from moving horses around.</p>
      <ul className="grid gap-1">
        <Check ok={oldEnough}>
          Account at least {s.minAccountAgeDays} days old{" "}
          {oldEnough ? "" : `(yours is ${s.accountAgeDays} ${s.accountAgeDays === 1 ? "day" : "days"}; ready ${new Date(s.oldEnoughAtMs!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`}
        </Check>
        <Check ok={s.races >= s.minRaces}>
          {s.minRaces} races run ({s.races} so far)
        </Check>
        {s.emailRequired && <Check ok={s.emailVerified}>A verified email address{s.emailVerified ? "" : " (email sign-in is coming soon)"}</Check>}
      </ul>
    </section>
  );
}

function Sell({ v, onView, onListed }: { v: MarketView; onView: (v: MarketView) => void; onListed: () => void }) {
  return (
    <div className="grid gap-4">
      <SellerChecklist v={v} />
      <section aria-labelledby="sellable-h">
        <SectionHeader id="sellable-h" title="Your horses" />
        <p className="t-meta mb-2">
          The minimum price is {v.floorPermille / 10}% of the appraisal (what the market can see: revealed ability, record, breedings left). Listings last up to {v.maxListingDays} days.
        </p>
        <ul className="grid gap-2">
          {v.horses.map((h) => (
            <SellRow key={h.id} h={h} v={v} onView={onView} onListed={onListed} />
          ))}
        </ul>
      </section>
    </div>
  );
}

const DAYS = [3, 7, 14] as const;

function SellRow({ h, v, onView, onListed }: { h: SellableHorse; v: MarketView; onView: (v: MarketView) => void; onListed: () => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(Math.max(h.floor, h.appraisal)));
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const n = Number(price);
  const valid = price !== "" && Number.isInteger(n) && n >= h.floor;
  const fee = Math.floor((n * v.feePermille) / 1000);
  const locked = h.lock !== null;

  async function list() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ view: MarketView }>("/api/market/list", { body: { horseId: h.id, price: n, days } });
      onView(r.view);
      onListed();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="surface grid gap-2 p-3" data-testid="sell-row" data-listable={!locked && v.seller.ok ? "true" : "false"}>
      <HorseLine
        h={h}
        meta={
          <>
            {stageLabel(h.stage)} · appraised {formatCredits(h.appraisal)} · floor {formatCredits(h.floor)}
          </>
        }
      />
      {locked ? (
        <p className="text-sm font-bold text-cream-dim" data-testid="lock-reason">
          🔒 Not for sale: {h.lockReason}
        </p>
      ) : !open ? (
        <button type="button" className="btn w-fit" onClick={() => setOpen(true)} disabled={!v.seller.ok} data-testid="list-open">
          {v.seller.ok ? "List for sale" : "List for sale (requirements above)"}
        </button>
      ) : (
        <div className="inset grid gap-3 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1">
              <span className="label">Price (credits)</span>
              <input className="field w-40" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} aria-describedby={`floor-${h.id}`} data-testid="list-price" />
            </label>
            <div className="grid gap-1">
              <span className="label">Listing lasts</span>
              <div className="segmented" role="group" aria-label="Listing duration">
                {DAYS.map((d) => (
                  <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d} days
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p id={`floor-${h.id}`} className={`text-sm ${valid ? "text-cream-dim" : "font-bold text-negative"}`}>
            {valid
              ? `You receive ${formatCredits(n - fee)} if it sells (${formatCredits(fee)} burned). The horse can't race or breed while listed.`
              : `Minimum ${formatCredits(h.floor)} (${v.floorPermille / 10}% of the ${formatCredits(h.appraisal)} appraisal).`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-brass" onClick={list} disabled={!valid || busy} data-testid="list-confirm">
              {busy ? "Listing…" : `List for ${valid ? formatCredits(n) : "…"}`}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}

// ---------------------------------------------------------------------------

function Mine({ v, onView }: { v: MarketView; onView: (v: MarketView) => void }) {
  if (!v.mine.length) return <EmptyState icon="papers" title="Nothing listed" text="You have no horses listed. List one from the Sell tab." />;
  return (
    <ul className="grid gap-2">
      {v.mine.map((l) => (
        <MineRow key={l.listingId} l={l} v={v} onView={onView} />
      ))}
    </ul>
  );
}

function MineRow({ l, v, onView }: { l: ListingView; v: MarketView; onView: (v: MarketView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function cancelIt() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ view: MarketView }>(`/api/market/${l.listingId}/cancel`);
      onView(r.view);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="surface grid gap-2 p-3" data-testid="my-listing">
      <HorseLine h={l} meta={<ListingMeta l={l} />} aside={<span className="score text-[1.875rem] leading-none">{formatCredits(l.price)}</span>} />
      <p className="caption">
        You receive {formatCredits(l.sellerReceives)} if it sells ({formatCredits(l.fee)} burned) · ends in {expiresIn(l.expiresAtMs - v.serverNowMs)}
      </p>
      <button type="button" className="btn w-fit" onClick={cancelIt} disabled={busy} data-testid="cancel-listing">
        {busy ? "Cancelling…" : "Cancel listing"}
      </button>
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}
