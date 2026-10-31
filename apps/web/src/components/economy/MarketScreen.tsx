"use client";
/**
 * The market (game-design §8, §4b): credits only, no real money. Buy (atomic; needs a free
 * stall), sell (price between 70% and 3x the appraisal; seller requirements shown with what is
 * missing; bound and locked horses explained, including the 72 h resale lock), and your
 * listings (cancel any time). 5% of every sale is burned.
 */
import { useEffect, useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState, HowItWorks } from "@/components/ui/Page";
import { formatCredits } from "@/lib/format";
import type { ListingView, MarketView, SellableHorse } from "@/lib/economyTypes";
import { api } from "@/lib/player";
import { Check, Credits, HorseLine, Skeleton, refreshPurse, stageLabel, useEcoView } from "./kit";
import { SalesRing, pedigreeLine } from "./SalesRing";
import { UsdgMarket } from "./UsdgMarket";
import { useUsdg } from "@/components/chain/UsdgMode";
import { LeaseBoard } from "./LeaseBoard";

type Tab = "buy" | "sell" | "mine" | "lease" | "usdg";

function expiresIn(ms: number): string {
  const h = Math.max(0, Math.round(ms / 3_600_000));
  return h >= 48 ? `${Math.round(h / 24)} days` : h >= 1 ? `${h} h` : "under an hour";
}

function dayShort(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dayShortTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function MarketScreen() {
  const { data, setData, error, reload } = useEcoView<MarketView>("/api/market");
  const u = useUsdg();
  const [tab, setTab] = useState<Tab>("buy");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (h === "buy" || h === "sell" || h === "mine" || h === "lease" || h === "usdg") setTab(h);
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
      <SalesRing
        lot={v.listings.find((l) => !l.mine) ?? v.listings[0] ?? null}
        eyebrow={
          tab === "usdg"
            ? `${u.name} market · registered horses · ${v.stalls.used} of ${v.stalls.slots} stalls`
            : tab === "lease"
              ? `Lease · rent racers, share the prizes · ${v.stalls.used} of ${v.stalls.slots} stalls`
              : `Credits only · ${v.listings.length} ${v.listings.length === 1 ? "lot" : "lots"} · ${v.stalls.used} of ${v.stalls.slots} stalls used`
        }
        onSeeLot={(l) => {
          setTab("buy");
          requestAnimationFrame(() => document.getElementById(`lot-${l.lot}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
        }}
      />
      <HowItWorks className="-mt-2">
        <p>
          Horses change hands for Stable Credits, never real money. {v.feePermille / 10}% of every sale is burned. Horses registered for the{" "}
          <a href="#usdg" className="underline">
            {u.name} market
          </a>{" "}
          trade for {u.name} only, on their own tab.
        </p>
        <p>Buying needs a free stall. Sellers set a price between 70% and 3x the Club&rsquo;s appraisal. Club-bred horses stay with the stable that raised them; a bought horse can&rsquo;t be relisted for 72 hours.</p>
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
        <button type="button" role="tab" aria-selected={tab === "lease"} onClick={() => setTab("lease")} data-testid="tab-lease">
          Lease
        </button>
        <button type="button" role="tab" aria-selected={tab === "usdg"} onClick={() => setTab("usdg")} data-testid="tab-usdg">
          {u.name}
        </button>
      </div>
      {tab === "buy" && <Buy v={v} onView={setData} />}
      {tab === "sell" && <Sell v={v} onView={setData} onListed={() => setTab("mine")} />}
      {tab === "mine" && <Mine v={v} onView={setData} />}
      {tab === "lease" && <LeaseBoard />}
      {tab === "usdg" && <UsdgMarket />}
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
      <h2 className="t-h2">Sale catalogue</h2>
      <ul className="lots-grid">
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
    <li className="lot-card print grid gap-2 p-4" id={`lot-${l.lot}`} data-testid="listing">
      <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-line pb-2">
        <span className="lot-no">Lot {l.lot}</span>
        <span className="truncate text-xs font-bold text-cream-dim">
          Vendor · {l.club && (
            <>
              <span className="tag !h-[16px] !px-1 align-[1px] !text-[0.625rem] !leading-[16px]" data-testid="club-seller" title="A Club horse: the Club lists a few every day">
                Club
              </span>{" "}
            </>
          )}
          {l.sellerStableName}
        </span>
      </div>
      <HorseLine h={l} meta={<ListingMeta l={l} />} aside={<span className="lot-price">{formatCredits(l.price)}</span>} />
      <p className="lot-ped">{pedigreeLine(l)}</p>
      {l.geneticsLine && <p className="caption">{l.geneticsLine}</p>}
      <p className="caption">
        Appraised {formatCredits(l.appraisal)} · closes in {expiresIn(l.expiresAtMs - v.serverNowMs)}
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
          <p className="text-sm">
            The horse moves to your stable at once.{" "}
            {l.club ? "The whole price is burned: the Club keeps nothing." : <>{formatCredits(l.fee)} of the price is burned; the seller gets {formatCredits(l.sellerReceives)}.</>}
          </p>
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
          The price can be {v.floorPermille / 10}% to {v.ceilingPermille / 1000}x the appraisal (what the market can see: revealed ability, record, breedings left). Listings last up to {v.maxListingDays} days.
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
  const valid = price !== "" && Number.isInteger(n) && n >= h.floor && n <= h.ceiling;
  const tooHigh = price !== "" && Number.isInteger(n) && n > h.ceiling;
  const fee = Math.floor((n * v.feePermille) / 1000);
  const locked = h.lock !== null;
  // The resale lock is shown with its own dates (the lock reason is timezone-free on purpose).
  const lockText = h.lock === "resale_lock" && h.boughtAtMs !== null && h.resaleUntilMs !== null ? `Bought on ${dayShort(h.boughtAtMs)}: can be listed again after ${dayShortTime(h.resaleUntilMs)}` : h.lockReason;

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
            {stageLabel(h.stage)} · appraised {formatCredits(h.appraisal)} · floor {formatCredits(h.floor)} · max {formatCredits(h.ceiling)}
          </>
        }
      />
      {locked ? (
        <p className="text-sm font-bold text-cream-dim" data-testid="lock-reason">
          🔒 Not for sale: {lockText}
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
              : tooHigh
                ? `Maximum ${formatCredits(h.ceiling)} (${v.ceilingPermille / 1000}x the ${formatCredits(h.appraisal)} appraisal).`
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
