"use client";

import Link from "next/link";
import { useState } from "react";
import type { MomentView } from "@/lib/types";
import { api } from "@/lib/player";
import { PixelIcon } from "../icons";
import { MOMENT_ICON, TributeCard } from "./TributeCard";

/**
 * The horse page's one-time highlight: what was discovered or achieved since the owner last
 * looked (moments not dismissed yet). Dismissing stores it on the server, so it shows once
 * whichever device the owner uses.
 */
export function MomentHighlights({ moments, horseId }: { moments: MomentView[]; horseId: string }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shown = moments.filter((m) => !gone.has(m.id));
  if (shown.length === 0) return null;
  const dismiss = (id: string) => {
    setGone((s) => new Set(s).add(id));
    api("/api/moments/dismiss", { body: { id } }).catch(() => undefined);
  };
  return (
    <section className="grid gap-3" aria-label="New for this horse" data-testid="moment-highlights">
      {shown.map((m) => {
        const memorial = m.kind === "memorial";
        const here = m.href === `/horse/${horseId}`;
        return (
          <article
            key={m.id}
            className={`surface fade-up grid gap-2 border-2 p-4 ${memorial ? "border-line" : "border-brass"}`}
            data-testid="moment-highlight"
            data-kind={m.kind}
          >
            <div className="flex items-start gap-3">
              <PixelIcon name={MOMENT_ICON[m.kind] ?? "star"} size={32} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{memorial ? "In memoriam" : "New"}</p>
                <h2 className="t-title text-lg">{m.title}</h2>
                <p className="mt-1 max-w-prose text-[0.9375rem] text-cream-dim">{m.body}</p>
              </div>
            </div>
            {m.tribute && <TributeCard name={m.horseName ?? "This horse"} tribute={m.tribute} memorial={memorial ? { atMs: m.createdAtMs, raceId: m.raceId, raceName: null } : null} />}
            <div className="flex flex-wrap items-center gap-2">
              {!here && (
                <Link href={m.href} className="btn btn-sm" data-testid="moment-link">
                  {m.href.startsWith("/race/") ? "Watch it again" : m.href.startsWith("/legacy") ? "The Legacy Farm" : m.href.endsWith("/career") ? "Career" : "Look"}
                </Link>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(m.id)} data-testid="moment-dismiss">
                {memorial ? "Close" : "Got it"}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
