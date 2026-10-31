"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JockeyCard } from "@/server/jockeys";
import { JockeyRow } from "./JockeyBits";
import { Section } from "../ui/Page";

/** Stable → Your jockeys: the riders your stable holds (up to three), with a way to find more. */
export function YourJockeys({ max = 3 }: { max?: number }) {
  const [list, setList] = useState<JockeyCard[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/jockeys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { jockeys: [] }))
      .then((b: { jockeys: JockeyCard[] }) => live && setList(b.jockeys))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Section title="Your jockeys" className="!mt-6" >
      <ul className="surface rows" data-testid="your-jockeys">
        {list === null && <li className="t-meta px-4 py-3">Loading…</li>}
        {list?.map((j) => (
          <JockeyRow key={j.id} j={j} />
        ))}
        {list !== null && list.length < max && (
          <li>
            <Link href="/jockeys?filter=freelancers" className="row-link gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="t-title block">{list.length === 0 ? "No jockeys" : `${max - list.length} free ${max - list.length === 1 ? "place" : "places"}`}</span>
                <span className="t-meta block">Sign a Club freelancer (up to {max}).</span>
              </span>
              <span className="chev">›</span>
            </Link>
          </li>
        )}
      </ul>
    </Section>
  );
}
