"use client";

import { useEffect, useState } from "react";
import type { HorseLifeView, StatKey, WorkoutView } from "@/lib/horseLife";
import { STAT_NAMES, dayName } from "@/lib/horseLife";
import { formatCredits } from "@/lib/format";
import { GradeBadge } from "../StatBars";
import { PixelIcon } from "../icons";
import { ActionBar } from "../ui/ActionBar";
import { ErrorNote } from "../ui/ErrorNote";
import { CellBar, useAction } from "./common";
import { TrainingBoard } from "./TrainingBoard";

interface SessionResponse {
  ran: boolean;
  workout: string | null;
  cost: number;
  arrows: Record<StatKey, 0 | 1> | null;
  injured: boolean;
  overworked: boolean;
  sessionsUsed: number;
}

const SHORT: Record<StatKey, string> = { speed: "Spd", stamina: "Sta", burst: "Brs", durability: "Dur", adaptability: "Adp", temperament: "Tmp" };

function WorkoutEffect({ w }: { w: WorkoutView }) {
  if (w.key === "rest") return <span className="text-positive">Fatigue ▼ · freshness ▲</span>;
  return (
    <span>
      {w.trains.map((k) => (
        <span key={k} className="mr-1.5 whitespace-nowrap text-positive" aria-label={`${STAT_NAMES[k]} up`}>
          ▲{SHORT[k]}
        </span>
      ))}
      <span className="whitespace-nowrap text-negative">Fatigue ▲</span>
    </span>
  );
}

