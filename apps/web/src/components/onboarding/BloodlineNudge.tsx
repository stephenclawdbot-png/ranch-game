"use client";

import Link from "next/link";
import * as gc from "@thoroughbred/game-core";
import { MentorLine } from "./Mentor";
import { sendOnboarding, useOnboarding } from "./guide";

const PREGNANCY_HOURS = Math.round(gc.PREGNANCY_MS / 3_600_000);
const liveRaces = (n: number) => `${n} Live ${n === 1 ? "race" : "races"}`;

/**
 * The bloodline nudge (owner-approved 2026-11-01; reworked 2026-11-20): Wilf suggests starting a
 * bloodline, from the stable's third day or the day a racing filly has the starts to breed
 * (game-core BREED_FROM_STARTS). A mare that can be covered today goes straight to the stallion
 * finder; one that can't yet is told how many Live races she still needs. It no longer asks a new
 * stable to retire a starter: a racing mare breeds and races on. Shown once: "Not now" puts it
 * away for good, and the server never sends it to a stable that has already bred.
 */
export function BloodlineNudge() {
  const o = useOnboarding();
  const b = o?.bloodline;
  if (!b) return null;
  const finder = `/breeding?mare=${encodeURIComponent(b.horseId)}#finder`;
  // Older payloads carry no `ready`: a retired mare always could breed.
  const ready = b.ready ?? b.retired;
  const toGo = b.startsToGo ?? 0;

  return (
    <section className="frame-hero grid gap-3 p-4" aria-label="Start a bloodline" data-testid="bloodline-nudge">
      <MentorLine compact>
        {ready && b.retired ? (
          <p>
            A few days in the yard now, and you&rsquo;ve a broodmare doing nothing. <b>{b.name}</b> can be covered today: pick her a stallion and there&rsquo;s a foal on the way of your own
            breeding. That&rsquo;s how a stable becomes a name.
          </p>
        ) : ready ? (
          <p>
            <b>{b.name}</b> has run her {liveRaces(gc.BREED_FROM_STARTS)}: she can be covered today. Pick her a stallion (one of your own colts with {liveRaces(gc.BREED_FROM_STARTS)} costs only
            the covering fee) and there&rsquo;s a foal of your own breeding in {PREGNANCY_HOURS} hours. She rests while she&rsquo;s in foal, then races on. That&rsquo;s how a stable becomes a
            name.
          </p>
        ) : (
          <p>
            Time to think about a bloodline. <b>{b.name}</b> can be covered once she has run {liveRaces(gc.BREED_FROM_STARTS)}: {toGo} to go (Story races don&rsquo;t count). No need to retire
            her, she races on after the foal. Enter her on the Live card, and have a look at the stallions meanwhile.
          </p>
        )}
      </MentorLine>
      <div className="flex flex-wrap items-center gap-2">
        {!ready && (
          <Link href="/races" className="btn btn-brass" data-testid="bloodline-live">
            Find {b.name} a Live race
          </Link>
        )}
        <Link href={finder} className={ready ? "btn btn-brass" : "btn"} data-testid="bloodline-finder">
          {ready ? `Pick a stallion for ${b.name}` : "Look at the stallions"}
        </Link>
        <button type="button" className="btn btn-ghost ml-auto" onClick={() => void sendOnboarding({ action: "coach", id: "bloodline" }).catch(() => undefined)} data-testid="bloodline-dismiss">
          Not now
        </button>
      </div>
    </section>
  );
}
