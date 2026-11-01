"use client";

import Link from "next/link";
import type { AwayLineView, WelcomeBackView } from "@/lib/types";
import { useNow } from "@/lib/clock";
import { localClockText, utcClockText } from "@/lib/meetings";
import { PixelIcon, type IconName } from "../icons";
import { MentorPortrait } from "./Mentor";
import { MENTOR_FIRST, sendOnboarding } from "./guide";

/** At most this many lines on the card (the summary's own lines first, then what's due). */
const MAX_LINES = 5;

function away(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days`;
  if (days === 1) return "a day";
  return `${Math.max(1, Math.round(ms / 3_600_000))} hours`;
}

/** What happened while you were away, said without spoiling a race you haven't watched. */
function ranLine(w: WelcomeBackView): string {
  if (w.ran === 0) return "Your horses rested. Nothing went wrong while you were gone.";
  const runs = `${w.ran} ${w.ran === 1 ? "race" : "races"}`;
  const watched = w.ran - w.unseen;
  const parts: string[] = [];
  if (watched > 0) parts.push(w.wins > 0 ? `${w.wins} ${w.wins === 1 ? "win" : "wins"}` : w.places > 0 ? `${w.places} placed` : "no wins yet");
  if (w.unseen > 0) parts.push(`${w.unseen === w.ran ? "every result" : `${w.unseen}`} still to watch`);
  return `Your horses ran ${runs}: ${parts.join(", ")}.`;
}

const ICON: Record<string, IconName> = {
  result: "play",
  live_today: "race-clock",
  credits: "money-sack",
  gift_foal: "invitation",
  foal_born: "horse-head",
  foal_due: "horse-head",
  recovered: "water-bucket",
  fresh: "carrots",
  rating: "training-chart",
  training: "stopwatch",
  rival_win: "binoculars",
  due: "check",
};

/** The summary's lines, then what's due that they don't already say (a result line covers "results to watch"). */
export function awayRows(w: WelcomeBackView): AwayLineView[] {
  const lines = w.lines ?? [];
  const hasResult = lines.some((l) => l.kind === "result");
  const due = w.due.filter((d) => !(hasResult && /result/.test(d.label))).map((d) => ({ kind: "due", text: d.label, href: d.href }));
  return [...lines, ...due].slice(0, MAX_LINES);
}

function Times({ times }: { times: number[] }) {
  const now = useNow(60_000);
  return <span className="t-meta block">{times.map((t) => (now === null ? utcClockText(t) : localClockText(t, now))).join(" · ")}</span>;
}

/**
 * Home after hours away ("While you were away"), or right after a sign-in ("Welcome back,
 * <Stable>"): up to five tappable lines, most important first, then one big next action.
 */
export function WelcomeBack({ w, title = "While you were away", onClose }: { w: WelcomeBackView; title?: string; /** Also called when the card is dismissed or its action followed. */ onClose?: () => void }) {
  const rows = awayRows(w);
  const dismiss = () => {
    onClose?.();
    void sendOnboarding({ action: "welcome_back" }).catch(() => undefined);
  };
  return (
    <section className="frame-hero grid gap-3 p-4" aria-labelledby="wb-h" data-testid="welcome-back">
      <div className="flex items-start gap-3">
        <MentorPortrait />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Away {away(w.awayMs)}</p>
          <h2 id="wb-h" className="t-hero mt-1 break-words">
            {title}
          </h2>
          {(w.lines?.length ?? 0) === 0 && (
            <p className="mt-1 text-[0.9375rem] leading-6">
              <b>{MENTOR_FIRST}:</b> {ranLine(w)}
            </p>
          )}
        </div>
      </div>
      {rows.length > 0 && (
        <ul className="surface rows" aria-label="Since your last visit" data-testid="away-lines">
          {rows.map((d) => (
            <li key={`${d.kind}:${d.text}`}>
              <Link href={d.href} className="row-link gap-3 px-4 py-2.5" data-testid="away-line" data-kind={d.kind} onClick={onClose}>
                <PixelIcon name={ICON[d.kind] ?? "arrow"} size={16} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="t-title block">{d.text}</span>
                  {d.times && d.times.length > 0 && <Times times={d.times} />}
                </span>
                <span className="chev">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1">
        <Link href={w.next.href} className="btn btn-brass btn-lg whitespace-normal" data-testid="welcome-back-next" onClick={onClose}>
          <PixelIcon name="flag" size={32} className="-my-2 shrink-0" /> {w.next.label}
        </Link>
        <p className="caption">{w.next.why}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={dismiss} data-testid="welcome-back-dismiss">
        Thanks, {MENTOR_FIRST}
      </button>
    </section>
  );
}
