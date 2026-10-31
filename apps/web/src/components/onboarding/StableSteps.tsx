"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCredits } from "@/lib/format";
import { recommendHorse, type PlayerState } from "@/lib/player";
import type { StableStepsView } from "@/lib/types";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { Section } from "../ui/Page";
import { MentorPortrait } from "./Mentor";
import { MENTOR_FIRST, STEP_COPY, sendOnboarding } from "./guide";

/** Where each step is done, from the player's own stable (a horse to care for, a race to watch). */
function stepHref(key: string, state: PlayerState): string {
  const rec = recommendHorse(state) ?? state.horses[0];
  switch (key) {
    case "care":
      return rec ? `/horse/${rec.id}/care` : "/stable";
    case "train_plan":
      return rec ? `/horse/${rec.id}/training` : "/stable";
    case "enter_live":
      return "/races";
    case "watch_live": {
      const live = state.active.find((a) => a.kind === "live");
      return live ? `/race/${live.raceId}` : "/me/races";
    }
    case "read_why": {
      const seen = state.inbox.find((i) => i.raceId && i.read && i.kind === "race_result");
      return seen?.raceId ? `/race/${seen.raceId}#why-h` : "/me/races";
    }
    case "daily_cup":
      return "/cup";
    case "pick":
      return "/races";
    case "quick_race":
      return "/quick";
    case "pin_target":
      return "/week";
    case "breeding_preview":
      return "/breeding#finder";
    default:
      return "/";
  }
}

/** The next step's button: a Live entry opens the quick-pick sheet; everything else is a link. */
function NextAction({ stepKey, state }: { stepKey: string; state: PlayerState }) {
  const entry = useEntry();
  const label = STEP_COPY[stepKey]?.title ?? "Next step";
  if (stepKey === "enter_live") {
    return (
      <button type="button" className="btn btn-brass" onClick={entry.quickPickLive} data-testid="steps-next">
        <PixelIcon name="flag" size={32} className="-my-2" /> {label}
      </button>
    );
  }
  return (
    <Link href={stepHref(stepKey, state)} className="btn btn-brass" data-testid="steps-next">
      {label} <PixelIcon name="arrow" size={16} />
    </Link>
  );
}

/**
 * Stable steps on Home: the first-week guide. Ordered jobs with credits for each, done by
 * the real thing (the server ticks them), a progress bar, and the finishing plaque.
 */
export function StableSteps({ steps, state, plain }: { steps: StableStepsView; state: PlayerState; plain: boolean }) {
  const pct = Math.round((steps.done / Math.max(1, steps.total)) * 100);
  if (steps.complete) {
    return (
      <section className="surface flex flex-wrap items-center gap-3 p-4" data-testid="stable-steps" data-complete="1" aria-label="Stable steps">
        <PixelIcon name="plaque" size={32} />
        <span className="min-w-0 flex-1">
          <span className="t-title block">Stable steps done: Learned the Ropes</span>
          <span className="t-meta block">
            {formatCredits(steps.earned)} credits earned. {MENTOR_FIRST} is around if you want the welcome again.
          </span>
        </span>
        <Link href="/trophies" className="btn btn-sm">
          See the plaque
        </Link>
      </section>
    );
  }
  return (
    <Section
      id="steps-h"
      title="Stable steps"
      testId="stable-steps"
      aside={
        <span className="eyebrow" data-testid="steps-count">
          {steps.done} of {steps.total} done
        </span>
      }
    >
      <div className="surface grid gap-3 p-4">
        <div className="flex items-start gap-3">
          <MentorPortrait variant="face" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] leading-6">
              {steps.next ? (
                <>
                  <b>{MENTOR_FIRST}:</b> {STEP_COPY[steps.next]?.text ?? "On to the next job."}
                </>
              ) : null}
            </p>
            <div className="mt-2 h-2 w-full bg-inset" role="progressbar" aria-valuemin={0} aria-valuemax={steps.total} aria-valuenow={steps.done} aria-label="Stable steps progress">
              <div className="h-full bg-brass-hi" style={{ width: `${pct}%` }} />
            </div>
            <p className="caption mt-1">
              {formatCredits(steps.earned)} of {formatCredits(steps.totalCredits)} credits · {formatCredits(steps.bonus)} more and a plaque when you finish
            </p>
          </div>
        </div>
        {steps.next && (
          <div className="flex flex-wrap items-center gap-2">
            <NextAction stepKey={steps.next} state={state} />
          </div>
        )}
        <details className="group -mx-4 border-t border-line" data-testid="steps-all">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 font-extrabold">
            All {steps.total} steps
            <span className="flex items-center gap-2 text-sm text-cream-dim">
              {steps.done} done
              <span aria-hidden className="group-open:rotate-90">
                ▸
              </span>
            </span>
          </summary>
        <ol className="rows border-t border-line" data-testid="steps-list">
          {steps.steps.map((s, i) => {
            const copy = STEP_COPY[s.key] ?? { title: s.key, text: "" };
            const isNext = s.key === steps.next;
            const body: ReactNode = (
              <>
                {s.done ? (
                  <span className="w-5 shrink-0 text-center font-bold text-brass-hi" aria-hidden>
                    ✓
                  </span>
                ) : (
                  <span className="caption w-5 shrink-0 text-center" aria-hidden>
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={`t-title block ${s.done ? "text-cream-dim line-through decoration-1" : ""}`}>
                    <span className="sr-only">{s.done ? "Done: " : "To do: "}</span>
                    {copy.title}
                  </span>
                  {isNext && <span className="t-meta block">{copy.text}</span>}
                </span>
                <span className={`num shrink-0 ${s.done ? "reward" : "text-cream-dim"}`}>+{s.credits}</span>
              </>
            );
            return (
              <li key={s.key} data-testid={`step-${s.key}`} data-done={s.done ? "1" : "0"}>
                {s.done ? (
                  <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
                ) : (
                  <Link href={stepHref(s.key, state)} className={`row-link gap-3 px-4 py-2.5 ${isNext ? "is-selected" : ""}`}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        </details>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <label className="inline-flex min-h-11 items-center gap-2 font-bold">
            <input type="checkbox" checked={plain} onChange={(e) => void sendOnboarding({ action: "plain", on: e.target.checked })} data-testid="plain-toggle" />
            Plain language (racing words explained)
          </label>
          <Link href="/welcome" className="link">
            {MENTOR_FIRST}&rsquo;s welcome again
          </Link>
          <Link href="/wiki/quick-start" className="link">
            Quick start
          </Link>
        </div>
      </div>
    </Section>
  );
}
