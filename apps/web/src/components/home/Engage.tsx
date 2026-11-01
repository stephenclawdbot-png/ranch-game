"use client";
/**
 * Coming back to the yard (GET /api/engage): "Tomorrow at your yard", this week's table across
 * every stable, and the Saturday Feature card (Thursday to Saturday evening). All read from the
 * server's records; nothing here counts down at you or asks you to keep a streak.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { EngageView, SaturdayFeatureCardView, TomorrowLineView, WeekBoardRowView, WeekBoardView } from "@/lib/engageTypes";
import { useNow } from "@/lib/clock";
import { formatDistance } from "@/lib/format";
import { localClockText, utcClockText } from "@/lib/meetings";
import { PixelIcon, type IconName } from "../icons";
import { Section } from "../ui/Page";

/** Refresh the panel this often while the page is open (and when the tab regains focus). */
const POLL_MS = 120_000;

/** GET /api/engage, refreshed now and then. `undefined` while loading, `null` when it failed. */
export function useEngage(refreshKey?: string): EngageView | null | undefined {
  const [view, setView] = useState<EngageView | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/engage", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as EngageView);
    } catch {
      setView((v) => (v === undefined ? null : v));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, refreshKey]);
  return view;
}

/** A time in this browser's clock ("21:00", "tomorrow at 00:00", "Sat at 19:00"); UTC before hydration. */
function When({ ms, prefix = "" }: { ms: number; prefix?: string }) {
  const now = useNow(60_000);
  return (
    <span className="t-meta block" data-testid="local-time">
      {prefix}
      {now === null ? utcClockText(ms) : localClockText(ms, now)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tomorrow at your yard
// ---------------------------------------------------------------------------

const TOMORROW_ICON: Record<string, IconName> = {
  gift_foal: "invitation",
  results: "results-board",
  calendar: "trophy",
  healed: "water-bucket",
  fresh: "carrots",
  cup: "laurel",
  story: "race-diary",
  entries: "ticket",
};

/** "Tomorrow at your yard": what will be new, from real state only. Nothing shows when nothing will be. */
export function TomorrowCard({ lines, className }: { lines: TomorrowLineView[]; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <Section id="tomorrow-h" title="Tomorrow at your yard" testId="tomorrow" className={className}>
      <ul className="surface rows">
        {lines.map((l) => (
          <li key={l.kind}>
            <Link href={l.href} className="row-link gap-3 px-4 py-2.5" data-testid="tomorrow-line" data-kind={l.kind}>
              <PixelIcon name={TOMORROW_ICON[l.kind] ?? "calendar-day"} size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="t-title block">{l.text}</span>
                {l.atMs !== undefined && <When ms={l.atMs} prefix={l.kind === "gift_foal" || l.kind === "cup" || l.kind === "entries" ? "From " : ""} />}
              </span>
              <span className="chev">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="caption mt-2">Nothing to keep up with: it will all be here whenever you come back.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// This week's table
// ---------------------------------------------------------------------------

function Move({ r, since }: { r: WeekBoardRowView; since: boolean }) {
  if (!since) return <span className="w-9 shrink-0" aria-hidden />;
  if (r.isNew)
    return (
      <span className="w-9 shrink-0 text-center text-[0.6875rem] font-extrabold text-brass-hi" title="New on the table today">
        NEW
      </span>
    );
  if (r.move === null || r.move === 0)
    return (
      <span className="w-9 shrink-0 text-center text-cream-dim" title="No change since this morning">
        –
      </span>
    );
  const up = r.move > 0;
  return (
    <span className={`w-9 shrink-0 text-center text-[0.8125rem] font-extrabold ${up ? "text-sage" : "text-cream-dim"}`} title={`${up ? "Up" : "Down"} ${Math.abs(r.move)} since this morning`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(r.move)}
      <span className="sr-only">{up ? " up" : " down"} since this morning</span>
    </span>
  );
}

function BoardRow({ r, since, phoneHidden }: { r: WeekBoardRowView; since: boolean; phoneHidden?: boolean }) {
  return (
    <li className={`flex items-center gap-2 px-4 py-2 ${r.mine ? "bg-surface-2" : ""} ${phoneHidden ? "max-sm:hidden" : ""}`} data-testid="board-row" data-mine={r.mine ? "1" : "0"}>
      <span className="score w-9 shrink-0 text-center text-[1.25rem]">
        {r.tied ? "=" : ""}
        {r.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`t-title block truncate ${r.mine ? "text-brass-hi" : ""}`}>
          {r.stableName}
          {r.mine && <span className="sr-only"> (you)</span>}
        </span>
        <span className="t-meta block">
          {r.runs} {r.runs === 1 ? "run" : "runs"}
          {r.wins > 0 ? ` · ${r.wins} ${r.wins === 1 ? "win" : "wins"}` : ""}
        </span>
      </span>
      <Move r={r} since={since} />
      <span className="num w-12 shrink-0 text-right font-extrabold">{r.points}</span>
    </li>
  );
}

/** Rows shown on phones (the rest of the top ten from the sm breakpoint up). */
const PHONE_ROWS = 5;

/**
 * "This week": the top stables by League points, your place, and movement since this morning.
 * Home shows the top ten (five on phones) with a link to the full table on the League page (`full`).
 */
export function WeekBoardCard({ board, full = false }: { board: WeekBoardView; full?: boolean }) {
  const since = board.sinceMs !== null;
  const mineOutside = board.mine && !board.top.some((r) => r.mine) ? board.mine : null;
  return (
    <Section
      id={full ? "this-week" : "week-board-h"}
      title={full ? "Every stable this week" : "This week"}
      href={full ? undefined : "/league#this-week"}
      linkLabel={full ? undefined : "Full table"}
      aside={full ? <span className="eyebrow">{board.stables} {board.stables === 1 ? "stable" : "stables"}</span> : undefined}
      testId={full ? "week-board-full" : "week-board"}
    >
      {board.top.length === 0 ? (
        <p className="surface p-4 text-sm text-cream-dim" data-testid="week-board-empty">
          No Live races have finished this week yet. One Live race puts your stable on the table.
        </p>
      ) : (
        <div className="surface">
          <ul className="rows" aria-label="This week's top stables">
            {board.top.map((r, i) => (
              <BoardRow key={`${r.rank}:${r.stableName}`} r={r} since={since} phoneHidden={!full && i >= PHONE_ROWS && !r.mine} />
            ))}
            {mineOutside && (
              <>
                <li className="px-4 py-1 text-center text-cream-dim" aria-hidden>
                  ⋯
                </li>
                <BoardRow r={mineOutside} since={since} />
              </>
            )}
          </ul>
          <p className="caption border-t border-line px-4 py-2" data-testid="week-board-note">
            {board.mine ? `You're ${board.mine.tied ? "joint " : ""}${board.mine.rank} of ${board.stables}. ` : "Your first Live race this week puts you on the table. "}
            League points from this week&rsquo;s Live races{since ? "; arrows show the change since 00:00 UTC" : ""}.
          </p>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The Saturday Feature
// ---------------------------------------------------------------------------

const list = (xs: string[], max: number) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`);

/** Home from Thursday: "Saturday Feature: 19:00 UTC (your time)", who's in so far and how to qualify. */
export function SaturdayFeatureCard({ f }: { f: SaturdayFeatureCardView }) {
  const now = useNow(60_000);
  const mine = f.qualified.filter((q) => q.mine);
  const myEntries = f.entered.filter((e) => e.mine);
  const off = f.status === "off";
  return (
    <section className="feature-event surface mt-4 grid gap-3 p-4" aria-labelledby="sat-feature-h" data-testid="saturday-feature">
      <div className="flex items-start gap-3">
        <PixelIcon name="trophy-silver" size={32} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Saturday Feature · {utcClockText(f.postTimeMs)}</p>
          <h2 id="sat-feature-h" className="t-serif mt-0.5 text-[1.375rem] leading-7">
            {f.name}
          </h2>
          <p className="t-meta">
            {formatDistance(f.distanceM)} · {f.surface === "synthetic" ? "all-weather" : f.surface} · up to {f.maxRunners} runners
          </p>
          <p className="mt-1 text-sm text-cream-dim" data-testid="feature-local-time">
            {off ? "Off at " : "Off "}
            <b className="text-cream">{now === null ? utcClockText(f.postTimeMs) : localClockText(f.postTimeMs, now)}</b> your time
          </p>
        </div>
      </div>
      <ul className="grid gap-1 text-sm" data-testid="feature-field">
        <li>
          <b>Qualified so far:</b>{" "}
          {f.qualified.length === 0 ? "nobody yet" : `${f.qualified.length} ${f.qualified.length === 1 ? "horse" : "horses"} (${list(f.qualified.map((q) => (q.mine ? `your ${q.horseName}` : q.horseName)), 4)})`}
        </li>
        {f.raceId && (
          <li>
            <b>Entered:</b> {f.entered.length} of {f.maxRunners}
            {myEntries.length ? `, including your ${list(myEntries.map((e) => e.horseName), 2)}` : ""}
          </li>
        )}
        {!off && (
          <li className="text-cream-dim">
            <b className="text-cream">How to get in:</b> a top {f.qualifyTop} in a weekday Feature Qualifier ({utcClockText(f.qualifiersLeft[0] ?? f.postTimeMs).replace(" UTC", "")} UTC
            {f.qualifiersLeft.length ? `, ${f.qualifiersLeft.length} left this week` : ", none left this week"}), or a rating of {f.ratingByRight}+.
            {mine.length ? ` Your ${list(mine.map((q) => q.horseName), 2)} ${mine.length === 1 ? "is" : "are"} in.` : ""}
          </li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        {f.raceId && (
          <Link href={`/race/${f.raceId}`} className="btn btn-brass" data-testid="feature-racecard">
            <PixelIcon name={off ? "stopwatch" : "racecard"} size={32} className="-my-2" /> {off ? "Watch the Feature" : "Racecard"}
          </Link>
        )}
        <Link href="/week" className={`btn ${f.raceId ? "" : "btn-brass"}`} data-testid="feature-week">
          Road to Saturday
        </Link>
      </div>
    </section>
  );
}

/** The race page of the Weekend Feature: an event banner (no new rules; the same race, dressed up). */
export function FeatureBanner({ postTimeMs }: { postTimeMs: number }) {
  return (
    <div className="feature-event surface flex items-center gap-3 px-4 py-3" data-testid="feature-banner">
      <PixelIcon name="trophy-silver" size={32} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="eyebrow">The week&rsquo;s big race · Group 1</p>
        <p className="t-title">
          Saturday Feature · {utcClockText(postTimeMs)}
          <When ms={postTimeMs} prefix="Your time: " />
        </p>
      </div>
      <Link href="/week" className="link shrink-0 text-sm">
        How horses qualify ›
      </Link>
    </div>
  );
}

/** After a result: what's new tomorrow (the same card as Home's foot). */
export function TomorrowAfterResult() {
  const view = useEngage();
  if (!view || view.tomorrow.length === 0) return null;
  return <TomorrowCard lines={view.tomorrow} className="!mt-0" />;
}
