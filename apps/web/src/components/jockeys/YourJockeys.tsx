"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCredits } from "@/lib/format";
import type { MyJockey } from "@/server/jockeys";
import { GradeBadge } from "../StatBars";
import { Section } from "../ui/Page";
import { JockeyPortrait } from "./JockeyPortrait";

type Note = { id: string; title: string; href: string | null; atMs: number };

const MORALE_TAG = { happy: "tag tag-good", unsettled: "tag tag-you", wants_out: "tag tag-live" } as const;

/** Stable → Your jockeys: the riders your stable holds (up to three) with their contracts, and a way to find more. */
export function YourJockeys({ max = 3 }: { max?: number }) {
  const [list, setList] = useState<MyJockey[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/jockeys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { jockeys: [] }))
      .then((b: { jockeys: MyJockey[]; notes?: Note[] }) => {
        if (!live) return;
        setList(b.jockeys);
        setNotes(b.notes ?? []);
      })
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, []);
  const wages = (list ?? []).reduce((s, j) => s + (j.contract?.wageDueThisWeek ?? 0), 0);
  return (
    <Section title="Your jockeys" className="!mt-6" href="/jockeys/window" linkLabel="Transfer window">
      <ul className="surface rows" data-testid="your-jockeys">
        {list === null && <li className="t-meta px-4 py-3">Loading…</li>}
        {list?.map((j) => (
          <li key={j.id} className="yours">
            <Link href={`/jockeys/${j.id}`} className="row-link gap-3 px-3 py-2.5" data-testid="your-jockey">
              <span className="well shrink-0 overflow-hidden">
                <JockeyPortrait jockey={j} silks={j.silks} variant="face" />
              </span>
              <GradeBadge grade={j.grade} />
              <span className="min-w-0 flex-1">
                <span className="t-title block truncate">
                  {j.name}
                  {j.claimLb > 0 && <span className="t-meta"> ({j.claimLb})</span>}
                </span>
                {j.contract ? (
                  <span className="t-meta block">
                    {j.contract.freeWeeksLeft > 0 ? "No wage yet" : `${formatCredits(j.contract.wage)} cr/wk`} · {j.contract.ridesThisWeek}/{j.contract.promisedRides} rides this week
                    {j.freeAgent ? " · contract ends Sunday" : ""}
                  </span>
                ) : (
                  <span className="t-meta block">No contract</span>
                )}
              </span>
              {j.contract && (
                <span className={`${MORALE_TAG[j.contract.morale]} shrink-0`} data-testid="your-jockey-morale">
                  {j.contract.moraleLabel}
                </span>
              )}
              <span className="chev">›</span>
            </Link>
          </li>
        ))}
        {list !== null && list.length > 0 && (
          <li className="t-meta px-4 py-2" data-testid="your-jockeys-wages">
            Wages next week: {formatCredits(wages)} cr. Keep your promised rides: two short weeks running and a jockey can leave at the Sunday window.
          </li>
        )}
        {list !== null && list.length < max && (
          <li>
            <Link href="/jockeys/window" className="row-link gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="t-title block">{list.length === 0 ? "No jockeys" : `${max - list.length} free ${max - list.length === 1 ? "place" : "places"}`}</span>
                <span className="t-meta block">Make offers in the weekly transfer window, or sign a Club freelancer (up to {max}).</span>
              </span>
              <span className="chev">›</span>
            </Link>
          </li>
        )}
      </ul>
      {notes.length > 0 && (
        <ul className="surface rows mt-2" data-testid="jockey-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={n.href ?? "/jockeys/window"} className="row-link gap-3 px-4 py-2">
                <span className="t-meta min-w-0 flex-1">{n.title}</span>
                <span className="chev">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
