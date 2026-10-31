"use client";

import Link from "next/link";
import type { MomentView } from "@/lib/types";
import { MOMENT_VIGNETTE } from "@/lib/cast";
import { PixelIcon } from "../icons";
import { Vignette } from "../ui/Vignette";
import { Section } from "../ui/Page";
import { MOMENT_ICON } from "./TributeCard";

/**
 * Home's stable news: discoveries and milestones (quirks, an improver, scans, first wins,
 * retirements) and the Sunday League recap, each with what it means and a link. A moment from a
 * race only arrives once its result has been watched.
 */
export function StableNews({ items }: { items: MomentView[] }) {
  if (items.length === 0) return null;
  return (
    <Section id="news-h" title="Stable news" testId="stable-news">
      <ul className="surface rows">
        {items.map((m) => (
          <li key={m.id}>
            <Link href={m.href} className="row-link items-start gap-3 px-4 py-3" data-testid="news-item" data-kind={m.kind} data-fresh={m.fresh && m.kind !== "week_recap" ? "1" : "0"}>
              {MOMENT_VIGNETTE[m.kind] ? <Vignette name={MOMENT_VIGNETTE[m.kind]!} /> : <PixelIcon name={MOMENT_ICON[m.kind] ?? "star"} size={32} className="mt-0.5" />}
              <span className="min-w-0 flex-1">
                <span className="t-title block">
                  {m.fresh && m.kind !== "week_recap" && m.kind !== "memorial" && <span className="tag tag-ready mr-2 align-middle">New</span>}
                  {m.title}
                </span>
                <span className="t-meta block line-clamp-3">{m.body}</span>
              </span>
              <span className="chev">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
