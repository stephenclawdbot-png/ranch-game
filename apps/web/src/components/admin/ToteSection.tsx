"use client";

import * as gc from "@thoroughbred/game-core";
import type { ToteAdminStats } from "@thoroughbred/db";
import { useAdminData, when } from "./adminApi";

const amt = (c: gc.ToteCurrency, n: number) => gc.formatToteAmount(c, n);

/**
 * /admin Tote: the house take (to the tote_house ledger account, a credits sink) per day and
 * week per currency, pool volume, bettors, and the biggest pools. Pure parimutuel: the house
 * never bets and carries no liability, so the take is the only house figure there is.
 */
export function ToteSection() {
  const { data, error, reload } = useAdminData<ToteAdminStats>("/api/admin/tote");
  if (error) return <p className="text-negative">{error}</p>;
  if (!data) return <p className="t-meta">Loading…</p>;
  return (
    <div className="grid gap-4" data-testid="admin-tote">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-h2">Tote (house take {gc.TOTE_TAKEOUT_PERMILLE / 10}%)</h3>
        <button type="button" className="btn btn-sm" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {data.byCurrency.map((c) => (
          <li key={c.currency} className="surface grid gap-1 p-3">
            <p className="text-xs font-bold text-cream-dim">{c.currency === "CR" ? "Credits" : "T-USDG (practice)"}</p>
            <p className="score text-[2rem] leading-none text-cream">{amt(c.currency, c.takeWeek)}</p>
            <p className="text-xs text-cream-dim">
              house take, 7 days · today {amt(c.currency, c.takeToday)} · pooled {amt(c.currency, c.volumeWeek)} (today {amt(c.currency, c.volumeToday)}) · {c.bettorsWeek} bettors · {c.racesWeek} races · tote_house
              balance {amt(c.currency, c.houseBalance)}
            </p>
          </li>
        ))}
      </ul>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="p-1">Day (UTC)</th>
            <th className="p-1">Currency</th>
            <th className="p-1 text-right">Take</th>
            <th className="p-1 text-right">Pooled</th>
            <th className="p-1 text-right">Bettors</th>
            <th className="p-1 text-right">Races</th>
          </tr>
        </thead>
        <tbody>
          {data.days.map((d) => (
            <tr key={`${d.day}${d.currency}`} className="border-t-2 border-line">
              <td className="p-1 font-bold">{d.day}</td>
              <td className="p-1">{d.currency}</td>
              <td className="p-1 text-right">{amt(d.currency, d.take)}</td>
              <td className="p-1 text-right">{amt(d.currency, d.volume)}</td>
              <td className="p-1 text-right">{d.bettors}</td>
              <td className="p-1 text-right">{d.races}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="grid gap-1">
        <h4 className="font-extrabold">Biggest pools (30 days)</h4>
        {data.biggest.length === 0 ? (
          <p className="t-meta">No pools settled yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {data.biggest.map((b) => (
              <li key={`${b.raceId}${b.pool}${b.currency}`}>
                <a className="link font-bold" href={`/race/${b.raceId}`}>
                  {b.raceName}
                </a>{" "}
                · {b.pool} · {amt(b.currency, b.total)} · take {amt(b.currency, b.takeout)} · {b.bettors} bettors · {when(b.settledAtMs)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
