"use client";

/**
 * The jockeys list (playtest fix 13): cards on mobile, a sortable table on desktop. Every jockey
 * now carries the numbers an owner actually compares — career strike rate, rides this season and
 * the freelance fee (stable jockeys ride free) — with the grade, instead of only a season-win
 * tally that reads as nothing before the first winner.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { JockeyCard } from "@/server/jockeys";
import { formatCredits } from "@/lib/format";
import { GradeBadge } from "../StatBars";
import { STAGE_LABEL } from "./JockeyBits";
import { JockeyPortrait } from "./JockeyPortrait";

type SortKey = "overall" | "name" | "rides" | "wins" | "strikeRate" | "ridesThisSeason" | "feeFrom";

const COLS: { key: SortKey; label: string; title: string; numeric: boolean }[] = [
  { key: "overall", label: "Grade", title: "Sort by grade", numeric: false },
  { key: "name", label: "Jockey", title: "Sort by name", numeric: false },
  { key: "rides", label: "Rides", title: "Sort by career rides", numeric: true },
  { key: "wins", label: "Wins", title: "Sort by career wins", numeric: true },
  { key: "strikeRate", label: "Strike", title: "Sort by career strike rate", numeric: true },
  { key: "ridesThisSeason", label: "Season", title: "Sort by rides this season", numeric: true },
  { key: "feeFrom", label: "Fee", title: "Sort by freelance fee", numeric: true },
];

/** A sortable column's value: null strike rates and fees (own jockeys) sink to the bottom. */
function sortValue(j: JockeyCard, key: SortKey): number | string {
  if (key === "name") return j.name;
  if (key === "strikeRate") return j.strikeRate ?? -1;
  if (key === "feeFrom") return j.feeFrom ?? -1;
  return j[key];
}

function feeText(j: JockeyCard): string {
  return j.feeFrom === null ? "rides free" : `from ${formatCredits(j.feeFrom)} cr`;
}

function statsLine(j: JockeyCard): string {
  const strike = j.strikeRate === null ? "no rides yet" : `${j.strikeRate}% strike`;
  return `${j.rides} rides · ${j.wins} wins · ${strike} · ${j.ridesThisSeason} this season · ${feeText(j)}`;
}

export function JockeyTable({ jockeys, testId = "jockey-list" }: { jockeys: JockeyCard[]; testId?: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return jockeys;
    const val = (j: JockeyCard) => sortValue(j, sort.key);
    return [...jockeys].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return cmp * sort.dir;
    });
  }, [jockeys, sort]);

  const head = (c: (typeof COLS)[number]) => {
    const active = sort?.key === c.key;
    // Descending first (best first), ascending second, then back to the server's own order.
    const firstDir: 1 | -1 = c.key === "name" ? 1 : -1;
    return (
      <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className={`flex w-full items-center gap-1 ${c.numeric ? "justify-end" : ""}`} title={c.title} onClick={() => setSort(!active ? { key: c.key, dir: firstDir } : sort!.dir === firstDir ? { key: c.key, dir: (firstDir * -1) as 1 | -1 } : null)} data-testid={`sort-${c.key}`}>
          {c.label}
          <span aria-hidden>{active ? (sort!.dir === 1 ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  if (!rows.length) return null;
  return (
    <>
      {/* Mobile: one card per jockey with the same numbers the table shows. */}
      <ul className="surface rows sm:hidden" data-testid={`${testId}-cards`}>
        {rows.map((j) => (
          <li key={j.id} className={j.mine ? "yours" : undefined}>
            <Link href={`/jockeys/${j.id}`} className="row-link gap-3 px-3 py-2.5" data-testid="jockey-row">
              <span className="well shrink-0 overflow-hidden">
                <JockeyPortrait jockey={j} silks={j.silks} variant="face" />
              </span>
              <GradeBadge grade={j.grade} />
              <span className="min-w-0 flex-1">
                <span className="t-title block truncate">
                  {j.name}
                  {j.claimLb > 0 && <span className="t-meta"> ({j.claimLb})</span>}
                </span>
                <span className="t-meta block truncate">
                  {STAGE_LABEL[j.stage]} · {j.stableName ?? "Club freelancer"}
                  {j.retiring ? " · retiring" : ""}
                </span>
                <span className="caption block">{statsLine(j)}</span>
              </span>
              <span className="chev">›</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: sortable columns; the third click returns to the server's best-first order. */}
      <table className="surface hidden w-full border-collapse sm:table" data-testid={`${testId}-table`}>
        <thead>
          <tr>{COLS.map(head)}</tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.id} className={`border-t-2 border-dotted border-line ${j.mine ? "yours" : ""}`} data-testid="jockey-row">
              <td className="p-2">
                <GradeBadge grade={j.grade} />
              </td>
              <td className="min-w-0 p-2">
                <Link href={`/jockeys/${j.id}`} className="row-link flex items-center gap-3 px-1 py-0" data-testid="jockey-link">
                  <span className="well shrink-0 overflow-hidden">
                    <JockeyPortrait jockey={j} silks={j.silks} variant="face" />
                  </span>
                  <span className="min-w-0">
                    <span className="t-title block truncate">
                      {j.name}
                      {j.claimLb > 0 && <span className="t-meta"> ({j.claimLb})</span>}
                      {j.mine && <span className="you-tag ml-2 align-middle">You</span>}
                    </span>
                    <span className="t-meta block truncate">
                      {STAGE_LABEL[j.stage]} · {j.stableName ?? "Club freelancer"}
                      {j.retiring ? " · retiring" : ""}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="num p-2 text-right">{j.rides}</td>
              <td className="num p-2 text-right">{j.wins}</td>
              <td className="num p-2 text-right">{j.strikeRate === null ? "–" : `${j.strikeRate}%`}</td>
              <td className="num p-2 text-right">{j.ridesThisSeason}</td>
              <td className="p-2 text-right text-sm">{feeText(j)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}