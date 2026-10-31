"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { PixelIcon } from "@/components/icons";
import { MENTOR_FIRST, MENTOR_NAME, MENTOR_ROLE, sendOnboarding } from "./guide";

/**
 * Wilf's portrait: his own PixelLab bust (art/portraits/mentor-wilf.png, 128 px). "bust" shows the
 * whole picture; "face" shows a 64 px head-and-shoulders crop at native pixels (crisp when small).
 */
const PORTRAIT = { src: "/art/portraits/mentor-wilf.png", size: 128 };
const FACE = { x: 36, y: 14, size: 64 };

export function MentorPortrait({ variant = "bust", scale = 1, className = "" }: { variant?: "bust" | "face"; scale?: 1 | 2; className?: string }) {
  const crop = variant === "face" ? FACE : { x: 0, y: 0, size: PORTRAIT.size };
  const px = crop.size * scale;
  return (
    <span
      className={`well inline-grid shrink-0 place-items-center overflow-hidden ${className}`}
      style={{ width: px + 8, height: px + 8 }}
      role="img"
      aria-label={`${MENTOR_NAME}, ${MENTOR_ROLE.toLowerCase()}`}
      data-testid="mentor-portrait"
    >
      <span
        aria-hidden
        style={{
          display: "block",
          width: px,
          height: px,
          backgroundImage: `url(${PORTRAIT.src})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${PORTRAIT.size * scale}px ${PORTRAIT.size * scale}px`,
          backgroundPosition: `-${crop.x * scale}px -${crop.y * scale}px`,
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}

const SCREENS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Welcome to the yard",
    body: (
      <>
        <p>
          I&rsquo;m {MENTOR_NAME}, {MENTOR_ROLE.toLowerCase()} here at Kestrel Downs. Longer than I&rsquo;ll admit to.
        </p>
        <p>
          Post Time is your racing stable. You look after the horses, train them, race them, and in time breed your own. Every race is run by the same rules for everybody, and its
          result is sealed before the off.
        </p>
      </>
    ),
  },
  {
    title: "How a day works",
    body: (
      <ul className="grid gap-2">
        <li>
          <b>Care</b> for each horse once a day. A minute&rsquo;s work.
        </li>
        <li>
          <b>Race.</b> Story races against the Club are free, any time. Live races against other stables run in three race meetings a day and use your entries.
        </li>
        <li>
          <b>Watch and learn.</b> Every result tells you why it went that way, and what to try next.
        </li>
        <li className="text-cream-dim">Being away never hurts. Nothing goes wrong while you&rsquo;re gone.</li>
      </ul>
    ),
  },
  {
    title: "What to do first",
    body: (
      <>
        <p>Your three starters are in their stalls. Race the one I&rsquo;ve picked in a free Story race; the gates open ten seconds after you tap.</p>
        <p>
          After that, <b>Stable steps</b> on your Estate walk you through the first week, one job at a time, with credits for each. The rest of the yard opens up as you go.
        </p>
      </>
    ),
  },
];

/**
 * The mentor's welcome: three short screens, then "New to horse racing?" (Yes turns on plain
 * language). Skippable at every screen; reopened any time from the guide or /welcome.
 */
export function MentorWelcome({ onDone, doneLabel = "Meet your horses" }: { onDone: () => void; doneLabel?: string }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const last = step === SCREENS.length;

  async function finish(plainLanguage: boolean | null) {
    setBusy(true);
    setError(null);
    try {
      await sendOnboarding({ action: "mentor", plainLanguage });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <section className="frame-hero mx-auto grid w-full max-w-2xl gap-4 p-4 sm:p-5" aria-labelledby="mentor-h" data-testid="mentor-welcome" data-step={step}>
      <div className="flex items-start gap-3">
        <MentorPortrait />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">
            {MENTOR_NAME} · {MENTOR_ROLE}
          </p>
          <h1 id="mentor-h" className="t-hero mt-1">
            {last ? "New to horse racing?" : SCREENS[step]!.title}
          </h1>
        </div>
      </div>

      <div className="grid gap-2 text-[0.9375rem] leading-6" aria-live="polite">
        {last ? (
          <>
            <p>One thing before we start. If racing&rsquo;s new to you, I&rsquo;ll keep it simple: words like going, furlong and OR get a tap-for-meaning, and the key screens use plainer words.</p>
            <p className="text-cream-dim">You can switch this any time from Stable steps.</p>
          </>
        ) : (
          SCREENS[step]!.body
        )}
      </div>

      <ol className="flex items-center gap-1.5" aria-label={`Step ${Math.min(step + 1, SCREENS.length + 1)} of ${SCREENS.length + 1}`}>
        {[...SCREENS, null].map((_, i) => (
          <li key={i} aria-hidden className={`h-1.5 w-6 ${i <= step ? "bg-brass-hi" : "bg-line"}`} />
        ))}
      </ol>

      {last ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn btn-brass btn-lg" disabled={busy} onClick={() => finish(true)} data-testid="mentor-new-yes">
            Yes, keep it simple
          </button>
          <button type="button" className="btn btn-lg" disabled={busy} onClick={() => finish(false)} data-testid="mentor-new-no">
            No, I know my furlongs
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-brass btn-lg" onClick={() => setStep(step + 1)} data-testid="mentor-next">
            Next <PixelIcon name="arrow" size={16} />
          </button>
          {step > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn btn-ghost ml-auto" disabled={busy} onClick={() => finish(null)} data-testid="mentor-skip">
            Skip · {doneLabel}
          </button>
        </div>
      )}
      {error !== null && <ErrorNote error={error} />}
    </section>
  );
}

/** A line from the mentor: portrait, name, one or two sentences, optional action. */
export function MentorLine({ children, action, testId }: { children: React.ReactNode; action?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-start gap-3" data-testid={testId}>
      <MentorPortrait />
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{MENTOR_FIRST} says</p>
        <div className="mt-1 text-[0.9375rem] leading-6">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/** Home, before the mentor's welcome has been seen (e.g. a stable founded by wallet sign-in). */
export function MentorNudge() {
  return (
    <section className="surface p-4" data-testid="mentor-nudge">
      <MentorLine
        action={
          <Link href="/welcome" className="btn btn-brass">
            Hear {MENTOR_FIRST} out
          </Link>
        }
      >
        Welcome to the yard. Got two minutes? I&rsquo;ll show you how it all works.
      </MentorLine>
    </section>
  );
}