/** Weekly plan (3 slots, 4 with a Trainer), run one session at a time. */
export function TrainingPlanner({ view }: { view: HorseLifeView }) {
  const t = view.training;
  const first = view.name;
  const [plan, setPlan] = useState<string[]>(t.plan);
  const [last, setLast] = useState<SessionResponse | null>(null);
  const action = useAction();
  const base = `/api/horses/${view.id}/training`;
  const byKey = new Map(t.workouts.map((w) => [w.key, w]));
  const dirty = plan.join() !== t.plan.join();
  const saved = t.plan.join();
  useEffect(() => setPlan(saved.split(",")), [saved]);

  const nextKey = t.sessionsUsed < t.slots ? plan[t.sessionsUsed] : null;
  const next = nextKey ? byKey.get(nextKey) : undefined;
  const fatigue = view.condition.fatigue;
  const tired = fatigue > 600 && next?.hard;
  const totalCost = plan.slice(t.sessionsUsed).reduce((a, k) => a + (byKey.get(k)?.cost ?? 0), 0);
  const credits = view.credits;

  async function save() {
    await action.run("save", base, { method: "PUT", body: { slots: plan } });
  }
  async function runSession() {
    if (dirty) {
      const ok = await action.run("save", base, { method: "PUT", body: { slots: plan } });
      if (!ok) return;
    }
    const r = await action.run<SessionResponse>("train", base, { body: { expectedSession: t.sessionsUsed } });
    if (r) setLast(r);
  }

  if (!t.available) {
    return (
      <section className="surface grid gap-2 p-4" data-testid="training-blocked">
        <h2 className="t-h2">Training</h2>
        <p className="text-cream-dim">{t.blockedReason}</p>
      </section>
    );
  }

  return (
    <div className="grid gap-5">
      {t.sessionsUsed < t.slots && (
        <TrainingBoard
          previews={t.previews}
          workouts={t.workouts}
          picked={nextKey ?? null}
          session={t.sessionsUsed + 1}
          onPick={(key) => setPlan((p) => p.map((x, j) => (j === t.sessionsUsed ? key : x)))}
        />
      )}
      <section className="surface grid gap-3 p-4" aria-labelledby="plan-h" data-testid="training-plan">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="plan-h" className="t-h2">
              This week&rsquo;s plan
            </h2>
            <p className="text-sm text-cream-dim">
              Session {Math.min(t.sessionsUsed + 1, t.slots)} of {t.slots} · new week {dayName(t.weekResetsMs)}
              {t.lightOnly && " · yearlings do light work only"}
            </p>
          </div>
          <span className="chip text-cream" data-testid="sessions-used">
            {t.sessionsUsed}/{t.slots} done
          </span>
        </div>
        <ol className="rows">
          {plan.map((key, i) => {
            const w = byKey.get(key);
            const done = i < t.sessionsUsed;
            return (
              <li key={i} className="grid grid-cols-[2rem_1fr] items-center gap-x-2 gap-y-1 py-2 sm:grid-cols-[2rem_12rem_1fr_auto]">
                <span className={`num text-center ${done ? "text-positive" : i === t.sessionsUsed ? "text-brass-bright" : "text-sage"}`}>{done ? "✓" : i + 1}</span>
                {done ? (
                  <span className="font-extrabold text-cream-dim">{w?.label ?? key}</span>
                ) : (
                  <select
                    className="field min-h-11 w-full"
                    value={key}
                    aria-label={`Session ${i + 1}`}
                    onChange={(e) => setPlan((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                    data-testid={`slot-${i}`}
                  >
                    {t.workouts.map((o) => (
                      <option key={o.key} value={o.key} disabled={!o.allowed}>
                        {o.label}
                        {o.cost ? ` · ${o.cost} cr` : " · free"}
                      </option>
                    ))}
                  </select>
                )}
                {w && (
                  <span className="col-start-2 text-sm font-bold sm:col-start-auto">
                    <WorkoutEffect w={w} />
                  </span>
                )}
                {w && done && <span className="col-start-2 text-sm text-cream-dim sm:col-start-auto sm:text-right">{w.cost ? `${w.cost} cr` : "free"}</span>}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="t-meta">
            Rest of the week: <span className="num text-cream">{formatCredits(totalCost)}</span> credits · you have <span className="num text-cream">{formatCredits(credits)}</span>
          </p>
          {dirty && (
            <button type="button" className="btn btn-sm" onClick={save} disabled={action.busy !== null} data-testid="save-plan">
              {action.busy === "save" ? "Saving…" : "Save plan"}
            </button>
          )}
        </div>
        {last?.ran && (
          <p className="surface-2 p-2 text-sm font-bold" role="status" data-testid="train-result">
            {byKey.get(last.workout ?? "")?.label} done
            {last.cost ? ` (−${last.cost} cr)` : ""}.{" "}
            {last.arrows && (Object.entries(last.arrows) as [StatKey, number][]).filter(([, v]) => v).length > 0
              ? (Object.entries(last.arrows) as [StatKey, number][])
                  .filter(([, v]) => v)
                  .map(([k]) => `▲ ${STAT_NAMES[k]}`)
                  .join(" · ")
              : "A lighter day: fatigue down."}
            {last.overworked && " Tired: only half the gains."}
            {last.injured && " A minor knock in training: a few days off."}
          </p>
        )}
        {tired && <p className="text-sm font-bold text-negative">{first} is tired: hard work now gives half the gains and risks a minor injury. Rest or swimming helps.</p>}
        {action.error != null && action.busy === null && <ErrorNote error={action.error} />}
        <ActionBar>
          <button
            type="button"
            className="btn btn-brass btn-lg"
            onClick={runSession}
            disabled={!next || action.busy !== null || (next?.cost ?? 0) > credits}
            data-testid="train-now"
          >
            <PixelIcon name="stopwatch" size={32} className="-my-2" />
            {!next
              ? `All ${t.slots} sessions done · new week ${dayName(t.weekResetsMs)}`
              : action.busy === "train"
                ? "Training…"
                : `Run ${next.label}${next.cost ? ` · ${next.cost} cr` : ""}`}
          </button>
        </ActionBar>
      </section>

      <section className="surface grid gap-3 p-4" aria-labelledby="real-h" data-testid="realisation">
        <div>
          <h2 id="real-h" className="t-h2">
            Training progress
          </h2>
          <p className="text-sm text-cream-dim">How much of each stat&rsquo;s potential training has unlocked. Gains shrink near the ceiling.</p>
        </div>
        <dl className="grid gap-2">
          {t.realisation.map((r) => (
            <div key={r.key} className="grid grid-cols-[6.5rem_1.75rem_1fr_auto] items-center gap-2">
              <dt className="text-sm font-bold text-cream-dim">
                {r.label}
                {last?.arrows?.[r.key] ? <span className="ml-1 text-positive">▲</span> : null}
              </dt>
              <dd className="contents">
                <GradeBadge value={r.current} size="sm" />
                <CellBar value={r.permille - 600} max={400} cells={10} label={`${r.label} training ${Math.round(r.permille / 10)}%`} tone={r.nearCeiling ? "sky" : "brass"} />
                <span className={`w-24 text-right text-xs font-extrabold ${r.nearCeiling ? "text-sky" : "text-cream-dim"}`}>
                  {r.nearCeiling ? "near ceiling" : `${Math.round(r.permille / 10)}%`}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="surface grid gap-2 p-4" aria-labelledby="fresh-h">
        <h2 id="fresh-h" className="t-h2">
          Freshness
        </h2>
        <CellBar value={view.condition.freshness} max={1000} cells={20} label={`Freshness ${Math.round(view.condition.freshness / 10)}%`} tone={view.condition.freshness < 450 ? "negative" : "positive"} />
        <p className="text-sm text-cream-dim">
          Hard work (speed work, gallops, race prep) sets up a freshness peak 3 to 5 days later. Time your races for it.
          {view.condition.peak.phase !== "none" && view.condition.peak.fromMs && ` Next peak: ${dayName(view.condition.peak.fromMs)} to ${dayName(view.condition.peak.toMs!)}.`}
        </p>
      </section>
    </div>
  );
}
