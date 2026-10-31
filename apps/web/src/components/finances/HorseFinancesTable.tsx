"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HorseFinances } from "@thoroughbred/db";
import { formatCredits } from "@/lib/format";

/**
 * The per-horse sheet: what each horse earned, what it cost, and the difference — sortable,
 * because the question the page answers is "who is paying for themselves?". Wide screens get
 * the table; phones get a card per horse (the table hides below sm, the cards above it).
 */

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatCredits(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-cream");

type SortKey = "net" | "earned" | "cost" | "costPerStart";
const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: "net", label: "Net", title: "Sort by net: earned minus cost" },
  { key: "earned", label: "Earned", title: "Sort by earned" },
  { key: "cost", label: "Cost", title: "Sort by cost" },
  { key: "costPerStart", label: "Cost per start", title: "Sort by total cost per start made in the period" },
];

function compare(a: HorseFinances, b: HorseFinances, key: SortKey): number {
  if (key === "net") return b.net - a.net || b.earned - a.earned;
  if (key === "costPerStart") return (b.costPerStart ?? Infinity) - (a.costPerStart ?? Infinity) || b.cost - a.cost;
  return b[key] - a[key];
}

export function HorseFinancesTable({ horses }: { horses: HorseFinances[] }) {
  const [sort, setSort] = useState<SortKey>("net");
  const rows = useMemo(() => [...horses].sort((a, b) => compare(a, b, sort)), [horses, sort]);

  return (
    <div>
      <div className="-mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-3 sm:hidden" role="group" aria-label="Sort horses by">
        {SORTS.map((s) => (
          <button key={s.key} type="button" className="fchip" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      <table className="w-full text-left text-sm max-sm:hidden" data-testid="horse-finances-table">
        <caption className="sr-only">Earnings and costs per horse this period, sortable</caption>
        <thead>
          <tr className="border-b-2 border-line">
            <th scope="col" className="py-2 pr-3 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage">
              Horse
            </th>
            <th scope="col" className="py-2 px-2 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage" title="Starts made by the stable with this horse in the period">
              Starts
            </th>
            {SORTS.map((s) => (
              <th
                key={s.key}
                scope="col"
                aria-sort={sort === s.key ? "descending" : "none"}
                className="py-2 pl-2 text-right text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-sage"
              >
                <button type="button" className="link !text-sage hover:!text-cream" title={s.title} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="rows">
          {rows.map((h) => (
            <tr key={h.horseId} className="border-t border-line">
              <td className="py-2 pr-3">
                <Link href={`/horse/${h.horseId}`} className="t-title hover:underline">
                  {h.name}
                </Link>
                <span className="caption ml-2 text-sage">{h.regNo}</span>
                {!h.owned && <span className="caption ml-2 text-cream-dim">no longer yours</span>}
              </td>
              <td className="py-2 px-2 text-right tabular-nums text-cream-dim">{h.starts}</td>
              <td className="py-2 pl-2 text-right tabular-nums font-bold text-cream">{formatCredits(h.earned)}</td>
              <td className="py-2 pl-2 text-right tabular-nums font-bold text-cream">{formatCredits(h.cost)}</td>
              <td className="py-2 pl-2 text-right tabular-nums font-extrabold">
                <span className={tone(h.net)}>{signed(h.net)}</span>
              </td>
              <td className="py-2 pl-2 text-right tabular-nums text-cream-dim">{h.costPerStart === null ? "—" : formatCredits(h.costPerStart)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="surface rows sm:hidden" data-testid="horse-finances-cards">
        {rows.map((h) => (
          <li key={h.horseId} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <Link href={`/horse/${h.horseId}`} className="t-title block hover:underline">
                {h.name}
              </Link>
              <span className="t-meta block">
                {h.regNo}
                {!h.owned && " · no longer yours"}
              </span>
              <span className="caption mt-0.5 block">
                Earned {formatCredits(h.earned)} · cost {formatCredits(h.cost)}
                {h.starts > 0 && ` · ${formatCredits(h.costPerStart ?? 0)} per start (${h.starts} ${h.starts === 1 ? "start" : "starts"})`}
              </span>
            </span>
            <span className={`shrink-0 font-extrabold tabular-nums ${tone(h.net)}`}>{signed(h.net)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}