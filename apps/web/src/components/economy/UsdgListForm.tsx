"use client";
/** List a registered horse for USDG: a fixed price or an auction (reserve, 24-72 h). */
import { useState } from "react";
import { usdgFee, usdgFromDecimal } from "@thoroughbred/game-core";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { useUsdg } from "@/components/chain/UsdgMode";
import { api } from "@/lib/player";
import type { UsdgPolicyView } from "@/lib/usdgTypes";

export function UsdgListForm({ horseId, horseName, policy, onListed, onCancel }: { horseId: string; horseName: string; policy: UsdgPolicyView; onListed: () => void; onCancel?: () => void }) {
  const u = useUsdg();
  const [kind, setKind] = useState<"fixed" | "auction">("fixed");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState<number>(policy.fixedListingDays.includes(7) ? 7 : policy.fixedListingDays[0]!);
  const [hours, setHours] = useState<number>(policy.auctionHours[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const micro = usdgFromDecimal(price);
  const valid = micro !== null && micro >= policy.minPrice && micro <= policy.maxPrice;
  const fee = micro !== null ? usdgFee(micro, policy.feeBps) : 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/usdg/list", { body: { horseId, kind, price: micro, duration: kind === "fixed" ? days : hours } });
      onListed();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inset grid gap-3 p-3" data-testid="usdg-list-form">
      <div className="segmented" role="group" aria-label="Sale type">
        <button type="button" aria-pressed={kind === "fixed"} onClick={() => setKind("fixed")} data-testid="usdg-kind-fixed">
          Fixed price
        </button>
        <button type="button" aria-pressed={kind === "auction"} onClick={() => setKind("auction")} data-testid="usdg-kind-auction">
          Auction
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="label">{kind === "fixed" ? "Price" : "Reserve"} ({u.practice ? "T-USDG, test money" : "USDG = US$"})</span>
          <input className="field w-40" inputMode="decimal" placeholder={`${policy.minPrice / 1_000_000}`} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="usdg-price" />
        </label>
        <div className="grid gap-1">
          <span className="label">{kind === "fixed" ? "Listing lasts" : "Bidding lasts"}</span>
          <div className="segmented" role="group" aria-label="Duration">
            {kind === "fixed"
              ? policy.fixedListingDays.map((d) => (
                  <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d} days
                  </button>
                ))
              : policy.auctionHours.map((h) => (
                  <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}>
                    {h} h
                  </button>
                ))}
          </div>
        </div>
      </div>
      <p className={`text-sm ${valid || price === "" ? "text-cream-dim" : "font-bold text-negative"}`}>
        {price === ""
          ? `Lowest ${kind === "fixed" ? "price" : "reserve"}: ${u.dollars(policy.minPrice)}.`
          : !valid
            ? `Enter at least ${u.dollars(policy.minPrice)} (up to 6 decimals).`
            : kind === "fixed"
              ? `You receive ${u.dollars(micro! - fee)} if it sells (${u.dollars(fee)} market fee, ${policy.feeBps / 100}%), ${u.practice ? "added to your T-USDG balance" : "paid straight to your wallet"}.`
              : `Bids start at ${u.dollars(micro!)}. The winner gets ${policy.paymentWindowHours} h to pay; if they don't, the next bidder is offered ${horseName} at their own bid. You receive the price minus ${policy.feeBps / 100}%.`}{" "}
        {horseName} can&rsquo;t race or breed while listed.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-brass" onClick={() => void submit()} disabled={!valid || busy} data-testid="usdg-list-confirm">
          {busy ? "Listing…" : kind === "fixed" ? `List for ${valid ? u.dollars(micro!) : "…"}` : `Start the auction`}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}
