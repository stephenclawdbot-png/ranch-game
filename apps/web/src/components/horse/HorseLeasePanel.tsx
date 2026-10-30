"use client";
/**
 * The horse page's lease panel: who has the horse on lease and on what terms (owner, lessee or
 * anyone), the lessee's "hand back early", and the owner's "Offer for lease" for a horse at home.
 */
import Link from "next/link";
import { useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { formatCredits } from "@/lib/format";
import type { LeaseView } from "@/lib/economyTypes";
import type { HorseDetailView } from "@/lib/types";
import { api } from "@/lib/player";
import { useEcoView } from "../economy/kit";
import { LeaseOfferForm } from "../economy/LeaseBoard";

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function HorseLeasePanel({ view }: { view: HorseDetailView }) {
  const l = view.lease;
  if (l) return <ActiveLease view={view} />;
  return <OfferForLease view={view} />;
}

function ActiveLease({ view }: { view: HorseDetailView }) {
  const l = view.lease!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(l.returnPending);
  const [home, setHome] = useState(false);
  async function handBack() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ result: { ended: boolean; pending: boolean } }>(`/api/leases/${l.leaseId}/return`);
      if (r.result.ended) setHome(true);
      else setPending(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const lesseeShare = 100 - l.ownerSharePct;
  return (
    <section className="surface-2 grid gap-2 p-4" aria-labelledby="lease-h" data-testid="horse-lease" data-role={l.role}>
      <h2 id="lease-h" className="t-h2">
        {l.role === "owner" ? `On lease to ${l.lesseeStableName}` : l.role === "lessee" ? `Leased from ${l.ownerStableName}` : `On lease to ${l.lesseeStableName}`}
      </h2>
      <p className="t-meta">
        Ends {day(l.endsAtMs)} · {l.role === "lessee" ? `your share ${lesseeShare}%` : l.role === "owner" ? `your share ${l.ownerSharePct}%` : `owned by ${l.ownerStableName}`} · {l.races}{" "}
        {l.races === 1 ? "race" : "races"} on this lease
        {l.role === "owner" ? ` · ${formatCredits(l.ownerEarned)} earned so far` : l.role === "lessee" ? ` · ${formatCredits(l.lesseeEarned)} earned so far` : ""}
      </p>
      {l.role !== "public" && (
        <p className="caption">
          Up to {l.maxLiveStartsPerWeek} Live starts a week · {l.allowAllOut ? "all-out rides allowed" : "no all-out rides"} · races only when fresh · comes home after a moderate or worse injury
        </p>
      )}
      {l.role === "lessee" &&
        (home ? (
          <p className="font-bold" role="status">
            ✓ Handed back: {view.horse.name} has gone home.
          </p>
        ) : pending ? (
          <p className="font-bold" role="status">
            Handed back: {view.horse.name} goes home after its race.
          </p>
        ) : (
          <button type="button" className="btn btn-outline btn-sm w-fit" onClick={handBack} disabled={busy} data-testid="return-lease">
            {busy ? "Handing back…" : "Hand back early"}
          </button>
        ))}
      {l.role === "owner" && <p className="caption">A lease can&rsquo;t be recalled early: {view.horse.name} comes home when the term ends.</p>}
      {error ? <ErrorNote error={error} /> : null}
    </section>
  );
}

function OfferForLease({ view }: { view: HorseDetailView }) {
  const { data, setData } = useEcoView<LeaseView>("/api/leases");
  if (!data) return null;
  const h = data.horses.find((x) => x.id === view.horse.id);
  if (!h) return null;
  const offer = data.offers.find((o) => o.horseId === h.id);
  return (
    <section className="surface grid gap-2 p-4" aria-labelledby="lease-offer-h" data-testid="horse-lease-offer">
      <h2 id="lease-offer-h" className="t-h2">
        Lease
      </h2>
      {offer ? (
        <p className="t-meta">
          On the lease board: {offer.termDays} days, your share {offer.ownerSharePct}%, until {day(offer.expiresAtMs)}.{" "}
          <Link href="/market#lease" className="underline">
            Manage
          </Link>
        </p>
      ) : h.block ? (
        <p className="t-meta">🔒 Can&rsquo;t be offered for lease: {h.block}</p>
      ) : (
        <>
          <p className="t-meta">Let another stable race {view.horse.name} for a while and keep a share of every purse. It stays yours.</p>
          <LeaseOfferForm horse={h} config={data.config} onView={setData} />
        </>
      )}
    </section>
  );
}
