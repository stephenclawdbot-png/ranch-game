"use client";
/**
 * Horse page → "Register for the USDG market": the requirements checklist (each one ticked or
 * not, with what's missing), the one-off registration fee paid from the linked wallet, then list
 * the horse for a fixed price or start an auction (docs/usdg-market.md).
 */
import Link from "next/link";
import { useState } from "react";
import { TestnetNote, UsdgPay } from "@/components/chain/UsdgPay";
import { WalletLink } from "@/components/chain/WalletLink";
import { Check, useEcoView } from "@/components/economy/kit";
import { UsdgListForm } from "@/components/economy/UsdgListForm";
import { ErrorNote } from "@/components/ui/ErrorNote";
import type { UsdgOrderJson } from "@/lib/chain/usdg";
import { PracticeBalance, useUsdg } from "@/components/chain/UsdgMode";
import { api } from "@/lib/player";
import type { UsdgHorseView } from "@/lib/usdgTypes";

export function UsdgHorsePanel({ horseId }: { horseId: string }) {
  const { data, error, reload } = useEcoView<UsdgHorseView>(`/api/usdg/horses/${horseId}`);
  const u = useUsdg();
  const [terms, setTerms] = useState(false);
  const [order, setOrder] = useState<UsdgOrderJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [listing, setListing] = useState(false);
  if (error && !data) return null; // the panel is optional; the rest of the page stands
  if (!data || !data.mine) return null;
  const v = data;
  const off = v.network.mode === "off";
  const ready = v.checks.filter((c) => c.key !== "terms").every((c) => c.ok);
  const pending = order ?? v.openOrder;

  async function register() {
    setBusy(true);
    setErr(null);
    try {
      setOrder(await api<UsdgOrderJson>("/api/usdg/register", { body: { horseId, terms } }));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface grid gap-3 p-4" aria-labelledby="usdg-h" data-testid="usdg-horse-panel" data-registered={v.registered ? "true" : "false"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usdg-h" className="t-h2">
          {v.registered ? `${u.name} market` : `Register for the ${u.name} market`}
        </h2>
        <Link href="/market#usdg" className="text-sm font-bold underline">
          Sales → {u.name}
        </Link>
      </div>
      {off ? (
        <p className="t-meta">{u.t("The USDG market is coming soon: registered horses will trade for USDG, a dollar stablecoin.")}</p>
      ) : v.registered ? (
        <>
          <p className="t-meta">
            Registered on {new Date(v.registered.atMs).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. {v.name} now sells only for {u.name} (never for credits).
          </p>
          {v.listing ? (
            <p className="text-sm" data-testid="usdg-horse-listing">
              {v.listing.kind === "fixed" ? `Listed at ${u.dollars(v.listing.price)}` : `At auction: reserve ${u.dollars(v.listing.price)}, ${v.listing.bidCount} ${v.listing.bidCount === 1 ? "bid" : "bids"}${v.listing.bestBid ? `, best ${u.dollars(v.listing.bestBid)}` : ""}`}
              . Manage it on <Link href="/market#usdg" className="underline">Sales → {u.name}</Link>.
            </p>
          ) : v.listBlock ? (
            <p className="text-sm font-bold text-cream-dim">🔒 Can&rsquo;t list right now: {v.listBlock}.</p>
          ) : listing ? (
            <UsdgListForm
              horseId={horseId}
              horseName={v.name}
              policy={v.policy}
              onCancel={() => setListing(false)}
              onListed={() => {
                setListing(false);
                void reload();
              }}
            />
          ) : (
            <button type="button" className="btn btn-brass w-fit" onClick={() => setListing(true)} data-testid="usdg-horse-list">
              List or auction {v.name} for {u.name}
            </button>
          )}
        </>
      ) : pending && pending.status === "pending" ? (
        <UsdgPay
          order={pending}
          onDone={() => {
            setOrder(null);
            void reload();
          }}
        />
      ) : (
        <>
          {u.practice && <PracticeBalance micro={v.practice?.balance ?? null} />}
          <p className="t-meta">
            {u.practice
              ? "Registered horses can be sold or auctioned for T-USDG, the beta's test money. Registration is once per horse and costs "
              : "Registered horses can be sold or auctioned for USDG, Robinhood Chain\u2019s dollar stablecoin. Registration is once per horse and costs "}
            <b>{u.practice ? u.dollars(v.policy.registrationFee) : `${u.dollars(v.policy.registrationFee)} (${u.token(v.policy.registrationFee)})`}</b>
            {u.practice ? `, from your T-USDG balance. From then on ${v.name} trades only for T-USDG. Credits are never involved.` : `, paid to the Club. From then on ${v.name} trades only for USDG. Credits are never involved.`}
          </p>
          <ul className="grid gap-1" data-testid="usdg-checklist">
            {v.checks
              .filter((c) => c.key !== "terms")
              .map((c) => (
                <Check key={c.key} ok={c.ok}>
                  {c.label}
                </Check>
              ))}
          </ul>
          {!v.wallet && <WalletLink compact />}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="usdg-terms" />
            <span>
              I am 18 or over and accept the <Link href="/wiki/usdg-market" className="underline">{u.name} market rules</Link>: a sale is final, the market fee is {v.policy.feeBps / 100}%, and a winning bid I don&rsquo;t pay
              within {v.policy.paymentWindowHours} h bars me from {u.name} bidding for {v.policy.nonPayerBarDays} days.
            </span>
          </label>
          <TestnetNote chainId={v.network.chainId} mock={v.network.mode === "mock"} practice={v.network.mode === "practice"} />
          <button type="button" className="btn btn-brass w-fit" onClick={() => void register()} disabled={!ready || !terms || busy} data-testid="usdg-register">
            {busy ? "Preparing…" : ready ? `Register for ${u.dollars(v.policy.registrationFee)}` : "Register (requirements above)"}
          </button>
        </>
      )}
      {err ? <ErrorNote error={err} /> : null}
    </section>
  );
}
