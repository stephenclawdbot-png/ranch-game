"use client";

import Link from "next/link";
import type { WelcomeBackView } from "@/lib/types";
import { PixelIcon } from "../icons";
import { MentorPortrait } from "./Mentor";
import { MENTOR_FIRST, sendOnboarding } from "./guide";

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

/** Home after a day or more away: what the horses did, what's due, and one thing to do next. */
export function WelcomeBack({ w }: { w: WelcomeBackView }) {
  return (
    <section className="frame-hero grid gap-3 p-4" aria-labelledby="wb-h" data-testid="welcome-back">
      <div className="flex items-start gap-3">
        <MentorPortrait />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Away {away(w.awayMs)}</p>
          <h2 id="wb-h" className="t-hero mt-1">
            Welcome back
          </h2>
          <p className="mt-1 text-[0.9375rem] leading-6">
            <b>{MENTOR_FIRST}:</b> {ranLine(w)}
          </p>
        </div>
      </div>
      {w.due.length > 0 && (
        <ul className="surface rows" aria-label="What's due">
          {w.due.map((d) => (
            <li key={d.label}>
              <Link href={d.href} className="row-link gap-3 px-4 py-2.5">
                <span className="t-title min-w-0 flex-1">{d.label}</span>
                <span className="chev">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1">
        <Link href={w.next.href} className="btn btn-brass btn-lg" data-testid="welcome-back-next">
          <PixelIcon name="flag" size={32} className="-my-2" /> {w.next.label}
        </Link>
        <p className="caption">{w.next.why}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => void sendOnboarding({ action: "welcome_back" }).catch(() => undefined)} data-testid="welcome-back-dismiss">
        Thanks, {MENTOR_FIRST}
      </button>
    </section>
  );
}
