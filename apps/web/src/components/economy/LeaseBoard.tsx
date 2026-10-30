"use client";
/**
 * Sales > Lease: rent racers, buy breeders. Owners offer a racing horse for 7, 14 or 28 days and
 * keep a share of every purse it wins (30-80%); another stable takes the lease, keeps the horse in
 * one of its stalls, cares for it, trains it and races it in its own silks. Nothing is paid up front
 * in the beta: the prize split is the only money a lease moves. Numbers come from the server
 * (game-core leasing.ts), never hard-coded here.
 */
import { useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState, HowItWorks } from "@/components/ui/Page";
import { TRIP_BANDS, aptitudes } from "@/lib/aptitude";
import { SURFACE_LABEL, formatCredits } from "@/lib/format";
import type { LeaseConfigView, LeaseListingView, LeaseOfferable, LeaseRowView, LeaseView, LesseeRecordView } from "@/lib/economyTypes";
import { api } from "@/lib/player";
import { Check, HorseLine, Skeleton, refreshPurse, stageLabel, useEcoView } from "./kit";

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formLine(form: number[]): string {
  return form.length ? [...form].reverse().map((p) => (p > 9 ? "0" : String(p))).join("-") : "unraced";
}

/** "Best: Mile · Turf" from the horse's aptitudes. */
export function fitLine(h: LeaseListingView["horse"]): string {
  const apt = aptitudes(h);
  const trip = TRIP_BANDS[apt.trip.findIndex((c) => c.best)];
  return `Best: ${trip?.label ?? "?"} · ${SURFACE_LABEL[h.preferredSurface]}`;
}

export function starsText(r: Pick<LesseeRecordView, "starsTenths" | "ratings">): string {
  return r.starsTenths === null ? "not rated yet" : `${(r.starsTenths / 10).toFixed(1)}★ (${r.ratings} ${r.ratings === 1 ? "rating" : "ratings"})`;
}

export function recordLine(r: LesseeRecordView): string {
  return `${r.leases} ${r.leases === 1 ? "lease" : "leases"} · ${r.races} races on lease · ${r.injuries} ${r.injuries === 1 ? "injury" : "injuries"} · ${
    r.avgFatigueAtEntry === null ? "no entries yet" : `avg fatigue at entry ${Math.round(r.avgFatigueAtEntry / 10)}%`
  } · ${starsText(r)}`;
}

