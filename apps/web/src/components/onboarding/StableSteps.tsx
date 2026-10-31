"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatCredits } from "@/lib/format";
import { recommendHorse, type PlayerState } from "@/lib/player";
import type { DailyGoalView, FirstWeekView, StableStepsView } from "@/lib/types";
import { useEntry } from "../entry/EntryProvider";
import { PixelIcon } from "../icons";
import { Section } from "../ui/Page";
import { MentorPortrait } from "./Mentor";
import { MENTOR_FIRST, STEP_COPY, sendOnboarding } from "./guide";

/** Where each job is done, from the player's own stable (a horse to care for, a race to watch). */
export function stepHref(key: string, state: PlayerState): string {
  const rec = recommendHorse(state) ?? state.horses[0];
  switch (key) {
    case "first_race":
      return "/story";
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
    case "rename": {
      // A horse at home that hasn't started yet (renaming closes at the first start).
      const fresh = state.horses.find((h) => h.careerStatus === "racing" && h.starts === 0 && !h.lease);
      return fresh ? `/horse/${fresh.id}/career` : "/stable";
    }
    case "qualifier":
      return "/week";
    case "career_story": {
      // The horse with the most to read.
      const ran = [...state.horses].filter((h) => h.starts > 0).sort((a, b) => b.starts - a.starts)[0];
      return ran ? `/horse/${ran.id}#story-h` : "/stable";
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

/** One job to do: a row that is the tap to do it (a Live entry opens the quick-pick sheet). */
function TodoRow({ itemKey, credits, first, state }: { itemKey: string; credits: number; first: boolean; state: PlayerState }) {
  const entry = useEntry();
  const copy = STEP_COPY[itemKey] ?? { title: itemKey, text: "" };
  const body = (
    <>
      <span className="h-4 w-4 shrink-0 rounded-sm border-2 border-cream-dim" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="t-title block">
          <span className="sr-only">To do: </span>
          {copy.title}
        </span>
      </span>
      {credits > 0 && <span className="num shrink-0 text-cream-dim">+{credits}</span>}
      <PixelIcon name="arrow" size={16} className="shrink-0" />
    </>
  );
  const cls = `row-link w-full gap-3 px-4 py-3 text-left ${first ? "is-selected" : ""}`;
  const testId = first ? "steps-next" : `todo-${itemKey}`;
  return (
    <li data-testid={`step-${itemKey}`} data-done="0">
      {itemKey === "enter_live" ? (
        <button type="button" className={cls} onClick={entry.quickPickLive} data-testid={testId}>
          {body}
        </button>
      ) : (
        <Link href={stepHref(itemKey, state)} className={cls} data-testid={testId}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** Today's three goals, folded into the list as one line each way (they pay as you go; no streaks). */
function GoalsLine({ goals }: { goals: DailyGoalView[] }) {
  if (goals.length === 0) return null;
  const left = goals.filter((g) => !g.done).length;
  return (
    <div className="grid gap-1.5 border-t border-line px-4 pt-3" data-testid="daily-goals">
      <p className="flex items-center justify-between gap-2 text-sm font-extrabold">
        Today&rsquo;s goals <span className="eyebrow">{left} to do</span>
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {goals.map((g) => (
          <li key={g.goal} className={`flex items-center gap-1.5 ${g.done ? "text-cream-dim" : ""}`} data-testid={`goal-${g.goal}`} data-done={g.done ? "1" : "0"}>
            {g.done ? (
              <span className="font-bold text-brass-hi" aria-hidden>
                ✓
              </span>
            ) : (
              <span className="h-3 w-3 shrink-0 rounded-sm border-2 border-cream-dim" aria-hidden />
            )}
            <span>
              <span className="sr-only">{g.done ? "Done: " : "To do: "}</span>
              {g.label}
            </span>
            <span className={`num ${g.done ? "reward" : "text-cream-dim"}`}>+{g.credits}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The first week on Home: ONE checklist (first-hour playtest). The Stable steps (which pay,
 * once each, from the real server events), a few unpaid jobs ticked from the records (the first
 * race, naming a horse, a Feature Qualifier, a career story) and today's goals folded in. Each
 * job is one tap to where it's done. Hidden once everything is done or after the first week.
 */
export function StableSteps({
  week,
  steps,
  state,
  plain,
  goals = [],
}: {
  week: FirstWeekView;
  steps: StableStepsView | null;
  state: PlayerState;
  plain: boolean;
  goals?: DailyGoalView[];
}) {
  const pct = Math.round((week.done / Math.max(1, week.total)) * 100);
  const first = week.next[0] ?? null;
  const credits = new Map(week.items.map((i) => [i.key, i.credits]));
  return (
    <Section
      id="steps-h"
      title="Your first week"
      testId="stable-steps"
      aside={
        <span className="eyebrow" data-testid="steps-count">
          {week.done} of {week.total} done
        </span>
      }
    >
      <div className="surface grid gap-3 pt-4">
        <div className="flex items-start gap-3 px-4">
          <MentorPortrait variant="face" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] leading-6">
              <b>{MENTOR_FIRST}:</b> {first ? (STEP_COPY[first]?.text ?? "On to the next job.") : "That's the lot. Nicely done."} <span className="text-cream-dim">Each job ticks itself off when it&rsquo;s done.</span>
            </p>
            <div className="mt-2 h-2 w-full bg-inset" role="progressbar" aria-valuemin={0} aria-valuemax={week.total} aria-valuenow={week.done} aria-label="First week progress">
              <div className="h-full bg-brass-hi" style={{ width: `${pct}%` }} />
            </div>
            {steps && !steps.complete && (
              <p className="caption mt-1">
                Stable steps: {formatCredits(steps.earned)} of {formatCredits(steps.totalCredits)} credits · {formatCredits(steps.bonus)} more and a plaque when they&rsquo;re done
              </p>
            )}
          </div>
        </div>
        {week.next.length > 0 && (
          <ol className="rows border-t border-line" data-testid="steps-todo" aria-label="Next to do">
            {week.next.map((k, i) => (
              <TodoRow key={k} itemKey={k} credits={credits.get(k) ?? 0} first={i === 0} state={state} />
            ))}
          </ol>
        )}
        <GoalsLine goals={goals} />
        <details className="group border-t border-line" data-testid="steps-all">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 font-extrabold">
            The whole first week
            <span className="flex items-center gap-2 text-sm text-cream-dim">
              {week.done} of {week.total} done
              <span aria-hidden className="group-open:rotate-90">
                ▸
              </span>
            </span>
          </summary>
          <ol className="rows border-t border-line" data-testid="steps-list">
            {week.items.map((s) => {
              const copy = STEP_COPY[s.key] ?? { title: s.key, text: "" };
              const body: ReactNode = (
                <>
                  {s.done ? (
                    <span className="w-5 shrink-0 text-center font-bold text-brass-hi" aria-hidden>
                      ✓
                    </span>
                  ) : (
                    <span className="h-4 w-5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`t-title block ${s.done ? "text-cream-dim line-through decoration-1" : ""}`}>
                      <span className="sr-only">{s.done ? "Done: " : "To do: "}</span>
                      {copy.title}
                    </span>
                  </span>
                  {s.credits > 0 && <span className={`num shrink-0 ${s.done ? "reward" : "text-cream-dim"}`}>+{s.credits}</span>}
                </>
              );
              return (
                <li key={s.key} data-testid={`week-${s.key}`} data-done={s.done ? "1" : "0"}>
                  {s.done ? (
                    <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
                  ) : (
                    <Link href={stepHref(s.key, state)} className="row-link gap-3 px-4 py-2.5">
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-sm">
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
