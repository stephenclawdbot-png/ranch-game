"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CLASS_LABEL, SURFACE_LABEL, formatClock, formatCredits, formatDistance } from "@/lib/format";
import { ApiFailure, api } from "@/lib/player";
import type { SponsorSlotView, SponsorView } from "@/lib/sponsorTypes";
import { Credits, newKey, refreshPurse } from "../economy/kit";
import { ErrorNote } from "../ui/ErrorNote";
import { EmptyState, Section } from "../ui/Page";

/** "2026-11-02" -> "Mon 2 Nov" (the date as given: no timezone shift). */
function dayLabel(date: string, first: boolean): string {
  if (first) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Sponsor a race: pick a local day, then a race on it; one confirm shows the name the race will
 * carry and the price. The list is the server's (prices from SPONSORSHIP), refreshed after a buy.
 */
export function SponsorBoard({ view }: { view: SponsorView }) {
  const router = useRouter();
  const [armed, setArmed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ raceName: string; price: number; raceId: string | null } | null>(null);
  // one key per confirmed slot: a retry of the same purchase never charges twice
  const [keys] = useState(() => new Map<number, string>());
  const full = view.rules.upcoming >= view.rules.maxUpcoming;

  async function buy(slot: SponsorSlotView) {
    setBusy(true);
    setError(null);
    let key = keys.get(slot.slot);
    if (!key) keys.set(slot.slot, (key = newKey()));
    try {
      const out = await api<{ result: { raceName: string; price: number; raceId: string | null } }>("/api/races/sponsor", { body: { slot: slot.slot, key } });
      setDone(out.result);
      setArmed(null);
      refreshPurse();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiFailure ? e : new ApiFailure(0, "network", "Couldn't reach the track. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6" data-testid="sponsor-board">
      {done && (
        <div className="frame-hero grid gap-2 p-4" role="status" data-testid="sponsor-done">
          <p className="tag tag-ready w-fit">Sponsored</p>
          <p className="t-hero">{done.raceName}</p>
          <p className="t-meta">
            {formatCredits(done.price)} credits spent. {done.raceId ? "The race carries your name now." : "The race carries your name when it is published on the card, 6 hours before the off."}
          </p>
          {done.raceId && (
            <Link href={`/race/${done.raceId}`} className="btn btn-sm w-fit">
              See the race
            </Link>
          )}
        </div>
      )}

      <nav aria-label="Day" className="flex flex-wrap gap-2" data-testid="sponsor-days">
        {view.days.map((d, i) => (
          <Link
            key={d.date}
            href={`/races/sponsor?date=${d.date}`}
            className={`chip ${d.date === view.date ? "chip-brass" : ""} min-h-11`}
            aria-current={d.date === view.date ? "page" : undefined}
            scroll={false}
          >
            {dayLabel(d.date, i === 0)} · {d.onSale}
          </Link>
        ))}
      </nav>

      {full && (
        <p className="t-meta" data-testid="sponsor-cap">
          You have {view.rules.upcoming} sponsored races coming up, the most a stable can hold at once. Sponsor another once one of them has run.
        </p>
      )}

      {view.slots.length === 0 ? (
        <EmptyState icon="flag" title="Nothing to sponsor that day" text="Calendar races (Qualifiers, the Weekend Feature, the Plate and the Finals) aren't for sale. Try another day." />
      ) : (
        <ul className="surface rows" data-testid="sponsor-slots">
          {view.slots.map((s) => {
            const affordable = view.credits >= s.price;
            return (
              <li key={s.slot} className={`grid gap-2 px-3 py-3 sm:px-4 ${s.mine ? "yours" : ""}`} data-testid="sponsor-slot" data-slot={s.slot} data-block={s.block ?? "open"}>
                <div className="flex items-center gap-3">
                  <span className="score w-14 shrink-0 text-[1.375rem] leading-none">{formatClock(s.postTimeMs)}</span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="t-title">{s.sponsoredBy ? s.sponsoredName : s.name}</span>
                    <span className="t-meta">
                      {s.feature ? "Feature · " : ""}
                      {CLASS_LABEL[s.raceClass]}
                      {s.distanceM ? ` · ${formatDistance(s.distanceM)}` : ""}
                      {s.surface ? ` ${SURFACE_LABEL[s.surface].toLowerCase()}` : ""} · purse {formatCredits(s.purse)}
                    </span>
                    {s.sponsoredBy && <span className="caption">{s.mine ? "Sponsored by you" : `Sponsored by ${s.sponsoredBy}`}</span>}
                    {s.block === "closed" && <span className="caption">Entries closed</span>}
                  </span>
                  {s.block === null && (
                    <span className="grid shrink-0 justify-items-end gap-1">
                      <Credits value={s.price} className="font-bold" />
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setArmed(s.slot);
                          setError(null);
                        }}
                        disabled={busy || full}
                        data-testid="sponsor-pick"
                      >
                        Sponsor
                      </button>
                    </span>
                  )}
                </div>
                {armed === s.slot && (
                  <div className="surface-2 grid gap-2 p-3" role="group" aria-label={`Sponsor the ${s.name}`} data-testid="sponsor-confirm">
                    <p className="text-sm text-cream">
                      The {formatClock(s.postTimeMs)} becomes <b>{s.sponsoredName}</b>, with your silks on the racecard. {formatCredits(s.price)} credits, spent for good (back only if the race is abandoned).
                    </p>
                    {!affordable && <p className="text-sm font-bold text-negative">You have {formatCredits(view.credits)} credits.</p>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm btn-brass" onClick={() => buy(s)} disabled={busy || !affordable} data-testid="sponsor-confirm-buy">
                        {busy ? "Working…" : `Sponsor for ${formatCredits(s.price)}`}
                      </button>
                      <button type="button" className="btn-ghost min-h-11 text-sm font-bold" onClick={() => setArmed(null)}>
                        Cancel
                      </button>
                    </div>
                    {error !== null && <ErrorNote error={error} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {view.mine.length > 0 && (
        <Section title="Your sponsorships" className="!mt-0">
          <ul className="surface rows" data-testid="sponsor-mine">
            {view.mine.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="t-title">{m.raceName ?? "Named when the card publishes it"}</span>
                  <span className="t-meta">
                    {new Date(m.postTimeMs).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {m.status === "upcoming" ? "coming up" : m.status === "run" ? "run" : "refunded (abandoned)"}
                  </span>
                </span>
                <Credits value={m.price} className="shrink-0 text-cream-dim" />
                {m.raceId && m.status !== "refunded" && (
                  <Link href={`/race/${m.raceId}`} className="chev" aria-label="Open the race">
                    ›
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
