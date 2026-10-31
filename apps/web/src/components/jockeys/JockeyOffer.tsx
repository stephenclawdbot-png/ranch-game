"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { JOCKEY_CONTRACT_LENGTH_LABELS, JOCKEY_CONTRACT_LENGTHS, type JockeyContractLength } from "@thoroughbred/game-core";
import type { JockeyMarketInfo } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";
import { api } from "@/lib/player";

/**
 * The offer form on a free agent's page (this week's transfer window): wage, length, promised rides
 * and buyout, within the published bounds. The signing fee is held until the window closes and
 * comes back if the jockey goes elsewhere.
 */
export function JockeyOffer({ id, name, market }: { id: string; name: string; market: JockeyMarketInfo }) {
  const router = useRouter();
  const b = market.bounds;
  const start = market.myOffer ?? b.standard;
  const [wage, setWage] = useState(start.wage);
  const [length, setLength] = useState<JockeyContractLength>(start.length);
  const [rides, setRides] = useState(start.promisedRides);
  const [buyout, setBuyout] = useState(start.buyout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/jockeys/${encodeURIComponent(id)}/offer`, method === "POST" ? { body: { wage, length, promisedRides: rides, buyout } } : { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  const first = name.split(" ")[0] ?? name;
  return (
    <form
      className="surface grid gap-3 p-4"
      data-testid="jockey-offer"
      onSubmit={(e) => {
        e.preventDefault();
        void send("POST");
      }}
    >
      <div>
        <p className="t-title">{market.myOffer ? "Your offer" : `Make ${first} an offer`}</p>
        <p className="t-meta">
          {market.myOffer
            ? `Held until Sunday 20:00 UTC; ${market.myOffer.fee ? `${formatCredits(market.myOffer.fee)} cr signing fee in escrow` : "no signing fee (your own jockey)"}.`
            : `${b.fee ? `${formatCredits(b.fee)} cr signing fee held until the window closes, back if ${first} signs elsewhere.` : "No signing fee for your own jockey."} ${market.openOffers} of 3 offers open.`}
        </p>
      </div>
      <label className="grid gap-1">
        <span className="t-meta">
          Weekly wage ({formatCredits(b.wage.min)}–{formatCredits(b.wage.max)} cr)
        </span>
        <input className="field min-h-11 px-2" type="number" inputMode="numeric" min={b.wage.min} max={b.wage.max} step={10} value={wage} onChange={(e) => setWage(Number(e.target.value))} data-testid="offer-wage" />
      </label>
      <fieldset className="grid gap-1">
        <legend className="t-meta">Length</legend>
        <div className="flex flex-wrap gap-2">
          {JOCKEY_CONTRACT_LENGTHS.map((l) => (
            <button key={l} type="button" className="fchip" aria-pressed={length === l} onClick={() => setLength(l)}>
              {JOCKEY_CONTRACT_LENGTH_LABELS[l]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1">
        <span className="t-meta">Rides promised a week (0–{b.ridesMax})</span>
        <input className="field min-h-11 px-2" type="number" inputMode="numeric" min={0} max={b.ridesMax} value={rides} onChange={(e) => setRides(Number(e.target.value))} data-testid="offer-rides" />
      </label>
      <label className="grid gap-1">
        <span className="t-meta">
          Buyout price ({formatCredits(b.buyout.min)}–{formatCredits(b.buyout.max)} cr)
        </span>
        <input className="field min-h-11 px-2" type="number" inputMode="numeric" min={b.buyout.min} max={b.buyout.max} step={50} value={buyout} onChange={(e) => setBuyout(Number(e.target.value))} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-brass" disabled={busy} data-testid="offer-submit">
          {market.myOffer ? "Change offer" : "Make offer"}
        </button>
        {market.myOffer && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void send("DELETE")}>
            Withdraw
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm font-bold text-negative" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