export function LeaseBoard() {
  const { data, setData, error, reload } = useEcoView<LeaseView>("/api/leases");
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const v = data;
  const c = v.config;
  return (
    <div className="grid gap-5" data-testid="lease-board">
      <HowItWorks label="How leasing works">
        <p>
          Rent racers, buy breeders. An owner offers a racing horse for {c.terms.join(", ")} days. You keep it in one of your stalls, care for it, train it and race it in your silks; its
          League points and trophies are yours. Every purse it wins is split automatically: the owner&rsquo;s share ({c.shareMin}–{c.shareMax}%) goes to the owner, the rest to you.
          {c.feeMax === 0 ? " Nothing is paid up front." : ""}
        </p>
        <p>
          A leased horse can&rsquo;t be sold, bred, retired or renamed by you. It can&rsquo;t race tired, can&rsquo;t be ridden all out unless the owner allows it, and the owner sets its weekly Live
          starts. A moderate or worse injury sends it home after that race. Hand it back any time; the owner can&rsquo;t recall it early.
        </p>
        <p>
          To take a lease you need an account {c.minAccountDays}+ days old with {c.minLiveStarts}+ Live starts, and a free stall; you can hold {c.maxLesseeLeases} at once. Owners can have{" "}
          {c.outSharePct}% of their racing horses out on lease (at least 1, at most {c.maxOutCap}) and {c.maxOpenOffers} open offers. A horse back from a lease waits {c.cooldownDays} days
          before it can be offered again.
        </p>
      </HowItWorks>

      <section className={`${v.me.eligible ? "surface-2" : "surface"} grid gap-2 p-3`} aria-labelledby="lessee-h" data-testid="lessee-status" data-ok={v.me.eligible ? "true" : "false"}>
        <h2 id="lessee-h" className="t-h2">
          {v.me.eligible ? "✓ You can take a lease" : "Before you can take a lease"}
        </h2>
        <ul className="grid gap-1">
          <Check ok={v.me.accountAgeDays >= c.minAccountDays}>
            Account at least {c.minAccountDays} days old (yours: {v.me.accountAgeDays})
          </Check>
          <Check ok={v.me.liveStarts >= c.minLiveStarts}>
            {c.minLiveStarts} Live starts ({v.me.liveStarts} so far)
          </Check>
          <Check ok={v.me.activeLeases < c.maxLesseeLeases}>
            {v.me.activeLeases} of {c.maxLesseeLeases} leases held
          </Check>
          <Check ok={v.stalls.free > 0}>
            A free stall ({v.stalls.used} of {v.stalls.slots} used)
          </Check>
        </ul>
        <p className="t-meta" data-testid="my-lessee-record">
          Your lessee record: {recordLine(v.me.record)}
        </p>
      </section>

      <section aria-labelledby="board-h" className="grid gap-2">
        <h2 id="board-h" className="t-h2">
          Lease board
        </h2>
        {v.board.length === 0 ? (
          <EmptyState icon="horse-head" title="No horses on offer" text="Owners' lease offers appear here. Offer one of yours below." testId="lease-empty" />
        ) : (
          <ul className="lots-grid">
            {v.board.map((l) => (
              <BoardRow key={l.listingId} l={l} onView={setData} />
            ))}
          </ul>
        )}
      </section>

      <MyLeases v={v} onView={setData} />

      <section aria-labelledby="offer-h" className="grid gap-2">
        <SectionHeader id="offer-h" title="Offer one of yours" />
        <p className="t-meta">
          {v.me.caps.out} of {v.me.caps.maxOut} out on lease · {v.me.caps.openOffers} of {v.me.caps.maxOpenOffers} open offers. Offers last {c.offerDays} days. Your horse can still race at home
          while it is on offer.
        </p>
        {v.offers.length > 0 && (
          <ul className="grid gap-2" data-testid="my-lease-offers">
            {v.offers.map((o) => (
              <OfferRow key={o.listingId} o={o} onView={setData} />
            ))}
          </ul>
        )}
        <ul className="grid gap-2">
          {v.horses.filter((h) => !h.offerId).map((h) => (
            <li key={h.id} className="surface grid gap-2 p-3" data-testid="lease-offerable">
              <HorseLine h={h} meta={<>{stageLabel(h.stage)} · OR {h.rating} · {h.starts} starts</>} />
              {h.block ? (
                <p className="text-sm font-bold text-cream-dim">🔒 {h.block}</p>
              ) : (
                <LeaseOfferForm horse={h} config={c} onView={setData} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function BoardRow({ l, onView }: { l: LeaseListingView; onView: (v: LeaseView) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  async function take() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ view: LeaseView }>(`/api/leases/offers/${l.listingId}/take`);
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
    <li className="lot-card print grid gap-2 p-4" data-testid="lease-listing">
      <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-line pb-2">
        <span className="lot-no">{l.termDays}-day lease</span>
        <span className="truncate text-xs font-bold text-cream-dim">
          {l.newOwner && <span className="tag !h-5 !text-[0.6875rem]">New owner</span>} Owner · {l.ownerStableName}
        </span>
      </div>
      <HorseLine h={l} meta={<>OR {l.rating} · form {formLine(l.form)} · {l.wins} {l.wins === 1 ? "win" : "wins"} from {l.starts}</>} />
      <p className="caption">{fitLine(l.horse)}</p>
      <p className="text-sm">
        <span className="font-extrabold">Your share {l.lesseeSharePct}%</span> of every purse · owner {l.ownerSharePct}%{l.fee > 0 ? ` · ${formatCredits(l.fee)} up front` : " · nothing up front"}
      </p>
      <p className="caption">
        Up to {l.maxLiveStartsPerWeek} Live starts a week · {l.allowAllOut ? "all-out rides allowed" : "no all-out rides"}
        {l.minLesseeRating ? ` · lessees rated ${l.minLesseeRating}★+` : ""} · offer ends {day(l.expiresAtMs)}
      </p>
      {done ? (
        <p className="font-bold text-positive" role="status">
          ✓ {l.horse.name} is in your stable for {l.termDays} days.
        </p>
      ) : confirming ? (
        <div className="paper grid gap-2 p-3" role="alertdialog" aria-label="Confirm lease">
          <p className="font-extrabold">
            Lease {l.horse.name} for {l.termDays} days?
          </p>
          <p className="text-sm">
            It takes one of your stalls until the lease ends. You keep {l.lesseeSharePct}% of its purses; {l.ownerStableName} gets {l.ownerSharePct}%.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-brass" onClick={take} disabled={busy} data-testid="take-lease-confirm">
              {busy ? "Taking…" : "Take the lease"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn w-fit" onClick={() => setConfirming(true)} disabled={!!l.takeBlock} title={l.takeBlock ?? undefined} data-testid="take-lease">
          {l.takeBlock ? (l.mine ? "Your offer" : "Can't take yet") : "Take lease"}
        </button>
      )}
      {l.takeBlock && !l.mine && <p className="caption">{l.takeBlock}</p>}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}

function OfferRow({ o, onView }: { o: LeaseView["offers"][number]; onView: (v: LeaseView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      onView((await api<{ view: LeaseView }>(`/api/leases/offers/${o.listingId}/withdraw`)).view);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="surface grid gap-2 p-3" data-testid="my-lease-offer">
      <p className="font-extrabold">{o.horseName}</p>
      <p className="t-meta">
        {o.termDays} days · your share {o.ownerSharePct}% · up to {o.maxLiveStartsPerWeek} Live starts a week · {o.allowAllOut ? "all-out allowed" : "no all-out"} · on offer until {day(o.expiresAtMs)}
      </p>
      <button type="button" className="btn w-fit" onClick={withdraw} disabled={busy} data-testid="withdraw-lease-offer">
        {busy ? "Withdrawing…" : "Withdraw offer"}
      </button>
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}

/** The owner's offer form (lease board and horse page). */
export function LeaseOfferForm({ horse, config, onView }: { horse: Pick<LeaseOfferable, "id" | "horse">; config: LeaseConfigView; onView?: (v: LeaseView) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(config.terms[1] ?? config.terms[0]!);
  const [share, setShare] = useState(config.shareDefault);
  const [weekly, setWeekly] = useState(config.weeklyDefault);
  const [allOut, setAllOut] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ view: LeaseView }>("/api/leases/offer", {
        body: { horseId: horse.id, termDays: term, ownerSharePct: share, maxLiveStartsPerWeek: weekly, allowAllOut: allOut, minLesseeRating: minRating },
      });
      setDone(true);
      onView?.(r.view);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (done) return <p className="font-bold text-positive" role="status">✓ {horse.horse.name} is on the lease board (Sales → Lease).</p>;
  if (!open)
    return (
      <button type="button" className="btn btn-outline btn-sm w-fit" onClick={() => setOpen(true)} data-testid="offer-lease-open">
        Offer for lease
      </button>
    );
  return (
    <div className="inset grid gap-3 p-3" data-testid="lease-offer-form">
      <div className="grid gap-1">
        <span className="label">Term</span>
        <div className="segmented" role="group" aria-label="Lease term">
          {config.terms.map((d) => (
            <button key={d} type="button" aria-pressed={term === d} onClick={() => setTerm(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <label className="grid gap-1">
        <span className="label">
          Your share of its purses: {share}% (the lessee keeps {100 - share}%)
        </span>
        <input type="range" min={config.shareMin} max={config.shareMax} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} data-testid="lease-share" />
      </label>
      <label className="grid gap-1">
        <span className="label">Live starts a week, at most: {weekly}</span>
        <input type="range" min={config.weeklyMin} max={config.weeklyMax} step={1} value={weekly} onChange={(e) => setWeekly(Number(e.target.value))} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allOut} onChange={(e) => setAllOut(e.target.checked)} /> Allow all-out rides
      </label>
      <label className="grid gap-1 text-sm">
        <span className="label">Lessees rated at least</span>
        <select className="field w-40" value={minRating ?? ""} onChange={(e) => setMinRating(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Anyone eligible</option>
          {[2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}★{n > config.unratedStars ? " (proven lessees only)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="caption">Nothing is paid up front. The horse stays yours; it comes home when the term ends, after a moderate injury, or if the lessee hands it back.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-brass" onClick={submit} disabled={busy} data-testid="offer-lease-confirm">
          {busy ? "Offering…" : `Offer for ${term} days`}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}

function MyLeases({ v, onView }: { v: LeaseView; onView: (v: LeaseView) => void }) {
  if (!v.leases.length) return null;
  return (
    <section aria-labelledby="my-leases-h" className="grid gap-2">
      <h2 id="my-leases-h" className="t-h2">
        Your leases
      </h2>
      <ul className="grid gap-2">
        {v.leases.map((l) => (
          <LeaseRow key={l.leaseId} l={l} onView={onView} />
        ))}
      </ul>
    </section>
  );
}

const END_TEXT: Record<string, string> = { term: "term ended", returned: "handed back", injured: "injured", retired: "retired", died: "lost" };

function LeaseRow({ l, onView }: { l: LeaseRowView; onView: (v: LeaseView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function act(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      onView((await api<{ view: LeaseView }>(url, body ? { body } : {})).view);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const owner = l.role === "owner";
  const myShare = owner ? l.ownerSharePct : 100 - l.ownerSharePct;
  const earned = owner ? l.ownerEarned : l.lesseeEarned;
  return (
    <li className="surface grid gap-2 p-3" data-testid="lease-row" data-role={l.role} data-status={l.status}>
      <HorseLine
        h={l.horse}
        meta={
          <>
            {owner ? `On lease to ${l.otherStableName}` : `Leased from ${l.otherStableName}`} · {l.status === "active" ? `ends ${day(l.endsAtMs)}` : `home ${day(l.endedAtMs ?? l.endsAtMs)} (${END_TEXT[l.endReason ?? ""] ?? l.endReason})`}
          </>
        }
        aside={<span className="reward">+{formatCredits(earned)}</span>}
      />
      <p className="caption">
        Your share {myShare}% · {l.races} {l.races === 1 ? "race" : "races"} · started {l.startCondition ?? "?"}
        {l.endCondition ? `, returned ${l.endCondition}` : ""} · up to {l.maxLiveStartsPerWeek} Live starts a week{l.allowAllOut ? "" : " · no all-out rides"}
      </p>
      {owner && l.lesseeRecord && <p className="caption">Lessee record: {recordLine(l.lesseeRecord)}</p>}
      {l.returnPending && <p className="caption font-bold">Handed back: goes home after its race.</p>}
      {!owner && l.status === "active" && !l.returnPending && (
        <button type="button" className="btn btn-outline btn-sm w-fit" onClick={() => act(`/api/leases/${l.leaseId}/return`)} disabled={busy} data-testid="return-lease">
          Hand back early
        </button>
      )}
      {l.canRate && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Rate the lessee">
          <span className="text-sm font-bold">Rate {l.otherStableName}:</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className="btn btn-sm" onClick={() => act(`/api/leases/${l.leaseId}/rate`, { stars: n })} disabled={busy} data-testid={`rate-${n}`}>
              {n}★
            </button>
          ))}
        </div>
      )}
      {l.ownerRating !== null && owner && <p className="caption">You rated them {l.ownerRating}★.</p>}
      {error ? <ErrorNote error={error} /> : null}
    </li>
  );
}
